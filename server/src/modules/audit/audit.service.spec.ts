import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';

function fakeRepo() {
  return {
    create: vi.fn((v) => v),
    save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
  };
}

describe('AuditService', () => {
  describe('record without a manager (non-transactional, fail-open)', () => {
    it('saves via its own repository', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.record({
        action: AuditAction.LOGIN,
        entity_type: 'User',
        entity_id: 'user-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.LOGIN,
          entity_id: 'user-1',
          tenant_id: 'tenant-1',
        }),
      );
    });

    it('redacts old_values/new_values before saving', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.record({
        action: AuditAction.FEE_STRUCTURE_CHANGE,
        entity_type: 'FeeStructure',
        entity_id: 'fs-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
        old_values: { amount: 100 },
        new_values: { amount: 200, token: 'abc' },
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          old_values: { amount: 100 },
          new_values: { amount: 200, token: '[REDACTED]' },
        }),
      );
    });

    // Ancillary write to an action that's already succeeded (or already
    // decided to fail for its own reasons) — a DB hiccup here must not
    // turn that outcome into a 500. Matches auth.service.ts's pre-existing
    // writeAuditLog behavior, now centralized here.
    it('swallows a save failure rather than throwing', async () => {
      const repo = fakeRepo();
      repo.save.mockRejectedValue(new Error('db unavailable'));
      const service = new AuditService(repo as any);

      await expect(
        service.record({
          action: AuditAction.LOGIN_FAILED,
          entity_type: 'User',
          entity_id: null,
          tenant_id: null,
          performed_by_user_id: null,
        }),
      ).resolves.toBeUndefined();
    });

    // Redaction must run inside the same try as the save — otherwise a
    // malformed snapshot bypasses the fail-open guard entirely and rejects
    // before ever reaching it.
    it('swallows a redaction failure rather than throwing', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);
      const poisoned: Record<string, unknown> = {};
      Object.defineProperty(poisoned, 'field', {
        enumerable: true,
        get() {
          throw new Error('boom');
        },
      });

      await expect(
        service.record({
          action: AuditAction.LOGIN_FAILED,
          entity_type: 'User',
          entity_id: null,
          tenant_id: null,
          performed_by_user_id: null,
          new_values: poisoned,
        }),
      ).resolves.toBeUndefined();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('record with a manager (transactional)', () => {
    it('saves via the manager-scoped repository, not its own', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await service.record(
        {
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: 'Payment',
          entity_id: 'pay-1',
          tenant_id: 'tenant-1',
          performed_by_user_id: 'user-1',
        },
        manager as any,
      );

      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    // The opposite of the non-transactional case: a payment/invoice audit
    // write is part of the record of truth for that transaction, so a
    // failure here must roll back with it, not be silently swallowed.
    it('propagates a save failure so the caller transaction rolls back', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      managerRepo.save.mockRejectedValue(new Error('db unavailable'));
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await expect(
        service.record(
          {
            action: AuditAction.PAYMENT_RECEIVED,
            entity_type: 'Payment',
            entity_id: 'pay-1',
            tenant_id: 'tenant-1',
            performed_by_user_id: 'user-1',
          },
          manager as any,
        ),
      ).rejects.toThrow('db unavailable');
    });
  });

  describe('findAll', () => {
    it('scopes the query to the given tenant and applies filters', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[{ id: 'log-1' }], 1]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      const result = await service.findAll(
        { action: AuditAction.LOGIN, entity_type: 'User', page: 2, limit: 5 } as any,
        'tenant-1',
      );

      expect(qb.where).toHaveBeenCalledWith('audit_log.tenant_id = :tenantId', {
        tenantId: 'tenant-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.action = :action', {
        action: AuditAction.LOGIN,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.entity_type = :entityType', {
        entityType: 'User',
      });
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        data: [{ id: 'log-1' }],
        total: 1,
        page: 2,
        limit: 5,
        totalPages: 1,
        entityLabels: expect.any(Map),
      });
    });

    // [8.11.8] Login History tab: scope the tenant-wide trail to one user.
    it('filters by performed_by_user_id when given', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findAll({ performed_by_user_id: 'user-9' } as any, 'tenant-1');

      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.performed_by_user_id = :performedBy', {
        performedBy: 'user-9',
      });
    });

    it('does not add the performed-by clause when the filter is absent', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findAll({} as any, 'tenant-1');

      const call = qb.andWhere.mock.calls.find(
        (c: any[]) => c[0] === 'audit_log.performed_by_user_id = :performedBy',
      );
      expect(call).toBeUndefined();
    });

    // [8.11.10]'s audit-trail screen renders a "Who" column, so the
    // acting user's name has to come back with the row — a bare
    // `performed_by_user_id` UUID is not something an administrator can
    // read. Only `id` and `full_name` are selected: the rest of the User
    // row (email, phone, password hash) has no business in a list
    // response.
    it('joins the acting user and selects only their id and name', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findAll({} as any, 'tenant-1');

      expect(qb.leftJoin).toHaveBeenCalledWith('audit_log.performed_by', 'performed_by');
      expect(qb.addSelect).toHaveBeenCalledWith(['performed_by.id', 'performed_by.full_name']);
      // Without `withDeleted`, TypeORM adds `performed_by.deleted_at IS
      // NULL` to the join and a soft-deleted administrator's actions come
      // back nameless — attributed to "System" by the client. An audit
      // trail that forgets who acted the moment they leave is worthless.
      // The *order* is the assertion: TypeORM reads the flag when
      // `leftJoin` runs, so calling `withDeleted()` afterwards is a no-op
      // that looks correct. `audit.service.integration.spec.ts` proves the
      // resulting SQL; this pins the call order that produces it.
      expect(qb.withDeleted.mock.invocationCallOrder[0]).toBeLessThan(
        qb.leftJoin.mock.invocationCallOrder[0],
      );
    });

    // A date-only to_date must include the entire day — otherwise Postgres
    // casts it to that day's midnight and every row from the day itself
    // (an inclusive range end, per the field's own meaning) is excluded.
    it('extends a date-only to_date to the end of that day', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findAll({ to_date: '2026-01-31' } as any, 'tenant-1');

      const call = qb.andWhere.mock.calls.find(
        (c: any[]) => c[0] === 'audit_log.created_at <= :toDate',
      );
      expect(call[1].toDate.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    });

    it('leaves a to_date that already carries a time untouched', async () => {
      const qb: any = {
        leftJoin: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        withDeleted: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findAll({ to_date: '2026-01-31T10:00:00.000Z' } as any, 'tenant-1');

      const call = qb.andWhere.mock.calls.find(
        (c: any[]) => c[0] === 'audit_log.created_at <= :toDate',
      );
      expect(call[1].toDate.toISOString()).toBe('2026-01-31T10:00:00.000Z');
    });
  });

  describe('findByEntity', () => {
    // [8.10.2]'s Activity tab — scoped to one entity, not the tenant's
    // whole audit trail `findAll` returns.
    it('scopes the query to the tenant and the given entity', async () => {
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[{ id: 'log-1' }], 1]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      const result = await service.findByEntity(
        'Student',
        'student-1',
        { page: 1, limit: 10 } as any,
        'tenant-1',
      );

      expect(qb.where).toHaveBeenCalledWith('audit_log.tenant_id = :tenantId', {
        tenantId: 'tenant-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.entity_type = :entityType', {
        entityType: 'Student',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.entity_id = :entityId', {
        entityId: 'student-1',
      });
      expect(result).toEqual({
        data: [{ id: 'log-1' }],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('still applies the action/date filters on top of the entity scope', async () => {
      const qb: any = {
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        addOrderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      };
      const repo = { createQueryBuilder: vi.fn(() => qb) };
      const service = new AuditService(repo as any);

      await service.findByEntity(
        'Student',
        'student-1',
        { action: AuditAction.UPDATE } as any,
        'tenant-1',
      );

      expect(qb.andWhere).toHaveBeenCalledWith('audit_log.action = :action', {
        action: AuditAction.UPDATE,
      });
    });
  });

  describe('recordApproved', () => {
    it('merges approved_by_user_id and approval_scope into new_values', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.recordApproved({
        action: AuditAction.PAYMENT_RECEIVED,
        entity_type: 'Payment',
        entity_id: 'pay-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
        new_values: { amount: 500 },
        approved_by_user_id: 'approver-1',
        approval_scope: ApprovalScope.PAYMENTS_REVERSE,
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: {
            amount: 500,
            approved_by_user_id: 'approver-1',
            approval_scope: ApprovalScope.PAYMENTS_REVERSE,
          },
        }),
      );
    });

    it('works with no pre-existing new_values', async () => {
      const repo = fakeRepo();
      const service = new AuditService(repo as any);

      await service.recordApproved({
        action: AuditAction.FEE_STRUCTURE_CHANGE,
        entity_type: 'FeeStructure',
        entity_id: 'fs-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
        approved_by_user_id: 'approver-1',
        approval_scope: ApprovalScope.FEES_EDIT_PAID,
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          new_values: {
            approved_by_user_id: 'approver-1',
            approval_scope: ApprovalScope.FEES_EDIT_PAID,
          },
        }),
      );
    });

    it('passes a manager through to the transactional write path', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await service.recordApproved(
        {
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: 'Payment',
          entity_id: 'pay-1',
          tenant_id: 'tenant-1',
          performed_by_user_id: 'user-1',
          approved_by_user_id: 'approver-1',
          approval_scope: ApprovalScope.PAYMENTS_REVERSE,
        },
        manager as any,
      );

      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    // Unlike `record`, this must NOT fail open even without a manager —
    // the row it writes is the proof a human approved a money-affecting
    // change, so a DB error here has to reach the caller, not be logged
    // and swallowed.
    it('propagates a save failure instead of swallowing it, even without a manager', async () => {
      const repo = fakeRepo();
      repo.save.mockRejectedValue(new Error('db unavailable'));
      const service = new AuditService(repo as any);

      await expect(
        service.recordApproved({
          action: AuditAction.PAYMENT_RECEIVED,
          entity_type: 'Payment',
          entity_id: 'pay-1',
          tenant_id: 'tenant-1',
          performed_by_user_id: 'user-1',
          approved_by_user_id: 'approver-1',
          approval_scope: ApprovalScope.PAYMENTS_REVERSE,
        }),
      ).rejects.toThrow('db unavailable');
    });

    it('propagates a save failure through the transactional path too', async () => {
      const repo = fakeRepo();
      const managerRepo = fakeRepo();
      managerRepo.save.mockRejectedValue(new Error('db unavailable'));
      const manager = { getRepository: vi.fn(() => managerRepo) };
      const service = new AuditService(repo as any);

      await expect(
        service.recordApproved(
          {
            action: AuditAction.PAYMENT_RECEIVED,
            entity_type: 'Payment',
            entity_id: 'pay-1',
            tenant_id: 'tenant-1',
            performed_by_user_id: 'user-1',
            approved_by_user_id: 'approver-1',
            approval_scope: ApprovalScope.PAYMENTS_REVERSE,
          },
          manager as any,
        ),
      ).rejects.toThrow('db unavailable');
    });
  });
});
