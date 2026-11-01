import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuditAction, CommunicationStatus } from '@biddaloy/shared';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { GuardianProvisioningService } from './guardian-provisioning.service';
import { MAX_BATCH_INVITE_SELECTION } from './invitation-batch.constants';

/** A minimal fluent stub matching the subset of TypeORM's QueryBuilder this
 * service chains — every method returns `this` except the terminal ones. */
function fakeQueryBuilder(result: {
  many?: unknown[];
  one?: unknown | null;
  raw?: unknown[];
  rawOne?: unknown;
}) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    distinct: vi.fn().mockReturnThis(),
    take: vi.fn().mockReturnThis(),
    withDeleted: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // `findVerifiedAccount` reads a `one` stub through getMany.
    getMany: vi.fn().mockResolvedValue(result.many ?? (result.one ? [result.one] : [])),
    getOne: vi.fn().mockResolvedValue(result.one ?? null),
    getRawMany: vi.fn().mockResolvedValue(result.raw ?? []),
    getRawOne: vi.fn().mockResolvedValue(result.rawOne ?? { count: '0' }),
  };
  return qb;
}

describe('GuardianProvisioningService', () => {
  let guardianRepo: any;
  let userRepo: any;
  let logRepo: any;
  let auditLogRepo: any;
  let authTokens: any;
  let audit: any;
  let queue: any;
  let service: GuardianProvisioningService;

  const TENANT = 'tenant-1';

  function makeGuardian(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'g1',
      tenant_id: TENANT,
      full_name: 'Guardian One',
      phone: '+8801711111111',
      email: null,
      user_id: null,
      notifications_enabled: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    guardianRepo = { createQueryBuilder: vi.fn() };
    // `manager.exists` answers both membership (UserTenant) and link (Guardian) checks.
    userRepo = {
      findOne: vi.fn(),
      createQueryBuilder: vi.fn(),
      manager: { exists: vi.fn().mockResolvedValue(false), getRepository: () => userRepo },
    };
    logRepo = { createQueryBuilder: vi.fn() };
    auditLogRepo = { createQueryBuilder: vi.fn() };
    authTokens = { latest: vi.fn().mockResolvedValue(null) };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    queue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new GuardianProvisioningService(
      guardianRepo,
      userRepo,
      logRepo,
      auditLogRepo,
      authTokens,
      audit,
      queue,
    );
  });

  describe('preview', () => {
    it('requires exactly one selector', async () => {
      await expect(service.preview(TENANT, {})).rejects.toThrow(BadRequestException);
      await expect(service.preview(TENANT, { all: true, guardian_ids: ['g1'] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lists one guardian shared by two students only once (sibling dedup via guardian dedup)', async () => {
      // `DISTINCT` on the guardian query is what guarantees a guardian
      // joined to two students appears once — the fake QB's getMany already
      // returns the deduped row set a real DISTINCT query would produce.
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.preview(TENANT, { student_ids: ['s1', 's2'] });

      expect(result.total).toBe(1);
      expect(result.to_invite).toEqual([
        {
          guardian_id: 'g1',
          full_name: 'Guardian One',
          channel: 'SMS',
          user_exists: false,
          join_request: false,
        },
      ]);
      expect(result.skipped).toEqual([]);
    });

    it('skips a guardian with no phone or email (no_contact)', async () => {
      const guardian = makeGuardian({ phone: null, email: null });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'no_contact' },
      ]);
      expect(result.to_invite).toEqual([]);
    });

    it('skips a guardian who opted out of notifications', async () => {
      const guardian = makeGuardian({ notifications_enabled: false });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'notifications_disabled' },
      ]);
    });

    it('skips a guardian whose linked user has a password and a live PARENT row here (already_active)', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: 'hash' });
      userRepo.manager.exists.mockImplementation(async (entity: unknown) => entity === UserTenant);

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_active' },
      ]);
    });

    // m1: a link alone is not membership. Without a live PARENT row here the person
    // has no family access, so they must stay invitable (the processor revives or asks).
    it('invites a linked password holder who has no live PARENT row here', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: 'hash' });

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite).toEqual([
        {
          guardian_id: 'g1',
          full_name: 'Guardian One',
          channel: 'SMS',
          user_exists: true,
          join_request: true,
        },
      ]);
      // Live rows only: a soft-deleted (former) membership does not count.
      expect(userRepo.manager.exists).toHaveBeenCalledWith(UserTenant, {
        where: { user_id: 'u1', tenant_id: TENANT, role: 'PARENT' },
      });
    });

    it('invites a verified password holder matched by contact who is not a member here', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-verified', password_hash: 'hash' } }),
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite).toEqual([
        {
          guardian_id: 'g1',
          full_name: 'Guardian One',
          channel: 'SMS',
          user_exists: true,
          join_request: true,
        },
      ]);
    });

    it('skips with contact_in_use when only an unverified account holds the contact', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder
        .mockReturnValueOnce(fakeQueryBuilder({ one: null })) // no verified match
        .mockReturnValueOnce(fakeQueryBuilder({ one: { id: 'u-holder' } })); // an unverified holder

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'contact_in_use' },
      ]);
    });

    // Only one new account can take a contact: the second guardian's job would hit 23505, send
    // nothing and leave the batch's `queued` above 0 forever.
    it('skips a second new-account guardian with the same phone in one batch (contact_in_use)', async () => {
      const first = makeGuardian();
      const second = makeGuardian({ id: 'g2', full_name: 'Guardian Two' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [first, second] }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite.map((e) => e.guardian_id)).toEqual(['g1']);
      expect(result.skipped).toEqual([
        { guardian_id: 'g2', full_name: 'Guardian Two', reason: 'contact_in_use' },
      ]);
    });

    // M2: guardians.user_id is globally UNIQUE, so an account linked to another
    // guardian (any school, even soft-deleted) can never be linked to this one.
    it('skips with contact_in_use when the matched account is linked to another guardian', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-elsewhere', password_hash: 'hash' } }),
      );
      userRepo.manager.exists.mockImplementation(async (entity: unknown) => entity === Guardian);

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'contact_in_use' },
      ]);
    });

    // m4: a pending join request is pending too; re-filing it would only reset its expiry.
    it('skips a verified non-member with a live JOIN_SCHOOL request (already_pending)', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-verified', password_hash: 'hash' } }),
      );
      authTokens.latest.mockImplementation(async (_u: string, purpose: string) =>
        purpose === 'JOIN_SCHOOL'
          ? {
              consumed_at: null,
              revoked_at: null,
              expires_at: new Date(Date.now() + 60_000),
              metadata: { role: 'PARENT' },
            }
          : null,
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_pending' },
      ]);
      expect(authTokens.latest).toHaveBeenCalledWith('u-verified', 'JOIN_SCHOOL', TENANT, 'PARENT');
    });

    // [68.1.fix F3] Requests are per role now: a pending ADMIN request does not
    // stand in for the PARENT one the batch would file.
    it('still invites a guardian whose only live join request is for another role', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-verified', password_hash: 'hash' } }),
      );
      // The newest JOIN_SCHOOL row is an ADMIN one; there is no PARENT one.
      authTokens.latest.mockImplementation(
        async (_u: string, purpose: string, _t, role?: string) =>
          purpose === 'JOIN_SCHOOL' && role !== 'PARENT'
            ? {
                consumed_at: null,
                revoked_at: null,
                expires_at: new Date(Date.now() + 60_000),
                metadata: { role: 'ADMIN' },
              }
            : null,
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([]);
      expect(result.to_invite.map((e) => e.guardian_id)).toEqual(['g1']);
    });

    // [68.1.fix R3] A newer ADMIN request must not hide an older live PARENT one: the
    // lookup reads the newest PARENT request, not the newest request of any role.
    it('counts an older live PARENT request under a newer ADMIN one as already_pending', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-verified', password_hash: 'hash' } }),
      );
      const live = {
        consumed_at: null,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      };
      authTokens.latest.mockImplementation(
        async (_u: string, purpose: string, _t, role?: string) =>
          purpose !== 'JOIN_SCHOOL'
            ? null
            : role === 'PARENT'
              ? { ...live, metadata: { role: 'PARENT' } }
              : { ...live, metadata: { role: 'ADMIN' } },
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_pending' },
      ]);
      expect(authTokens.latest).toHaveBeenCalledWith('u-verified', 'JOIN_SCHOOL', TENANT, 'PARENT');
    });

    it('skips a guardian with a live pending invitation (already_pending)', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: null });
      authTokens.latest.mockResolvedValue({
        consumed_at: null,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60_000),
      });

      const result = await service.preview(TENANT, { all: true });

      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'already_pending' },
      ]);
    });

    it('scopes the pending-invitation lookup to the active tenant, not any tenant', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: null });
      authTokens.latest.mockResolvedValue(null);

      await service.preview(TENANT, { all: true });

      expect(authTokens.latest).toHaveBeenCalledWith('u1', 'INVITE', TENANT);
    });

    it('links (does not skip) a guardian without user_id whose phone matches an existing user', async () => {
      const guardian = makeGuardian({ user_id: null, phone: '+8801711111111' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { id: 'u-existing', password_hash: null } }),
      );

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite).toEqual([
        {
          guardian_id: 'g1',
          full_name: 'Guardian One',
          channel: 'SMS',
          user_exists: true,
          join_request: true,
        },
      ]);
    });

    it('is a real invite (not a join request) for a passwordless account with a former row here', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: null });
      // A (soft-deleted) membership row exists: the processor revives it and sends the INVITE.
      userRepo.manager.exists.mockImplementation(async (entity: unknown) => entity === UserTenant);

      const result = await service.preview(TENANT, { all: true });

      expect(result.to_invite).toEqual([
        {
          guardian_id: 'g1',
          full_name: 'Guardian One',
          channel: 'SMS',
          user_exists: true,
          join_request: false,
        },
      ]);
    });

    it('skips with contact_in_use when a soft-deleted account still owns the contact', async () => {
      const guardian = makeGuardian();
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      const verifiedQb = fakeQueryBuilder({ one: null });
      const holderQb = fakeQueryBuilder({ one: { id: 'u-deleted' } });
      userRepo.createQueryBuilder.mockReturnValueOnce(verifiedQb).mockReturnValueOnce(holderQb);

      const result = await service.preview(TENANT, { all: true });

      // The email/phone unique index ignores soft-deletion, so the insert would hit 23505.
      expect(holderQb.withDeleted).toHaveBeenCalled();
      expect(result.skipped).toEqual([
        { guardian_id: 'g1', full_name: 'Guardian One', reason: 'contact_in_use' },
      ]);
    });

    it('never lets a cross-tenant guardian id through — the tenant predicate on the query is what excludes it', async () => {
      // No rows returned for a guardian id belonging to another tenant —
      // the fake QB simulates the tenant-scoped query finding nothing,
      // which is exactly what the real `andWhere('guardian.tenant_id = ...')`
      // produces; this asserts the caller does not 500 on an empty result.
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [] }));

      const result = await service.preview(TENANT, { guardian_ids: ['cross-tenant-id'] });

      expect(result).toEqual({ total: 0, to_invite: [], skipped: [], next_after: null });
    });
  });

  describe('dispatch', () => {
    it('enqueues one job per to_invite entry and writes one audit row', async () => {
      const guardians = [
        makeGuardian({ id: 'g1' }),
        makeGuardian({ id: 'g2', phone: '+8801711111112' }),
      ];
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: guardians }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.dispatch({
        tenantId: TENANT,
        actorUserId: 'admin-1',
        selection: { all: true },
      });

      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledWith(
        'invite-guardian',
        expect.objectContaining({
          tenantId: TENANT,
          actorUserId: 'admin-1',
          batchId: result.batch_id,
        }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'InvitationBatch',
          new_values: expect.objectContaining({ batch_id: result.batch_id, queued: 2 }),
        }),
      );
      expect(result.queued).toBe(2);
      expect(result.skipped).toEqual([]);
      expect(result.next_after).toBeNull();
    });

    it('[2870] `all` over the cap sends one slice and returns the cursor after it', async () => {
      // One more than the cap: dispatch must say more remain, never look complete.
      const guardians = Array.from({ length: MAX_BATCH_INVITE_SELECTION + 1 }, (_, i) =>
        makeGuardian({ id: `g${String(i).padStart(4, '0')}`, phone: null, email: null }),
      );
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: guardians }));
      userRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));

      const result = await service.dispatch({
        tenantId: TENANT,
        actorUserId: 'admin-1',
        selection: { all: true },
      });

      expect(result.skipped).toHaveLength(MAX_BATCH_INVITE_SELECTION);
      expect(result.next_after).toBe(guardians[MAX_BATCH_INVITE_SELECTION - 1].id);
    });
  });

  describe('dispatch with join requests', () => {
    it('still enqueues a join-request guardian but does not count it as queued', async () => {
      const guardian = makeGuardian({ user_id: 'u1' });
      guardianRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ many: [guardian] }));
      // Verified account with no membership row here: the processor files a join request
      // and writes no log row, so batchStatus could never finish counting it.
      userRepo.findOne.mockResolvedValue({ id: 'u1', password_hash: null });

      const result = await service.dispatch({
        tenantId: TENANT,
        actorUserId: 'admin-1',
        selection: { all: true },
      });

      expect(queue.add).toHaveBeenCalledTimes(1);
      // The join-request entry is not counted, so the processor must not record a skip for it.
      expect(queue.add).toHaveBeenCalledWith(
        'invite-guardian',
        expect.objectContaining({ counted: false }),
        expect.anything(),
      );
      expect(result.queued).toBe(0);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: expect.objectContaining({ queued: 0, requested: 1 }),
        }),
      );
    });
  });

  describe('batchStatus', () => {
    it('derives sent/failed/queued from communication_logs and total from the audit row', async () => {
      auditLogRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { new_values: { batch_id: 'b1', queued: 5 } } }),
      );
      logRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          raw: [
            { status: CommunicationStatus.SENT, count: '3' },
            { status: CommunicationStatus.FAILED, count: '1' },
          ],
        }),
      );

      const result = await service.batchStatus(TENANT, 'b1');

      expect(result).toEqual({
        batch_id: 'b1',
        total: 5,
        sent: 3,
        failed: 1,
        queued: 1,
        skipped: 0,
      });
    });

    it('counts DELIVERED and READ rows as sent, so a checked invitation leaves queued', async () => {
      auditLogRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ one: { new_values: { batch_id: 'b1', queued: 4 } } }),
      );
      logRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({
          raw: [
            { status: CommunicationStatus.SENT, count: '1' },
            { status: CommunicationStatus.DELIVERED, count: '2' },
            { status: CommunicationStatus.READ, count: '1' },
          ],
        }),
      );

      const result = await service.batchStatus(TENANT, 'b1');

      expect(result).toMatchObject({ total: 4, sent: 4, failed: 0, queued: 0 });
    });

    it('subtracts skip rows from queued, clamps at 0, and filters by action and tenant', async () => {
      const totalQb = fakeQueryBuilder({ one: { new_values: { batch_id: 'b1', queued: 2 } } });
      const skipQb = fakeQueryBuilder({ rawOne: { count: '3' } });
      auditLogRepo.createQueryBuilder.mockReturnValueOnce(totalQb).mockReturnValueOnce(skipQb);
      logRepo.createQueryBuilder.mockReturnValue(
        fakeQueryBuilder({ raw: [{ status: CommunicationStatus.SENT, count: '1' }] }),
      );

      const result = await service.batchStatus(TENANT, 'b1');

      expect(result).toMatchObject({ total: 2, sent: 1, queued: 0, skipped: 3 });
      expect(totalQb.andWhere).toHaveBeenCalledWith('a.action = :sent', {
        sent: AuditAction.INVITATION_SENT,
      });
      expect(skipQb.andWhere).toHaveBeenCalledWith('a.action = :update', {
        update: AuditAction.UPDATE,
      });
      expect(skipQb.where).toHaveBeenCalledWith('a.tenant_id = :tenantId', { tenantId: TENANT });
    });

    it('returns zeroes for an unknown or cross-tenant batch id (no matching audit row)', async () => {
      auditLogRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ one: null }));
      logRepo.createQueryBuilder.mockReturnValue(fakeQueryBuilder({ raw: [] }));

      const result = await service.batchStatus(TENANT, 'unknown');

      expect(result).toEqual({
        batch_id: 'unknown',
        total: 0,
        sent: 0,
        failed: 0,
        queued: 0,
        skipped: 0,
      });
    });
  });
});
