import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { AuditAction, AuthTokenPurpose, CommunicationStatus, UserRole } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { User } from '../users/entities/user.entity';
import {
  ACCEPTED_STATUSES,
  CommunicationLog,
} from '../communications/entities/communication-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { AuthTokenService } from './auth-token.service';
import { pickChannel } from './account-access-delivery.service';
import { guardianLinkedElsewhere } from './school-invite.service';
import { findVerifiedAccount } from '../users/users.service';
import { INVITATION_BATCH_QUEUE, MAX_BATCH_INVITE_SELECTION } from './invitation-batch.constants';
import type {
  InviteBatchStatusResponseDto,
  InviteDispatchResponseDto,
  InvitePreviewResponseDto,
  InviteSkipReason,
  InviteSkippedEntryDto,
} from './dto/batch-invite.dto';

export interface BatchInviteSelection {
  guardian_ids?: string[];
  student_ids?: string[];
  all?: boolean;
  /** Only with `all`: continue after this guardian id. */
  after?: string;
}

export interface InvitationBatchJobData {
  tenantId: string;
  guardianId: string;
  actorUserId: string;
  batchId: string;
  /** False for join-request entries: left out of the batch total, so never counted as skips. */
  counted?: boolean;
}

/**
 * Preview-first batch provisioning of passwordless `PARENT` accounts for
 * guardians (12.6). Batch identity is a `batch_id` UUID written into
 * `communication_logs.metadata.batch_id` / `auth_tokens.metadata.batch_id`
 * — not a `ReminderBatch`-shaped entity — per the plan's corrections.
 */
@Injectable()
export class GuardianProvisioningService {
  constructor(
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly authTokens: AuthTokenService,
    private readonly audit: AuditService,
    @InjectQueue(INVITATION_BATCH_QUEUE)
    private readonly queue: Queue<InvitationBatchJobData>,
  ) {}

  private async resolveGuardians(
    tenantId: string,
    selection: BatchInviteSelection,
  ): Promise<{ guardians: Guardian[]; nextAfter: string | null }> {
    if (selection.after && !selection.all) {
      throw new BadRequestException('after can only be used with all');
    }
    const selectors = [selection.guardian_ids, selection.student_ids, selection.all].filter(
      (s) => s !== undefined && s !== null && s !== false,
    );
    if (selectors.length !== 1) {
      throw new BadRequestException(
        'Exactly one of guardian_ids, student_ids, all must be supplied',
      );
    }

    const qb = this.guardianRepo
      .createQueryBuilder('guardian')
      .where('guardian.tenant_id = :tenantId', { tenantId })
      .andWhere('guardian.deleted_at IS NULL');

    if (selection.guardian_ids) {
      if (selection.guardian_ids.length === 0) return { guardians: [], nextAfter: null };
      qb.andWhere('guardian.id IN (:...guardianIds)', { guardianIds: selection.guardian_ids });
    } else if (selection.student_ids) {
      if (selection.student_ids.length === 0) return { guardians: [], nextAfter: null };
      qb.innerJoin('student_guardians', 'sg', 'sg.guardian_id = guardian.id').andWhere(
        'sg.student_id IN (:...studentIds)',
        { studentIds: selection.student_ids },
      );
    } else {
      // `all`: keyset-page by id, MAX at a time; `after` continues the previous slice.
      qb.orderBy('guardian.id', 'ASC');
      if (selection.after) qb.andWhere('guardian.id > :after', { after: selection.after });
    }

    // Cross-tenant ids in the selection are simply excluded by the
    // tenant_id predicate above, never a 500. `take` caps the row count the
    // query itself returns so an oversized `all` selection can't force a
    // full-table materialization before the size check below rejects it.
    const guardians = await qb
      .distinct(true)
      .take(MAX_BATCH_INVITE_SELECTION + 1)
      .getMany();
    if (guardians.length > MAX_BATCH_INVITE_SELECTION) {
      if (!selection.all) {
        throw new BadRequestException(
          `A batch cannot exceed ${MAX_BATCH_INVITE_SELECTION} guardians`,
        );
      }
      const page = guardians.slice(0, MAX_BATCH_INVITE_SELECTION);
      return { guardians: page, nextAfter: page[page.length - 1].id };
    }
    return { guardians, nextAfter: null };
  }

  /** Resolves whether a guardian is linked to an existing account and its lifecycle state. */
  private async classify(
    guardian: Guardian,
    tenantId: string,
  ): Promise<
    | { kind: 'skip'; reason: InviteSkipReason }
    | { kind: 'invite'; user: User | null; channel: 'SMS' | 'EMAIL'; join_request: boolean }
  > {
    if (guardian.notifications_enabled === false) {
      return { kind: 'skip', reason: 'notifications_disabled' };
    }

    const channel = pickChannel(guardian);
    if (!channel) {
      return { kind: 'skip', reason: 'no_contact' };
    }

    let user: User | null = null;
    if (guardian.user_id) {
      user = await this.userRepo.findOne({ where: { id: guardian.user_id } });
    }
    if (!user) {
      // Verified contacts only, one account only (an email and a phone of two people match none).
      user = await findVerifiedAccount(this.userRepo.manager, guardian.email, guardian.phone);
      if (!user) {
        // `withDeleted`: the unique index on email/phone ignores soft-deletion, so a deleted
        // account still owns the contact and the processor's insert would hit 23505.
        const holder = await this.userRepo
          .createQueryBuilder('u')
          .withDeleted()
          .where('(u.email = :email OR u.phone = :phone)', {
            email: guardian.email ?? '__none__',
            phone: guardian.phone ?? '__none__',
          })
          .getOne();
        if (holder) return { kind: 'skip', reason: 'contact_in_use' };
      }
    }

    // The processor files a join request (no invite, no log row) for a password holder, and
    // for an account with no membership row here at all; everyone else gets the INVITE.
    let joinRequest = false;
    if (user) {
      const m = this.userRepo.manager;
      // Same rule the processor applies: this account can never be linked here.
      if (await guardianLinkedElsewhere(m, user.id, guardian.id, tenantId)) {
        return { kind: 'skip', reason: 'contact_in_use' };
      }
      // Active only with a LIVE PARENT row here: that is what family access needs. A
      // link alone, a former row or another role here is still invitable; the
      // processor revives or adds the row for a passwordless account (the INVITE
      // tells them), and files a join request for everyone else.
      if (
        user.password_hash &&
        (await m.exists(UserTenant, {
          where: { user_id: user.id, tenant_id: tenantId, role: UserRole.PARENT },
        }))
      ) {
        return { kind: 'skip', reason: 'already_active' };
      }
      // A live invite, or a live PARENT join request the owner has not answered
      // yet (a pending request for another role does not cover family access).
      const pending = [
        await this.authTokens.latest(user.id, AuthTokenPurpose.INVITE, tenantId),
        await this.authTokens.latest(
          user.id,
          AuthTokenPurpose.JOIN_SCHOOL,
          tenantId,
          UserRole.PARENT,
        ),
      ];
      if (pending.some((t) => t && !t.consumed_at && !t.revoked_at && t.expires_at > new Date())) {
        return { kind: 'skip', reason: 'already_pending' };
      }
      joinRequest =
        !!user.password_hash ||
        !(await m.exists(UserTenant, {
          where: { user_id: user.id, tenant_id: tenantId },
          withDeleted: true,
        }));
    }

    return { kind: 'invite', user, channel: channel.medium, join_request: joinRequest };
  }

  async preview(
    tenantId: string,
    selection: BatchInviteSelection,
  ): Promise<InvitePreviewResponseDto> {
    const { guardians, nextAfter } = await this.resolveGuardians(tenantId, selection);

    const to_invite: InvitePreviewResponseDto['to_invite'] = [];
    const skipped: InviteSkippedEntryDto[] = [];
    // Contacts a new account in this batch will take. A second guardian with the same email or
    // phone would hit the processor's 23505 and send nothing, so the batch would never drain.
    const claimed = new Set<string>();

    for (const guardian of guardians) {
      let result = await this.classify(guardian, tenantId);
      if (result.kind === 'invite' && result.user === null) {
        const contacts = [guardian.email, guardian.phone].filter((c): c is string => !!c);
        if (contacts.some((c) => claimed.has(c))) {
          result = { kind: 'skip', reason: 'contact_in_use' };
        } else {
          contacts.forEach((c) => claimed.add(c));
        }
      }
      if (result.kind === 'skip') {
        skipped.push({
          guardian_id: guardian.id,
          full_name: guardian.full_name,
          reason: result.reason,
        });
      } else {
        to_invite.push({
          guardian_id: guardian.id,
          full_name: guardian.full_name,
          channel: result.channel,
          user_exists: result.user != null,
          join_request: result.join_request,
        });
      }
    }

    return { total: guardians.length, next_after: nextAfter, to_invite, skipped };
  }

  async dispatch(input: {
    tenantId: string;
    actorUserId: string;
    selection: BatchInviteSelection;
  }): Promise<InviteDispatchResponseDto> {
    // `next_after` comes from the slice dispatched here, not an earlier preview, so a guardian
    // added or removed in between is neither skipped nor invited twice by the next slice.
    const { to_invite, skipped, next_after } = await this.preview(input.tenantId, input.selection);
    const batchId = randomUUID();
    // Join requests are filed by the processor too, but write no log row, so batchStatus
    // could never count them as sent: only real invites are the batch's `queued` total.
    const invites = to_invite.filter((e) => !e.join_request).length;

    for (const entry of to_invite) {
      await this.queue.add(
        'invite-guardian',
        {
          tenantId: input.tenantId,
          guardianId: entry.guardian_id,
          actorUserId: input.actorUserId,
          batchId,
          counted: !entry.join_request,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    }

    await this.audit.record({
      action: AuditAction.INVITATION_SENT,
      entity_type: 'InvitationBatch',
      entity_id: batchId,
      tenant_id: input.tenantId,
      performed_by_user_id: input.actorUserId,
      new_values: {
        batch_id: batchId,
        queued: invites,
        requested: to_invite.length - invites,
        skipped: skipped.length,
      },
    });

    return { batch_id: batchId, queued: invites, next_after, skipped };
  }

  async batchStatus(tenantId: string, batchId: string): Promise<InviteBatchStatusResponseDto> {
    const auditRow = await this.auditLogRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.entity_type = :entityType', { entityType: 'InvitationBatch' })
      .andWhere('a.action = :sent', { sent: AuditAction.INVITATION_SENT })
      .andWhere("a.new_values->>'batch_id' = :batchId", { batchId })
      .getOne();

    const total = (auditRow?.new_values?.queued as number | undefined) ?? 0;

    const skipRow = await this.auditLogRepo
      .createQueryBuilder('a')
      .select("COUNT(DISTINCT a.new_values->>'guardian_id')", 'count')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.entity_type = :entityType', { entityType: 'InvitationBatch' })
      .andWhere('a.action = :update', { update: AuditAction.UPDATE })
      .andWhere("a.new_values->>'batch_id' = :batchId", { batchId })
      .getRawOne<{ count: string }>();
    const skipped = Number(skipRow?.count ?? 0);

    const rows = await this.logRepo
      .createQueryBuilder('log')
      .select('log.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere("log.metadata->>'batch_id' = :batchId", { batchId })
      .groupBy('log.status')
      .getRawMany<{ status: CommunicationStatus; count: string }>();

    const byStatus = new Map<string, number>(rows.map((r) => [r.status, Number(r.count)]));
    // DELIVERED / READ (written later by Check status) were sent too, or the invite stays queued.
    const sent = ACCEPTED_STATUSES.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0);
    const failed = byStatus.get(CommunicationStatus.FAILED) ?? 0;
    const queued = Math.max(total - sent - failed - skipped, 0);

    return { batch_id: batchId, total, sent, failed, queued, skipped };
  }
}
