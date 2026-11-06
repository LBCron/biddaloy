import { describe, it, expect, vi } from 'vitest';
import { SiteTheme } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { THEMES, defaultConfigFor } from '@biddaloy/site-themes';
import { SiteConfigService, changeTheme, slugFor } from './site-config.service';
import { SITE_SUBDOMAIN_RE } from '@biddaloy/shared';

const bnTexts = (c: SiteConfig) =>
  c.pages.flatMap((p) =>
    p.sections.flatMap((s) =>
      Object.values(s.data).filter(
        (v): v is { bn: string; en: string } => typeof v === 'object' && v !== null && 'bn' in v,
      ),
    ),
  );

describe('slugFor', () => {
  it('makes a valid subdomain with 4 hex', () => {
    const s = slugFor('Green Valley School', () => 'ab12');
    expect(s).toBe('green-valley-school-ab12');
    expect(SITE_SUBDOMAIN_RE.test(s)).toBe(true);
  });

  it('falls back to "school" for a Bangla-only name or a reserved word', () => {
    expect(slugFor('গ্রিন ভ্যালি', () => 'ab12')).toBe('school-ab12');
    expect(slugFor('Admin', () => 'ab12')).toBe('school-ab12');
  });
});

describe('changeTheme', () => {
  it('keeps edited texts and refills empty ones from the new defaults', () => {
    const current = defaultConfigFor(SiteTheme.BASIC);
    const hero = current.pages[0].sections[0];
    const [firstField] = Object.keys(hero.data);
    const [secondField] = Object.keys(hero.data).slice(1);
    hero.data[firstField] = { bn: 'আমার', en: 'Mine' };
    if (secondField) hero.data[secondField] = { bn: '', en: '' };

    const next = changeTheme(current, SiteTheme.BASIC);
    const nextHero = next.pages[0].sections[0];
    expect(nextHero.data[firstField]).toEqual({ bn: 'আমার', en: 'Mine' });
    if (secondField) {
      expect((nextHero.data[secondField] as { bn: string }).bn).not.toBe('');
    }
  });

  it('keeps the palette only if the new theme has it', () => {
    const current = defaultConfigFor(SiteTheme.BASIC);
    current.palette = THEMES[SiteTheme.BASIC].palettes[1].id;
    expect(changeTheme(current, SiteTheme.BASIC).palette).toBe(current.palette);
    current.palette = 'no-such-palette';
    expect(changeTheme(current, SiteTheme.BASIC).palette).toBe(
      THEMES[SiteTheme.BASIC].palettes[0].id,
    );
  });

  it('returns plain defaults for garbage input', () => {
    expect(changeTheme('nope', SiteTheme.BASIC)).toEqual(defaultConfigFor(SiteTheme.BASIC));
  });
});

/** A one-row in-memory stand-in for the two repositories the service reads. */
function setup(row: Record<string, unknown> | null) {
  const state = { row };
  const insert = {
    insert: () => insert,
    into: () => insert,
    values: (v: Record<string, unknown>) => {
      insert.v = v;
      return insert;
    },
    orIgnore: () => insert,
    execute: async () => {
      state.row = { ...insert.v, version: 0, enabled: false, published: null, published_at: null };
    },
    v: {} as Record<string, unknown>,
  };
  const sites = {
    findOne: vi.fn(async () => state.row),
    createQueryBuilder: () => insert,
    update: vi.fn(async (_w: unknown, set: Record<string, unknown>) => {
      Object.assign(state.row ?? {}, set);
      return { affected: state.row ? 1 : 0 };
    }),
  };
  const schools = { findOneOrFail: vi.fn(async () => ({ name: 'Test School' })) };
  const cache = { invalidate: vi.fn(async () => undefined) };
  const svc = new SiteConfigService(sites as never, schools as never, cache as never);
  return { svc, sites, cache, state };
}

describe('SiteConfigService', () => {
  it('first get seeds Basic defaults with non-empty bn text', async () => {
    const { svc } = setup(null);
    const dto = await svc.get('t1');
    expect(dto.theme).toBe('basic');
    expect(dto.enabled).toBe(false);
    expect(dto.has_published).toBe(false);
    expect(dto.subdomain).toMatch(SITE_SUBDOMAIN_RE);
    const texts = bnTexts(dto.draft as unknown as SiteConfig);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t.bn.length > 0)).toBe(true);
  });

  it('saveDraft rejects an invalid palette with a code that does not echo it', async () => {
    const { svc } = setup(null);
    const dto = await svc.get('t1');
    const config = { ...dto.draft, palette: 'leaky-value' };
    const err = await svc.saveDraft('t1', { config, version: 0 }).catch((e) => e);
    expect(err.getResponse()).toEqual({
      message: 'site.invalid',
      details: { errors: ['palette.unknown'] },
    });
    expect(JSON.stringify(err.getResponse())).not.toContain('leaky-value');
  });

  it('saveDraft with a stale version is 409 site.stale', async () => {
    const { svc, sites } = setup(null);
    const dto = await svc.get('t1');
    sites.update.mockResolvedValueOnce({ affected: 0 });
    await expect(svc.saveDraft('t1', { config: dto.draft, version: 9 })).rejects.toThrow(
      'site.stale',
    );
  });

  it('setEnabled(true) needs a published version', async () => {
    const { svc, cache } = setup(null);
    await expect(svc.setEnabled('t1', true)).rejects.toThrow('site.not_published');
    await expect(svc.setEnabled('t1', false)).resolves.toBeDefined();
    expect(cache.invalidate).toHaveBeenCalledWith('t1');
  });
});
