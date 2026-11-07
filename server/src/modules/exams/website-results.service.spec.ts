import { describe, it, expect, vi } from 'vitest';
import { WebsiteResultsService } from './website-results.service';

/** A fake manager: answers each query in order and records the SQL and parameters. */
function build(answers: unknown[], exam: { status: string } | null = { status: 'DRAFT' }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return answers.shift();
    }),
    transaction: async (fn: (m: unknown) => unknown) => fn(manager),
  };
  const repo = { manager, findOne: vi.fn(async () => exam) };
  const audit = { record: vi.fn() };
  return { svc: new WebsiteResultsService(repo as never, audit as never), calls, audit };
}
const CTX = { ip: null, userAgent: null };

describe('WebsiteResultsService (unit)', () => {
  it('publish: a DRAFT or PROCESSED exam is a 409 with the fixed text; nothing is audited', async () => {
    for (const status of ['DRAFT', 'PROCESSED']) {
      const { svc, audit } = build([[[], 0]], { status });
      await expect(svc.publish('e', 't', 'u', CTX)).rejects.toThrow(
        'Only an exam with published results can go on the website.',
      );
      expect(audit.record).not.toHaveBeenCalled();
    }
  });

  it('publish: a PUBLISHED exam is switched on, the site version bumped, one audit row', async () => {
    const { svc, calls, audit } = build([[[{ id: 'e' }], 1], undefined]);
    await svc.publish('e', 't', 'u', CTX);
    expect(calls[0].sql).toContain("status = 'PUBLISHED'");
    expect(calls[0].params).toEqual(['e', 't']); // always scoped by tenant
    expect(calls[1].sql).toContain('version = version + 1');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('publish: an unknown exam is a 404', async () => {
    const { svc } = build([[[], 0]], null);
    await expect(svc.publish('e', 't', 'u', CTX)).rejects.toThrow('Exam not found');
  });

  it('query: an exam not on the website is the one results.not_found', async () => {
    const { svc } = build([[]]);
    await expect(svc.query('t', { examId: 'e', classSectionId: 's', page: 1 })).rejects.toThrow(
      'results.not_found',
    );
  });

  it('query: names off gives a null name; rows map to roll/gpa/grade/passed', async () => {
    const row = {
      id: 'r',
      roll: 4,
      name: 'Real Name',
      gpa: '4.50',
      grade: 'A',
      is_fail: false,
      total: '1',
    };
    const { svc } = build([[{ show: false }], [row]]);
    const page = await svc.query('t', { examId: 'e', classSectionId: 's', page: 1 });
    expect(page.rows).toEqual([
      { id: 'r', roll: 4, name: null, gpa: 4.5, grade: 'A', passed: true },
    ]);
    expect(JSON.stringify(page)).not.toContain('Real Name');
  });

  it('query: page 3 reads offset 200 of a 100-row page; the roll is a bound parameter', async () => {
    const { svc, calls } = build([[{ show: true }], []]);
    const page = await svc.query('t', { examId: 'e', classSectionId: 's', roll: 7, page: 3 });
    expect(page).toMatchObject({ pageSize: 100, total: 0, rows: [] });
    expect(calls[1].sql).toContain('LIMIT 100 OFFSET $5');
    expect(calls[1].params).toEqual(['e', 't', 's', 7, 200]);
  });

  it('detail: a result that is not on this exam is the one results.not_found', async () => {
    const { svc } = build([[{ show: true }], []]);
    await expect(svc.detail('t', 'e', 'r')).rejects.toThrow('results.not_found');
  });
});
