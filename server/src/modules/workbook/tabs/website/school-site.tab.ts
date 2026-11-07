import type { EntityManager } from 'typeorm';
import { THEMES, validateSiteConfig } from '@biddaloy/site-themes';
import { SiteTheme } from '@biddaloy/shared';
import { SchoolSite } from '../../../website/entities/school-site.entity';
import { School } from '../../../schools/entities/school.entity';
import { createSiteRow, themeOf } from '../../../website/site-config.service';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * [40.1.08] The `school_site` tab: the school's one website row (theme, palette, on/off, the
 * draft and the published copy of the config).
 *
 * Deliberately NOT restored (the destination keeps its own):
 *  - `subdomain` is exported for a human reading the file and never applied: it is the
 *    destination's address and globally unique. A school with no site row yet gets a fresh one.
 *  - `custom_domain*` and `umami_website_id`: DNS / analytics state of the destination.
 *  - `previous_subdomain`, `previous_until`: the destination's redirect window.
 *  - `media_bytes_used`: derived from picture files, which a workbook does not carry.
 *  - `version`, `draft_revision`: the cache and stale-save counters. A restore moves them
 *    forward (never back to the file's value), so the public cache can never serve an old copy.
 *
 * The draft and published configs are checked against their theme on import, like a draft saved
 * from the admin screen, so a hand-edited file cannot carry a bad link or an unknown field.
 * Pictures inside the config are ids of files that are not in the workbook: after a restore into
 * another school they simply 404 until the school uploads them again.
 */
export interface SchoolSiteRow {
  id: string;
  subdomain: string | null;
  theme: string;
  palette: string;
  enabled: boolean;
  noindex: boolean;
  draft: Record<string, unknown>;
  published: Record<string, unknown> | null;
  published_at: string | null;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  { key: 'subdomain', type: 'string', label: label('Web address', 'ওয়েব ঠিকানা') },
  {
    key: 'theme',
    type: 'enum',
    required: true,
    enumValues: Object.values(SiteTheme),
    label: label('Theme', 'থিম'),
  },
  { key: 'palette', type: 'string', required: true, label: label('Palette', 'রং') },
  { key: 'enabled', type: 'bool', required: true, label: label('Switched on', 'চালু') },
  {
    key: 'noindex',
    type: 'bool',
    required: true,
    label: label('Hidden from search', 'সার্চ থেকে লুকানো'),
  },
  { key: 'draft', type: 'json', required: true, label: label('Draft', 'খসড়া') },
  { key: 'published', type: 'json', label: label('Published', 'প্রকাশিত') },
  { key: 'published_at', type: 'datetime', label: label('Published at', 'প্রকাশের সময়') },
];

const excluded: readonly string[] = [
  'previous_subdomain', // the destination's own redirect window
  'previous_until', // see previous_subdomain
  'custom_domain', // DNS state of the destination
  'custom_domain_status', // see custom_domain
  'custom_domain_external_id', // see custom_domain
  'custom_domain_records', // see custom_domain
  'custom_domain_since', // see custom_domain
  'custom_domain_checked_at', // see custom_domain
  'version', // cache counter: a restore only moves it forward (see upsert)
  'draft_revision', // stale-save counter: a restore only moves it forward
  'umami_website_id', // analytics site of the destination
  'media_bytes_used', // derived from picture files, which a workbook does not carry
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** Key order is ignored: Postgres jsonb stores keys in its own order, so text compare would show false changes. */
const sorted = (_k: string, x: unknown) =>
  isObj(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null, sorted) === JSON.stringify(b ?? null, sorted);

export const schoolSiteTab: TabSpec<SchoolSite, SchoolSiteRow> = {
  name: 'school_site',
  entity: SchoolSite,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['subdomain'],
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<SchoolSite[]> {
    return m.find(SchoolSite, { where: { tenant_id: tenantId } });
  },

  toRow(e: SchoolSite, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: e.id,
      subdomain: e.subdomain,
      theme: e.theme,
      palette: e.palette,
      enabled: e.enabled,
      noindex: e.noindex,
      draft: e.draft,
      published: e.published,
      published_at: e.published_at,
    };
  },

  fromRow(cells: Record<string, string>, rowNo: number, _ctx: ImportContext) {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const c of columns) {
      const r = fromCell(c, cells[c.key] ?? '', 'school_site', rowNo);
      if ('error' in r) errors.push(r.error);
      else v[c.key] = r.value;
    }
    if (errors.length > 0) return { errors };
    const bad = (column: string, message: string) =>
      errors.push({ tab: 'school_site', row: rowNo, column, message, severity: 'error' });
    const theme = themeOf(v.theme);
    for (const col of ['draft', 'published'] as const) {
      const cfg = v[col];
      if (cfg === null) continue;
      if (!isObj(cfg)) {
        bad(col, `Column "${col}": must be a JSON object.`);
        continue;
      }
      // The `theme` column follows the draft (saveDraft sets it); the published copy keeps the
      // theme it was published with until the next publish, so it is checked against its own.
      const own = col === 'draft' ? theme : themeOf(cfg.theme);
      const checked = own ? validateSiteConfig(cfg, own) : null;
      if (!checked?.ok) bad(col, `Column "${col}": is not a valid website config for the theme.`);
      else v[col] = checked.value;
    }
    if (theme && !THEMES[theme.id].palettes.some((p) => p.id === v.palette))
      bad('palette', 'Column "palette": is not a palette of the theme.');
    if (v.enabled && v.published === null)
      bad('enabled', 'Column "enabled": a site with nothing published cannot be switched on.');
    if (errors.length > 0) return { errors };
    return { row: v as unknown as SchoolSiteRow };
  },

  keyOf(x: SchoolSiteRow | SchoolSite): string {
    return x.subdomain ?? '';
  },

  diffFields(row: SchoolSiteRow, existing: SchoolSite): string[] {
    const changed: string[] = [];
    for (const k of ['theme', 'palette', 'enabled', 'noindex'] as const)
      if (row[k] !== existing[k]) changed.push(k);
    if (!same(row.draft, existing.draft)) changed.push('draft');
    if (!same(row.published, existing.published)) changed.push('published');
    return changed;
  },

  async upsert(
    row: SchoolSiteRow,
    existing: SchoolSite | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<SchoolSite> {
    // One site per school: a file from another school (another subdomain) still lands on this row.
    const site = existing ?? (await m.findOne(SchoolSite, { where: { tenant_id: tenantId } }));
    const publishedChanged = !site || !same(row.published, site.published);
    // No row yet: a fresh subdomain, retried on a collision so one taken slug never fails the restore.
    const target =
      site ??
      (await createSiteRow(m, tenantId, (await m.findOneByOrFail(School, { id: tenantId })).name, {
        theme: row.theme,
        palette: row.palette,
        draft: row.draft as never,
      }));
    target.theme = row.theme;
    target.palette = row.palette;
    target.enabled = row.enabled;
    target.noindex = row.noindex;
    target.draft = row.draft as never;
    target.published = row.published as never;
    target.published_at = row.published_at ? new Date(row.published_at) : null;
    target.draft_revision += 1;
    if (publishedChanged) target.version += 1;
    return m.save(SchoolSite, target);
  },

  remove(_e: SchoolSite, _m: EntityManager): Promise<void> {
    // A restore never takes a school's website down by absence.
    return Promise.resolve();
  },
};
