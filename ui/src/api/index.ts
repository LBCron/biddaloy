/**
 * Generated OpenAPI types and the shared axios client.
 */
export { apiClient, API_BASE_URL } from './client';
export {
  fetchPublicVerification,
  getPublicInvoice,
  postAuthActivate,
  postAuthActivateResend,
  postAuthActivateVerify,
  postAuthForgotPassword,
  postAuthLogout,
  postAuthResetPassword,
  postAuthVerifyEmail,
  type ActivateVerifyResponse,
  type ForgotPasswordResponse,
  type OtpRequestResponse,
  type PublicInvoiceReceipt,
  type PublicVerification,
  type VerifyEmailResponse,
} from './client';
export {
  ApiError,
  NoActiveTenantError,
  NoMembershipsError,
  isNotFoundError,
  isTenantRestoringError,
  isTenantSuspendedError,
  RateLimitedError,
  type ApiErrorBody,
} from './errors';
export { createAppQueryClient, isUnknownOutcomeError } from './query-client';
export {
  clearAuthState,
  getAccessToken,
  getActiveRole,
  getActiveTenant,
  registerSessionExpiredHandler,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
  subscribeAuthState,
} from './auth-state';
export {
  clearFirstPasswordGate,
  getFirstPasswordGate,
  requireFirstPassword,
} from './first-password-gate';
export { clearApiCache } from './sw-cache';
// [8.12.3]'s offline read cache. Only the pieces a consuming app or a
// query hook actually needs are re-exported here — the database handle,
// the row reader/writer and the purges stay internal to `ui/src/api`,
// because every legitimate use of them goes through `offlineCachedQueryFn`
// or the two `auth-state.ts` funnels. See `offline-db.ts` for the design.
export { type CacheableEntity } from './offline-db';
export { offlineCachedQueryFn, REF_CACHE_TTL_MS } from './offline-cache';

// [8.12.4]'s mutation queue. Same policy as the read cache above: the
// Dexie table stays private, and only the operations a consuming app or
// a sync indicator legitimately needs are re-exported.
export {
  discardMutation,
  enqueueMutation,
  ForbiddenQueueMutationError,
  getQueueSnapshot,
  MAX_REPLAY_ATTEMPTS,
  QueueUnavailableError,
  replayQueue,
  retryMutation,
  startQueueReplay,
  stopQueueReplay,
  subscribeQueueChanges,
  type EnqueueMutationInput,
  type QueueSnapshot,
} from './mutation-queue';
export type {
  QueueableEntity,
  QueuedMutationMethod,
  QueuedMutationRow,
  QueuedMutationStatus,
} from './offline-db';
export {
  clearFreshness,
  getFreshness,
  recordFreshness,
  subscribeFreshness,
  type FreshnessSource,
  type QueryFreshness,
} from './freshness';
export { clearAllFormDrafts, formDraftKey, FORM_DRAFT_KEY_PREFIX } from './form-draft-storage';
export {
  clearListSelectionMemory,
  listSelectionKey,
  setSelection as setListSelection,
} from './list-selection-memory';
export {
  decodeAccessTokenMemberships,
  ensureSessionLoaded,
  resetSessionBootstrap,
  scheduleTokenRefresh,
} from './session';
export {
  clearNotifications,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
  subscribeNotificationState,
  type NotificationRecord,
  type NotificationVariant,
} from './notification-state';
export {
  captureNotificationTenant,
  notifyOutcome,
  notifyOutcomeFromCommon,
  type NotifyOutcomeInput,
  type NotifyOutcomeFromCommonInput,
} from './notify';
export {
  captureRouteError,
  initSentry,
  updateSentryRouteTag,
  updateSentryTenantTag,
  type InitSentryOptions,
} from './sentry';
export type { paths, components, operations } from './schema';
