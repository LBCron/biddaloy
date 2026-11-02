import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  PlatformReportUsageDto,
  PlatformReportUsageQueryDto,
  PlatformReportUsageRowDto,
} from './delivery/dto/report-delivery.dto';

/** The longest date range one call may ask for. */
export const MAX_USAGE_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const MAX_REPORTS = 200;
const COMMENTS_PER_REPORT = 5;
const DAY_MS = 86_400_000;

interface AggregateRow {
  report_key: string;
  runs: number;
  schools: number;
  unique_users: number;
  answered: number;
  helpful_yes: number;
  too_slow: number;
  empty_results: number;
  large_exports: number;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** `YYYY-MM-DD` that is a real calendar date, or null. */
function parseDay(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}

/**
 * [8.15.45] The platform's "which reports help" page (Epic 8.15 D24). Counts only: per report key,
 * how many runs, schools, people, how many said it helped, how many were too slow, came back empty
 * or were exports of more than 5,000 rows, plus the latest comments people typed. It never reads or
 * returns a student, guardian or money row, and the comments carry no school, person or run id.
 * A report key is a ready report's own key, or `custom` for anything a school made (so a school's
 * report names never reach the platform). It reads across schools on purpose: the route is
 * platform SUPER_ADMIN only. Every value is a bound parameter.
 */
@Injectable()
export class PlatformReportUsageService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async usage(query: PlatformReportUsageQueryDto): Promise<PlatformReportUsageDto> {
    const to = query.to ? parseDay(query.to) : parseDay(isoDay(new Date()));
    const from = query.from
      ? parseDay(query.from)
      : to && new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    if (
      !from ||
      !to ||
      from > to ||
      (to.getTime() - from.getTime()) / DAY_MS > MAX_USAGE_RANGE_DAYS
    ) {
      throw new BadRequestException('Choose a valid date range of at most one year.');
    }
    const range = [isoDay(from), isoDay(to)];

    // A run reaches its report through its own version id, or (a queued export) the one saved in its params.
    const rows: AggregateRow[] = await this.dataSource.query(
      `SELECT CASE WHEN d.system_template_key IS NOT NULL AND d.key = d.system_template_key
                   THEN d.system_template_key ELSE 'custom' END AS report_key,
              count(*)::int AS runs,
              count(DISTINCT r.tenant_id)::int AS schools,
              count(DISTINCT r.run_by)::int AS unique_users,
              count(*) FILTER (WHERE r.helpful IS NOT NULL)::int AS answered,
              count(*) FILTER (WHERE r.helpful IS TRUE)::int AS helpful_yes,
              count(*) FILTER (WHERE r.error_code = 'REPORT_TOO_SLOW')::int AS too_slow,
              count(*) FILTER (WHERE r.status = 'DONE' AND r.row_count = 0
                               AND r.kind IN ('RUN', 'SCHEDULED', 'SNAPSHOT'))::int AS empty_results,
              count(*) FILTER (WHERE r.kind = 'EXPORT' AND r.row_count > 5000)::int AS large_exports
         FROM report_runs r
         JOIN report_definition_versions v
           ON v.tenant_id = r.tenant_id
          AND v.id::text = COALESCE(r.definition_version_id::text, r.params->>'versionId')
         JOIN report_definitions d ON d.id = v.definition_id AND d.tenant_id = r.tenant_id
        WHERE r.created_at >= $1::date AND r.created_at < ($2::date + 1)
        GROUP BY 1
        ORDER BY runs DESC, report_key ASC
        LIMIT $3`,
      [...range, MAX_REPORTS],
    );

    const comments: Array<{ report_key: string; comment: string }> = await this.dataSource.query(
      `SELECT t.report_key, t.comment
         FROM (SELECT CASE WHEN d.system_template_key IS NOT NULL AND d.key = d.system_template_key
                           THEN d.system_template_key ELSE 'custom' END AS report_key,
                      r.feedback_comment AS comment,
                      r.feedback_at,
                      row_number() OVER (
                        PARTITION BY CASE WHEN d.system_template_key IS NOT NULL AND d.key = d.system_template_key
                                          THEN d.system_template_key ELSE 'custom' END
                        ORDER BY r.feedback_at DESC) AS n
                 FROM report_runs r
                 JOIN report_definition_versions v
                   ON v.tenant_id = r.tenant_id
                  AND v.id::text = COALESCE(r.definition_version_id::text, r.params->>'versionId')
                 JOIN report_definitions d ON d.id = v.definition_id AND d.tenant_id = r.tenant_id
                WHERE r.created_at >= $1::date AND r.created_at < ($2::date + 1)
                  AND r.feedback_comment IS NOT NULL AND r.feedback_at IS NOT NULL) t
        WHERE t.n <= $3
        ORDER BY t.report_key ASC, t.feedback_at DESC`,
      [...range, COMMENTS_PER_REPORT],
    );

    const byKey = new Map<string, string[]>();
    for (const row of comments)
      byKey.set(row.report_key, [...(byKey.get(row.report_key) ?? []), row.comment]);

    const reports: PlatformReportUsageRowDto[] = rows.map((row) => ({
      report_key: row.report_key,
      runs: row.runs,
      schools: row.schools,
      unique_users: row.unique_users,
      helpful_pct: row.answered === 0 ? null : Math.round((row.helpful_yes / row.answered) * 100),
      too_slow: row.too_slow,
      empty_results: row.empty_results,
      large_exports: row.large_exports,
      latest_comments: byKey.get(row.report_key) ?? [],
    }));
    return { from: range[0], to: range[1], reports };
  }
}
