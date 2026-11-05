/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { UserRole } from '@biddaloy/shared';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { Student } from '../../../students/entities/student.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Class } from '../../../academics/entities/class.entity';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import { GradingScale } from '../../../grading/entities/grading-scale.entity';
import { Exam } from '../../../exams/entities/exam.entity';
import { FinalResult } from '../../../final-results/entities/final-result.entity';
import { FinalResultWeight } from '../../../final-results/entities/final-result-weight.entity';
import { FinalResultRow } from '../../../final-results/entities/final-result-row.entity';
import { FinalResultSubject } from '../../../final-results/entities/final-result-subject.entity';
import { ReportCardNote } from '../../../report-card-notes/entities/report-card-note.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { cellText, toCell } from '../../codec/cell-format';
import { INSERT_ONLY_TABS } from '../../codec/insert-only-tabs';
import type { ImportContext, TabSpec } from '../../codec/tab-spec';
import { academicYearsTab } from '../academics/academic-years.tab';
import { classesTab } from '../academics/classes.tab';
import { sectionsTab } from '../academics/sections.tab';
import { subjectsTab } from '../academics/subjects.tab';
import { gradingScalesTab } from '../grading/grading-scales.tab';
import { studentsTab } from '../people/students.tab';
import { usersTab } from '../people/users.tab';
import { examsTab } from './exams.tab';
import {
  finalResultRowsTab,
  finalResultSubjectsTab,
  finalResultsTab,
  finalResultWeightsTab,
  reportCardNotesTab,
} from './final-results.tabs';

const A = 'a7060000-0000-4000-8000-0000000000a1';
const B = 'a7060000-0000-4000-8000-0000000000b1';
const parents = [
  academicYearsTab,
  classesTab,
  sectionsTab,
  subjectsTab,
  gradingScalesTab,
  studentsTab,
  usersTab,
  examsTab,
] as TabSpec<any, any>[];
// Restore order = registry order.
const mine = [
  finalResultsTab,
  finalResultWeightsTab,
  finalResultRowsTab,
  finalResultSubjectsTab,
  reportCardNotesTab,
] as TabSpec<any, any>[];
const MY_TABLES = [
  'report_card_notes',
  'final_result_subjects',
  'final_result_rows',
  'final_result_weights',
  'final_results',
];

type Cells = Record<string, Record<string, string>[]>;

describe('final results workbook tabs (round trip)', () => {
  let module: TestingModule;
  let ds: DataSource;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  async function seedTenant(id: string, tag: string) {
    for (const t of [...MY_TABLES, 'exams', 'grading_scales']) {
      await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [id]);
    }
    await ds.query(`DELETE FROM schools WHERE id = $1`, [id]);
    await ds.query(`DELETE FROM users WHERE email = $1`, [`staff-${tag}@final-7060.test`]);
    await ds.getRepository(School).save({ id, name: `fr-${tag}-7060`, slug: `fr-${tag}-7060` });
    const user = await ds.getRepository(User).save({
      email: `staff-${tag}@final-7060.test`,
      phone: null,
      full_name: 'Staff',
      password_hash: null,
    } as any);
    await ds
      .getRepository(UserTenant)
      .save({ user_id: user.id, tenant_id: id, role: UserRole.ADMIN } as any);
    const year = await ds.getRepository(AcademicYear).save({
      tenant_id: id,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
    } as any);
    const klass = await ds
      .getRepository(Class)
      .save({ tenant_id: id, name: 'Six', numeric_grade: 6, academic_year_id: year.id } as any);
    const section = await ds
      .getRepository(ClassSection)
      .save({ tenant_id: id, class_id: klass.id, section_name: 'A', capacity: null } as any);
    const student = await ds.getRepository(Student).save({
      tenant_id: id,
      full_name: 'Kid',
      registration_number: `REG-${tag}`,
      roll_number: 1,
      class_section_id: section.id,
    } as any);
    const subject = await ds
      .getRepository(Subject)
      .save({ tenant_id: id, name_en: 'Math', code: `MATH-${tag}`, is_active: true } as any);
    const scale = await ds
      .getRepository(GradingScale)
      .save({ tenant_id: id, academic_year_id: year.id, class_id: null, name: 'Std' } as any);
    const exam = await ds.getRepository(Exam).save({
      tenant_id: id,
      name: 'Term 1',
      kind: 'TERM',
      status: 'PUBLISHED',
      academic_year_id: year.id,
      class_id: klass.id,
    } as any);
    const final = await ds
      .getRepository(FinalResult)
      .save({ tenant_id: id, class_id: klass.id, academic_year_id: year.id } as any);
    const w = { tenant_id: id, final_result_id: final.id, exam_id: exam.id };
    await ds.getRepository(FinalResultWeight).save([
      { ...w, subject_id: null, share_percent: '60.00' },
      { ...w, subject_id: subject.id, share_percent: '40.00' },
    ] as any);
    const row = await ds.getRepository(FinalResultRow).save({
      tenant_id: id,
      final_result_id: final.id,
      student_id: student.id,
      total_marks: '85.00',
      gpa: '4.50',
      grade: 'A',
      position: 1,
      section_id: section.id,
      section_position: 1,
      grading_scale_id: scale.id,
      grading_scale_revision: 3, // D19 pin: must survive a restore as 3
      rule_version: 'v1',
      computed_at: new Date('2026-06-01T10:00:00.000Z'),
      working_days: 100,
      present_days: 90,
    } as any);
    await ds.getRepository(FinalResultSubject).save({
      tenant_id: id,
      final_result_row_id: row.id,
      subject_id: subject.id,
      obtained: '85.00',
      grade: 'A',
      gpa: '4.50',
    } as any);
    await ds.getRepository(ReportCardNote).save([
      {
        tenant_id: id,
        student_id: student.id,
        final_result_id: final.id,
        remark: 'Good',
        conduct: { punctuality: 'A' },
        updated_by_user_id: user.id,
      },
      { tenant_id: id, student_id: student.id, exam_id: exam.id, remark: null, conduct: {} },
    ] as any);
  }

  async function exportTab(tab: TabSpec<any, any>, tenant: string) {
    const keyOf = new Map<string, Map<string, string>>();
    for (const t of [...parents, ...mine]) {
      const es = await t.load(tenant, ds.manager);
      keyOf.set(t.name, new Map(es.map((e: any) => [e.id, t.keyOf(e)])));
    }
    const ctx = { keyOf: (t: string, i: string) => keyOf.get(t)!.get(i)! };
    return (await tab.load(tenant, ds.manager)).map((e: any) => {
      const row = tab.toRow(e, ctx);
      return Object.fromEntries(
        tab.columns.map((c) => {
          const cell = toCell(c.type, row[c.key]);
          return [c.key, cellText(cell === null ? '' : String(cell))];
        }),
      );
    });
  }

  async function exportAll(tenant: string): Promise<Cells> {
    const out: Cells = {};
    for (const t of mine) out[t.name] = await exportTab(t, tenant);
    return out;
  }

  async function refIds(tenant: string, tabs: TabSpec<any, any>[]) {
    const ids: Record<string, Record<string, string>> = {};
    for (const t of tabs) {
      ids[t.name] = Object.fromEntries(
        (await t.load(tenant, ds.manager)).map((e: any) => [t.keyOf(e), e.id]),
      );
    }
    return ids;
  }

  async function restoreAll(tenant: string, cells: Cells) {
    const ids = await refIds(tenant, parents);
    for (const tab of mine) {
      const existing = new Map(
        (await tab.load(tenant, ds.manager)).map((e: any) => [tab.keyOf(e), e]),
      );
      ids[tab.name] ??= {};
      const ctx: ImportContext = { tenantId: tenant, ref: (t, k) => ids[t]?.[k], warn: () => {} };
      for (const [i, c] of cells[tab.name].entries()) {
        const res = tab.fromRow(c, i + 2, ctx);
        if ('errors' in res) throw new Error(JSON.stringify(res.errors));
        const saved = await tab.upsert(
          res.row,
          existing.get(tab.keyOf(res.row)) ?? null,
          tenant,
          ds.manager,
        );
        ids[tab.name][tab.keyOf(res.row)] = saved.id;
      }
    }
  }

  // New rows get new ids; everything else must come back identical.
  const withoutIds = (cells: Cells) =>
    JSON.parse(JSON.stringify(cells, (k, v) => (k === 'id' ? undefined : v)));

  it('exports the five tabs and restores them with the pinned scale revision, leaving school B alone', async () => {
    await seedTenant(A, 'a');
    await seedTenant(B, 'b');
    const before = await exportAll(A);
    expect(Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length]))).toEqual({
      final_results: 1,
      final_result_weights: 2,
      final_result_rows: 1,
      final_result_subjects: 1,
      report_card_notes: 2,
    });
    // Tenant isolation: school B's rows never appear in school A's export.
    expect(JSON.stringify(before)).not.toContain('MATH-b');

    for (const t of MY_TABLES) await ds.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [A]);
    await restoreAll(A, before);

    expect(withoutIds(await exportAll(A))).toEqual(withoutIds(before));
    const row = await ds.getRepository(FinalResultRow).findOneByOrFail({ tenant_id: A });
    expect(row.grading_scale_revision).toBe(3); // D19: never re-derived from the scale
    const note = await ds
      .getRepository(ReportCardNote)
      .findOneByOrFail({ tenant_id: A, remark: 'Good' });
    expect(note.conduct).toEqual({ punctuality: 'A' });
    expect(await ds.getRepository(FinalResultRow).count({ where: { tenant_id: B } })).toBe(1);
  });

  it('refuses a restore that changes a final row; weights and notes may change', async () => {
    // INSERT_ONLY_TABS is what makes validation reject a changed existing row.
    for (const name of ['final_results', 'final_result_rows', 'final_result_subjects']) {
      expect(INSERT_ONLY_TABS.has(name)).toBe(true);
    }
    for (const name of ['final_result_weights', 'report_card_notes']) {
      expect(INSERT_ONLY_TABS.has(name)).toBe(false);
    }
    await seedTenant(A, 'a');
    const rows = await exportTab(finalResultRowsTab, A);
    const existing = (await finalResultRowsTab.load(A, ds.manager))[0];
    const ids = await refIds(A, [...parents, finalResultsTab] as TabSpec<any, any>[]);
    const ctx: ImportContext = { tenantId: A, ref: (t, k) => ids[t]?.[k], warn: () => {} };
    const same: any = finalResultRowsTab.fromRow(rows[0], 2, ctx);
    expect(finalResultRowsTab.diffFields(same.row, existing)).toEqual([]);
    const edited: any = finalResultRowsTab.fromRow({ ...rows[0], total_marks: '99.00' }, 2, ctx);
    expect(finalResultRowsTab.diffFields(edited.row, existing)).toEqual(['total_marks']);
  });
});
