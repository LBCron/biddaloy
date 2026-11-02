import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEFAULT_CONDUCT_ITEMS } from '@biddaloy/shared';
import { TenantSettingsDto, TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import { DEFAULT_EXAMS_SETTINGS, DEFAULT_TENANT_SETTINGS } from './tenant-settings-defaults';
import { mergeTenantSettings, toPlainSettingsPatch } from './tenant-settings-merge.util';
import { resolveTenantSettings } from './tenant-settings-resolver';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

const OPTS = { whitelist: true, forbidNonWhitelisted: true } as const;
const item = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  name_bn: 'নাম',
  name_en: 'Name',
  ...extra,
});
const dtoFor = (conductItems: unknown) =>
  plainToInstance(TenantSettingsDto, {
    version: TENANT_SETTINGS_SCHEMA_VERSION,
    exams: { conductItems },
  });
const messages = async (conductItems: unknown) => {
  const errors = await validate(dtoFor(conductItems), OPTS);
  const out: string[] = [];
  const walk = (e: (typeof errors)[number]) => {
    out.push(...Object.values(e.constraints ?? {}));
    e.children?.forEach(walk);
  };
  errors.forEach(walk);
  return out;
};

describe('exams.conductItems (70.2.01)', () => {
  it('defaults: a fresh tenant carries the four D30 items', () => {
    expect(DEFAULT_TENANT_SETTINGS.exams).toBe(DEFAULT_EXAMS_SETTINGS);
    expect(resolveTenantSettings(null).exams?.conductItems).toEqual(DEFAULT_CONDUCT_ITEMS);
    expect(resolveTenantSettings(null).exams?.conductItems.map((i) => i.key)).toEqual([
      'discipline',
      'neatness',
      'punctuality',
      'sports',
    ]);
  });

  it('accepts a valid list and trims names', async () => {
    const dto = dtoFor([item('honesty', { name_en: '  Honesty  ' })]);
    expect(await validate(dto, OPTS)).toEqual([]);
    expect(dto.exams?.conductItems[0].name_en).toBe('Honesty');
  });

  it('duplicate key -> fixed sentence that does not echo the key', async () => {
    const msgs = await messages([item('zz_dup'), item('zz_dup')]);
    expect(msgs).toEqual(['conductItems keys must be unique']);
  });

  it('13 items -> 400, 12 is fine', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => item(`item_${i}`));
    expect(await messages(mk(12))).toEqual([]);
    expect(await messages(mk(13))).toEqual(['conductItems can have at most 12 items']);
  });

  it.each([
    ['bad key', item('Bad-Key'), 'key must be'],
    ['key too short', item('a'), 'key must be'],
    ['blank bn name', item('ok_key', { name_bn: '   ' }), 'name_bn is required'],
    ['html-only en name', item('ok_key', { name_en: '<b> </b>' }), 'name_en is required'],
    ['61-char name', item('ok_key', { name_en: 'x'.repeat(61) }), 'name_en must be at most'],
    ['missing en name', { key: 'ok_key', name_bn: 'নাম' }, 'name_en'],
  ])('%s -> 400 without echoing input', async (_n, bad, expected) => {
    const msgs = await messages([bad]);
    expect(msgs.some((m) => m.includes(expected))).toBe(true);
    for (const m of msgs) expect(m).not.toContain('Bad-Key');
  });

  it('rejects non-list and unknown item keys', async () => {
    expect((await messages('nope')).length).toBeGreaterThan(0);
    expect((await messages([item('ok_key', { extra: 1 })])).length).toBeGreaterThan(0);
  });

  it('PATCH replaces the array and keeps every other stored section', () => {
    const existing = {
      version: 1,
      fees: { marker: 'other' },
      exams: { conductItems: [item('old_a'), item('old_b')] },
    };
    const patch = toPlainSettingsPatch(dtoFor([item('only_one')]));
    const merged = mergeTenantSettings(existing, patch);
    expect((merged.exams as { conductItems: unknown[] }).conductItems).toEqual([item('only_one')]);
    expect(merged.fees).toEqual({ marker: 'other' });
    expect(mergeTenantSettings(existing, { version: 1 }).exams).toEqual(existing.exams);
  });

  it('read guard: malformed stored list falls back to defaults, good one passes', () => {
    const read = (conductItems: unknown) =>
      resolveTenantSettings({ exams: { conductItems } }).exams?.conductItems;
    expect(read([item('a_b'), item('a_b')])).toEqual(DEFAULT_CONDUCT_ITEMS);
    expect(read('x')).toEqual(DEFAULT_CONDUCT_ITEMS);
    expect(read([item('a_b', { name_en: '' })])).toEqual(DEFAULT_CONDUCT_ITEMS);
    expect(read([item('a_b', { junk: 1 })])).toEqual([item('a_b')]);
  });
});
