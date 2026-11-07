import { describe, it, expect, vi } from 'vitest';
import { WebsiteResultsService } from './website-results.service';
import { signResultHandle, verifyResultHandle } from './website-results.handle';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-secret';
const UUID_A = '00000000-0000-4000-8000-00000000000a';
const UUID_B = '00000000-0000-4000-8000-00000000000b';

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
    };
    const { svc } = build([[{ show: false }], [row], [{ n: '1' }]]);
    const page = await svc.query('t', { examId: 'e', classSectionId: 's', page: 1 });
    expect(page.rows).toEqual([
      { handle: expect.any(String), roll: 4, name: null, gpa: 4.5, grade: 'A', passed: true },
    ]);
    expect(page.rows[0].handle.split('.')).toHaveLength(4); // exam.result.expiry.signature
    expect(JSON.stringify(page)).not.toContain('Real Name');
  });

  it('query: page 3 reads offset 200 of a 100-row page; the roll is a bound parameter', async () => {
    const { svc, calls } = build([[{ show: true }], [], [{ n: '0' }]]);
    const page = await svc.query('t', { examId: 'e', classSectionId: 's', roll: 7, page: 3 });
    expect(page).toMatchObject({ pageSize: 100, total: 0, rows: [] });
    expect(calls[1].sql).toContain('LIMIT $5 OFFSET $6'); // never interpolated
    expect(calls[1].params).toEqual(['e', 't', 's', 7, 100, 200]);
  });

  it('query: a page past the end still reports the real total', async () => {
    const { svc } = build([[{ show: true }], [], [{ n: '101' }]]);
    const page = await svc.query('t', { examId: 'e', classSectionId: 's', page: 5 });
    expect(page).toMatchObject({ total: 101, rows: [] });
  });

  it('detail: a guessed id or junk is the one results.not_found and touches no database', async () => {
    const { svc, calls } = build([]);
    for (const h of [
      UUID_B,
      'x',
      undefined,
      `${UUID_A}.${UUID_B}.99999999999999.${'A'.repeat(43)}`,
    ]) {
      await expect(svc.detail('t', h)).rejects.toThrow('results.not_found');
    }
    expect(calls).toHaveLength(0);
  });

  it('detail: a handle of another school or an expired one is refused', () => {
    const h = signResultHandle('school-1', UUID_A, UUID_B);
    expect(verifyResultHandle(h, 'school-1')).toEqual({ examId: UUID_A, resultId: UUID_B });
    expect(verifyResultHandle(h, 'school-2')).toBeNull();
    expect(verifyResultHandle(h, 'school-1', Date.now() + 31 * 60 * 1000)).toBeNull();
    expect(verifyResultHandle(h.slice(0, -2) + 'AA', 'school-1')).toBeNull(); // tampered signature
  });

  it('detail: a good handle on an exam no longer on the website is the same 404', async () => {
    const { svc } = build([[]]);
    const h = signResultHandle('t', UUID_A, UUID_B);
    await expect(svc.detail('t', h)).rejects.toThrow('results.not_found');
  });

  it('setShowNames: no change means no write, no version bump, no audit row', async () => {
    const { svc, calls, audit } = build([], {
      status: 'PUBLISHED',
      website_show_names: true,
    } as never);
    await svc.setShowNames('e', 't', 'u', CTX, true);
    expect(calls).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('audit rows carry the old value', async () => {
    const { svc, audit } = build([[[{ id: 'e' }], 1], undefined]);
    await svc.unpublish('e', 't', 'u', CTX);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      old_values: { website_published: true },
      new_values: { website_published: false },
    });
  });
});
