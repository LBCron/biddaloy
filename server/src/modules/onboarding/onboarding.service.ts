import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AuditAction,
  EMPLOYEE_ROLES,
  UserRole,
  type OnboardingItemId,
  type OnboardingStatus,
} from '@biddaloy/shared';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { SchoolSite } from '../website/entities/school-site.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { SchoolsService } from '../schools/schools.service';
import { getSeatUsage } from '../schools/trial/seat-limit.service';
import { DAY_MS } from '../schools/trial/trial.constants';
import { AuditService } from '../audit/audit.service';
import { UpdateOnboardingDto } from './dto/onboarding.dto';
import { attentionEvents } from '../attention/attention.constants';
import { emitRecheck } from '../attention/engine/attention-events';

/**
 * [13.3.3] "How far is this school's setup?" Every checklist item is derived from real rows on
 * each call, never stored — so a class created outside the wizard still flips `structure`.
 * The only thing this service writes is `schools.onboarding`.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(tenantId: string, userId: string): Promise<OnboardingStatus> {
    const school = await this.dataSource.getRepository(School).findOne({ where: { id: tenantId } });
    if (!school) throw new NotFoundException('School not found');

    const m = this.dataSource.manager;
    const [classes, sections, students, feeStructures, staff, parents] = await Promise.all([
      m.count(Class, { where: { tenant_id: tenantId } }),
      m.count(ClassSection, { where: { tenant_id: tenantId } }),
      m.count(Student, { where: { tenant_id: tenantId } }),
      m.count(FeeStructure, { where: { tenant_id: tenantId } }),
      // Employees, each person once: COMMITTEE is not staff (D16), and ADMIN + TEACHER is one person.
      m
        .createQueryBuilder(UserTenant, 'ut')
        .select('COUNT(DISTINCT ut.user_id)', 'n')
        .where('ut.tenant_id = :tenantId AND ut.role IN (:...roles)', {
          tenantId,
          roles: EMPLOYEE_ROLES,
        })
        .getRawOne<{ n: string }>()
        .then((r) => Number(r?.n ?? 0)),
      m.count(UserTenant, { where: { tenant_id: tenantId, role: UserRole.PARENT } }),
    ]);

    const comms = (await this.schoolsService.getResolvedSettings(tenantId)).communications;
    const onboarding = school.onboarding ?? {};
    const done: Record<Exclude<OnboardingItemId, 'website'>, boolean> = {
      profile: !!(school.name_bn || school.logo_key),
      structure: classes >= 1,
      sections: sections >= 1,
      students: students >= 1,
      staff: staff >= 2,
      feeStructures: feeStructures >= 1,
      guardianInvites: parents >= 1,
      messageSettings: !!(comms?.sms || comms?.email),
    };

    let trial: OnboardingStatus['trial'] = null;
    if (school.trial_ends_at) {
      const seats = await getSeatUsage(m, tenantId);
      trial = {
        ends_at: school.trial_ends_at.toISOString(),
        days_left: Math.max(0, Math.ceil((school.trial_ends_at.getTime() - Date.now()) / DAY_MS)),
        // null = no student limit on this trial.
        seats: { used: seats.used, limit: seats.limit },
      };
    }

    const items: OnboardingStatus['items'] = (Object.keys(done) as (keyof typeof done)[]).map(
      (id) => ({ id, done: done[id] }),
    );
    // [40.2.05] Only a school that said yes to a website at setup gets the item; it is done once
    // the site is switched on.
    if (onboarding.wants_website === true) {
      const site = await m.findOne(SchoolSite, { where: { tenant_id: tenantId } });
      items.push({ id: 'website', done: site?.enabled === true });
    }

    return {
      finished_at: onboarding.finished_at ?? null,
      dismissed_at: onboarding.dismissed_at ?? null,
      seen: ((onboarding.seen_by as string[] | undefined) ?? []).includes(userId),
      setup_path: onboarding.setup_path ?? null,
      items,
      counts: { classes, sections, students, staff },
      trial,
      support_url: this.config.get<string>('SUPPORT_CONTACT_URL') ?? null,
    };
  }

  /** Writes only `schools.onboarding`; audited. Returns the fresh status. */
  async update(
    tenantId: string,
    userId: string,
    dto: UpdateOnboardingDto,
  ): Promise<OnboardingStatus> {
    // Row lock around read-modify-write: the trial job merges `trial_warnings` into the same
    // jsonb with its own UPDATE, which queues behind this lock, so no write is lost. Only the
    // keys this endpoint owns are changed; every other key is carried over untouched.
    const { before, next } = await this.dataSource.transaction(async (m) => {
      const rows: { onboarding: Record<string, any> | null }[] = await m.query(
        'SELECT onboarding FROM schools WHERE id = $1 FOR NO KEY UPDATE',
        [tenantId],
      );
      if (rows.length === 0) throw new NotFoundException('School not found');

      const before = rows[0].onboarding ?? {};
      const next: Record<string, any> = { ...before };
      const now = new Date().toISOString();

      if (dto.setup_path !== undefined) next.setup_path = dto.setup_path;
      if (dto.wants_website !== undefined) next.wants_website = dto.wants_website;
      if (dto.finished !== undefined) {
        next.finished_at = dto.finished ? (before.finished_at ?? now) : null;
      }
      if (dto.dismissed !== undefined) {
        next.dismissed_at = dto.dismissed ? (before.dismissed_at ?? now) : null;
      }
      if (dto.seen !== undefined) {
        const seenBy = new Set<string>(before.seen_by ?? []);
        if (dto.seen) seenBy.add(userId);
        else seenBy.delete(userId);
        next.seen_by = [...seenBy];
      }

      // Column-scoped update: nothing but `onboarding` can be written from here.
      await m.query('UPDATE schools SET onboarding = $2::jsonb WHERE id = $1', [
        tenantId,
        JSON.stringify(next),
      ]);
      return { before, next };
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      entity_type: 'School',
      entity_id: tenantId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: { onboarding: before },
      new_values: { onboarding: next },
    });
    emitRecheck(attentionEvents, { tenantId, ruleKey: 'setup.incomplete', actorUserId: userId });

    return this.getStatus(tenantId, userId);
  }
}
