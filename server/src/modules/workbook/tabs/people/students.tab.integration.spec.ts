import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { Student } from '../../../students/entities/student.entity';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { studentsTab, type StudentRow } from './students.tab';
import { guardiansTab } from './guardians.tab';

/**
 * Integration tests for the `students` tab against a real Postgres
 * database.
 *
 * The unit spec covers the pure mapping. What it cannot cover:
 * - `Student.registration_number` and `Student.user_id` are unique per school
 *   (C1, C2, D11) — `upsert` must look them up within the tenant and revive a
 *   soft-deleted holder; the same user may hold a student row in each school.
 * - `Student.guardians` has `cascade: ['insert']` on the entity (C7) —
 *   `upsert` must reconcile the `student_guardians` join table via
 *   `addAndRemove`, never by assigning `.guardians` and calling `save`, or
 *   a restore would insert duplicate `Guardian` rows.
 */
describe('studentsTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let guardianRepo: Repository<Guardian>;
  let studentRepo: Repository<Student>;
  let enrollmentRepo: Repository<Enrollment>;
  let yearRepo: Repository<AcademicYear>;
  let classRepo: Repository<Class>;
  let sectionRepo: Repository<ClassSection>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    guardianRepo = module.get<Repository<Guardian>>(getRepositoryToken(Guardian));
    studentRepo = module.get<Repository<Student>>(getRepositoryToken(Student));
    enrollmentRepo = module.get<Repository<Enrollment>>(getRepositoryToken(Enrollment));
    yearRepo = module.get<Repository<AcademicYear>>(getRepositoryToken(AcademicYear));
    classRepo = module.get<Repository<Class>>(getRepositoryToken(Class));
    sectionRepo = module.get<Repository<ClassSection>>(getRepositoryToken(ClassSection));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Children before parents, both tenants.
    await dataSource.createQueryBuilder().delete().from('student_guardians').execute();
    await studentRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await guardianRepo
      .createQueryBuilder()
      .delete()
      .where('tenant_id IN (:...ids)', { ids: [TENANT_A, TENANT_B] })
      .execute();
    await sectionRepo.delete({ tenant_id: TENANT_A });
    await sectionRepo.delete({ tenant_id: TENANT_B });
    await classRepo.delete({ tenant_id: TENANT_A });
    await classRepo.delete({ tenant_id: TENANT_B });
    await yearRepo.delete({ tenant_id: TENANT_A });
    await yearRepo.delete({ tenant_id: TENANT_B });
    await userRepo
      .createQueryBuilder()
      .delete()
      .where('email LIKE :d', { d: '%@students-tab.test' })
      .execute();
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Tenant A School', slug: 'tenant-a-students' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_B, name: 'Tenant B School', slug: 'tenant-b-students' }),
    );
  });

  interface Chain {
    year: AcademicYear;
    klass: Class;
    section: ClassSection;
  }

  async function seedChain(tenantId: string, tag: string): Promise<Chain> {
    const year = await yearRepo.save(
      yearRepo.create({
        name: `2026-${tag}`,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: tenantId,
      }),
    );
    const klass = await classRepo.save(
      classRepo.create({
        name: `Six-${tag}`,
        numeric_grade: 6,
        academic_year_id: year.id,
        tenant_id: tenantId,
      }),
    );
    const section = await sectionRepo.save(
      sectionRepo.create({
        class_id: klass.id,
        section_name: 'A',
        capacity: null,
        tenant_id: tenantId,
      }),
    );
    return { year, klass, section };
  }

  async function makeGuardian(
    tenantId: string,
    overrides: Partial<Guardian> = {},
  ): Promise<Guardian> {
    return guardianRepo.save(
      guardianRepo.create({
        user_id: null,
        full_name: 'Fixture Guardian',
        relationship: 'Father',
        phone: null,
        email: null,
        alternate_phone: null,
        address: null,
        occupation: null,
        preferred_communication: CommunicationMedium.SMS,
        is_primary_contact: true,
        notifications_enabled: true,
        tenant_id: tenantId,
        ...overrides,
      }),
    );
  }

  function rowFor(chain: Chain, overrides: Partial<StudentRow> = {}): StudentRow {
    return {
      id: '00000000-0000-4000-8000-000000000000',
      registration_number: 'STU-001',
      full_name: 'Karim Uddin',
      full_name_bn: null,
      blood_group: null,
      photo_key: null,
      roll_number: 1,
      class_section_id: chain.section.id,
      date_of_birth: null,
      gender: null,
      home_address: null,
      religion: null,
      birth_reg_no: null,
      card_no: null,
      health_notes: null,
      father_name: null,
      mother_name: null,
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      guardian_ids: [],
      user_id: null,
      class_key: `${chain.klass.name}|${chain.year.name}`,
      academic_year_key: chain.year.name,
      section_key: `${chain.klass.name}|${chain.year.name}|A`,
      guardian_keys: [],
      user_key: null,
      ...overrides,
    };
  }

  describe('upsert', () => {
    describe('seat limit [13.2.3]', () => {
      const ctx = async (limit: number | null) => {
        await schoolRepo.update(TENANT_A, { seat_limit: limit });
        return seedChain(TENANT_A, 'seat');
      };

      it('refuses a NEW active student past the limit and writes nothing', async () => {
        const chain = await ctx(1);
        await studentsTab.upsert(rowFor(chain), null, TENANT_A, dataSource.manager);

        await expect(
          studentsTab.upsert(
            rowFor(chain, { registration_number: 'STU-002', roll_number: 2 }),
            null,
            TENANT_A,
            dataSource.manager,
          ),
        ).rejects.toMatchObject({ response: { details: { code: 'SEAT_LIMIT_REACHED' } } });
        expect(await studentRepo.count({ where: { tenant_id: TENANT_A } })).toBe(1);
      });

      it('updating an already-active student never needs a new seat', async () => {
        const chain = await ctx(1);
        const first = await studentsTab.upsert(rowFor(chain), null, TENANT_A, dataSource.manager);
        await expect(
          studentsTab.upsert(
            rowFor(chain, { full_name: 'Renamed' }),
            first,
            TENANT_A,
            dataSource.manager,
          ),
        ).resolves.toBeDefined();
      });

      it('a non-ACTIVE row takes no seat, but re-activating one does', async () => {
        const chain = await ctx(1);
        await studentsTab.upsert(rowFor(chain), null, TENANT_A, dataSource.manager);
        const left = await studentsTab.upsert(
          rowFor(chain, {
            registration_number: 'STU-002',
            roll_number: 2,
            enrollment_status: EnrollmentStatus.INACTIVE,
          }),
          null,
          TENANT_A,
          dataSource.manager,
        );
        await expect(
          studentsTab.upsert(
            rowFor(chain, {
              registration_number: 'STU-002',
              roll_number: 2,
              enrollment_status: EnrollmentStatus.ACTIVE,
            }),
            left,
            TENANT_A,
            dataSource.manager,
          ),
        ).rejects.toMatchObject({ response: { details: { code: 'SEAT_LIMIT_REACHED' } } });
      });

      it('inside one restore transaction the running total refuses the row past the limit and rolls back', async () => {
        const chain = await ctx(2);
        await expect(
          dataSource.transaction(async (m) => {
            for (const n of [1, 2, 3]) {
              await studentsTab.upsert(
                rowFor(chain, { registration_number: `STU-00${n}`, roll_number: n }),
                null,
                TENANT_A,
                m,
              );
            }
          }),
        ).rejects.toMatchObject({ response: { details: { code: 'SEAT_LIMIT_REACHED' } } });
        expect(await studentRepo.count({ where: { tenant_id: TENANT_A } })).toBe(0);
      });

      it('null limit is unlimited', async () => {
        const chain = await ctx(null);
        await studentsTab.upsert(rowFor(chain), null, TENANT_A, dataSource.manager);
        await expect(
          studentsTab.upsert(
            rowFor(chain, { registration_number: 'STU-002', roll_number: 2 }),
            null,
            TENANT_A,
            dataSource.manager,
          ),
        ).resolves.toBeDefined();
      });
    });

    it('stores card_no and keeps a null card null (real DB)', async () => {
      const chain = await seedChain(TENANT_A, 'card');
      const withCard = await studentsTab.upsert(
        rowFor(chain, { card_no: 'C-42' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect((await studentRepo.findOneByOrFail({ id: withCard.id })).card_no).toBe('C-42');

      const noCard = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-002', roll_number: 2 }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect((await studentRepo.findOneByOrFail({ id: noCard.id })).card_no).toBeNull();
    });

    it('creates a new student with the right class_section_id and join rows', async () => {
      const chain = await seedChain(TENANT_A, 'cws');
      const g1 = await makeGuardian(TENANT_A, { phone: '01711111111' });

      const created = await studentsTab.upsert(
        rowFor(chain, { guardian_ids: [g1.id] }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await studentRepo.findOneOrFail({
        where: { id: created.id },
        relations: ['guardians'],
      });
      expect(saved.class_section_id).toBe(chain.section.id);
      expect(saved.tenant_id).toBe(TENANT_A);
      expect(saved.guardians.map((g) => g.id)).toEqual([g1.id]);
    });

    it('updates only full_name for a single changed field', async () => {
      const chain = await seedChain(TENANT_A, 'upd');
      const existing = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-UPD' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await studentsTab.upsert(
        rowFor(chain, {
          id: existing.id,
          registration_number: 'STU-UPD',
          full_name: 'New Name',
        }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const saved = await studentRepo.findOneByOrFail({ id: updated.id });
      expect(saved.full_name).toBe('New Name');
      expect(saved.registration_number).toBe('STU-UPD');
      expect(saved.roll_number).toBe(1);
      expect(saved.class_section_id).toBe(chain.section.id);
      expect(saved.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
    });

    it('revives a soft-deleted student rather than raising 23505 on registration_number (C1)', async () => {
      const chain = await seedChain(TENANT_A, 'rev');
      const created = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-REV' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await studentRepo.findOneByOrFail({ id: created.id });
      await studentsTab.remove(loaded, dataSource.manager);

      const softDeleted = await studentRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
      });
      expect(softDeleted?.deleted_at).not.toBeNull();

      const revived = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-REV', full_name: 'Revived Kid' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      expect(revived.id).toBe(created.id);
      const saved = await studentRepo.findOneByOrFail({ id: revived.id });
      expect(saved.deleted_at).toBeNull();
      expect(saved.full_name).toBe('Revived Kid');
    });

    it('lets two different tenants each have a student with the same registration_number (#728: tenant-scoped, not global)', async () => {
      // Two schools' first-ever student of a year legitimately compute the
      // identical value (`StudentService.create`'s per-tenant sequence),
      // and #620's provision-from-workbook restore hit this for real —
      // restoring a workbook into a fresh tenant threw here because this
      // upsert used to look the row up (and conflict) across every tenant,
      // matching the GLOBAL constraint this column carried before #728
      // scoped it to `(tenant_id, registration_number)`.
      const chainA = await seedChain(TENANT_A, 'xa');
      const chainB = await seedChain(TENANT_B, 'xb');
      const inA = await studentsTab.upsert(
        rowFor(chainA, { registration_number: 'STU-DUP' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const inB = await studentsTab.upsert(
        rowFor(chainB, { registration_number: 'STU-DUP' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      expect(inA.id).not.toBe(inB.id);
      const stillA = await studentRepo.findOneByOrFail({ id: inA.id });
      expect(stillA.tenant_id).toBe(TENANT_A);
      const stillB = await studentRepo.findOneByOrFail({ id: inB.id });
      expect(stillB.tenant_id).toBe(TENANT_B);
    });

    it('still revives (not duplicates) a soft-deleted student with the same registration_number in the SAME tenant', async () => {
      const chain = await seedChain(TENANT_A, 'xr');
      const created = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-SAME-TENANT' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await studentRepo.softDelete({ id: created.id });

      const revived = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-SAME-TENANT', full_name: 'Revived Again' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      expect(revived.id).toBe(created.id);
      const saved = await studentRepo.findOneByOrFail({ id: revived.id });
      expect(saved.deleted_at).toBeNull();
    });

    it('lets the same user hold a student row in each school (D11)', async () => {
      const chainA = await seedChain(TENANT_A, 'ua');
      const chainB = await seedChain(TENANT_B, 'ub');
      const user = await userRepo.save(
        userRepo.create({
          email: 'shared-user@students-tab.test',
          phone: null,
          full_name: 'Shared User',
          password_hash: null,
        }),
      );
      await studentsTab.upsert(
        rowFor(chainA, { registration_number: 'STU-UA', user_id: user.id }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      await studentsTab.upsert(
        rowFor(chainB, { registration_number: 'STU-UB', user_id: user.id, user_key: user.email }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      // One row per school, neither re-tenanted.
      const rows = await studentRepo.find({ where: { user_id: user.id } });
      expect(rows.map((r) => r.tenant_id).sort()).toEqual([TENANT_A, TENANT_B]);
    });

    it('prefers the live holder over a soft-deleted twin with the same user (no 23505)', async () => {
      const chain = await seedChain(TENANT_A, 'tw');
      const user = await userRepo.save(
        userRepo.create({
          email: 'twin-user@students-tab.test',
          phone: null,
          full_name: 'Twin User',
          password_hash: null,
        }),
      );
      const old = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-T1', user_id: user.id }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await studentsTab.remove(
        await studentRepo.findOneByOrFail({ id: old.id }),
        dataSource.manager,
      );
      // The per-school key is partial on deleted_at, so a live twin can hold the user.
      const live = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-T2', roll_number: 2 }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await studentRepo.update(live.id, { user_id: user.id });

      const again = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-T3', roll_number: 2, user_id: user.id }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      expect(again.id).toBe(live.id);

      // A row matching the soft-deleted twin by registration number names the clash.
      await expect(
        studentsTab.upsert(
          rowFor(chain, { registration_number: 'STU-T1', user_id: user.id }),
          null,
          TENANT_A,
          dataSource.manager,
        ),
      ).rejects.toThrow(/already belongs to a different student record/);
      const stillDeleted = await studentRepo.findOne({ where: { id: old.id }, withDeleted: true });
      expect(stillDeleted?.deleted_at).not.toBeNull();
    });
  });

  describe('Enrollment sync (#1020)', () => {
    it('creates a matching ACTIVE Enrollment when a student is first restored', async () => {
      const chain = await seedChain(TENANT_A, 'enr1');

      const created = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-ENR1' }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const enrollment = await enrollmentRepo.findOne({
        where: {
          student_id: created.id,
          tenant_id: TENANT_A,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(enrollment).not.toBeNull();
      expect(enrollment?.class_id).toBe(chain.klass.id);
      expect(enrollment?.section_id).toBe(chain.section.id);
      expect(enrollment?.academic_year_id).toBe(chain.year.id);
    });

    it('updates the Enrollment class_id/section_id when a restore row changes section', async () => {
      const chain = await seedChain(TENANT_A, 'enr2');
      const otherSection = await sectionRepo.save(
        sectionRepo.create({
          class_id: chain.klass.id,
          section_name: 'B',
          capacity: null,
          tenant_id: TENANT_A,
        }),
      );

      const existing = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-ENR2' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const before = await enrollmentRepo.findOneOrFail({
        where: { student_id: existing.id, tenant_id: TENANT_A },
      });
      expect(before.section_id).toBe(chain.section.id);

      await studentsTab.upsert(
        rowFor(chain, {
          id: existing.id,
          registration_number: 'STU-ENR2',
          class_section_id: otherSection.id,
        }),
        existing,
        TENANT_A,
        dataSource.manager,
      );

      const enrollments = await enrollmentRepo.find({
        where: { student_id: existing.id, tenant_id: TENANT_A },
      });
      // Same row updated in place, not a second row.
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0].id).toBe(before.id);
      expect(enrollments[0].section_id).toBe(otherSection.id);
      expect(enrollments[0].class_id).toBe(chain.klass.id);
    });

    it('round-trip: export then restore preserves Enrollment state', async () => {
      const chain = await seedChain(TENANT_A, 'enr3');
      const created = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-ENR3' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const before = await enrollmentRepo.findOneOrFail({
        where: { student_id: created.id, tenant_id: TENANT_A },
      });

      const [loaded] = await studentsTab.load(TENANT_A, dataSource.manager);
      // Re-upsert the same unchanged row, simulating an export → restore
      // round trip with no edits.
      await studentsTab.upsert(
        rowFor(chain, { id: created.id, registration_number: 'STU-ENR3' }),
        loaded,
        TENANT_A,
        dataSource.manager,
      );

      const after = await enrollmentRepo.findOneOrFail({
        where: { student_id: created.id, tenant_id: TENANT_A },
      });
      expect(after.id).toBe(before.id);
      expect(after.section_id).toBe(chain.section.id);
      expect(after.class_id).toBe(chain.klass.id);
    });

    it('does not sync Enrollment to another tenant`s section even if the row`s class_section_id collides', async () => {
      const chainA = await seedChain(TENANT_A, 'enrx-a');
      const chainB = await seedChain(TENANT_B, 'enrx-b');

      // A restore row for tenant A whose class_section_id happens to name
      // tenant B's section id — the ClassSection lookup must not resolve
      // it (no tenant_id filter would let this leak the student into
      // tenant B's class/section).
      const created = await studentsTab.upsert(
        rowFor(chainA, {
          registration_number: 'STU-ENRX',
          class_section_id: chainB.section.id,
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const enrollment = await enrollmentRepo.findOne({
        where: { student_id: created.id, tenant_id: TENANT_A },
      });
      expect(enrollment).toBeNull();
    });

    it('does not create or update an ACTIVE Enrollment for a restored row whose enrollment_status is not ACTIVE', async () => {
      const chain = await seedChain(TENANT_A, 'enrna');

      const created = await studentsTab.upsert(
        rowFor(chain, {
          registration_number: 'STU-ENRNA',
          enrollment_status: EnrollmentStatus.GRADUATED,
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      const enrollment = await enrollmentRepo.findOne({
        where: {
          student_id: created.id,
          tenant_id: TENANT_A,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      expect(enrollment).toBeNull();
    });
  });

  describe('remove', () => {
    it('soft-deletes: deleted_at is set, absent from load, present with withDeleted, join rows survive', async () => {
      const chain = await seedChain(TENANT_A, 'rm');
      const g1 = await makeGuardian(TENANT_A, { phone: '01711111112' });
      const created = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-RM', guardian_ids: [g1.id] }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await studentRepo.findOneByOrFail({ id: created.id });

      await studentsTab.remove(loaded, dataSource.manager);

      const defaultFind = await studentRepo.findOne({ where: { id: created.id } });
      expect(defaultFind).toBeNull();

      const withDeleted = await studentRepo.findOne({
        where: { id: created.id },
        withDeleted: true,
        relations: ['guardians'],
      });
      expect(withDeleted?.deleted_at).not.toBeNull();
      expect(withDeleted?.guardians.map((g) => g.id)).toEqual([g1.id]);
    });
  });

  describe('load', () => {
    it('never returns a tenant B student when loading tenant A', async () => {
      const chainA = await seedChain(TENANT_A, 'la');
      const chainB = await seedChain(TENANT_B, 'lb');
      const studentA = await studentsTab.upsert(
        rowFor(chainA, { registration_number: 'STU-LA' }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      await studentsTab.upsert(
        rowFor(chainB, { registration_number: 'STU-LB' }),
        null,
        TENANT_B,
        dataSource.manager,
      );

      const loaded = await studentsTab.load(TENANT_A, dataSource.manager);

      expect(loaded.map((s) => s.id)).toEqual([studentA.id]);
    });
  });

  describe('guardian sharing and dedup (C7)', () => {
    it('two siblings sharing two guardians export the same guardian_phones and re-import to the same links with no duplicate join rows', async () => {
      const chain = await seedChain(TENANT_A, 'sib');
      const g1 = await makeGuardian(TENANT_A, {
        full_name: 'Karim Uddin',
        relationship: 'Father',
        phone: '01711111111',
      });
      const g2 = await makeGuardian(TENANT_A, {
        full_name: 'Rahima Begum',
        relationship: 'Mother',
        phone: '01722222222',
      });

      const s1 = await studentsTab.upsert(
        rowFor(chain, {
          registration_number: 'STU-001',
          roll_number: 1,
          guardian_ids: [g1.id, g2.id],
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const s2 = await studentsTab.upsert(
        rowFor(chain, {
          registration_number: 'STU-002',
          roll_number: 2,
          guardian_ids: [g1.id, g2.id],
        }),
        null,
        TENANT_A,
        dataSource.manager,
      );

      // Export leg: both students should render the identical guardian_phones cell.
      const loaded = await studentsTab.load(TENANT_A, dataSource.manager);
      const s1Entity = loaded.find((s) => s.id === s1.id)!;
      const s2Entity = loaded.find((s) => s.id === s2.id)!;
      const sectionKeyForExport = `${chain.klass.name}|${chain.year.name}|A`;
      const classKeyForExport = `${chain.klass.name}|${chain.year.name}`;
      const exportCtx = {
        keyOf: (tab: string, id: string) => {
          if (tab === 'guardians') {
            const g = [g1, g2].find((guardian) => guardian.id === id)!;
            return guardiansTab.keyOf(g);
          }
          if (tab === 'sections' && id === chain.section.id) return sectionKeyForExport;
          if (tab === 'classes' && id === chain.klass.id) return classKeyForExport;
          if (tab === 'academic_years' && id === chain.year.id) return chain.year.name;
          return '';
        },
      };
      const row1 = studentsTab.toRow(s1Entity, exportCtx);
      const row2 = studentsTab.toRow(s2Entity, exportCtx);
      expect(row1.guardian_phones).toEqual(row2.guardian_phones);
      expect(row1.guardian_phones).toEqual(['01711111111', '01722222222']);

      // Import leg: re-upsert both students (idempotency check for addAndRemove).
      const sectionKey = `${chain.klass.name}|${chain.year.name}|A`;
      const classKey = `${chain.klass.name}|${chain.year.name}`;
      const importCtx = {
        tenantId: TENANT_A,
        ref: (tab: string, key: string) => {
          if (tab === 'guardians') {
            if (key === '01711111111') return g1.id;
            if (key === '01722222222') return g2.id;
            return undefined;
          }
          if (tab === 'sections' && key === sectionKey) return chain.section.id;
          if (tab === 'classes' && key === classKey) return chain.klass.id;
          if (tab === 'academic_years' && key === chain.year.name) return chain.year.id;
          return undefined;
        },
        warn: () => {},
      };
      const fromRow1 = studentsTab.fromRow(
        { ...emptyCellsFor(row1), guardian_phones: '01711111111;01722222222' },
        2,
        importCtx,
      );
      if ('errors' in fromRow1) throw new Error(JSON.stringify(fromRow1.errors));

      await studentsTab.upsert(
        { ...fromRow1.row, id: s1.id, registration_number: 'STU-001', roll_number: 1 },
        s1Entity,
        TENANT_A,
        dataSource.manager,
      );
      await studentsTab.upsert(
        { ...fromRow1.row, id: s2.id, registration_number: 'STU-002', roll_number: 2 },
        s2Entity,
        TENANT_A,
        dataSource.manager,
      );

      // The named dedup assertions: guardian count unchanged, exactly 4 join rows.
      const guardianCount = await guardianRepo.count({ where: { tenant_id: TENANT_A } });
      expect(guardianCount).toBe(2);

      const joinRows = await dataSource
        .createQueryBuilder()
        .select('*')
        .from('student_guardians', 'sg')
        .where('sg.student_id IN (:...ids)', { ids: [s1.id, s2.id] })
        .getRawMany();
      expect(joinRows).toHaveLength(4);

      const s1Final = await studentRepo.findOneOrFail({
        where: { id: s1.id },
        relations: ['guardians'],
      });
      const s2Final = await studentRepo.findOneOrFail({
        where: { id: s2.id },
        relations: ['guardians'],
      });
      expect(s1Final.guardians.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
      expect(s2Final.guardians.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
    });

    it('replaces links: re-upsert with only one guardian removes the other link but keeps the guardian row', async () => {
      const chain = await seedChain(TENANT_A, 'rep');
      const g1 = await makeGuardian(TENANT_A, { phone: '01733333331' });
      const g2 = await makeGuardian(TENANT_A, { phone: '01733333332' });

      const s1 = await studentsTab.upsert(
        rowFor(chain, { registration_number: 'STU-REP', guardian_ids: [g1.id, g2.id] }),
        null,
        TENANT_A,
        dataSource.manager,
      );
      const loaded = await studentRepo.findOneOrFail({
        where: { id: s1.id },
        relations: ['guardians'],
      });

      await studentsTab.upsert(
        rowFor(chain, { id: s1.id, registration_number: 'STU-REP', guardian_ids: [g1.id] }),
        loaded,
        TENANT_A,
        dataSource.manager,
      );

      const updated = await studentRepo.findOneOrFail({
        where: { id: s1.id },
        relations: ['guardians'],
      });
      expect(updated.guardians.map((g) => g.id)).toEqual([g1.id]);

      const guardianCount = await guardianRepo.count({ where: { tenant_id: TENANT_A } });
      expect(guardianCount).toBe(2);
    });
  });
});

function emptyCellsFor(row: Record<string, unknown>): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const column of studentsTab.columns) {
    const value = row[column.key];
    if (value === undefined || value === null) {
      cells[column.key] = '';
    } else if (Array.isArray(value)) {
      cells[column.key] = value.join(';');
    } else {
      cells[column.key] = String(value);
    }
  }
  return cells;
}
