/**
 * [169.2-10] `/dashboard`: header, briefing, the active role's widget grid.
 * Role default + saved layout -> `resolveLayout`; a failed prefs read just
 * shows the role default. `customize` (from `?customize=1`) swaps the grid for customise mode (2-11).
 */
import {
  DashboardWidgetKey,
  Permission,
  ROLE_DEFAULT_LAYOUTS,
  UserRole,
  WIDGET_CATALOGUE,
} from '@biddaloy/shared';
import { EmptyState, Skeleton } from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  hasPermission,
  onboardingStatusQueryOptions,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatMonth, formatWeekday } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PrinterIcon, ShieldCheckIcon, SlidersHorizontalIcon } from 'lucide-react';
import * as React from 'react';

import { AttendancePendingCard } from '../../components/attendance-pending-card';
import { ConnectHintCard } from '../../features/onboarding/connect-hint-card';
import { PinnedReportCards, UsefulReportsCard } from '../report-cards/report-cards';

import { BriefingSlot } from './briefing-slot';
import { CommitteeSummary } from './committee-summary';
import { CustomiseMode } from './customise/customise-mode';
import { DashboardGrid } from './dashboard-grid';
import { resolveLayout } from './resolve-layout';
import { useDashboardPrefs } from './use-dashboard-prefs';

/** Shaped like the page so nothing jumps when it lands. */
export function DashboardSkeleton() {
  return (
    <PageContainer>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

export function DashboardPage({ customize = false }: { customize?: boolean }) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const region = useTenantRegionConfig();
  const { role, pref, isLoading } = useDashboardPrefs();
  const today = React.useMemo(() => new Date(), []);
  // [8.10.7.5.06] COMMITTEE header: privacy line, print button, "month · year" subtitle (D49).
  const isCommittee = role === UserRole.COMMITTEE;
  const canPrint = useHasPermission(Permission.COMMITTEE_REPORT_READ);
  const years = useQuery({ ...academicYearsQueryOptions(), enabled: isCommittee });
  const yearName = years.data?.data.find((y) => y.is_current)?.name;

  const { visible } = React.useMemo(
    () =>
      role
        ? resolveLayout({
            role,
            pref,
            catalogue: WIDGET_CATALOGUE,
            defaults: ROLE_DEFAULT_LAYOUTS,
            can: (p) => hasPermission(role, p),
          })
        : { visible: [], hidden: [] },
    [role, pref],
  );
  // [8.10.7.7.03] D15: a brand-new school (nothing set up, not hidden) sees the
  // checklist alone instead of an empty grid. Same query the card uses (shared cache).
  const onboarding = useQuery({
    ...onboardingStatusQueryOptions(),
    enabled: role === UserRole.ADMIN,
  });
  const ob = onboarding.data;
  const brandNew =
    !!ob && !ob.dismissed_at && ob.items.length > 0 && ob.items.every((i) => !i.done);
  // A hidden checklist (resolveLayout dropped it from `visible`) stays hidden even for a new school.
  const checklistOnly = brandNew
    ? visible.find((v) => v.key === DashboardWidgetKey.SETUP_CHECKLIST)
    : undefined;
  const openCustomise = () => void navigate({ to: '/dashboard', search: { customize: 1 } });
  const closeCustomise = () => void navigate({ to: '/dashboard', search: {} });

  if (isLoading) return <DashboardSkeleton />;

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title={t('page.title')}
          subtitle={
            isCommittee
              ? [formatMonth(today, region), yearName && t('page.academicYear', { name: yearName })]
                  .filter(Boolean)
                  .join(' · ')
              : `${formatWeekday(today, region)}, ${formatDate(today, region)}`
          }
          actions={
            customize
              ? []
              : [
                  ...(isCommittee
                    ? [
                        {
                          id: 'print-report',
                          label: t('committeeSummary.printReport'),
                          icon: <PrinterIcon aria-hidden="true" />,
                          to: '/print/committee-report',
                          search: { from: '/dashboard' },
                          priority: 'primary' as const,
                          allowed: canPrint,
                        },
                      ]
                    : []),
                  {
                    id: 'customise',
                    label: t('page.customise'),
                    icon: <SlidersHorizontalIcon aria-hidden="true" />,
                    onClick: openCustomise,
                    keepOnPhone: true,
                  },
                ]
          }
        />
        {isCommittee && !customize && (
          <p className="-mt-2 flex items-center gap-2 text-caption text-text-secondary">
            <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />
            {t('committeeSummary.privacyNote')}
          </p>
        )}
        {customize && role ? (
          <CustomiseMode role={role} onDone={closeCustomise} />
        ) : (
          <>
            {isCommittee ? <CommitteeSummary /> : <BriefingSlot />}
            {!checklistOnly && (
              <>
                {/* Stopgap until a widget replaces them; each hides itself
                    (dismissed / no ATTENDANCE_READ / nothing to show). */}
                <ConnectHintCard />
                <AttendancePendingCard />
                {/* [8.15.47] Not registry widgets (a widget key lives in `shared/`): the page
                    renders them itself. Each shows nothing until it has something to say. */}
                <UsefulReportsCard />
                <PinnedReportCards />
              </>
            )}
            {checklistOnly ? (
              <DashboardGrid visible={[checklistOnly]} />
            ) : visible.length === 0 ? (
              <EmptyState
                title={t('states.allHidden.title')}
                explanation={t('states.allHidden.explanation')}
                action={{ label: t('states.allHidden.action'), onClick: openCustomise }}
              />
            ) : (
              <DashboardGrid visible={visible} />
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
