import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { assertDemoRowLimit } from '../demo/demo-row-limit';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, QueryFailedError, EntityManager } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import type { BulkImportErrorDto } from '../bulk-import/dto/bulk-import.dto';
import { Student } from './entities/student.entity';
import { StudentService, GuardianService } from './students.service';
import { parseSpreadsheet, ParsedRow } from './bulk-upload.parser';
import {
  BulkUploadErrorDto,
  BulkUploadResultDto,
  BulkUploadRowDto,
  BulkUploadValidateResultDto,
  BulkUploadPreviewRowDto,
} from './dto/students.dto';
import { AuditAction, CommunicationMedium } from '@biddaloy/shared';
import { assertSeatsAvailable, getSeatUsage } from '../schools/trial/seat-limit.service';
import { ROLL_NUMBER_MAX } from './roll-number.util';
import { normalizeBdPhoneNumber } from '../communications/providers/shared/phone-number.util';

function isSeatLimitError(err: ConflictException): boolean {
  const body = err.getResponse() as { details?: { code?: string } };
  return body.details?.code === 'SEAT_LIMIT_REACHED';
}

/**
 * A row-scoped failure enriched with which spreadsheet column the problem
 * sits in and the offending cell value, when a single culprit exists.
 * Extends BadRequestException so the row-scoped-vs-whole-request catch in
 * `validate`/`commit` keeps working unchanged.
 */
/** The shape `StudentService.create` auto-numbers (`REG-<year>-NNNN`). */
const AUTO_REGISTRATION_NUMBER = /^REG-\d{4}-\d+$/;

class BulkRowError extends BadRequestException {
  constructor(
    message: string,
    readonly field?: string,
    readonly value?: string,
  ) {
    super(message);
  }
}

/** Current-academic-year class/section names resolved once per upload. */
interface ClassSectionLookup {
  /** `"<class name>::<section name>"` → class-section id. */
  sectionIdByKey: Map<string, string>;
  /** Every class name of the year, sections or not. */
  classNames: Set<string>;
}

interface GuardianInput {
  name: string;
  phone: string;
  email?: string;
}

/**
 * A plain, JSON-serialisable row shape holding everything `createRow` needs
 * — deliberately not a `BulkUploadRowDto` instance, since the staged payload
 * round-trips through Redis as JSON and only plain data survives that.
 */
interface ValidatedBulkUploadRow {
  rowNumber: number;
  student_name: string;
  class: string;
  section: string;
  roll?: string;
  registration_number?: string;
  card_no?: string;
  guardian1_name: string;
  guardian1_phone: string;
  guardian1_email?: string;
  guardian2_name?: string;
  guardian2_phone?: string;
  guardian2_email?: string;
  /** Guardians the validate warning named; commit refuses a row if that phone now resolves elsewhere. */
  guardian1_match_id?: string;
  guardian2_match_id?: string;
  home_address?: string;
  preferred_communication?: string;
  classSectionId: string;
  rollNumber?: number;
}

/**
 * [LIFE-12] Same section + name (case and spacing ignored) + guardian phone (any accepted
 * format: +880…, 880… and 01… are one number) is the same student.
 */
function dedupKey(sectionId: string, name: string, phone: string): string {
  const normName = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${sectionId}::${normName}::${normalizeBdPhoneNumber(phone)}`;
}

function rowDedupKey(row: ValidatedBulkUploadRow): string {
  return dedupKey(row.classSectionId, row.student_name, row.guardian1_phone);
}

/** What `validate` stages under a `staging_id`, for `commit` to consume exactly once. */
interface StagedBulkUpload {
  filename: string;
  rows: ValidatedBulkUploadRow[];
  hardErrorCount: number;
}

@Injectable()
export class StudentBulkUploadService {
  private readonly logger = new Logger(StudentBulkUploadService.name);

  constructor(
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    private readonly auditService: AuditService,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
  ) {}

  /**
   * Parses and validates the upload — headers, per-row DTO shape, class/
   * section existence, duplicate roll numbers within the file — without
   * writing anything. Accepted rows are staged under a `staging_id` for a
   * later `commit`; rejected rows are reported as errors and never staged.
   */
  async validate(
    file: Express.Multer.File | undefined,
    tenantId: string,
    userId: string | undefined,
  ): Promise<BulkUploadValidateResultDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const rows: ParsedRow[] = await parseSpreadsheet(file.buffer, file.originalname);
    assertDemoRowLimit(rows.length);

    const classSections = await this.buildClassSectionMap(tenantId);
    const rollsSeenThisRequest = new Map<string, Set<number>>();

    const errors: BulkImportErrorDto[] = [];
    let staged: ValidatedBulkUploadRow[] = [];
    let preview: BulkUploadPreviewRowDto[] = [];

    for (const parsed of rows) {
      try {
        const row = await this.validateRow(parsed, classSections, rollsSeenThisRequest);
        staged.push(row);
        preview.push({
          row: row.rowNumber,
          student_name: row.student_name,
          class: row.class,
          section: row.section,
          guardian1_phone: row.guardian1_phone,
        });
      } catch (err) {
        if (err instanceof BadRequestException) {
          errors.push({
            row: parsed.rowNumber,
            tab: undefined,
            column: err instanceof BulkRowError ? (err.field ?? null) : null,
            value: err instanceof BulkRowError ? err.value : undefined,
            severity: 'error',
            message: this.describeError(err),
          });
        } else {
          throw err;
        }
      }
    }

    // [LIFE-12] A re-uploaded file must not import the same students again: a row whose
    // section + name + guardian1 phone already belongs to a live student, or to an earlier
    // row of this same file, is a blocking error. One query for the whole file (files run
    // to 2,000 rows).
    if (staged.length > 0) {
      const byKey = await this.liveStudentsByDedupKey(this.classRepo.manager, tenantId, staged);
      const firstRowByKey = new Map<string, number>();
      const dropped = new Set<number>();
      staged.forEach((row, i) => {
        const key = rowDedupKey(row);
        const match = byKey.get(key);
        const firstRow = firstRowByKey.get(key);
        if (!match && firstRow === undefined) {
          firstRowByKey.set(key, row.rowNumber);
          return;
        }
        dropped.add(i);
        errors.push({
          row: row.rowNumber,
          tab: undefined,
          column: 'student_name',
          value: row.student_name,
          severity: 'error',
          message: match
            ? `Already imported: ${match.full_name} (${match.registration_number}) is in this section with the same guardian phone. Remove this row to import the rest.`
            : `Duplicate: this student is also in row ${firstRow} of this file, in the same section with the same guardian phone. Remove one of the two rows.`,
        });
      });
      staged = staged.filter((_, i) => !dropped.has(i));
      preview = preview.filter((_, i) => !dropped.has(i));
    }

    // [F-025] A roll already held in the section (a soft-deleted student keeps its roll: the unique
    // index is not partial) is a validate-time error, so `rows_to_create` matches what commit creates.
    if (staged.some((r) => r.rollNumber !== undefined)) {
      const withRoll = staged.filter((r) => r.rollNumber !== undefined);
      const held = await this.classRepo.manager.find(Student, {
        select: { class_section_id: true, roll_number: true },
        where: {
          tenant_id: tenantId,
          class_section_id: In([...new Set(withRoll.map((r) => r.classSectionId))]),
          roll_number: In([...new Set(withRoll.map((r) => r.rollNumber as number))]),
        },
        withDeleted: true,
      });
      const heldKeys = new Set(held.map((s) => `${s.class_section_id}::${s.roll_number}`));
      const dropped = new Set<number>();
      staged.forEach((row, i) => {
        if (
          row.rollNumber === undefined ||
          !heldKeys.has(`${row.classSectionId}::${row.rollNumber}`)
        )
          return;
        dropped.add(i);
        errors.push({
          row: row.rowNumber,
          tab: undefined,
          column: 'roll',
          severity: 'error',
          message: 'This roll number is already used in this section.',
        });
      });
      staged = staged.filter((_, i) => !dropped.has(i));
      preview = preview.filter((_, i) => !dropped.has(i));
    }

    // [F-023] A supplied registration number must be unique in the file and in the school (the
    // unique index is not partial, so a soft-deleted student still holds its number).
    if (staged.some((r) => r.registration_number)) {
      const held = new Set(
        (
          await this.classRepo.manager.find(Student, {
            select: { registration_number: true },
            where: {
              tenant_id: tenantId,
              registration_number: In(staged.flatMap((r) => r.registration_number ?? [])),
            },
            withDeleted: true,
          })
        ).map((s) => s.registration_number),
      );
      const seen = new Set<string>();
      const dropped = new Set<number>();
      staged.forEach((row, i) => {
        const reg = row.registration_number;
        if (!reg) return;
        const message = seen.has(reg)
          ? 'This registration number appears more than once in this file.'
          : held.has(reg)
            ? 'This registration number is already used by another student.'
            : undefined;
        seen.add(reg);
        if (!message) return;
        dropped.add(i);
        errors.push({
          row: row.rowNumber,
          tab: undefined,
          column: 'registration_number',
          severity: 'error',
          message,
        });
      });
      staged = staged.filter((_, i) => !dropped.has(i));
      preview = preview.filter((_, i) => !dropped.has(i));
    }

    // [76.2.06] A supplied card number must be unique in the file and among the school's live
    // students (the index ignores soft-deleted ones). Fixed texts, no value, no holder (D19).
    if (staged.some((r) => r.card_no)) {
      const held = new Set(
        (
          await this.classRepo.manager.find(Student, {
            select: { card_no: true },
            where: {
              tenant_id: tenantId,
              card_no: In(staged.flatMap((r) => r.card_no ?? [])),
              deleted_at: IsNull(),
            },
          })
        ).map((s) => s.card_no),
      );
      const seenCards = new Set<string>();
      const droppedCards = new Set<number>();
      staged.forEach((row, i) => {
        const card = row.card_no;
        if (!card) return;
        const message = seenCards.has(card)
          ? 'This card number appears more than once in this file.'
          : held.has(card)
            ? 'This card number is already in use.'
            : undefined;
        seenCards.add(card);
        if (!message) return;
        droppedCards.add(i);
        errors.push({
          row: row.rowNumber,
          tab: undefined,
          column: 'card_no',
          severity: 'error',
          message,
        });
      });
      staged = staged.filter((_, i) => !droppedCards.has(i));
      preview = preview.filter((_, i) => !droppedCards.has(i));
    }

    // [LIFE-09] Joining an existing family is allowed but visible: committing after
    // seeing this warning is the staff confirmation. One query for the whole file.
    const matchByPhone = await this.guardianService.findOldestByPhones(
      staged.flatMap((r) => [r.guardian1_phone, r.guardian2_phone]).filter((p): p is string => !!p),
      tenantId,
    );
    for (const row of staged) {
      const phones = [
        ['guardian1_phone', row.guardian1_phone],
        // A second guardian on the first guardian's phone is the same match: warn once.
        [
          'guardian2_phone',
          row.guardian2_phone === row.guardian1_phone ? undefined : row.guardian2_phone,
        ],
      ] as const;
      for (const [column, phone] of phones) {
        const match = phone ? matchByPhone.get(phone) : undefined;
        if (!match) continue;
        if (column === 'guardian1_phone') row.guardian1_match_id = match.id;
        else row.guardian2_match_id = match.id;
        errors.push({
          row: row.rowNumber,
          tab: undefined,
          column,
          value: phone,
          severity: 'warning',
          message: `Will be linked to existing guardian "${match.full_name}"`,
        });
      }
    }

    // [13.2.3] Every row creates an ACTIVE student, so the file as a whole must fit the seats left.
    // Blocking (counts as a hard error) — commit also re-checks under a lock.
    const seatUsage = await getSeatUsage(this.classRepo.manager, tenantId);
    if (seatUsage.limit !== null && seatUsage.used + staged.length > seatUsage.limit) {
      errors.push({
        row: 0,
        tab: undefined,
        column: null,
        severity: 'error',
        message: `Seat limit reached: ${seatUsage.used} of ${seatUsage.limit} seats in use, and this file adds ${staged.length}`,
      });
    }

    const hardErrorCount = errors.filter((e) => e.severity === 'error').length;
    const stagedPayload: StagedBulkUpload = {
      filename: file.originalname,
      rows: staged,
      hardErrorCount,
    };
    const { stagingId, expiresAt } = await this.staging.stage(
      tenantId,
      userId ?? '',
      stagedPayload,
    );

    return {
      staging_id: stagingId,
      expires_at: expiresAt,
      rows_to_create: staged.length,
      // Capped so a 2,000-row file doesn't ship every row in the preview
      // payload — the admin is confirming a shape, not proofreading.
      preview: preview.slice(0, 20),
      errors,
      hard_error_count: hardErrorCount,
      seats: { ...seatUsage, new_rows: staged.length },
    };
  }

  /**
   * Consumes the staged payload (single use — a second `commit` call 404s)
   * and actually creates the students and guardians.
   *
   * Refuses (409) when the staged validation had any error, even though the
   * accepted rows themselves are still fine to write: the client is never
   * expected to offer commit in that state, so reaching here with
   * `hardErrorCount > 0` means either a stale UI or a client bypassing its
   * own gate — the server does not silently import a subset in that case.
   */
  async commit(
    stagingId: string,
    tenantId: string,
    userId: string | undefined,
  ): Promise<BulkUploadResultDto> {
    const staged = await this.staging.consume<StagedBulkUpload>(tenantId, userId ?? '', stagingId);
    if (!staged) {
      throw new NotFoundException(
        'No staged upload found for this id. It may have expired or already been committed.',
      );
    }
    assertDemoRowLimit(staged.rows.length);
    if (staged.hardErrorCount > 0) {
      throw new ConflictException(
        'This staged upload had validation errors and cannot be committed. Re-validate the file first.',
      );
    }

    // [13.2.3] Refuse the whole file up front so a full school never gets a partial import. Each
    // row's own create re-checks under the lock, which covers a concurrent create racing this one.
    await this.classRepo.manager.transaction(async (m) => {
      // [LIFE-12] Validate ran before this; another staging of the same file may have committed
      // since. Refuse the whole file rather than import those students twice.
      const live = await this.liveStudentsByDedupKey(m, tenantId, staged.rows);
      const clash = staged.rows.find((r) => live.has(rowDedupKey(r)));
      if (clash) {
        throw new ConflictException({
          message: `Row ${clash.rowNumber} (${clash.student_name}) was imported after this file was validated. Re-validate the file.`,
          details: { code: 'BULK_UPLOAD_ALREADY_IMPORTED', row: clash.rowNumber },
        });
      }
      await assertSeatsAvailable(m, tenantId, staged.rows.length);
    });

    const errors: BulkUploadErrorDto[] = [];
    const createdStudentIds: string[] = [];
    const guardianCache = new Map<string, string>();

    for (const row of staged.rows) {
      try {
        const studentId = await this.createRow(row, tenantId, guardianCache, userId);
        createdStudentIds.push(studentId);
      } catch (err) {
        // [13.2.3] A concurrent create can fill the school mid-commit. Report that row (and every
        // later one, which will hit the same wall) as an error, so the audit row and the response
        // match what was actually written instead of the whole request failing after a partial write.
        if (err instanceof ConflictException && isSeatLimitError(err)) {
          errors.push({ row: row.rowNumber, field: 'seat_limit', reason: err.message });
        } else if (err instanceof BadRequestException) {
          errors.push({
            row: row.rowNumber,
            ...(err instanceof BulkRowError && err.field !== undefined ? { field: err.field } : {}),
            ...(err instanceof BulkRowError && err.value !== undefined ? { value: err.value } : {}),
            reason: this.describeError(err),
          });
        } else if (err instanceof HttpException) {
          // e.g. ROLL_NUMBER_EXHAUSTED: a deliberate, user-safe message.
          errors.push({ row: row.rowNumber, reason: this.describeError(err) });
        } else {
          // Never echo database text; the original goes to the log only.
          this.logger.error(`Bulk upload row ${row.rowNumber} failed`, (err as Error)?.stack);
          errors.push({ row: row.rowNumber, reason: 'Could not be created' });
        }
      }
    }

    await this.auditService.record({
      action: AuditAction.BULK_UPLOAD,
      entity_type: 'Student',
      tenant_id: tenantId,
      performed_by_user_id: userId ?? null,
      new_values: {
        filename: staged.filename,
        total_rows: staged.rows.length,
        success_count: createdStudentIds.length,
        error_count: errors.length,
      },
    });

    return {
      total_rows: staged.rows.length,
      success_count: createdStudentIds.length,
      error_count: errors.length,
      created_student_ids: createdStudentIds,
      errors,
    };
  }

  /** [LIFE-12] Live students of the rows' sections, keyed like `rowDedupKey`. One query. */
  private async liveStudentsByDedupKey(
    manager: EntityManager,
    tenantId: string,
    rows: ValidatedBulkUploadRow[],
  ): Promise<Map<string, Student>> {
    const byKey = new Map<string, Student>();
    const sectionIds = [...new Set(rows.map((r) => r.classSectionId))];
    if (sectionIds.length === 0) return byKey;
    const existing = await manager.find(Student, {
      where: { tenant_id: tenantId, class_section_id: In(sectionIds), deleted_at: IsNull() },
      relations: ['guardians'],
    });
    for (const st of existing) {
      for (const g of st.guardians) {
        if (g.phone) byKey.set(dedupKey(st.class_section_id, st.full_name, g.phone), st);
      }
    }
    return byKey;
  }

  /**
   * Everything checkable without touching the database beyond read-only
   * lookups: DTO shape, class/section existence, and duplicate roll numbers
   * already seen earlier in this same file. Throws `BulkRowError` — never
   * writes. Mutates `rollsSeenThisRequest` on acceptance, same as the old
   * single-pass `processRow` did, so a later row in the same file still
   * sees this one's roll number as taken.
   */
  private async validateRow(
    parsed: ParsedRow,
    classSections: ClassSectionLookup,
    rollsSeenThisRequest: Map<string, Set<number>>,
  ): Promise<ValidatedBulkUploadRow> {
    const dto = plainToInstance(BulkUploadRowDto, this.toDtoInput(parsed.values));
    const validationErrors = await validate(dto);
    if (validationErrors.length > 0) {
      const messages = validationErrors.flatMap((e) => Object.values(e.constraints ?? {}));
      if (validationErrors.length === 1) {
        const failed = validationErrors[0];
        const rawValue = (parsed.values as Record<string, string | undefined>)[failed.property];
        throw new BulkRowError(
          messages.join('; '),
          failed.property,
          rawValue === '' ? undefined : rawValue,
        );
      }
      throw new BadRequestException(messages.join('; '));
    }

    const sectionKey = `${dto.class}::${dto.section}`;
    const classSectionId = classSections.sectionIdByKey.get(sectionKey);
    if (!classSectionId) {
      const classExists = classSections.classNames.has(dto.class);
      throw new BulkRowError(
        `Class '${dto.class}' / Section '${dto.section}' not found for the current academic year`,
        classExists ? 'section' : 'class',
        classExists ? dto.section : dto.class,
      );
    }

    const registrationNumber = dto.registration_number?.trim() || undefined;
    // REG-<year>-<digits> is the auto series nextTenantSerial counts: a supplied number there
    // could collide with the next auto number or push it past 15 digits (then every later
    // auto-numbered create in the school fails). Rule 23: no value in the message.
    if (registrationNumber && AUTO_REGISTRATION_NUMBER.test(registrationNumber)) {
      throw new BulkRowError(
        'Numbers like REG-<year>-<number> are kept for automatic numbering. Leave the cell blank to get one, or use another format.',
        'registration_number',
      );
    }

    let rollNumber: number | undefined;
    if (dto.roll) {
      rollNumber = parseInt(dto.roll, 10);
      // Rule 23: no submitted value in the message.
      if (rollNumber > ROLL_NUMBER_MAX) {
        throw new BulkRowError(`Roll number must be at most ${ROLL_NUMBER_MAX}`, 'roll');
      }
      const seen = rollsSeenThisRequest.get(classSectionId) ?? new Set<number>();
      if (seen.has(rollNumber)) {
        throw new BulkRowError(
          `Duplicate roll number ${rollNumber} in class '${dto.class}' section '${dto.section}' (already used earlier in this file)`,
          'roll',
          dto.roll,
        );
      }
      seen.add(rollNumber);
      rollsSeenThisRequest.set(classSectionId, seen);
    }

    return {
      rowNumber: parsed.rowNumber,
      student_name: dto.student_name,
      class: dto.class,
      section: dto.section,
      roll: dto.roll,
      registration_number: registrationNumber,
      card_no: dto.card_no,
      guardian1_name: dto.guardian1_name,
      guardian1_phone: dto.guardian1_phone,
      guardian1_email: dto.guardian1_email,
      guardian2_name: dto.guardian2_name,
      guardian2_phone: dto.guardian2_phone,
      guardian2_email: dto.guardian2_email,
      home_address: dto.home_address,
      preferred_communication: dto.preferred_communication,
      classSectionId,
      rollNumber,
    };
  }

  /**
   * The DB-writing half of the old `processRow`: guardian resolution/
   * creation and student creation as one transaction, so a student-create
   * failure rolls back any guardian newly created for this row instead of
   * leaving it orphaned. Runs only from `commit`, over already-validated,
   * staged rows.
   */
  private async createRow(
    row: ValidatedBulkUploadRow,
    tenantId: string,
    guardianCache: Map<string, string>,
    userId: string | undefined,
  ): Promise<string> {
    const guardianResolutions: { phone: string; id: string }[] = [];
    let studentId: string;
    try {
      studentId = await this.classRepo.manager.transaction(async (manager) => {
        const guardianIds: string[] = [];

        const g1Id = await this.resolveGuardian(
          { name: row.guardian1_name, phone: row.guardian1_phone, email: row.guardian1_email },
          tenantId,
          guardianCache,
          manager,
          userId,
          row.guardian1_match_id,
        );
        guardianResolutions.push({ phone: row.guardian1_phone, id: g1Id });
        guardianIds.push(g1Id);

        if (row.guardian2_name) {
          const g2Id = await this.resolveGuardian(
            {
              name: row.guardian2_name,
              phone: row.guardian2_phone as string,
              email: row.guardian2_email,
            },
            tenantId,
            guardianCache,
            manager,
            userId,
            row.guardian2_match_id ??
              (row.guardian2_phone === row.guardian1_phone ? row.guardian1_match_id : undefined),
          );
          guardianResolutions.push({ phone: row.guardian2_phone as string, id: g2Id });
          guardianIds.push(g2Id);
        }

        const student = await this.studentService.create(
          {
            full_name: row.student_name,
            class_section_id: row.classSectionId,
            roll_number: row.rollNumber,
            card_no: row.card_no,
            home_address: row.home_address,
            preferred_communication: row.preferred_communication as CommunicationMedium,
            guardian_ids: guardianIds,
          },
          tenantId,
          manager,
          userId ? { userId } : undefined,
          // Never in the auto series: validateRow refuses REG-<year>-<digits>.
          { registrationNumber: row.registration_number },
        );
        return student.id;
      });
    } catch (err) {
      // [68.3.40] StudentService.create now turns the roll unique violation
      // into a 409 ROLL_NUMBER_TAKEN itself, so the raw 23505 never reaches here.
      const rollTaken =
        err instanceof ConflictException &&
        (err.getResponse() as { details?: { code?: string } }).details?.code ===
          'ROLL_NUMBER_TAKEN';
      if (rollTaken || this.isUniqueViolation(err)) {
        if (
          row.rollNumber !== undefined &&
          (rollTaken || this.violatedColumns(err).includes('roll_number'))
        ) {
          throw new BulkRowError(
            `Duplicate roll number ${row.rollNumber} in class '${row.class}' section '${row.section}'`,
            'roll',
            row.roll,
          );
        }
        throw new BadRequestException('A student with conflicting unique fields already exists');
      }
      throw err;
    }

    // Only cache guardian ids once the transaction has actually committed —
    // caching them earlier could hand a later row a reference to a guardian
    // that got rolled back by this row's own failure.
    for (const { phone, id } of guardianResolutions) {
      guardianCache.set(phone, id);
    }

    return studentId;
  }

  private toDtoInput(raw: Record<string, string>): Record<string, string | undefined> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = value === '' ? undefined : value;
    }
    return out;
  }

  private async buildClassSectionMap(tenantId: string): Promise<ClassSectionLookup> {
    const currentYear = await this.academicYearRepo.findOne({
      where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
    });
    if (!currentYear) {
      throw new BadRequestException('No current academic year configured for this tenant');
    }

    const classes = await this.classRepo.find({
      where: { tenant_id: tenantId, academic_year_id: currentYear.id, deleted_at: IsNull() },
    });
    const classIds = classes.map((c) => c.id);
    const sections = classIds.length
      ? await this.sectionRepo.find({
          where: { tenant_id: tenantId, class_id: In(classIds), deleted_at: IsNull() },
        })
      : [];

    const classById = new Map(classes.map((c) => [c.id, c]));
    const sectionIdByKey = new Map<string, string>();
    for (const section of sections) {
      const cls = classById.get(section.class_id);
      if (!cls) continue;
      sectionIdByKey.set(`${cls.name}::${section.section_name}`, section.id);
    }
    return { sectionIdByKey, classNames: new Set(classes.map((c) => c.name)) };
  }

  private async resolveGuardian(
    info: GuardianInput,
    tenantId: string,
    cache: Map<string, string>,
    manager: EntityManager,
    userId: string | undefined,
    expectedId?: string,
  ): Promise<string> {
    const cached = cache.get(info.phone);
    const existing = cached
      ? undefined
      : await this.guardianService.findByPhone(info.phone, tenantId, manager);
    const foundId = cached ?? existing?.id;
    // Staff confirmed a warning naming this guardian; linking anyone else (or
    // creating a new one) would be a family they never saw.
    if (expectedId && foundId !== expectedId) {
      throw new BulkRowError(
        'The existing guardian this row was going to join changed since validation — validate the file again',
        'guardian_phone',
        info.phone,
      );
    }
    if (foundId) return foundId;

    const created = await this.guardianService.create(
      { full_name: info.name, phone: info.phone, email: info.email },
      tenantId,
      manager,
      userId ?? null,
    );
    return created.id;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505'
    );
  }

  private violatedColumns(err: unknown): string[] {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail !== 'string') return [];
    const match = /^Key \(([^)]+)\)=/.exec(detail);
    if (!match) return [];
    return match[1].split(',').map((column) => column.trim());
  }

  private describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
