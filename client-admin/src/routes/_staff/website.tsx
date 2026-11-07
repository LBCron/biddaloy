/**
 * [40.2.04] `/website` layout: the school website's page frame. Overview, Pages, Design, Blog and
 * Enquiries today (#3632); later waves append Address and Visitors the same way (#3652).
 *
 * While the first-run wizard is open (`?step=`) the wizard owns the whole page, so the tab frame
 * steps aside rather than nesting one page container in another.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../route-loaders';

const websiteSearchSchema = z.object({
  tab: z.string().optional(),
  step: z.string().optional(),
});

/**
 * Each tab is its own child route (`/website`, `/website/pages`, ...); the URL path says which
 * tab is open. Only the open tab renders the `<Outlet />`: `DetailShell` keeps visited panels
 * mounted, and a second outlet would draw the same page twice.
 */
const TAB_IDS = ['overview', 'pages', 'design', 'blog', 'enquiries'] as const;
type TabId = (typeof TAB_IDS)[number];

export const Route = createFileRoute('/_staff/website')({
  validateSearch: websiteSearchSchema,
  loader: () => loadRouteNamespaces('website', 'common'),
  component: WebsiteLayout,
});

function WebsiteLayout() {
  const { t } = useTranslation('website');
  const { step } = Route.useSearch();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const segment = pathname.replace(/\/+$/, '').split('/')[2] ?? 'overview';
  const activeTab: TabId = TAB_IDS.find((id) => id === segment) ?? 'overview';

  if (step !== undefined) return <Outlet />;
  return (
    <DetailShell
      name={t('overview.title')}
      tabs={TAB_IDS.map((id) => ({
        id,
        label: t(`tabs.${id}`),
        content: id === activeTab ? <Outlet /> : null,
      }))}
      activeTab={activeTab}
      onTabChange={(id) =>
        // Typed routes for blog and enquiries arrive with their own tickets, hence the cast.
        void navigate({ to: (id === 'overview' ? '/website' : `/website/${id}`) as '/website' })
      }
    />
  );
}
