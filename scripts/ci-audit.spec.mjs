// Pure-function tests: evaluate() takes injected advisories/allowlist/today,
// so nothing here spawns `yarn audit` or reads the clock.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { evaluate, ALLOWLIST } = createRequire(import.meta.url)('./ci-audit.js');

const adv = (id, severity) => ({ id, severity, module_name: 'm', title: 't' });
const entry = (recheckBy) => ({ module: 'm', reason: 'r', recheckBy });
const run = (o) =>
  evaluate({ today: '2026-10-12', minSeverity: 'high', allowlist: {}, advisories: [], ...o });

describe('evaluate', () => {
  it('flags a non-allowlisted high advisory', () => {
    expect(run({ advisories: [adv(1, 'high')] }).unallowed.map((a) => a.id)).toEqual([1]);
  });
  it('fails closed on an unknown severity string', () => {
    expect(run({ advisories: [adv(1, 'weird')] }).unallowed).toHaveLength(1);
  });
  it('ignores moderate in default (high) mode', () => {
    expect(run({ advisories: [adv(1, 'moderate')] }).unallowed).toEqual([]);
  });
  it('flags moderate when minSeverity is moderate', () => {
    expect(
      run({ minSeverity: 'moderate', advisories: [adv(1, 'moderate')] }).unallowed,
    ).toHaveLength(1);
  });
  it('lets an allowlisted high advisory through', () => {
    const r = run({ advisories: [adv(1, 'high')], allowlist: { 1: entry('2027-01-24') } });
    expect(r.unallowed).toEqual([]);
    expect(r.lines[0]).toContain('[ALLOWLISTED]');
  });
  it('expires yesterday, not today', () => {
    expect(run({ allowlist: { 1: entry('2026-10-11') } }).expired).toEqual(['1']);
    expect(run({ allowlist: { 1: entry('2026-10-12') } }).expired).toEqual([]);
  });
  it('reports an absent allowlist id as stale only', () => {
    const r = run({ advisories: [adv(2, 'low')], allowlist: { 1: entry('2027-01-24') } });
    expect(r.stale).toEqual(['1']);
    expect(r.unallowed).toEqual([]);
    expect(r.expired).toEqual([]);
  });
  it('lists a duplicate advisory id once', () => {
    const r = run({ advisories: [adv(1, 'high'), adv(1, 'high')] });
    expect(r.unallowed).toHaveLength(1);
    expect(r.lines).toHaveLength(1);
  });
});

describe('real ALLOWLIST', () => {
  it('has module, reason and a recheckBy date past 2026-10-24 on every entry', () => {
    for (const e of Object.values(ALLOWLIST)) {
      expect(e.module).toBeTruthy();
      expect(e.reason.length).toBeGreaterThan(0);
      expect(e.recheckBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.recheckBy > '2026-10-24').toBe(true);
    }
  });
  it('no longer carries the tmp advisory', () => {
    expect(ALLOWLIST[1120654]).toBeUndefined();
    expect(Object.keys(ALLOWLIST).sort()).toEqual([
      '1119441',
      '1139346',
      '1193685',
      '1243066',
      '1244012',
      '1244013',
    ]);
  });
});
