import { isGuardianRole, isStaffRole } from '@biddaloy/shared';
import { ensureSessionLoaded, getActiveRole, getActiveTenant } from '@biddaloy/ui/api';
import {
  APP_SHELL_MAIN_ID,
  EmptyState,
  RouteAnnouncer,
  RouteProgress,
} from '@biddaloy/ui/components';
import { useRouteFocus } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

/**
 * `queryClient` in router context is what lets a route's `loader` call
 * `context.queryClient.ensureQueryData(...)` — the mechanism behind
 * [8.9.1]'s "hovering a sidebar link prefetches the route **and** data"
 * AC (see `main.tsx`'s `createRouter({ context: { queryClient } })`).
 */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * D8 (epic #409): every route the guard below must let an unauthenticated
 * visitor reach, whether or not they end up signed in by the time it's
 * done — `/login` (already here), since 12.2 `/activate?token=…`, and
 * since 12.4 `/forgot-password` and `/reset-password?token=…`. A `Set`,
 * not a couple of `!==` checks, so a future public route is one line to
 * add rather than three call sites to remember.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/activate',
  '/forgot-password',
  '/reset-password',
  // [12.7] The emailed contact-change confirm link is clicked from the
  // inbox, possibly logged out.
  '/verify-email',
  // [13.6.1] Sign-up and the social sign-in landing are reached signed out.
  '/register',
  '/auth/social/done',
]);

/**
 * [16.5.5] Prefix match, not exact — `PUBLIC_PATHS` above is a `Set` of
 * whole pathnames because every entry there is a single fixed route.
 * `/i/<token>` is a family of routes, one per share token, so an
 * exact-match `Set` entry can never cover it. Checked *before*
 * `ensureSessionLoaded()` runs in `beforeLoad` below, not just before the
 * redirect: a guardian opening this link cold has no session at all, and
 * the AC explicitly says "no auth calls" — `ensureSessionLoaded()` would
 * still fire a cold-boot `POST /auth/refresh`
 * (`ui/src/api/session.ts:196-200`) for nothing before this guard ever
 * got to redirect-or-not.
 *
 * [27.8] `/admission/` added the same way: `/admission/<slug>` and
 * `/admission/<slug>/status` are a family of public routes, one per
 * school, with no session and no auth call — same shape as `/i/<token>`.
 *
 * [32.3.9] `/v/` added the same way: `/v/<token>` is the page a printed ID
 * card's QR code opens, so a phone reading it has no session either.
 *
 * [53.6.01] `/n/` added the same way: `/n/<token>` is the public notice link.
 */
const PUBLIC_PATH_PREFIXES = ['/i/', '/admission/', '/v/', '/n/'];

export const Route = createRootRouteWithContext<RouterContext>()({
  // Protected-route guard, runs before every route in the tree including
  // `/login` itself — `pathname !== '/login'` below stops that case from
  // redirecting to itself forever. `ensureSessionLoaded()` waits for a
  // silent-refresh attempt against the httpOnly refresh cookie on the
  // first cold-load navigation, then short-circuits instantly once an
  // access token is set. `location.href` here is router-relative
  // (`pathname + search + hash`, never the origin), so handing it to
  // `/login`'s `redirect` search param has no absolute-URL open-redirect
  // surface.
  beforeLoad: async ({ location }) => {
    if (PUBLIC_PATH_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))) return;
    const authenticated = await ensureSessionLoaded();
    if (!authenticated && !PUBLIC_PATHS.has(location.pathname)) {
      // TanStack Router's own documented pattern: `redirect()` returns a
      // plain sentinel object (not an `Error` instance) that the router's
      // navigation machinery specifically catches — throwing anything else
      // here wouldn't redirect at all.

      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    // Tenant *and* a role the audience split actually knows about: a
    // membership is the pair ([8.9.11]), and [8.9.10]'s route tree splits on
    // the role. A visitor with a tenant but no role, or a role neither
    // `_staff.tsx` nor `portal.tsx` accepts (e.g. an unsupported role like
    // HEADMASTER), would reach `/`, get redirected by audience, and be
    // bounced back by that layout's own guard — an infinite ping-pong
    // between `/dashboard` and `/portal`. Treating it as unresolved sends
    // them to the picker instead, which is the one screen that can actually
    // resolve it.
    const activeRole = getActiveRole();
    const hasActiveTenant =
      !!getActiveTenant() && (isGuardianRole(activeRole) || isStaffRole(activeRole));

    // [8.9.5]: authenticated but no active tenant chosen yet — either a
    // fresh login with 2+ memberships (`ui/src/hooks/auth.ts`'s `login()`
    // deliberately leaves this unset in that case) or a reload whose
    // persisted tenant didn't restore (`session.ts`'s `restoreActiveTenant`).
    // `select-school.tsx` itself decides what to do with zero memberships;
    // this guard's only job is getting an unresolved visitor there.
    if (
      authenticated &&
      !hasActiveTenant &&
      !PUBLIC_PATHS.has(location.pathname) &&
      location.pathname !== '/select-school'
    ) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/select-school', search: { redirect: location.href } });
    }

    // The mirror image of the redirect above: a visitor who already has an
    // active tenant has nothing left to resolve on the picker.
    // `select-school.tsx`'s `handleSelect` switches tenants with no
    // confirmation dialog (it exists to *pick a first* tenant, not to
    // switch one) — without this, the route stays reachable by direct URL
    // and lets an already-resolved visitor bypass `TenantBar`'s
    // confirm-before-switch flow entirely.
    if (authenticated && hasActiveTenant && location.pathname === '/select-school') {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/' });
    }
  },
  // Shown only if the bootstrap attempt takes a while (Router's own
  // default `pendingMs` threshold) — a blank screen on a slow cold load
  // would otherwise look broken rather than loading.
  pendingComponent: RootPending,
  component: RootLayout,
  // Chrome-free since [8.9.10] moved `AppShell` into the audience layouts:
  // an unmatched URL is exactly the case where we can't say which shell the
  // visitor belongs in, so it renders on its own and offers `/`, which
  // redirects by role.
  notFoundComponent: NotFoundPage,
});

/**
 * Chrome-free by design as of [8.9.10]: the root route owns the auth/tenant
 * guard, the route announcer and the devtools, and nothing else. The shells
 * live one level down — `_staff.tsx` for staff, `portal.tsx` for guardians —
 * because "which chrome" is an audience question, and the root route is the
 * one place that serves every audience plus `/login` and `/select-school`,
 * which have no chrome at all. That replaces the `pathname === '/login' ||
 * pathname === '/select-school'` special case this component used to carry.
 */
function RootLayout() {
  const { t } = useTranslation('nav');
  // [8.9.7]: every route gets focus management/title/announcement, not just
  // the ones inside `AppShell` — which is why this lives here rather than in
  // each shell. `SignInForm`/`SchoolPicker` (the `/login`/`/select-school`
  // routes' own content) already carry their own top-level `<h1>`, which is
  // what `useRouteFocus` falls back to finding via `document` when
  // `APP_SHELL_MAIN_ID` isn't in the DOM.
  const announcement = useRouteFocus({ mainId: APP_SHELL_MAIN_ID, appName: t('brand') });

  // [8.14.5]: `state.isLoading`, not `state.status` or `state.isTransitioning`
  // (see the plan's "plan correction 3") — `isLoading` is the flag that's
  // true for the whole window a navigation's loader/pending UI is in
  // flight, which is what a top-of-viewport progress bar should track.
  // `useRouterState`'s `select` keeps this subscription scoped to that one
  // boolean, so `RootLayout` doesn't re-render on every unrelated router
  // state change.
  const isNavigating = useRouterState({ select: (state) => state.isLoading });

  return (
    <>
      <RouteProgress active={isNavigating} label={t('routeProgress.label')} />
      <RouteAnnouncer message={announcement} />
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </>
  );
}

function RootPending() {
  const { t } = useTranslation('common');

  // Explicit `{ ns: 'common' }` (a string literal, not the `COMMON_NAMESPACE`
  // constant — see `check-i18n-keys.mjs`'s own "known blind spots" comment,
  // its `ns:` extraction only matches a quoted literal) rather than relying
  // on the `useTranslation('common')` above: the checker's namespace
  // resolution picks the *first* `useTranslation()` call in the whole file,
  // not per-function scope — this file's other functions call
  // `useTranslation('nav')`, which would otherwise misattribute this key.
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{t('status.loading', { ns: 'common' })}</p>
    </div>
  );
}

function NotFoundPage() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();

  return (
    <EmptyState
      headingLevel={1}
      title={t('notFound.title')}
      explanation={t('notFound.explanation')}
      action={{ label: t('notFound.action'), onClick: () => void navigate({ to: '/' }) }}
    />
  );
}
