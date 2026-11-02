import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { nextTenantSerial } from '../../common/utils/next-serial.util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Brackets, EntityManager, QueryFailedError } from 'typeorm';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { StudentWallet } from '../fees/entities/student-wallet.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';
import {
  CreateStudentDto,
  UpdateStudentDto,
  QueryStudentDto,
  QueryStudentIdsDto,
  STUDENT_PROFILE_FIELDS,
} from './dto/students.dto';
import {
  CreateGuardianDto,
  UpdateGuardianDto,
  UpdateOwnGuardianDto,
  QueryGuardianDto,
} from './dto/students.dto';
import { CommunicationMedium, AuditAction, EnrollmentStatus, UserRole } from '@biddaloy/shared';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { nextRollNumber } from './roll-number.util';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { localToday } from '../../common/time';
import { assertSeatsAvailable } from '../schools/trial/seat-limit.service';
import { OPEN_FEE_STATUSES } from '../fees/fees.constants';
import { bdPhoneTail } from '../communications/providers/shared/phone-number.util';
import { pagedRows } from '../reports/export/paged-rows';

// [16.3.3] Caps the audience picker's "select all matching" id list — bounds
// both the query cost and the response size for a single selection.
const MAX_STUDENT_IDS_RESULT = 5000;

const BIRTH_REG_NO_INDEX = 'IDX_students_tenant_birth_reg_no';
/** Unique (class_section_id, roll_number); counts soft-deleted rows too. */
const ROLL_NUMBER_INDEX = 'IDX_ca01941430b7d99b013e6c6948';

/** PUB-10 / D16: a guardian unlink revokes every live share link for the student's invoices.
 * The token row has no recipient, so all of the student's links go; staff re-share to the remaining guardian. */
async function revokeInvoiceShareLinks(
  manager: EntityManager,
  tenantId: string,
  studentIds: string[],
): Promise<void> {
  if (!studentIds.length) return;
  await manager.query(
    `UPDATE invoice_share_tokens t SET revoked_at = now()
       FROM invoices i
      WHERE t.invoice_id = i.id AND t.tenant_id = $1 AND i.student_id = ANY($2::uuid[]) AND t.revoked_at IS NULL`,
    [tenantId, studentIds],
  );
}

/** [39.2.1] Turns the unique violations on (tenant, birth_reg_no) and (section, roll) into a 409. */
function rethrowStudentUniqueConflict(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const { code, constraint } = err as unknown as { code?: string; constraint?: string };
    if (code === '23505' && constraint === BIRTH_REG_NO_INDEX) {
      throw new ConflictException('A student with this birth registration number already exists');
    }
    if (code === '23505' && constraint === ROLL_NUMBER_INDEX) {
      throw new ConflictException({
        message: 'This roll number is already taken in that section.',
        details: { code: 'ROLL_NUMBER_TAKEN' },
      });
    }
  }
  throw err;
}

/** [39.2.1] Writing any profile field needs STUDENT_RECORDS_WRITE (403 otherwise),
 * even though the route itself only needs STUDENT_UPDATE / STUDENT_CREATE. */
export function assertCanWriteProfileFields(
  dto: CreateStudentDto | UpdateStudentDto,
  canWriteRecords: boolean,
): void {
  if (canWriteRecords) return;
  const touched = STUDENT_PROFILE_FIELDS.filter((f) => dto[f] !== undefined);
  if (touched.length > 0) {
    throw new ForbiddenException(
      `Requires permission STUDENT_RECORDS_WRITE to set: ${touched.join(', ')}`,
    );
  }
}

/** [39.2.1] `health_notes` is only visible with STUDENT_RECORDS_READ (D14). Works on
 * one student or guardian, an array, or a paginated `{ data }` page (children included);
 * mutates and returns the input. */
export function redactHealthNotes<T>(result: T, canReadRecords: boolean): T {
  if (canReadRecords || result == null) return result;
  // Recurses into `students` so a Guardian (or a page of them) with children attached is safe too.
  const strip = (s: unknown) => {
    if (!s || typeof s !== 'object') return;
    delete (s as { health_notes?: unknown }).health_notes;
    const kids = (s as { students?: unknown }).students;
    if (Array.isArray(kids)) kids.forEach(strip);
  };
  const page = (result as { data?: unknown }).data;
  if (Array.isArray(result)) result.forEach(strip);
  else if (Array.isArray(page)) page.forEach(strip);
  else strip(result);
  return result;
}

@Injectable()
export class StudentService {
  constructor(
    @InjectRepository(Student)
    private readonly repo: Repository<Student>,
    @InjectRepository(Guardian)
    private readonly guardianRepo: Repository<Guardian>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * @param manager Optional transaction-scoped manager. When provided (e.g.
   * by bulk upload, which resolves/creates a guardian and a student as one
   * atomic unit), all reads/writes run on it instead of starting a new
   * transaction — so a failure here rolls back sibling writes too.
   */
  async create(
    dto: CreateStudentDto,
    tenantId: string,
    manager?: EntityManager,
    actor?: { userId: string; context?: RequestContext },
    options?: { registrationNumber?: string },
  ): Promise<Student> {
    const sectionRepo = manager ? manager.getRepository(ClassSection) : this.sectionRepo;
    const guardianRepo = manager ? manager.getRepository(Guardian) : this.guardianRepo;
    const studentRepo = manager ? manager.getRepository(Student) : this.repo;

    // Validate class_section_id belongs to tenant
    const section = await sectionRepo.findOne({
      where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class'],
    });
    if (!section) {
      throw new NotFoundException('Class section not found');
    }

    // Guard validations
    if (dto.guardian_ids?.length) {
      const guardianCount = await guardianRepo.count({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardianCount !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
    }

    const currentYear = Number(localToday().slice(0, 4));

    // Atomically generate reg number, determine roll number, and persist
    const generateAndSave = async (txManager: EntityManager) => {
      const txStudentRepo = txManager.getRepository(Student);

      // [13.2.3] A new student is ACTIVE, so it takes a seat. Locks the School row until this
      // transaction ends, which is what makes two concurrent creates at limit-1 admit only one.
      await assertSeatsAvailable(txManager, tenantId, 1);

      // Numeric max + 1 per (tenant, year) under an advisory lock, so the very first student of a
      // year is serialized too. Never a text sort: it breaks past REG-YYYY-9999.
      // A bulk import may supply its own number (validated unique before commit).
      let regNumber = options?.registrationNumber;
      if (!regNumber) {
        const nextSeq = await nextTenantSerial(txManager, {
          table: 'students',
          column: 'registration_number',
          tenantId,
          prefix: `REG-${currentYear}-`,
        });
        regNumber = `REG-${currentYear}-${String(nextSeq).padStart(4, '0')}`;
      }

      // Same reasoning for roll numbers, scoped per class_section — see
      // roll-number.util.ts's own comment.
      const rollNumber =
        dto.roll_number ?? (await nextRollNumber(txManager, dto.class_section_id, tenantId));

      // Create and save student
      const student = txStudentRepo.create({
        full_name: dto.full_name,
        full_name_bn: dto.full_name_bn ?? null,
        blood_group: dto.blood_group ?? null,
        registration_number: regNumber,
        roll_number: rollNumber,
        class_section_id: dto.class_section_id,
        date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : null,
        gender: dto.gender ?? null,
        home_address: dto.home_address ?? null,
        preferred_communication: dto.preferred_communication as CommunicationMedium,
        religion: dto.religion ?? null,
        birth_reg_no: dto.birth_reg_no ?? null,
        health_notes: dto.health_notes ?? null,
        father_name: dto.father_name ?? null,
        mother_name: dto.mother_name ?? null,
        tenant_id: tenantId,
      });

      let savedStudent: Student;
      try {
        savedStudent = await txStudentRepo.save(student);
      } catch (err) {
        rethrowStudentUniqueConflict(err);
      }

      // [8.11.3] Every new student gets a day-one enrollment history row —
      // `EnrollmentService.create` isn't reused here (it re-validates the
      // student/class/section chain this method already just validated,
      // and its ACTIVE-sync side effect would immediately reassign the
      // roll number this call just picked). Written directly against the
      // same transaction manager so a rollback here undoes both writes.
      // `section` (validated above, `relations: ['class']`) supplies both
      // the class and its academic year without an extra query.
      const txEnrollmentRepo = txManager.getRepository(Enrollment);
      await txEnrollmentRepo.save(
        txEnrollmentRepo.create({
          student_id: savedStudent.id,
          class_id: section.class_id,
          section_id: dto.class_section_id,
          academic_year_id: section.class.academic_year_id,
          tenant_id: tenantId,
        }),
      );

      // [LIFE-11] One CREATE audit row per student, in the same transaction.
      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'Student',
          entity_id: savedStudent.id,
          tenant_id: tenantId,
          performed_by_user_id: actor?.userId ?? null,
          ip_address: actor?.context?.ip ?? null,
          user_agent: actor?.context?.userAgent ?? null,
          new_values: {
            full_name: savedStudent.full_name,
            registration_number: savedStudent.registration_number,
            class_section_id: dto.class_section_id,
            roll_number: savedStudent.roll_number,
          },
        },
        txManager,
      );

      return savedStudent;
    };

    let savedStudent: Student;
    try {
      savedStudent = manager
        ? await generateAndSave(manager)
        : await this.repo.manager.transaction(generateAndSave);
    } catch (err) {
      rethrowStudentUniqueConflict(err);
    }

    // Link guardians
    if (dto.guardian_ids?.length) {
      const guardians = await guardianRepo.find({
        where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (guardians.length !== dto.guardian_ids.length) {
        throw new NotFoundException('One or more guardian IDs not found');
      }
      savedStudent.guardians = guardians;
      await studentRepo.save(savedStudent);
    }

    return studentRepo.findOne({
      where: { id: savedStudent.id },
      relations: ['class_section', 'class_section.class', 'guardians'],
    }) as Promise<Student>;
  }

  /**
   * Builds the tenant-scoped, filtered query for student IDs only, shared by
   * `findAll` (paginated list) and `findAllIds` (the audience picker's
   * select-all). Deliberately not `leftJoinAndSelect`ing `guardians` here —
   * a many-to-many join used for filtering (the search's guardian branch)
   * combined with `skip`/`take` would apply `LIMIT` to the flattened joined
   * rows, not to distinct students, inflating `total`/corrupting pagination
   * whenever a matched student has more than one guardian. The guardian
   * search branch below uses an `EXISTS` subquery instead, which cannot
   * multiply rows.
   */
  private buildStudentIdsQuery(
    query: Pick<
      QueryStudentDto,
      | 'class_id'
      | 'section_id'
      | 'shift'
      | 'version'
      | 'enrollment_status'
      | 'gender'
      | 'date_of_birth_from'
      | 'date_of_birth_to'
      | 'religion'
      | 'search'
    >,
    tenantId: string,
    sectionIds?: string[] | null,
  ) {
    const qb = this.repo
      .createQueryBuilder('student')
      .select('student.id', 'id')
      .leftJoin('student.class_section', 'class_section')
      .where('student.tenant_id = :tenantId', { tenantId })
      .andWhere('student.deleted_at IS NULL');

    // [68.3.01] ASSIGNED_SECTIONS callers (TEACHER): only their sections. Never `IN ()`.
    if (sectionIds) {
      if (sectionIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('student.class_section_id IN (:...scopeSectionIds)', {
          scopeSectionIds: sectionIds,
        });
    }

    if (query.class_id) {
      qb.andWhere('class_section.class_id = :classId', { classId: query.class_id });
    }
    if (query.section_id) {
      qb.andWhere('student.class_section_id = :sectionId', { sectionId: query.section_id });
    }
    // [33.3.1] Filters via `class_section.class` — an unknown/nonexistent
    // shift/version just matches nothing (empty page), never a 500.
    if (query.shift || query.version) {
      qb.leftJoin('class_section.class', 'class');
      if (query.shift) {
        qb.andWhere('class.shift = :shift', { shift: query.shift });
      }
      if (query.version) {
        qb.andWhere('class.version = :version', { version: query.version });
      }
    }
    if (query.enrollment_status) {
      qb.andWhere('student.enrollment_status = :enrollmentStatus', {
        enrollmentStatus: query.enrollment_status,
      });
    }
    if (query.gender) {
      qb.andWhere('student.gender = :gender', { gender: query.gender });
    }
    if (query.religion?.trim()) {
      qb.andWhere('LOWER(student.religion) = LOWER(:religion)', {
        religion: query.religion.trim(),
      });
    }
    if (query.date_of_birth_from) {
      qb.andWhere('student.date_of_birth >= :dobFrom', { dobFrom: query.date_of_birth_from });
    }
    if (query.date_of_birth_to) {
      qb.andWhere('student.date_of_birth <= :dobTo', { dobTo: query.date_of_birth_to });
    }

    // Matches GuardianService.findAll's own ILIKE/escape fix. Student has
    // no `phone` column of its own (that lives on Guardian) — name and
    // registration number are the student-owned free-text fields; roll
    // number is matched exactly (it's an int, not text) and guardians are
    // matched via the tenant-scoped EXISTS subquery below.
    const search = normalizeSearchTerm(query.search);
    if (search) {
      // `search` is already Bengali-digit-converted by `normalizeSearchTerm`,
      // so a Bengali roll number (e.g. `১০৩`) matches the Latin-stored
      // `roll_number` column.
      // `/^\d+$/`, not `Number.isInteger(Number(search))` — the latter also
      // accepts `1e5`, `0x2a`, and leading/trailing whitespace as
      // "integers", which would silently roll-number-match a plain-text
      // search term shaped like one of those.
      // Bounded to int4, the `roll_number` column's real range — see
      // `fee-dues.service.ts` for the same guard and the two Postgres errors
      // an unbounded digit string raises.
      const isPlainInteger = /^\d+$/.test(search) && Number(search) <= 2147483647;
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('student.full_name ILIKE :search', { search: `%${search}%` })
            .orWhere('student.registration_number ILIKE :search', { search: `%${search}%` });
          if (isPlainInteger) {
            sub.orWhere('student.roll_number = :rollNumber', { rollNumber: Number(search) });
          }
          // Guardian join must also carry its own tenant_id — the
          // `student_guardians` join table does not imply same-tenant.
          sub.orWhere(
            `EXISTS (
              SELECT 1 FROM student_guardians sg
              INNER JOIN guardians g ON g.id = sg.guardian_id
              WHERE sg.student_id = student.id
                AND g.tenant_id = :tenantId
                AND g.deleted_at IS NULL
                AND (g.full_name ILIKE :search OR g.phone ILIKE :search)
            )`,
            { search: `%${search}%` },
          );
        }),
      );
    }

    return qb;
  }

  /**
   * [16.3.3] All student IDs matching the same filters as `findAll`,
   * unpaginated — backs the audience picker's "select all matching" action.
   * Capped at `MAX_IDS_RESULT` to bound response size and query cost; a
   * caller whose filters match more than that gets a 413 telling them to
   * narrow the search instead of a silently truncated selection (which
   * would look like "select all" quietly dropped students).
   */
  async findAllIds(
    query: QueryStudentIdsDto,
    tenantId: string,
    sectionIds?: string[] | null,
  ): Promise<{ ids: string[]; total: number }> {
    const qb = this.buildStudentIdsQuery(query, tenantId, sectionIds).addOrderBy(
      'student.id',
      'ASC',
    );
    const total = await qb.getCount();
    if (total > MAX_STUDENT_IDS_RESULT) {
      throw new PayloadTooLargeException(
        `Matching students (${total}) exceed the maximum of ${MAX_STUDENT_IDS_RESULT} for a single selection. Narrow the search or filters.`,
      );
    }
    const rows = await qb.getRawMany<{ id: string }>();
    return { ids: rows.map((row) => row.id), total };
  }

  async findAll(query: QueryStudentDto, tenantId: string, sectionIds?: string[] | null) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Builds the tenant-scoped, filtered, *unpaginated* query for student
    // IDs only — deliberately not `leftJoinAndSelect`ing `guardians` here.
    // A many-to-many join used for filtering (the search's guardian
    // branch) combined with `skip`/`take` would apply `LIMIT` to the
    // flattened joined rows, not to distinct students — inflating `total`
    // and corrupting pagination whenever a matched student has more than
    // one guardian. The guardian search branch below uses an `EXISTS`
    // subquery instead, which cannot multiply rows.
    const buildIdQuery = () => this.buildStudentIdsQuery(query, tenantId, sectionIds);

    const total = await buildIdQuery().getCount();

    // `query.sort` is already allowlisted to real columns by
    // `QueryStudentDto`'s `@IsIn` — safe to use directly. Falls back to the
    // original `created_at DESC` when the caller doesn't ask for a sort, so
    // an unsorted list page's row order doesn't change under it. `id ASC`
    // is always appended as a tiebreaker — the primary sort column alone
    // isn't unique (e.g. two students named the same, or created in the
    // same instant), and without a unique secondary key, `LIMIT`/`OFFSET`
    // pagination can return a row twice or skip one across pages when ties
    // reorder. `full_name` sorts in Bengali dictionary order via
    // `BN_COLLATION` rather than libc byte order.
    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(
        `student.full_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else if (query.sort === 'registration_number') {
      idQb.orderBy('student.registration_number', query.order === 'desc' ? 'DESC' : 'ASC');
    } else {
      idQb.orderBy('student.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    idQb.addOrderBy('student.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    // Second query hydrates full entities (with relations) for exactly
    // this page's IDs — this join *can* multiply rows across guardians,
    // but there's no pagination applied here for it to corrupt.
    const rows = await this.repo.find({
      // `tenant_id` is redundant here — `ids` already came from the
      // tenant-scoped ID query above — but it costs nothing and keeps this
      // query tenant-scoped on its own terms rather than only by
      // construction, per the multi-tenancy skill's "new query" checklist.
      where: { id: In(ids), tenant_id: tenantId },
      relations: ['class_section', 'class_section.class', 'guardians'],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is Student => row != null);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * [8.15.11] Every student matching the list's own filters, as export rows in
   * the list's column order. Reuses `findAll`, so the teacher section scope
   * and every filter behave exactly as on screen.
   */
  exportHeader(): string[] {
    return ['Roll', 'Registration No.', 'Name', 'Class', 'Section', 'Guardian', 'Status'];
  }

  iterateForExport(query: QueryStudentDto, tenantId: string, sectionIds?: string[] | null) {
    return pagedRows(
      (page, limit) => this.findAll({ ...query, page, limit }, tenantId, sectionIds),
      (student: Student) => [
        student.roll_number,
        student.registration_number,
        student.full_name,
        student.class_section?.class?.name ?? '',
        student.class_section?.section_name ?? '',
        (student.guardians.find((g) => g.is_primary_contact) ?? student.guardians[0])?.full_name ??
          '',
        student.enrollment_status,
      ],
    );
  }

  async findOne(id: string, tenantId: string): Promise<Student> {
    const student = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['class_section', 'class_section.class', 'guardians'],
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        details: { code: 'STUDENT_NOT_FOUND' },
      });
    }
    return student;
  }

  /**
   * Loads several students with their guardians in one query, scoped to the
   * tenant. IDs that don't resolve are simply absent from the result — the
   * caller decides whether a missing student is an error, since "some of
   * these IDs are bad" and "this one ID is bad" want different responses.
   *
   * Exists so bulk flows (fee reminders) don't issue one findOne per student.
   */
  async findManyWithGuardians(ids: string[], tenantId: string): Promise<Student[]> {
    if (ids.length === 0) return [];
    return this.repo.find({
      where: { id: In(ids), tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['guardians'],
    });
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Student> {
    const existingStudent = await this.findOne(id, tenantId);

    // Validate class_section_id belongs to tenant if provided
    let section: ClassSection | null = null;
    if (dto.class_section_id) {
      section = await this.sectionRepo.findOne({
        where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
        relations: ['class'],
      });
      if (!section) {
        throw new NotFoundException('Class section not found');
      }
    }

    const updateData: any = { ...dto };
    if (dto.date_of_birth) {
      updateData.date_of_birth = new Date(dto.date_of_birth);
    }
    if (dto.guardian_ids !== undefined) {
      delete updateData.guardian_ids;
    }

    // [#1020] `class_section_id` changing has to keep the student's
    // current-year `Enrollment` row in sync, or exam cohort resolution
    // (which reads `Enrollment`, not `Student`) silently uses the stale
    // section (#994's reviewer finding). Both writes go through one
    // transaction so a failure on either side rolls back the whole update.
    const sectionChanged =
      !!dto.class_section_id && dto.class_section_id !== existingStudent.class_section_id;

    // [39.2.1] A section move on a student who has left would create a fresh ACTIVE enrollment
    // below (the "no ACTIVE enrollment for that year" branch), quietly reactivating them: no
    // permission check, no reason or date, no event, and `students.enrollment_status` left
    // disagreeing with the new row. Bringing a student back is POST /students/:id/readmit.
    if (sectionChanged && existingStudent.enrollment_status !== EnrollmentStatus.ACTIVE) {
      throw new ConflictException(
        'This student is not currently enrolled. Use "Readmit" to bring them back; moving them to a section cannot reactivate them.',
      );
    }

    await this.repo.manager.transaction(async (manager) => {
      const txStudentRepo = manager.getRepository(Student);
      const txEnrollmentRepo = manager.getRepository(Enrollment);

      // The validated DTO instance carries every declared property, `undefined` when the caller
      // did not send it. Only what was actually supplied counts: for the empty-body guard below
      // and for the audit diff (otherwise every unsent field looked like a change).
      // [68.3.40] A section move that keeps (or re-sends) the old roll gets the next free roll
      // in the target section; a different roll the user picked is kept (409 if taken).
      if (
        sectionChanged &&
        (dto.roll_number == null || dto.roll_number === existingStudent.roll_number)
      ) {
        updateData.roll_number = await nextRollNumber(manager, dto.class_section_id!, tenantId);
      }

      const supplied = Object.keys(updateData).filter((k) => updateData[k] !== undefined);

      // An empty body (`{}`) would make TypeORM throw UpdateValuesMissingError, a 500.
      if (supplied.length > 0) {
        try {
          await txStudentRepo.update({ id, tenant_id: tenantId }, updateData);
        } catch (err) {
          rethrowStudentUniqueConflict(err);
        }
      }

      // Every write goes to the audit log (epic 39 invariant). Only fields that actually
      // changed; health_notes is recorded as changed but never copied into the log.
      const masked = (key: string, value: unknown) =>
        key === 'health_notes' ? '[redacted]' : value;
      // `date_of_birth` is a DATE column (read back as "YYYY-MM-DD") but `updateData` holds a
      // Date, so compare the date part only; otherwise every save that re-sends the same
      // birthday would log a change that did not happen.
      const comparable = (key: string, value: unknown) =>
        key === 'date_of_birth' && value != null
          ? value instanceof Date
            ? value.toISOString().slice(0, 10)
            : String(value).slice(0, 10)
          : value;
      const changed = supplied.filter(
        (k) =>
          JSON.stringify(
            comparable(k, (existingStudent as unknown as Record<string, unknown>)[k]),
          ) !== JSON.stringify(comparable(k, updateData[k])),
      );
      if (changed.length > 0) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Student',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: Object.fromEntries(
              changed.map((k) => [
                k,
                masked(k, (existingStudent as unknown as Record<string, unknown>)[k]),
              ]),
            ),
            new_values: Object.fromEntries(changed.map((k) => [k, masked(k, updateData[k])])),
          },
          manager,
        );
      }

      if (sectionChanged && section) {
        // Keyed on the *new* section's own academic year — not "whichever
        // ACTIVE row is newest" — so a move across academic years updates
        // the enrollment for that year rather than silently repointing a
        // different year's row (leaves both years' exam cohorts wrong).
        const currentEnrollment = await txEnrollmentRepo.findOne({
          where: {
            student_id: id,
            tenant_id: tenantId,
            academic_year_id: section.class.academic_year_id,
            enrollment_status: EnrollmentStatus.ACTIVE,
          },
        });

        if (currentEnrollment) {
          await txEnrollmentRepo.update(
            { id: currentEnrollment.id },
            { class_id: section.class_id, section_id: section.id },
          );
        } else {
          // No ACTIVE enrollment for that year at all (e.g. the backfill
          // missed this student) — create one, same shape as
          // `create()`/the migration.
          await txEnrollmentRepo.save(
            txEnrollmentRepo.create({
              student_id: id,
              class_id: section.class_id,
              section_id: section.id,
              academic_year_id: section.class.academic_year_id,
              tenant_id: tenantId,
            }),
          );
        }
      }
    });

    // Replace guardian links if provided
    if (dto.guardian_ids !== undefined) {
      const student = await this.findOne(id, tenantId);
      const removedAny = (student.guardians ?? []).some((g) => !dto.guardian_ids!.includes(g.id));
      if (dto.guardian_ids.length > 0) {
        const guardians = await this.guardianRepo.find({
          where: { id: In(dto.guardian_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (guardians.length !== dto.guardian_ids.length) {
          throw new NotFoundException('One or more guardian IDs not found');
        }
        student.guardians = guardians;
      } else {
        student.guardians = [];
      }
      await this.repo.manager.transaction(async (m) => {
        await m.save(student);
        if (removedAny) await revokeInvoiceShareLinks(m, tenantId, [id]);
      });
    }

    return this.findOne(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<void> {
    await this.repo.manager.transaction(async (manager) => {
      // Lock the student row, then its bills and wallet below, so a concurrent
      // payment/wallet change on them waits for this delete to finish. Bill
      // generation and the first wallet credit take FOR SHARE on the student,
      // which conflicts with this lock, so neither can slip a new row past
      // the money check below.
      const locked = (await manager.query(
        `SELECT enrollment_status FROM students WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR NO KEY UPDATE`,
        [id, tenantId],
      )) as { enrollment_status: string }[];
      if (locked.length === 0) throw new NotFoundException('Student not found');

      // Bills the student can still pay, same set checkout accepts (OVERDUE too).
      // FOR UPDATE can't combine with SUM, so lock the rows, then add them up.
      const bills = (await manager.query(
        `SELECT sf.total_amount, sf.paid_amount, sf.discount_amount
           FROM student_fees sf
           JOIN students st ON st.id = sf.student_id AND st.tenant_id = $2
          WHERE sf.student_id = $1 AND sf.deleted_at IS NULL
            AND sf.status::text = ANY($3)
          ORDER BY sf.id
          FOR UPDATE OF sf`,
        [id, tenantId, OPEN_FEE_STATUSES],
      )) as { total_amount: string; paid_amount: string; discount_amount: string }[];
      // Integer cents so decimal strings never drift (0.1 + 0.2).
      const cents = (v: string) => Math.round(Number(v) * 100);
      const open_dues =
        bills.reduce(
          (sum, b) => sum + cents(b.total_amount) - cents(b.paid_amount) - cents(b.discount_amount),
          0,
        ) / 100;
      const wallet = await manager.getRepository(StudentWallet).findOne({
        where: { student_id: id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      const walletBalance = Number(wallet?.balance ?? 0);
      if (open_dues > 0 || walletBalance !== 0) {
        throw new ConflictException({
          message:
            'This student still has open dues or wallet money. Record leaving, or clear the money first.',
          // The error filter only forwards `details`, so the code lives here.
          details: {
            code: 'STUDENT_HAS_OPEN_MONEY',
            open_dues,
            wallet_balance: walletBalance,
          },
        });
      }

      const closed = await manager
        .createQueryBuilder()
        .update(Enrollment)
        .set({ enrollment_status: EnrollmentStatus.INACTIVE })
        .where({ student_id: id, tenant_id: tenantId, enrollment_status: EnrollmentStatus.ACTIVE })
        .returning(['id'])
        .execute();
      const active = closed.raw as { id: string }[];
      await manager
        .getRepository(Student)
        .update({ id, tenant_id: tenantId }, { enrollment_status: EnrollmentStatus.INACTIVE });
      await manager.getRepository(Student).softDelete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Student',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: {
            enrollment_status: locked[0]!.enrollment_status,
            closed_enrollment_ids: active.map((e) => e.id),
          },
          new_values: null,
        },
        manager,
      );
    });
  }
}

/**
 * [68.4.05] A guardian linked to a login (`user_id` set) has no phone/email of
 * its own: `users` owns them and copies them to every school's guardian row
 * (`syncLinkedGuardianContacts`). Editing them here would split the two copies
 * (SMS to one number, sign-in codes to another), so a change is refused with a
 * pointer. Resending the stored value is fine (phone in any format, email in any
 * case) and is dropped from the update, never written. Unlinked guardians are unaffected.
 */
function assertContactNotOwnedByLogin(
  guardian: Pick<Guardian, 'user_id' | 'phone' | 'email'>,
  updateData: Record<string, unknown>,
  message: string,
): void {
  if (!guardian.user_id) return;
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);
  const tail = (v: unknown) => (typeof v === 'string' ? bdPhoneTail(v) : v);
  const changed =
    (updateData.phone !== undefined && !same(tail(updateData.phone), tail(guardian.phone))) ||
    (updateData.email !== undefined && !same(lower(updateData.email), lower(guardian.email)));
  if (changed) {
    throw new ConflictException({ message, details: { code: 'CONTACT_OWNED_BY_LOGIN' } });
  }
  // Equal values are dropped, not written: `users` owns them, and writing back what was read
  // before the transaction could undo a login change synced in the meantime.
  delete updateData.phone;
  delete updateData.email;
}

/**
 * [8.10.7.4.13] D33: a guardian is incomplete when the name or relationship is blank, or both
 * phones are. One predicate for the dashboard card and `GET /guardians?incomplete=true`, so the
 * card's number always equals the list total. Alias must be `guardian`.
 */
export const INCOMPLETE_GUARDIAN_SQL = `(btrim(coalesce(guardian.full_name, '')) = ''
 OR btrim(coalesce(guardian.relationship, '')) = ''
 OR (btrim(coalesce(guardian.phone, '')) = '' AND btrim(coalesce(guardian.alternate_phone, '')) = ''))`;

@Injectable()
export class GuardianService {
  constructor(
    @InjectRepository(Guardian)
    private readonly repo: Repository<Guardian>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * @param manager Optional transaction-scoped manager — see StudentService.create.
   *
   * Audited with `entity_type: 'Guardian'`. Guardian phone/email are
   * authorized audit PII — they may land in `new_values` on this
   * ADMIN/ACCOUNTANT-only surface, but per [15.2.2] must never reach the
   * Nest logger or Sentry, which this never touches.
   */
  async create(
    dto: CreateGuardianDto,
    tenantId: string,
    manager?: EntityManager,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Guardian> {
    const run = async (txManager: EntityManager): Promise<Guardian> => {
      const repo = txManager.getRepository(Guardian);
      const studentRepo = txManager.getRepository(Student);

      const entity = repo.create({
        full_name: dto.full_name,
        relationship: dto.relationship ?? 'OTHER',
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        alternate_phone: dto.alternate_phone ?? null,
        address: dto.address ?? null,
        occupation: dto.occupation ?? null,
        preferred_communication: dto.preferred_communication,
        tenant_id: tenantId,
      });

      const saved = await repo.save(entity);

      // Link students if provided
      if (dto.student_ids?.length) {
        const students = await studentRepo.find({
          where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
        });
        if (students.length !== dto.student_ids.length) {
          throw new NotFoundException('One or more student IDs not found');
        }
        saved.students = students;
        await repo.save(saved);
      }

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'Guardian',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: {
            full_name: saved.full_name,
            relationship: saved.relationship,
            phone: saved.phone,
            email: saved.email,
            alternate_phone: saved.alternate_phone,
            address: saved.address,
            occupation: saved.occupation,
            preferred_communication: saved.preferred_communication,
          },
        },
        txManager,
      );

      return repo.findOne({
        where: { id: saved.id },
        relations: ['students'],
      }) as Promise<Guardian>;
    };

    // A caller passing its own manager (e.g. bulk-upload's guardian+student
    // atomic unit) already owns the transaction boundary — nesting a second
    // one here would be a no-op at best and a deadlock risk at worst, so
    // this only opens its own transaction when none was handed in.
    return manager ? run(manager) : this.repo.manager.transaction(run);
  }

  async findAll(query: QueryGuardianDto, tenantId: string, sectionIds?: string[] | null) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Two-phase (IDs, then hydrate) — see the identical comment on
    // StudentService.findAll / FeeStructureService.findAll. TypeORM's
    // pagination-with-joins path can't resolve a `COLLATE`-suffixed
    // `orderBy` expression, and `guardian.students` is many-to-many, so a
    // single joined query would also inflate `total` under `skip`/`take`.
    const buildIdQuery = () => {
      const qb = this.repo
        .createQueryBuilder('guardian')
        .select('guardian.id', 'id')
        .where('guardian.tenant_id = :tenantId', { tenantId })
        .andWhere('guardian.deleted_at IS NULL');

      // [68.3.01] TEACHER: only guardians linked to a live student in their sections.
      if (sectionIds) {
        if (sectionIds.length === 0) qb.andWhere('1 = 0');
        else
          qb.andWhere(
            `EXISTS (SELECT 1 FROM student_guardians sg
               INNER JOIN students st ON st.id = sg.student_id
                 AND st.tenant_id = :tenantId AND st.deleted_at IS NULL
               WHERE sg.guardian_id = guardian.id AND st.class_section_id IN (:...scopeSectionIds))`,
            { scopeSectionIds: sectionIds },
          );
      }

      const search = normalizeSearchTerm(query.search);
      if (search) {
        // Fixed to ILIKE (was Like — case-sensitive, so "rahim" missed "Rahim").
        qb.andWhere(
          '(guardian.full_name ILIKE :search OR guardian.phone ILIKE :search OR guardian.email ILIKE :search)',
          { search: `%${search}%` },
        );
      }
      if (query.relationship) {
        // Column holds mixed case (`Father` from forms, `OTHER` default) — match any case.
        qb.andWhere('LOWER(guardian.relationship) = LOWER(:relationship)', {
          relationship: query.relationship,
        });
      }
      if (query.preferred_communication) {
        qb.andWhere('guardian.preferred_communication = :preferredCommunication', {
          preferredCommunication: query.preferred_communication,
        });
      }
      if (query.is_primary_contact !== undefined) {
        qb.andWhere('guardian.is_primary_contact = :isPrimaryContact', {
          isPrimaryContact: query.is_primary_contact,
        });
      }
      if (query.incomplete === true) qb.andWhere(INCOMPLETE_GUARDIAN_SQL);

      return qb;
    };

    const total = await buildIdQuery().getCount();

    const idQb = buildIdQuery();
    if (query.sort === 'full_name') {
      idQb.orderBy(
        `guardian.full_name COLLATE "${BN_COLLATION}"`,
        query.order === 'desc' ? 'DESC' : 'ASC',
      );
    } else {
      idQb.orderBy('guardian.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    idQb.addOrderBy('guardian.id', 'ASC').offset(skip).limit(limit);

    const idRows = await idQb.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const rows = await this.repo.find({
      // `tenant_id` is redundant here — `ids` already came from the
      // tenant-scoped ID query above — but it costs nothing and keeps this
      // query tenant-scoped on its own terms rather than only by
      // construction, per the multi-tenancy skill's "new query" checklist.
      where: { id: In(ids), tenant_id: tenantId },
      relations: ['students'],
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const data = ids.map((id) => byId.get(id)).filter((row): row is Guardian => row != null);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** [8.15.11] Every guardian matching the list's own filters, as export rows. */
  exportHeader(): string[] {
    return ['Name', 'Relationship', 'Phone', 'Email', 'Primary contact', 'Students'];
  }

  iterateForExport(query: QueryGuardianDto, tenantId: string, sectionIds?: string[] | null) {
    return pagedRows(
      (page, limit) => this.findAll({ ...query, page, limit }, tenantId, sectionIds),
      (guardian: Guardian) => [
        guardian.full_name,
        guardian.relationship,
        guardian.phone ?? '',
        guardian.email ?? '',
        guardian.is_primary_contact ? 'Yes' : 'No',
        (guardian.students ?? []).map((s) => s.full_name).join('; '),
      ],
    );
  }

  async findOne(id: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students', 'students.class_section', 'students.class_section.class'],
    });
    if (!guardian) {
      throw new NotFoundException('Guardian not found');
    }
    return guardian;
  }

  async findByPhone(
    phone: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Guardian | null> {
    const repo = manager ? manager.getRepository(Guardian) : this.repo;
    // Phones are not unique: always the oldest match, so every caller agrees.
    return repo.findOne({
      where: { phone, tenant_id: tenantId, deleted_at: IsNull() },
      order: { created_at: 'ASC', id: 'ASC' },
    });
  }

  /** `findByPhone` for many phones in one query: phone -> its oldest live guardian. */
  async findOldestByPhones(phones: string[], tenantId: string): Promise<Map<string, Guardian>> {
    const unique = [...new Set(phones)];
    if (unique.length === 0) return new Map();
    const rows = await this.repo.find({
      where: { phone: In(unique), tenant_id: tenantId, deleted_at: IsNull() },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    const byPhone = new Map<string, Guardian>();
    for (const g of rows) if (g.phone && !byPhone.has(g.phone)) byPhone.set(g.phone, g);
    return byPhone;
  }

  /**
   * [LIFE-09] The oldest live guardian on this phone in any format, with
   * their linked students loaded. Admission stores phones canonical
   * ("8801…") while staff forms store them as typed ("01…"), so an exact
   * match would miss the family (#2374).
   */
  async findByPhoneAnyFormat(
    phone: string,
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Guardian | null> {
    const repo = manager ? manager.getRepository(Guardian) : this.repo;
    const match = await repo
      .createQueryBuilder('g')
      .select('g.id')
      .where('g.tenant_id = :tenantId AND g.deleted_at IS NULL', { tenantId })
      .andWhere(`right(regexp_replace(g.phone, '[^0-9]', '', 'g'), 10) = :tail`, {
        tail: bdPhoneTail(phone),
      })
      .orderBy('g.created_at', 'ASC')
      .addOrderBy('g.id', 'ASC')
      .getOne();
    return match
      ? repo.findOne({ where: { id: match.id, tenant_id: tenantId }, relations: ['students'] })
      : null;
  }

  /**
   * The guardian row linked to this user account, in this tenant.
   * `Guardian.user_id` is a unique one-to-one, so this is exact ownership —
   * no FamilyAccessService indirection needed (that models user → student). [5.4a]
   */
  async findOwn(userId: string, tenantId: string): Promise<Guardian> {
    const guardian = await this.repo.findOne({
      where: { user_id: userId, tenant_id: tenantId, deleted_at: IsNull() },
      relations: ['students', 'students.class_section', 'students.class_section.class'],
    });
    if (!guardian) {
      throw new NotFoundException('No guardian record is linked to your account');
    }
    return guardian;
  }

  /**
   * Self-service contact-detail edit. Ownership comes from the JWT sub,
   * never a path id. Audited the same as an ADMIN-driven update — the
   * actor is just the guardian themselves.
   */
  async updateOwn(
    userId: string,
    dto: UpdateOwnGuardianDto,
    tenantId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Guardian> {
    const guardian = await this.findOwn(userId, tenantId);

    const updateData: any = { ...dto };
    // `''` means "clear this column" — store a real NULL, as update() does.
    for (const key of ['phone', 'email', 'alternate_phone'] as const) {
      if (updateData[key] === '') updateData[key] = null;
    }

    assertContactNotOwnedByLogin(
      guardian,
      updateData,
      'This is your sign-in phone/email. Change it under "Contact" on your account page so sign-in and school messages both use the new one.',
    );

    const changedKeys = Object.keys(updateData);
    if (changedKeys.length > 0) {
      await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Guardian);
        const oldValues = Object.fromEntries(
          changedKeys.map((key) => [key, (guardian as any)[key]]),
        );

        // tenant_id stays in the criteria so this can never touch another
        // tenant's row even if ids were to collide.
        await repo.update({ id: guardian.id, tenant_id: tenantId }, updateData);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Guardian',
            entity_id: guardian.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: updateData,
          },
          manager,
        );
      });
    }

    return this.findOne(guardian.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateGuardianDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Guardian> {
    const existing = await this.findOne(id, tenantId);

    const updateData: any = { ...dto };
    if (dto.student_ids !== undefined) {
      delete updateData.student_ids;
    }

    // The edit-guardian dialog sends `''` (not an omitted key) to
    // explicitly clear one of these nullable columns — store that as a
    // real NULL rather than a stray empty string sitting in the column.
    for (const key of ['phone', 'email', 'alternate_phone', 'address', 'occupation'] as const) {
      if (updateData[key] === '') updateData[key] = null;
    }

    assertContactNotOwnedByLogin(
      existing,
      updateData,
      'This guardian signs in with this phone/email. The parent changes it from their account, or an admin edits their user.',
    );

    // Diffed against exactly the fields this request changed — see the
    // identical reasoning on FeeStructureService.update.
    const changedKeys = Object.keys(updateData);
    const auditOldValues: Record<string, unknown> = Object.fromEntries(
      changedKeys.map((key) => [key, (existing as any)[key]]),
    );
    const auditNewValues: Record<string, unknown> = { ...updateData };

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Guardian);
      const studentRepo = manager.getRepository(Student);

      if (changedKeys.length > 0) {
        await repo.update({ id, tenant_id: tenantId }, updateData);
      }

      // Replace student links if provided
      if (dto.student_ids !== undefined) {
        const guardian = await repo.findOneOrFail({
          where: { id, tenant_id: tenantId },
          relations: ['students'],
        });
        auditOldValues.student_ids = guardian.students.map((student) => student.id);
        await revokeInvoiceShareLinks(
          manager,
          tenantId,
          guardian.students.map((s) => s.id).filter((sid) => !dto.student_ids!.includes(sid)),
        );
        auditNewValues.student_ids = dto.student_ids;

        if (dto.student_ids.length > 0) {
          const students = await studentRepo.find({
            where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
          });
          if (students.length !== dto.student_ids.length) {
            throw new NotFoundException('One or more student IDs not found');
          }
          guardian.students = students;
        } else {
          guardian.students = [];
        }
        await repo.save(guardian);
      }

      if (Object.keys(auditNewValues).length > 0) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Guardian',
            entity_id: id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: auditOldValues,
            new_values: auditNewValues,
          },
          manager,
        );
      }
    });

    return this.findOne(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);
    let cutUserId: string | null = null;

    await this.repo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Guardian);
      const withStudents = await repo.findOneOrFail({
        where: { id, tenant_id: tenantId },
        relations: ['students'],
      });
      await revokeInvoiceShareLinks(
        manager,
        tenantId,
        withStudents.students.map((s) => s.id),
      );
      await repo.softDelete({ id, tenant_id: tenantId });

      // [2665] A guardian's portal login ends with the guardian: drop the PARENT
      // membership in this school. Memberships in other roles and schools stay.
      if (withStudents.user_id) {
        cutUserId = withStudents.user_id;
        await manager.softDelete(UserTenant, {
          user_id: withStudents.user_id,
          tenant_id: tenantId,
          role: UserRole.PARENT,
        });
      }

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Guardian',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { full_name: existing.full_name, relationship: existing.relationship },
          new_values: null,
        },
        manager,
      );
    });

    // [2665] Cut every session of the user after commit (Rule 8), so a refresh
    // racing the transaction cannot mint a token past the cutoff. App clock, same
    // SQL as SessionCutoffService.cutOff (not injected: GuardianService is built
    // by hand in many specs and AuthModule is not a students dependency).
    if (cutUserId) {
      await this.repo.manager.query(
        `UPDATE "users" SET "tokens_valid_after" = $2 WHERE "id" = $1`,
        [cutUserId, new Date()],
      );
    }
  }
}
