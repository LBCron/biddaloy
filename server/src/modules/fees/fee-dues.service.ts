import { Injectable } from '@nestjs/common';
import { round2, toPaisa } from '../../common/constants/money';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, Brackets } from 'typeorm';
import { StudentFee } from './entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';
import { QueryFeeDuesDto, QueryFlaggedDuesDto } from './dto/fees.dto';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { localToday } from '../../common/time';
import { OPEN_FEE_STATUSES } from './fees.constants';
import { pagedRows } from '../reports/export/paged-rows';

export interface DueEntry {
  student_fee_id: string;
  fee_structure_id: string;
  fee_name: string;
  fee_type: FeeType;
  month: number;
  year: number;
  period_start: Date;
  period_type: PeriodType;
  occurrence: number;
  /** `late_fee_for_student_fee_id IS NOT NULL` — this bill IS a late fee. */
  is_late_fee: boolean;
  /** [Epic 38 D17] `fee_structure.fee_type === 'FINE'`. */
  is_fine: boolean;
  /** [Epic 38 D17] Set on FINE bills (the incident note); null otherwise. */
  note: string | null;
  total_amount: number;
  paid_amount: number;
  discount_amount: number;
  standing_discount_amount: number;
  one_off_discount_amount: number;
  balance: number;
  status: FeeStatus;
  due_date: Date | null;
  reminder_threshold_date: Date | null;
}

export interface StudentDueAggregate {
  student_id: string;
  full_name: string;
  registration_number: string;
  roll_number: number;
  class_name: string | null;
  section_name: string | null;
  total_due: number;
  months_overdue: number;
}

export interface StudentDueSummary extends StudentDueAggregate {
  dues: DueEntry[];
}

export interface StudentDueSnapshot {
  student_id: string;
  total_due: number;
  /** Month/year of the student's oldest still-open fee, or null if none. */
  earliest_due_month: number | null;
  earliest_due_year: number | null;
}

/**
 * Postgres has no "value at the min of another column" aggregate, so the
 * earliest open fee is found by collapsing (year, month) into a single
 * sortable integer, taking MIN of that, and expanding it back here.
 */
export function decodeMonthOrdinal(ordinal: number): { month: number; year: number } {
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
}

export interface GuardianContact {
  id: string;
  full_name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  alternate_phone: string | null;
  preferred_communication: string;
  is_primary_contact: boolean;
}

export function sortAggregates(
  summaries: StudentDueAggregate[],
  sortBy: 'due_amount' | 'name' | 'class',
  sortOrder: 'ASC' | 'DESC',
): StudentDueAggregate[] {
  const dir = sortOrder === 'ASC' ? 1 : -1;
  return [...summaries].sort((a, b) => {
    let primary = 0;
    if (sortBy === 'name') {
      primary = a.full_name.localeCompare(b.full_name) * dir;
    } else if (sortBy === 'class') {
      primary = (a.class_name ?? '').localeCompare(b.class_name ?? '') * dir;
    } else {
      primary = (a.total_due - b.total_due) * dir;
    }
    // Tie-break on student_id so offset pagination returns a stable order
    // across requests instead of relying on the DB's unordered GROUP BY.
    return primary !== 0 ? primary : a.student_id.localeCompare(b.student_id);
  });
}

@Injectable()
export class FeeDuesService {
  constructor(
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
  ) {}

  /**
   * @param restrictToStudentIds [5.1] — when supplied, results are narrowed
   *   to these students on top of every other filter. This is the seam a
   *   PARENT/STUDENT caller comes through: `FeeController` resolves the
   *   caller's linked students via `FamilyAccessService` and passes them
   *   here, so a family caller can never widen the query with `class_id`
   *   or `section_id`. Staff callers pass nothing and are unaffected.
   *
   *   An **empty array** means "linked to nobody" and returns an empty page
   *   — it is not treated the same as `undefined` ("no restriction"), which
   *   would hand a family caller the whole tenant.
   */
  async getDues(query: QueryFeeDuesDto, tenantId: string, restrictToStudentIds?: string[]) {
    // `status` only narrows which students match (e.g. only those with a
    // PARTIALLY_PAID fee); the total_due/dues breakdown below always covers
    // every open (PENDING or PARTIALLY_PAID) fee for a matched student.
    const matchStatuses = query.status ? [query.status] : OPEN_FEE_STATUSES;

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (restrictToStudentIds !== undefined && restrictToStudentIds.length === 0) {
      return { data: [], total: 0, total_due_sum: 0, page, limit, totalPages: 0 };
    }

    const studentIds = await this.findMatchingStudentIds(tenantId, matchStatuses, {
      class_id: query.class_id,
      section_id: query.section_id,
      month: query.month,
      year: query.year,
      fee_type: query.fee_type,
      restrictToStudentIds,
      search: query.search,
    });

    if (studentIds.length === 0) {
      return { data: [], total: 0, total_due_sum: 0, page, limit, totalPages: 0 };
    }

    const aggregates = await this.aggregateForStudents(studentIds);
    const sortBy = query.sort_by ?? 'due_amount';
    const sortOrder = query.sort_order ?? (sortBy === 'due_amount' ? 'DESC' : 'ASC');
    const sorted = sortAggregates(aggregates, sortBy, sortOrder);

    const total = sorted.length;
    // Whole paisa so the sum cannot drift (Rule 26); covers every matched student, all pages.
    const total_due_sum = sorted.reduce((sum, a) => sum + toPaisa(a.total_due), 0) / 100;
    const start = (page - 1) * limit;
    const pageAggregates = sorted.slice(start, start + limit);

    const duesByStudent = await this.fetchDuesForStudents(pageAggregates.map((a) => a.student_id));
    const data: StudentDueSummary[] = pageAggregates.map((a) => ({
      ...a,
      dues: duesByStudent.get(a.student_id) ?? [],
    }));

    return { data, total, total_due_sum, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** [8.15.11] Every student with open dues matching the list's own filters, as export rows. */
  exportHeader(): string[] {
    return ['Student', 'Class', 'Section', 'Billed', 'Paid', 'Due'];
  }

  iterateForExport(query: QueryFeeDuesDto, tenantId: string, restrictToStudentIds?: string[]) {
    return pagedRows(
      (page, limit) => this.getDues({ ...query, page, limit }, tenantId, restrictToStudentIds),
      (row: StudentDueSummary) => [
        row.full_name,
        row.class_name ?? '',
        row.section_name ?? '',
        row.dues.reduce((sum, d) => sum + toPaisa(d.total_amount), 0) / 100,
        row.dues.reduce((sum, d) => sum + toPaisa(d.paid_amount), 0) / 100,
        row.total_due,
      ],
    );
  }

  async getFlaggedDues(
    query: QueryFlaggedDuesDto,
    tenantId: string,
    restrictToStudentIds?: string[],
  ) {
    const studentIds = await this.findMatchingStudentIds(tenantId, OPEN_FEE_STATUSES, {
      class_id: query.class_id,
      section_id: query.section_id,
      reminderThresholdBefore: localToday(),
      restrictToStudentIds,
    });

    const page = query.page || 1;
    const limit = query.limit || 10;

    if (studentIds.length === 0) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    const aggregates = await this.aggregateForStudents(studentIds);
    aggregates.sort(
      (a, b) =>
        b.months_overdue - a.months_overdue ||
        b.total_due - a.total_due ||
        a.student_id.localeCompare(b.student_id),
    );

    const total = aggregates.length;
    const start = (page - 1) * limit;
    const pageAggregates = aggregates.slice(start, start + limit);
    const pageStudentIds = pageAggregates.map((a) => a.student_id);

    const [duesByStudent, guardiansByStudent] = await Promise.all([
      this.fetchDuesForStudents(pageStudentIds),
      this.fetchGuardiansForStudents(pageStudentIds),
    ]);

    const data = pageAggregates.map((a) => ({
      ...a,
      dues: duesByStudent.get(a.student_id) ?? [],
      guardians: guardiansByStudent.get(a.student_id) ?? [],
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Due totals for an explicit set of students, keyed by student_id.
   *
   * Exists for the bulk-reminder flow, which starts from caller-supplied
   * student IDs rather than from a dues query, and needs only the numbers
   * that go into a message template. Students with no open fees are simply
   * absent from the map — the caller decides whether that's worth a message.
   *
   * Tenant-scoped in SQL rather than by the caller pre-filtering IDs, so a
   * student ID from another school can't leak its balance.
   */
  async getDueSnapshots(
    studentIds: string[],
    tenantId: string,
  ): Promise<Map<string, StudentDueSnapshot>> {
    const byStudent = new Map<string, StudentDueSnapshot>();
    if (studentIds.length === 0) return byStudent;

    const rows = await this.studentFeeRepo
      .createQueryBuilder('sf')
      .innerJoin('sf.student', 'student')
      .select('sf.student_id', 'student_id')
      .addSelect('SUM(sf.total_amount - sf.paid_amount - sf.discount_amount)', 'total_due')
      .addSelect('MIN(sf.year * 12 + sf.month - 1)', 'earliest_ordinal')
      .where('sf.student_id IN (:...studentIds)', { studentIds })
      .andWhere('sf.status IN (:...statuses)', { statuses: OPEN_FEE_STATUSES })
      .andWhere('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL')
      .groupBy('sf.student_id')
      .getRawMany();

    for (const row of rows) {
      const ordinal = row.earliest_ordinal === null ? null : Number(row.earliest_ordinal);
      const earliest = ordinal === null ? null : decodeMonthOrdinal(ordinal);
      byStudent.set(row.student_id, {
        student_id: row.student_id,
        total_due: Number(row.total_due),
        earliest_due_month: earliest?.month ?? null,
        earliest_due_year: earliest?.year ?? null,
      });
    }

    return byStudent;
  }

  /**
   * The one base join every dues list and dashboard widget starts from:
   * `student_fees -> students (tenant, not deleted) -> class_sections -> classes`.
   * `student_fees` has no `tenant_id`; tenant scope comes only through the
   * `students` join, so callers must never bypass this.
   */
  private openFeesBase(tenantId: string, statuses: FeeStatus[]) {
    return this.studentFeeRepo
      .createQueryBuilder('sf')
      .innerJoin('sf.student', 'student')
      .innerJoin('student.class_section', 'cs')
      .innerJoin('cs.class', 'cls')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL')
      .andWhere('sf.status IN (:...statuses)', { statuses });
  }

  /**
   * [8.10.7.3.07] Outstanding balance split by age in days past due on
   * `today` (the school's day, passed in so it follows the tenant's
   * timezone). 0_30 includes not-yet-due fees and fees with no due date.
   */
  async getAgeing(tenantId: string, today: string) {
    const bal = '(sf.total_amount - sf.paid_amount - sf.discount_amount)';
    const age = '(CAST(:today AS date) - COALESCE(sf.due_date, CAST(:today AS date)))';
    const row = await this.openFeesBase(tenantId, OPEN_FEE_STATUSES)
      .select(`COALESCE(SUM(${bal}) FILTER (WHERE ${age} <= 30), 0)`, 'b0_30')
      .addSelect(`COALESCE(SUM(${bal}) FILTER (WHERE ${age} BETWEEN 31 AND 60), 0)`, 'b31_60')
      .addSelect(`COALESCE(SUM(${bal}) FILTER (WHERE ${age} > 60), 0)`, 'b60_plus')
      .setParameter('today', today)
      .getRawOne<{ b0_30: string; b31_60: string; b60_plus: string }>();

    const amounts = [Number(row?.b0_30 ?? 0), Number(row?.b31_60 ?? 0), Number(row?.b60_plus ?? 0)];
    const total = amounts.reduce((a, b) => a + b, 0);
    const names = ['0_30', '31_60', '60_PLUS'] as const;
    return {
      as_of: today,
      total_due: total,
      buckets: names.map((bucket, i) => ({
        bucket,
        amount: amounts[i],
        share_pct: total === 0 ? 0 : Math.round((amounts[i] / total) * 100),
      })),
    };
  }

  /** [8.10.7.3.07] Outstanding balance per class, largest first. */
  async getDuesByClass(tenantId: string) {
    const rows = await this.openFeesBase(tenantId, OPEN_FEE_STATUSES)
      .select('cls.id', 'class_id')
      .addSelect('cls.name', 'class_name')
      .addSelect('SUM(sf.total_amount - sf.paid_amount - sf.discount_amount)', 'amount')
      .addSelect('COUNT(DISTINCT sf.student_id)', 'student_count')
      .groupBy('cls.id')
      .addGroupBy('cls.name')
      .orderBy('amount', 'DESC')
      .addOrderBy('cls.name', 'ASC')
      .getRawMany<{
        class_id: string;
        class_name: string;
        amount: string;
        student_count: string;
      }>();

    const classes = rows.map((r) => ({
      class_id: r.class_id,
      class_name: r.class_name,
      amount: Number(r.amount),
      student_count: Number(r.student_count),
    }));
    return { total_due: classes.reduce((a, c) => a + c.amount, 0), classes };
  }

  /**
   * [8.10.7.3.07] Flagged students (same predicate as `getFlaggedDues`) with
   * no non-FAILED reminder log since their oldest threshold date, plus the
   * distinct guardians behind them. `timezone` turns the threshold date into
   * the instant its school day starts, for comparison with `created_at`.
   */
  async countRemindersPending(tenantId: string, today: string, timezone: string) {
    const inner = this.openFeesBase(tenantId, OPEN_FEE_STATUSES)
      .select('sf.student_id', 'student_id')
      .addSelect('MIN(sf.reminder_threshold_date)', 'since')
      .andWhere('sf.reminder_threshold_date IS NOT NULL')
      .andWhere('sf.reminder_threshold_date < :today', { today })
      .groupBy('sf.student_id')
      .having(
        `NOT EXISTS (
          SELECT 1 FROM communication_logs cl
          WHERE cl.tenant_id = :tenantId AND cl.student_id = sf.student_id
            AND cl.trigger IN ('BULK_REMINDER', 'SINGLE_REMINDER')
            AND cl.status <> 'FAILED'
            AND cl.created_at >= (MIN(sf.reminder_threshold_date)::timestamp AT TIME ZONE :timezone)
        )`,
      )
      .setParameter('timezone', timezone);

    const row = await this.studentFeeRepo.manager
      .createQueryBuilder()
      .select('COUNT(DISTINCT sub.student_id)', 'student_count')
      .addSelect('COUNT(DISTINCT g.id)', 'guardian_count')
      .addSelect("TO_CHAR(MIN(sub.since), 'YYYY-MM-DD')", 'oldest')
      .from(`(${inner.getQuery()})`, 'sub')
      .leftJoin('student_guardians', 'sg', 'sg.student_id = sub.student_id')
      .leftJoin('guardians', 'g', 'g.id = sg.guardian_id AND g.deleted_at IS NULL')
      .setParameters(inner.getParameters())
      .getRawOne<{ student_count: string; guardian_count: string; oldest: string | null }>();

    return {
      student_count: Number(row?.student_count ?? 0),
      guardian_count: Number(row?.guardian_count ?? 0),
      oldest_threshold_date: row?.oldest ?? null,
    };
  }

  /**
   * Finds the distinct student IDs whose open fees match the given filters.
   * Cheap: selects only student_id, so it's safe to run before pagination
   * even when a tenant has many students with open dues.
   */
  private async findMatchingStudentIds(
    tenantId: string,
    statuses: FeeStatus[],
    filters: {
      class_id?: string;
      section_id?: string;
      month?: number;
      year?: number;
      fee_type?: FeeType;
      reminderThresholdBefore?: string;
      restrictToStudentIds?: string[];
      search?: string;
    },
  ): Promise<string[]> {
    // Fail closed before building anything: a *defined but empty*
    // restriction means "linked to nobody", which is not the same as the
    // `undefined` staff case. Handling it here rather than relying on
    // `getDues`'s own short-circuit keeps this private helper self-guarding
    // — a future caller (a widened `getFlaggedDues`, say) can pass `[]`
    // without either leaking the tenant or hitting an invalid `IN ()`.
    if (filters.restrictToStudentIds?.length === 0) {
      return [];
    }

    const qb = this.openFeesBase(tenantId, statuses);

    if (filters.class_id) {
      qb.andWhere('cls.id = :classId', { classId: filters.class_id });
    }
    if (filters.section_id) {
      qb.andWhere('cs.id = :sectionId', { sectionId: filters.section_id });
    }
    if (filters.month) {
      qb.andWhere('sf.month = :month', { month: filters.month });
    }
    if (filters.year) {
      qb.andWhere('sf.year = :year', { year: filters.year });
    }
    if (filters.fee_type) {
      qb.innerJoin('sf.fee_structure', 'fs').andWhere('fs.fee_type = :feeType', {
        feeType: filters.fee_type,
      });
    }
    if (filters.restrictToStudentIds?.length) {
      qb.andWhere('sf.student_id IN (:...restrictToStudentIds)', {
        restrictToStudentIds: filters.restrictToStudentIds,
      });
    }
    if (filters.reminderThresholdBefore) {
      qb.andWhere('sf.reminder_threshold_date IS NOT NULL').andWhere(
        'sf.reminder_threshold_date < :threshold',
        { threshold: filters.reminderThresholdBefore },
      );
    }

    // [8.14.9] Applied here, at the SQL stage that produces the matching
    // student ID set — never after `aggregateForStudents` sorts/paginates
    // its in-memory array (see getDues below), which would corrupt
    // total/totalPages.
    const search = normalizeSearchTerm(filters.search);
    if (search) {
      // `/^\d+$/`, not `Number.isInteger(Number(search))` — the latter also
      // accepts `1e5`, `0x2a`, and leading/trailing whitespace as
      // "integers", which would silently roll-number-match a plain-text
      // search term shaped like one of those.
      // `roll_number` is `int4`, so the shape check alone is not enough: a
      // longer digit string parses fine in JS but blows up in Postgres —
      // `?search=3000000000` raises `integer out of range`, and
      // `?search=99999999999999999999` reaches it as `1e+20`
      // (`invalid input syntax for type integer`). Either way an ordinary
      // search 500s instead of returning no rows, so anything past int4's
      // range is treated as a name/registration search only.
      const isPlainInteger = /^\d+$/.test(search) && Number(search) <= 2147483647;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('student.full_name ILIKE :search', { search: `%${search}%` })
            .orWhere('student.registration_number ILIKE :search', { search: `%${search}%` });
          if (isPlainInteger) {
            sub.orWhere('student.roll_number = :rollNumber', { rollNumber: Number(search) });
          }
        }),
      );
    }

    qb.select('DISTINCT sf.student_id', 'student_id');
    const rows = await qb.getRawMany<{ student_id: string }>();
    return rows.map((r) => r.student_id);
  }

  /**
   * Computes total_due/months_overdue for a known set of students by
   * aggregating in SQL, so the per-fee rows are never pulled into app memory
   * just to be summed. Sized to the matching-student set, not the page.
   */
  private async aggregateForStudents(studentIds: string[]): Promise<StudentDueAggregate[]> {
    if (studentIds.length === 0) return [];

    const rows = await this.studentFeeRepo
      .createQueryBuilder('sf')
      .innerJoin('sf.student', 'student')
      .leftJoin('student.class_section', 'cs')
      .leftJoin('cs.class', 'cls')
      .select('sf.student_id', 'student_id')
      .addSelect('student.full_name', 'full_name')
      .addSelect('student.registration_number', 'registration_number')
      .addSelect('student.roll_number', 'roll_number')
      .addSelect('cls.name', 'class_name')
      .addSelect('cs.section_name', 'section_name')
      .addSelect('SUM(sf.total_amount - sf.paid_amount - sf.discount_amount)', 'total_due')
      .addSelect(
        // `< :today`, not `< NOW()`. `sf.due_date` is a `date`
        // column, so `< NOW()` widens it to midnight of that day and any
        // fee due *today* counts as overdue from 00:00 onwards — a
        // parent was told they were late on the very day they were asked
        // to pay. A fee is overdue only once its due date has passed.
        // `:today` is the school's day from `localToday()`, never
        // `CURRENT_DATE`, which follows the DB session timezone (UTC in
        // production) and so flips 6 hours after Dhaka midnight.
        // `ui/src/utils/date.ts`'s `isPastDueDate` is the client-side
        // twin of this predicate; the two must move together.
        'COUNT(*) FILTER (WHERE sf.due_date IS NOT NULL AND sf.due_date < :today)',
        'months_overdue',
      )
      .setParameter('today', localToday())
      .where('sf.student_id IN (:...studentIds)', { studentIds })
      .andWhere('sf.status IN (:...statuses)', { statuses: OPEN_FEE_STATUSES })
      .groupBy('sf.student_id')
      .addGroupBy('student.full_name')
      .addGroupBy('student.registration_number')
      .addGroupBy('student.roll_number')
      .addGroupBy('cls.name')
      .addGroupBy('cs.section_name')
      .getRawMany();

    return rows.map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      registration_number: r.registration_number,
      roll_number: Number(r.roll_number),
      class_name: r.class_name ?? null,
      section_name: r.section_name ?? null,
      total_due: Number(r.total_due),
      months_overdue: Number(r.months_overdue),
    }));
  }

  /**
   * Fetches the full open-fee breakdown (any month/year) for a small set of
   * students — meant to be called only with a single page's worth of IDs.
   */
  private async fetchDuesForStudents(studentIds: string[]): Promise<Map<string, DueEntry[]>> {
    const byStudent = new Map<string, DueEntry[]>();
    if (studentIds.length === 0) return byStudent;

    const fees = await this.studentFeeRepo.find({
      where: { student_id: In(studentIds), status: In(OPEN_FEE_STATUSES) },
      relations: ['fee_structure'],
      order: { year: 'ASC', month: 'ASC' },
    });

    for (const fee of fees) {
      const entries = byStudent.get(fee.student_id) ?? [];
      const totalAmount = Number(fee.total_amount);
      const paidAmount = Number(fee.paid_amount);
      const discountAmount = Number(fee.discount_amount);
      entries.push({
        student_fee_id: fee.id,
        fee_structure_id: fee.fee_structure_id,
        fee_name: fee.fee_structure.name,
        fee_type: fee.fee_structure.fee_type,
        month: fee.month,
        year: fee.year,
        period_start: fee.period_start,
        period_type: fee.period_type,
        occurrence: fee.occurrence,
        is_late_fee: fee.late_fee_for_student_fee_id !== null,
        is_fine: fee.fee_structure.fee_type === FeeType.FINE,
        note: fee.note,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        discount_amount: discountAmount,
        standing_discount_amount: Number(fee.standing_discount_amount),
        one_off_discount_amount: Number(fee.one_off_discount_amount),
        balance: round2(Math.max(0, totalAmount - paidAmount - discountAmount)),
        status: fee.status,
        due_date: fee.due_date,
        reminder_threshold_date: fee.reminder_threshold_date,
      });
      byStudent.set(fee.student_id, entries);
    }

    return byStudent;
  }

  private async fetchGuardiansForStudents(
    studentIds: string[],
  ): Promise<Map<string, GuardianContact[]>> {
    const byStudent = new Map<string, GuardianContact[]>();
    if (studentIds.length === 0) return byStudent;

    const students = await this.studentRepo.find({
      where: { id: In(studentIds) },
      relations: ['guardians'],
    });

    for (const student of students) {
      byStudent.set(
        student.id,
        (student.guardians ?? []).map((g) => ({
          id: g.id,
          full_name: g.full_name,
          relationship: g.relationship,
          phone: g.phone,
          email: g.email,
          alternate_phone: g.alternate_phone,
          preferred_communication: g.preferred_communication,
          is_primary_contact: g.is_primary_contact,
        })),
      );
    }

    return byStudent;
  }
}
