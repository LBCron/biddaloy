import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { CoordinatorAssignment } from '../../../academics/entities/coordinator-assignment.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { UserRole } from '@biddaloy/shared';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { teachersTab } from './teachers.tab';
import { usersTab } from './users.tab';
import { classesTab, subjectsTab } from '../academics';
import {
  coordinatorAssignmentsTab,
  type CoordinatorAssignmentRow,
} from './coordinator-assignments.tab';

/**
 * [83.2.3] Round-trip of the `coordinator_assignments` tab against Postgres: export three rows
 * (two class-level, one subject-level), wipe them, import the cells back, and get the same rows.
 * Tenant B's rows never appear in tenant A's export.
 */
describe('coordinatorAssignmentsTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  const TENANT_A = '13131313-1313-4131-8131-131313131313';
  const TENANT_B = '14141414-1414-4141-8141-141414141414';
  const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    for (const id of [TENANT_A, TENANT_B]) {
      if (!(await dataSource.getRepository(School).findOne({ where: { id } }))) {
        await dataSource
          .getRepository(School)
          .save({ id, name: `CA tab ${id.slice(0, 4)}`, slug: `ca-tab-${id.slice(0, 4)}` });
      }
    }
  });

  afterAll(async () => {
    await module?.close();
  });

  interface Chain {
    teacher: Teacher;
    classes: Class[];
    subject: Subject;
    admin: User;
  }

  // teachers / subjects / coordinator rows are reset before every test (test/reset-order.ts);
  // years and classes are not, so each test makes its own with a unique name.
  async function seedChain(tenantId: string): Promise<Chain> {
    const t = tag();
    const users = dataSource.getRepository(User);
    const teacherUser = await users.save({ email: `ca-t-${t}@tab.test`, full_name: 'T' });
    const admin = await users.save({ email: `ca-a-${t}@tab.test`, full_name: 'A' });
    // The admin is a member, so the `users` tab exports them and `assigned_by` has a key.
    await dataSource.getRepository(UserTenant).save({
      user_id: admin.id,
      tenant_id: tenantId,
      role: UserRole.ADMIN,
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: teacherUser.id,
      employee_id: `EMP-CA-${t}`,
      tenant_id: tenantId,
      designations: [],
    });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Y-${t}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: false,
      tenant_id: tenantId,
    });
    const classes: Class[] = [];
    for (const n of ['Six', 'Seven']) {
      classes.push(
        await dataSource
          .getRepository(Class)
          .save({ name: `${n}-${t}`, academic_year_id: year.id, tenant_id: tenantId }),
      );
    }
    const subject = await dataSource
      .getRepository(Subject)
      .save({ tenant_id: tenantId, name_en: 'Mathematics', code: `M-${t.slice(-6)}` });
    return { teacher, classes, subject, admin };
  }

  /** Builds an ExportContext from the referenced tabs' own loaded rows, like the exporter does. */
  async function exportContext(tenantId: string): Promise<ExportContext> {
    const m = dataSource.manager;
    const maps: Record<string, Map<string, string>> = {};
    for (const tab of [teachersTab, classesTab, subjectsTab, usersTab]) {
      const rows: { id: string }[] = await tab.load(tenantId, m);
      maps[tab.name] = new Map(rows.map((r) => [r.id, tab.keyOf(r as never)]));
    }
    return {
      keyOf: (tab, id) => {
        const key = maps[tab]?.get(id);
        if (key === undefined) throw new Error(`no ${tab} ${id}`);
        return key;
      },
      tryKeyOf: (tab, id) => maps[tab]?.get(id) ?? null,
    } as ExportContext;
  }

  async function importContext(tenantId: string): Promise<ImportContext> {
    const m = dataSource.manager;
    const maps: Record<string, Map<string, string>> = {};
    for (const tab of [teachersTab, classesTab, subjectsTab, usersTab]) {
      const rows: { id: string }[] = await tab.load(tenantId, m);
      maps[tab.name] = new Map(rows.map((r) => [tab.keyOf(r as never), r.id]));
    }
    return { tenantId, ref: (tab, key) => maps[tab]?.get(key), warn: () => undefined };
  }

  const shape = (rows: CoordinatorAssignment[]) =>
    rows
      .map((r) => `${r.teacher_id}|${r.class_id}|${r.subject_id ?? ''}|${r.assigned_by_user_id}`)
      .sort();

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM coordinator_assignments WHERE tenant_id = ANY($1)`, [
      [TENANT_A, TENANT_B],
    ]);
  });

  it('export → wipe → import gives identical rows; tenant B stays out', async () => {
    const a = await seedChain(TENANT_A);
    const b = await seedChain(TENANT_B);
    const repo = dataSource.getRepository(CoordinatorAssignment);
    const base = { tenant_id: TENANT_A, teacher_id: a.teacher.id, assigned_by_user_id: a.admin.id };
    await repo.save([
      { ...base, class_id: a.classes[0].id },
      { ...base, class_id: a.classes[1].id },
      { ...base, class_id: a.classes[1].id, subject_id: a.subject.id },
    ]);
    await repo.save({
      tenant_id: TENANT_B,
      teacher_id: b.teacher.id,
      class_id: b.classes[0].id,
    });

    const m = dataSource.manager;
    const loaded = await coordinatorAssignmentsTab.load(TENANT_A, m);
    expect(loaded).toHaveLength(3);
    const before = shape(loaded);
    const ectx = await exportContext(TENANT_A);
    const sheet = loaded.map((e) => coordinatorAssignmentsTab.toRow(e, ectx));
    const keysBefore = loaded.map((e) => coordinatorAssignmentsTab.keyOf(e)).sort();

    await repo.delete({ tenant_id: TENANT_A });

    const ictx = await importContext(TENANT_A);
    for (const [i, cells] of sheet.entries()) {
      const asText = Object.fromEntries(
        Object.entries(cells).map(([k, v]) => [k, v === null ? '' : String(v)]),
      );
      const parsed = coordinatorAssignmentsTab.fromRow(asText, i + 2, ictx);
      if (!('row' in parsed)) throw new Error(JSON.stringify(parsed.errors));
      await coordinatorAssignmentsTab.upsert(parsed.row, null, TENANT_A, m);
    }

    const after = await coordinatorAssignmentsTab.load(TENANT_A, m);
    expect(shape(after)).toEqual(before);
    expect(after.map((e) => coordinatorAssignmentsTab.keyOf(e)).sort()).toEqual(keysBefore);
    // Tenant B's row is untouched and never in A's export.
    expect(await repo.count({ where: { tenant_id: TENANT_B } })).toBe(1);
    expect(loaded.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });
});
