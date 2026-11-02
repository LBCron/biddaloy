import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import {
  EnrollmentStatus,
  ExamKind,
  ExamStatus,
  FinalResultStatus,
  DEFAULT_CONDUCT_ITEMS,
} from '@biddaloy/shared';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { Exam } from '../exams/entities/exam.entity';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { ReportCardNote } from './entities/report-card-note.entity';
import { ReportCardNotesService } from './report-card-notes.service';

/**
 * [70.3.1] ReportCardNotesService on a real database: cohort = ACTIVE/GRADUATED enrollments of the section
 * (D25), upsert by (student, target), lock while published (D28), validation, missing counts.
 */

const TENANT_ID = SEED_TENANT_ID;
const YEAR_ID = '00000000-0000-4000-8000-0000000f0001';
const CLASS_ID = '00000000-0000-4000-8000-0000000f0011';
const OTHER_CLASS_ID = '00000000-0000-4000-8000-0000000f0012';
const SEC_A = '00000000-0000-4000-8000-0000000f0021';
const SEC_B = '00000000-0000-4000-8000-0000000f0022';
const SEC_OTHER_CLASS = '00000000-0000-4000-8000-0000000f0023';
const USER_ID = '00000000-0000-4000-8000-0000000f00aa';
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

describe('ReportCardNotesService (integration)', () => {
  let service: ReportCardNotesService;
  let ds: DataSource;
  let seq = 0;
  let audits: Array<Record<string, any>>;

  beforeAll(async () => {
    audits = [];
    const audit = {
      record: async (row: Record<string, any>) => {
        audits.push(row);
      },
    };
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ReportCardNotesService,
        { provide: AuditService, useValue: audit },
        // Default conduct items: discipline, neatness, punctuality, sports.
        { provide: SchoolsService, useValue: { getResolvedSettings: async () => ({}) } },
        { provide: TeacherScopeService, useValue: { rolesInSection: async () => ({}) } },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(ReportCardNotesService);
    ds = module.get(DataSource);
    // The migration's NULLS NOT DISTINCT unique index that synchronize cannot build.
    await ds.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_report_card_notes_target" ON "report_card_notes" ("student_id", "exam_id", "final_result_id") NULLS NOT DISTINCT`,
    );
    await ds.getRepository(School).save({
      id: TENANT_ID,
      name: 'Test School',
      slug: 'test-school',
      tenant_id: TENANT_ID,
    });
    await ds.getRepository(AcademicYear).save({
      id: YEAR_ID,
      name: '2026',
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_current: true,
      tenant_id: TENANT_ID,
    });
    for (const [id, name] of [
      [CLASS_ID, 'Class Nine'],
      [OTHER_CLASS_ID, 'Class Ten'],
    ]) {
      await ds
        .getRepository(Class)
        .save({ id, name, academic_year_id: YEAR_ID, tenant_id: TENANT_ID });
    }
    for (const [id, class_id, section_name] of [
      [SEC_A, CLASS_ID, 'A'],
      [SEC_B, CLASS_ID, 'B'],
      [SEC_OTHER_CLASS, OTHER_CLASS_ID, 'A'],
    ]) {
      await ds
        .getRepository(ClassSection)
        .save({ id, class_id, section_name, tenant_id: TENANT_ID });
    }
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    audits.length = 0;
    // `updated_by_user_id` is a real FK, and the global truncation empties users between tests.
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'rcn-saver@example.test', 'x', 'Saver', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [USER_ID],
    );
  });

  async function student(
    roll: number,
    sectionId = SEC_A,
    status: EnrollmentStatus = EnrollmentStatus.ACTIVE,
  ): Promise<Student> {
    seq += 1;
    const s = await ds.getRepository(Student).save({
      full_name: `Student ${seq}`,
      registration_number: `REG-RCN-${seq}`,
      roll_number: roll,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2012-01-01'),
      gender: 'MALE',
      enrollment_status: status,
      preferred_communication: 'SMS',
    } as Partial<Student>);
    await ds.getRepository(Enrollment).save({
      tenant_id: TENANT_ID,
      student_id: s.id,
      class_id: CLASS_ID,
      section_id: sectionId,
      academic_year_id: YEAR_ID,
      enrollment_status: status,
    } as Partial<Enrollment>);
    return s;
  }

  async function exam(status: ExamStatus = ExamStatus.PROCESSED): Promise<Exam> {
    seq += 1;
    return ds.getRepository(Exam).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: CLASS_ID,
      name: `Exam ${seq}`,
      kind: ExamKind.TERM,
      status,
    } as Partial<Exam>);
  }

  async function finalResult(status: FinalResultStatus): Promise<FinalResult> {
    // One live final per class-year, so retire the previous one first.
    await ds.getRepository(FinalResult).delete({ tenant_id: TENANT_ID });
    return ds.getRepository(FinalResult).save({
      tenant_id: TENANT_ID,
      academic_year_id: YEAR_ID,
      class_id: CLASS_ID,
      status,
    } as Partial<FinalResult>);
  }

  const full = { discipline: 'A', neatness: 'B', punctuality: 'A', sports: 'C' };

  it('lists only the section cohort (ACTIVE enrollments), in roll order, with default conduct items', async () => {
    const e = await exam();
    const second = await student(2);
    const first = await student(1);
    await student(3, SEC_B); // other section: not in the grid
    await student(4, SEC_A, EnrollmentStatus.TRANSFERRED); // leaver: not in the grid

    const view = await service.get(TENANT_ID, { exam_id: e.id }, SEC_A);

    expect(view.rows.map((r) => r.student_id)).toEqual([first.id, second.id]);
    expect(view.locked).toBe(false);
    expect(view.conduct_items).toEqual(DEFAULT_CONDUCT_ITEMS);
    expect(view.rows[0]).toMatchObject({ remark: null, conduct: {} });
  });

  it('saves, then updates in place (one row per student and target)', async () => {
    const e = await exam();
    const s = await student(1);

    const first = await service.save(
      TENANT_ID,
      USER_ID,
      { exam_id: e.id },
      SEC_A,
      [{ student_id: s.id, remark: '  Good work  ', conduct: full }],
      CTX,
    );
    const second = await service.save(
      TENANT_ID,
      USER_ID,
      { exam_id: e.id },
      SEC_A,
      [{ student_id: s.id, remark: 'Better', conduct: full }],
      CTX,
    );

    expect(first.changed).toBe(1);
    expect(second.changed).toBe(1);
    const rows = await ds.getRepository(ReportCardNote).find({ where: { student_id: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ remark: 'Better', updated_by_user_id: USER_ID });
    // One audit row per save that changed something, carrying the count.
    expect(audits).toHaveLength(2);
    expect(audits[0].new_values).toEqual({
      report_card_notes: { section_id: SEC_A, changed: 1, student_ids: [s.id] },
    });
  });

  it('saves three students in one call, whatever order they arrive in', async () => {
    const e = await exam();
    const [a, b, c] = [await student(1), await student(2), await student(3)];
    const res = await service.save(
      TENANT_ID,
      USER_ID,
      { exam_id: e.id },
      SEC_A,
      [c, a, b].map((st) => ({ student_id: st.id, remark: `R ${st.roll_number}`, conduct: full })),
      CTX,
    );
    expect(res.changed).toBe(3);
    const view = await service.get(TENANT_ID, { exam_id: e.id }, SEC_A);
    expect(view.rows.map((r) => r.remark)).toEqual(['R 1', 'R 2', 'R 3']);
  });

  it('an unchanged resave writes nothing and audits nothing', async () => {
    const e = await exam();
    const s = await student(1);
    const note = { student_id: s.id, remark: 'Same', conduct: full };
    await service.save(TENANT_ID, USER_ID, { exam_id: e.id }, SEC_A, [note], CTX);
    audits.length = 0;

    const again = await service.save(TENANT_ID, USER_ID, { exam_id: e.id }, SEC_A, [note], CTX);

    expect(again.changed).toBe(0);
    expect(audits).toHaveLength(0);
  });

  it('a save without remark keeps the stored remark; null clears it', async () => {
    const e = await exam();
    const s = await student(1);
    const save = (note: { remark?: string | null }) =>
      service.save(
        TENANT_ID,
        USER_ID,
        { exam_id: e.id },
        SEC_A,
        [{ student_id: s.id, conduct: full, ...note }],
        CTX,
      );
    await save({ remark: 'Keep me' });
    await save({});
    expect(
      (await ds.getRepository(ReportCardNote).findOneByOrFail({ student_id: s.id })).remark,
    ).toBe('Keep me');
    await save({ remark: null });
    expect(
      (await ds.getRepository(ReportCardNote).findOneByOrFail({ student_id: s.id })).remark,
    ).toBeNull();
  });

  it('includes a graduate (same cohort as the final result build, D25)', async () => {
    const e = await exam();
    const grad = await student(5, SEC_A, EnrollmentStatus.GRADUATED);
    const view = await service.get(TENANT_ID, { exam_id: e.id }, SEC_A);
    expect(view.rows.map((r) => r.student_id)).toEqual([grad.id]);
  });

  it('keeps grades under a conduct item the school has since removed', async () => {
    const e = await exam();
    const s = await student(1);
    await ds.getRepository(ReportCardNote).save({
      tenant_id: TENANT_ID,
      student_id: s.id,
      exam_id: e.id,
      remark: null,
      conduct: { old_item: 'B', discipline: 'D' },
    });

    await service.save(
      TENANT_ID,
      USER_ID,
      { exam_id: e.id },
      SEC_A,
      [{ student_id: s.id, conduct: { discipline: 'A' } }],
      CTX,
    );

    const row = await ds.getRepository(ReportCardNote).findOneByOrFail({ student_id: s.id });
    expect(row.conduct).toEqual({ old_item: 'B', discipline: 'A' });
  });

  it('works the same on a final result target', async () => {
    const f = await finalResult(FinalResultStatus.PROCESSED);
    const s = await student(1);

    await service.save(
      TENANT_ID,
      USER_ID,
      { final_result_id: f.id },
      SEC_A,
      [{ student_id: s.id, remark: 'Final', conduct: { discipline: 'B' } }],
      CTX,
    );

    const view = await service.get(TENANT_ID, { final_result_id: f.id }, SEC_A);
    expect(view.rows[0]).toMatchObject({ remark: 'Final', conduct: { discipline: 'B' } });
    expect(audits[0]).toMatchObject({ entity_type: 'FinalResult', entity_id: f.id });
  });

  it('409 and no write when the exam is PUBLISHED (D28); a reopened exam saves again', async () => {
    const e = await exam(ExamStatus.PUBLISHED);
    const s = await student(1);
    const note = { student_id: s.id, remark: 'Late', conduct: {} };

    await expect(
      service.save(TENANT_ID, USER_ID, { exam_id: e.id }, SEC_A, [note], CTX),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await ds.getRepository(ReportCardNote).count({ where: { student_id: s.id } })).toBe(0);
    expect((await service.get(TENANT_ID, { exam_id: e.id }, SEC_A)).locked).toBe(true);

    await ds.getRepository(Exam).update({ id: e.id }, { status: ExamStatus.PROCESSED });
    const ok = await service.save(TENANT_ID, USER_ID, { exam_id: e.id }, SEC_A, [note], CTX);
    expect(ok.changed).toBe(1);
  });

  it('409 when the final result is PUBLISHED', async () => {
    const f = await finalResult(FinalResultStatus.PUBLISHED);
    const s = await student(1);
    await expect(
      service.save(
        TENANT_ID,
        USER_ID,
        { final_result_id: f.id },
        SEC_A,
        [{ student_id: s.id, remark: 'x', conduct: {} }],
        CTX,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a bad conduct key, a bad grade, a long remark path, a duplicate and an outsider', async () => {
    const e = await exam();
    const s = await student(1);
    const other = await student(2, SEC_B);
    const save = (notes: any[]) =>
      service.save(TENANT_ID, USER_ID, { exam_id: e.id }, SEC_A, notes, CTX);

    await expect(save([{ student_id: s.id, conduct: { not_an_item: 'A' } }])).rejects.toThrow(
      'Unknown conduct item.',
    );
    await expect(save([{ student_id: s.id, conduct: { discipline: 'E' } }])).rejects.toThrow(
      'Conduct grade must be A, B, C or D.',
    );
    await expect(
      save([
        { student_id: s.id, conduct: {} },
        { student_id: s.id, conduct: {} },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A student of another section (or no enrollment) is refused, and nothing is written.
    await expect(
      save([
        { student_id: s.id, remark: 'ok', conduct: {} },
        { student_id: other.id, remark: 'no', conduct: {} },
      ]),
    ).rejects.toThrow('A student is not in this section.');
    expect(await ds.getRepository(ReportCardNote).count()).toBe(0);
  });

  it('404 for an unknown target, a section of another class, and 400 without exactly one target', async () => {
    const e = await exam();
    await expect(
      service.get(TENANT_ID, { exam_id: '00000000-0000-4000-8000-00000000dead' }, SEC_A),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(TENANT_ID, { exam_id: e.id }, SEC_OTHER_CLASS)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get(TENANT_ID, {}, SEC_A)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.get(TENANT_ID, { exam_id: e.id, final_result_id: e.id }, SEC_A),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('another tenant sees nothing: the exam is a 404 there', async () => {
    const e = await exam();
    await expect(
      service.get('00000000-0000-4000-8000-0000000000ff', { exam_id: e.id }, SEC_A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts students missing a remark or a full conduct grid, per section or per class', async () => {
    const e = await exam();
    const a1 = await student(1);
    await student(2); // nothing saved
    await student(3, SEC_B); // nothing saved, other section
    await service.save(
      TENANT_ID,
      USER_ID,
      { exam_id: e.id },
      SEC_A,
      [{ student_id: a1.id, remark: 'Done', conduct: full }],
      CTX,
    );

    expect(await service.missingCounts(TENANT_ID, { exam_id: e.id }, SEC_A)).toEqual({
      total: 2,
      missing_remark: 1,
      missing_conduct: 1,
    });
    expect(await service.missingCounts(TENANT_ID, { exam_id: e.id })).toEqual({
      total: 3,
      missing_remark: 2,
      missing_conduct: 2,
    });
  });
});
