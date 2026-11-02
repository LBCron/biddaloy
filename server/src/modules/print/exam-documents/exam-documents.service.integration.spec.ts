import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ExamDocumentsService } from './exam-documents.service';

describe('ExamDocumentsService (integration)', () => {
  let ds: DataSource;
  let service: ExamDocumentsService;
  let withhold = false;
  const getDueSnapshots = vi.fn();

  let tenantId: string;
  let year: string;
  let cls: string;
  let sectionA: string;
  let sectionB: string;
  let examA: string;
  let examB: string;
  let scale: string;
  let userId: string;

  const q = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
    service = new ExamDocumentsService(
      ds,
      { getDueSnapshots } as any,
      { documentsSettings: async () => ({ withholdAdmitCardForDues: withhold }) } as any,
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const seedTenant = async () => {
    const t = await q(
      `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
      [`ED ${randomUUID()}`, `ed-${randomUUID()}`],
    );
    const y = await q(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2027', '2027-01-01', '2027-12-31', $1) RETURNING id`,
      [t],
    );
    const c = await q(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [y, t],
    );
    const exam = await q(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id)
       VALUES ($1, $2, 'Term', 'TERM', 'PROCESSED', $3) RETURNING id`,
      [y, c, t],
    );
    return { t, y, c, exam };
  };

  const section = (name: string) =>
    q(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, $2, $3) RETURNING id`,
      [cls, name, tenantId],
    );

  const student = async (
    name: string,
    roll: number,
    sectionId: string,
    status = 'ACTIVE',
    classId = cls,
  ) => {
    const id = await q(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, `R-${randomUUID()}`, roll, sectionId, tenantId],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, classId, sectionId, year, status, tenantId],
    );
    return id;
  };

  const result = (
    exam: string,
    studentId: string,
    sectionId: string,
    position: number,
    sectionPosition: number,
    opts: { published?: boolean; fail?: boolean } = {},
  ) =>
    ds.query(
      `INSERT INTO results (exam_id, student_id, total_marks, gpa, grade, position, section_id,
         section_position, is_fail, grading_scale_id, grading_scale_revision, rule_version,
         computed_at, published_at, tenant_id)
       VALUES ($1, $2, 90, 5, 'A+', $3, $4, $5, $6, $7, 1, 'nctb-v1', NOW(), $8, $9)`,
      [
        exam,
        studentId,
        position,
        sectionId,
        sectionPosition,
        opts.fail ?? false,
        scale,
        opts.published === false ? null : new Date(),
        tenantId,
      ],
    );

  beforeEach(async () => {
    withhold = false;
    getDueSnapshots.mockReset();
    const t = await seedTenant();
    ({ t: tenantId, y: year, c: cls, exam: examA } = t);
    examB = await q(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id)
       VALUES ($1, $2, 'Other', 'TERM', 'PROCESSED', $3) RETURNING id`,
      [year, cls, tenantId],
    );
    sectionA = await section('A');
    sectionB = await section('B');
    scale = await q(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id)
       VALUES ('NCTB', 1, $1, $2) RETURNING id`,
      [year, tenantId],
    );
    userId = await q(`INSERT INTO users (full_name, email) VALUES ('P', $1) RETURNING id`, [
      `ed-${randomUUID()}@example.com`,
    ]);
  });

  let copyNo = 0;
  /** Inserts one printed copy through the real tables (job + item). */
  const insertCopy = async (exam: string, studentId: string, outcome = 'OK', revoked = false) => {
    const tpl = await q(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'EXAM_ADMIT_CARD', $2, 10, '{}'::jsonb) RETURNING id`,
      [tenantId, `T-${randomUUID()}`],
    );
    const ver = await q(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenantId, tpl],
    );
    const job = await q(
      `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count, printed_by)
       VALUES ($1, $2, 'EXAM_ADMIT_CARD', 1, $3) RETURNING id`,
      [tenantId, ver, userId],
    );
    await ds.query(
      `INSERT INTO print_job_items (tenant_id, job_id, document_kind, subject_type, subject_id,
         subject_label, copy_number, context_type, context_id, data_snapshot, verify_token_hash,
         outcome, revoked_at)
       VALUES ($1, $2, 'EXAM_ADMIT_CARD', 'STUDENT', $3, 'x', $8, 'EXAM', $4, '{}'::jsonb, $5, $6, $7)`,
      [
        tenantId,
        job,
        studentId,
        exam,
        randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        outcome,
        revoked ? new Date() : null,
        ++copyNo, // copy numbers are unique per (subject, kind, context)
      ],
    );
  };

  describe('admitCardRoster', () => {
    it('lists the class ACTIVE students only, ordered by section then roll', async () => {
      const b1 = await student('B1', 1, sectionB);
      const a2 = await student('A2', 2, sectionA);
      const a1 = await student('A1', 1, sectionA);
      await student('Moved', 3, sectionA, 'TRANSFERRED');
      const otherClass = await q(
        `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 9', $1, $2) RETURNING id`,
        [year, tenantId],
      );
      await student('Other class', 4, sectionA, 'ACTIVE', otherClass);

      const res = await service.admitCardRoster(tenantId, examA);

      expect(res.students.map((s) => s.student_id)).toEqual([a1, a2, b1]);
      expect(res.seat_plan_published).toBe(false);
    });

    it('counts copies per exam context; failed and revoked copies do not count', async () => {
      const s = await student('S', 1, sectionA);
      await insertCopy(examA, s);
      await insertCopy(examA, s, 'FAILED');
      await insertCopy(examA, s, 'OK', true);

      const a = await service.admitCardRoster(tenantId, examA);
      const b = await service.admitCardRoster(tenantId, examB);

      expect(a.students[0].printed_copies).toBe(1);
      expect(a.students[0].last_printed_at).not.toBeNull();
      expect(b.students[0].printed_copies).toBe(0);
      expect(b.students[0].last_printed_at).toBeNull();
    });

    it('setting OFF: has_dues is null for everyone and no fee data is read', async () => {
      await student('S', 1, sectionA);

      const res = await service.admitCardRoster(tenantId, examA);

      expect(res.withhold_for_dues).toBe(false);
      expect(res.students.every((s) => s.has_dues === null)).toBe(true);
      expect(getDueSnapshots).not.toHaveBeenCalled();
    });

    it('setting ON: only the student with total_due > 0 is flagged (a boolean, never an amount)', async () => {
      withhold = true;
      const owes = await student('Owes', 1, sectionA);
      const clear = await student('Clear', 2, sectionA);
      getDueSnapshots.mockResolvedValue(new Map([[owes, { student_id: owes, total_due: 500 }]]));

      const res = await service.admitCardRoster(tenantId, examA);

      expect(res.withhold_for_dues).toBe(true);
      expect(res.students.find((s) => s.student_id === owes)!.has_dues).toBe(true);
      expect(res.students.find((s) => s.student_id === clear)!.has_dues).toBe(false);
      expect(getDueSnapshots).toHaveBeenCalledWith(expect.arrayContaining([owes, clear]), tenantId);
    });

    it('seat_plan_published is true only for a PUBLISHED plan covering a sitting of the exam', async () => {
      const subject = await q(
        `INSERT INTO subjects (name_en, code, tenant_id) VALUES ('Math', $1, $2) RETURNING id`,
        [`M-${randomUUID().slice(0, 8)}`, tenantId],
      );
      const sitting = await q(
        `INSERT INTO exam_schedules (exam_id, subject_id, date, starts_at, ends_at, tenant_id)
         VALUES ($1, $2, '2027-03-01', '10:00', '12:00', $3) RETURNING id`,
        [examA, subject, tenantId],
      );
      const plan = await q(
        `INSERT INTO seat_plans (name, status, seat_order_mode, tenant_id)
         VALUES ('Draft', 'DRAFT', 'SEQUENTIAL', $1) RETURNING id`,
        [tenantId],
      );
      await ds.query(
        `INSERT INTO seat_plan_schedules (seat_plan_id, exam_schedule_id, tenant_id) VALUES ($1, $2, $3)`,
        [plan, sitting, tenantId],
      );
      expect((await service.admitCardRoster(tenantId, examA)).seat_plan_published).toBe(false);

      await ds.query(`UPDATE seat_plans SET status = 'PUBLISHED' WHERE id = $1`, [plan]);
      expect((await service.admitCardRoster(tenantId, examA)).seat_plan_published).toBe(true);
      expect((await service.admitCardRoster(tenantId, examB)).seat_plan_published).toBe(false);
    });

    it("404 for another tenant's exam, and its students never appear", async () => {
      await student('Mine', 1, sectionA);
      const other = await seedTenant();

      await expect(service.admitCardRoster(tenantId, other.exam)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.admitCardRoster(other.t, examA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('meritCandidates', () => {
    const seedRanked = async () => {
      // Section A: positions 1,3,5 (section 1,2,3). Section B: positions 2,4 (section 1,2).
      const ids: Record<string, string> = {};
      const rows: Array<[string, string, number, number]> = [
        ['a1', sectionA, 1, 1],
        ['b1', sectionB, 2, 1],
        ['a2', sectionA, 3, 2],
        ['b2', sectionB, 4, 2],
        ['a3', sectionA, 5, 3],
      ];
      let roll = 1;
      for (const [name, sec, pos, secPos] of rows) {
        ids[name] = await student(name, roll++, sec);
        await result(examA, ids[name], sec, pos, secPos);
      }
      return ids;
    };

    it('CLASS scope: top 3 by class position', async () => {
      const ids = await seedRanked();

      const res = await service.meritCandidates(tenantId, examA, { scope: 'CLASS', top: 3 });

      expect(res.map((r) => r.student_id)).toEqual([ids.a1, ids.b1, ids.a2]);
      expect(res[0]).toMatchObject({ position: 1, section_position: 1, gpa: 5 });
    });

    it('SECTION scope: the topper of each section', async () => {
      const ids = await seedRanked();

      const res = await service.meritCandidates(tenantId, examA, { scope: 'SECTION', top: 1 });

      expect(res.map((r) => r.student_id)).toEqual([ids.a1, ids.b1]);
    });

    it('an unpublished result is excluded', async () => {
      const s = await student('Unpub', 1, sectionA);
      await result(examA, s, sectionA, 1, 1, { published: false });

      expect(await service.meritCandidates(tenantId, examA, { scope: 'CLASS', top: 3 })).toEqual(
        [],
      );
    });

    it('a failed student that still carries a position is excluded', async () => {
      const s = await student('Failed', 1, sectionA);
      await result(examA, s, sectionA, 1, 1, { fail: true });

      expect(await service.meritCandidates(tenantId, examA, { scope: 'CLASS', top: 3 })).toEqual(
        [],
      );
    });

    it("404 for another tenant's exam", async () => {
      const other = await seedTenant();

      await expect(
        service.meritCandidates(tenantId, other.exam, { scope: 'CLASS', top: 3 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('tabulation', () => {
    const subject = (en: string, code: string) =>
      q(
        `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, $2, 'বাংলা', $3) RETURNING id`,
        [tenantId, en, code],
      );
    const component = (exam: string, sub: string, name: string, marks: number, seq: number) =>
      ds.query(
        `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, full_marks, sequence)
         VALUES ($1, $2, $3, $4, 'WRITTEN', $5, $6)`,
        [tenantId, exam, sub, name, marks, seq],
      );
    const processed = async (
      exam: string,
      studentId: string,
      sectionId: string,
      total: number,
      lines: Array<[string, number, boolean]>,
    ) => {
      const r = await q(
        `INSERT INTO results (exam_id, student_id, total_marks, gpa, grade, position, section_id,
           section_position, is_fail, grading_scale_id, grading_scale_revision, rule_version,
           computed_at, tenant_id)
         VALUES ($1, $2, $3, 5, 'A+', 1, $4, 1, false, $5, 1, 'nctb-v1', NOW(), $6) RETURNING id`,
        [exam, studentId, total, sectionId, scale, tenantId],
      );
      for (const [sub, obtained, fail] of lines) {
        await ds.query(
          `INSERT INTO result_subjects (tenant_id, result_id, subject_id, obtained, grade, gpa, is_fail)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, r, sub, obtained, fail ? 'F' : 'A+', fail ? 0 : 5, fail],
        );
      }
    };

    it('returns one row per student by roll with a cell per subject and summed full marks', async () => {
      const bn = await subject('Bangla', 'BN');
      const en = await subject('English', 'EN');
      await component(examA, bn, 'Written', 70, 1);
      await component(examA, bn, 'MCQ', 30, 2);
      await component(examA, en, 'Written', 100, 1);
      const s3 = await student('S3', 3, sectionA);
      const s1 = await student('S1', 1, sectionA);
      const s2 = await student('S2', 2, sectionA);
      await processed(examA, s3, sectionA, 150, [
        [bn, 80, false],
        [en, 70, false],
      ]);
      await processed(examA, s1, sectionA, 190, [
        [bn, 95, false],
        [en, 95, false],
      ]);
      await processed(examA, s2, sectionA, 30, [
        [bn, 20, true],
        [en, 10, true],
      ]);

      const res = await service.tabulation(tenantId, examA, sectionA);

      expect(res.section).toMatchObject({ id: sectionA, name: 'A', class_name: 'Class 8' });
      expect(res.subjects.map((x) => [x.name_en, x.full_marks])).toEqual([
        ['Bangla', 100],
        ['English', 100],
      ]);
      expect(res.rows.map((r) => r.student_id)).toEqual([s1, s2, s3]);
      expect(Object.keys(res.rows[0].cells)).toHaveLength(2);
      expect(res.rows[0].total_marks).toBe(190);
      expect(res.rows[1].cells[bn]).toEqual({ obtained: 20, grade: 'F', is_fail: true });
    });

    it('409 RESULTS_NOT_PROCESSED when the section has no results', async () => {
      await expect(service.tabulation(tenantId, examA, sectionA)).rejects.toMatchObject({
        response: { details: { code: 'RESULTS_NOT_PROCESSED' } },
      });
    });

    it("404 for a section of another class or another tenant's section", async () => {
      const otherClass = await q(
        `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 9', $1, $2) RETURNING id`,
        [year, tenantId],
      );
      const foreign = await q(
        `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'Z', $2) RETURNING id`,
        [otherClass, tenantId],
      );
      await expect(service.tabulation(tenantId, examA, foreign)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const other = await seedTenant();
      await expect(service.tabulation(other.t, other.exam, sectionA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('finalTabulation [70.4.1]', () => {
    const seedFinal = async () => {
      const subj = await q(
        `INSERT INTO subjects (tenant_id, name_en, name_bn, code) VALUES ($1, 'Bangla', 'বাংলা', $2) RETURNING id`,
        [tenantId, `FT-${randomUUID().slice(0, 6)}`],
      );
      const s1 = await student('Final One', 1, sectionA);
      const final = await q(
        `INSERT INTO final_results (tenant_id, class_id, academic_year_id, status) VALUES ($1, $2, $3, 'PROCESSED') RETURNING id`,
        [tenantId, cls, year],
      );
      // Two counted exams: examA 30%, examB 70%. examB has no result for the student (absent).
      for (const [exam, share] of [
        [examA, 30],
        [examB, 70],
      ] as const) {
        await ds.query(
          `INSERT INTO final_result_weights (tenant_id, final_result_id, exam_id, share_percent) VALUES ($1, $2, $3, $4)`,
          [tenantId, final, exam, share],
        );
      }
      const res = await q(
        `INSERT INTO results (exam_id, student_id, total_marks, gpa, grade, position, section_id,
           section_position, is_fail, grading_scale_id, grading_scale_revision, rule_version,
           computed_at, tenant_id)
         VALUES ($1, $2, 60, 4, 'A', 1, $3, 1, false, $4, 1, 'nctb-v1', NOW(), $5) RETURNING id`,
        [examA, s1, sectionA, scale, tenantId],
      );
      await ds.query(
        `INSERT INTO result_subjects (tenant_id, result_id, subject_id, obtained, grade, gpa, is_fail)
         VALUES ($1, $2, $3, 60, 'A', 4, false)`,
        [tenantId, res, subj],
      );
      const row = await q(
        `INSERT INTO final_result_rows (tenant_id, final_result_id, student_id, total_marks, gpa, grade,
           position, section_id, section_position, is_fail, grading_scale_id, grading_scale_revision,
           rule_version, computed_at)
         VALUES ($1, $2, $3, 18, 2.5, 'C', 1, $4, 1, false, $5, 1, 'final-v1', NOW()) RETURNING id`,
        [tenantId, final, s1, sectionA, scale],
      );
      await ds.query(
        `INSERT INTO final_result_subjects (tenant_id, final_result_row_id, subject_id, obtained, grade, gpa, is_fail)
         VALUES ($1, $2, $3, 18, 'C', 2.5, false)`,
        [tenantId, row, subj],
      );
      return { final, s1, subj };
    };

    it('lists the counted exams, then the final marks, per student', async () => {
      const { final, s1, subj } = await seedFinal();
      const res = await service.finalTabulation(tenantId, final, sectionA);
      expect(res.exams.map((e) => e.share_percent).sort()).toEqual([30, 70]);
      const row = res.rows.find((r) => r.student_id === s1)!;
      // Exam A has the student's 60; exam B has no result, so it is null (absent), never 0.
      expect(row.exam_totals).toEqual({ [examA]: 60, [examB]: null });
      expect(row.cells[subj]).toEqual({
        obtained: 18,
        grade: 'C',
        is_fail: false,
        per_exam: { [examA]: 60, [examB]: null },
      });
      expect(row).toMatchObject({ total_marks: 18, gpa: 2.5, position: 1, section_position: 1 });
    });

    it('an ABS subject (every component absent) is null in that exam, never 0', async () => {
      const { final, s1, subj } = await seedFinal();
      const res = await q(
        `INSERT INTO results (exam_id, student_id, total_marks, gpa, grade, position, section_id,
           section_position, is_fail, grading_scale_id, grading_scale_revision, rule_version,
           computed_at, tenant_id)
         VALUES ($1, $2, 0, 0, 'F', NULL, $3, NULL, true, $4, 1, 'nctb-v1', NOW(), $5) RETURNING id`,
        [examB, s1, sectionA, scale, tenantId],
      );
      await ds.query(
        `INSERT INTO result_subjects (tenant_id, result_id, subject_id, obtained, grade, gpa, is_fail)
         VALUES ($1, $2, $3, 0, 'ABS', 0, true)`,
        [tenantId, res, subj],
      );
      const out = await service.finalTabulation(tenantId, final, sectionA);
      const row = out.rows.find((r) => r.student_id === s1)!;
      expect(row.cells[subj].per_exam).toEqual({ [examA]: 60, [examB]: null });
    });

    it('409 when the section has no final rows, 404 for another tenant', async () => {
      const { final } = await seedFinal();
      await expect(service.finalTabulation(tenantId, final, sectionB)).rejects.toMatchObject({
        response: { details: { code: 'RESULTS_NOT_PROCESSED' } },
      });
      const other = await seedTenant();
      await expect(service.finalTabulation(other.t, final, sectionA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
