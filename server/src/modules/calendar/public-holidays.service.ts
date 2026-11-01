import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditAction, CalendarEventType } from '@biddaloy/shared';
import { PublicHolidaySet } from './entities/public-holiday-set.entity';
import { PublicHolidayEntry } from './entities/public-holiday-entry.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import {
  PublicHolidayFetchService,
  PublicHolidaySourceUnavailableError,
} from './public-holiday-fetch.service';
import { HolidayEntryInputDto } from './dto/public-holidays.dto';
// Own namespace, separate from the invoice-numbering/roll-number locks'
// (see those files' own comments on the shared `pg_advisory_xact_lock`
// keyspace convention).
const BULK_ADD_LOCK_NAMESPACE = 630147;
import { CreateCalendarEventDto } from './dto/calendar-events.dto';
import { CalendarEventsService } from './calendar-events.service';
import { localToday } from '../attendance/attendance-policy.util';
import { SchoolsService } from '../schools/schools.service';
import { AuditService } from '../audit/audit.service';
import { resolveTemplateLocale } from '../account-access/account-access-templates';

export interface SuggestedHolidayEntry {
  id: string;
  date: string;
  end_date: string;
  name: string;
  name_bn: string | null;
  already_added: boolean;
}

/**
 * Platform + tenant surface for `PublicHolidaySet`/`PublicHolidayEntry`
 * (17.2.4). Platform side (`listSets`/`getSet`/`fetchIntoSet`/
 * `updateEntries`/`publish`/`unpublish`) is SUPER_ADMIN-only, no
 * `tenant_id` involved — see the entities' own D10 comment. Tenant side
 * (`suggest`/`bulkAdd`) never touches `PublicHolidayFetchService`
 * (D10): it only reads sets this service has already published.
 */
@Injectable()
export class PublicHolidaysService {
  constructor(
    @InjectRepository(PublicHolidaySet)
    private readonly setRepo: Repository<PublicHolidaySet>,
    @InjectRepository(PublicHolidayEntry)
    private readonly entryRepo: Repository<PublicHolidayEntry>,
    @InjectRepository(CalendarEvent)
    private readonly calendarEventRepo: Repository<CalendarEvent>,
    private readonly fetchService: PublicHolidayFetchService,
    private readonly calendarEventsService: CalendarEventsService,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Platform (SUPER_ADMIN)
  // -------------------------------------------------------------------

  async listSets(): Promise<PublicHolidaySet[]> {
    // ponytail: loads every entry to count them (~25 per set, a handful of sets);
    // switch to loadRelationCountAndMap + a list DTO if sets ever grow large.
    return this.setRepo.find({
      relations: ['entries'],
      order: { country: 'ASC', year: 'DESC' },
    });
  }

  async getSet(id: string): Promise<PublicHolidaySet> {
    const set = await this.setRepo.findOne({ where: { id }, relations: ['entries'] });
    if (!set) throw new NotFoundException('Public holiday set not found');
    return set;
  }

  /** Upserts the `(country, year)` set with a fresh fetch — `published_at`
   * is left untouched (a re-fetch of an already-published set stays
   * published until an explicit `unpublish`; the plan only asks for the
   * fetch itself to replace entries, not the publish state). */
  async fetchIntoSet(country: string, year: number, userId: string): Promise<PublicHolidaySet> {
    let fetched;
    try {
      fetched = await this.fetchService.fetch(country, year);
    } catch (error) {
      if (error instanceof PublicHolidaySourceUnavailableError) {
        throw new BadGatewayException({
          message: error.message,
          details: { code: 'PUBLIC_HOLIDAY_SOURCE_UNAVAILABLE' },
        });
      }
      throw error;
    }

    const existing = await this.setRepo.findOne({ where: { country, year } });
    const isNewSet = !existing;

    const saved = await this.setRepo.manager.transaction(async (manager) => {
      const setManager = manager.getRepository(PublicHolidaySet);
      const entryManager = manager.getRepository(PublicHolidayEntry);

      let set = existing;
      if (!set) {
        set = setManager.create({
          country,
          year,
          source: fetched.source,
          published_at: null,
          fetched_at: new Date(),
        });
      } else {
        set.source = fetched.source;
        set.fetched_at = new Date();
      }
      const savedSet = await setManager.save(set);

      // Delete + re-insert must commit together — a crash between them
      // would otherwise leave a published set with zero entries exposed
      // to tenant requests for however long until the next fetch.
      await entryManager.delete({ set_id: savedSet.id });
      if (fetched.entries.length > 0) {
        await entryManager.save(
          fetched.entries.map((entry) =>
            entryManager.create({
              set_id: savedSet.id,
              date: entry.date,
              end_date: entry.end_date,
              name: entry.name,
              name_bn: null,
            }),
          ),
        );
      }
      return savedSet;
    });

    await this.auditService.record({
      // A re-fetch of an already-existing (country, year) set is an
      // update, not a create — this used to always say CREATE.
      action: isNewSet ? AuditAction.CREATE : AuditAction.UPDATE,
      entity_type: 'PublicHolidaySet',
      entity_id: saved.id,
      tenant_id: null,
      performed_by_user_id: userId,
      new_values: { country, year, source: fetched.source, entry_count: fetched.entries.length },
    });

    return this.getSet(saved.id);
  }

  /** Full replace of a set's entries, including any curator-added
   * `name_bn`. Not a patch — the caller sends the complete next state, same
   * pattern as `CalendarEventsService`'s class-id replace. */
  async updateEntries(
    setId: string,
    entries: HolidayEntryInputDto[],
    userId: string,
  ): Promise<PublicHolidaySet> {
    const set = await this.getSet(setId);

    // Same atomicity reasoning as fetchIntoSet: delete + re-insert must
    // commit together, or a crash mid-replace leaves the published set
    // with zero entries until the next edit.
    await this.entryRepo.manager.transaction(async (manager) => {
      const entryManager = manager.getRepository(PublicHolidayEntry);
      await entryManager.delete({ set_id: set.id });
      if (entries.length > 0) {
        await entryManager.save(
          entries.map((entry) =>
            entryManager.create({
              set_id: set.id,
              date: entry.date,
              end_date: entry.end_date,
              name: entry.name,
              name_bn: entry.name_bn ?? null,
            }),
          ),
        );
      }
    });

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'PublicHolidaySet',
      entity_id: set.id,
      tenant_id: null,
      performed_by_user_id: userId,
      new_values: { entry_count: entries.length },
    });

    return this.getSet(set.id);
  }

  async publish(id: string, userId: string): Promise<PublicHolidaySet> {
    const set = await this.getSet(id);
    set.published_at = new Date();
    await this.setRepo.save(set);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'PublicHolidaySet',
      entity_id: set.id,
      tenant_id: null,
      performed_by_user_id: userId,
      new_values: { published_at: set.published_at },
    });

    return this.getSet(id);
  }

  async unpublish(id: string, userId: string): Promise<PublicHolidaySet> {
    const set = await this.getSet(id);
    set.published_at = null;
    await this.setRepo.save(set);

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'PublicHolidaySet',
      entity_id: set.id,
      tenant_id: null,
      performed_by_user_id: userId,
      new_values: { published_at: null },
    });

    return this.getSet(id);
  }

  // -------------------------------------------------------------------
  // Tenant (CALENDAR_READ / CALENDAR_MANAGE)
  // -------------------------------------------------------------------

  /** The published set for the tenant's own country/year, each entry
   * annotated `already_added` when a `HOLIDAY` event with the same
   * `start_date` already exists on this tenant's calendar. `[]` when no
   * set for that country/year has been published yet — never a 404: an
   * unpublished/missing set is a normal "nothing to suggest yet" state for
   * a school, not an error. */
  async suggest(tenantId: string, year: number): Promise<SuggestedHolidayEntry[]> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const country = settings.region?.country ?? 'BD';

    const set = await this.setRepo.findOne({
      where: { country, year },
      relations: ['entries'],
    });
    if (!set || !set.published_at) return [];

    const existingDates = await this.existingHolidayDates(tenantId);

    return set.entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      end_date: entry.end_date,
      name: entry.name,
      name_bn: entry.name_bn,
      already_added: existingDates.has(entry.date),
    }));
  }

  /** Creates a `HOLIDAY` `CalendarEvent` (published immediately) for each
   * requested entry, via `CalendarEventsService.create` — the one place
   * past-lock/academic-year/attendance-guard rules live. Entries whose
   * `date` already has a `HOLIDAY` event on this tenant are skipped rather
   * than erroring, matching `suggest`'s `already_added` flag. An entry id
   * that doesn't exist (wrong tenant's request, stale suggestion) is
   * silently skipped too — nothing to add. Entries dated before the tenant's
   * today are skipped as well (a past closure needs a reason). */
  async bulkAdd(tenantId: string, userId: string, entryIds: string[]): Promise<{ added: number }> {
    const entries = await this.entryRepo.find({
      where: { id: In(entryIds) },
      relations: ['set'],
    });
    // Only entries whose set has been published are eligible — otherwise a
    // tenant could add holidays from a draft/unpublished set it was never
    // meant to see (`suggest` only ever returns published entries).
    const publishedEntries = entries.filter((entry) => !!entry.set?.published_at);
    if (publishedEntries.length === 0) return { added: 0 };

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const useBn = resolveTemplateLocale(settings.region?.locale) === 'bn';
    const today = localToday(settings.region?.timezone ?? 'UTC');

    // Two concurrent bulkAdd calls for the same tenant could otherwise
    // both read the same `existingDates` snapshot and both create a
    // HOLIDAY event for the same date. A transaction-scoped advisory lock
    // keyed on tenantId serializes the whole read-check-create sequence
    // per tenant (same convention as invoice-numbering.util.ts and
    // roll-number.util.ts), releasing automatically on commit/rollback.
    const added = await this.calendarEventRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', [
        tenantId,
        BULK_ADD_LOCK_NAMESPACE,
      ]);

      const existing = await manager.getRepository(CalendarEvent).find({
        where: { tenant_id: tenantId, type: CalendarEventType.HOLIDAY },
        select: ['start_date'],
      });
      const existingDates = new Set(existing.map((event) => event.start_date));

      let addedCount = 0;
      for (const entry of publishedEntries) {
        if (entry.date < today) continue;
        if (existingDates.has(entry.date)) continue;

        const name = useBn && entry.name_bn ? entry.name_bn : entry.name;
        const dto = new CreateCalendarEventDto();
        dto.type = CalendarEventType.HOLIDAY;
        dto.name = name;
        dto.start_date = entry.date;
        dto.end_date = entry.end_date;
        dto.counts_as_working_day = false;
        dto.publish = true;
        await this.calendarEventsService.create(dto, tenantId, userId, undefined, manager);
        existingDates.add(entry.date);
        addedCount += 1;
      }
      return addedCount;
    });

    return { added };
  }

  /** Start dates of this tenant's existing `HOLIDAY` calendar events, used
   * by both `suggest` and `bulkAdd` to flag/skip entries already added. */
  private async existingHolidayDates(tenantId: string): Promise<Set<string>> {
    const existing = await this.calendarEventRepo.find({
      where: { tenant_id: tenantId, type: CalendarEventType.HOLIDAY },
      select: ['start_date'],
    });
    return new Set(existing.map((event) => event.start_date));
  }
}
