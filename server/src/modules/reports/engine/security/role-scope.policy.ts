import { ForbiddenException, Injectable } from '@nestjs/common';
import { AggregateFn, FieldSensitivity, UserRole, roleHasPermission } from '@biddaloy/shared';
import { TeacherScopeService } from '../../../classes/teacher-scope.service';
import type { FieldDef, MeasureDef, SubjectAreaDef } from '../registry/registry.types';
import { roleMaySee } from './sensitivity-permissions';

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

/** The runner may not run this report at all. The message is the same for every cause. */
export class ReportAccessDeniedError extends ForbiddenException {
  constructor() {
    super('You cannot run this report.');
  }
}

/** The only fields a COMMITTEE member may see besides PUBLIC ones (D14: counts, never people). */
export const COMMITTEE_EXTRA_FIELDS: ReadonlySet<string> = new Set(['religion']);
const COUNT_FNS = new Set<string>([AggregateFn.COUNT, AggregateFn.COUNT_DISTINCT]);

/**
 * [8.15.19] Decides what the person RUNNING a report may see (D5), whatever the author could.
 * - Rows: a TEACHER sees only the sections they are assigned to (the same rule as the screens,
 *   from `TeacherScopeService`); a teacher with none sees nothing; an area with no section
 *   (staff) is closed to teachers. Guardians and students cannot run defined reports (D13).
 * - Fields: each needs the permission of its sensitivity. COMMITTEE sees PUBLIC fields and
 *   religion only, so it never gets a person-level column.
 */
@Injectable()
export class RoleScopePolicy {
  constructor(private readonly teacherScope: TeacherScopeService) {}

  async scopeFor(ctx: ReportRunContext, area: SubjectAreaDef): Promise<ScopeClause[]> {
    if (ctx.role === UserRole.PARENT || ctx.role === UserRole.STUDENT) {
      throw new ReportAccessDeniedError();
    }
    if (area.permission && !roleHasPermission(ctx.role, area.permission)) {
      throw new ReportAccessDeniedError();
    }
    const sections = await this.teacherScope.sectionScope({
      role: ctx.role,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    });
    if (sections === null) return []; // tenant-wide roles: the tenant predicate is all there is
    if (!area.scope) throw new ReportAccessDeniedError();
    if (sections.length === 0) return [{ sql: '1 = 0', params: {} }];
    return [
      {
        sql: `${area.scope.sectionSql} IN (:...scopeSections)`,
        params: { scopeSections: sections },
        aliases: [area.scope.alias],
      },
    ];
  }

  fieldAllowed(
    ctx: ReportRunContext,
    def: Pick<FieldDef | MeasureDef, 'key' | 'sensitivity'>,
  ): boolean {
    if (ctx.role === UserRole.COMMITTEE) {
      // Counts, never people: a measure must be a COUNT, so no average or sum can narrow to one person.
      if ('fn' in def && !COUNT_FNS.has(String(def.fn))) return false;
      return def.sensitivity === FieldSensitivity.PUBLIC || COMMITTEE_EXTRA_FIELDS.has(def.key);
    }
    return roleMaySee(ctx.role, def.sensitivity);
  }
}
