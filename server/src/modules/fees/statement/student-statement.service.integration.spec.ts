import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { AuditService } from '../../audit/audit.service';
import { ReportRun } from '../../reports/entities/report-run.entity';
import { ReportRunLogService } from '../../reports/export/report-run-log.service';
import { Student } from '../../students/entities/student.entity';
import { FeeDuesService } from '../fee-dues.service';
import { StudentFee } from '../entities/student-fee.entity';
import { StudentStatementService } from './student-statement.service';

/**
 * [8.15.35] One student's statement against the real database. Business rule proved here: the closing
 * balance of the whole history equals what the dues list says the student still owes, after a partial
 * payment, a one-off discount, a standing discount and a reversal.
 */
describe('StudentStatementService (integration)', () => {
  let ds: DataSource;
  let service: StudentStatementService;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let studentA: string;
  let year: string;
  let six: { classId: string; sectionId: string };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AuditService,
      ReportRunLogService,
      StudentStatementService,
    ]);
    ds = module.get(DataSource);
    service = module.get(StudentStatementService);
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantId = await fx.school();
    year = await fx.year(tenantId);
    six = await fx.klass(tenantId, year, 'Six', 6);
    studentA = await fx.student(tenantId, year, six, { name: 'Karim' });

    // Bill A: 1,000 with a 100 standing discount, 400 paid, then the 400 payment is taken back.
    const billA = await fx.bill(tenantId, year, six.classId, studentA, {
      total: 1000,
      discount: 100,
      paid: 0,
      status: 'PENDING',
      dueDate: '2026-03-01',
    });
    const p1 = await fx.payment(tenantId, studentA, {
      amount: 400,
      method: 'CASH',
      at: '2026-03-05T06:00:00Z',
    });
    await fx.allocate(p1, billA, 400);
    const reversal = await fx.payment(tenantId, studentA, {
      amount: 400,
      method: 'CASH',
      at: '2026-03-20T06:00:00Z',
      status: 'REFUNDED',
      reversalOf: p1,
    });
    await fx.allocate(reversal, billA, 400);
    await fx.markReversed(p1, reversal);

    // Bill B: 500, paid 450 and a 50 one-off discount at checkout: settled.
    const billB = await fx.bill(tenantId, year, six.classId, studentA, {
      total: 500,
      paid: 450,
      oneOffDiscount: 50,
      status: 'PAID',
      dueDate: '2026-03-10',
      period: '2026-03-01',
    });
    const p2 = await fx.payment(tenantId, studentA, {
      amount: 450,
      method: 'BKASH',
      at: '2026-03-12T06:00:00Z',
    });
    await fx.allocate(p2, billB, 450, 50);
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  it('the closing balance equals what the dues list says is still owed', async () => {
    const statement = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {});
    const dues = await new FeeDuesService(
      ds.getRepository(StudentFee),
      ds.getRepository(Student),
    ).getDues({}, tenantId);
    expect(statement.closing_balance).toBe(dues.total_due_sum);
    expect(statement.closing_balance).toBe(900); // bill A 1,000 - 100 discount, nothing kept paid
  });

  it('shows every line in date order with what is still owed after it', async () => {
    const { entries, opening_balance } = await service.getStatement(
      tenantId,
      SEED_ADMIN_USER_ID,
      studentA,
      {},
    );
    expect(opening_balance).toBe(0);
    expect(entries.map((e) => [e.date, e.kind, e.debit, e.credit, e.balance])).toEqual([
      ['2026-03-01', 'BILL', 1000, 0, 1000],
      ['2026-03-01', 'DISCOUNT', 0, 100, 900],
      ['2026-03-05', 'PAYMENT', 0, 400, 500],
      ['2026-03-10', 'BILL', 500, 0, 1000],
      ['2026-03-12', 'PAYMENT', 0, 450, 550],
      ['2026-03-12', 'DISCOUNT', 0, 50, 500],
      ['2026-03-20', 'REVERSAL', 400, 0, 900],
    ]);
  });

  it('a start date folds earlier lines into the opening balance without changing any balance', async () => {
    const s = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {
      from: '2026-03-10',
    });
    expect(s.opening_balance).toBe(500); // owed after the 5 March payment
    expect(s.entries[0]).toMatchObject({ date: '2026-03-10', kind: 'BILL', balance: 1000 });
    expect(s.closing_balance).toBe(900);
  });

  it('an end date stops the statement there', async () => {
    const s = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {
      to: '2026-03-12',
    });
    expect(s.entries.at(-1)?.date).toBe('2026-03-12');
    expect(s.closing_balance).toBe(500);
  });

  it('a range with no lines closes at the opening balance', async () => {
    const s = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {
      from: '2027-01-01',
    });
    expect(s.entries).toEqual([]);
    expect(s.opening_balance).toBe(900);
    expect(s.closing_balance).toBe(900);
  });

  it('keeps advance money beside the statement, never inside what is owed', async () => {
    await fx.wallet(tenantId, studentA, 120, [
      { amount: 200, kind: 'CREDIT_OVERPAYMENT', note: 'Extra' },
      { amount: -80, kind: 'DEBIT_CHECKOUT' },
    ]);
    const s = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {});
    expect(s.wallet_balance).toBe(120);
    expect(s.wallet_moves.map((m) => [m.kind, m.amount])).toEqual([
      ['CREDIT_OVERPAYMENT', 200],
      ['DEBIT_CHECKOUT', -80],
    ]);
    expect(s.closing_balance).toBe(900);
  });

  it("never mixes in another student's or another school's lines", async () => {
    const other = await fx.student(tenantId, year, six, { name: 'Other' });
    await fx.bill(tenantId, year, six.classId, other, {
      total: 7777,
      status: 'PENDING',
      dueDate: '2026-03-02',
    });
    const foreign = await fx.school();
    const foreignYear = await fx.year(foreign);
    const foreignClass = await fx.klass(foreign, foreignYear, 'Six', 6);
    const stranger = await fx.student(foreign, foreignYear, foreignClass);
    await fx.bill(foreign, foreignYear, foreignClass.classId, stranger, {
      total: 8888,
      status: 'PENDING',
      dueDate: '2026-03-02',
    });

    const s = await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, {});
    expect(s.closing_balance).toBe(900);
    await expect(service.getStatement(tenantId, SEED_ADMIN_USER_ID, stranger, {})).rejects.toThrow(
      'Student not found',
    );
  });

  it('records the run, with no definition, and no row data', async () => {
    await service.getStatement(tenantId, SEED_ADMIN_USER_ID, studentA, { from: '2026-03-01' });
    const run = await ds
      .getRepository(ReportRun)
      .findOneByOrFail({ tenant_id: tenantId, source_key: 'student-statement' });
    expect(run).toMatchObject({
      kind: ReportRunKind.RUN,
      status: ReportRunStatus.DONE,
      definition_version_id: null,
      row_count: 7,
    });
    expect(run.params).toEqual({ student_id: studentA, from: '2026-03-01', to: null });
  });
});
