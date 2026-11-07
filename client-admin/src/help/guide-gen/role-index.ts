/**
 * [Epic 42 / #2520] The `roles` marker block of
 * `docs/user-guide/<lang>/roles/<role>.md`: that role's features in real
 * sidebar order, with the app's own menu labels.
 */
import { STAFF_NAV_ITEMS } from '../../nav-tree';
import { PORTAL_NAV_ITEMS } from '../../routes/portal';

import { navOrder, portalId, type Feature } from './features';
import type { GuideLang } from './field-table';

type Json = { [k: string]: unknown };
export interface RoleIndexDeps {
  features: readonly Feature[];
  nav: Json; // ui/src/i18n/locales/<lang>/nav.json
  common: Json; // .../common.json (entity nouns)
  summaries: Readonly<Record<string, string>>; // feature path -> page summary, for pages that exist
}

const SOON: Record<GuideLang, string> = { bn: 'শীঘ্রই আসছে', en: 'coming soon' };
const get = (o: Json, key: string): string | undefined => {
  const v = key.split('.').reduce<unknown>((acc, k) => (acc as Json | undefined)?.[k], o);
  return typeof v === 'string' ? v : undefined;
};

function label(f: Feature, d: RoleIndexDeps): string {
  let name: string | undefined;
  if (f.kind === 'portal') {
    name = get(d.nav, PORTAL_NAV_ITEMS.find((p) => portalId(p.to) === f.id)!.labelKey);
  } else {
    const l = STAFF_NAV_ITEMS[f.id as keyof typeof STAFF_NAV_ITEMS].label;
    name =
      'entity' in l
        ? (get(d.common, `entities.${l.entity}_other`) ?? get(d.common, `entities.${l.entity}`))
        : get(d.nav, `items.${l.key}`);
  }
  if (!name) throw new Error(`no nav label for ${f.id}`);
  return name;
}

export function buildRoleIndex(role: string, lang: GuideLang, d: RoleIndexDeps): string {
  const sidebar = [
    ...navOrder().map((e) => ({ group: e.groupId, id: e.item.id })),
    ...PORTAL_NAV_ITEMS.map((p) => ({ group: 'portal', id: portalId(p.to) })),
  ];
  const mine = sidebar.flatMap((e) => {
    const f = d.features.find((x) => x.id === e.id);
    return f?.roles.includes(role) ? [{ group: e.group, f }] : [];
  });
  const out: string[] = [];
  let current: string | null | undefined;
  for (const { group, f } of mine) {
    if (group !== current) {
      current = group;
      const heading = group && group !== 'portal' ? get(d.nav, `groups.${group}`) : undefined;
      if (out.length) out.push('');
      if (heading) out.push(`**${heading}**`, '');
    }
    const summary = d.summaries[f.path];
    out.push(
      summary === undefined
        ? `- ${label(f, d)} (${SOON[lang]})`
        : `- [${label(f, d)}](../${f.path}.md) — ${summary}`,
    );
  }
  return out.join('\n');
}
