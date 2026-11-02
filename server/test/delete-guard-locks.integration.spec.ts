import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../src/modules/audit/audit.service';
import { AcademicYearService } from '../src/modules/academics/academic-year.service';
import { ClassService, SectionService } from '../src/modules/classes/classes.service';
import { SubjectService } from '../src/modules/academics/subjects.service';
import { RoomsService } from '../src/modules/routines/rooms.service';
import { FeeStructureService } from '../src/modules/fees/fees.service';
import { GradingService } from '../src/modules/grading/grading.service';
import { SchoolSettingsReader } from '../src/modules/schools/settings/school-settings-reader.service';
import { SchoolsService } from '../src/modules/schools/schools.service';
import { Ctx, GUARDED, PARENTS, ParentKind } from './delete-guard-registry';
import { SEED_ADMIN_USER_ID } from './constants';

/**
 * [2706] Delete guards lock the parent row first. A child insert holds FOR KEY SHARE on
 * the parent until it commits; without the parent FOR UPDATE the remove would count zero
 * children, soft-delete, and the child would land under a deleted parent.
 * Deterministic hold: an open transaction inserts the child, remove() starts, we wait on
 * pg_stat_activity until a backend is blocked on a lock, then commit. No sleeps.
 */
describe('delete-guard parent locks (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let ctx: Ctx;
  let seq = 0;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      AcademicYearService,
      ClassService,
      SectionService,
      SubjectService,
      RoomsService,
      GradingService,
      FeeStructureService,
      AuditService,
      SchoolSettingsReader,
      { provide: SchoolsService, useValue: {} },
    ]);
    ds = module.get(DataSource);
    ctx = await newCtx(randomUUID());
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  async function newCtx(tenantId: string): Promise<Ctx> {
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      tenantId,
      'Guard Locks School',
      `guard-locks-${tenantId.slice(0, 8)}`,
    ]);
    return {
      ds,
      tenantId,
      n: () => ++seq,
      svc: {
        academicYears: module.get(AcademicYearService),
        classes: module.get(ClassService),
        sections: module.get(SectionService),
        subjects: module.get(SubjectService),
        rooms: module.get(RoomsService),
        grading: module.get(GradingService),
        feeStructures: module.get(FeeStructureService),
        // No lock test here removes an exam.
        exams: {} as never,
        finalResults: {} as never,
      },
    };
  }

  /** True once some backend is blocked waiting for a lock (our remove()). */
  async function waitForBlockedBackend(): Promise<void> {
    await expect
      .poll(
        async () => {
          const rows = await ds.query(
            `SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database() AND wait_event_type = 'Lock'
               AND pid <> pg_backend_pid() AND query ILIKE '%FOR UPDATE%'`,
          );
          return rows.length;
        },
        { timeout: 15000, interval: 25 },
      )
      .toBeGreaterThan(0);
  }

  /** Insert a `key` child in an open transaction, start the parent remove(), assert it
   *  blocks until the insert commits, then refuses with 409 and the parent survives. */
  async function assertRemoveWaits(key: string, parent: ParentKind): Promise<void> {
    const entry = GUARDED.find((g) => g.key === key)!;
    const parentId = await PARENTS[parent].make(ctx);

    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    let removal: Promise<unknown> | undefined;
    try {
      try {
        // ds that routes every repository through the open transaction
        const txDs = new Proxy(ds, {
          get: (t, p, r) =>
            p === 'getRepository'
              ? (e: never) => qr.manager.getRepository(e)
              : Reflect.get(t, p, r),
        });
        await entry.makeChild({ ...ctx, ds: txDs }, parentId);

        removal = PARENTS[parent].remove(ctx, parentId);
        const settled = removal.then(
          () => 'resolved',
          () => 'rejected',
        );
        let early = false;
        void settled.then(() => (early = true));
        await waitForBlockedBackend();
        expect(early).toBe(false);
      } finally {
        await qr.commitTransaction();
      }
    } finally {
      await qr.release();
    }
    await expect(removal).rejects.toBeInstanceOf(ConflictException);
    expect(await PARENTS[parent].isGone(ctx, parentId)).toBe(false);
  }

  it('FeeStructure remove waits for an in-flight FineRule insert, then refuses', async () => {
    await assertRemoveWaits('FineRule.fee_structure -> FeeStructure', 'FeeStructure');
  }, 60000);

  it('Room remove waits for an in-flight ExamSchedule insert, then refuses', async () => {
    await assertRemoveWaits('ExamSchedule.room -> Room', 'Room');
  }, 60000);

  it('Class remove waits for an in-flight Exam insert, then refuses', async () => {
    await assertRemoveWaits('Exam.class -> Class', 'Class');
  }, 60000);

  it('ClassSection remove waits for an in-flight AttendanceSession insert, then refuses', async () => {
    await assertRemoveWaits('AttendanceSession.section -> ClassSection', 'ClassSection');
  }, 60000);

  it('answers details.dependents with table-name keys', async () => {
    const classId = await PARENTS.Class.make(ctx);
    await GUARDED.find((g) => g.key === 'Exam.class -> Class')!.makeChild(ctx, classId);
    const err = await ctx.svc.classes.remove(classId, ctx.tenantId).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.dependents).toEqual({ exams: 1 });
  });

  it('records the removed teacher assignments in the section DELETE audit row', async () => {
    const classId = await PARENTS.Class.make(ctx);
    const sectionId = (
      await ds.query(
        `INSERT INTO class_sections (id, class_id, section_name, tenant_id)
       VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
        [classId, `S-${ctx.n()}`, ctx.tenantId],
      )
    )[0].id as string;
    const [{ id: teacherId }] = await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'EMP-LOCKS', NOW(), NOW())
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT gen_random_uuid(), $1::uuid, 'LOCKS-TEACHER', '{}', $2::uuid, sp.id, NOW(), NOW() FROM sp
       RETURNING id`,
      [SEED_ADMIN_USER_ID, ctx.tenantId],
    );
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, assignment_type)
       VALUES (gen_random_uuid(), $1, $2, $3, 'CLASS_TEACHER')`,
      [teacherId, sectionId, ctx.tenantId],
    );

    await ctx.svc.sections.remove(classId, sectionId, ctx.tenantId);

    const rows = await ds.query(
      `SELECT old_values FROM audit_logs
       WHERE entity_type = 'ClassSection' AND action = 'DELETE' AND entity_id = $1`,
      [sectionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].old_values.teacher_assignments_removed).toBe(1);
  });

  it("404s another school's fee-structure remove from the lock read", async () => {
    const parentId = await PARENTS.FeeStructure.make(ctx);
    const other = await newCtx(randomUUID());
    await expect(other.svc.feeStructures.remove(parentId, other.tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await PARENTS.FeeStructure.isGone(ctx, parentId)).toBe(false);
  });
});
