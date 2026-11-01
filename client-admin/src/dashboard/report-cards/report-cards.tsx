/**
 * [8.15.47] The two report cards the dashboard page renders itself, above the role's grid.
 *
 * ```
 *  Reports you may need                      Students by class
 *   1. Students by class and gender ...       Class 6 | 78
 *   2. Student list                           Class 7 | 71
 *   3. Teachers and staff by type             Open the full report   [Remove]
 *  (UsefulReportsCard: ready reports        (PinnedReportCards: reports the person put on
 *   never opened)                             the dashboard from the runner's More menu)
 * ```
 *
 * Neither is a registry widget. A registry card needs a key in `shared/` (26-dashboard section 14) and a
 * saved layout holds known keys only, so the page renders these cards like `AttendancePendingCard`.
 * What was pinned, opened or hidden is kept per person in this browser (`report-prefs.ts`).
 * A card never blocks the page: each has its own loading, error and empty state, and shows nothing
 * until it has something to say.
 *
 * PINNED. `GET /dashboard/widgets/report/:id`: the report's labels and first count, at most 50 rows,
 * run for THIS role. A pinned report the role can no longer open is skipped, never shown broken.
 *
 * USEFUL ("Reports you may need", D24). The ready reports this person has never opened, for admin,
 * accountant and executive. At most three, one link each. The BANBEIS count leads whenever it has not
 * been opened in the current academic year. The X hides the card for good; it also disappears on its
 * own once there is nothing left to suggest. "Opened" is what this browser saw (the runner notes every
 * open); the server keeps no such list. Only the school's own ready reports count (`key` equals
 * `system_template_key`), never a copy a school made from one.
 */
import { Permission, UserRole } from '@biddaloy/shared';
import { Button, Card, ReportTable, WidgetCard } from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  reportCatalogueQueryOptions,
  useActiveRole,
  useHasPermission,
  useReportWidget,
  type ReportCatalogueEntry,
  type ReportWidget,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { XIcon } from 'lucide-react';

import { useOpenedReports, usePinnedReports, useUsefulCardDismissed } from './report-prefs';

/** The tile's answer in the shape the report renderers read. */
export function widgetToResult(data: ReportWidget) {
  return {
    columns: data.columns.map((c) => ({ ...c, type: c.type })),
    rows: data.rows,
    masked: [],
    suppressed: data.suppressed,
    truncated: data.truncated,
    total_rows: data.rows.length,
    page: 1,
    page_size: Math.max(data.rows.length, 1),
    total_pages: 1,
    run_id: '',
  };
}

export function PinnedReportCard({
  entry,
  onRemove,
}: {
  entry: Pick<ReportCatalogueEntry, 'id' | 'name_en' | 'name_bn'>;
  onRemove: () => void;
}) {
  const { t } = useTranslation('reports');
  const { t: tDash } = useTranslation('dashboard');
  const { locale } = useLocale();
  const region = useTenantRegionConfig();
  const query = useReportWidget(entry.id);
  const title = (locale === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en;
  const data = query.data;
  const empty = data !== undefined && data.rows.length === 0;
  return (
    <WidgetCard
      title={title}
      variant="full"
      loading={query.isPending}
      loadingLabel={tDash('states.loading', { title })}
      {...(query.isError
        ? {
            error: {
              message: t('pinned.error'),
              retryLabel: t('landing.retry'),
              onRetry: () => void query.refetch(),
            },
          }
        : {})}
      {...(empty ? { empty: { reason: t('pinned.empty') } } : {})}
      footer={
        <>
          <Link
            to="/reports/$reportId"
            params={{ reportId: entry.id }}
            className="text-primary underline"
          >
            {t('pinned.open')}
          </Link>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t('pinned.remove')}
          </Button>
        </>
      }
    >
      {data && !empty ? (
        <div className="flex flex-col gap-2">
          <RegionConfigProvider value={region}>
            <ReportTable
              result={widgetToResult(data)}
              caption={title}
              tableId={`pinned-${entry.id}`}
            />
          </RegionConfigProvider>
          {data.truncated && (
            <p className="text-caption text-text-secondary">
              {t('pinned.truncated', { n: formatNumber(data.rows.length, region) })}
            </p>
          )}
          {data.suppressed && (
            <p className="text-caption text-text-secondary">{t('pinned.hidden')}</p>
          )}
        </div>
      ) : null}
    </WidgetCard>
  );
}

export function PinnedReportCards() {
  const canView = useHasPermission(Permission.REPORTS_VIEW);
  const pins = usePinnedReports();
  const catalogue = useQuery({
    ...reportCatalogueQueryOptions(),
    enabled: canView && pins.ids.length > 0,
  });
  if (!canView || pins.ids.length === 0 || !catalogue.data) return null;
  const all = catalogue.data.flatMap((folder) => folder.reports);
  // A pinned report that is gone, or not for this role, is skipped.
  const shown = pins.ids.flatMap((id) => all.filter((r) => r.id === id));
  if (shown.length === 0) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {shown.map((entry) => (
        <PinnedReportCard key={entry.id} entry={entry} onRemove={() => pins.toggle(entry.id)} />
      ))}
    </div>
  );
}

/** How many reports the card suggests at once. */
export const USEFUL_REPORTS_MAX = 3;

/** The ready report with the BANBEIS head count. */
export const BANBEIS_KEY = 'student-count-banbeis';

const CARD_ROLES: readonly string[] = [UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE];

export interface UsefulPick {
  entry: ReportCatalogueEntry;
  /** True for the BANBEIS count when it was opened before, but not this academic year. */
  notThisYear: boolean;
}

/**
 * Which ready reports to suggest. `opened` maps a report id to the ISO time it was last opened;
 * `yearStart` is the current academic year's first day (`undefined` while unknown, which counts
 * every earlier open as this year's).
 */
export function pickUsefulReports(
  catalogue: readonly ReportCatalogueEntry[],
  opened: Readonly<Record<string, string>>,
  yearStart: string | undefined,
): UsefulPick[] {
  // The school's own ready reports: a copy keeps `system_template_key` but gets its own `key`.
  const ready = catalogue.filter(
    (r) => r.system_template_key !== null && r.key === r.system_template_key,
  );
  const banbeis = ready.find((r) => r.key === BANBEIS_KEY);
  const lastOpened = banbeis ? opened[banbeis.id] : undefined;
  const banbeisDue =
    banbeis !== undefined &&
    (lastOpened === undefined || (yearStart !== undefined && lastOpened < yearStart));
  const picks: UsefulPick[] = [];
  if (banbeis && banbeisDue) picks.push({ entry: banbeis, notThisYear: lastOpened !== undefined });
  for (const entry of ready) {
    if (entry === banbeis || opened[entry.id] !== undefined) continue;
    picks.push({ entry, notThisYear: false });
  }
  return picks.slice(0, USEFUL_REPORTS_MAX);
}

export function UsefulReportsCard() {
  const { t } = useTranslation('reports');
  const { locale } = useLocale();
  const role = useActiveRole();
  const canView = useHasPermission(Permission.REPORTS_VIEW);
  const { dismissed, dismiss } = useUsefulCardDismissed();
  const { opened } = useOpenedReports();
  const eligible = canView && role !== null && CARD_ROLES.includes(role) && !dismissed;
  const catalogue = useQuery({ ...reportCatalogueQueryOptions(), enabled: eligible });
  const years = useQuery({ ...academicYearsQueryOptions({ limit: 100 }), enabled: eligible });

  if (!eligible || !catalogue.data) return null;
  const yearStart = years.data?.data.find((y) => y.is_current)?.start_date;
  const picks = pickUsefulReports(
    catalogue.data.flatMap((folder) => folder.reports),
    opened,
    yearStart,
  );
  if (picks.length === 0) return null;

  return (
    <Card asChild className="p-4 md:p-5">
      <section aria-labelledby="useful-reports-title">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="useful-reports-title" className="text-h2">
              {t('usefulCard.title')}
            </h2>
            <p className="text-text-secondary">{t('usefulCard.explanation')}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            className="size-11 shrink-0 md:size-8"
            aria-label={t('usefulCard.dismiss')}
            onClick={dismiss}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <ul className="mt-2 flex flex-col">
          {picks.map(({ entry, notThisYear }) => {
            const name = (locale === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en;
            return (
              <li key={entry.id}>
                <Link
                  to="/reports/$reportId"
                  params={{ reportId: entry.id }}
                  aria-label={t('usefulCard.open', { name })}
                  className="flex min-h-11 flex-col justify-center py-1 no-underline hover:bg-muted"
                >
                  <span className="font-medium">{name}</span>
                  <span className="text-text-secondary">
                    {t(`usefulCard.lines.${entry.system_template_key}`, {
                      defaultValue: t('hub.definedDescription'),
                    })}
                  </span>
                  {notThisYear && (
                    <span className="text-caption text-text-secondary">
                      {t('usefulCard.thisYear')}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}
