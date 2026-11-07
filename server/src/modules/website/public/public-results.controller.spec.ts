import { describe, it, expect, vi } from 'vitest';
import { PublicSiteController } from './public-site.controller';

const dto = { captcha_token: 'tok', exam_id: 'e', class_section_id: 's' };
const req = { ip: '1.2.3.4', headers: {}, socket: {} } as never;

function build(hit: number | null) {
  const order: string[] = [];
  const site = {
    liveForWrite: vi.fn(async () => {
      order.push('live');
      return { tenantId: 'T' };
    }),
  };
  const results = {
    query: vi.fn(async () => {
      order.push('query');
      return { rows: [] };
    }),
    detail: vi.fn(async () => ({ subjects: [] })),
  };
  const turnstile = {
    verify: vi.fn(async (_t: string, _ip: string | null) => void order.push('turnstile')),
  };
  const cache = {
    countHit: vi.fn(async () => {
      order.push('budget');
      return hit;
    }),
  };
  const c = new PublicSiteController(
    site as never,
    results as never,
    turnstile as never,
    cache as never,
  );
  return { c, order, results, turnstile, cache };
}

describe('PublicSiteController results routes (unit)', () => {
  it('table: live site, then Turnstile, then the school budget, then the read', async () => {
    const { c, order } = build(1);
    await c.resultsTable('h', dto as never, req);
    expect(order).toEqual(['live', 'turnstile', 'budget', 'query']);
  });

  it('table: a failed Turnstile stops before the budget and the read', async () => {
    const { c, results, turnstile, cache } = build(1);
    turnstile.verify.mockRejectedValueOnce(new Error('captcha'));
    await expect(c.resultsTable('h', dto as never, req)).rejects.toThrow('captcha');
    expect(cache.countHit).not.toHaveBeenCalled();
    expect(results.query).not.toHaveBeenCalled();
  });

  it('the 301st hit of a school in a minute is a 429; the 300th still answers', async () => {
    await expect(build(300).c.resultsTable('h', dto as never, req)).resolves.toBeDefined();
    const over = build(301);
    await expect(over.c.resultsTable('h', dto as never, req)).rejects.toMatchObject({
      status: 429,
    });
    expect(over.results.query).not.toHaveBeenCalled();
  });

  it('Redis down (null count): the read still answers', async () => {
    await expect(build(null).c.resultsTable('h', dto as never, req)).resolves.toBeDefined();
  });

  it('detail: no Turnstile, same school budget, tenant from the host only', async () => {
    const { c, turnstile, results } = build(1);
    await c.resultDetail('h', { exam_id: 'e', result_id: 'r' } as never);
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(results.detail).toHaveBeenCalledWith('T', 'e', 'r');
  });
});
