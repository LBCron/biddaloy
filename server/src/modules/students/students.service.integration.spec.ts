import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StudentService, GuardianService, redactHealthNotes } from './students.service';
import { QueryStudentIdsDto } from './dto/students.dto';
import { ROLL_NUMBER_MAX } from './roll-number.util';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { Enrollment } from './entities/enrollment.entity';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { createTestModule } from '@test/helpers/module.helper';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import {
  EnrollmentStatus,
  FeeStatus,
  FeeType,
  PeriodType,
  CommunicationMedium,
  AuditAction,
  Permission,
  UserRole,
  roleHasPermission,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { WalletService } from '../fees/wallet.service';

/**
 * Integration tests for StudentService and GuardianService.
 *
 * These tests run against a real PostgreSQL database and verify
 * tenant isolation, soft deletes, registration number generation,
 * and guardian-to-student linking.
 */

const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';

/**
 * Seed reference data required by tests (school, class, class_section).
 * These are created fresh for each test file run.
 */
async function seedReferenceData(ds: DataSource): Promise<void> {
  // Clean up any stale data before seeding (FK-safe order)
  await ds.query('DELETE FROM payment_allocations');
  await ds.query('DELETE FROM student_fees');
  await ds.query('DELETE FROM fee_structures');
  await ds.query('DELETE FROM payments');
  await ds.query('DELETE FROM student_guardians');
  await ds.query('DELETE FROM enrollments');
  await ds.query('DELETE FROM students');
  await ds.query('DELETE FROM guardians');
  await ds.query('DELETE FROM class_sections');
  await ds.query('DELETE FROM classes');
  await ds.query('DELETE FROM academic_years');
  await ds.query('DELETE FROM schools');

  const schoolRepo = ds.getRepository(School);
  const ayRepo = ds.getRepository(AcademicYear);
  const classRepo = ds.getRepository(Class);
  const sectionRepo = ds.getRepository(ClassSection);

  // Tenant 1 reference data
  await schoolRepo.save(
    schoolRepo.create({
      id: SEED_TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: SEED_TENANT_ID,
    }),
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
      id: SEED_TENANT_ID,
      name: 'Class One',
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_1_ID,
      section_name: 'Section A',
      class_id: SEED_TENANT_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );
  // [#1020] A second section on the SAME class/year, purely so `update()`
  // tests have somewhere to move a student's `class_section_id` to.
  await sectionRepo.save(
    sectionRepo.create({
      id: SEED_SECTION_2_ID,
      section_name: 'Section B',
      class_id: SEED_TENANT_ID,
      tenant_id: SEED_TENANT_ID,
    }),
  );

  // Other tenant reference data (for tenant isolation tests)
  const OTHER_AY_ID = '00000000-0000-4000-8000-000000000099';
  const OTHER_CLASS_ID = '00000000-0000-4000-8000-000000000098';
  const OTHER_SECTION_ID = '00000000-0000-4000-8000-000000000097';
  await schoolRepo.save(
    schoolRepo.create({
      id: OTHER_TENANT,
      name: 'Other School',
      slug: 'other-school',
      tenant_id: OTHER_TENANT,
    }),
  );
  await ayRepo.save(
    ayRepo.create({
      id: OTHER_AY_ID,
      name: 'Other 2026-2027',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: OTHER_TENANT,
    }),
  );
  await classRepo.save(
    classRepo.create({
      id: OTHER_CLASS_ID,
      name: 'Other Class',
      academic_year_id: OTHER_AY_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
  await sectionRepo.save(
    sectionRepo.create({
      id: OTHER_SECTION_ID,
      section_name: 'Other Section',
      class_id: OTHER_CLASS_ID,
      tenant_id: OTHER_TENANT,
    }),
  );
}

const NO_CTX = { ip: null, userAgent: null };

/** [68.4.#2298 PUB-10] Insert a minimal invoice + a live share token for a student; returns the token id. */
async function seedShareToken(
  ds: DataSource,
  studentId: string,
  tenantId: string,
  seq: number,
): Promise<string> {
  const userRepo = ds.getRepository('User');
  const user = (await userRepo.save(
    userRepo.create({
      full_name: 'Share Actor',
      email: `share-${seq}-${Date.now()}@example.com`,
      status: 'ACTIVE',
    }),
  )) as { id: string };
  const [inv] = await ds.query(
    `INSERT INTO invoices (invoice_number, tenant_id, student_id, total_amount, issued_date, due_date, snapshot)
     VALUES ($1, $2, $3, 100, now(), now(), '{}'::jsonb) RETURNING id`,
    [`INV-SHARE-${seq}-${Date.now()}`, tenantId, studentId],
  );
  const [tok] = await ds.query(
    `INSERT INTO invoice_share_tokens (tenant_id, invoice_id, token_hash, created_by_user_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, inv.id, `${seq}`.padStart(64, 'a'), user.id],
  );
  return tok.id;
}

async function isRevoked(ds: DataSource, tokenId: string): Promise<boolean> {
  const [row] = await ds.query('SELECT revoked_at FROM invoice_share_tokens WHERE id = $1', [
    tokenId,
  ]);
  return row.revoked_at !== null;
}

describe('StudentService (integration)', () => {
  let service: StudentService;
  let guardianService: GuardianService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let enrollmentRepo: Repository<Enrollment>;
  let walletService: WalletService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentService, GuardianService, AuditService, WalletService],
      [],
      {
        synchronize: true,
        dropSchema: true,
      },
    );

    service = module.get<StudentService>(StudentService);
    guardianService = module.get<GuardianService>(GuardianService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    enrollmentRepo = module.get<Repository<Enrollment>>(getRepositoryToken(Enrollment));
    walletService = module.get(WalletService);
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
      await dataSource.query('DELETE FROM enrollments');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('profile fields [39.2.1]', () => {
    const profile = {
      religion: 'Islam',
      birth_reg_no: '19900123456789012',
      health_notes: 'Peanut allergy',
      father_name: 'Karim',
      mother_name: 'Rahima',
    };

    it('round-trips the five fields through create, read and update', async () => {
      const created = await service.create(
        { full_name: 'P One', class_section_id: SEED_SECTION_1_ID, ...profile },
        TENANT_ID,
      );
      expect(created).toMatchObject(profile);
      const updated = await service.update(
        created.id,
        { religion: 'Hindu', mother_name: null },
        TENANT_ID,
      );
      expect(updated.religion).toBe('Hindu');
      expect(updated.mother_name).toBeNull();
      expect(updated.father_name).toBe('Karim');
    });

    it('ACCOUNTANT (no RECORDS_READ) and PARENT never see health_notes; ADMIN does', async () => {
      const created = await service.create(
        { full_name: 'P Two', class_section_id: SEED_SECTION_1_ID, ...profile },
        TENANT_ID,
      );
      for (const role of [UserRole.ACCOUNTANT, UserRole.PARENT, UserRole.STUDENT]) {
        const s = redactHealthNotes(
          await service.findOne(created.id, TENANT_ID),
          roleHasPermission(role, Permission.STUDENT_RECORDS_READ),
        );
        expect(s).not.toHaveProperty('health_notes');
      }
      const admin = redactHealthNotes(
        await service.findOne(created.id, TENANT_ID),
        roleHasPermission(UserRole.ADMIN, Permission.STUDENT_RECORDS_READ),
      );
      expect(admin.health_notes).toBe('Peanut allergy');
    });

    it('duplicate birth_reg_no in the same school is 409 (create and update); another school is fine', async () => {
      await service.create(
        {
          full_name: 'D One',
          class_section_id: SEED_SECTION_1_ID,
          birth_reg_no: profile.birth_reg_no,
        },
        TENANT_ID,
      );
      await expect(
        service.create(
          {
            full_name: 'D Two',
            class_section_id: SEED_SECTION_1_ID,
            birth_reg_no: profile.birth_reg_no,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow(ConflictException);

      const other = await service.create(
        { full_name: 'D Three', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      await expect(
        service.update(other.id, { birth_reg_no: profile.birth_reg_no }, TENANT_ID),
      ).rejects.toThrow(ConflictException);

      // Same number in another tenant: insert directly (no section there), index is per tenant.
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Other',
          registration_number: 'REG-X-1',
          roll_number: 1,
          class_section_id: OTHER_SECTION_ID,
          birth_reg_no: profile.birth_reg_no,
          tenant_id: OTHER_TENANT,
        } as any),
      );
    });
  });

  describe('create', () => {
    it('LIFE-11: create writes one Student CREATE audit row with the actor', async () => {
      const userRepo = dataSource.getRepository('User');
      const actor = (await userRepo.save(
        userRepo.create({
          full_name: 'Create Actor',
          email: `create-actor-${Date.now()}@example.com`,
          status: 'ACTIVE',
        }),
      )) as { id: string };

      const student = await service.create(
        { full_name: 'Audited Kid', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
        undefined,
        { userId: actor.id, context: { ip: '10.0.0.1', userAgent: 'vitest' } },
      );

      const rows = await dataSource.getRepository(AuditLog).find({
        where: { entity_type: 'Student', entity_id: student.id, tenant_id: TENANT_ID },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('CREATE');
      expect(rows[0].performed_by_user_id).toBe(actor.id);
      expect(rows[0].new_values).toMatchObject({
        full_name: 'Audited Kid',
        registration_number: student.registration_number,
        class_section_id: SEED_SECTION_1_ID,
      });
    });

    it('should create a student with auto-generated registration number', async () => {
      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        date_of_birth: '2010-05-15',
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.full_name).toBe('John Doe');
      expect(result.registration_number).toMatch(/^REG-\d{4}-\d{4}$/);
      // Critical: registration number is scoped to tenant
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('should link guardians when guardian_ids are provided', async () => {
      // First create a guardian
      const guardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Parent',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );

      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        guardian_ids: [guardian.id],
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result.guardians).toBeDefined();
      expect(result.guardians).toHaveLength(1);
      expect(result.guardians[0].id).toBe(guardian.id);
    });

    it('should throw NotFoundException when class_section is invalid', async () => {
      const dto = {
        full_name: 'John Doe',
        class_section_id: '00000000-0000-4000-8000-000000000000',
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when guardian does not belong to tenant', async () => {
      // Create a guardian in a different tenant
      const otherGuardian = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Other Parent',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: OTHER_TENANT,
        }),
      );

      const dto = {
        full_name: 'John Doe',
        class_section_id: SEED_SECTION_1_ID,
        guardian_ids: [otherGuardian.id],
      };

      // The guardian from a different tenant should not be found
      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('should auto-increment roll_number per section', async () => {
      // Create first student
      const student1 = await service.create(
        { full_name: 'Student 1', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      expect(student1.roll_number).toBe(1);

      // Create second student in same section
      const student2 = await service.create(
        { full_name: 'Student 2', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      expect(student2.roll_number).toBe(2);
    });

    // [2597] A section whose top roll is at the cap must answer a clear 409, not overflow the int column.
    it('[2597] auto-roll answers 409 ROLL_NUMBER_EXHAUSTED when the top roll is at the cap, other sections unaffected', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Roll Cap Holder',
          registration_number: `REG-2597-${Date.now()}`,
          roll_number: ROLL_NUMBER_MAX,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      const before = await studentRepo.count({ where: { tenant_id: TENANT_ID } });

      await expect(
        service.create({ full_name: 'No Room', class_section_id: SEED_SECTION_1_ID }, TENANT_ID),
      ).rejects.toMatchObject({ response: { details: { code: 'ROLL_NUMBER_EXHAUSTED' } } });
      expect(await studentRepo.count({ where: { tenant_id: TENANT_ID } })).toBe(before);

      const other = await service.create(
        { full_name: 'Other Section', class_section_id: SEED_SECTION_2_ID },
        TENANT_ID,
      );
      expect(other.roll_number).toBe(1);
    });

    describe('registration year follows the school (Asia/Dhaka) calendar', () => {
      afterEach(() => vi.useRealTimers());
      const at = (iso: string) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(iso));
      };
      const mk = (n: string) =>
        service.create({ full_name: n, class_section_id: SEED_SECTION_1_ID }, TENANT_ID);

      it('00:30 on 1 Jan 2027 Dhaka is REG-2027', async () => {
        at('2026-12-31T18:30:00Z');
        expect((await mk('New Year')).registration_number).toMatch(/^REG-2027-\d{4}$/);
      });

      it('23:30 on 31 Dec 2026 Dhaka is REG-2026', async () => {
        at('2026-12-31T17:30:00Z');
        expect((await mk('Old Year')).registration_number).toMatch(/^REG-2026-\d{4}$/);
      });

      it('two students in the new Dhaka year get consecutive numbers', async () => {
        at('2026-12-31T18:30:00Z');
        const a = await mk('One');
        const b = await mk('Two');
        expect(a.registration_number).toBe('REG-2027-0001');
        expect(b.registration_number).toBe('REG-2027-0002');
      });
    });

    it('should generate sequential registration numbers per tenant', async () => {
      const student1 = await service.create(
        { full_name: 'Student 1', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const student2 = await service.create(
        { full_name: 'Student 2', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      // Registration numbers should be sequential
      expect(student1.registration_number).toMatch(/REG-\d{4}-\d{4}$/);
      expect(student2.registration_number).toMatch(/REG-\d{4}-\d{4}$/);
      expect(student2.registration_number).not.toBe(student1.registration_number);
    });

    it('[LIFE-13] takes the numeric max, so REG-<yr>-9999 and -10000 are followed by -10001', async () => {
      const yr = new Date().getFullYear();
      for (const [i, n] of ['9999', '10000'].entries()) {
        await studentRepo.save(
          studentRepo.create({
            full_name: `Old ${n}`,
            registration_number: `REG-${yr}-${n}`,
            roll_number: 100 + i,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        );
      }
      const next = await service.create(
        { full_name: 'New', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      expect(next.registration_number).toBe(`REG-${yr}-10001`);
    });

    it('serializes concurrent creates so no two students in the same section collide on roll_number or registration_number', async () => {
      // Fired concurrently against an empty section — the pessimistic
      // row lock alone can't serialize this (there's no row to lock yet
      // for the very first insert); the advisory lock added in
      // StudentService.create is what prevents duplicates here.
      const students = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          service.create(
            { full_name: `Concurrent ${i}`, class_section_id: SEED_SECTION_1_ID },
            TENANT_ID,
          ),
        ),
      );

      const rollNumbers = students.map((s) => s.roll_number);
      const registrationNumbers = students.map((s) => s.registration_number);
      expect(new Set(rollNumbers).size).toBe(5);
      expect(new Set(registrationNumbers).size).toBe(5);
    });

    // ────────────────────────
    //  [8.11.3] Day-one enrollment history
    // ────────────────────────
    it('also creates an ACTIVE Enrollment row matching the target class/section/year', async () => {
      const student = await service.create(
        { full_name: 'Enrolled Student', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      const enrollment = await enrollmentRepo.findOne({ where: { student_id: student.id } });

      expect(enrollment).not.toBeNull();
      expect(enrollment!.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
      expect(enrollment!.section_id).toBe(SEED_SECTION_1_ID);
      expect(enrollment!.class_id).toBe(student.class_section.class.id);
      expect(enrollment!.academic_year_id).toBe(SEED_ACADEMIC_YEAR_ID);
      expect(enrollment!.tenant_id).toBe(TENANT_ID);
    });

    it('rolls back the enrollment write too when the student insert itself fails', async () => {
      // An explicit roll_number that collides with an existing student in
      // the same section trips the unique (class_section_id, roll_number)
      // index inside the create transaction — proves the enrollment write
      // is part of the same atomic unit as the student insert, not a
      // separate best-effort call after it: if the transaction ever did
      // partially commit, this section would show orphaned rows behind it.
      const existing = await service.create(
        { full_name: 'Existing Student', class_section_id: SEED_SECTION_1_ID, roll_number: 5 },
        TENANT_ID,
      );

      await expect(
        service.create(
          {
            full_name: 'Colliding Student',
            class_section_id: SEED_SECTION_1_ID,
            roll_number: 5,
          },
          TENANT_ID,
        ),
      ).rejects.toThrow();

      const enrollmentsInSection = await enrollmentRepo.find({
        where: { section_id: SEED_SECTION_1_ID },
      });
      expect(enrollmentsInSection).toHaveLength(1);
      expect(enrollmentsInSection[0].student_id).toBe(existing.id);
    });
  });

  describe('findAll', () => {
    it('should return paginated students', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Student 1',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Student 2',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should enforce tenant isolation', async () => {
      // Create a student for tenant-1
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Tenant A Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      // Create a student for tenant-2
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Tenant B Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // Query from tenant-1 — should only see tenant-1's student
      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Tenant A Student');
    });

    it('should search students by name or roll number', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 7,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Fatima Begum',
          registration_number: 'REG-2026-0002',
          roll_number: 8,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // Search by name
      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(1);
      expect(byName.data[0].full_name).toBe('Ahmed Khan');

      // Search is case-insensitive
      const byLowercaseName = await service.findAll(
        { search: 'ahmed', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byLowercaseName.data).toHaveLength(1);
      expect(byLowercaseName.data[0].full_name).toBe('Ahmed Khan');

      // Search by roll number
      const byRoll = await service.findAll({ search: '8', page: 1, limit: 10 }, TENANT_ID);
      expect(byRoll.data).toHaveLength(1);
      expect(byRoll.data[0].full_name).toBe('Fatima Begum');
    });

    it("does not return another tenant's student when searching by name or roll number", async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 7,
          class_section_id: OTHER_SECTION_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(0);

      const byRoll = await service.findAll({ search: '7', page: 1, limit: 10 }, TENANT_ID);
      expect(byRoll.data).toHaveLength(0);
    });

    it('does not return a soft-deleted student when searching by name or roll number', async () => {
      const created = await service.create(
        { full_name: 'Ahmed Khan', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      await service.remove(created.id, TENANT_ID, null, NO_CTX);

      const byName = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(byName.data).toHaveLength(0);

      const byRoll = await service.findAll(
        { search: String(created.roll_number), page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(byRoll.data).toHaveLength(0);
    });

    it('sorts by full_name ascending or descending when sort/order are given', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Zahid Islam',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const ascending = await service.findAll(
        { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(ascending.data.map((s) => s.full_name)).toEqual(['Ahmed Khan', 'Zahid Islam']);

      const descending = await service.findAll(
        { sort: 'full_name', order: 'desc', page: 1, limit: 10 },
        TENANT_ID,
      );
      expect(descending.data.map((s) => s.full_name)).toEqual(['Zahid Islam', 'Ahmed Khan']);
    });

    it('falls back to created_at DESC when no sort is given, same as before sort support existed', async () => {
      const first = await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      const second = await studentRepo.save(
        studentRepo.create({
          full_name: 'Zahid Islam',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);
      expect(result.data.map((s) => s.id)).toEqual([second.id, first.id]);
    });

    it('paginates deterministically with duplicate sort values — no row is skipped or repeated across pages', async () => {
      // Same full_name and same date_of_birth on every row: with `sort:
      // 'full_name'` alone, ties leave row order unspecified page to page,
      // so a `limit: 1` walk can duplicate or skip a row across requests.
      // `id: 'ASC'` as a tiebreaker makes the order (and thus the walk)
      // deterministic.
      const students = await studentRepo.save(
        [1, 2, 3].map((n) =>
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: `REG-2026-DUP-${n}`,
            roll_number: n,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        ),
      );
      const expectedIds = [...students.map((s) => s.id)].sort();

      const seenIds: string[] = [];
      for (let page = 1; page <= students.length; page++) {
        const result = await service.findAll(
          { sort: 'full_name', order: 'asc', page, limit: 1 },
          TENANT_ID,
        );
        expect(result.data).toHaveLength(1);
        seenIds.push(result.data[0].id);
      }

      expect([...seenIds].sort()).toEqual(expectedIds);
      expect(new Set(seenIds).size).toBe(students.length);
    });

    // [8.14.9] search also matches registration_number now, not just name.
    it('searches by registration_number', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-9999',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const result = await service.findAll({ search: '2026-9999', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });

    // [8.14.9] % and _ in a search term must not act as SQL wildcards.
    it('treats % and _ in search as literal text, not wildcards', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: '100% Attendance',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // A bare % would match every student's name if unescaped.
      const percent = await service.findAll({ search: '100%', page: 1, limit: 10 }, TENANT_ID);
      expect(percent.data).toHaveLength(1);
      expect(percent.data[0].full_name).toBe('100% Attendance');
    });

    // [8.14.9] a Bengali-digit roll number search must convert to Latin
    // before matching the integer roll_number column.
    it('searches by roll number typed in Bengali digits', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 103,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      // ১০৩ is the Bengali-digit spelling of 103.
      const result = await service.findAll({ search: '১০৩', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });

    it('filters by gender', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Ahmed Khan',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          gender: 'MALE',
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Fatima Begum',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          gender: 'FEMALE',
        }),
      );

      const result = await service.findAll({ gender: 'FEMALE', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Fatima Begum');
    });

    it('filters by religion, ignoring letter case, and the export reads the same rows (8.15.33)', async () => {
      const make = (n: number, religion: string | null) =>
        studentRepo.save(
          studentRepo.create({
            full_name: `Religion ${n}`,
            registration_number: `REG-2026-90${n}`,
            roll_number: 90 + n,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            religion,
          }),
        );
      await make(1, 'Hindu');
      await make(2, 'Islam');
      await make(3, null);

      const listed = await service.findAll({ religion: 'hindu', page: 1, limit: 10 }, TENANT_ID);
      expect(listed.data.map((s) => s.full_name)).toEqual(['Religion 1']);

      // The export walks the same query, so a filtered export is exactly the filtered list.
      const exported: unknown[][] = [];
      for await (const row of service.iterateForExport({ religion: 'hindu' }, TENANT_ID)) {
        exported.push(row);
      }
      expect(exported.map((r) => r[2])).toEqual(['Religion 1']);
    });

    it('filters by date_of_birth_from/date_of_birth_to', async () => {
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Older Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2005-01-01'),
        }),
      );
      await studentRepo.save(
        studentRepo.create({
          full_name: 'Younger Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2015-01-01'),
        }),
      );

      const result = await service.findAll(
        { date_of_birth_from: '2010-01-01', date_of_birth_to: '2020-01-01', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Younger Student');
    });

    // [33.3.1] shift/version filter via `class_section.class`.
    describe('shift/version filters', () => {
      it('filters to only students enrolled in a class with the given version', async () => {
        const classRepo = dataSource.getRepository(Class);
        const sectionRepo = dataSource.getRepository(ClassSection);
        const englishClass = await classRepo.save(
          classRepo.create({
            name: 'English Medium',
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            tenant_id: TENANT_ID,
            version: 'English',
          }),
        );
        const englishSection = await sectionRepo.save(
          sectionRepo.create({
            section_name: 'A',
            class_id: englishClass.id,
            tenant_id: TENANT_ID,
          }),
        );
        await studentRepo.save(
          studentRepo.create({
            full_name: 'Bangla Student',
            registration_number: 'REG-2026-0011',
            roll_number: 11,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        );
        await studentRepo.save(
          studentRepo.create({
            full_name: 'English Student',
            registration_number: 'REG-2026-0012',
            roll_number: 12,
            class_section_id: englishSection.id,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        );

        const result = await service.findAll(
          { version: 'English', page: 1, limit: 10 } as any,
          TENANT_ID,
        );

        expect(result.data.map((s) => s.full_name)).toEqual(['English Student']);
      });

      it('returns an empty page for a version value that matches no student, not a 500', async () => {
        const result = await service.findAll(
          { version: 'Nonexistent Version', page: 1, limit: 10 } as any,
          TENANT_ID,
        );

        expect(result.data).toEqual([]);
        expect(result.total).toBe(0);
      });

      // [money-tier review, bug 3] `findAllIds` (the audience-picker's
      // "select all matching" action) must honour shift/version too — a
      // missing filter here would silently over-broaden a communications
      // audience to every enrollment-status/search match, ignoring the
      // shift/version the paginated list was just filtered by.
      it('findAllIds also filters by shift/version, matching findAll', async () => {
        const classRepo = dataSource.getRepository(Class);
        const sectionRepo = dataSource.getRepository(ClassSection);
        const englishClass = await classRepo.save(
          classRepo.create({
            name: 'English Medium (ids)',
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            tenant_id: TENANT_ID,
            version: 'English',
          }),
        );
        const englishSection = await sectionRepo.save(
          sectionRepo.create({
            section_name: 'A',
            class_id: englishClass.id,
            tenant_id: TENANT_ID,
          }),
        );
        await studentRepo.save(
          studentRepo.create({
            full_name: 'Bangla Student (ids)',
            registration_number: 'REG-2026-0021',
            roll_number: 21,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        );
        const englishStudent = await studentRepo.save(
          studentRepo.create({
            full_name: 'English Student (ids)',
            registration_number: 'REG-2026-0022',
            roll_number: 22,
            class_section_id: englishSection.id,
            tenant_id: TENANT_ID,
            date_of_birth: new Date('2010-01-01'),
          }),
        );

        const query: QueryStudentIdsDto = { version: 'English' };
        const result = await service.findAllIds(query, TENANT_ID);

        expect(result.ids).toEqual([englishStudent.id]);
        expect(result.total).toBe(1);
      });
    });

    // [8.14.9] search now also matches via the student's guardian(s).
    describe('search via guardian', () => {
      it('finds a student by their guardian full_name or phone', async () => {
        const student1 = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const student2 = await studentRepo.save(
          studentRepo.create({
            full_name: 'Fatima Begum',
            registration_number: 'REG-2026-0002',
            roll_number: 2,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const guardian = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: TENANT_ID,
          }),
        );
        await dataSource.query(
          'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
          [student1.id, guardian.id],
        );

        const byGuardianName = await service.findAll(
          { search: 'Karim Uddin', page: 1, limit: 10 },
          TENANT_ID,
        );
        expect(byGuardianName.data).toHaveLength(1);
        expect(byGuardianName.data[0].id).toBe(student1.id);
        // Confirms this branch didn't accidentally match every student.
        expect(byGuardianName.data.map((s) => s.id)).not.toContain(student2.id);

        const byGuardianPhone = await service.findAll(
          { search: '01711112222', page: 1, limit: 10 },
          TENANT_ID,
        );
        expect(byGuardianPhone.data).toHaveLength(1);
        expect(byGuardianPhone.data[0].id).toBe(student1.id);
      });

      it('does not match a soft-deleted guardian', async () => {
        const student = await studentRepo.save(
          studentRepo.create({
            full_name: 'Nazrul Islam',
            registration_number: 'REG-2026-0009',
            roll_number: 9,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const guardian = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Removed Guardian',
            phone: '+8801799998888',
            relationship: 'Father',
            tenant_id: TENANT_ID,
          }),
        );
        await dataSource.query(
          'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
          [student.id, guardian.id],
        );
        await guardianRepo.softDelete(guardian.id);

        const result = await service.findAll(
          { search: 'Removed Guardian', page: 1, limit: 10 },
          TENANT_ID,
        );
        expect(result.data).toHaveLength(0);
      });

      // Cross-tenant: a guardian in tenant B must never surface a tenant A
      // student search, even if (hypothetically) linked cross-tenant — the
      // guardian join must carry its own tenant_id, not just rely on the
      // student_guardians join table.
      it('does not match a guardian belonging to another tenant', async () => {
        const student = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const otherTenantGuardian = await guardianRepo.save(
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: OTHER_TENANT,
          }),
        );
        // Deliberately force a cross-tenant join row — proves the query's
        // own `guardian.tenant_id = :tenantId` guard, not the join table's
        // absence of such rows, is what keeps this out of the result.
        await dataSource.query(
          'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
          [student.id, otherTenantGuardian.id],
        );

        const result = await service.findAll(
          { search: 'Karim Uddin', page: 1, limit: 10 },
          TENANT_ID,
        );

        expect(result.data).toHaveLength(0);
      });

      // A student with two guardians matching the search must still
      // appear exactly once, and `total` must reflect distinct students,
      // not joined rows.
      it('does not inflate total when a matched student has multiple guardians', async () => {
        const student = await studentRepo.save(
          studentRepo.create({
            full_name: 'Ahmed Khan',
            registration_number: 'REG-2026-0001',
            roll_number: 1,
            class_section_id: SEED_SECTION_1_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const guardians = await guardianRepo.save([
          guardianRepo.create({
            full_name: 'Karim Uddin',
            phone: '+8801711112222',
            relationship: 'Father',
            tenant_id: TENANT_ID,
          }),
          guardianRepo.create({
            full_name: 'Karim Rahman',
            phone: '+8801711113333',
            relationship: 'Uncle',
            tenant_id: TENANT_ID,
          }),
        ]);
        for (const guardian of guardians) {
          await dataSource.query(
            'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
            [student.id, guardian.id],
          );
        }

        const result = await service.findAll({ search: 'Karim', page: 1, limit: 10 }, TENANT_ID);

        expect(result.data).toHaveLength(1);
        expect(result.total).toBe(1);
      });
    });
  });

  describe('findOne', () => {
    it('should return a student by ID', async () => {
      const created = await service.create(
        { full_name: 'John Doe', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      const result = await service.findOne(created.id, TENANT_ID);

      expect(result.id).toBe(created.id);
      expect(result.full_name).toBe('John Doe');
    });

    it('should throw NotFoundException when student belongs to a different tenant', async () => {
      const created = await service.create(
        { full_name: 'Other Tenant Student', class_section_id: OTHER_SECTION_ID },
        OTHER_TENANT,
      );

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('roll number conflicts [68.3.40 / LIFE-05]', () => {
    const mk = (name: string, section: string, roll?: number) =>
      service.create(
        { full_name: name, class_section_id: section, ...(roll ? { roll_number: roll } : {}) },
        TENANT_ID,
      );

    it('section move that re-sends the old roll, taken in the target, gets a free roll', async () => {
      await mk('Holder In B', SEED_SECTION_2_ID, 5);
      const s = await mk('Mover', SEED_SECTION_1_ID, 5);

      const updated = await service.update(
        s.id,
        { class_section_id: SEED_SECTION_2_ID, roll_number: 5 },
        TENANT_ID,
      );

      expect(updated.class_section_id).toBe(SEED_SECTION_2_ID);
      expect(updated.roll_number).toBe(6);
    });

    it('create after soft-deleting the top roll in a section does not collide', async () => {
      await mk('One', SEED_SECTION_1_ID);
      const top = await mk('Two', SEED_SECTION_1_ID);
      await service.remove(top.id, TENANT_ID, null, { ip: null, userAgent: null });

      const next = await mk('Three', SEED_SECTION_1_ID);

      expect(next.roll_number).toBe(top.roll_number + 1);
    });

    it('section move with an explicit, free roll keeps that roll', async () => {
      const s = await mk('Mover', SEED_SECTION_1_ID, 5);
      const updated = await service.update(
        s.id,
        { class_section_id: SEED_SECTION_2_ID, roll_number: 42 },
        TENANT_ID,
      );
      expect(updated.roll_number).toBe(42);
    });

    it('section move with an explicit, taken roll throws ROLL_NUMBER_TAKEN', async () => {
      await mk('Holder', SEED_SECTION_2_ID, 9);
      const s = await mk('Mover', SEED_SECTION_1_ID, 5);
      await expect(
        service.update(s.id, { class_section_id: SEED_SECTION_2_ID, roll_number: 9 }, TENANT_ID),
      ).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'ROLL_NUMBER_TAKEN' } },
      });
    });

    it('create with an explicit, taken roll throws ROLL_NUMBER_TAKEN and leaves no student row', async () => {
      await mk('Holder', SEED_SECTION_1_ID, 77);
      await expect(mk('Clasher', SEED_SECTION_1_ID, 77)).rejects.toMatchObject({
        status: 409,
        response: { details: { code: 'ROLL_NUMBER_TAKEN' } },
      });
      // The create transaction rolled back: no student, no enrollment.
      const rows = await dataSource.query(
        `SELECT s.id, (SELECT count(*) FROM enrollments e WHERE e.student_id = s.id) AS n
         FROM students s WHERE s.tenant_id = $1 AND s.full_name = 'Clasher'`,
        [TENANT_ID],
      );
      expect(rows).toHaveLength(0);
    });

    it('a move inside the same section with no roll change keeps the roll', async () => {
      const s = await mk('Stays', SEED_SECTION_1_ID, 5);
      const updated = await service.update(
        s.id,
        { class_section_id: SEED_SECTION_1_ID, roll_number: 5 },
        TENANT_ID,
      );
      expect(updated.roll_number).toBe(5);
    });
  });

  describe('update — Enrollment sync (#1020)', () => {
    it('updates the existing ACTIVE Enrollment class_id/section_id when class_section_id changes', async () => {
      const created = await service.create(
        { full_name: 'Moves Sections', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const before = await enrollmentRepo.findOne({
        where: {
          student_id: created.id,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(before?.section_id).toBe(SEED_SECTION_1_ID);

      await service.update(created.id, { class_section_id: SEED_SECTION_2_ID }, TENANT_ID);

      const enrollments = await enrollmentRepo.find({
        where: { student_id: created.id, tenant_id: TENANT_ID },
      });
      // Still exactly one ACTIVE enrollment row for the student — the
      // existing one was updated in place, not duplicated.
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].section_id).toBe(SEED_SECTION_2_ID);
      expect(enrollments[0].id).toBe(before?.id);
    });

    it('creates an Enrollment when the student has none and class_section_id changes', async () => {
      const created = await service.create(
        { full_name: 'No Enrollment Yet', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      // Simulate a pre-existing gap the migration would otherwise backfill.
      await enrollmentRepo.delete({ student_id: created.id });
      const noneBefore = await enrollmentRepo.findOne({ where: { student_id: created.id } });
      expect(noneBefore).toBeNull();

      await service.update(created.id, { class_section_id: SEED_SECTION_2_ID }, TENANT_ID);

      const enrollment = await enrollmentRepo.findOne({
        where: {
          student_id: created.id,
          tenant_id: TENANT_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(enrollment).not.toBeNull();
      expect(enrollment?.section_id).toBe(SEED_SECTION_2_ID);
    });

    it('touches no Enrollment row when class_section_id is absent from the DTO', async () => {
      const created = await service.create(
        { full_name: 'Name Only Update', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const before = await enrollmentRepo.findOne({ where: { student_id: created.id } });

      await service.update(created.id, { full_name: 'Renamed' }, TENANT_ID);

      const after = await enrollmentRepo.findOne({ where: { student_id: created.id } });
      expect(after?.id).toBe(before?.id);
      expect(after?.section_id).toBe(SEED_SECTION_1_ID);
      expect(after?.updated_at).toEqual(before?.updated_at);
    });

    it('updates the *current year`s* Enrollment, not an older year`s, when moved to a section in a different academic year', async () => {
      // A student's newest ACTIVE enrollment can be from a past year (e.g.
      // seeded/backfilled data) while the section they're being moved to
      // belongs to a different, current year — the enrollment picked and
      // updated must be the one for the *target* year, or both years' exam
      // cohorts end up wrong (#1020 review finding 1).
      const nextYear = await dataSource.getRepository(AcademicYear).save(
        dataSource.getRepository(AcademicYear).create({
          name: '2027-2028',
          start_date: new Date('2027-01-01'),
          end_date: new Date('2027-12-31'),
          is_current: false,
          tenant_id: TENANT_ID,
        }),
      );
      const nextYearClass = await dataSource.getRepository(Class).save(
        dataSource.getRepository(Class).create({
          name: 'Six',
          numeric_grade: 6,
          academic_year_id: nextYear.id,
          tenant_id: TENANT_ID,
        }),
      );
      const nextYearSection = await dataSource.getRepository(ClassSection).save(
        dataSource.getRepository(ClassSection).create({
          class_id: nextYearClass.id,
          section_name: 'A',
          tenant_id: TENANT_ID,
        }),
      );

      const created = await service.create(
        { full_name: 'Cross Year Move', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const originalEnrollment = await enrollmentRepo.findOneOrFail({
        where: { student_id: created.id, tenant_id: TENANT_ID },
      });

      await service.update(created.id, { class_section_id: nextYearSection.id }, TENANT_ID);

      // The original year's enrollment is untouched...
      const originalYearEnrollment = await enrollmentRepo.findOneOrFail({
        where: { id: originalEnrollment.id },
      });
      expect(originalYearEnrollment.section_id).toBe(SEED_SECTION_1_ID);
      expect(originalYearEnrollment.academic_year_id).toBe(SEED_ACADEMIC_YEAR_ID);

      // ...and a separate, new enrollment row exists for the target year.
      const newYearEnrollment = await enrollmentRepo.findOneOrFail({
        where: { student_id: created.id, academic_year_id: nextYear.id },
      });
      expect(newYearEnrollment.section_id).toBe(nextYearSection.id);
      expect(newYearEnrollment.class_id).toBe(nextYearClass.id);
    });
  });

  describe('guardian unlink revokes invoice share links [68.4.#2298 PUB-10 / D16]', () => {
    // The outer beforeEach deletes students; invoices reference them, so clear ours first.
    afterEach(async () => {
      await dataSource.query('DELETE FROM invoice_share_tokens');
      await dataSource.query('DELETE FROM invoices');
    });

    async function setup() {
      const g1 = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'G One',
          relationship: 'FATHER',
          phone: '+880****1001',
          tenant_id: TENANT_ID,
        }),
      );
      const g2 = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'G Two',
          relationship: 'MOTHER',
          phone: '+880****1002',
          tenant_id: TENANT_ID,
        }),
      );
      const student = await service.create(
        {
          full_name: 'Linked Kid',
          class_section_id: SEED_SECTION_1_ID,
          guardian_ids: [g1.id, g2.id],
        },
        TENANT_ID,
      );
      const other = await service.create(
        { full_name: 'Unrelated Kid', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );
      const foreign = await studentRepo.save(
        studentRepo.create({
          full_name: 'Foreign Kid',
          registration_number: 'REG-FOREIGN-2298',
          roll_number: 1,
          class_section_id: '00000000-0000-4000-8000-000000000097',
          tenant_id: OTHER_TENANT,
        } as any),
      );
      return {
        g1,
        g2,
        student,
        tok: await seedShareToken(dataSource, student.id, TENANT_ID, 1),
        otherTok: await seedShareToken(dataSource, other.id, TENANT_ID, 2),
        foreignTok: await seedShareToken(dataSource, foreign.id, OTHER_TENANT, 3),
      };
    }

    it("revokes the student's links when update drops a guardian; other students and tenants stay live", async () => {
      const c = await setup();
      await service.update(c.student.id, { guardian_ids: [c.g2.id] } as any, TENANT_ID);
      expect(await isRevoked(dataSource, c.tok)).toBe(true);
      expect(await isRevoked(dataSource, c.otherTok)).toBe(false);
      expect(await isRevoked(dataSource, c.foreignTok)).toBe(false);
    });

    it('leaves links live when guardians are unchanged, or a guardian is added', async () => {
      const c = await setup();
      await service.update(c.student.id, { full_name: 'Renamed' } as any, TENANT_ID);
      await service.update(c.student.id, { guardian_ids: [c.g1.id, c.g2.id] } as any, TENANT_ID);
      expect(await isRevoked(dataSource, c.tok)).toBe(false);
      const g3 = await guardianRepo.save(
        guardianRepo.create({
          full_name: 'G Three',
          relationship: 'UNCLE',
          phone: '+880****1003',
          tenant_id: TENANT_ID,
        }),
      );
      await service.update(
        c.student.id,
        { guardian_ids: [c.g1.id, c.g2.id, g3.id] } as any,
        TENANT_ID,
      );
      expect(await isRevoked(dataSource, c.tok)).toBe(false);
    });

    it('partial drop via GuardianService.update revokes only the dropped student', async () => {
      const c = await setup();
      const other = await studentRepo.findOneOrFail({ where: { full_name: 'Unrelated Kid' } });
      await guardianService.update(
        c.g1.id,
        { student_ids: [c.student.id, other.id] } as any,
        TENANT_ID,
      );
      // g1 now covers both kids; drop the first, keep `other`
      await guardianService.update(c.g1.id, { student_ids: [other.id] } as any, TENANT_ID);
      expect(await isRevoked(dataSource, c.tok)).toBe(true);
      expect(await isRevoked(dataSource, c.otherTok)).toBe(false);
      expect(await isRevoked(dataSource, c.foreignTok)).toBe(false);
    });

    it('revokes via GuardianService.update({ student_ids: [] })', async () => {
      const c = await setup();
      await guardianService.update(c.g1.id, { student_ids: [] } as any, TENANT_ID);
      expect(await isRevoked(dataSource, c.tok)).toBe(true);
      expect(await isRevoked(dataSource, c.otherTok)).toBe(false);
    });

    it('revokes via GuardianService.remove', async () => {
      const c = await setup();
      await guardianService.remove(c.g1.id, TENANT_ID);
      expect(await isRevoked(dataSource, c.tok)).toBe(true);
      expect(await isRevoked(dataSource, c.otherTok)).toBe(false);
      expect(await isRevoked(dataSource, c.foreignTok)).toBe(false);
    });
  });

  describe('junction rows to soft-deleted records survive link edits [68.4.#2299 DATA-07]', () => {
    const links = async (): Promise<string[]> =>
      (await dataSource.query('SELECT student_id, guardian_id FROM student_guardians')).map(
        (r: any) => `${r.student_id}|${r.guardian_id}`,
      );

    const mkGuardian = (name: string, n: number) =>
      guardianRepo.save(
        guardianRepo.create({
          full_name: name,
          relationship: 'FATHER',
          phone: `+880****20${n}`,
          tenant_id: TENANT_ID,
        }),
      );
    const mkStudent = (name: string, guardian_ids: string[]) =>
      service.create(
        { full_name: name, class_section_id: SEED_SECTION_1_ID, guardian_ids },
        TENANT_ID,
      );

    it('keeps the G-S row when G is edited to [T] after S was soft-deleted', async () => {
      const g = await mkGuardian('G', 1);
      const s = await mkStudent('S', [g.id]);
      const t = await mkStudent('T', [g.id]);
      await service.remove(s.id, TENANT_ID, null, NO_CTX);
      await guardianService.update(g.id, { student_ids: [t.id] } as any, TENANT_ID);
      const rows = await links();
      expect(rows).toContain(`${s.id}|${g.id}`);
      expect(rows).toContain(`${t.id}|${g.id}`);
    });

    it('keeps the X-B row when X is edited to [A] after guardian B was soft-deleted', async () => {
      const a = await mkGuardian('A', 2);
      const b = await mkGuardian('B', 3);
      const x = await mkStudent('X', [a.id, b.id]);
      await guardianService.remove(b.id, TENANT_ID);
      await service.update(x.id, { guardian_ids: [a.id] } as any, TENANT_ID);
      const rows = await links();
      expect(rows).toContain(`${x.id}|${b.id}`);
      expect(rows).toContain(`${x.id}|${a.id}`);
    });

    it('still removes a link to a live student taken out of the list', async () => {
      const g = await mkGuardian('G', 4);
      const s = await mkStudent('S', [g.id]);
      const t = await mkStudent('T', [g.id]);
      await guardianService.update(g.id, { student_ids: [t.id] } as any, TENANT_ID);
      const rows = await links();
      expect(rows).not.toContain(`${s.id}|${g.id}`);
      expect(rows).toContain(`${t.id}|${g.id}`);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete a student', async () => {
      const created = await service.create(
        { full_name: 'John Doe', class_section_id: SEED_SECTION_1_ID },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID, null, NO_CTX);

      // Should not be found via findOne
      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      // But should still exist with deleted_at set
      const raw = await studentRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw).toBeDefined();
      expect(raw?.deleted_at).not.toBeNull();
    });

    describe('money guard + enrollment close + audit (MON-04 / LIFE-02)', () => {
      const STRUCTURE_ID = '00000000-0000-4000-8000-0000000007a1';
      let actorId: string;

      beforeEach(async () => {
        await dataSource.query('DELETE FROM student_fees');
        await dataSource.query('DELETE FROM student_wallets');
        await dataSource.query('DELETE FROM fee_structures');
        await dataSource.query('DELETE FROM audit_logs');
        await dataSource.getRepository(FeeStructure).save(
          dataSource.getRepository(FeeStructure).create({
            id: STRUCTURE_ID,
            fee_type: FeeType.MONTHLY_TUITION,
            name: 'Tuition',
            amount: 1000,
            class_id: SEED_TENANT_ID, // this spec's seeded class reuses the tenant id
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            tenant_id: TENANT_ID,
          }),
        );
        const userRepo = dataSource.getRepository('User');
        const email = `del-actor-${Date.now()}@example.com`;
        const actor = await userRepo.save(
          userRepo.create({ full_name: 'Delete Actor', email, status: 'ACTIVE' }),
        );
        actorId = (actor as { id: string }).id;
      });

      async function newStudent(): Promise<string> {
        const created = await service.create(
          { full_name: 'Money Kid', class_section_id: SEED_SECTION_1_ID },
          TENANT_ID,
        );
        return created.id;
      }

      async function addBill(
        studentId: string,
        status: FeeStatus,
        paid = 0,
        period = '2026-02-01',
      ): Promise<void> {
        await dataSource.getRepository(StudentFee).save(
          dataSource.getRepository(StudentFee).create({
            student_id: studentId,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
            fee_structure_id: STRUCTURE_ID,
            period_start: new Date(period),
            period_type: PeriodType.MONTH,
            total_amount: 1000,
            paid_amount: paid,
            // A WAIVED bill is settled by its discount (CHK_sf_waived_settled).
            discount_amount: status === FeeStatus.WAIVED ? 1000 : 0,
            one_off_discount_amount: status === FeeStatus.WAIVED ? 1000 : 0,
            status,
          }),
        );
      }

      async function auditRows(studentId: string) {
        return dataSource.getRepository(AuditLog).find({
          where: { entity_id: studentId, entity_type: 'Student', action: AuditAction.DELETE },
        });
      }

      it('refuses a student with a PENDING bill and changes nothing', async () => {
        const id = await newStudent();
        await addBill(id, FeeStatus.PENDING);

        const err = await service.remove(id, TENANT_ID, actorId, NO_CTX).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        const details = (err as ConflictException).getResponse() as {
          details: { open_dues: number; wallet_balance: number };
        };
        expect(details.details.open_dues).toBe(1000);
        expect(details.details.wallet_balance).toBe(0);

        const row = await studentRepo.findOne({ where: { id } });
        expect(row?.deleted_at).toBeNull();
        expect(await auditRows(id)).toHaveLength(0);
        const active = await enrollmentRepo.count({
          where: { student_id: id, enrollment_status: EnrollmentStatus.ACTIVE },
        });
        expect(active).toBeGreaterThan(0); // rollback: enrollments not closed
      });

      it('refuses a student with wallet balance 300 and no dues', async () => {
        const id = await newStudent();
        await dataSource.query(
          `INSERT INTO student_wallets (tenant_id, student_id, balance) VALUES ($1, $2, 300)`,
          [TENANT_ID, id],
        );

        const err = await service.remove(id, TENANT_ID, actorId, NO_CTX).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          details: { open_dues: number; wallet_balance: number };
        };
        expect(body.details.open_dues).toBe(0);
        expect(body.details.wallet_balance).toBe(300);
        expect(await auditRows(id)).toHaveLength(0);
      });

      // Review r1 #4: checkout and payment allocation treat OVERDUE as payable.
      it('refuses a student whose only debt is an OVERDUE bill', async () => {
        const id = await newStudent();
        await addBill(id, FeeStatus.OVERDUE);

        const err = await service.remove(id, TENANT_ID, actorId, NO_CTX).catch((e) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect(((err as ConflictException).getResponse() as any).details.open_dues).toBe(1000);
        expect((await studentRepo.findOne({ where: { id } }))?.deleted_at).toBeNull();
      });

      // Review r1 #5: a first wallet row racing a delete. The FK insert alone
      // takes only KEY SHARE on the student, which never waits for the delete.
      it('a wallet created while a delete is in flight is refused once the delete commits', async () => {
        const id = await newStudent();
        // Stand-in for StudentService.remove holding its lock mid-transaction.
        const qr = dataSource.createQueryRunner();
        await qr.startTransaction();
        try {
          await qr.query(`SELECT 1 FROM students WHERE id = $1 FOR NO KEY UPDATE`, [id]);
          await qr.query(`UPDATE students SET deleted_at = NOW() WHERE id = $1`, [id]);
          const create = dataSource.transaction((m) => walletService.getOrCreate(id, TENANT_ID, m));
          const settled = create.then(
            () => 'created',
            () => 'refused',
          );
          await new Promise((r) => setTimeout(r, 300));
          await qr.commitTransaction();
          expect(await settled).toBe('refused');
        } finally {
          if (qr.isTransactionActive) await qr.rollbackTransaction();
          await qr.release();
        }
        const wallets = await dataSource.query(
          `SELECT 1 FROM student_wallets WHERE student_id = $1`,
          [id],
        );
        expect(wallets).toHaveLength(0);
      });

      it('a delete waits for an in-flight first wallet credit, then refuses', async () => {
        const id = await newStudent();
        const qr = dataSource.createQueryRunner();
        await qr.startTransaction();
        let removal: Promise<unknown> | undefined;
        try {
          const wallet = await walletService.getOrCreate(id, TENANT_ID, qr.manager);
          await qr.query(`UPDATE student_wallets SET balance = 300 WHERE id = $1`, [wallet.id]);
          removal = service.remove(id, TENANT_ID, actorId, NO_CTX).catch((e) => e);
          await new Promise((r) => setTimeout(r, 300));
          await qr.commitTransaction();
        } finally {
          if (qr.isTransactionActive) await qr.rollbackTransaction();
          await qr.release();
        }
        expect(await removal).toBeInstanceOf(ConflictException);
        expect((await studentRepo.findOne({ where: { id } }))?.deleted_at).toBeNull();
      });

      // Review r2 #1: checkout and payment reversal lock the bills, then move
      // wallet money. remove locks the student, then the bills. If moving money
      // on an existing wallet also locked the student, the two would deadlock
      // (40P01) and one side would fail with a 500.
      it('a delete racing a checkout that holds the bills and credits an existing wallet does not deadlock', async () => {
        const id = await newStudent();
        await addBill(id, FeeStatus.PENDING);
        await dataSource.query(
          `INSERT INTO student_wallets (tenant_id, student_id, balance) VALUES ($1, $2, 0)`,
          [TENANT_ID, id],
        );
        const qr = dataSource.createQueryRunner();
        await qr.startTransaction();
        let removal: Promise<unknown> | undefined;
        let credited: unknown;
        try {
          // Stand-in for CheckoutService: the bills are locked first.
          await qr.query(`SELECT 1 FROM student_fees WHERE student_id = $1 FOR UPDATE`, [id]);
          removal = service.remove(id, TENANT_ID, actorId, NO_CTX).catch((e) => e);
          // remove now holds the student lock and waits on the bill.
          await new Promise((r) => setTimeout(r, 300));
          credited = await walletService
            .credit(
              {
                studentId: id,
                tenantId: TENANT_ID,
                amount: 50,
                kind: WalletTransactionKind.CREDIT_CHANGE,
              },
              qr.manager,
            )
            .then(
              () => 'ok',
              (e) => e,
            );
          if (credited === 'ok') await qr.commitTransaction();
        } finally {
          if (qr.isTransactionActive) await qr.rollbackTransaction();
          await qr.release();
        }
        expect(credited).toBe('ok');
        // The bill is still open, so the delete refuses once checkout commits.
        expect(await removal).toBeInstanceOf(ConflictException);
      });

      it('does not block on a soft-deleted open bill', async () => {
        const id = await newStudent();
        await addBill(id, FeeStatus.PENDING);
        await dataSource.query(`UPDATE student_fees SET deleted_at = NOW() WHERE student_id = $1`, [
          id,
        ]);

        await expect(service.remove(id, TENANT_ID, actorId, NO_CTX)).resolves.toBeUndefined();
      });

      it('does not block on a FULLY_PAID or WAIVED bill', async () => {
        const id = await newStudent();
        await addBill(id, FeeStatus.PAID, 1000);
        await addBill(id, FeeStatus.WAIVED, 0, '2026-03-01');

        await expect(service.remove(id, TENANT_ID, actorId, NO_CTX)).resolves.toBeUndefined();
      });

      it('closes ACTIVE enrollments and writes one DELETE audit row with the actor', async () => {
        const id = await newStudent();

        await service.remove(id, TENANT_ID, actorId, { ip: '10.0.0.1', userAgent: 'vitest' });

        const enrollments = await enrollmentRepo.find({ where: { student_id: id } });
        expect(enrollments.length).toBeGreaterThan(0);
        expect(enrollments.every((e) => e.enrollment_status === EnrollmentStatus.INACTIVE)).toBe(
          true,
        );
        const logs = await auditRows(id);
        expect(logs).toHaveLength(1);
        expect(logs[0]?.performed_by_user_id).toBe(actorId);
        expect(logs[0]?.tenant_id).toBe(TENANT_ID);
      });
    });
  });
});

describe('GuardianService (integration)', () => {
  let service: GuardianService;
  let studentRepo: Repository<Student>;
  let guardianRepo: Repository<Guardian>;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentService, GuardianService, AuditService],
      [],
      {
        synchronize: true,
        dropSchema: true,
      },
    );

    service = module.get<GuardianService>(GuardianService);
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
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
      await dataSource.query('DELETE FROM enrollments');
      await dataSource.query('DELETE FROM guardians');
      await dataSource.query('DELETE FROM students');
    }
  });

  describe('create', () => {
    it('should create a guardian', async () => {
      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        phone: '+880****0001',
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result).toBeDefined();
      expect(result.full_name).toBe('Parent Name');
      expect(result.tenant_id).toBe(TENANT_ID);
    });

    it('defaults notifications_enabled to true, so existing reminders keep flowing', async () => {
      const result = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      const stored = await guardianRepo.findOneOrFail({ where: { id: result.id } });
      expect(stored.notifications_enabled).toBe(true);
    });

    it('should link to students when student_ids are provided', async () => {
      // Create a student first
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Test Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        phone: '+880****0001',
        student_ids: [student.id],
      };

      const result = await service.create(dto, TENANT_ID);

      expect(result.students).toBeDefined();
      expect(result.students).toHaveLength(1);
      expect(result.students[0].id).toBe(student.id);
    });

    it('should throw NotFoundException when student_ids belong to a different tenant', async () => {
      const otherStudent = await studentRepo.save(
        studentRepo.create({
          full_name: 'Other Student',
          registration_number: 'REG-2026-0001',
          roll_number: 1,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: OTHER_TENANT,
          date_of_birth: new Date('2010-01-01'),
        }),
      );

      const dto = {
        full_name: 'Parent Name',
        relationship: 'FATHER',
        student_ids: [otherStudent.id],
      };

      await expect(service.create(dto, TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated guardians', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Guardian 1',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Guardian 2',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    // [31.3.7d] The column holds mixed case (`Father` from forms, `OTHER` default).
    it('filters by relationship in any letter case, tenant-scoped', async () => {
      const make = (full_name: string, relationship: string, tenant_id: string) =>
        guardianRepo.save(
          guardianRepo.create({ full_name, relationship, phone: '+880****0009', tenant_id }),
        );
      await make('Mixed Father', 'Father', TENANT_ID);
      await make('Lower Father', 'father', TENANT_ID);
      await make('Other Guardian', 'OTHER', TENANT_ID);
      await make('Foreign Father', 'Father', OTHER_TENANT);

      const fathers = await service.findAll(
        { relationship: 'Father', page: 1, limit: 10 } as never,
        TENANT_ID,
      );
      expect(fathers.data.map((g) => g.full_name).sort()).toEqual(['Lower Father', 'Mixed Father']);

      const others = await service.findAll(
        { relationship: 'other', page: 1, limit: 10 } as never,
        TENANT_ID,
      );
      expect(others.data.map((g) => g.full_name)).toEqual(['Other Guardian']);
    });

    it('should search guardians by name, phone, or email', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Ahmed Khan',
          relationship: 'FATHER',
          phone: '+880****0001',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Fatima Begum',
          relationship: 'MOTHER',
          phone: '+880****0002',
          tenant_id: TENANT_ID,
        }),
      );

      // Search by name
      const result = await service.findAll({ search: 'Ahmed', page: 1, limit: 10 }, TENANT_ID);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Ahmed Khan');
    });

    // [8.11.4]'s list page "Linked students" column, and the global-search
    // launcher's `guardian.students.length > 0` filter — both need
    // `students` loaded, which neither findAll branch loaded before.
    it('loads each guardian`s linked students (no-search branch)', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Linked Student',
          registration_number: 'REG-2026-0002',
          roll_number: 2,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await service.create(
        { full_name: 'Guardian With Child', relationship: 'FATHER', student_ids: [student.id] },
        TENANT_ID,
      );

      const result = await service.findAll({ page: 1, limit: 10 }, TENANT_ID);

      const guardian = result.data.find((g) => g.full_name === 'Guardian With Child');
      expect(guardian?.students).toBeDefined();
      expect(guardian?.students).toHaveLength(1);
      expect(guardian?.students[0].id).toBe(student.id);
    });

    it('loads each guardian`s linked students (search branch)', async () => {
      const student = await studentRepo.save(
        studentRepo.create({
          full_name: 'Linked Student',
          registration_number: 'REG-2026-0003',
          roll_number: 3,
          class_section_id: SEED_SECTION_1_ID,
          tenant_id: TENANT_ID,
          date_of_birth: new Date('2010-01-01'),
        }),
      );
      await service.create(
        {
          full_name: 'Searchable Guardian',
          relationship: 'FATHER',
          student_ids: [student.id],
        },
        TENANT_ID,
      );

      const result = await service.findAll({ search: 'Searchable', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].students).toBeDefined();
      expect(result.data[0].students).toHaveLength(1);
      expect(result.data[0].students[0].id).toBe(student.id);
    });

    // [8.14.9] search regression: `rahim` (lowercase) must find `Rahim`
    // (mixed case) — the original Like-based search was case-sensitive.
    it('finds a guardian searched in a different case (case-insensitive)', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Rahim Uddin',
          relationship: 'FATHER',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll({ search: 'rahim', page: 1, limit: 10 }, TENANT_ID);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Rahim Uddin');
    });

    it('filters by relationship', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Father Guardian',
          relationship: 'FATHER',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Mother Guardian',
          relationship: 'MOTHER',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { relationship: 'MOTHER', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Mother Guardian');
    });

    it('filters by preferred_communication', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'SMS Guardian',
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.SMS,
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Email Guardian',
          relationship: 'MOTHER',
          preferred_communication: CommunicationMedium.EMAIL,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { preferred_communication: CommunicationMedium.EMAIL, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Email Guardian');
    });

    it('filters by is_primary_contact', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Primary Guardian',
          relationship: 'FATHER',
          is_primary_contact: true,
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Secondary Guardian',
          relationship: 'MOTHER',
          is_primary_contact: false,
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { is_primary_contact: false, page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].full_name).toBe('Secondary Guardian');
    });

    it('sorts by full_name using the Bengali collation', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Zebra Guardian',
          relationship: 'FATHER',
          tenant_id: TENANT_ID,
        }),
      );
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Apple Guardian',
          relationship: 'MOTHER',
          tenant_id: TENANT_ID,
        }),
      );

      const result = await service.findAll(
        { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
        TENANT_ID,
      );

      expect(result.data.map((g) => g.full_name)).toEqual(['Apple Guardian', 'Zebra Guardian']);
    });

    // Cross-tenant isolation for every new filter, per server/CLAUDE.md.
    it('does not return another tenant’s guardian for any of the new filters', async () => {
      await guardianRepo.save(
        guardianRepo.create({
          full_name: 'Other Tenant Guardian',
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.EMAIL,
          is_primary_contact: true,
          tenant_id: OTHER_TENANT,
        }),
      );

      const result = await service.findAll(
        {
          relationship: 'FATHER',
          preferred_communication: CommunicationMedium.EMAIL,
          is_primary_contact: true,
          page: 1,
          limit: 10,
        },
        TENANT_ID,
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  /**
   * [5.4a] Self-service ownership. The caller never names a guardian id —
   * the row is chosen by `user_id` AND `tenant_id`, so a user holding
   * memberships in two tenants can only ever reach the row in the tenant
   * they are currently acting in.
   */
  describe('findOwn / updateOwn', () => {
    const OWNER_USER_ID = '00000000-0000-4000-8000-0000054a1001';
    const OTHER_USER_ID = '00000000-0000-4000-8000-0000054a1002';

    beforeEach(async () => {
      for (const [id, email] of [
        [OWNER_USER_ID, 'own-guardian-owner@example.com'],
        [OTHER_USER_ID, 'own-guardian-other@example.com'],
      ]) {
        await dataSource.query(
          `INSERT INTO users (id, email, full_name, status, created_at, updated_at)
           VALUES ($1, $2, 'Own Guardian Fixture', 'ACTIVE', NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [id, email],
        );
      }
    });

    const makeGuardian = (userId: string | null, tenantId: string) =>
      guardianRepo.save(
        guardianRepo.create({
          full_name: 'Own Guardian',
          relationship: 'FATHER',
          phone: '+8801700000001',
          alternate_phone: '+8801700000002',
          email: 'own-guardian@example.com',
          tenant_id: tenantId,
          user_id: userId,
        }),
      );

    it('[2665] removing a guardian with a login drops the PARENT membership and cuts the session', async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'PARENT')
         ON CONFLICT DO NOTHING`,
        [OWNER_USER_ID, TENANT_ID],
      );
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      const before = new Date('2020-01-01T00:00:00Z');
      await dataSource.query(`UPDATE users SET tokens_valid_after = $2 WHERE id = $1`, [
        OWNER_USER_ID,
        before,
      ]);

      await service.remove(guardian.id, TENANT_ID);

      const live = await dataSource.query(
        `SELECT 1 FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = 'PARENT' AND deleted_at IS NULL`,
        [OWNER_USER_ID, TENANT_ID],
      );
      expect(live).toHaveLength(0);
      const [u] = await dataSource.query(`SELECT tokens_valid_after FROM users WHERE id = $1`, [
        OWNER_USER_ID,
      ]);
      expect(new Date(u.tokens_valid_after).getTime()).toBeGreaterThan(before.getTime());
    });

    it('findOwn returns the row linked to that user in that tenant', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const found = await service.findOwn(OWNER_USER_ID, TENANT_ID);

      expect(found.id).toBe(guardian.id);
    });

    it('findOwn does not cross tenants, even for the same user_id', async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      await expect(service.findOwn(OWNER_USER_ID, OTHER_TENANT)).rejects.toThrow(NotFoundException);
    });

    it('findOwn ignores soft-deleted rows', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      await guardianRepo.softDelete({ id: guardian.id });

      await expect(service.findOwn(OWNER_USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);

      // The row is still there — `findOwn` skipped it because `deleted_at` is
      // set, not because the delete was a hard one.
      const softDeleted = await guardianRepo.findOne({
        where: { id: guardian.id },
        withDeleted: true,
      });
      expect(softDeleted).not.toBeNull();
      expect(softDeleted?.deleted_at).not.toBeNull();
    });

    it('findOwn throws for a user with no guardian row', async () => {
      await expect(service.findOwn(OTHER_USER_ID, TENANT_ID)).rejects.toThrow(NotFoundException);
    });

    it('updateOwn writes only the contact fields', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.updateOwn(
        OWNER_USER_ID,
        { alternate_phone: '+8801799999999', preferred_communication: CommunicationMedium.EMAIL },
        TENANT_ID,
      );

      expect(updated.id).toBe(guardian.id);
      expect(updated.alternate_phone).toBe('+8801799999999');
      expect(updated.preferred_communication).toBe(CommunicationMedium.EMAIL);
      expect(updated.full_name).toBe('Own Guardian');
    });

    it("updateOwn maps '' to NULL", async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.updateOwn(OWNER_USER_ID, { alternate_phone: '' }, TENANT_ID);

      expect(updated.alternate_phone).toBeNull();
    });

    it("updateOwn never touches another tenant's row with a matching user_id", async () => {
      // Guardian.user_id is a global @OneToOne, so the two rows below cannot
      // share a user. The stand-in: an identically-shaped row in the other
      // tenant that must be untouched by the tenant-scoped update.
      const mine = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      const theirs = await makeGuardian(OTHER_USER_ID, OTHER_TENANT);

      await service.updateOwn(OWNER_USER_ID, { alternate_phone: '+8801788888888' }, TENANT_ID);

      const untouched = await guardianRepo.findOneOrFail({ where: { id: theirs.id } });
      expect(untouched.alternate_phone).toBe('+8801700000002');
      const changed = await guardianRepo.findOneOrFail({ where: { id: mine.id } });
      expect(changed.alternate_phone).toBe('+8801788888888');
    });

    it('[68.4.05] updateOwn refuses a changed phone/email (CONTACT_OWNED_BY_LOGIN) but allows the same one', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      await expect(
        service.updateOwn(OWNER_USER_ID, { phone: '+8801700009999' }, TENANT_ID),
      ).rejects.toMatchObject({ response: { details: { code: 'CONTACT_OWNED_BY_LOGIN' } } });
      await expect(
        service.updateOwn(OWNER_USER_ID, { phone: guardian.phone as string }, TENANT_ID),
      ).resolves.toBeDefined();
    });

    // Review r2 N3: the same number in another format is not a change, and the stored copy stays.
    it('[68.4.05] updateOwn accepts the same phone in another format and keeps the stored one', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      const local = `0${(guardian.phone as string).slice(-10)}`;
      await expect(
        service.updateOwn(
          OWNER_USER_ID,
          { phone: local, alternate_phone: '01799999999' },
          TENANT_ID,
        ),
      ).resolves.toBeDefined();
      const after = await guardianRepo.findOneByOrFail({ id: guardian.id });
      expect(after.phone).toBe(guardian.phone);
      expect(after.alternate_phone).toBe('01799999999');
    });

    it('[68.4.05] updateOwn keeps the stored email casing on a case-only resubmit', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      await service.updateOwn(
        OWNER_USER_ID,
        { email: 'OWN-GUARDIAN@example.com', alternate_phone: '01799999999' },
        TENANT_ID,
      );
      const after = await guardianRepo.findOneByOrFail({ id: guardian.id });
      expect(after.email).toBe('own-guardian@example.com');
      expect(after.alternate_phone).toBe('01799999999');
    });

    // An equal phone is dropped, not written back: the value read before the update may
    // already be stale if the login's phone was synced in between.
    it('[68.4.05] updateOwn never writes back a stale read of a linked phone', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);
      await guardianRepo.update({ id: guardian.id }, { phone: '+8801700000077' });
      const spy = vi.spyOn(service, 'findOwn').mockResolvedValueOnce(guardian);
      try {
        await service.updateOwn(
          OWNER_USER_ID,
          { phone: '01700000001', alternate_phone: '01799999999' },
          TENANT_ID,
        );
      } finally {
        spy.mockRestore();
      }
      const after = await guardianRepo.findOneByOrFail({ id: guardian.id });
      expect(after.phone).toBe('+8801700000077');
      expect(after.alternate_phone).toBe('01799999999');
    });

    it('updateOwn flips notifications_enabled and returns it', async () => {
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const off = await service.updateOwn(
        OWNER_USER_ID,
        { notifications_enabled: false },
        TENANT_ID,
      );
      expect(off.notifications_enabled).toBe(false);

      const on = await service.updateOwn(OWNER_USER_ID, { notifications_enabled: true }, TENANT_ID);
      expect(on.notifications_enabled).toBe(true);
    });

    it("updateOwn never flips notifications_enabled on another tenant's row", async () => {
      const theirs = await makeGuardian(OTHER_USER_ID, OTHER_TENANT);
      await makeGuardian(OWNER_USER_ID, TENANT_ID);

      await service.updateOwn(OWNER_USER_ID, { notifications_enabled: false }, TENANT_ID);

      const untouched = await guardianRepo.findOneOrFail({ where: { id: theirs.id } });
      expect(untouched.notifications_enabled).toBe(true);
    });

    it('staff update can flip notifications_enabled too', async () => {
      const guardian = await makeGuardian(OWNER_USER_ID, TENANT_ID);

      const updated = await service.update(
        guardian.id,
        { notifications_enabled: false },
        TENANT_ID,
      );

      expect(updated.notifications_enabled).toBe(false);
    });

    it('updateOwn refuses when the caller has no guardian row', async () => {
      await expect(
        service.updateOwn(OTHER_USER_ID, { phone: '+8801777777777' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('should soft delete a guardian', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID);

      await expect(service.findOne(created.id, TENANT_ID)).rejects.toThrow(NotFoundException);

      const raw = await guardianRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(raw?.deleted_at).not.toBeNull();
    });
  });

  // [15.2.2] every Guardian mutation writes a tenant-scoped audit row with
  // field-level old/new values, sharing the mutation's transaction.
  describe('audit', () => {
    let auditLogRepo: Repository<AuditLog>;
    let actorUserId: string;

    beforeAll(async () => {
      auditLogRepo = dataSource.getRepository(AuditLog);
      // `audit_logs.performed_by_user_id` FKs to `users.id` — a made-up
      // UUID would violate that constraint, so a real row is seeded once
      // for every test in this block to attribute to.
      const userRepo = dataSource.getRepository('User');
      const actor = await userRepo.save(
        userRepo.create({
          full_name: 'Audit Actor',
          email: 'audit-actor@example.com',
          status: 'ACTIVE',
        }),
      );
      actorUserId = (actor as { id: string }).id;
    });

    it('writes a CREATE audit record for a new guardian', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
        undefined,
        actorUserId,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', action: AuditAction.CREATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
      expect(logs[0]?.new_values).toMatchObject({ full_name: 'Parent Name' });
    });

    it('writes an UPDATE audit record capturing old and new values', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      await service.update(created.id, { full_name: 'Updated Name' }, TENANT_ID, actorUserId);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.old_values).toMatchObject({ full_name: 'Parent Name' });
      expect(logs[0]?.new_values).toMatchObject({ full_name: 'Updated Name' });
    });

    it('writes an UPDATE audit record for updateOwn', async () => {
      const created = await service.create(
        { full_name: 'Self Parent', relationship: 'FATHER', phone: '+880****0002' },
        TENANT_ID,
      );
      await guardianRepo.update({ id: created.id }, { user_id: actorUserId });

      await service.updateOwn(actorUserId, { alternate_phone: '+8801777777778' }, TENANT_ID);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', action: AuditAction.UPDATE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
      expect(logs[0]?.new_values).toMatchObject({ alternate_phone: '+8801777777778' });
    });

    it('writes a DELETE audit record on remove', async () => {
      const created = await service.create(
        { full_name: 'Parent Name', relationship: 'FATHER', phone: '+880****0001' },
        TENANT_ID,
      );

      await service.remove(created.id, TENANT_ID, actorUserId);

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', action: AuditAction.DELETE },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.performed_by_user_id).toBe(actorUserId);
    });

    it('rolls back both the guardian row and the audit entry on a forced failure', async () => {
      const before = await guardianRepo.count({ where: { tenant_id: TENANT_ID } });

      await expect(
        service.update('00000000-0000-4000-8000-000000000001', { full_name: 'X' }, TENANT_ID),
      ).rejects.toThrow(NotFoundException);

      const after = await guardianRepo.count({ where: { tenant_id: TENANT_ID } });
      expect(after).toBe(before);

      const logs = await auditLogRepo.find({
        where: { entity_id: '00000000-0000-4000-8000-000000000001', entity_type: 'Guardian' },
      });
      expect(logs).toHaveLength(0);
    });

    it('never exposes another tenant’s guardian audit rows', async () => {
      const created = await service.create(
        { full_name: 'Cross Tenant Guardian', relationship: 'FATHER', phone: '+880****0009' },
        OTHER_TENANT,
      );

      const logs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', tenant_id: TENANT_ID },
      });
      expect(logs).toHaveLength(0);

      const otherTenantLogs = await auditLogRepo.find({
        where: { entity_id: created.id, entity_type: 'Guardian', tenant_id: OTHER_TENANT },
      });
      expect(otherTenantLogs).toHaveLength(1);
    });
  });
});

/**
 * [8.14.9] Dedicated regression test for the `bn_icu` collation created by
 * `1788307200000-AddBengaliCollationAndSearchIndexes`. Two spellings of the
 * same name that are canonically equivalent — one using the precomposed
 * Bengali letter ড় (U+09DC, "DDDHA"), one built from ড (U+09A1, "DA") plus a
 * combining nukta (U+09BC) — must sort adjacently under Bengali dictionary
 * order. Under Postgres's default `en_US.utf8` (libc) collation they do
 * not: libc sorts by raw codepoint, so the decomposed spelling (which
 * starts with a *lower* codepoint than the precomposed letter) can land far
 * away from it once other names are interleaved.
 *
 * Named with explicit `\u` escapes in this comment (not just in the code)
 * because editors normalize away the visual difference between the two
 * forms — you cannot tell them apart by eye in a diff.
 */
describe('GuardianService (integration) — Bengali collation', () => {
  let service: GuardianService;
  let guardianRepo: Repository<Guardian>;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [GuardianService, StudentService, AuditService],
      [],
      {
        synchronize: true,
        dropSchema: true,
      },
    );

    service = module.get<GuardianService>(GuardianService);
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    const dataSource = module.get(DataSource);

    await seedReferenceData(dataSource);
  }, 60000);

  it('sorts canonically-equivalent \u09A1\u09BC/\u09DC spellings adjacently, with a Latin name outside the pair', async () => {
    // "\u09AC\u09DC\u09BE" ("b\u01D0" — big) spelled with the precomposed letter
    // \u09DC directly: \u09AC (U+09AC) + \u09DC (U+09DC) + \u09BE (U+09BE). Written
    // with explicit `\\u` JS string escapes, never as a literal pasted
    // character — an editor or diff tool would otherwise silently
    // re-normalize a pasted precomposed/decomposed pair to identical
    // bytes, erasing the very difference this test exists to exercise.
    const precomposed = '\u09AC\u09DC\u09BE';
    // The same word, but with \u09DC spelled as its NFD decomposition:
    // \u09A1 (U+09A1, plain "DA") + a combining nukta \u09BC (U+09BC).
    // Renders identically to `precomposed` above; the underlying bytes differ.
    const decomposed = '\u09AC\u09A1\u09BC\u09BE';

    await guardianRepo.save([
      guardianRepo.create({
        full_name: 'Zebra Guardian', // Latin, sorts after both Bengali forms.
        relationship: 'FATHER',
        tenant_id: TENANT_ID,
      }),
      guardianRepo.create({
        full_name: decomposed,
        relationship: 'MOTHER',
        tenant_id: TENANT_ID,
      }),
      guardianRepo.create({
        full_name: precomposed,
        relationship: 'FATHER',
        tenant_id: TENANT_ID,
      }),
    ]);

    const result = await service.findAll(
      { sort: 'full_name', order: 'asc', page: 1, limit: 10 },
      TENANT_ID,
    );

    const names = result.data.map((g) => g.full_name);
    const precomposedIndex = names.indexOf(precomposed);
    const decomposedIndex = names.indexOf(decomposed);

    expect(precomposedIndex).toBeGreaterThanOrEqual(0);
    expect(decomposedIndex).toBeGreaterThanOrEqual(0);
    // The two canonically-equivalent spellings must be next to each other —
    // no other name (Zebra Guardian) sorted between them.
    expect(Math.abs(precomposedIndex - decomposedIndex)).toBe(1);
    // Both Bengali-script names sort before the Latin-script one under
    // Bengali dictionary order.
    expect(names.indexOf('Zebra Guardian')).toBeGreaterThan(
      Math.max(precomposedIndex, decomposedIndex),
    );
  });
});
