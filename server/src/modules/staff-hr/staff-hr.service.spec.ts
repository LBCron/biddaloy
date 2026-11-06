import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StaffHrService } from './staff-hr.service';
import { StaffHrRecord } from './entities/staff-hr-record.entity';
import { StaffDesignationHistory } from './entities/staff-designation-history.entity';
import { Designation } from './entities/designation.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { StaffEmploymentStatus } from '@biddaloy/shared';

/**
 * Unit tests for [23.2.1]'s `StaffHrService`: `promote()`'s atomic
 * close-then-insert, `getCurrentDesignation`, and tenant isolation.
 */

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const USER_ID = 'user-1';

function historyRow(overrides: Partial<StaffDesignationHistory> = {}): StaffDesignationHistory {
  const base: Record<string, unknown> = {};
  base.id = 'hist-1';
  base.tenant_id = TENANT_A;
  base.user_id = USER_ID;
  base.designation_id = 'designation-1';
  base.effective_date = new Date('2026-01-01');
  base.end_date = null;
  base.status = StaffEmploymentStatus.REGULAR;
  base.resigned_at = null;
  base.notes = null;
  base.created_at = new Date();
  base.updated_at = new Date();
  Object.assign(base, overrides);
  return base as unknown as StaffDesignationHistory;
}

function createHistoryRepoStub(existing: StaffDesignationHistory[] = []) {
  const rows = [...existing];
  const repo: any = {
    findOne: vi.fn(async ({ where }: any) => {
      return (
        rows.find((r) => {
          if (where.id !== undefined && r.id !== where.id) return false;
          if (where.user_id !== undefined && r.user_id !== where.user_id) return false;
          if (where.tenant_id !== undefined && r.tenant_id !== where.tenant_id) return false;
          if (where.end_date !== undefined) {
            // IsNull() FindOperator — treat any object here as "IS NULL".
            const wantsNull = typeof where.end_date === 'object';
            if (wantsNull && r.end_date !== null) return false;
          }
          return true;
        }) ?? null
      );
    }),
    update: vi.fn(async (criteria: any, partial: any) => {
      const row = rows.find((r) => r.id === criteria.id);
      if (row) Object.assign(row, partial);
    }),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => {
      const created = { id: `hist-${rows.length + 1}`, ...v };
      rows.push(created);
      return created;
    }),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => repo })),
  };
  return { repo, rows };
}

// Every user/designation id used by the tests below is treated as
// belonging to TENANT_A unless a test overrides these stubs — so a test
// that wants to prove cross-tenant rejection passes an id/tenant that
// isn't in these sets.
function createUserTenantRepoStub(
  membershipsByTenant: Record<string, string[]> = { [TENANT_A]: [USER_ID] },
) {
  return {
    findOne: vi.fn(async ({ where }: any) => {
      const members = membershipsByTenant[where.tenant_id] ?? [];
      return members.includes(where.user_id) ? { id: 'membership-1', ...where } : null;
    }),
  };
}

function createDesignationRepoStub(designationsByTenant: Record<string, string[]>) {
  return {
    findOne: vi.fn(async ({ where }: any) => {
      const ids = designationsByTenant[where.tenant_id] ?? [];
      return ids.includes(where.id) ? { id: where.id, tenant_id: where.tenant_id } : null;
    }),
  };
}

async function buildService(
  existing: StaffDesignationHistory[] = [],
  options: {
    userTenantRepo?: ReturnType<typeof createUserTenantRepoStub>;
    designationRepo?: ReturnType<typeof createDesignationRepoStub>;
    staffProfiles?: Array<{ tenant_id: string; user_id: string; card_no: string | null }>;
  } = {},
) {
  const { repo: historyRepo, rows } = createHistoryRepoStub(existing);
  const hrRecordRepo: any = { find: vi.fn(), findOne: vi.fn(), create: vi.fn(), save: vi.fn() };
  const auditService: any = { record: vi.fn(async (..._args: unknown[]) => undefined) };
  const userTenantRepo = options.userTenantRepo ?? createUserTenantRepoStub();
  const designationRepo =
    options.designationRepo ??
    createDesignationRepoStub({
      [TENANT_A]: ['designation-1', 'old-designation', 'new-designation', 'first-designation'],
    });

  // Filters on tenant_id like the real query, so a dropped tenant filter
  // shows up as another tenant's card leaking through.
  const profiles = options.staffProfiles ?? [];
  const staffProfileRepo = {
    find: vi.fn(async ({ where }: any) =>
      profiles.filter(
        (p) =>
          (where.tenant_id === undefined || p.tenant_id === where.tenant_id) &&
          where.user_id.value.includes(p.user_id),
      ),
    ),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      StaffHrService,
      { provide: getRepositoryToken(StaffHrRecord), useValue: hrRecordRepo },
      { provide: getRepositoryToken(StaffDesignationHistory), useValue: historyRepo },
      { provide: getRepositoryToken(Designation), useValue: designationRepo },
      { provide: getRepositoryToken(UserTenant), useValue: userTenantRepo },
      { provide: getRepositoryToken(StaffProfile), useValue: staffProfileRepo },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(StaffHrService),
    historyRepo,
    rows,
    auditService,
    hrRecordRepo,
    userTenantRepo,
    designationRepo,
  };
}

describe('StaffHrService', () => {
  describe('getCurrentDesignation', () => {
    it('returns the open (end_date IS NULL) row', async () => {
      const open = historyRow({ id: 'open-1' });
      const { service } = await buildService([open]);

      const current = await service.getCurrentDesignation(USER_ID, TENANT_A);

      expect(current?.id).toBe('open-1');
    });

    it('returns null when there is no open row', async () => {
      const closed = historyRow({ id: 'closed-1', end_date: new Date('2025-01-01') });
      const { service } = await buildService([closed]);

      const current = await service.getCurrentDesignation(USER_ID, TENANT_A);

      expect(current).toBeNull();
    });

    it('never returns another tenant’s row (tenant isolation)', async () => {
      const otherTenantRow = historyRow({ id: 'open-b', tenant_id: TENANT_B });
      const { service } = await buildService([otherTenantRow]);

      const current = await service.getCurrentDesignation(USER_ID, TENANT_A);

      expect(current).toBeNull();
    });
  });

  describe('promote', () => {
    it('closes the current open row and inserts a new one, atomically', async () => {
      const open = historyRow({ id: 'open-1', designation_id: 'old-designation' });
      const { service, historyRepo, rows } = await buildService([open]);

      const result = await service.promote(
        USER_ID,
        TENANT_A,
        'new-designation',
        '2026-06-01',
        'admin-1',
      );

      // Runs inside one transaction.
      expect(historyRepo.manager.transaction).toHaveBeenCalledTimes(1);

      // Old row closed the day before the new effective_date (no overlap
      // day where both rows are "current"), never updated in place with a
      // new designation.
      const oldRow = rows.find((r) => r.id === 'open-1')!;
      expect(oldRow.end_date).toEqual(new Date('2026-05-31'));
      expect(oldRow.designation_id).toBe('old-designation');

      // New row inserted, open, pointing at the new designation.
      expect(result.designation_id).toBe('new-designation');
      expect(result.end_date).toBeNull();
      expect(result.status).toBe(StaffEmploymentStatus.REGULAR);
    });

    it('rejects an effectiveDate on or before the current row’s effective_date', async () => {
      const open = historyRow({ id: 'open-1', effective_date: new Date('2026-06-01') });
      const { service } = await buildService([open]);

      await expect(
        service.promote(USER_ID, TENANT_A, 'new-designation', '2026-03-01', 'admin-1'),
      ).rejects.toThrow("effective_date must be after the current designation's effective_date");
    });

    it('rejects an effectiveDate equal to the current row’s effective_date', async () => {
      const open = historyRow({ id: 'open-1', effective_date: new Date('2026-06-01') });
      const { service } = await buildService([open]);

      await expect(
        service.promote(USER_ID, TENANT_A, 'new-designation', '2026-06-01', 'admin-1'),
      ).rejects.toThrow("effective_date must be after the current designation's effective_date");
    });

    it('inserts a fresh row with no prior close when there is no current designation', async () => {
      const { service, rows } = await buildService([]);

      const result = await service.promote(
        USER_ID,
        TENANT_A,
        'first-designation',
        '2026-01-01',
        'admin-1',
      );

      expect(rows).toHaveLength(1);
      expect(result.designation_id).toBe('first-designation');
    });

    it('writes an audit record inside the same transaction', async () => {
      const { service, auditService } = await buildService([]);

      await service.promote(USER_ID, TENANT_A, 'designation-1', '2026-01-01', 'admin-1');

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const [entry, manager] = auditService.record.mock.calls[0];
      expect(entry.entity_type).toBe('StaffDesignationHistory');
      expect(entry.tenant_id).toBe(TENANT_A);
      expect(entry.performed_by_user_id).toBe('admin-1');
      expect(manager).toBeDefined();
    });

    it('never touches another tenant’s open row (tenant isolation)', async () => {
      const otherTenantOpen = historyRow({ id: 'open-b', tenant_id: TENANT_B });
      const { service, rows } = await buildService([otherTenantOpen]);

      await service.promote(USER_ID, TENANT_A, 'designation-1', '2026-01-01', 'admin-1');

      // Tenant B's row is untouched.
      const untouched = rows.find((r) => r.id === 'open-b')!;
      expect(untouched.end_date).toBeNull();
      // A separate row was created for tenant A.
      expect(rows.filter((r) => r.tenant_id === TENANT_A)).toHaveLength(1);
    });

    // MONEY-tier fix: designation_id/user_id are caller-supplied, and a
    // foreign key alone only checks the id exists somewhere — not that it
    // belongs to the caller's tenant.
    it('rejects a designation_id that belongs to a different tenant', async () => {
      const designationRepo = createDesignationRepoStub({
        [TENANT_B]: ['other-tenant-designation'],
      });
      const { service } = await buildService([], { designationRepo });

      await expect(
        service.promote(USER_ID, TENANT_A, 'other-tenant-designation', '2026-01-01', 'admin-1'),
      ).rejects.toThrow('Designation not found');
    });

    it('rejects a user_id with no membership in the caller tenant', async () => {
      const userTenantRepo = createUserTenantRepoStub({ [TENANT_B]: [USER_ID] });
      const { service } = await buildService([], { userTenantRepo });

      await expect(
        service.promote(USER_ID, TENANT_A, 'designation-1', '2026-01-01', 'admin-1'),
      ).rejects.toThrow('User is not a member of this tenant');
    });

    it('closes the prior row the day before the new effective_date, not the same day', async () => {
      const open = historyRow({ id: 'open-1' });
      const { service, rows } = await buildService([open]);

      await service.promote(USER_ID, TENANT_A, 'new-designation', '2026-06-01', 'admin-1');

      const oldRow = rows.find((r) => r.id === 'open-1')!;
      expect(oldRow.end_date).toEqual(new Date('2026-05-31'));
    });

    it('translates a unique-constraint violation into a ConflictException', async () => {
      const { service, historyRepo } = await buildService([]);
      historyRepo.manager.transaction = vi.fn(async () => {
        throw { code: '23505' };
      });

      await expect(
        service.promote(USER_ID, TENANT_A, 'designation-1', '2026-01-01', 'admin-1'),
      ).rejects.toThrow('Another promotion for this user is already in progress');
    });
  });

  describe('create', () => {
    it('rejects a user_id with no membership in the caller tenant', async () => {
      const userTenantRepo = createUserTenantRepoStub({ [TENANT_B]: [USER_ID] });
      const { service } = await buildService([], { userTenantRepo });

      await expect(
        service.create({ user_id: USER_ID } as any, TENANT_A, 'admin-1'),
      ).rejects.toThrow('User is not a member of this tenant');
    });

    it('translates a unique-constraint violation into a ConflictException', async () => {
      const { service, hrRecordRepo } = await buildService([]);
      hrRecordRepo.save = vi.fn(async () => {
        throw { code: '23505' };
      });

      await expect(
        service.create({ user_id: USER_ID } as any, TENANT_A, 'admin-1'),
      ).rejects.toThrow('A staff HR record already exists for this user');
    });
  });

  // [23.9] additions: `findAll`'s optional `user_id` filter and the
  // designation-history list the promotion timeline reads.
  describe('findAll', () => {
    it('passes the user_id filter through to the repo when given', async () => {
      const { service, hrRecordRepo } = await buildService([]);
      hrRecordRepo.find = vi.fn(async () => []);

      await service.findAll(TENANT_A, USER_ID);

      expect(hrRecordRepo.find).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_A, user_id: USER_ID },
      });
    });

    it('omits the user_id filter when not given', async () => {
      const { service, hrRecordRepo } = await buildService([]);
      hrRecordRepo.find = vi.fn(async () => []);

      await service.findAll(TENANT_A);

      expect(hrRecordRepo.find).toHaveBeenCalledWith({ where: { tenant_id: TENANT_A } });
    });
  });

  // [76.2.06] card_no is read from the linked staff_profiles row.
  describe('card_no on reads', () => {
    const record = () => ({ id: 'hr-1', tenant_id: TENANT_A, user_id: USER_ID }) as StaffHrRecord;

    it('returns the card number from the same-tenant staff profile', async () => {
      const { service, hrRecordRepo } = await buildService([], {
        staffProfiles: [{ tenant_id: TENANT_A, user_id: USER_ID, card_no: 'CARD-9' }],
      });
      hrRecordRepo.find = vi.fn(async () => [record()]);
      hrRecordRepo.findOne = vi.fn(async () => record());

      expect((await service.findAll(TENANT_A))[0].card_no).toBe('CARD-9');
      expect((await service.findOne('hr-1', TENANT_A)).card_no).toBe('CARD-9');
    });

    it('returns null (not a missing key) when the profile has no card or there is no profile', async () => {
      const { service, hrRecordRepo } = await buildService([], {
        staffProfiles: [{ tenant_id: TENANT_A, user_id: USER_ID, card_no: null }],
      });
      hrRecordRepo.find = vi.fn(async () => [
        record(),
        { ...record(), id: 'hr-2', user_id: 'no-profile' },
      ]);

      const rows = await service.findAll(TENANT_A);
      expect(rows.map((r) => r.card_no)).toEqual([null, null]);
    });

    it('never returns another tenant’s card for the same user (tenant isolation)', async () => {
      const { service, hrRecordRepo } = await buildService([], {
        staffProfiles: [{ tenant_id: TENANT_B, user_id: USER_ID, card_no: 'B-CARD' }],
      });
      hrRecordRepo.find = vi.fn(async () => [record()]);

      expect((await service.findAll(TENANT_A))[0].card_no).toBeNull();
    });

    it('skips the profile query when there are no records', async () => {
      const { service, hrRecordRepo } = await buildService([]);
      hrRecordRepo.find = vi.fn(async () => []);

      expect(await service.findAll(TENANT_A)).toEqual([]);
    });
  });

  describe('getDesignationHistory', () => {
    it('returns every row for the user, newest first', async () => {
      const older = historyRow({
        id: 'h-1',
        effective_date: new Date('2025-01-01'),
        end_date: new Date('2025-12-31'),
      });
      const current = historyRow({ id: 'h-2', effective_date: new Date('2026-01-01') });
      const { service, historyRepo } = await buildService([older, current]);
      historyRepo.find = vi.fn(async () => [current, older]);

      const rows = await service.getDesignationHistory(USER_ID, TENANT_A);

      expect(historyRepo.find).toHaveBeenCalledWith({
        where: { user_id: USER_ID, tenant_id: TENANT_A },
        order: { effective_date: 'DESC' },
      });
      expect(rows).toEqual([current, older]);
    });
  });
});
