import { describe, it, expect, vi } from 'vitest';
import { RESERVED_SUBDOMAINS } from '@biddaloy/shared';
import { SubdomainService, candidatesFor, isValidSubdomain } from './subdomain.service';
import { PreviewTokenService, PREVIEW_TTL_MS } from './preview-token.service';

describe('isValidSubdomain', () => {
  it('accepts 3-30 chars of a-z, 0-9 and inner hyphens', () => {
    for (const ok of ['abc', 'a-b', 'green-valley-1', 'a'.repeat(30), '123']) {
      expect(isValidSubdomain(ok)).toBe(true);
    }
  });

  it('refuses malformed values', () => {
    const bad = ['ab', 'a'.repeat(31), '-abc', 'abc-', 'ABC', 'a_b', 'a.b', 'a b', '', 'ক খ গ'];
    for (const v of bad) expect(isValidSubdomain(v)).toBe(false);
    expect(isValidSubdomain(undefined)).toBe(false);
    expect(isValidSubdomain(42)).toBe(false);
  });

  it('refuses every reserved word', () => {
    for (const r of RESERVED_SUBDOMAINS) expect(isValidSubdomain(r)).toBe(false);
  });
});

describe('candidatesFor', () => {
  it('orders slug, initials, slug-school and drops invalid or reserved ones', () => {
    expect(candidatesFor('Green Valley High')).toEqual([
      'green-valley-high',
      'gvh',
      'green-valley-high-school',
    ]);
    // "Admin" is reserved, and its initials are too short.
    expect(candidatesFor('Admin')).toEqual(['admin-school']);
  });
});

function setup(o: { current?: string; taken?: boolean } = {}) {
  const state = { subdomain: o.current ?? 'old-name', update: undefined as unknown };
  const qb: Record<string, unknown> = {
    where: () => qb,
    andWhere: () => qb,
    getExists: async () => o.taken ?? false,
  };
  const update = vi.fn(async (_e: unknown, _w: unknown, set: unknown) => {
    state.update = set;
  });
  const freed: unknown[] = [];
  const mq: Record<string, unknown> = {
    update: () => mq,
    set: (v: unknown) => (freed.push(v), mq),
    where: () => mq,
    execute: async () => undefined,
  };
  const manager = {
    transaction: async (cb: (m: unknown) => unknown) =>
      cb({ update, createQueryBuilder: () => mq }),
  };
  const sites = { createQueryBuilder: () => qb, manager, update };
  const config = { get: vi.fn(async () => ({ subdomain: state.subdomain })) };
  const cache = { invalidate: vi.fn(async () => undefined) };
  const schools = { findOneOrFail: vi.fn(async () => ({ name: 'Green Valley' })) };
  const svc = new SubdomainService(
    sites as never,
    schools as never,
    config as never,
    cache as never,
  );
  return { svc, sites, cache, state, freed };
}

describe('SubdomainService', () => {
  it('check answers the same shape for malformed, reserved and taken', async () => {
    const free = setup();
    expect(await free.svc.check('t1', 'my-school')).toEqual({ available: true });
    expect(await free.svc.check('t1', 'www')).toEqual({ available: false });
    expect(await free.svc.check('t1', 'A!')).toEqual({ available: false });
    expect(await free.svc.check('t1', undefined)).toEqual({ available: false });
    const taken = setup({ taken: true });
    expect(await taken.svc.check('t1', 'my-school')).toEqual({ available: false });
  });

  it('rename keeps the old name for 30 days and drops the cache', async () => {
    const { svc, state, cache } = setup();
    const now = new Date('2030-01-01T00:00:00Z');
    await svc.rename('t1', 'new-name', now);
    expect(state.update).toEqual({
      subdomain: 'new-name',
      previous_subdomain: 'old-name',
      previous_until: new Date('2030-01-31T00:00:00Z'),
    });
    expect(cache.invalidate).toHaveBeenCalledWith('t1');
  });

  it('rename refuses reserved, malformed and taken with one sentence', async () => {
    const messages: string[] = [];
    for (const [value, taken] of [
      ['api', false],
      ['x', false],
      ['good-name', true],
    ] as const) {
      const { svc, sites } = setup({ taken });
      const err = await svc.rename('t1', value).catch((e) => e);
      messages.push(err.message);
      expect(sites.update).not.toHaveBeenCalled();
    }
    expect(new Set(messages)).toEqual(new Set(['site.subdomain_unavailable']));
  });

  it('rename frees an expired redirect of another school on the name being left', async () => {
    // School X left `foo` long ago, Y took it, and now Y renames: X's stale row is cleared first.
    const { svc, freed, state } = setup({ current: 'foo' });
    await svc.rename('t1', 'bar');
    expect(freed).toEqual([{ previous_subdomain: null, previous_until: null }]);
    expect((state.update as { subdomain: string }).subdomain).toBe('bar');
  });

  it('rename to the current name changes nothing', async () => {
    const { svc, sites } = setup({ current: 'same-name' });
    await svc.rename('t1', 'same-name');
    expect(sites.update).not.toHaveBeenCalled();
  });

  it('a lost unique-index race answers the same sentence', async () => {
    const { svc, sites } = setup();
    sites.update.mockRejectedValueOnce({ driverError: { code: '23505' } });
    const err = await svc.rename('t1', 'new-name').catch((e) => e);
    expect(err.message).toBe('site.subdomain_unavailable');
  });
});

describe('PreviewTokenService', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
  const svc = new PreviewTokenService();
  const now = 1_900_000_000_000;

  it('opens only its own tenant, before expiry', () => {
    const t = svc.sign('tenant-a', now);
    expect(svc.verify(t, 'tenant-a', now + 1000)).toBe(true);
    // Tenant B's host must not accept tenant A's token.
    expect(svc.verify(t, 'tenant-b', now + 1000)).toBe(false);
    expect(svc.verify(t, 'tenant-a', now + PREVIEW_TTL_MS + 1)).toBe(false);
  });

  it('refuses tampering and junk without throwing', () => {
    const t = svc.sign('tenant-a', now);
    const [tid, exp, sig] = t.split('.');
    expect(svc.verify(`${tid}.${Number(exp) + 99999999}.${sig}`, 'tenant-a', now)).toBe(false);
    expect(svc.verify(`${tid}.${exp}.${sig.slice(0, -2)}AA`, 'tenant-a', now)).toBe(false);
    for (const junk of [undefined, '', 'a.b', 'a.b.c.d', 'x'.repeat(500), 5]) {
      expect(svc.verify(junk, 'tenant-a', now)).toBe(false);
    }
  });
});
