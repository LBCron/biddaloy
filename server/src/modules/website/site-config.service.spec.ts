import { describe, it, expect, vi } from 'vitest';
import { SiteTheme } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { THEMES, defaultConfigFor } from '@biddaloy/site-themes';
import { SiteConfigService, changeTheme, createSiteRow, slugFor } from './site-config.service';
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

describe('createSiteRow', () => {
  // [#3621 gate] The workbook restore uses this too: a taken subdomain (insert ignored, no row)
  // must retry with a new slug, not fail the whole restore.
  it('retries with a new slug while the insert is ignored, then returns the row', async () => {
    const slugs: string[] = [];
    let inserts = 0;
    const qb = {
      insert: () => qb,
      into: () => qb,
      values: (v: { subdomain: string }) => (slugs.push(v.subdomain), qb),
      orIgnore: () => qb,
      execute: async () => ({ affected: ++inserts < 3 ? 0 : 1 }),
    };
    const m = {
      createQueryBuilder: () => qb,
      findOne: async () => (inserts < 3 ? null : { id: 'row' }),
    };
    const draft = defaultConfigFor(SiteTheme.BASIC);
    const row = await createSiteRow(m as never, 't1', 'Green Valley', {
      theme: SiteTheme.BASIC,
      palette: draft.palette,
      draft,
    });
    expect(row).toEqual({ id: 'row' });
    expect(slugs).toHaveLength(3);
    expect(new Set(slugs).size).toBe(3);
  });

  it('gives up with 409 site.unavailable after 5 ignored inserts', async () => {
    const qb = {
      insert: () => qb,
      into: () => qb,
      values: () => qb,
      orIgnore: () => qb,
      execute: async () => ({ affected: 0 }),
    };
    const m = { createQueryBuilder: () => qb, findOne: async () => null };
    const draft = defaultConfigFor(SiteTheme.BASIC);
    await expect(
      createSiteRow(m as never, 't1', 'Green Valley', {
        theme: SiteTheme.BASIC,
        palette: draft.palette,
        draft,
      }),
    ).rejects.toThrow('site.unavailable');
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

/**
 * A one-row in-memory stand-in for the two repositories the service reads. `update` and the
 * publish query builder honour their WHERE (version / draft_revision) and `() => 'col + 1'`
 * values, so stale-token behaviour is real, not mocked.
 */
function setup(row: Record<string, unknown> | null) {
  const state: { row: Record<string, unknown> | null } = { row };
  const matches = (where: Record<string, unknown>) =>
    !!state.row && Object.entries(where).every(([k, v]) => state.row?.[k] === v);
  const apply = (set: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(set)) {
      if (typeof v !== 'function') state.row![k] = v;
      else if (v() === `${k} + 1`) state.row![k] = (state.row![k] as number) + 1;
      else if (v() === 'draft') state.row![k] = structuredClone(state.row!.draft);
      else state.row![k] = new Date();
    }
  };
  const qb = {
    insert: () => qb,
    into: () => qb,
    values: (v: Record<string, unknown>) => {
      qb.v = v;
      return qb;
    },
    orIgnore: () => qb,
    update: () => qb,
    set: (set: Record<string, unknown>) => {
      qb.s = set;
      return qb;
    },
    where: (_sql: string, p: Record<string, unknown>) => {
      qb.w = { tenant_id: p.tenantId, version: p.version, draft_revision: p.draftRevision };
      return qb;
    },
    execute: async () => {
      if (qb.s) {
        const hit = matches(qb.w);
        if (hit) apply(qb.s);
        qb.s = null;
        return { affected: hit ? 1 : 0 };
      }
      state.row = {
        ...qb.v,
        version: 0,
        draft_revision: 0,
        enabled: false,
        published: null,
        published_at: null,
      };
      return { affected: 1 };
    },
    v: {} as Record<string, unknown>,
    s: null as Record<string, unknown> | null,
    w: {} as Record<string, unknown>,
  };
  const sites = {
    findOne: vi.fn(async () => state.row),
    createQueryBuilder: () => qb,
    update: vi.fn(async (where: Record<string, unknown>, set: Record<string, unknown>) => {
      const hit = matches(where);
      if (hit) apply(set);
      return { affected: hit ? 1 : 0 };
    }),
  };
  // `createSiteRow` (the first-read insert) goes through the repository's manager.
  const manager = { createQueryBuilder: () => qb, findOne: async () => state.row };
  Object.assign(sites, { manager });
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
    const err = await svc.saveDraft('t1', { config, draft_revision: 0 }).catch((e) => e);
    expect(err.getResponse()).toEqual({
      message: 'site.invalid',
      details: { errors: ['palette.unknown'] },
    });
    expect(JSON.stringify(err.getResponse())).not.toContain('leaky-value');
  });

  it('saveDraft bumps draft_revision; a save from an older revision is 409 site.stale', async () => {
    const { svc } = setup(null);
    const dto = await svc.get('t1');
    expect(dto.draft_revision).toBe(0);
    const saved = await svc.saveDraft('t1', { config: dto.draft, draft_revision: 0 });
    expect(saved.draft_revision).toBe(1);
    // A second editor still holding revision 0 must not overwrite the first one's save.
    await expect(svc.saveDraft('t1', { config: dto.draft, draft_revision: 0 })).rejects.toThrow(
      'site.stale',
    );
  });

  it('publish copies the draft, bumps version and clears the feeds', async () => {
    const { svc, state, cache } = setup(null);
    const dto = await svc.get('t1');
    const config = structuredClone(dto.draft) as Record<string, unknown>;
    config.palette = THEMES[SiteTheme.BASIC].palettes[1].id;
    await svc.saveDraft('t1', { config, draft_revision: 0 });

    const published = await svc.publish('t1', 0, 1);
    expect(published.version).toBe(1);
    expect(published.has_published).toBe(true);
    expect((state.row?.published as SiteConfig).palette).toBe(config.palette);
    expect(cache.invalidate).toHaveBeenCalledWith('t1');
  });

  // The lost update the draft token closes: publish(N) must not ship a draft its author never saw.
  it('publish is 409 site.stale when the draft changed since the publisher read it', async () => {
    const { svc } = setup(null);
    const dto = await svc.get('t1');
    await svc.saveDraft('t1', { config: dto.draft, draft_revision: 0 }); // someone else saves
    await expect(svc.publish('t1', 0, 0)).rejects.toThrow('site.stale');
    await expect(svc.publish('t1', 5, 1)).rejects.toThrow('site.stale');
    await expect(svc.publish('t1', 0, 1)).resolves.toMatchObject({ version: 1 });
  });

  it('setEnabled(true) needs a published version', async () => {
    const { svc, cache } = setup(null);
    await expect(svc.setEnabled('t1', true)).rejects.toThrow('site.not_published');
    await expect(svc.setEnabled('t1', false)).resolves.toBeDefined();
    expect(cache.invalidate).toHaveBeenCalledWith('t1');
  });
});
