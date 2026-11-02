import { describe, expect, it, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import { assertDemoTarget, assertEmptyDatabase, parseArgs, runSlices } from './index';
import { academicYears, schoolDays, todayAt } from './dates';
import { createContext, demoPassword, type DemoSeedContext, type DemoSlice } from './context';
import { SLICES } from './slices';

const demoUrl = (db: string, host = 'localhost') => `postgres://u:s@${host}:5432/${db}`;

describe('guards', () => {
  it('refuses production without DEMO_MODE=true', () => {
    expect(() =>
      assertDemoTarget({ NODE_ENV: 'production', DATABASE_URL: demoUrl('biddaloy_demo_next') }),
    ).toThrow(/DEMO_MODE/);
  });

  it('allows production when DEMO_MODE=true', () => {
    expect(() =>
      assertDemoTarget({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        DEMO_PASSWORD: 'pw',
        DATABASE_URL: demoUrl('biddaloy_demo_next', 'db'),
      }),
    ).not.toThrow();
  });

  it('production needs DEMO_PASSWORD: unset refuses, set passes', () => {
    const base = {
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      DATABASE_URL: demoUrl('biddaloy_demo_x'),
    };
    expect(() => assertDemoTarget(base)).toThrow(/DEMO_PASSWORD/);
    expect(() => assertDemoTarget({ ...base, DEMO_PASSWORD: 'pw' })).not.toThrow();
  });

  it('DEMO_MODE=true needs DEMO_PASSWORD outside production too (the cards show it)', () => {
    const base = { DEMO_MODE: 'true', DATABASE_URL: demoUrl('biddaloy_demo_next') };
    expect(() => assertDemoTarget(base)).toThrow(/DEMO_PASSWORD/);
    expect(() => assertDemoTarget({ ...base, DEMO_PASSWORD: 'pw' })).not.toThrow();
  });

  it('dev with DEMO_PASSWORD unset falls back to the local default', () => {
    expect(demoPassword({ NODE_ENV: 'development' })).toBe('Demo@12345');
    expect(demoPassword({ DEMO_PASSWORD: 'pw' })).toBe('pw');
  });

  it('refuses the real database name', () => {
    expect(() => assertDemoTarget({ DATABASE_URL: demoUrl('biddaloy') })).toThrow(/biddaloy_demo/);
  });

  it('refuses a missing DATABASE_URL', () => {
    expect(() => assertDemoTarget({})).toThrow(/biddaloy_demo/);
  });

  it('passes biddaloy_demo_next; a non-localhost host alone is not a refusal', () => {
    expect(() =>
      assertDemoTarget({ DATABASE_URL: demoUrl('biddaloy_demo_next', 'db.internal') }),
    ).not.toThrow();
  });

  it('refuses a database that already has a school, without writing', async () => {
    const query = vi.fn().mockResolvedValue([{ n: 1 }]);
    await expect(assertEmptyDatabase({ query })).rejects.toThrow(/empty, migrated database/);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
  });

  it('accepts a database holding only the platform row', async () => {
    const query = vi.fn().mockResolvedValue([{ n: 0 }]);
    await expect(assertEmptyDatabase({ query })).resolves.toBeUndefined();
  });
});

describe('parseArgs', () => {
  it('uses defaults and today as anchor', () => {
    expect(parseArgs([], () => '2026-10-10')).toEqual({
      scale: 1,
      years: 10,
      anchor: '2026-10-10',
    });
  });

  it('reads flags', () => {
    expect(parseArgs(['--scale', '0.5', '--anchor', '2026-02-28', '--years', '3'])).toEqual({
      scale: 0.5,
      years: 3,
      anchor: '2026-02-28',
    });
  });

  it.each([
    [['--scale', '0']],
    [['--scale', 'abc']],
    [['--years', '0']],
    [['--years', '2.5']],
    [['--anchor', '2026-13-01']],
    [['--anchor', '2026-02-30']],
    [['--anchor', 'yesterday']],
    [['--anchor']],
    [['--scale']],
    [['--years', '--anchor', '2026-10-10']],
  ])('rejects %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it('rejects an anchor in a later month than the real clock (fees use the real clock)', () => {
    expect(() => parseArgs(['--anchor', '2026-11-01'], undefined, () => '2026-10')).toThrow(
      /later month than the real clock/,
    );
    expect(parseArgs(['--anchor', '2026-10-31'], undefined, () => '2026-10').anchor).toBe(
      '2026-10-31',
    );
  });
});

describe('dates', () => {
  it('Primary/High: ten Jan-Dec years ending in the anchor year', () => {
    const ys = academicYears('HIGH', 10, '2026-10-10');
    expect(ys).toHaveLength(10);
    expect(ys[0]).toEqual({ name: '2017', start: '2017-01-01', end: '2017-12-31' });
    expect(ys[9]).toEqual({ name: '2026', start: '2026-01-01', end: '2026-12-31' });
  });

  it('College: ten Jul-Jun years; before July the current year started last July', () => {
    const autumn = academicYears('COLLEGE', 10, '2026-10-10');
    expect(autumn[9]).toEqual({ name: '2026-2027', start: '2026-07-01', end: '2027-06-30' });
    expect(autumn[0].start).toBe('2017-07-01');
    const spring = academicYears('COLLEGE', 10, '2026-03-01');
    expect(spring[9].start).toBe('2025-07-01');
  });

  it('schoolDays skips Fridays and holidays', () => {
    // 2026-10-09 is a Friday; 2026-10-11 is a Sunday.
    const days = schoolDays('2026-10-08', '2026-10-12', [5], ['2026-10-11']);
    expect(days).toEqual(['2026-10-08', '2026-10-10', '2026-10-12']);
  });

  it('todayAt is Dhaka wall-clock', () => {
    expect(todayAt('2026-10-10', 9, 30).toISOString()).toBe('2026-10-10T03:30:00.000Z');
  });
});

describe('context', () => {
  const make = (anchor: string) =>
    createContext({
      ds: {} as never,
      app: {} as never,
      scale: 2,
      years: 10,
      anchor,
      password: 'x',
    });

  it('same anchor gives the same faker output; scale multiplies counts', async () => {
    const a = await make('2026-10-10');
    const first = [a.rng.person.fullName(), a.rng.number.int(1000)];
    const b = await make('2026-10-10');
    expect([b.rng.person.fullName(), b.rng.number.int(1000)]).toEqual(first);
    expect(b.count(5)).toBe(10);
    expect(b.rng).toBe(faker);
  });

  it('hashes the demo password once into a bcrypt cost-12 hash', async () => {
    const ctx = await make('2026-10-10');
    expect(ctx.demoPasswordHash).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe('runSlices', () => {
  const stub = (name: string, run: DemoSlice['run']): DemoSlice => ({ name, covers: [], run });
  const ctx = () => ({ timings: [] }) as unknown as DemoSeedContext;

  it('runs slices in order and records timings', async () => {
    const order: string[] = [];
    const c = ctx();
    await runSlices(c, [
      stub('a', async () => {
        order.push('a');
        return 3;
      }),
      stub('b', async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['a', 'b']);
    expect(c.timings.map((t) => [t.slice, t.rows])).toEqual([
      ['a', 3],
      ['b', 0],
    ]);
  });

  it('a throwing slice stops the run and is named', async () => {
    const after = vi.fn();
    await expect(
      runSlices(ctx(), [
        stub('a', async () => {
          throw new Error('boom');
        }),
        stub('b', after),
      ]),
    ).rejects.toThrow(/slice "a" failed: boom/);
    expect(after).not.toHaveBeenCalled();
  });
});

describe('SLICES', () => {
  it('lists the 15 slices in order, attention last; an owed stub names its ticket', () => {
    expect(SLICES.map((s) => s.name)).toEqual([
      'org',
      'staff',
      'students',
      'student-extras',
      'routine',
      'attendance',
      'fees',
      'exams',
      'learning',
      'people-ops',
      'comms-print',
      'applications',
      'billing',
      'reports',
      'attention',
    ]);
    expect(SLICES.every((s) => s.covers.length > 0)).toBe(true);
    // Each slice ticket deletes its own owedBy line; an owed stub names its ticket.
    for (const s of SLICES) if (s.owedBy) expect(s.owedBy).toMatch(/^(58\.\d\.\d{2}|#\d+)$/);
  });
});
