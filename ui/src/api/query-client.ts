import {
  type Mutation,
  MutationCache,
  notifyManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import axios from 'axios';

import { toast } from '../components/toast';
import { shouldRetryQuery } from '../hooks/retry';
import { i18n, COMMON_NAMESPACE } from '../i18n';

import { ApiError, isTenantRestoringError, isTenantSuspendedError } from './errors';
import { isNoResponseNetworkError } from './offline-cache';

/**
 * Shows a permission-denied toast for any mutation that fails with a 403,
 * app-wide. Reads are deliberately silent: a page whose own data 403s shows
 * its ErrorState / AccessDeniedState, and a background read a role may not
 * make is a bug to gate at the call site, not a toast. See `ui/README.md`'s "The app's query client" section
 * for why 401 needs no handling here. `i18n.t()` directly, not
 * `useTranslation()`, since this runs outside any component's render.
 *
 * [15.4.2] A suspended tenant's 403 is the one exception: it is not a
 * permission problem with this request, it is the whole school being
 * paused, and `RouteErrorFallback` renders a full-page state for it (see
 * `throwOnError` below). A "permission denied" toast on top of that page
 * would contradict it.
 *
 * A mutation whose own `onError` explains its 403s (the attendance month
 * save's "only someone who can correct attendance" dialog) opts out with
 * `meta: { handlesForbidden: true }`, so the user does not get both.
 * [2698] A mutation whose form explains its own 5xx / lost reply, or that writes nothing
 * (a connection test), opts out of the "could not confirm" toast with
 * `meta: { handlesUnknownOutcome: true }`. A form whose error only says "Couldn't save.
 * Try again." does not qualify: on a write that may have committed, that invites a duplicate.
 */
function handleMutationError(
  error: unknown,
  _variables: unknown,
  _onMutateResult: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
): void {
  // [68.1.2219] A restore freeze (423) is not a permission problem; say so.
  if (isTenantRestoringError(error)) {
    toast.error(i18n.t('errors.schoolRestoring', { ns: COMMON_NAMESPACE }));
    return;
  }
  // [58.2.07] The demo school refuses some writes with a plain-words code. A mutation that
  // explains its own 403s (`handlesForbidden`) keeps doing so for DEMO_DISABLED; the 413 upload
  // cap is not a 403, so it always gets the toast.
  const code = error instanceof ApiError ? error.details?.code : undefined;
  const forbiddenHandled = mutation.meta?.handlesForbidden === true;
  // [88.4] A bulk request (file, picked students, ids) over the demo's 100-row cap is refused whole (422): say how many it had.
  if (code === 'DEMO_ROW_LIMIT') {
    const raw = error instanceof ApiError ? error.details?.count : undefined;
    const count = typeof raw === 'number' ? raw : 0;
    void i18n.loadNamespaces('errors').then(() => {
      toast.error(i18n.t('demoRowLimit', { ns: 'errors', count }));
    });
    return;
  }
  if (code === 'DEMO_UPLOAD_LIMIT' || (code === 'DEMO_DISABLED' && !forbiddenHandled)) {
    void i18n.loadNamespaces('demo').then(() => {
      toast.error(
        code === 'DEMO_DISABLED'
          ? i18n.t('errors.DEMO_DISABLED', { ns: 'demo' })
          : i18n.t('errors.DEMO_UPLOAD_LIMIT', { ns: 'demo' }),
      );
    });
    return;
  }
  if (forbiddenHandled) return;
  if (error instanceof ApiError && error.statusCode === 403 && !isTenantSuspendedError(error)) {
    toast.error(i18n.t('errors.permissionDenied', { ns: COMMON_NAMESPACE }));
    return;
  }
  if (mutation.meta?.handlesUnknownOutcome === true) return;
  if (isUnknownOutcomeError(error)) {
    toast.error(i18n.t('outcomeUnknown', { ns: COMMON_NAMESPACE }));
  }
}

/**
 * [2596] A 5xx or a lost reply: the write may have been saved. Say so, since we do not retry.
 * A gateway 502/504 from nginx or Cloudflare has an HTML body, so it stays a raw AxiosError.
 */
export function isUnknownOutcomeError(error: unknown): boolean {
  const status =
    error instanceof ApiError
      ? error.statusCode
      : axios.isAxiosError(error)
        ? (error.response?.status ?? 0)
        : 0;
  return status >= 500 || isNoResponseNetworkError(error);
}

/**
 * The one `QueryClient` every real app entry point should construct —
 * `client-admin`'s `main.tsx` is the reference caller. Tuned for
 * cache-first rendering with background revalidation; see `ui/README.md`'s
 * "The app's query client" section for what each option does and how it
 * compares to `createTestQueryClient()` (`ui/src/test/
 * render-with-providers.tsx`), the deliberately different client tests use.
 */
export function createAppQueryClient(): QueryClient {
  // [2594] `isPending` otherwise reaches React through `setTimeout(0)`, after a fast second
  // click has already fired; a microtask lands before the next click event (D4).
  notifyManager.setScheduler(queueMicrotask);
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        // [8.12.6]: `offlineFirst`, not TanStack Query's default
        // `online`. Under `online`, a query with no cached data does not
        // run at all while `navigator.onLine` is false — it goes to
        // `paused` and its promise never settles. For a route whose
        // `loader` awaits `ensureQueryData`, that means an offline
        // navigation hangs on the previous screen forever: no data, no
        // error, no offline state, nothing to retry.
        //
        // It also made the whole offline read path unreachable in exactly
        // the case it was built for. Both fallbacks live *inside* the
        // query function — the service worker's `api-cache`
        // (`client-admin/src/sw.ts`) and the Dexie read cache
        // (`offlineCachedQueryFn`) — and a paused query never calls its
        // query function, so neither could ever answer.
        //
        // `offlineFirst` lets the fetch run once regardless of what the
        // browser believes about connectivity; the SW answers from cache
        // if it can, and `offlineCachedQueryFn` falls back to Dexie if it
        // cannot. A genuine failure then surfaces as an error the route
        // boundary renders as the offline state. `shouldRetryQuery`
        // already declines to retry while offline, so this costs one
        // attempt, not a retry storm.
        networkMode: 'offlineFirst',
        // [15.4.2] A suspended school's 403 is rethrown from `useQuery`
        // into the nearest route error boundary, where `RouteErrorFallback`
        // renders its suspended fork. Every page has its own idea of what
        // an inline query error looks like ("Could not load settings" and
        // the like), and none of them can say "your school is paused" —
        // this is the one place that turns a per-query failure into the
        // app-wide state the server is actually reporting.
        throwOnError: isTenantSuspendedError,
      },
      mutations: {
        // [2596] Never re-send a write on its own: if the server committed but the reply was
        // lost (a 502/504, a dropped connection), a retry creates the record again.
        // `mutation-retry.guard.spec.ts` fails on any mutation `retry` other than `false`.
        retry: false,
      },
    },
    queryCache: new QueryCache(),
    mutationCache: new MutationCache({ onError: handleMutationError }),
  });
}
