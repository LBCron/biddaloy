/**
 * [Epic 42 / #2520] The guide's feature list: one entry per page the guide
 * documents, written to `docs/user-guide/_generated/features.json`.
 *
 *   nav-tree item / portal item / fixed id  ->  { id, kind, path, route, routes, roles }
 *
 * `path` is relative to a language folder (`attendance/attendance`).
 * `routes` is every `e2e/route-manifest.json` route the page documents (D41):
 * a feature claims its own `to` and everything under it, the longest claim
 * wins, and the explicit tables below beat both.
 */
import {
  GUARDIAN_ROLES,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  UserRole,
  type Permission,
} from '@biddaloy/shared';

import { STAFF_NAV_GROUPS, STAFF_TOP_NAV_ITEMS } from '../../nav-tree';
import { PORTAL_NAV_ITEMS } from '../../routes/portal';

export type FeatureKind =
  'nav' | 'portal' | 'start' | 'admin' | 'administration' | 'dashboard' | 'help';

export interface Feature {
  id: string;
  kind: FeatureKind;
  path: string;
  route: string | null;
  routes: string[];
  roles: string[];
}

export const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const notSuper = (r: UserRole) => r !== UserRole.SUPER_ADMIN;
const EVERYONE = Object.values(UserRole).filter(notSuper);
const STAFF = STAFF_ROLES.filter(notSuper);

/** Roles of `shell` (the shell the item lives in) that hold `permission`. A
 * staff item is never listed for a guardian even if one holds the permission:
 * a guardian cannot open the staff shell. SUPER_ADMIN is the platform (D15). */
const rolesFor = (shell: readonly UserRole[], permission?: Permission): string[] =>
  shell.filter((r) => notSuper(r) && (!permission || ROLE_PERMISSIONS[r].includes(permission)));

interface Fixed {
  id: string;
  routes: string[];
  roles: readonly UserRole[];
  /** Page path when it is not derived from the id (a child page of a nav page). */
  path?: string;
}

const PRINT_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];

// Ids with no sidebar item. A fixed id with no routes is a page about a thing,
// not a screen.
const FIXED: Fixed[] = [
  {
    id: 'start.signIn',
    roles: EVERYONE,
    routes: [
      '/login',
      '/forgot-password',
      '/reset-password',
      '/activate',
      '/select-school',
      '/auth/social/done',
    ],
  },
  { id: 'start.phone', roles: EVERYONE, routes: [] },
  { id: 'start.language', roles: EVERYONE, routes: [] },
  { id: 'start.account', roles: EVERYONE, routes: ['/security', '/verify-email'] },
  { id: 'start.findAnything', roles: STAFF, routes: [] },
  { id: 'admin.howItWorks', roles: [UserRole.ADMIN], routes: [] },
  { id: 'admin.setupOrder', roles: [UserRole.ADMIN], routes: [] },
  { id: 'admin.scenarios', roles: [UserRole.ADMIN], routes: [] },
  { id: 'admin.createSchool', roles: [UserRole.ADMIN], routes: ['/register', '/welcome'] },
  { id: 'dashboard.widgets', roles: STAFF, routes: [] },
  { id: 'dashboard.customise', roles: STAFF, routes: [] },
  { id: 'dashboard.alerts', roles: STAFF, routes: ['/notifications'] },
  // Child pages of administration/print-templates: pages about a thing, no screen of their own.
  {
    id: 'administration.printDesignerGuide',
    path: 'administration/print-templates/designer-guide',
    roles: [UserRole.ADMIN],
    routes: [],
  },
  {
    id: 'administration.printPrinters',
    path: 'administration/print-templates/printers-and-calibration',
    roles: PRINT_ROLES,
    routes: [],
  },
  {
    id: 'administration.printIdCards',
    path: 'administration/print-templates/id-cards',
    roles: PRINT_ROLES,
    routes: [],
  },
  {
    id: 'administration.printExamDocuments',
    path: 'administration/print-templates/exam-documents',
    roles: PRINT_ROLES,
    routes: [],
  },
  {
    id: 'administration.printCertificates',
    path: 'administration/print-templates/certificates',
    roles: [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF],
    routes: [],
  },
  { id: 'help.glossary', roles: EVERYONE, routes: [] },
  { id: 'help.troubleshooting', roles: EVERYONE, routes: [] },
  { id: 'help.cantSeeThis', roles: EVERYONE, routes: [] },
  { id: 'help.whatsNew', roles: EVERYONE, routes: [] },
  // The bell in the portal header opens it; it has no portal menu item of its own.
  { id: 'portal.notifications', roles: GUARDIAN_ROLES, routes: ['/portal/notifications'] },
];

// Routes that belong to a feature that already has a sidebar item.
const OWNED: Record<string, string[]> = {
  dashboard: ['/print/committee-report'],
  'administration.printTemplates': ['/print/document', '/print/preview', '/v/$token'],
  'finance.invoices': ['/i/$token'],
  'academics.syllabus': ['/academics/study-plans/$planId'],
  'people.evaluations': ['/staff/$userId/acr/$assessmentId'],
  'people.admissionIntakes': ['/admission/$slug', '/admission/$slug/status'],
};

const pathOf = (id: string) => {
  const [a, b = a] = id.split('.');
  return `${kebab(a!)}/${kebab(b!)}`;
};

export const portalId = (to: string) =>
  `portal.${
    to === '/portal'
      ? 'overview'
      : to.slice('/portal/'.length).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
  }`;

/** Sidebar order: top items, then each group's pinned items, then its items. */
export function navOrder() {
  const all = [
    ...STAFF_TOP_NAV_ITEMS.map((item) => ({ groupId: null as string | null, item })),
    ...STAFF_NAV_GROUPS.flatMap((g) =>
      [...(g.pinnedItems ?? []), ...g.items].map((item) => ({
        groupId: g.id,
        item,
      })),
    ),
  ];
  return all.filter((e, i) => all.findIndex((o) => o.item.id === e.item.id) === i);
}

export function buildFeatures(manifestRoutes: readonly string[]): Feature[] {
  const base: Omit<Feature, 'routes'>[] = [
    ...navOrder().map(({ item }) => ({
      id: item.id,
      kind: item.id === 'dashboard' ? ('dashboard' as const) : ('nav' as const),
      path: pathOf(item.id),
      route: item.to,
      roles: rolesFor(STAFF_ROLES, item.permission),
    })),
    ...PORTAL_NAV_ITEMS.map((item) => ({
      id: portalId(item.to),
      kind: 'portal' as const,
      path: `portal/${kebab(portalId(item.to).slice('portal.'.length))}`,
      route: item.to,
      roles: rolesFor(GUARDIAN_ROLES, item.permission),
    })),
    ...FIXED.map((f) => ({
      id: f.id,
      kind: f.id.split('.')[0] as FeatureKind,
      path: f.path ?? pathOf(f.id),
      route: f.routes[0] ?? null,
      roles: [...f.roles],
    })),
  ];

  // Exact claims beat prefix claims; among prefixes the longest wins.
  const exact = new Map<string, string>();
  for (const f of FIXED) for (const r of f.routes) exact.set(r, f.id);
  for (const [id, routes] of Object.entries(OWNED)) for (const r of routes) exact.set(r, id);
  const prefixes = base
    .filter((f) => f.kind === 'nav' || f.kind === 'portal' || f.kind === 'dashboard')
    .map((f) => ({ id: f.id, to: f.route! }));
  const owner = (r: string): string | undefined =>
    exact.get(r) ??
    prefixes
      .filter(({ to }) => r === to || r.startsWith(`${to}/`))
      .sort((a, b) => b.to.split('/').length - a.to.split('/').length)[0]?.id;

  const claimed = new Map<string, string[]>();
  for (const r of manifestRoutes) {
    const id = owner(r);
    if (id) claimed.set(id, [...(claimed.get(id) ?? []), r]);
  }
  return base.map((f) => ({ ...f, routes: (claimed.get(f.id) ?? []).sort() }));
}

/** Manifest routes no feature documents; each needs an `internal:` entry in route-map.json. */
export const unmappedRoutes = (
  features: readonly Feature[],
  manifestRoutes: readonly string[],
): string[] => {
  const seen = new Set(features.flatMap((f) => f.routes));
  return manifestRoutes.filter((r) => !seen.has(r));
};
