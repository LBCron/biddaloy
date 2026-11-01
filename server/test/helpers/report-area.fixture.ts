import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

/**
 * Raw-SQL fixtures for the report-area integration specs. The suite wipes transactional tables
 * before every test, so call these from `beforeEach`. Each call makes its own school, so specs
 * never share rows.
 */
export class ReportAreaFixture {
  constructor(private readonly ds: DataSource) {}

  private async one(sql: string, params: unknown[]): Promise<string> {
    const rows: Array<{ id: string }> = await this.ds.query(sql, params);
    return rows[0].id;
  }

  school(): Promise<string> {
    return this.one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Area ${randomUUID()}`,
      `area-${randomUUID()}`,
    ]);
  }

  year(tenantId: string, name = '2026', current = true): Promise<string> {
    return this.one(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ($1, '2026-01-01', '2026-12-31', $2, $3) RETURNING id`,
      [name, current, tenantId],
    );
  }

  /** A class with one section "A"; returns both ids. */
  async klass(tenantId: string, yearId: string, name: string, grade: number) {
    const classId = await this.one(
      `INSERT INTO classes (name, numeric_grade, academic_year_id, tenant_id, shift, version)
       VALUES ($1, $2, $3, $4, 'Morning', 'Bangla') RETURNING id`,
      [name, grade, yearId, tenantId],
    );
    const sectionId = await this.one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, tenantId],
    );
    return { classId, sectionId };
  }

  /** A student with an enrolment in the year, in the given class. */
  async student(
    tenantId: string,
    yearId: string,
    cls: { classId: string; sectionId: string },
    opts: {
      name?: string;
      gender?: string | null;
      religion?: string | null;
      status?: string;
    } = {},
  ): Promise<string> {
    const studentId = await this.one(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, gender, religion, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        opts.name ?? `S ${randomUUID()}`,
        `R-${randomUUID()}`,
        Math.floor(Math.random() * 1e6),
        cls.sectionId,
        opts.gender === undefined ? 'MALE' : opts.gender,
        opts.religion === undefined ? 'ISLAM' : opts.religion,
        tenantId,
      ],
    );
    await this.ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [studentId, cls.classId, cls.sectionId, yearId, opts.status ?? 'ACTIVE', tenantId],
    );
    return studentId;
  }

  async guardian(
    tenantId: string,
    studentId: string,
    opts: { name: string; phone: string; primary: boolean },
  ): Promise<string> {
    const id = await this.one(
      `INSERT INTO guardians (full_name, relationship, phone, is_primary_contact, tenant_id)
       VALUES ($1, 'Father', $2, $3, $4) RETURNING id`,
      [opts.name, opts.phone, opts.primary, tenantId],
    );
    await this.ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      id,
    ]);
    return id;
  }

  /** A fee structure and one bill for a student. */
  async bill(
    tenantId: string,
    yearId: string,
    classId: string,
    studentId: string,
    opts: {
      total: number;
      paid?: number;
      /** A standing discount on the bill (set when the bill is made). */
      discount?: number;
      /** A one-off discount given at checkout. */
      oneOffDiscount?: number;
      status: string;
      dueDate: string;
      period?: string;
      feeType?: string;
    },
  ): Promise<string> {
    const structureId = await this.one(
      `INSERT INTO fee_structures (fee_type, name, amount, class_id, academic_year_id, tenant_id)
       VALUES ($1, 'Tuition', $2, $3, $4, $5) RETURNING id`,
      [opts.feeType ?? 'MONTHLY_TUITION', opts.total, classId, yearId, tenantId],
    );
    const standing = opts.discount ?? 0;
    const oneOff = opts.oneOffDiscount ?? 0;
    // `discount_amount` must equal standing + one-off (a CHECK).
    return this.one(
      `INSERT INTO student_fees
         (student_id, academic_year_id, fee_structure_id, period_start, due_date,
          total_amount, paid_amount, discount_amount, standing_discount_amount, one_off_discount_amount, status)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        studentId,
        yearId,
        structureId,
        opts.period ?? '2026-05-01',
        opts.dueDate,
        opts.total,
        opts.paid ?? 0,
        standing + oneOff,
        standing,
        oneOff,
        opts.status,
      ],
    );
  }

  payment(
    tenantId: string,
    studentId: string,
    opts: {
      amount: number;
      method: string;
      at: string;
      status?: string;
      reversalOf?: string;
    },
  ): Promise<string> {
    return this.one(
      `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, reversal_of_payment_id)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7) RETURNING id`,
      [
        studentId,
        opts.amount,
        opts.method,
        opts.status ?? 'SUCCESS',
        opts.at,
        tenantId,
        opts.reversalOf ?? null,
      ],
    );
  }

  /** Applies part of a payment to a bill, the way checkout does. */
  allocate(paymentId: string, billId: string, amount: number, discount = 0): Promise<unknown> {
    return this.ds.query(
      `INSERT INTO payment_allocations (payment_id, student_fee_id, allocated_amount, discount_amount, allocation_type)
       VALUES ($1, $2, $3, $4, 'DUE')`,
      [paymentId, billId, amount, discount],
    );
  }

  /** A wallet holding `balance`, with the given moves (positive adds, negative takes). */
  async wallet(
    tenantId: string,
    studentId: string,
    balance: number,
    moves: Array<{ amount: number; kind: string; note?: string }>,
  ): Promise<void> {
    const walletId = await this.one(
      `INSERT INTO student_wallets (tenant_id, student_id, balance) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, studentId, balance],
    );
    for (const m of moves) {
      await this.ds.query(
        `INSERT INTO wallet_transactions (tenant_id, wallet_id, amount, kind, note) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, walletId, m.amount, m.kind, m.note ?? null],
      );
    }
  }

  /** Marks the original as reversed by the reversal row, like the reversal service does. */
  markReversed(originalId: string, reversalId: string): Promise<unknown> {
    return this.ds.query(`UPDATE payments SET reversed_by_payment_id = $2 WHERE id = $1`, [
      originalId,
      reversalId,
    ]);
  }

  /** An attendance session for a section on a date, then one record per (student, status). */
  async attendance(
    tenantId: string,
    sectionId: string,
    date: string,
    marks: Array<{ studentId: string; status: string }>,
  ): Promise<void> {
    const sessionId = await this.one(
      `INSERT INTO attendance_sessions (tenant_id, section_id, date) VALUES ($1, $2, $3::date) RETURNING id`,
      [tenantId, sectionId, date],
    );
    for (const m of marks) {
      await this.ds.query(
        `INSERT INTO attendance_records (tenant_id, session_id, student_id, date, status)
         VALUES ($1, $2, $3, $4::date, $5)`,
        [tenantId, sessionId, m.studentId, date, m.status],
      );
    }
  }

  publicExam(
    tenantId: string,
    studentId: string,
    opts: { exam: string; year: number; gpa: number | null; board?: string },
  ): Promise<unknown> {
    return this.ds.query(
      `INSERT INTO student_public_exams (tenant_id, student_id, exam_type, board, roll_no, registration_no, passing_year, gpa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        studentId,
        opts.exam,
        opts.board ?? 'Dhaka',
        `${Math.floor(Math.random() * 1e6)}`,
        `${Math.floor(Math.random() * 1e6)}`,
        opts.year,
        opts.gpa,
      ],
    );
  }
}
