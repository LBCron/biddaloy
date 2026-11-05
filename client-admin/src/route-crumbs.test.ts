import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { ROUTE_CRUMBS } from './route-crumbs';
import { routeTree } from './routeTree.gen';

/**
 * [30.3.1] Drift guard, copying `route-permissions.test.ts`'s technique
 * (`router.routesById`, throwaway `QueryClient` context, leaf routes
 * only, "missing"/"stale" split naming the offending route). Every leaf
 * route across the whole app — not just `/_staff` — needs a
 * `ROUTE_CRUMBS` entry: a trail, or an explicit no-crumb reason.
 */
const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

function leafRouteIds(): string[] {
  const routes = Object.values(router.routesById) as { id: string; children?: unknown[] }[];
  return routes
    .filter((route) => !route.children || route.children.length === 0)
    .map((route) => route.id);
}

describe('ROUTE_CRUMBS', () => {
  it('has exactly one entry per leaf route: no missing, no stale', () => {
    const actual = [...new Set(leafRouteIds())].sort();
    const mapped = Object.keys(ROUTE_CRUMBS).sort();

    const missing = actual.filter((id) => !mapped.includes(id));
    const stale = mapped.filter((id) => !actual.includes(id));

    expect(missing, `route(s) missing ROUTE_CRUMBS entry: ${missing.join(', ')}`).toEqual([]);
    expect(
      stale,
      `ROUTE_CRUMBS entry for route(s) no longer in routeTree.gen.ts: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('gives every no-crumb entry a non-empty reason', () => {
    for (const [routeId, value] of Object.entries(ROUTE_CRUMBS)) {
      if (typeof value === 'string') {
        expect(
          value.trim().length,
          `ROUTE_CRUMBS['${routeId}'] has an empty reason`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('gives every trail at least one segment', () => {
    for (const [routeId, value] of Object.entries(ROUTE_CRUMBS)) {
      if (Array.isArray(value)) {
        expect(value.length, `ROUTE_CRUMBS['${routeId}'] has an empty trail`).toBeGreaterThan(0);
      }
    }
  });

  it('marks a $param route\'s own segment dynamic: "entity" when it has a trail', () => {
    for (const [routeId, value] of Object.entries(ROUTE_CRUMBS)) {
      const segments = routeId.split('/');
      const isParamRoute = segments.some((segment) => segment.startsWith('$'));
      if (!isParamRoute || !Array.isArray(value)) continue;
      // Deliberately static: three ids cannot feed one resolver (31.3.5).
      if (
        routeId === '/_staff/marks/$examId/$sectionId/$subjectId' ||
        routeId === '/_staff/marks/$examId/$sectionId/$subjectId_/import'
      )
        continue;

      const hasDynamicSegment = value.some((segment) => segment.dynamic === 'entity');
      expect(
        hasDynamicSegment,
        `ROUTE_CRUMBS['${routeId}'] is a $param route but no segment is marked dynamic: 'entity'`,
      ).toBe(true);
    }
  });

  it('[31.3.5] the survey trail has three segments and the second carries `to`', () => {
    const trail = ROUTE_CRUMBS['/_staff/staff/evaluations_/surveys/$surveyId'];
    expect(Array.isArray(trail) && trail.length).toBe(3);
    expect(Array.isArray(trail) && trail[1]!.to).toBe('/staff/evaluations?tab=surveys');
  });
});
