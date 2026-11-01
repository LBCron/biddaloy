import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThan, MoreThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import Redis from 'ioredis';
import { PromotionRunStatus } from '@biddaloy/shared';
import type {
  TenantSettings,
  OrganisationSettings,
  MessagingProvidersResponse,
} from '@biddaloy/shared';
import { buildMessagingProvidersResponse } from './settings/messaging-descriptors';
import {
  AuditAction,
  CommunicationStatus,
  IDLE_REASON,
  TRIAL_EXPIRED_REASON,
  UserStatus,
} from '@biddaloy/shared';
import { School } from './entities/school.entity';
import { DEFAULT_REGION_SETTINGS } from './settings/tenant-settings-defaults';
import { localToday } from '../attendance/attendance-policy.util';
import { TenantSettingsDto, OrganisationRenameDto } from './dto/tenant-settings.dto';
import { resolveTenantSettings } from './settings/tenant-settings-resolver';
import { mergeTenantSettings, toPlainSettingsPatch } from './settings/tenant-settings-merge.util';
import { EncryptionService } from './settings/encryption.service';
import { decryptSecretFields, encryptSecretFields } from './settings/settings-encryption.util';
import { maskSecretFields } from './settings/settings-mask.util';
import { pickPatchShape, redactSecretPaths } from './settings/settings-audit-redact.util';
import { TenantSettingsCache } from './settings/tenant-settings-cache.service';
import {
  diffOrganisationVocabulary,
  VOCABULARY_LIST_NAMES,
  VocabularyListName,
} from './settings/organisation-vocabulary.util';
import {
  BILLING_SUSPENSION_REASONS,
  TENANT_STATUS_REDIS,
  TenantStatusService,
} from './tenant-status.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Student } from '../students/entities/student.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';
import { ReviveSchoolDto } from './dto/revive-school.dto';
import { IDLE_REVIVE_WINDOW_DAYS } from '../billing/idle-account.constants';
import { DAY_MS } from './trial/trial.constants';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { PromotionEntry } from '../promotions/entities/promotion-entry.entity';

export interface SchoolStatusResponse {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  status_reason: string | null;
  status_changed_at: Date | null;
}

export interface SchoolStats {
  active_users: number;
  students: number;
  communications_queued: number;
  communications_failed_7d: number;
  last_activity_at: Date | null;
}

const STATS_CACHE_TTL_SECONDS = 60;
const STATS_FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SchoolsService {
  private readonly logger = new Logger(SchoolsService.name);

  constructor(
    @InjectRepository(School)
    private readonly repo: Repository<School>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(CommunicationLog)
    private readonly communicationLogRepo: Repository<CommunicationLog>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    private readonly encryption: EncryptionService,
    private readonly settingsCache: TenantSettingsCache,
    private readonly auditService: AuditService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async findById(id: string): Promise<School> {
    const school = await this.repo.findOne({ where: { id } });
    if (!school) {
      throw new NotFoundException('School not found');
    }
    return school;
  }

  /**
   * For per-tenant scheduler loops; a SUSPENDED school gets no background work (TEN-06, #1655),
   * and never the explicitly configured platform row (TEN-19; env `PLATFORM_TENANT_ID`, which
   * production requires). Outside production the slug-discovered `default-school` is the main
   * seeded school, so it is not excluded.
   */
  async findAllActive(): Promise<Pick<School, 'id'>[]> {
    const platformId = this.tenantStatus.configuredPlatformTenantId();
    // Filtered in memory, not `id <> $1`: a mistyped non-uuid env value would make Postgres throw
    // 22P02 and stop every nightly sweep for every school.
    const schools = await this.repo.find({ where: { status: 'ACTIVE' }, select: { id: true } });
    return platformId ? schools.filter((s) => s.id !== platformId) : schools;
  }

  /**
   * Every school, for #8.7.13's super-admin school picker *and* #533's
   * SUPER_ADMIN platform schools list. Originally `{ id, name }` only (the
   * picker's own need); #533 added `slug`/`status`/`created_at` so the same
   * endpoint also drives the list table (status badge, created date,
   * slug-based search) without a second endpoint. Controller-gated to
   * `SUPER_ADMIN` only — an ADMIN already knows their one school from
   * `tenant.id`, no picker involved.
   */
  async findAll(
    trial?: 'active' | 'expired',
  ): Promise<
    Pick<
      School,
      | 'id'
      | 'name'
      | 'slug'
      | 'status'
      | 'created_at'
      | 'country_code'
      | 'trial_ends_at'
      | 'seat_limit'
      | 'status_reason'
    >[]
  > {
    return this.repo.find({
      select: [
        'id',
        'name',
        'slug',
        'status',
        'created_at',
        'country_code',
        'trial_ends_at',
        'seat_limit',
        'status_reason',
      ],
      where:
        trial === 'active'
          ? { trial_ends_at: MoreThan(new Date()) }
          : trial === 'expired'
            ? { status_reason: TRIAL_EXPIRED_REASON }
            : undefined,
      order: { name: 'ASC' },
    });
  }

  /**
   * [27.2] Resolve a school by its public `slug` — the only lookup the
   * unauthenticated public admission route is allowed (no `id`, no
   * `X-Tenant-ID`; the slug in the URL is the sole tenant signal). Returns
   * `null` rather than throwing so the caller can 404 without leaking
   * whether the slug ever existed.
   */
  /** Only an ACTIVE school resolves — mirrors `ContextGuard`'s own
   * `status !== 'ACTIVE'` check. The public admission routes have no
   * guards, so this is the only place that keeps a suspended school's
   * slug from still serving intakes/applications/status checks. */
  async findBySlug(slug: string): Promise<School | null> {
    return this.repo.findOne({ where: { slug, status: 'ACTIVE' } });
  }

  /**
   * Resolved settings with secret fields still in their stored,
   * *encrypted* form. Internal building block for `getMaskedSettings`
   * (the HTTP-safe view) and `getDecryptedSettings` (the trusted-internal
   * plaintext view) — not safe to return from a controller directly,
   * since an encrypted envelope string is not the same thing as "safe to
   * show," just "not immediately readable."
   */
  async getResolvedSettings(schoolId: string): Promise<TenantSettings> {
    const school = await this.findById(schoolId);
    return resolveTenantSettings(school.settings);
  }

  /** D32: schema + selected + configured per medium. Reads stored (encrypted) settings, presence only. Never returns a value. */
  async getMessagingProviders(schoolId: string): Promise<MessagingProvidersResponse> {
    return buildMessagingProvidersResponse(await this.getResolvedSettings(schoolId));
  }

  /** The school's local calendar date (YYYY-MM-DD) from its `region.timezone`.
   * `resolveTenantSettings` always fills the timezone (the `??` only satisfies the optional type). */
  async todayFor(tenantId: string): Promise<string> {
    const settings = await this.getResolvedSettings(tenantId);
    return localToday(settings.region?.timezone ?? DEFAULT_REGION_SETTINGS.timezone);
  }

  /** Shared `onError` for every `maskSecretFields` call site below — one
   * undecryptable field degrades to `{ configured: true }` with no hint
   * rather than failing the whole response; this just logs which
   * school/field needs attention when that happens. */
  private logMaskingFailure(schoolId: string) {
    return (error: unknown, path: string) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Reporting "${path}" as configured with no hint for school "${schoolId}": ${reason}`,
      );
    };
  }

  /**
   * Resolved settings with every secret field replaced by a
   * `{ configured, hint }` object — see `settings-mask.util.ts`'s own
   * comment for exactly what that means for a set/cleared/never-set
   * field. This is what `SchoolsController`'s `GET`/`PATCH` responses
   * actually return; the plaintext never leaves the process to compute
   * it.
   */
  async getMaskedSettings(schoolId: string): Promise<Record<string, unknown>> {
    const resolved = await this.getResolvedSettings(schoolId);
    return maskSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      this.logMaskingFailure(schoolId),
    );
  }

  /**
   * Same as `getResolvedSettings`, with every secret field decrypted to
   * plaintext. For trusted internal callers only — #8.7.10's per-tenant
   * provider resolver is the intended (and, on this branch, only) one.
   * **Never** wire this to an HTTP response; #8.7.9's settings API must
   * mask secrets, not decrypt them.
   *
   * A field that can't be decrypted (a stale key, or a legacy plaintext
   * row `yarn settings:reencrypt` — `server/src/scripts/
   * reencrypt-settings.ts` — hasn't reached yet) is dropped from the
   * result and logged with the school and path, rather than failing the
   * whole call: one bad WhatsApp token shouldn't also take down a
   * school's working messaging settings.
   */
  async getDecryptedSettings(schoolId: string): Promise<TenantSettings> {
    const resolved = await this.getResolvedSettings(schoolId);
    return decryptSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      (error, path) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Dropping undecryptable tenant setting "${path}" for school "${schoolId}": ${reason}`,
        );
      },
    ) as unknown as TenantSettings;
  }

  /**
   * Merges a validated patch into the school's stored settings and
   * persists it. `dto` is expected to have already passed class-validator
   * (either through Nest's global `ValidationPipe`, once #8.7.9 wires a
   * controller, or a direct `validate()` call) — this method does not
   * re-validate, it merges and saves.
   *
   * Secret fields in `dto` (plaintext, as the caller wrote them) are
   * encrypted *before* merging — encrypting the merged result instead
   * would re-encrypt already-encrypted fields carried over unchanged from
   * what was already stored, corrupting them.
   *
   * Writes a `SETTINGS_CHANGE` audit entry in the same transaction as the
   * save (#8.7.11) — a failed audit write must roll back the settings
   * change with it, not leave an untracked mutation. The diff is scoped to
   * exactly the paths `dto` touches (`pickPatchShape`, the nested
   * equivalent of `FeeStructureService.update`'s `changedKeys`) and every
   * `@Secret()`-marked field in it is replaced with a fixed marker
   * (`redactSecretPaths`) *before* it reaches `AuditService.record` — never
   * the plaintext the caller sent, and never the encrypted envelope either,
   * since a ciphertext string is still a credential's stored form.
   *
   * Invalidates `TenantSettingsCache` for this school after the transaction
   * commits — #8.7.10's per-tenant provider resolver reads through that
   * same cache (shared via `SchoolsModule`'s export, not a second
   * instance), so a school that just rotated a WhatsApp token would
   * otherwise keep sending under the old one until the cache's own TTL
   * happened to expire.
   *
   * Returns the masked settings computed from the row this call itself
   * just saved, rather than the caller doing a second `getMaskedSettings`
   * read afterward — that would be a third query per PATCH, and a window
   * (how ever short) in which the response could reflect a write that
   * landed between this transaction committing and that re-read running,
   * rather than the caller's own.
   */
  async updateSettings(
    schoolId: string,
    dto: TenantSettingsDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
    isPlatformAdmin = false,
  ): Promise<Record<string, unknown>> {
    // [33.3.1] `organisationRenames` rides alongside the PATCH as a write
    // instruction, not a stored setting — pulled out of the plain patch
    // before it ever reaches `mergeTenantSettings`, so it never lands in
    // the persisted `settings` jsonb.
    const rawPlainPatch = toPlainSettingsPatch(dto) as Record<string, unknown> & {
      organisationRenames?: unknown;
    };
    const { organisationRenames: _organisationRenames, ...plainPatch } = rawPlainPatch;
    const renames = dto.organisationRenames ?? [];
    const encryptedPatch = encryptSecretFields(plainPatch, this.encryption);

    const settings = await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo
        .createQueryBuilder('school')
        .where('school.id = :id', { id: schoolId })
        .setLock('pessimistic_write')
        .getOne();
      if (!school) {
        throw new NotFoundException('School not found');
      }

      // #3346: `sms.metering` (who pays for SMS) is the platform's to set. A school caller may
      // resend the stored value (dropped, so the merge never writes it) but not change it.
      const sentSms = (plainPatch.communications as { sms?: Record<string, unknown> } | undefined)
        ?.sms;
      if (sentSms && Object.hasOwn(sentSms, 'metering') && !isPlatformAdmin) {
        const stored = (
          school.settings as { communications?: { sms?: { metering?: string } } } | null
        )?.communications?.sms?.metering;
        if ((stored ?? 'OFF') !== sentSms.metering) {
          throw new ForbiddenException('Only the platform can change the SMS account setting.');
        }
        delete sentSms.metering;
        delete (encryptedPatch.communications as { sms?: Record<string, unknown> }).sms?.metering;
      }

      const oldSnapshot = pickPatchShape(
        (school.settings ?? {}) as Record<string, unknown>,
        plainPatch,
      );

      // [33.3.1] Guard/rename runs inside this same transaction, before the
      // settings save — a value still in use is rejected before it ever
      // disappears from `organisation`, and a rename's row rewrite commits
      // atomically with the settings change that renamed it (both, or
      // neither, on any later failure/rollback).
      if (encryptedPatch.organisation !== undefined) {
        await this.applyOrganisationVocabularyGuard(
          manager,
          schoolId,
          (school.settings as Record<string, unknown> | null)?.organisation as
            OrganisationSettings | undefined,
          encryptedPatch.organisation as OrganisationSettings,
          renames,
        );
      } else if (renames.length > 0) {
        throw new BadRequestException(
          'organisationRenames requires an organisation patch in the same request.',
        );
      }

      school.settings = mergeTenantSettings(school.settings, encryptedPatch);
      await schoolRepo.save(school);

      // [money-tier review] `organisationRenames` is stripped from
      // `plainPatch` before it ever reaches the stored settings (it's a
      // write instruction, not a setting), but that means it's otherwise
      // invisible in the audit trail — a bulk row rewrite across the
      // tenant's `classes`/`class_sections` would audit as a plain
      // settings edit, with no record of which value became which or how
      // many rows moved. Added back in here, audit-only, alongside the
      // settings diff it rode in with.
      const auditNewValues =
        renames.length > 0
          ? {
              ...plainPatch,
              organisationRenames: renames.map((r) => ({ list: r.list, from: r.from, to: r.to })),
            }
          : plainPatch;

      await this.auditService.record(
        {
          action: AuditAction.SETTINGS_CHANGE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: redactSecretPaths(oldSnapshot),
          new_values: redactSecretPaths(auditNewValues),
        },
        manager,
      );

      return school.settings;
    });

    this.settingsCache.invalidate(schoolId);
    if (plainPatch.communications !== undefined) {
      for (const ruleKey of ['comms.provider_missing', 'setup.incomplete'] as const) {
        emitRecheck(attentionEvents, { tenantId: schoolId, ruleKey, actorUserId: userId });
      }
    }
    const resolved = resolveTenantSettings(settings);
    return maskSecretFields(
      resolved as unknown as Record<string, unknown>,
      this.encryption,
      this.logMaskingFailure(schoolId),
    );
  }

  /**
   * [33.3.1] Guards an `organisation` vocabulary change and applies any
   * accompanying rename, inside `updateSettings`'s existing transaction —
   * see that method's own comment for why this doesn't open a second one.
   *
   * For every list (`shifts`/`versions`/`groups`):
   *  - a value present in `oldOrg` but absent from `newOrg`, with no
   *    matching rename, is a removal — rejected if any `classes` (shifts/
   *    versions) row, or any `class_sections` / `class_subjects` / DRAFT-run
   *    `promotion_entries` (groups) row still uses it, message naming the
   *    value and the count. A new column that stores a group name must be
   *    added to `countVocabularyUsage` and `renameVocabularyUsage`.
   *  - a value covered by an explicit `{ list, from, to }` rename skips
   *    that removal check and instead rewrites every matching row to the
   *    new value, in the same transaction as the settings save.
   *
   * What the transaction actually buys: atomicity between the guard, the
   * rename's row rewrite, and the settings save — all three commit or
   * roll back together. It does **not** exclude a concurrent
   * `ClassService.create`/`update`: both read the tenant's vocabulary
   * through `SchoolSettingsReader`'s cache *before* opening their own
   * transaction, so under read-committed a create/update can still commit
   * using a value this call just removed or renamed away from (the
   * create-vs-remove half is `ClassService.create`'s own known,
   * out-of-scope race; update-vs-rename is the same root cause).
   *
   * That window isn't microseconds either: `TenantSettingsCache` is
   * process-local with a 30s TTL, and `invalidate()` (called right after
   * this transaction commits) only clears *this* process's copy. On a
   * multi-replica deploy, a create/update served by a replica that didn't
   * handle this PATCH can keep validating against the pre-rename/removal
   * vocabulary for up to 30 real seconds afterward — no unlucky timing
   * required, just two replicas.
   * ponytail: no cross-table lock or cross-replica invalidation guards
   * this — revisit only if it actually produces a stale-vocabulary row a
   * customer hits.
   */
  private async applyOrganisationVocabularyGuard(
    manager: EntityManager,
    tenantId: string,
    oldOrg: OrganisationSettings | undefined,
    newOrg: OrganisationSettings,
    renames: OrganisationRenameDto[],
  ): Promise<void> {
    const diff = diffOrganisationVocabulary(oldOrg, newOrg);

    const renamesByList = new Map<VocabularyListName, OrganisationRenameDto>();
    for (const rename of renames) {
      if (renamesByList.has(rename.list)) {
        throw new BadRequestException(
          `Only one rename per list is supported; "${rename.list}" was given twice.`,
        );
      }
      if (!(oldOrg?.[rename.list] ?? []).includes(rename.from)) {
        throw new BadRequestException(
          `Cannot rename "${rename.from}" in "${rename.list}" — it is not a currently configured value.`,
        );
      }
      if (!newOrg[rename.list].includes(rename.to)) {
        throw new BadRequestException(
          `Rename target "${rename.to}" in "${rename.list}" must be included in the new organisation settings.`,
        );
      }
      // [money-tier review, bug 1] `from` must actually be a *removal* in
      // this diff, not just present in the old list — old `['Morning']` +
      // new `['Morning', 'Prabhati']` + rename `Morning→Prabhati` would
      // otherwise pass both checks above and still fire the row rewrite,
      // silently folding every `Morning` row into `Prabhati` while
      // `Morning` stays a live, configured shift. Also rejects the
      // `from === to` no-op for free.
      if (!diff[rename.list].removed.includes(rename.from)) {
        throw new BadRequestException(
          `Rename "${rename.from}" → "${rename.to}" in "${rename.list}" is a no-op — "${rename.from}" is still in the new organisation settings, so nothing was removed to rename.`,
        );
      }
      // [money-tier review, bug 2] `to` colliding with an *other*,
      // untouched value already in `oldOrg` would either fold two live
      // vocabulary values into one (lossy, unmentioned in the plan) or
      // hit `classes`/`class_sections`' unique index and surface as an
      // unhandled 500 — reject it explicitly instead.
      if ((oldOrg?.[rename.list] ?? []).includes(rename.to)) {
        throw new BadRequestException(
          `Cannot rename "${rename.from}" to "${rename.to}" in "${rename.list}" — "${rename.to}" is already a configured value.`,
        );
      }
      renamesByList.set(rename.list, rename);
    }

    for (const list of VOCABULARY_LIST_NAMES) {
      const rename = renamesByList.get(list);

      for (const removedValue of diff[list].removed) {
        if (rename && rename.from === removedValue) continue; // handled by the rename below
        const count = await this.countVocabularyUsage(manager, list, tenantId, removedValue);
        if (count > 0) {
          throw new BadRequestException(
            `Cannot remove "${removedValue}" from ${list} — ${count} row(s) still use it. Rename it instead, or reassign those rows first.`,
          );
        }
      }

      if (rename) {
        await this.renameVocabularyUsage(manager, list, tenantId, rename.from, rename.to);
      }
    }
  }

  private async countVocabularyUsage(
    manager: EntityManager,
    list: VocabularyListName,
    tenantId: string,
    value: string,
  ): Promise<number> {
    if (list === 'groups') {
      // Sequential: all three share one transaction connection.
      const sections = await manager
        .getRepository(ClassSection)
        .createQueryBuilder('cs')
        .where('cs.tenant_id = :tenantId', { tenantId })
        .andWhere('cs.group_name = :value', { value })
        .andWhere('cs.deleted_at IS NULL')
        .getCount();
      const subjects = await manager
        .getRepository(ClassSubject)
        .createQueryBuilder('sub')
        .where('sub.tenant_id = :tenantId', { tenantId })
        .andWhere('sub.group_name = :value', { value })
        .andWhere('sub.deleted_at IS NULL')
        .getCount();
      // COMMITTED runs are history and never block.
      const draftEntries = await manager
        .getRepository(PromotionEntry)
        .createQueryBuilder('pe')
        .innerJoin(
          'promotion_runs',
          'r',
          'r.id = pe.run_id AND r.tenant_id = :tenantId AND r.status = :draft',
          { draft: PromotionRunStatus.DRAFT },
        )
        .where('pe.tenant_id = :tenantId', { tenantId })
        .andWhere('pe.group_name = :value', { value })
        .getCount();
      return sections + subjects + draftEntries;
    }
    const column = list === 'shifts' ? 'shift' : 'version';
    return manager
      .getRepository(Class)
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere(`c.${column} = :value`, { value })
      .andWhere('c.deleted_at IS NULL')
      .getCount();
  }

  private async renameVocabularyUsage(
    manager: EntityManager,
    list: VocabularyListName,
    tenantId: string,
    from: string,
    to: string,
  ): Promise<void> {
    try {
      if (list === 'groups') {
        await manager
          .createQueryBuilder()
          .update(ClassSection)
          .set({ group_name: to })
          .where('tenant_id = :tenantId', { tenantId })
          .andWhere('group_name = :from', { from })
          .execute();
        await manager
          .createQueryBuilder()
          .update(ClassSubject)
          .set({ group_name: to })
          .where('tenant_id = :tenantId', { tenantId })
          .andWhere('group_name = :from', { from })
          .execute();
        // DRAFT runs only: COMMITTED runs are history and keep the old name.
        await manager.query(
          `UPDATE promotion_entries pe SET group_name = $3, updated_at = now() FROM promotion_runs r
           WHERE r.id = pe.run_id AND r.status = $4 AND pe.tenant_id = $1 AND r.tenant_id = $1
             AND pe.group_name = $2`,
          [tenantId, from, to, PromotionRunStatus.DRAFT],
        );
        return;
      }
      const column = list === 'shifts' ? 'shift' : 'version';
      await manager
        .createQueryBuilder()
        .update(Class)
        .set({ [column]: to } as Partial<Class>)
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere(`${column} = :from`, { from })
        .execute();
    } catch (err) {
      // [money-tier review, bug 2] The `rename.to` pre-check above rejects
      // a collision with the tenant's *other configured* values, but not
      // every row-level collision — a soft-deleted class/section can still
      // hold the target value (`classes`' unique index has no `deleted_at`
      // filter — see `countVocabularyUsage`'s own comment for why that's
      // deliberate for the *usage count*, unrelated to this rewrite). Same
      // 23505→409 mapping `UsersService`/`bulk-upload.service.ts` already
      // use, rather than a raw 500.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Cannot rename "${from}" to "${to}" in "${list}" — "${to}" collides with an existing row.`,
        );
      }
      throw err;
    }
  }

  private statsKey(schoolId: string): string {
    return `tenant:${schoolId}:stats`;
  }

  /**
   * Five cheap platform metrics for the SUPER_ADMIN console detail page
   * (#532). Every query below filters by this school's `tenant_id` — no
   * cross-tenant joins, matching the rest of this module's per-query
   * scoping (see the `multi-tenancy` skill checklist).
   *
   * Cached in Redis for 60s, keyed by school id, reusing the same
   * fail-open-friendly client `TenantStatusService` (#527) already wires
   * up as `TENANT_STATUS_REDIS` — a cache read/write failure here degrades
   * to "compute it," never to an error.
   */
  async getStats(schoolId: string): Promise<SchoolStats> {
    // Before the cache: every count below is tenant-scoped, so an unknown
    // id would otherwise "succeed" with all zeros and cache them for 60s.
    await this.findById(schoolId);
    const key = this.statsKey(schoolId);

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        const parsed = JSON.parse(cached) as SchoolStats;
        return {
          ...parsed,
          last_activity_at: parsed.last_activity_at ? new Date(parsed.last_activity_at) : null,
        };
      }
    } catch (error) {
      this.logger.error(
        `Stats cache read failed for school ${schoolId}, falling back to DB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const failedSince = new Date(Date.now() - STATS_FAILED_WINDOW_MS);

    const [activeUsers, students, communicationsQueued, communicationsFailed7d, lastActivity] =
      await Promise.all([
        this.userTenantRepo
          .createQueryBuilder('ut')
          .innerJoin('ut.user', 'user')
          .where('ut.tenant_id = :schoolId', { schoolId })
          .andWhere('user.status = :status', { status: UserStatus.ACTIVE })
          .getCount(),
        this.studentRepo.count({ where: { tenant_id: schoolId } }),
        this.communicationLogRepo.count({
          where: { tenant_id: schoolId, status: CommunicationStatus.QUEUED },
        }),
        this.communicationLogRepo.count({
          where: {
            tenant_id: schoolId,
            status: CommunicationStatus.FAILED,
            created_at: MoreThanOrEqual(failedSince),
          },
        }),
        this.auditLogRepo
          .createQueryBuilder('al')
          .select('MAX(al.created_at)', 'max_created_at')
          .where('al.tenant_id = :schoolId', { schoolId })
          .getRawOne<{ max_created_at: Date | null }>(),
      ]);

    const stats: SchoolStats = {
      active_users: activeUsers,
      students,
      communications_queued: communicationsQueued,
      communications_failed_7d: communicationsFailed7d,
      last_activity_at: lastActivity?.max_created_at ?? null,
    };

    try {
      await this.redis.set(key, JSON.stringify(stats), 'EX', STATS_CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        `Stats cache write failed for school ${schoolId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return stats;
  }

  /**
   * SUPER_ADMIN school lifecycle switch (#530). Sets `status` +
   * `status_reason` + `status_changed_at` in one transaction with the audit
   * write (SUSPEND when moving to SUSPENDED, REACTIVATE when moving to
   * ACTIVE), then invalidates `TenantStatusService`'s cache so the very
   * next request from that tenant sees the new status — `ContextGuard`
   * (#527) reads through that same cache.
   *
   * If the requested status already matches the current one, this is a
   * no-op: no audit row, no cache invalidation, still 200. Nothing
   * actually changed, so there's nothing to explain later.
   *
   * The current status is read under a `pessimistic_write` row lock inside
   * the same transaction as the update, so two concurrent suspend requests
   * serialise: the second one sees SUSPENDED and takes the no-op path
   * instead of writing a duplicate SUSPEND audit entry.
   */
  async updateStatus(
    schoolId: string,
    dto: UpdateSchoolStatusDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SchoolStatusResponse> {
    // TRIAL_EXPIRED, SEATS_EXPIRED and IDLE are system codes that open the backup export (D16). Only the billing jobs may
    // write it, so typing it in here can never open that door (#2399).
    if (BILLING_SUSPENSION_REASONS.includes(dto.reason.trim().toUpperCase())) {
      throw new BadRequestException({
        message: 'That reason is a reserved billing code; write the reason in words',
        details: { code: 'RESERVED_STATUS_REASON' },
      });
    }
    const now = new Date();

    const { response, changed } = await this.repo.manager.transaction(async (manager) => {
      const schoolRepo = manager.getRepository(School);
      const school = await schoolRepo.findOne({
        where: { id: schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!school) {
        throw new NotFoundException('School not found');
      }

      // A manual suspension on top of an ended trial must replace TRIAL_EXPIRED, which opens the
      // backup export (D16); same status with the same reason stays a no-op (#2399).
      const reasonChanged = dto.status === 'SUSPENDED' && school.status_reason !== dto.reason;
      if (school.status === dto.status && !reasonChanged) {
        return {
          changed: false,
          response: {
            id: school.id,
            status: school.status,
            status_reason: school.status_reason,
            status_changed_at: school.status_changed_at,
          },
        };
      }

      await schoolRepo.update(schoolId, {
        status: dto.status,
        status_reason: dto.reason,
        status_changed_at: now,
      });

      await this.auditService.record(
        {
          action: dto.status === 'SUSPENDED' ? AuditAction.SUSPEND : AuditAction.REACTIVATE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { status: school.status, reason: school.status_reason },
          new_values: { status: dto.status, reason: dto.reason },
        },
        manager,
      );

      return {
        changed: true,
        response: {
          id: schoolId,
          status: dto.status,
          status_reason: dto.reason,
          status_changed_at: now,
        },
      };
    });

    if (changed) {
      await this.tenantStatus.invalidate(schoolId);
    }

    return response;
  }

  /**
   * Platform SUPER_ADMIN revives a school the idle job paused or soft-deleted (Epic 49 D5), up to
   * 90 days after the soft delete. Raw SQL because `repo.findOne` cannot see a soft-deleted row.
   * Only an IDLE suspension is revived here; any other suspension goes through `updateStatus`.
   * Setting `status_changed_at` restarts the idle clock, so the school is not re-suspended tonight.
   */
  async revive(
    schoolId: string,
    dto: ReviveSchoolDto,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SchoolStatusResponse> {
    const now = new Date();

    const { response, changed } = await this.repo.manager.transaction(async (manager) => {
      const [row]: {
        status: 'ACTIVE' | 'SUSPENDED';
        status_reason: string | null;
        status_changed_at: Date | null;
        deleted_at: Date | null;
      }[] = await manager.query(
        `SELECT status, status_reason, status_changed_at, deleted_at
           FROM schools WHERE id = $1 FOR NO KEY UPDATE`,
        [schoolId],
      );
      // Rule 23: the id is not echoed back.
      if (!row) throw new NotFoundException('School not found');

      if (row.status === 'ACTIVE' && !row.deleted_at) {
        return {
          changed: false,
          response: {
            id: schoolId,
            status: row.status,
            status_reason: row.status_reason,
            status_changed_at: row.status_changed_at,
          },
        };
      }
      if (
        row.deleted_at &&
        new Date(row.deleted_at).getTime() < now.getTime() - IDLE_REVIVE_WINDOW_DAYS * DAY_MS
      ) {
        throw new ConflictException({
          message: 'This school can no longer be revived',
          details: { code: 'REVIVE_WINDOW_PASSED' },
        });
      }
      if (row.status_reason !== IDLE_REASON) {
        throw new ConflictException({
          message: 'Only a school paused for having no students can be revived',
          details: { code: 'NOT_IDLE' },
        });
      }

      await manager.query(
        `UPDATE schools
            SET status = 'ACTIVE', status_reason = NULL, status_changed_at = $2, deleted_at = NULL
          WHERE id = $1`,
        [schoolId, now],
      );
      await this.auditService.record(
        {
          action: AuditAction.REACTIVATE,
          entity_type: 'School',
          entity_id: schoolId,
          tenant_id: schoolId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: {
            status: row.status,
            reason: row.status_reason,
            deleted_at: row.deleted_at,
          },
          new_values: { status: 'ACTIVE', reason: dto.reason, event: 'IDLE_REVIVED' },
        },
        manager,
      );
      return {
        changed: true,
        response: {
          id: schoolId,
          status: 'ACTIVE' as const,
          status_reason: null,
          status_changed_at: now,
        },
      };
    });

    if (changed) {
      await this.tenantStatus.invalidate(schoolId);
      emitRecheck(attentionEvents, {
        tenantId: schoolId,
        ruleKey: 'account.idle',
        actorUserId: userId,
      });
    }
    return response;
  }
}
