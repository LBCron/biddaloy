import type { EntityDef, JoinDef, SubjectAreaDef } from '../registry/registry.types';

/**
 * The joins a query needs, in an order that always starts from an alias already present.
 * Each joined table has exactly one `JoinDef` (aliases are unique, checked at start-up), so
 * the path to it is the chain of `from` aliases back to the root. Tables nothing refers to
 * are left out, so a narrow report never pays for a wide area.
 *
 * The root's `tenantVia` table is always included: it is how a table without its own
 * `tenant_id` is kept inside one school.
 */
export function planJoins(area: SubjectAreaDef, referenced: Iterable<string>): JoinDef[] {
  const needed = new Set<string>(referenced);
  if (area.root.tenantVia) needed.add(area.root.tenantVia);

  const joinTo = new Map<string, JoinDef>(area.joins.map((j) => [j.to.alias, j]));
  const stack = [...needed];
  while (stack.length > 0) {
    const alias = stack.pop() as string;
    const join = joinTo.get(alias);
    if (join && !needed.has(join.from)) {
      needed.add(join.from);
      stack.push(join.from);
    }
  }
  // `area.joins` is already ordered parent-first, so filtering keeps that order.
  return area.joins.filter((j) => needed.has(j.to.alias));
}

/** Every entity in the query, root first: what the tenant predicate must cover. */
export function entitiesInQuery(area: SubjectAreaDef, joins: readonly JoinDef[]): EntityDef[] {
  return [area.root, ...joins.map((j) => j.to)];
}
