import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { FinalResultStatus } from '@biddaloy/shared';
import { TranscriptService } from './transcript.service';
import { FinalResultsService } from '../final-results/final-results.service';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { FinalResultWeight } from '../final-results/entities/final-result-weight.entity';
import { ReportCardNote } from '../report-card-notes/entities/report-card-note.entity';
import { School } from '../schools/entities/school.entity';

/** [70.4.1] The transcript's final column and the final card: who sees which final status. */
const TENANT = 't1';
const STUDENT = 's1';
const CLASS = 'c1';
const YEAR = 'y1';

function build(opts: { status?: FinalResultStatus; note?: object | null } = {}) {
  const finals: object[] = opts.status
    ? [
        {
          id: 'f1',
          tenant_id: TENANT,
          class_id: CLASS,
          academic_year_id: YEAR,
          status: opts.status,
        },
      ]
    : [];
  const manager = {
    // Honours the `status` filter the service passes (a value or an `In([...])`).
    findOne: vi.fn(async (entity: unknown, o: any) => {
      if (entity === FinalResult) {
        const want = o.where.status;
        const ok = (s: string) => (typeof want === 'string' ? s === want : want.value.includes(s));
        return (
          (finals as any[]).find((f) => o.where.tenant_id === f.tenant_id && ok(f.status)) ?? null
        );
      }
      if (entity === ReportCardNote) return opts.note ?? null;
      if (entity === School) return { id: TENANT, settings: null };
      return null;
    }),
    find: vi.fn(async (entity: unknown) =>
      entity === FinalResultWeight
        ? [{ exam_id: 'e1', subject_id: null, share_percent: '30.00' }]
        : [],
    ),
  };
  const studentCard = vi.fn(async () => ({
    final_result_id: 'f1',
    exams: [{ exam_id: 'e1', exam_name: 'Half-yearly', total_marks: 70, gpa: 4 }],
    remark: null,
    conduct: [],
  }));
  const moduleRef = { get: vi.fn(() => ({ studentCard })) };
  const enrollment = {
    class_id: CLASS,
    class: { name: 'Class 8' },
    section: { section_name: 'A' },
  };
  const service = new TranscriptService(
    { findOne: async () => ({ id: STUDENT, full_name: 'Stu', roll_number: 1 }) } as any,
    { findOne: async () => enrollment } as any,
    { findOne: async () => ({ id: YEAR, name: '2027' }) } as any,
    { find: async () => [], manager } as any,
    { createQueryBuilder: () => ({}) } as any,
    { getStudentResultCard: vi.fn() } as any,
    { record: vi.fn() } as any,
    moduleRef as any,
  );
  return { service, moduleRef, studentCard, manager };
}

describe('TranscriptService final column', () => {
  it('has a final when it is PUBLISHED, with the whole-exam share', async () => {
    const { service, moduleRef } = build({ status: FinalResultStatus.PUBLISHED });
    const t = await service.getTranscript(TENANT, STUDENT, YEAR, true);
    expect(t.final?.final_result_id).toBe('f1');
    expect(t.final?.exam_shares).toEqual([{ exam_id: 'e1', share_percent: 30 }]);
    // Looked up lazily by class (module cycle), not injected.
    expect(moduleRef.get).toHaveBeenCalledWith(FinalResultsService, { strict: false });
  });

  it('has no final while it is PROCESSED, even for staff', async () => {
    const { service, studentCard } = build({ status: FinalResultStatus.PROCESSED });
    expect((await service.getTranscript(TENANT, STUDENT, YEAR, false)).final).toBeNull();
    expect(studentCard).not.toHaveBeenCalled();
  });

  it('has no final when the class has none', async () => {
    const { service } = build();
    expect((await service.getTranscript(TENANT, STUDENT, YEAR, true)).final).toBeNull();
  });
});

describe('TranscriptService.getFinalResultCard', () => {
  it('a family gets 404 for a PROCESSED final (never a half-computed card)', async () => {
    const { service, studentCard } = build({ status: FinalResultStatus.PROCESSED });
    await expect(service.getFinalResultCard(TENANT, STUDENT, YEAR, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(studentCard).not.toHaveBeenCalled();
  });

  it('staff can preview a PROCESSED final', async () => {
    const { service } = build({ status: FinalResultStatus.PROCESSED });
    expect((await service.getFinalResultCard(TENANT, STUDENT, YEAR, false)).final_result_id).toBe(
      'f1',
    );
  });

  it('404 when the student has no row in the final', async () => {
    const { service, studentCard } = build({ status: FinalResultStatus.PUBLISHED });
    studentCard.mockResolvedValueOnce(null as any);
    await expect(service.getFinalResultCard(TENANT, STUDENT, YEAR, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('adds the remark and the conduct grades from the report-card note', async () => {
    const { service } = build({
      status: FinalResultStatus.PUBLISHED,
      note: { remark: 'Diligent', conduct: { discipline: 'A' } },
    });
    const card = await service.getFinalResultCard(TENANT, STUDENT, YEAR, true);
    expect(card.remark).toBe('Diligent');
    expect(card.conduct.find((c) => c.key === 'discipline')?.grade).toBe('A');
    expect(card.conduct.find((c) => c.key === 'neatness')?.grade).toBeNull();
  });

  it('leaves remark null and conduct empty when no note exists', async () => {
    const { service } = build({ status: FinalResultStatus.PUBLISHED });
    expect(await service.getFinalResultCard(TENANT, STUDENT, YEAR, true)).toMatchObject({
      remark: null,
      conduct: [],
    });
  });
});
