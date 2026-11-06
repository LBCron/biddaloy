import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import Redis from 'ioredis';
import { StudentBulkUploadService } from './bulk-upload.service';
import { StudentService, GuardianService } from './students.service';
import { BulkUploadResultDto } from './dto/students.dto';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { ImportStagingService, BULK_IMPORT_REDIS } from '../bulk-import/import-staging.service';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { REQUIRED_HEADERS, BulkUploadHeader } from './bulk-upload.parser';
import { AuditAction } from '@biddaloy/shared';

/**
 * Integration tests for StudentBulkUploadService (issue #10).
 *
 * Runs against a real PostgreSQL database. Covers row-level validation,
 * class/section resolution by name, sibling guardian dedup, duplicate roll
 * detection (both intra-file and pre-existing), tenant isolation, and
 * CSV/XLSX parity, all through the real HTTP-adjacent service entrypoint.
 */

const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const OTHER_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000921';
const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000922';
const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000923';

const DEFAULTS: Record<BulkUploadHeader, string> = {
  student_name: 'Alice Rahman',
  class: 'Class One',
  section: 'Section A',
  roll: '',
  registration_number: '',
  guardian1_name: 'Karim Rahman',
  guardian1_phone: '+8801711111111',
  guardian1_email: '',
  guardian2_name: '',
  guardian2_phone: '',
  guardian2_email: '',
  home_address: '',
  preferred_communication: '',
};

function rowValues(
  headers: readonly string[],
  overrides: Partial<Record<BulkUploadHeader, string>> = {},
): string[] {
  const merged = { ...DEFAULTS, ...overrides };
  return headers.map((h) => merged[h as BulkUploadHeader] ?? '');
}

async function buildXlsxFile(
  rows: string[][],
  filename = 'students.xlsx',
): Promise<Express.Multer.File> {
  // [76.2.06] A row one cell longer than the schema carries the optional card_no column.
  const headers: string[] = [...REQUIRED_HEADERS];
  if (rows.some((r) => r.length > headers.length)) headers.push('card_no');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname: filename } as Express.Multer.File;
}

function buildCsvFile(rows: string[][], filename = 'students.csv'): Express.Multer.File {
  const headers = [...REQUIRED_HEADERS];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return {
    buffer: Buffer.from(lines.join('\n'), 'utf-8'),
    originalname: filename,
  } as Express.Multer.File;
}

async function seedReferenceData(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM audit_logs');
  await ds.query('DELETE FROM guardians');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');
  await ds.query('DELETE FROM users');

  const schoolRepo = ds.getRepository(School);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);
  const ayRepo = ds.getRepository(AcademicYear);
  const userRepo = ds.getRepository(User);

  await userRepo.save(
    userRepo.create({
      id: SEED_ADMIN_USER_ID,
      email: SEED_ADMIN_EMAIL,
      password_hash: SEED_ADMIN_PASSWORD_HASH,
      full_name: 'Test Admin',
    }),
  );

  await schoolRepo.save(
    schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: SEED_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: SEED_CLASS_1_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_CLASS_1_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  await schoolRepo.save(
    schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: OTHER_ACADEMIC_YEAR_ID,
      name: '2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: OTHER_CLASS_ID,
      name: 'Class One',
      academic_year_id: OTHER_ACADEMIC_YEAR_ID,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: OTHER_SECTION_ID,
      section_name: 'Section A',
      class_id: OTHER_CLASS_ID,
      tenant_id: OTHER_TENANT_ID,
    }),
  );
}

describe('StudentBulkUploadService (integration)', () => {
  let service: StudentBulkUploadService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;
  let module_: Awaited<ReturnType<typeof createTestModule>>;

  const TENANT_ID = SEED_TENANT_ID;
  const headers = [...REQUIRED_HEADERS];

  /**
   * Drives the real two-step flow and folds the result back into the old
   * `BulkUploadResultDto` shape most of these tests already assert against.
   *
   * [14.9.1] changed the all-or-nothing rule: a staged upload with ANY row
   * error is refused outright at commit (409), rather than committing the
   * good rows and reporting the bad ones alongside — so unlike the old
   * `process()`, a batch with one bad row among good ones now yields
   * `success_count: 0`, not a partial count. Tests that assumed partial
   * success are updated below to reflect that; see also the ticket's own
   * "hard_error_count === 0" acceptance criterion.
   */
  async function runUpload(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
  ): Promise<BulkUploadResultDto & { staging_id: string }> {
    const validated = await service.validate(file, tenantId, userId);
    if (validated.hard_error_count > 0) {
      return {
        staging_id: validated.staging_id,
        total_rows: validated.rows_to_create + validated.errors.length,
        success_count: 0,
        error_count: validated.errors.length,
        created_student_ids: [],
        errors: validated.errors.map((e) => ({
          row: e.row,
          ...(e.column ? { field: e.column } : {}),
          ...(e.value !== undefined ? { value: e.value } : {}),
          reason: e.message,
        })),
      };
    }
    const committed = await service.commit(validated.staging_id, tenantId, userId);
    return { ...committed, staging_id: validated.staging_id };
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        StudentBulkUploadService,
        StudentService,
        GuardianService,
        AuditService,
        ImportStagingService,
        {
          provide: BULK_IMPORT_REDIS,
          useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'),
        },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );

    module_ = module;
    service = module.get<StudentBulkUploadService>(StudentBulkUploadService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    if (dataSource) {
      await dataSource.query('DELETE FROM student_guardians');
      await dataSource.query('DELETE FROM audit_logs');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('seat limit [13.2.3]', () => {
    afterEach(async () => {
      await dataSource.getRepository(School).update(TENANT_ID, { seat_limit: null });
    });

    it('validate reports seats and a blocking error when the file would pass the limit', async () => {
      await dataSource.getRepository(School).update(TENANT_ID, { seat_limit: 1 });
      const file = await buildXlsxFile([
        rowValues(headers, { student_name: 'One', guardian1_phone: '+8801711111111' }),
        rowValues(headers, { student_name: 'Two', guardian1_phone: '+8801722222222' }),
      ]);

      const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);

      expect(validated.seats).toEqual({ used: 0, limit: 1, new_rows: 2 });
      expect(validated.hard_error_count).toBeGreaterThan(0);
      // The staged upload carries the error, so commit refuses it.
      await expect(
        service.commit(validated.staging_id, TENANT_ID, SEED_ADMIN_USER_ID),
      ).rejects.toThrow(/validation errors/);
    });

    it('commit re-checks under the lock and writes nothing when the school filled up meanwhile', async () => {
      const file = await buildXlsxFile([
        rowValues(headers, { student_name: 'One', guardian1_phone: '+8801733333333' }),
        rowValues(headers, { student_name: 'Two', guardian1_phone: '+8801744444444' }),
      ]);
      const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);
      expect(validated.hard_error_count).toBe(0); // unlimited at validate time
      const before = await studentRepo.count({ where: { tenant_id: TENANT_ID } });

      await dataSource.getRepository(School).update(TENANT_ID, { seat_limit: before + 1 });

      await expect(
        service.commit(validated.staging_id, TENANT_ID, SEED_ADMIN_USER_ID),
      ).rejects.toMatchObject({ response: { details: { code: 'SEAT_LIMIT_REACHED' } } });
      expect(await studentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(before);
    });
  });

  it('creates students and guardians from a valid file', async () => {
    const file = await buildXlsxFile([rowValues(headers)]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(1);
    expect(result.error_count).toBe(0);
    expect(result.created_student_ids).toHaveLength(1);

    const student = await studentRepo.findOne({
      where: { id: result.created_student_ids[0] },
      relations: ['guardians'],
    });
    expect(student?.full_name).toBe('Alice Rahman');
    expect(student?.guardians).toHaveLength(1);
    expect(student?.guardians[0].phone).toBe('+8801711111111');
  });

  it('reuses an existing guardian for a sibling sharing the same phone number', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'Sibling One', roll: '1' }),
      rowValues(headers, { student_name: 'Sibling Two', roll: '2' }),
    ]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(2);
    const guardians = await guardianRepo.find({ where: { phone: '+8801711111111' } });
    expect(guardians).toHaveLength(1);

    const students = await studentRepo.find({
      where: { id: In(result.created_student_ids) },
      relations: ['guardians'],
    });
    // Both siblings should link to the same single guardian record.
    expect(new Set(students.flatMap((s) => s.guardians.map((g) => g.id))).size).toBe(1);
  });

  it('reuses a guardian that already exists in the database for this tenant', async () => {
    const existing = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Pre-existing Guardian',
        relationship: 'OTHER',
        phone: '+8801722222222',
        tenant_id: TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '+8801722222222' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(1);
    const allGuardians = await guardianRepo.find({ where: { phone: '+8801722222222' } });
    expect(allGuardians).toHaveLength(1);
    expect(allGuardians[0].id).toBe(existing.id);
  });

  it('warns once for a row whose guardian1_phone matches an existing guardian, without blocking commit [LIFE-09]', async () => {
    const existing = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Family Already Here',
        relationship: 'OTHER',
        phone: '+8801733333333',
        tenant_id: TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '+8801733333333' })]);

    const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);

    // A warning is shown, but it is not a hard error: commit stays allowed.
    expect(validated.hard_error_count).toBe(0);
    expect(validated.errors).toHaveLength(1);
    expect(validated.errors[0]).toMatchObject({
      severity: 'warning',
      column: 'guardian1_phone',
      message: 'Will be linked to existing guardian "Family Already Here"',
    });

    // Committing after seeing the warning is the staff confirmation: the row joins that family.
    const committed = await service.commit(validated.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(committed.success_count).toBe(1);
    const student = await studentRepo.findOne({
      where: { id: committed.created_student_ids[0] },
      relations: ['guardians'],
    });
    expect(student?.guardians.map((g) => g.id)).toEqual([existing.id]);
  });

  it('refuses a row whose warned guardian lost the phone between validate and commit [LIFE-09]', async () => {
    const existing = await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Moved Family',
        relationship: 'OTHER',
        phone: '+8801755555555',
        tenant_id: TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '+8801755555555' })]);
    const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);

    // Staff saw "Moved Family"; before they commit, that guardian's phone changes.
    await guardianRepo.update({ id: existing.id }, { phone: '+8801766666666' });
    const committed = await service.commit(validated.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);

    // The student is not created and no new guardian is made on the stale phone.
    expect(committed.success_count).toBe(0);
    expect(committed.errors[0].reason).toContain('changed since validation');
    expect(await guardianRepo.count({ where: { phone: '+8801755555555' } })).toBe(0);
  });

  it('warns once per phone when guardian2_phone repeats guardian1_phone, labelled per column [LIFE-09]', async () => {
    await guardianRepo.save(
      guardianRepo.create({
        full_name: 'Shared Phone Family',
        relationship: 'OTHER',
        phone: '+8801744444444',
        tenant_id: TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([
      rowValues(headers, {
        guardian1_phone: '+8801744444444',
        guardian2_name: 'Second Guardian',
        guardian2_phone: '+8801744444444',
      }),
    ]);

    const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(validated.errors.filter((e) => e.severity === 'warning')).toEqual([
      expect.objectContaining({ column: 'guardian1_phone', value: '+8801744444444' }),
    ]);
  });

  it('reports a specific error for a duplicate roll number within the same file, and blocks the whole batch', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'First', roll: '5' }),
      rowValues(headers, { student_name: 'Second', roll: '5', guardian1_phone: '+8801733333333' }),
    ]);

    // [14.9.1]: unlike the old single-call `process()`, ANY row error blocks
    // the entire staged batch at commit — the "First" row is not created
    // just because it was individually valid.
    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.error_count).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 3, field: 'roll', value: '5' });
    expect(result.errors[0].reason).toContain('Duplicate roll number 5');

    const created = await studentRepo.find({ where: { full_name: 'First' } });
    expect(created).toHaveLength(0);
  });

  it('reports a roll above ROLL_NUMBER_MAX as a row error, not a 500 (2595)', async () => {
    const result = await runUpload(
      await buildXlsxFile([
        rowValues(headers, { student_name: 'Too Big', roll: '250000' }),
        rowValues(headers, { student_name: 'Past Int4', roll: '99999999999' }),
      ]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    expect(result.success_count).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 2,
        field: 'roll',
        reason: 'roll must not be greater than 99999',
      }),
      expect.objectContaining({
        row: 3,
        field: 'roll',
        reason: 'roll must not be greater than 99999',
      }),
    ]);
  });

  it('reports a specific error for a roll number that already exists in the database', async () => {
    await runUpload(
      await buildXlsxFile([rowValues(headers, { student_name: 'Existing', roll: '9' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'New', roll: '9', guardian1_phone: '+8801744444444' }),
    ]);
    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.error_count).toBe(1);
    // [2606] caught at validate now; the message names the column, never the value (Rule 23).
    expect(result.errors[0]).toMatchObject({ field: 'roll' });
    expect(result.errors[0].reason).toBe('This roll number is already used in this section.');
  });

  describe('[2606] commit never 500s after a partial write', () => {
    it('reports a failing row, still creates the others and writes one audit row', async () => {
      const file = await buildXlsxFile(
        ['A', 'B', 'C', 'D'].map((n, i) =>
          rowValues(headers, {
            student_name: `Partial ${n}`,
            guardian1_phone: `+88017000000${i}1`,
          }),
        ),
      );
      const validated = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);
      expect(validated.rows_to_create).toBe(4);
      const studentService = module_.get(StudentService);
      const real = studentService.create.bind(studentService);
      const spy = vi.spyOn(studentService, 'create').mockImplementation((dto, ...rest) => {
        if (dto.full_name === 'Partial C') throw new Error('boom: secret db text');
        return real(dto, ...rest);
      });
      try {
        const result = await service.commit(validated.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);
        expect(result.success_count).toBe(3);
        expect(result.error_count).toBe(1);
        expect(result.errors[0]).toMatchObject({ row: 4, reason: 'Could not be created' });
        expect(JSON.stringify(result)).not.toContain('boom');
      } finally {
        spy.mockRestore();
      }
      const audits = await auditLogRepo.find({ where: { action: AuditAction.BULK_UPLOAD } });
      expect(audits).toHaveLength(1);
      expect(audits[0].new_values).toMatchObject({ success_count: 3, error_count: 1 });
    });

    it('makes a roll above the cap a validate error and excludes it from rows_to_create', async () => {
      const file = await buildXlsxFile([
        rowValues(headers, {
          student_name: 'Cap Ok',
          roll: '99999',
          guardian1_phone: '+8801700000101',
        }),
        rowValues(headers, {
          student_name: 'Cap Bad',
          roll: '2147483648',
          guardian1_phone: '+8801700000102',
        }),
      ]);
      const v = await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);
      expect(v.hard_error_count).toBe(1);
      expect(v.rows_to_create).toBe(1);
      expect(v.errors[0]).toMatchObject({ row: 3, column: 'roll' });
      expect(v.errors[0].message).not.toContain('2147483648');
    });

    it('flags a roll held by a soft-deleted student at validate', async () => {
      const gone = await runUpload(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Gone',
            roll: '77',
            guardian1_phone: '+8801700000201',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await studentRepo.softDelete(gone.created_student_ids[0]);
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Late',
            roll: '77',
            guardian1_phone: '+8801700000202',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.rows_to_create).toBe(0);
      expect(v.errors[0]).toMatchObject({ column: 'roll', severity: 'error' });
    });
  });

  it('does not leave an orphaned guardian behind when the student create fails', async () => {
    await runUpload(
      await buildXlsxFile([rowValues(headers, { student_name: 'Existing', roll: '15' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    // A brand-new guardian phone paired with a roll number that's already
    // taken — student creation must fail, and since guardian creation and
    // student creation run in one transaction, the new guardian must be
    // rolled back too rather than left dangling with no student attached.
    const file = await buildXlsxFile([
      rowValues(headers, {
        student_name: 'Conflicting',
        roll: '15',
        guardian1_phone: '+8801766666666',
      }),
    ]);
    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    const orphanCandidates = await guardianRepo.find({ where: { phone: '+8801766666666' } });
    expect(orphanCandidates).toHaveLength(0);
  });

  it('reports a specific error for a missing required field', async () => {
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0].reason).toContain('Missing required field: guardian1_phone');
    // Empty cell — a field to blame, but no offending value to echo back.
    expect(result.errors[0].field).toBe('guardian1_phone');
    expect(result.errors[0].value).toBeUndefined();
  });

  it('reports a specific error for an invalid phone format', async () => {
    const file = await buildXlsxFile([rowValues(headers, { guardian1_phone: '12345' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0]).toMatchObject({ field: 'guardian1_phone', value: '12345' });
    expect(result.errors[0].reason).toContain('Invalid phone format: guardian1_phone');
  });

  it('reports a specific error for an unknown class/section name', async () => {
    const file = await buildXlsxFile([rowValues(headers, { class: 'Nonexistent Class' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0]).toMatchObject({ field: 'class', value: 'Nonexistent Class' });
    expect(result.errors[0].reason).toContain("Class 'Nonexistent Class'");
  });

  it('blames the section column when the class exists but the section does not', async () => {
    const file = await buildXlsxFile([rowValues(headers, { section: 'Nonexistent Section' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0]).toMatchObject({ field: 'section', value: 'Nonexistent Section' });
  });

  // A class can exist for the year with no sections configured yet. Blaming
  // `class` there would tell the admin to fix a class name that is correct.
  it('blames the section column for a class that exists but has no sections', async () => {
    const classRepo = dataSource.getRepository(Class);
    await classRepo.save(
      classRepo.create({
        name: 'Class Sectionless',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    const file = await buildXlsxFile([rowValues(headers, { class: 'Class Sectionless' })]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    expect(result.success_count).toBe(0);
    expect(result.errors[0]).toMatchObject({ field: 'section', value: 'Section A' });
  });

  describe('[76.2.06] card_no column', () => {
    const withCard = (name: string, phone: string, card: string) => [
      ...rowValues(headers, { student_name: name, guardian1_phone: phone }),
      card,
    ];

    it('is optional: a file without the column still imports', async () => {
      const result = await runUpload(
        await buildXlsxFile([
          rowValues(headers, { student_name: 'No Card', guardian1_phone: '+8801700000401' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(result.success_count).toBe(1);
    });

    it('stores a supplied card', async () => {
      const result = await runUpload(
        await buildXlsxFile([withCard('Has Card', '+8801700000402', 'BULK-1')]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const st = await studentRepo.findOneByOrFail({ id: result.created_student_ids[0] });
      expect(st.card_no).toBe('BULK-1');
    });

    it('hard-errors invalid characters', async () => {
      const v = await service.validate(
        await buildXlsxFile([withCard('Bad Card', '+8801700000403', 'a b!')]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(1);
      expect(v.errors[0].column).toBe('card_no');
    });

    it('hard-errors a card repeated in the file or held in the tenant, without echoing it', async () => {
      await runUpload(
        await buildXlsxFile([withCard('Holder', '+8801700000404', 'HELD-9')]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const v = await service.validate(
        await buildXlsxFile([
          withCard('Rep A', '+8801700000405', 'REP-9'),
          withCard('Rep B', '+8801700000406', 'REP-9'),
          withCard('Clash', '+8801700000407', 'HELD-9'),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(2);
      expect(v.rows_to_create).toBe(1);
      for (const e of v.errors) {
        expect(e.column).toBe('card_no');
        expect(e.message).not.toMatch(/REP-9|HELD-9/);
      }
    });
  });

  describe('[2607] registration_number column', () => {
    it('stores a supplied number as given and auto-numbers a blank cell', async () => {
      const file = await buildXlsxFile([
        rowValues(headers, {
          student_name: 'Reg One',
          registration_number: 'QA-IMP-001',
          guardian1_phone: '+8801700000301',
        }),
        rowValues(headers, {
          student_name: 'Reg Two',
          registration_number: 'QA-IMP-002',
          guardian1_phone: '+8801700000302',
        }),
        rowValues(headers, { student_name: 'Reg Auto', guardian1_phone: '+8801700000303' }),
      ]);
      const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);
      const students = await studentRepo.find({ where: { id: In(result.created_student_ids) } });
      const byName = new Map(students.map((s) => [s.full_name, s.registration_number]));
      expect(byName.get('Reg One')).toBe('QA-IMP-001');
      expect(byName.get('Reg Two')).toBe('QA-IMP-002');
      expect(byName.get('Reg Auto')).toMatch(/^REG-\d{4}-\d{4}$/);
    });

    it('hard-errors a number repeated in the file or held by a live or soft-deleted student, without echoing it', async () => {
      const first = await runUpload(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Held',
            registration_number: 'QA-IMP-HELD',
            guardian1_phone: '+8801700000311',
          }),
          rowValues(headers, {
            student_name: 'Held Gone',
            registration_number: 'QA-IMP-GONE',
            guardian1_phone: '+8801700000312',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await studentRepo.softDelete(first.created_student_ids[1]);
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Rep A',
            registration_number: 'QA-IMP-REP',
            guardian1_phone: '+8801700000321',
          }),
          rowValues(headers, {
            student_name: 'Rep B',
            registration_number: 'QA-IMP-REP',
            guardian1_phone: '+8801700000322',
          }),
          rowValues(headers, {
            student_name: 'Live Clash',
            registration_number: 'QA-IMP-HELD',
            guardian1_phone: '+8801700000323',
          }),
          rowValues(headers, {
            student_name: 'Gone Clash',
            registration_number: 'QA-IMP-GONE',
            guardian1_phone: '+8801700000324',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(3);
      expect(v.rows_to_create).toBe(1);
      for (const e of v.errors) {
        expect(e.column).toBe('registration_number');
        expect(e.message).not.toContain('QA-IMP');
      }
    });

    it('refuses a number in the auto series REG-<year>-<digits>, so auto numbering keeps working', async () => {
      // REG-2026-999999999999999 would push the next auto number to 16 digits, past what
      // nextTenantSerial reads, and every later auto-numbered create would collide.
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Reg Wide',
            registration_number: 'REG-2026-999999999999999',
            guardian1_phone: '+8801700000341',
          }),
          rowValues(headers, {
            student_name: 'Reg Auto Shape',
            registration_number: 'REG-2026-0005',
            guardian1_phone: '+8801700000342',
          }),
          rowValues(headers, {
            student_name: 'Reg Own Shape',
            registration_number: 'REG-OLD-17',
            guardian1_phone: '+8801700000343',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(2);
      expect(v.rows_to_create).toBe(1);
      for (const e of v.errors.filter((x) => x.severity === 'error')) {
        expect(e.column).toBe('registration_number');
        expect(e.message).not.toContain('2026');
      }

      // Auto numbering after the refused file: two creates, two different numbers.
      const result = await runUpload(
        await buildXlsxFile([
          rowValues(headers, { student_name: 'Auto A', guardian1_phone: '+8801700000344' }),
          rowValues(headers, { student_name: 'Auto B', guardian1_phone: '+8801700000345' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const created = await studentRepo.find({ where: { id: In(result.created_student_ids) } });
      expect(new Set(created.map((s) => s.registration_number)).size).toBe(2);
    });

    it('rejects a 51 character number', async () => {
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, {
            registration_number: 'X'.repeat(51),
            guardian1_phone: '+8801700000331',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(1);
      expect(v.errors[0]).toMatchObject({ column: 'registration_number' });
    });
  });

  it('creates a second guardian and links both when guardian2 is provided', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, {
        guardian2_name: 'Second Guardian',
        guardian2_phone: '+8801755555555',
      }),
    ]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    const student = await studentRepo.findOne({
      where: { id: result.created_student_ids[0] },
      relations: ['guardians'],
    });
    expect(student?.guardians).toHaveLength(2);
  });

  it('does not resolve a class/section belonging to a different tenant', async () => {
    const file = await buildXlsxFile([rowValues(headers)]);

    const result = await runUpload(file, OTHER_TENANT_ID, SEED_ADMIN_USER_ID);

    // The seeded "Class One / Section A" for OTHER_TENANT_ID should resolve fine on its own tenant...
    expect(result.success_count).toBe(1);

    // ...but a guardian phone used on TENANT_ID must not be reused across tenants.
    const crossTenantGuardians = await guardianRepo.find({ where: { phone: '+8801711111111' } });
    expect(crossTenantGuardians.every((g) => g.tenant_id === OTHER_TENANT_ID)).toBe(true);
  });

  it('produces the same result for equivalent CSV and XLSX content', async () => {
    const xlsxResult = await runUpload(
      await buildXlsxFile([rowValues(headers, { student_name: 'Xlsx Student', roll: '20' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    const csvResult = await runUpload(
      buildCsvFile([rowValues(headers, { student_name: 'Csv Student', roll: '21' })]),
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    expect(xlsxResult.success_count).toBe(1);
    expect(csvResult.success_count).toBe(1);
  });

  it('writes one audit log entry summarizing a successful commit', async () => {
    // [14.9.1]: the audit log is written by `commit`, which only runs at
    // all when the staged batch is error-free — a batch with a bad row
    // never reaches commit (see the "blocks the whole batch" test above),
    // so this exercises a clean two-row batch instead of a mixed one.
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'Ok Row One', roll: '30' }),
      rowValues(headers, {
        student_name: 'Ok Row Two',
        roll: '31',
        guardian1_phone: '+8801711100031',
      }),
    ]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(result.success_count).toBe(2);

    const logs = await auditLogRepo.find({ where: { action: AuditAction.BULK_UPLOAD } });
    expect(logs).toHaveLength(1);
    expect(logs[0].new_values).toMatchObject({ total_rows: 2, success_count: 2, error_count: 0 });
    expect(logs[0].tenant_id).toBe(TENANT_ID);
  });

  it('records the uploading user as the actor on a bulk-created guardian', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'New Guardian Row', guardian1_phone: '+8801799999999' }),
    ]);

    await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);

    const guardian = await guardianRepo.findOne({ where: { phone: '+8801799999999' } });
    const logs = await auditLogRepo.find({
      where: { action: AuditAction.CREATE, entity_type: 'Guardian', entity_id: guardian?.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].performed_by_user_id).toBe(SEED_ADMIN_USER_ID);
  });

  it('LIFE-11: a bulk import writes one Student CREATE audit row per student with the actor', async () => {
    const file = await buildXlsxFile([
      rowValues(headers, { student_name: 'Audit Row One', roll: '60' }),
      rowValues(headers, {
        student_name: 'Audit Row Two',
        roll: '61',
        guardian1_phone: '+8801711100061',
      }),
    ]);

    const result = await runUpload(file, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(result.success_count).toBe(2);

    const logs = await auditLogRepo.find({
      where: { action: AuditAction.CREATE, entity_type: 'Student' },
    });
    expect(logs.map((l) => l.entity_id).sort()).toEqual([...result.created_student_ids].sort());
    expect(logs.every((l) => l.performed_by_user_id === SEED_ADMIN_USER_ID)).toBe(true);
  });

  describe('re-upload of an already-imported file [LIFE-12]', () => {
    const twoRows = () => [
      rowValues(headers, { student_name: 'Dup One', guardian1_phone: '+8801711200001' }),
      rowValues(headers, { student_name: 'Dup Two', guardian1_phone: '+8801711200002' }),
    ];

    it('flags every already-imported roll-less row as a blocking error', async () => {
      const first = await service.validate(
        await buildXlsxFile(twoRows()),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await service.commit(first.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);

      const second = await service.validate(
        await buildXlsxFile(twoRows()),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      expect(second.hard_error_count).toBe(2);
      expect(second.rows_to_create).toBe(0);
      expect(second.errors.filter((e) => e.severity === 'error')).toHaveLength(2);
      expect(second.errors[0].message).toMatch(/Already imported/);
      await expect(
        service.commit(second.staging_id, TENANT_ID, SEED_ADMIN_USER_ID),
      ).rejects.toThrow(/validation errors/);
    });

    // The same student listed twice in ONE file would otherwise create two
    // students: neither row matches a live student yet. The first row stays.
    it('flags the second copy of a student within the same file', async () => {
      const v = await service.validate(
        await buildXlsxFile([
          ...twoRows(),
          rowValues(headers, { student_name: ' dup  one', guardian1_phone: '+8801711200001' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(1);
      expect(v.rows_to_create).toBe(2);
      const [err] = v.errors.filter((e) => e.severity === 'error');
      expect(err.message).toMatch(/also in row/);
    });

    async function importOnce(rows: string[][]) {
      const v = await service.validate(await buildXlsxFile(rows), TENANT_ID, SEED_ADMIN_USER_ID);
      await service.commit(v.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);
    }

    it('the same name with a different guardian phone is not a duplicate', async () => {
      await importOnce(twoRows());
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, { student_name: 'Dup One', guardian1_phone: '+8801711299999' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(0);
    });

    it('matches names ignoring case and extra spaces', async () => {
      await importOnce(twoRows());
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, { student_name: '  dup   ONE ', guardian1_phone: '+8801711200001' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(1);
    });

    // BD_PHONE_REGEX accepts +880…, 880… and 01…; a re-export often changes the format.
    it('matches the guardian phone in any accepted format', async () => {
      await importOnce(twoRows());
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, { student_name: 'Dup One', guardian1_phone: '01711200001' }),
          rowValues(headers, { student_name: 'Dup Two', guardian1_phone: '8801711200002' }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(2);
      expect(v.rows_to_create).toBe(0);
    });

    // Two tabs validate the same file before either commits: the second commit must not
    // import every student again.
    it('refuses the second of two stagings of the same file at commit (409), writing nothing', async () => {
      const a = await service.validate(
        await buildXlsxFile(twoRows()),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      const b = await service.validate(
        await buildXlsxFile(twoRows()),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await service.commit(a.staging_id, TENANT_ID, SEED_ADMIN_USER_ID);

      const err = await service.commit(b.staging_id, TENANT_ID, SEED_ADMIN_USER_ID).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({
        details: { code: 'BULK_UPLOAD_ALREADY_IMPORTED' },
      });
      expect(
        await dataSource.getRepository(Student).count({ where: { tenant_id: TENANT_ID } }),
      ).toBe(2);
    });

    it('another school importing the same file sees no duplicates (tenant isolation)', async () => {
      await importOnce(twoRows());
      const v = await service.validate(
        await buildXlsxFile(twoRows()),
        OTHER_TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(0);
      expect(v.rows_to_create).toBe(2);
    });

    it('a soft-deleted student does not block re-import', async () => {
      await importOnce(twoRows());
      await dataSource.query('UPDATE students SET deleted_at = now()');
      const v = await service.validate(
        await buildXlsxFile(twoRows()),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(v.hard_error_count).toBe(0);
    });

    it('a student in another section with the same name and phone is not a duplicate', async () => {
      await importOnce(twoRows());
      const sectionBId = '00000000-0000-4000-8000-000000000931';
      await dataSource.getRepository(ClassSection).save({
        id: sectionBId,
        section_name: 'Section B',
        class_id: SEED_CLASS_1_ID,
        tenant_id: TENANT_ID,
      });
      const v = await service.validate(
        await buildXlsxFile([
          rowValues(headers, {
            student_name: 'Dup One',
            section: 'Section B',
            guardian1_phone: '+8801711200001',
          }),
        ]),
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      await dataSource.query('DELETE FROM class_sections WHERE id = $1', [sectionBId]);
      expect(v.hard_error_count).toBe(0);
    });

    it('runs the duplicate check in one students query for a 500-row file', async () => {
      const rows = Array.from({ length: 500 }, (_, i) =>
        rowValues(headers, {
          student_name: `Bulk ${i}`,
          guardian1_phone: `+88017${String(10000000 + i)}`,
        }),
      );
      const file = await buildXlsxFile(rows);
      const spy = vi.spyOn(EntityManager.prototype, 'find');
      try {
        await service.validate(file, TENANT_ID, SEED_ADMIN_USER_ID);
        const studentFinds = spy.mock.calls.filter((c) => c[0] === Student).length;
        expect(studentFinds).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
