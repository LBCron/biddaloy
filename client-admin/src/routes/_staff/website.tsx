/**
 * [40.2.04] `/website` layout: the school website's page frame. One tab today (Overview); later
 * waves append Design, Pages, Blog, Enquiries, Address and Visitors the same way (#3632, #3652).
 *
 * While the first-run wizard is open (`?step=`) the wizard owns the whole page, so the tab frame
 * steps aside rather than nesting one page container in another.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../route-loaders';

const websiteSearchSchema = z.object({
  tab: z.string().optional(),
  step: z.string().optional(),
});

const TAB_IDS = ['overview'] as const;

export const Route = createFileRoute('/_staff/website')({
  validateSearch: websiteSearchSchema,
  loader: () => loadRouteNamespaces('website', 'common'),
  component: WebsiteLayout,
});

function WebsiteLayout() {
  const { t } = useTranslation('website');
  const { step } = Route.useSearch();
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  if (step !== undefined) return <Outlet />;
  return (
    <DetailShell
      name={t('overview.title')}
      tabs={[{ id: 'overview', label: t('tabs.overview'), content: <Outlet /> }]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    />
  );
}
