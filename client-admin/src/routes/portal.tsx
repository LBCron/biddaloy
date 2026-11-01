import { GUARDIAN_ROLES, Permission } from '@biddaloy/shared';
import {
  AppHeader,
  AppShell,
  BottomNav,
  Breadcrumbs,
  LocaleSwitcher,
  NotificationBell,
  SchoolInvitesCard,
  SyncStatusIndicator,
  TenantBar,
  ThemeToggle,
  HelpHint,
} from '@biddaloy/ui/components';
import {
  hasPermission,
  useActiveRole,
  useDensity,
  useSchoolInvitesCardProps,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { RequireRole } from '@biddaloy/ui/routes';
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import * as React from 'react';

import { CommandPaletteLauncher } from '../components/command-palette-launcher';
import { StaffUserMenu } from '../components/staff-user-menu';
import { useAttentionCenter } from '../features/attention/attention-center';
import { DemoCornerFrame } from '../features/demo/demo-corner-frame';
import { useDemoMode } from '../features/demo/use-demo-mode';
import { AppHelpProvider } from '../help/help-provider';
import { MORE_ICON, PORTAL_NAV_ICONS } from '../nav-icons';
import { isPathUnder } from '../nav-tree';
import { loadRouteNamespaces } from '../route-loaders';
import { useActiveSchoolName } from '../use-active-school-name';
import { useBreadcrumbs } from '../use-breadcrumbs';

/**
 * [8.9.10]'s guardian half of one SPA — the family-facing audience
 * (PARENT, STUDENT), pathed under `/portal` so its URLs are legible as a
 * different place rather than a differently-permissioned view of the same
 * one.
 *
 * Before this route existed, a PARENT who signed in landed on the staff
 * dashboard, saw a single sidebar link (Students, because
 * `ROLE_PERMISSIONS[PARENT]` carries `STUDENT_READ` for "read my child"),
 * and got a 403 on click, because `GET /students` means "read the roster"
 * to the server. Not a data leak — the server held — but a dead end,
 * because there was nowhere else to send them.
 *
 * Same `AppShell` rules as `_staff.tsx` (D33): one phone row, account menu,
 * distinct icons. The palette runs in pages-only mode (it searches the
 * portal's own nav items, no staff search API) and the bell reads the
 * client-side store, so neither needs a guardian-scoped API. `TenantBar` stays — a parent with
 * children at two schools switches the same way staff do, and [8.9.11]'s
 * role switcher is how a dual-role user gets back to their staff view
 * without logging out.
 *
 * The pages underneath are placeholders. The real portal — landing,
 * fee breakdown, invoice history, multi-child switching — is Epic 5.0
 * (#187), which also needs the family-facing read API (#19) that does not
 * exist yet. This ticket's job is the shell and the routing, so a
 * guardian has somewhere that is theirs instead of a 403.
 */
export const Route = createFileRoute('/portal')({
  // [8.14.5]: same reasoning as `_staff.tsx`'s own loader — this
  // layout's chrome renders `nav` strings on every navigation, and
  // `portal` covers the guardian-facing leaf routes underneath it.
  loader: () => loadRouteNamespaces('nav', 'portal', 'attention'),
  component: PortalLayout,
});

/** The four destinations `BottomNav` shows directly below `md`, with their
 * `bottomNavCells` short-label key; every other one is reachable through `more`. */
const BOTTOM_NAV_CELLS: Record<string, string> = {
  '/portal': 'overview',
  '/portal/fees': 'fees',
  '/portal/attendance': 'attendance',
  '/portal/results': 'results',
};

// `FEE_READ`/`INVOICE_READ` are what `ROLE_PERMISSIONS[PARENT]` and
// `[STUDENT]` actually hold, so `AppShell`'s own `visibleItems()` filter
// keeps this honest without a second list of "guardian links".
//
// [5.2]: one array, two renderings — the sidebar at >=768px and the
// `BottomNav` below it. Icons are only ever decorative here; the label
// is always real text, so an item is never an unlabelled glyph.
export interface PortalNavItemDef {
  to: string;
  labelKey: string;
  permission?: Permission;
}

export const PORTAL_NAV_ITEMS: readonly PortalNavItemDef[] = [
  {
    to: '/portal',
    labelKey: 'items.portalOverview',
    permission: Permission.FEE_READ,
  },
  {
    to: '/portal/fees',
    labelKey: 'items.portalFees',
    permission: Permission.INVOICE_READ,
  },
  {
    to: '/portal/statement',
    labelKey: 'items.portalStatement',
    // [8.15.38] `GET /portal/students/:id/statement` gates on `FEE_READ`, which PARENT and STUDENT
    // both hold. Not a bottom-bar cell: it lives under "More".
    permission: Permission.FEE_READ,
  },
  {
    to: '/portal/attendance',
    labelKey: 'items.portalAttendance',
    // [9.9] No `permission`: attendance's family-facing reads
    // (`AttendanceSummaryController`) are gated with `@Roles(...,
    // PARENT, STUDENT)` directly, not a `Permission` — there is no
    // `ATTENDANCE_READ` in `ROLE_PERMISSIONS` to key off, same "every
    // signed-in role in this shell owns it" case `/portal/account`
    // documents above.
  },
  {
    to: '/portal/routine',
    labelKey: 'items.portalRoutine',
    permission: Permission.ROUTINE_READ,
  },
  {
    to: '/portal/calendar',
    labelKey: 'items.portalCalendar',
    // [17.5.2] Same reasoning as `/portal/attendance` above: family
    // visibility is role-gated server-side (`@Roles(..., PARENT,
    // STUDENT)`), not behind a `Permission`, so no `permission` here.
  },
  {
    to: '/portal/results',
    labelKey: 'items.portalResults',
    // [19.9.1] `StudentResultsController` gates on `RESULT_READ`, which
    // `ROLE_PERMISSIONS[PARENT]`/`[STUDENT]` both hold — same pattern as
    // `/portal/fees`'s `INVOICE_READ` above.
    permission: Permission.RESULT_READ,
  },
  {
    to: '/portal/programs',
    labelKey: 'items.portalPrograms',
    // [34.5.2] `StudentProgramsController` (D24) gates
    // `GET /students/:id/programs` on `PROGRAM_READ`, which
    // `ROLE_PERMISSIONS[PARENT]`/`[STUDENT]` both hold — same pattern as
    // `/portal/results`'s `RESULT_READ` above.
    permission: Permission.PROGRAM_READ,
  },
  {
    to: '/portal/exam-schedule',
    labelKey: 'items.portalExamSchedule',
    // [19.11.1] `StudentExamScheduleController` gates on `RESULT_READ`,
    // same as `/portal/results` above.
    permission: Permission.RESULT_READ,
  },
  {
    to: '/portal/syllabus',
    labelKey: 'items.portalSyllabus',
    // [22.4.5] PARENT and STUDENT both hold `SYLLABUS_READ`.
    permission: Permission.SYLLABUS_READ,
  },
  {
    to: '/portal/homework',
    labelKey: 'items.portalHomework',
    // [8.10.7.5.10] PARENT and STUDENT hold HOMEWORK_READ (shared/src/enums/permissions.ts:512,530).
    permission: Permission.HOMEWORK_READ,
  },
  {
    to: '/portal/surveys',
    labelKey: 'items.portalSurveys',
    // No `permission`: `SurveyRespondController` is `@Roles(PARENT, STUDENT)`,
    // the same role-gated case as `/portal/attendance` above.
  },
  {
    to: '/portal/applications',
    labelKey: 'items.portalApplications',
    // [52.6.1] PARENT and STUDENT both hold `APPLICATION_SUBMIT` (D22). Not a bottom-bar
    // cell: it lives under "More".
    permission: Permission.APPLICATION_SUBMIT,
  },
  {
    to: '/portal/account',
    labelKey: 'items.portalAccount',
    // [8.14.4] No `permission`: every signed-in role in this shell owns
    // its own account — this is the exact "everyone in the shell sees
    // it" case `app-shell.tsx`'s `NavItem.permission` documents.
  },
];

function PortalLayout() {
  const demo = useDemoMode();
  const { t } = useTranslation('nav');
  const activeRole = useActiveRole();
  const schoolInvites = useSchoolInvitesCardProps();

  // [8.13.8] Comfortable density (contract section 6): one attribute lifts
  // every control under the guardian shell to the 44 px WCAG SC 2.5.5 target,
  // without a single component prop changing. The staff shell sets no
  // attribute and so keeps today's 32 px controls.
  //
  // Set on `document.documentElement`, NOT on a wrapper element around
  // `AppShell`. A wrapper would miss everything Radix renders through a
  // portal into `document.body` — and on this shell that is the part that
  // matters most: the mobile off-canvas navigation IS a `DialogContent`, so
  // its close button (`size="icon-sm"`) and every nav link would have stayed
  // 28 px on the exact 360 px phone this rule exists for. `useDensity`
  // restores the previous value on unmount, so navigating (or going Back) to
  // a staff route leaves the document compact again.
  useDensity('comfortable');

  // [30.3.3]: same wiring `_staff.tsx` uses — `ROUTE_CRUMBS` marks every
  // `/portal/*` leaf `null` today (this shell uses bottom-tab nav, not
  // breadcrumb chrome), so `breadcrumbItems` is always empty and
  // `breadcrumbTitle` always `undefined` here in practice. Wired
  // identically anyway so a future portal route that does get a crumb
  // entry needs no new plumbing, and so `use-route-focus.ts`'s own
  // `document.title` fallback keeps owning every page in this shell,
  // unchanged, exactly as it does today.
  const { items: breadcrumbItems, title: breadcrumbTitle } = useBreadcrumbs(t('brand'));
  React.useEffect(() => {
    if (breadcrumbTitle !== undefined) {
      document.title = breadcrumbTitle;
    }
  }, [breadcrumbTitle]);

  const navItems = PORTAL_NAV_ITEMS.map((item) => {
    const Icon = PORTAL_NAV_ICONS[item.to]!;
    return { ...item, label: t(item.labelKey), icon: <Icon aria-hidden="true" /> };
  });
  const portalPages = navItems.map((i) => ({ id: i.to, label: i.label, to: i.to }));

  // [31.3.2] Same "More" rule as the staff bar. `/portal` is an ancestor of
  // every other path, so it only owns the exact path.
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const bottomItems = navItems
    .filter((item) => item.to in BOTTOM_NAV_CELLS)
    .map((item) => ({ ...item, label: t(`bottomNavCells.${BOTTOM_NAV_CELLS[item.to]}`) }));
  const visibleCells = bottomItems.filter(
    (i) => i.permission === undefined || hasPermission(activeRole, i.permission),
  );
  const moreActive = !visibleCells.some((i) =>
    i.to === '/portal' ? pathname === '/portal' : isPathUnder(pathname, i.to),
  );
  const schoolName = useActiveSchoolName();
  const attention = useAttentionCenter({ todoTo: '/portal/notifications' });

  return (
    <AppHelpProvider>
      <DemoCornerFrame>
        <RequireRole allow={GUARDIAN_ROLES} redirectTo="/dashboard">
          <AppShell
            reserveCorner={demo.enabled}
            navItems={navItems}
            brand={t('brand')}
            // Desktop-only, as in the staff shell: below `md` the phone row
            // (`mobileTitle` / `mobileActions`) carries these controls (D12).
            topBar={
              <div className="hidden md:flex">
                <AppHeader
                  reserveCorner={demo.enabled}
                  start={<TenantBar />}
                  end={
                    <>
                      <SyncStatusIndicator />
                      <CommandPaletteLauncher pages={portalPages} />
                      <NotificationBell
                        viewAllTo="/portal/notifications"
                        attention={attention.bell}
                      />
                      <LocaleSwitcher />
                      <HelpHint helpId="start.language.action.switch" />
                      <ThemeToggle />
                      <StaffUserMenu securityTo="/portal/account" invites={schoolInvites} />
                    </>
                  }
                />
              </div>
            }
            openMenuLabel={t('openMenuLabel')}
            closeMenuLabel={t('closeMenuLabel')}
            navLabel={t('navLabel')}
            skipLinkLabel={t('skipToContent')}
            // [19.11.1] Seven destinations overflow `BottomNav`'s 5-cell cap at
            // 320px (WCAG 1.4.10), so the bar keeps the four a parent opens most
            // plus `more`, which opens the drawer holding the full list — the
            // staff shell's pattern. `mobileTitle` / `mobileActions` give the one
            // 56 px phone row (D12).
            mobileTitle={schoolName}
            mobileActions={
              <>
                <CommandPaletteLauncher pages={portalPages} />
                <NotificationBell viewAllTo="/portal/notifications" attention={attention.bell} />
                <StaffUserMenu securityTo="/portal/account" invites={schoolInvites} />
              </>
            }
            bottomNav={
              <BottomNav
                items={bottomItems}
                label={t('bottomNavLabel')}
                more={{
                  label: t('items.more'),
                  icon: <MORE_ICON className="size-5" aria-hidden="true" />,
                  active: moreActive,
                }}
              />
            }
          >
            {attention.bar}
            {attention.modal}
            {breadcrumbItems.length > 0 && (
              <Breadcrumbs
                items={breadcrumbItems}
                aria-label={t('breadcrumb.navLabel')}
                className="mb-4"
              />
            )}
            <SchoolInvitesCard {...schoolInvites.cardProps} />
            <Outlet />
          </AppShell>
        </RequireRole>
      </DemoCornerFrame>
    </AppHelpProvider>
  );
}
