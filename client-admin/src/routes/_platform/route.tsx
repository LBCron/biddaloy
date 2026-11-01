import { UserRole } from '@biddaloy/shared';
import {
  AppHeader,
  AppShell,
  BottomNav,
  Breadcrumbs,
  LocaleSwitcher,
  NotificationBell,
  ThemeToggle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet, useMatches, useRouterState } from '@tanstack/react-router';
import * as React from 'react';

import { CommandPaletteLauncher } from '../../components/command-palette-launcher';
import { PlatformAlertBanner } from '../../components/platform-alert-banner';
import { StaffUserMenu } from '../../components/staff-user-menu';
import { useAttentionCenter } from '../../features/attention/attention-center';
import { DemoCornerFrame } from '../../features/demo/demo-corner-frame';
import { useDemoMode } from '../../features/demo/use-demo-mode';
import { MORE_ICON, PLATFORM_NAV_ICONS, STAFF_NAV_ICONS } from '../../nav-icons';
import { isPathUnder } from '../../nav-tree';
import { loadRouteNamespaces } from '../../route-loaders';
import { useBreadcrumbs } from '../../use-breadcrumbs';

/**
 * #533's SUPER_ADMIN platform console — a pathless layout, same
 * "`_`-prefixed folder = no path segment of its own" convention
 * `_staff.tsx`/`portal.tsx` already use (see `_staff.tsx`'s header
 * comment). Every route under `_platform/` (`/schools`, `/schools/:id`,
 * ...) sits directly at that URL, e.g. `_platform/schools/index.tsx` is
 * `/schools`.
 *
 * A **separate** top-level layout from `_staff`, not nested inside it —
 * `STAFF_ROLES` includes `SUPER_ADMIN` (`shared/src/enums/audiences.ts`),
 * so a SUPER_ADMIN's day-to-day tenant work still lives in the ordinary
 * staff shell; this is a distinct, narrower admin console they step into
 * (via the nav link `_staff.tsx` renders for them, see that file's
 * `platformItem`), not a section of it. Redirects to `/dashboard` rather
 * than `/portal` — the same non-SUPER_ADMIN staff role that would land
 * here already belongs in the staff shell, just not this console.
 *
 * `RequireRole` here is the same **UX-only** gate `_staff.tsx` uses —
 * the server's own `@Roles(UserRole.SUPER_ADMIN)` on every `/schools`
 * route (`schools.controller.ts`) is the actual security boundary.
 *
 * [31.3.3] Renders inside the same `AppShell` as the staff and portal
 * shells (D33): sidebar, top bar, phone row and a bottom bar of Schools ·
 * Holidays · Dashboard (back to the school app) plus More (C8).
 */
export const Route = createFileRoute('/_platform')({
  loader: () => loadRouteNamespaces('nav', 'platform', 'auth', 'attention'),
  component: PlatformLayout,
});

function PlatformLayout() {
  const demo = useDemoMode();
  // `nav` first: `check-i18n-keys.mjs` resolves bare keys off the first call.
  const { t } = useTranslation('nav');
  const { t: tPlatform } = useTranslation('platform');
  const { t: tAuth } = useTranslation('auth');
  const attention = useAttentionCenter({ todoTo: '/notifications' });
  const SchoolsIcon = PLATFORM_NAV_ICONS['/schools'];
  const HolidaySetsIcon = PLATFORM_NAV_ICONS['/holiday-sets'];
  const SubscriptionsIcon = PLATFORM_NAV_ICONS['/subscriptions'];
  const ReportsUsageIcon = PLATFORM_NAV_ICONS['/reports-usage'];
  const DashboardIcon = STAFF_NAV_ICONS.dashboard;

  const matches = useMatches();
  const chromeless = matches[matches.length - 1]?.staticData.chromeless === true;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { items: breadcrumbItems, title: breadcrumbTitle } = useBreadcrumbs(t('brand'));
  React.useEffect(() => {
    if (breadcrumbTitle !== undefined) {
      document.title = breadcrumbTitle;
    }
  }, [breadcrumbTitle]);

  const navItems = [
    {
      to: '/schools',
      label: t('items.schools'),
      icon: <SchoolsIcon aria-hidden="true" />,
    },
    {
      to: '/holiday-sets',
      label: t('items.holidaySets'),
      icon: <HolidaySetsIcon aria-hidden="true" />,
    },
    {
      to: '/subscriptions',
      label: t('items.subscriptions'),
      icon: <SubscriptionsIcon aria-hidden="true" />,
    },
    {
      to: '/reports-usage',
      label: t('items.reportsUsage'),
      icon: <ReportsUsageIcon aria-hidden="true" />,
    },
  ];
  const platformPages = navItems.map((i) => ({ id: i.to, label: i.label, to: i.to }));
  // The console's bottom bar keeps Schools and Holidays (Subscriptions and Report usage are under More); the third cell goes back to the school app (C8).
  const cells = [
    { ...navItems[0]!, label: t('bottomNavCells.schools') },
    { ...navItems[1]!, label: t('bottomNavCells.holidays') },
    {
      to: '/dashboard',
      label: t('bottomNavCells.dashboard'),
      icon: <DashboardIcon aria-hidden="true" />,
    },
  ];
  const consoleTitle = tPlatform('breadcrumb.platformAdmin');
  const notificationBell = (
    <NotificationBell viewAllTo="/notifications" attention={attention.bell} />
  );

  return (
    <DemoCornerFrame>
      <RequireRole allow={[UserRole.SUPER_ADMIN]} redirectTo="/dashboard">
        {chromeless ? (
          <Outlet />
        ) : (
          <AppShell
            reserveCorner={demo.enabled}
            navItems={navItems}
            brand={t('brand')}
            topBar={
              <div className="hidden md:flex">
                <AppHeader
                  reserveCorner={demo.enabled}
                  start={
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{consoleTitle}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-text-secondary">
                        {tAuth('schoolPicker.roles.SUPER_ADMIN')}
                      </span>
                    </div>
                  }
                  end={
                    <>
                      <CommandPaletteLauncher pages={platformPages} />
                      {notificationBell}
                      <LocaleSwitcher />
                      <ThemeToggle />
                      <StaffUserMenu />
                    </>
                  }
                />
              </div>
            }
            mobileTitle={consoleTitle}
            mobileActions={
              <>
                <CommandPaletteLauncher pages={platformPages} />
                {notificationBell}
                <StaffUserMenu />
              </>
            }
            bottomNav={
              <BottomNav
                items={cells}
                label={t('bottomNavStaffLabel')}
                more={{
                  label: t('items.more'),
                  icon: <MORE_ICON className="size-5" aria-hidden="true" />,
                  active: !cells.some((c) => isPathUnder(pathname, c.to)),
                }}
              />
            }
            openMenuLabel={t('openMenuLabel')}
            closeMenuLabel={t('closeMenuLabel')}
            navLabel={t('navLabel')}
            skipLinkLabel={t('skipToContent')}
          >
            <PlatformAlertBanner enabled />
            {attention.bar}
            {attention.modal}
            {breadcrumbItems.length > 0 && (
              <Breadcrumbs
                items={breadcrumbItems}
                aria-label={t('breadcrumb.navLabel')}
                className="mb-4"
              />
            )}
            <Outlet />
          </AppShell>
        )}
      </RequireRole>
    </DemoCornerFrame>
  );
}
