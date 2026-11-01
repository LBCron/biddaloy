import { Injectable } from '@nestjs/common';
import type { UserRole } from '@biddaloy/shared';
import type { FieldDef, MeasureDef } from '../registry/registry.types';

/** Who is running a report: always the runner, never the author (D5). */
export interface ReportRunContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

/** A restriction the compiler ANDs into the query. `sql` uses aliases and `:name` parameters only. */
export interface ScopeClause {
  sql: string;
  params: Record<string, unknown>;
  /** Aliases the clause reads, so the compiler joins them even if no field does. */
  aliases?: string[];
}

/**
 * [8.15.14] Stub. [8.15.19] replaces both bodies with the real per-role row scopes,
 * field sensitivity and small-cell rules. Until then nothing is narrowed beyond the tenant.
 */
@Injectable()
export class RoleScopePolicy {
  scopeFor(_ctx: ReportRunContext): ScopeClause[] {
    return [];
  }

  fieldAllowed(
    _ctx: ReportRunContext,
    _field: Pick<FieldDef | MeasureDef, 'sensitivity'>,
  ): boolean {
    return true;
  }
}
