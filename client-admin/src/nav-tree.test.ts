import { Permission, roleHasPermission, STAFF_ROLES, UserRole } from '@biddaloy/shared';
import { hasPermission } from '@biddaloy/ui/hooks';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { NOT_IN_NAV } from './nav-not-in-nav';
import {
  isPathUnder,
  matchesNavSearch,
  rankByMatch,
  STAFF_BOTTOM_NAV,
  STAFF_NAV_GROUPS,
  STAFF_NAV_ITEMS,
  STAFF_TOP_NAV_ITEMS,
} from './nav-tree';
import { routeTree } from './routeTree.gen';

function allGroupItems() {
  return STAFF_NAV_GROUPS.flatMap((group) => [...(group.pinnedItems ?? []), ...group.items]);
}

/**
 * [30.1.5] Bidirectional completeness guard, modelled directly on
 * `route-permissions.test.ts`'s `leafPaths()`-style derivation from
 * `routeTree.gen.ts`: the app's real route tree, not a hand-maintained
 * list, so a route added without updating the sidebar (or vice versa)
 * fails here instead of shipping silently.
 */
const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

function leafRouteIds(): string[] {
  const routes = Object.values(router.routesById) as { id: string; children?: unknown[] }[];
  return routes
    .filter((route) => !route.children || route.children.length === 0)
    .map((route) => route.id);
}

/** Every nav item's `to` (a URL path, no `/_staff` prefix), resolved to
 * the route id it targets — `/_staff` + `to`, trying the index-leaf form
 * (trailing slash) first since that's how a group route without its own
 * `path` component resolves in `routeTree.gen.ts` (`/students` ->
 * `/_staff/students/`), falling back to the bare form (`/settings` ->
 * `/_staff/settings`). Maps to `undefined` when neither exists, so
 * Direction B can report it as broken rather than silently passing. */
function navTargetRouteId(to: string): string | undefined {
  const withSlash = `/_staff${to}/`;
  const bare = `/_staff${to}`;
  if (withSlash in router.routesById) return withSlash;
  if (bare in router.routesById) return bare;
  return undefined;
}

describe('nav-tree', () => {
  it('every item id is unique', () => {
    const ids = allGroupItems().map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every group id is unique', () => {
    const ids = STAFF_NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no group declares an item whose `to` is empty', () => {
    for (const item of allGroupItems()) {
      expect(item.to).not.toBe('');
    }
  });

  it('keeps the pre-30.1.3 group ids stable so saved collapse preferences survive', () => {
    const ids = STAFF_NAV_GROUPS.map((group) => group.id);
    for (const stable of ['people', 'finance', 'communications', 'administration']) {
      expect(ids).toContain(stable);
    }
  });

  it('is importable and usable with no React render', () => {
    expect(STAFF_NAV_GROUPS.length).toBeGreaterThan(0);
    expect(Object.keys(STAFF_NAV_ITEMS).length).toBeGreaterThan(0);
  });

  it('declares Exams & Results with exams, templates, seat plans, grading scales, analysis, then promotion — [19.6.1]/[20.3.1]/[25.6]/[26.5.1]/[26.6.1]', () => {
    const examsResults = STAFF_NAV_GROUPS.find((group) => group.id === 'examsResults');
    expect(examsResults?.items.map((item) => item.id)).toEqual([
      'examsResults.exams',
      'examsResults.examTemplates',
      'examsResults.marksEntry',
      'examsResults.seatPlans',
      'examsResults.gradingScales',
      'examsResults.results',
      'examsResults.finalResults',
      'examsResults.analysis',
      'examsResults.promotion',
    ]);
    expect(examsResults?.pinnedItems ?? []).toEqual([]);
  });

  it('[31.3.1] drops finance.fees and adds the five new items in place', () => {
    expect('finance.fees' in STAFF_NAV_ITEMS).toBe(false);
    const academics = STAFF_NAV_GROUPS.find((group) => group.id === 'academics')!;
    const ids = academics.items.map((item) => item.id);
    const at = ids.indexOf('academics.routineBuilder');
    expect(ids.slice(at + 1, at + 3)).toEqual([
      'academics.routineReview',
      'academics.routineSubstitutions',
    ]);
    const finance = STAFF_NAV_GROUPS.find((group) => group.id === 'finance')!;
    const fIds = finance.items.map((item) => item.id);
    expect(fIds.indexOf('finance.payments')).toBe(fIds.indexOf('finance.invoices') - 1);
  });

  it('[31.3.1] every staff role has 1-4 distinct bottom-bar cells it holds the permission for', () => {
    for (const role of STAFF_ROLES) {
      const cells = STAFF_BOTTOM_NAV[role];
      expect(cells.length).toBeGreaterThanOrEqual(1);
      expect(cells.length).toBeLessThanOrEqual(4);
      expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
      for (const cell of cells) {
        const item = STAFF_NAV_ITEMS[cell.id];
        expect(item).toBeDefined();
        if ('permission' in item) expect(roleHasPermission(role, item.permission)).toBe(true);
      }
    }
    expect(STAFF_BOTTOM_NAV.TEACHER[0]!.id).toBe('dashboard');
  });

  it('[31.3.1] isPathUnder matches whole segments', () => {
    expect(isPathUnder('/fees/dues/x', '/fees/dues')).toBe(true);
    expect(isPathUnder('/feesx', '/fees')).toBe(false);
    expect(isPathUnder('/dashboard', '/dashboard')).toBe(true);
    expect(isPathUnder('/my-class/abc', '/my-class')).toBe(true);
  });

  it('every item referenced by a group matches its STAFF_NAV_ITEMS entry', () => {
    for (const item of allGroupItems()) {
      expect(STAFF_NAV_ITEMS[item.id as keyof typeof STAFF_NAV_ITEMS]).toBe(item);
    }
  });
});

/**
 * [30.1.5] Wave-1-close completeness guard: without this, a new route can
 * ship with no sidebar home (or a nav item can point at a route that no
 * longer exists) and nothing fails. Same "missing"/"stale" split and
 * failure-message shape as `route-permissions.test.ts`.
 */
describe('nav-tree completeness against routeTree.gen.ts', () => {
  it('Direction A: every leaf route is reachable from the sidebar, or listed in NOT_IN_NAV', () => {
    const navRouteIds = new Set(
      [...STAFF_TOP_NAV_ITEMS, ...allGroupItems()]
        .map((item) => navTargetRouteId(item.to))
        .filter((id): id is string => id !== undefined),
    );
    const allowlisted = new Set(Object.keys(NOT_IN_NAV));

    const uncovered = leafRouteIds().filter((id) => !navRouteIds.has(id) && !allowlisted.has(id));

    expect(
      uncovered,
      `leaf route(s) with no sidebar home and no NOT_IN_NAV reason: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it("Direction B: every nav item's `to` resolves to a real route", () => {
    const broken = [...STAFF_TOP_NAV_ITEMS, ...allGroupItems()]
      .filter((item) => navTargetRouteId(item.to) === undefined)
      .map((item) => `${item.id} -> ${item.to}`);

    expect(
      broken,
      `nav item(s) pointing at a route that does not exist: ${broken.join(', ')}`,
    ).toEqual([]);
  });

  it('NOT_IN_NAV entries all name a route that still exists', () => {
    const known = new Set(leafRouteIds());
    const stale = Object.keys(NOT_IN_NAV).filter((id) => !known.has(id));

    expect(
      stale,
      `NOT_IN_NAV entry(ies) for route(s) that no longer exist: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('NOT_IN_NAV entries do not overlap a route reachable from the sidebar', () => {
    const navRouteIds = new Set(
      [...STAFF_TOP_NAV_ITEMS, ...allGroupItems()]
        .map((item) => navTargetRouteId(item.to))
        .filter((id): id is string => id !== undefined),
    );
    const overlap = Object.keys(NOT_IN_NAV).filter((id) => navRouteIds.has(id));

    expect(
      overlap,
      `NOT_IN_NAV entry(ies) that are actually reachable from the sidebar: ${overlap.join(', ')}`,
    ).toEqual([]);
  });

  it('NOT_IN_NAV requires a non-empty reason for every entry', () => {
    const empty = Object.entries(NOT_IN_NAV)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([id]) => id);

    expect(empty, `NOT_IN_NAV entry(ies) missing a reason: ${empty.join(', ')}`).toEqual([]);
  });
});

describe('matchesNavSearch — CommandPalette Page tab (30.5.1)', () => {
  it('matches on the item label', () => {
    expect(matchesNavSearch('Attendance', undefined, 'attend')).toBe(true);
  });

  it('matches on a synonym, e.g. "routine" for the attendance item', () => {
    const item = STAFF_NAV_ITEMS['attendance.attendance'];
    expect(item.synonyms).toContain('routine');
    expect(matchesNavSearch('Attendance', item.synonyms, 'routine')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesNavSearch('Attendance', undefined, 'ATTEND')).toBe(true);
  });

  it('an empty query matches every item', () => {
    expect(matchesNavSearch('Attendance', ['routine'], '')).toBe(true);
    expect(matchesNavSearch('Attendance', ['routine'], '   ')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(matchesNavSearch('Attendance', ['routine', 'timetable'], 'invoice')).toBe(false);
  });
});

describe('[28.4.1] Evaluations nav item', () => {
  it('sits in the people group, gated on ACR_READ, which TEACHER lacks', () => {
    const item = STAFF_NAV_ITEMS['people.evaluations'];
    expect(item.permission).toBe(Permission.ACR_READ);
    expect(hasPermission(UserRole.TEACHER, item.permission)).toBe(false);
    expect(hasPermission(UserRole.ADMIN, item.permission)).toBe(true);
    expect(allGroupItems()).toContain(item);
  });
});

describe('rankByMatch', () => {
  const r = (label: string, disabled?: boolean) => ({ label, ...(disabled && { disabled }) });

  it('puts starts-with before contains', () => {
    expect(rankByMatch([r('Unpaid fees'), r('Fees')], 'fee').map((x) => x.label)).toEqual([
      'Fees',
      'Unpaid fees',
    ]);
  });

  it('keeps input order when keys are equal', () => {
    expect(rankByMatch([r('b fee'), r('a fee')], 'fee').map((x) => x.label)).toEqual([
      'b fee',
      'a fee',
    ]);
  });

  it('sinks disabled rows even when they start with the query', () => {
    expect(rankByMatch([r('Fee x', true), r('My fee')], 'fee').map((x) => x.label)).toEqual([
      'My fee',
      'Fee x',
    ]);
  });

  it('keeps input order for an empty query, disabled last', () => {
    expect(rankByMatch([r('B', true), r('C'), r('A')], '').map((x) => x.label)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });
});
