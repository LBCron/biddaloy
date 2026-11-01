import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportRunKind } from '@biddaloy/shared';
import { ReportRunLogService } from '../../reports/export/report-run-log.service';
import type {
  StatementEntryDto,
  StatementEntryKind,
  StudentStatementDto,
  WalletMoveDto,
} from './dto/student-statement.dto';

/**
 * The statement's lines, before the running balance. One row per bill, per standing discount, and per
 * allocation of a payment to a bill (a reversal is its own payment whose allocations mirror the
 * original and so show as `REVERSAL` debits). Filtering by school and student happens inside, so no
 * other student's row can enter. `ord` orders a bill before its discount before payments of the same day.
 */
const ENTRIES_SQL = `
  SELECT 1 AS ord, COALESCE(sf.due_date, sf.period_start)::date AS entry_date, sf.created_at AS at,
         'BILL' AS kind, COALESCE(fs.name, 'Bill') AS description, sf.id::text AS ref,
         sf.total_amount AS debit, 0::numeric AS credit
    FROM student_fees sf
    JOIN students st ON st.id = sf.student_id AND st.tenant_id = $1
    LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
   WHERE sf.student_id = $2 AND sf.deleted_at IS NULL
  UNION ALL
  SELECT 2, COALESCE(sf.due_date, sf.period_start)::date, sf.created_at,
         'DISCOUNT', COALESCE(fs.name, 'Bill'), sf.id::text || ':standing',
         0::numeric, sf.standing_discount_amount
    FROM student_fees sf
    JOIN students st ON st.id = sf.student_id AND st.tenant_id = $1
    LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
   WHERE sf.student_id = $2 AND sf.deleted_at IS NULL AND sf.standing_discount_amount > 0
  UNION ALL
  SELECT 3, (p.payment_date AT TIME ZONE 'Asia/Dhaka')::date, p.created_at,
         CASE WHEN p.reversal_of_payment_id IS NULL THEN 'PAYMENT' ELSE 'REVERSAL' END,
         COALESCE(fs.name, 'Payment'), a.id::text,
         CASE WHEN p.reversal_of_payment_id IS NULL THEN 0::numeric ELSE a.allocated_amount END,
         CASE WHEN p.reversal_of_payment_id IS NULL THEN a.allocated_amount ELSE 0::numeric END
    FROM payment_allocations a
    JOIN payments p ON p.id = a.payment_id AND p.tenant_id = $1 AND p.deleted_at IS NULL
         AND (p.payment_status = 'SUCCESS' OR p.reversal_of_payment_id IS NOT NULL OR p.reversed_by_payment_id IS NOT NULL)
    JOIN student_fees sf ON sf.id = a.student_fee_id AND sf.student_id = $2 AND sf.deleted_at IS NULL
    LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
   WHERE a.allocated_amount <> 0
  UNION ALL
  SELECT 4, (p.payment_date AT TIME ZONE 'Asia/Dhaka')::date, p.created_at,
         CASE WHEN p.reversal_of_payment_id IS NULL THEN 'DISCOUNT' ELSE 'REVERSAL' END,
         COALESCE(fs.name, 'Discount'), a.id::text || ':discount',
         CASE WHEN p.reversal_of_payment_id IS NULL THEN 0::numeric ELSE a.discount_amount END,
         CASE WHEN p.reversal_of_payment_id IS NULL THEN a.discount_amount ELSE 0::numeric END
    FROM payment_allocations a
    JOIN payments p ON p.id = a.payment_id AND p.tenant_id = $1 AND p.deleted_at IS NULL
         AND (p.payment_status = 'SUCCESS' OR p.reversal_of_payment_id IS NOT NULL OR p.reversed_by_payment_id IS NOT NULL)
    JOIN student_fees sf ON sf.id = a.student_fee_id AND sf.student_id = $2 AND sf.deleted_at IS NULL
    LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
   WHERE a.discount_amount > 0`;

/** The running balance is a window function over the whole history, so an earlier `from` never changes a later balance. */
const LINES_SQL = `
  WITH entries AS (${ENTRIES_SQL})
  SELECT entry_date::text AS date, kind, description, debit::text, credit::text,
         (SUM(debit - credit) OVER (ORDER BY entry_date, ord, at, ref
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::text AS balance
    FROM entries
   ORDER BY entry_date, ord, at, ref`;

interface LineRow {
  date: string;
  kind: StatementEntryKind;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

/** Whole paisa, so the sums and the comparison with the fees tab cannot drift (Rule 26). */
const money = (value: string | number): number => Math.round(Number(value) * 100) / 100;

/**
 * [8.15.35] One student's statement (Epic 8.15 D10, coded, not a defined report): what was charged,
 * paid and discounted, with what is still owed after every line. It reconciles with the student's fees
 * tab: the closing balance of the whole history is the sum of billed minus paid minus discounted.
 */
@Injectable()
export class StudentStatementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly runLog: ReportRunLogService,
  ) {}

  async getStatement(
    tenantId: string,
    userId: string,
    studentId: string,
    range: { from?: string; to?: string },
  ): Promise<StudentStatementDto> {
    const students: Array<{ id: string; full_name: string; registration_number: string }> =
      await this.dataSource.query(
        `SELECT id, full_name, registration_number FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [studentId, tenantId],
      );
    if (students.length === 0) throw new NotFoundException('Student not found');
    const student = students[0];

    const run = await this.runLog.start({
      tenantId,
      userId,
      kind: ReportRunKind.RUN,
      sourceKey: 'student-statement',
      params: { student_id: studentId, from: range.from ?? null, to: range.to ?? null },
    });
    const startedAt = Date.now();

    const all: LineRow[] = await this.dataSource.query(LINES_SQL, [tenantId, studentId]);
    const from = range.from ?? null;
    const to = range.to ?? null;
    const before = from ? all.filter((l) => l.date < from) : [];
    const shown = all.filter((l) => (!from || l.date >= from) && (!to || l.date <= to));

    const opening = before.length > 0 ? money(before[before.length - 1].balance) : 0;
    const entries: StatementEntryDto[] = shown.map((l) => ({
      date: l.date,
      kind: l.kind,
      description: l.description,
      debit: money(l.debit),
      credit: money(l.credit),
      balance: money(l.balance),
    }));
    const closing = entries.length > 0 ? entries[entries.length - 1].balance : opening;

    const wallet = await this.wallet(tenantId, studentId);
    await this.runLog.finish(tenantId, run.id, {
      rowCount: entries.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      student_id: student.id,
      student_name: student.full_name,
      registration_number: student.registration_number,
      from,
      to,
      opening_balance: opening,
      closing_balance: closing,
      entries,
      ...wallet,
    };
  }

  /** Advance money is not part of what is owed, so it is listed beside the statement, not in it. */
  private async wallet(
    tenantId: string,
    studentId: string,
  ): Promise<{ wallet_balance: number; wallet_moves: WalletMoveDto[] }> {
    const rows: Array<{ date: string; kind: string; amount: string; note: string | null }> =
      await this.dataSource.query(
        `SELECT (t.created_at AT TIME ZONE 'Asia/Dhaka')::date::text AS date, t.kind, t.amount::text, t.note
           FROM wallet_transactions t
           JOIN student_wallets w ON w.id = t.wallet_id AND w.tenant_id = $1 AND w.student_id = $2
          WHERE t.tenant_id = $1
          ORDER BY t.created_at, t.id`,
        [tenantId, studentId],
      );
    const balance: Array<{ balance: string }> = await this.dataSource.query(
      `SELECT balance::text FROM student_wallets WHERE tenant_id = $1 AND student_id = $2`,
      [tenantId, studentId],
    );
    return {
      wallet_balance: money(balance[0]?.balance ?? 0),
      wallet_moves: rows.map((r) => ({
        date: r.date,
        kind: r.kind,
        amount: money(r.amount),
        note: r.note,
      })),
    };
  }
}
