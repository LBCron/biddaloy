import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { SiteTheme } from '@biddaloy/shared';
import { defaultConfigFor } from '@biddaloy/site-themes';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { SchoolSite } from '../../../website/entities/school-site.entity';
import { SitePost } from '../../../website/entities/site-post.entity';
import { SiteEnquiry } from '../../../website/entities/site-enquiry.entity';
import { StaffWebProfile } from '../../../website/entities/staff-web-profile.entity';
import { toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, TabSpec } from '../../codec/tab-spec';
import { schoolSiteTab } from './school-site.tab';
import { sitePostsTab } from './site-post.tab';
import { siteEnquiriesTab } from './site-enquiry.tab';
import { staffWebProfilesTab } from './staff-web-profile.tab';

/**
 * [40.1.08] Export -> import round trip of the four website tabs, from school A into a fresh
 * school B, against a real database. Each tab's `toRow` is turned into text cells the way the
 * workbook writes them, then read back with `fromRow` and written with `upsert`.
 */
describe('website workbook tabs (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  const A = randomUUID();
  const B = randomUUID();
  const tag = randomUUID().slice(0, 8);
  let userId: string;

  // Staff cards point at a user. Both schools share the one user: the ref is a plain lookup here.
  const exportCtx: ExportContext = { keyOf: (_tab, id) => `user:${id}` };
  const importCtx: ImportContext = {
    tenantId: B,
    ref: (_tab, key) => key.replace('user:', ''),
    warn: () => undefined,
  };

  const cellsOf = (tab: TabSpec<any, any>, entity: unknown) => {
    const row = tab.toRow(entity, exportCtx);
    return Object.fromEntries(
      tab.columns.map((c) => [c.key, String(toCell(c.type, row[c.key]) ?? '')]),
    );
  };

  /** Whole round trip of every row of `tab` from A into B; returns what B holds afterwards. */
  async function roundTrip(tab: TabSpec<any, any>) {
    const rows = await tab.load(A, ds.manager);
    for (const [i, entity] of rows.entries()) {
      const parsed = tab.fromRow(cellsOf(tab, entity), i + 2, importCtx);
      if ('errors' in parsed) throw new Error(JSON.stringify(parsed.errors));
      await tab.upsert(parsed.row, null, B, ds.manager);
    }
    return tab.load(B, ds.manager);
  }

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  });
  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    for (const t of [A, B]) {
      await ds.query(`DELETE FROM staff_web_profiles WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_posts WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM site_enquiries WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM school_sites WHERE tenant_id = $1`, [t]);
      await ds.query(`DELETE FROM schools WHERE id = $1`, [t]);
    }
    await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`web-${tag}%@example.test`]);
    for (const [id, name] of [
      [A, `Site A ${tag}`],
      [B, `Site B ${tag}`],
    ])
      await ds.getRepository(School).insert({ id, name, slug: `web-${tag}-${id.slice(0, 4)}` });
    const user = await ds
      .getRepository(User)
      .save({ email: `web-${tag}@example.test`, password_hash: 'x', full_name: 'Web Teacher' });
    userId = user.id;
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')`,
      [userId, A],
    );
    // The destination already has the user (the users tab is restored before this one).
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'TEACHER')`,
      [userId, B],
    );
    // A teacher who left: still has a card, but no membership, so they are not in the users tab.
    const leaver = await ds.getRepository(User).save({
      email: `web-${tag}-left@example.test`,
      password_hash: 'x',
      full_name: 'Left Teacher',
    });

    const draft = defaultConfigFor(SiteTheme.BASIC);
    draft.palette = 'green';
    await ds.getRepository(SchoolSite).insert({
      tenant_id: A,
      subdomain: `a-${tag}`,
      theme: 'basic',
      palette: 'green',
      enabled: true,
      noindex: true,
      draft: draft as never,
      published: draft as never,
      published_at: new Date('2026-01-02T03:04:05.000Z'),
      version: 4,
      draft_revision: 7,
    });
    await ds.getRepository(SitePost).insert({
      tenant_id: A,
      kind: 'POST',
      slug: 'hello',
      title: { bn: 'স্বাগতম', en: 'Welcome' },
      body: [{ type: 'p', children: [{ text: 'Hi' }] }],
      published_at: new Date('2026-02-03T04:05:06.000Z'),
    });
    await ds.getRepository(SiteEnquiry).insert({
      tenant_id: A,
      name: 'Parent',
      phone: '01700-000001',
      message: 'When does admission open?',
    });
    await ds.getRepository(StaffWebProfile).insert({
      tenant_id: A,
      user_id: userId,
      show_on_website: true,
      featured: true,
      sort_order: 2,
      subjects: ['Math'],
      bio: { bn: 'বিবরণ', en: 'Bio' },
      credentials: null,
    });
    await ds
      .getRepository(StaffWebProfile)
      .insert({ tenant_id: A, user_id: leaver.id, subjects: [] });
  });

  it('school_site: B gets the same theme, palette, switches and configs, with its own address and counters', async () => {
    const [b] = (await roundTrip(schoolSiteTab)) as SchoolSite[];
    const [a] = await schoolSiteTab.load(A, ds.manager);
    expect(b).toMatchObject({
      theme: a.theme,
      palette: a.palette,
      enabled: a.enabled,
      noindex: a.noindex,
      draft: a.draft,
      published: a.published,
    });
    expect(b.subdomain).not.toBe(a.subdomain); // the address is the destination's own
    expect(b.version).toBe(1); // moved forward from zero, never copied
    expect(b.draft_revision).toBe(1);
  });

  it('school_site: a restore into a school that has a site changes content and moves the counters forward', async () => {
    await roundTrip(schoolSiteTab);
    const [row] = await schoolSiteTab.load(A, ds.manager);
    const cells = cellsOf(schoolSiteTab, row);
    cells.noindex = 'FALSE';
    const parsed = schoolSiteTab.fromRow(cells, 2, importCtx);
    if ('errors' in parsed) throw new Error('unexpected');
    const [existing] = await schoolSiteTab.load(B, ds.manager);
    expect(schoolSiteTab.diffFields(parsed.row, existing)).toEqual(['noindex']);
    const saved = await schoolSiteTab.upsert(parsed.row, existing, B, ds.manager);
    expect(saved.noindex).toBe(false);
    expect(saved.draft_revision).toBe(2);
    expect(saved.version).toBe(1); // the published copy did not change
    // Tenant isolation: A was not touched.
    expect((await schoolSiteTab.load(A, ds.manager))[0]).toMatchObject({
      noindex: true,
      version: 4,
    });
  });

  it('school_site: refuses a hand-edited config with a bad link, and a switched-on site with nothing published', async () => {
    const [row] = await schoolSiteTab.load(A, ds.manager);
    const cells = cellsOf(schoolSiteTab, row);
    const config = JSON.parse(cells.draft);
    config.announcements.items = [
      { id: 'x', text: { bn: 'a', en: 'a' }, href: 'javascript:alert(1)', enabled: true },
    ];
    const badLink = schoolSiteTab.fromRow(
      { ...cells, draft: JSON.stringify(config) },
      2,
      importCtx,
    );
    expect('errors' in badLink && badLink.errors[0].column).toBe('draft');
    const noPublished = schoolSiteTab.fromRow({ ...cells, published: '' }, 2, importCtx);
    expect('errors' in noPublished && noPublished.errors[0].column).toBe('enabled');
  });

  it('site_posts: round-trips kind, slug, title, body and publish time', async () => {
    const [b] = (await roundTrip(sitePostsTab)) as SitePost[];
    expect(b).toMatchObject({
      kind: 'POST',
      slug: 'hello',
      title: { bn: 'স্বাগতম', en: 'Welcome' },
      body: [{ type: 'p', children: [{ text: 'Hi' }] }],
    });
    expect(b.published_at?.toISOString()).toBe('2026-02-03T04:05:06.000Z');
    expect(b.tenant_id).toBe(B);
  });

  it('site_enquiries: round-trips a message and the tab never deletes by absence', async () => {
    const [b] = (await roundTrip(siteEnquiriesTab)) as SiteEnquiry[];
    expect(b).toMatchObject({
      name: 'Parent',
      phone: '01700-000001',
      message: 'When does admission open?',
    });
    expect(siteEnquiriesTab.deleteByAbsence).toBe(false);
  });

  it('staff_web_profiles: round-trips the card, and a card of a user outside the users tab is left out of the export', async () => {
    const [b] = (await roundTrip(staffWebProfilesTab)) as StaffWebProfile[];
    expect(b).toMatchObject({
      user_id: userId,
      show_on_website: true,
      featured: true,
      sort_order: 2,
      subjects: ['Math'],
      bio: { bn: 'বিবরণ', en: 'Bio' },
      credentials: null,
    });
    // The teacher who left has a card too, but is not in the users tab: left out, not an export failure.
    expect(await staffWebProfilesTab.load(A, ds.manager)).toHaveLength(1);
  });
});
