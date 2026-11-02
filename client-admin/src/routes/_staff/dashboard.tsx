import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { DashboardPage, DashboardSkeleton } from '../../dashboard/layout/dashboard-page';
import { loadRouteNamespaces } from '../../route-loaders';

/** `?customize=1` opens customise mode (2-11). */
const searchSchema = z.object({ customize: z.literal(1).optional().catch(undefined) });

/**
 * `/dashboard` — the role's widget grid ([169] Epic, wave 2). Widgets are
 * files under `src/dashboard/widgets/` picked up by the registry.
 */
export const Route = createFileRoute('/_staff/dashboard')({
  validateSearch: searchSchema,
  loader: () =>
    loadRouteNamespaces(
      'dashboard',
      'calendar',
      'nav',
      'attention',
      'auth',
      'setupChecklist',
      'attendance',
      'applications',
      'printHistory',
      'setupChecklist',
      'reports',
      'reportView',
    ),
  pendingComponent: DashboardPending,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { customize } = Route.useSearch();
  return <DashboardPage customize={customize === 1} />;
}

function DashboardPending() {
  const { t } = useTranslation('nav');
  return (
    <>
      <span className="sr-only">{t('routePending.label')}</span>
      <DashboardSkeleton />
    </>
  );
}
