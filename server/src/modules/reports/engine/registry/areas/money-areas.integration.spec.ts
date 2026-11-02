import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AggregateFn,
  FieldSensitivity,
  FilterOp,
  ReportFieldType,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import { startOfLocalDay, endOfLocalDay } from '../../../../../common/time';
import type { TeacherScopeService } from '../../../../classes/teacher-scope.service';
import { FeeDuesService } from '../../../../fees/fee-dues.service';
import { Payment } from '../../../../fees/entities/payment.entity';
import { StudentFee } from '../../../../fees/entities/student-fee.entity';
import { Student } from '../../../../students/entities/student.entity';
import { CollectionsReportService } from '../../../collections-report.service';
import { ReportCompiler } from '../../compiler/report-compiler';
import { RoleScopePolicy } from '../../security/role-scope.policy';
import { ReportRegistry } from '../registry';
import { ALL_AREAS } from './index';

/**
 * [8.15.21] The money areas against the real database, reconciled with the screens the school
 * already trusts: collections by method equal the collections report, and "still owed" equals the
 * dues list. A report that disagrees with those two would be worse than no report.
 */
describe('report areas: fees, payments, attendance (integration)', () => {
  let ds: DataSource;
  let fx: ReportAreaFixture;
  let tenantId: string;
  let year: string;
  let six: { classId: string; sectionId: string };
  let studentA: string;
  let studentB: string;

  const compiler = () =>
    new ReportCompiler(
      ds,
      new ReportRegistry(),
      new RoleScopePolicy({ sectionScope: async () => null } as unknown as TeacherScopeService),
    );

  const definition = (
    area: ReportSubjectArea,
    dataset: Partial<ReportDefinitionJson['dataset']>,
  ): ReportDefinitionJson => ({
    schema: 1,
    subjectArea: area,
    parameters: [],
    dataset: { dimensions: [], measures: [], filters: [], sort: [], ...dataset },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });

  const run = async (def: ReportDefinitionJson, role = UserRole.ADMIN) => {
    const compiled = await compiler().compile(def, {}, { tenantId, userId: 'u1', role }, 500);
    return compiled.query.getRawMany<Record<string, unknown>>();
  };

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tenantId = await fx.school();
    year = await fx.year(tenantId);
    six = await fx.klass(tenantId, year, 'Six', 6);
    studentA = await fx.student(tenantId, year, six, { name: 'A' });
    studentB = await fx.student(tenantId, year, six, { name: 'B' });
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  describe('fees', () => {
    beforeEach(async () => {
      await fx.bill(tenantId, year, six.classId, studentA, {
        total: 1000,
        paid: 1000,
        status: 'PAID',
        dueDate: '2026-03-01',
      });
      await fx.bill(tenantId, year, six.classId, studentA, {
        total: 1000,
        paid: 250,
        discount: 50,
        status: 'PARTIALLY_PAID',
        dueDate: '2026-04-01',
        period: '2026-04-01',
      });
      await fx.bill(tenantId, year, six.classId, studentB, {
        total: 800,
        status: 'OVERDUE',
        dueDate: '2026-02-01',
        period: '2026-02-01',
      });
      await fx.bill(tenantId, year, six.classId, studentB, {
        total: 500,
        discount: 500,
        status: 'WAIVED', // closed: not owed
        dueDate: '2026-05-01',
        period: '2026-06-01',
      });
    });

    it('"still owed" equals the total of the dues list', async () => {
      const [row] = await run(
        definition(ReportSubjectArea.FEES, {
          measures: [{ field: 'outstanding', fn: AggregateFn.SUM }],
        }),
      );
      const dues = new FeeDuesService(ds.getRepository(StudentFee), ds.getRepository(Student));
      const screen = await dues.getDues({}, tenantId);
      expect(Number(row.outstanding)).toBe(screen.total_due_sum);
      expect(Number(row.outstanding)).toBe(700 + 800); // (1000-250-50) + 800
    });

    it('charged and paid add up across all bills, open or closed', async () => {
      const [row] = await run(
        definition(ReportSubjectArea.FEES, {
          measures: [
            { field: 'billed', fn: AggregateFn.SUM },
            { field: 'paid', fn: AggregateFn.SUM },
            { field: 'bills', fn: AggregateFn.COUNT },
          ],
        }),
      );
      expect(Number(row.billed)).toBe(3300);
      expect(Number(row.paid)).toBe(1250);
      expect(Number(row.bills)).toBe(4);
    });

    it('splits what is owed into days-late buckets that add back to the total', async () => {
      const rows = await run(
        definition(ReportSubjectArea.FEES, {
          dimensions: [{ field: 'ageing' }],
          measures: [{ field: 'outstanding', fn: AggregateFn.SUM }],
        }),
      );
      const total = rows.reduce((sum, r) => sum + Number(r.outstanding), 0);
      expect(total).toBe(1500);
      // Closed bills (paid, waived) owe nothing, so their bucket is zero.
      expect(Number(rows.find((r) => r.ageing === 'CLOSED')?.outstanding)).toBe(0);
    });

    it('lists late bills per class with the guardian phone only for a role that may see it', async () => {
      await fx.guardian(tenantId, studentB, { name: 'Dad', phone: '01711111111', primary: true });
      const def = definition(ReportSubjectArea.FEES, {
        dimensions: [{ field: 'name' }, { field: 'guardian_phone' }],
        filters: [{ field: 'status', op: FilterOp.EQ, value: 'OVERDUE' }],
      });
      expect(await run(def, UserRole.ACCOUNTANT)).toEqual([
        { name: 'B', guardian_phone: '01711111111' },
      ]);
    });

    it('a school never sees another school’s bills', async () => {
      const other = await fx.school();
      const otherYear = await fx.year(other);
      const otherClass = await fx.klass(other, otherYear, 'Six', 6);
      const stranger = await fx.student(other, otherYear, otherClass);
      await fx.bill(other, otherYear, otherClass.classId, stranger, {
        total: 99999,
        status: 'PENDING',
        dueDate: '2026-01-01',
      });
      const [row] = await run(
        definition(ReportSubjectArea.FEES, {
          measures: [{ field: 'billed', fn: AggregateFn.SUM }],
        }),
      );
      expect(Number(row.billed)).toBe(3300);
    });
  });

  describe('payments', () => {
    const DAY = '2026-05-10';
    let cashReversal: string;

    beforeEach(async () => {
      await fx.payment(tenantId, studentA, { amount: 500, method: 'CASH', at: `${DAY}T05:00:00Z` });
      await fx.payment(tenantId, studentA, {
        amount: 300,
        method: 'BKASH',
        at: `${DAY}T06:00:00Z`,
      });
      const original = await fx.payment(tenantId, studentB, {
        amount: 200,
        method: 'CASH',
        at: `${DAY}T07:00:00Z`,
      });
      // A reversal is its own positive row that subtracts; its status is REFUNDED, like the real one.
      cashReversal = await fx.payment(tenantId, studentB, {
        amount: 200,
        method: 'CASH',
        at: `${DAY}T08:00:00Z`,
        status: 'REFUNDED',
        reversalOf: original,
      });
      await fx.markReversed(original, cashReversal);
      // Not money collected: left out by the collections report and by this area.
      await fx.payment(tenantId, studentA, {
        amount: 9999,
        method: 'CARD',
        at: `${DAY}T09:00:00Z`,
        status: 'FAILED',
      });
    });

    it('net by method for a day equals the collections report', async () => {
      const report = await new CollectionsReportService(
        ds.getRepository(Payment),
      ).getNetByMethodBetween(tenantId, startOfLocalDay(DAY), endOfLocalDay(DAY));
      const rows = await run(
        definition(ReportSubjectArea.PAYMENTS, {
          dimensions: [{ field: 'method' }],
          measures: [
            { field: 'net', fn: AggregateFn.SUM },
            { field: 'payments', fn: AggregateFn.COUNT },
          ],
          filters: [{ field: 'payment_date', op: FilterOp.EQ, value: DAY }],
        }),
      );
      const engine = Object.fromEntries(
        rows.map((r) => [r.method, [Number(r.net), Number(r.payments)]]),
      );
      const screen = Object.fromEntries(
        report.map((r) => [r.payment_method, [r.net, r.payment_count]]),
      );
      expect(engine).toEqual(screen);
      expect(engine).toEqual({ CASH: [500, 2], BKASH: [300, 1] }); // 500 + (200 - 200), 300
    });

    it('collected, reversed and net are three different totals that agree', async () => {
      const [row] = await run(
        definition(ReportSubjectArea.PAYMENTS, {
          measures: [
            { field: 'collected', fn: AggregateFn.SUM },
            { field: 'reversed', fn: AggregateFn.SUM },
            { field: 'net', fn: AggregateFn.SUM },
          ],
        }),
      );
      expect([Number(row.collected), Number(row.reversed), Number(row.net)]).toEqual([
        1000, 200, 800,
      ]);
    });

    it('reversals are left out only when the author filters them out, never silently', async () => {
      const [row] = await run(
        definition(ReportSubjectArea.PAYMENTS, {
          measures: [{ field: 'net', fn: AggregateFn.SUM }],
          filters: [{ field: 'is_reversal', op: FilterOp.EQ, value: false }],
        }),
      );
      expect(Number(row.net)).toBe(1000);
    });

    it('shows who collected a payment, which needs a financial permission', async () => {
      const def = definition(ReportSubjectArea.PAYMENTS, {
        dimensions: [{ field: 'method' }, { field: 'collector' }],
      });
      const compiled = await compiler().compile(
        def,
        {},
        { tenantId, userId: 'u1', role: UserRole.TEACHER },
        500,
      );
      expect(compiled.masked).toEqual(['collector']);
    });

    it('a school never sees another school’s payments', async () => {
      const other = await fx.school();
      const otherYear = await fx.year(other);
      const otherClass = await fx.klass(other, otherYear, 'Six', 6);
      const stranger = await fx.student(other, otherYear, otherClass);
      await fx.payment(other, stranger, { amount: 77777, method: 'CASH', at: `${DAY}T05:00:00Z` });
      const [row] = await run(
        definition(ReportSubjectArea.PAYMENTS, {
          measures: [{ field: 'collected', fn: AggregateFn.SUM }],
        }),
      );
      expect(Number(row.collected)).toBe(1000);
    });
  });

  describe('attendance', () => {
    it('present, absent and present % per class match a hand count (late counts as present)', async () => {
      const studentC = await fx.student(tenantId, year, six, { name: 'C' });
      await fx.attendance(tenantId, six.sectionId, '2026-05-10', [
        { studentId: studentA, status: 'PRESENT' },
        { studentId: studentB, status: 'ABSENT' },
        { studentId: studentC, status: 'LATE' },
      ]);
      await fx.attendance(tenantId, six.sectionId, '2026-05-11', [
        { studentId: studentA, status: 'PRESENT' },
        { studentId: studentB, status: 'LEAVE' },
        { studentId: studentC, status: 'ABSENT' },
      ]);

      const [row] = await run(
        definition(ReportSubjectArea.ATTENDANCE, {
          dimensions: [{ field: 'class' }],
          measures: [
            { field: 'records', fn: AggregateFn.COUNT },
            { field: 'present', fn: AggregateFn.COUNT },
            { field: 'absent', fn: AggregateFn.COUNT },
            { field: 'present_percent', fn: AggregateFn.AVG },
          ],
        }),
      );
      expect(row.class).toBe('Six');
      expect([Number(row.records), Number(row.present), Number(row.absent)]).toEqual([6, 3, 2]);
      expect(Number(row.present_percent)).toBeCloseTo(50, 5);
    });
  });

  it('every money field and money measure is FINANCIAL, in every area', () => {
    const problems: string[] = [];
    for (const area of ALL_AREAS) {
      for (const def of [...area.fields, ...area.measures]) {
        if (def.type === ReportFieldType.MONEY && def.sensitivity !== FieldSensitivity.FINANCIAL) {
          problems.push(`${area.key}.${def.key}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
