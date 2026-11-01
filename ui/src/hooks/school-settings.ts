import type {
  ApplicationsSettings,
  BackupScheduleMode,
  AttentionSettings,
  DashboardSettings,
  DocumentsSettings,
  EvaluationsSettings,
  HomeworkSettings,
  InvitationStatus,
  StudyPlansSettings,
} from '@biddaloy/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/**
 * [14.12.3/#617] Intersected with `& { backup?: BackupSettings }` —
 * `schema.d.ts` hasn't been regenerated against the server's
 * `TenantSettingsDto.backup` field yet (see `BackupSettings`'s own
 * comment below for the fuller gap), but `useUpdateSchoolSettings`'s PATCH
 * body needs to be able to carry `{ version: 1, backup: {...} }` like
 * every other section's own slice.
 */
export type TenantSettingsInput = components['schemas']['TenantSettingsDto'] & {
  backup?: BackupSettings;
  fees?: FeesSettingsInput;
  /** [TIME-11] Until `schema.d.ts` is regenerated against `HomeworkSettingsDto`. */
  homework?: HomeworkSettings;
};
/** A plain connection test: never `sendTo`, so it can never send a message. */
export type TestConnectionInput = Omit<components['schemas']['TestConnectionDto'], 'sendTo'>;
/** A real test message to `sendTo` (see `useSendTestMessage`). */
export type SendTestMessageInput = TestConnectionInput & { sendTo: string };
export type TestableMedium = TestConnectionInput['medium'];

/** `slug`/`status`/`created_at` (#533) aren't in `schema.d.ts` yet —
 * `SchoolListItemDto` grew them server-side in the same change (see
 * `server/src/modules/schools/dto/school-list-item.dto.ts`), but this repo
 * regenerates `schema.d.ts` at integration time, not per-lane. Hand-typed
 * here against that DTO's actual shape, same gap `PaginatedStudents`
 * documents elsewhere in this file's sibling hooks. */
export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
  /** [13.3.4] Trial fields — `SchoolListItemDto`. `trial_ends_at` null = no trial. */
  country_code: string | null;
  trial_ends_at: string | null;
  seat_limit: number | null;
  status_reason: string | null;
}

/** Mirrors `server/src/modules/schools/settings/settings-mask.util.ts`'s
 * `MaskedSecret` — not generated into `schema.d.ts` (the settings GET/PATCH
 * responses aren't typed server-side, see `PaginatedStudents`'s own comment
 * on the same gap for `/students`), so hand-typed here against the API's
 * actual documented behavior instead. `configured: false` and the key
 * being entirely absent both mean "nothing to show a hint for" — see
 * `settings-mask.util.ts`'s own comment on why those two states differ
 * (never configured vs. explicitly cleared) even though a caller mostly
 * treats them the same. */
export interface MaskedSecret {
  configured: boolean;
  hint?: string;
}

export type MaskedRegionSettings = NonNullable<TenantSettingsInput['region']>;

/** D6: one `communications.<medium>` block as the settings GET returns it:
 * `{ provider?, <company>: { <field>: value | MaskedSecret } }`. Which companies
 * and fields exist comes from `useMessagingProviders`, never from a type here. */
export type MaskedMessagingBlock = { provider?: string } & {
  [company: string]: unknown;
};

export interface MaskedCommunicationsSettings {
  sms?: MaskedMessagingBlock;
  whatsapp?: MaskedMessagingBlock;
  email?: MaskedMessagingBlock;
  messenger?: MaskedMessagingBlock;
}

/** [9.10] Not secret data, unlike `communications` above — the attendance
 * policy has no `Secret()`-decorated fields (`tenant-settings.dto.ts`'s
 * `AttendancePolicyDto`), so the GET response mirrors `TenantSettingsInput
 * ['attendance']` exactly rather than needing its own `Masked*` shape. */
export type AttendancePolicySettings = NonNullable<TenantSettingsInput['attendance']>;

/** [21.7.1] Not secret data either — `RoutineSettingsDto` has no
 * `Secret()`-decorated fields, same reasoning as `AttendancePolicySettings`
 * above. */
export type RoutineSettingsInput = NonNullable<TenantSettingsInput['routine']>;

/** [12.5] Not secret data either — `AuthSettingsDto` has no `Secret()`-decorated
 * fields, same reasoning as `AttendancePolicySettings` above. */
export type AuthSettings = NonNullable<TenantSettingsInput['auth']>;

/** [14.12.1/#615 D10] Not secret data — `BackupSettingsDto` has no
 * `Secret()`-decorated fields. Hand-typed against `BackupScheduleMode`
 * (`@biddaloy/shared`) rather than `TenantSettingsInput['backup']`:
 * `schema.d.ts` hasn't been regenerated against the server's
 * `BackupSettingsDto` yet, same gap `SchoolSummary` documents elsewhere in
 * this file. */
export interface BackupSettings {
  schedule: BackupScheduleMode;
}

/** [16.7.6/#678] `late_fees` isn't in `schema.d.ts`'s `FeesSettingsDto` yet —
 * hand-typed against the plan comment's `#678` contract ahead of the
 * server work, same reconciliation-seam pattern `BackupSettings` above
 * documents: replace with the generated equivalent once #678 lands and
 * `schema.d.ts` regenerates. `approvalMode`/`notifyOn*DefaultDefault` are
 * already generated (`FeesSettingsDto`), so those are reused as-is rather
 * than re-hand-typed. */
export interface LateFeeSetting {
  enabled: boolean;
  /** 0-60 inclusive, per D11/#678. */
  grace_days: number;
  kind: 'PERCENT' | 'FLAT';
  /** 0-100 when `kind === 'PERCENT'`; unbounded (major-unit amount) when
   * `kind === 'FLAT'` — same asymmetry `discount-rules.ts`'s `DiscountRule
   * .value` has. */
  value: number;
}

export type FeesSettingsInput = components['schemas']['FeesSettingsDto'] & {
  /** Keyed by `FeeType` (`@biddaloy/shared`) enum value, e.g.
   * `MONTHLY_TUITION`. Not every `FeeType` needs an entry — an absent key
   * means late fees stay off for that fee type, same "off by default"
   * default D11 describes. */
  late_fees?: Record<string, LateFeeSetting>;
};

export type FeesSettings = NonNullable<TenantSettingsInput['fees']>;

/** [33.4.1] Not secret data — `OrganisationSettingsDto` has no
 * `Secret()`-decorated fields, same reasoning as `AttendancePolicySettings`
 * above. */
export type OrganisationSettings = NonNullable<TenantSettingsInput['organisation']>;

export interface MaskedTenantSettings {
  version: 1;
  region: MaskedRegionSettings;
  communications?: MaskedCommunicationsSettings;
  attendance?: AttendancePolicySettings;
  auth?: AuthSettings;
  backup?: BackupSettings;
  fees?: FeesSettings;
  /** [28.4.3] Not secret data. */
  evaluations?: EvaluationsSettings;
  /** [67.2.01] Not secret data. */
  attention?: AttentionSettings;
  /** [48.3.C-02] Not secret data. */
  documents?: DocumentsSettings;
  /** [52.5.7] Not secret data. */
  applications?: ApplicationsSettings;
  /** [TIME-11] Not secret data. */
  homework?: HomeworkSettings;
  organisation?: OrganisationSettings;
  /** [21.7.1] Not secret data, same reasoning as `attendance` above. */
  routine?: RoutineSettingsInput;
  /** [66.1.01] Not secret data. */
  studyPlans?: StudyPlansSettings;
  /** [8.10.7] Not secret data. */
  dashboard?: DashboardSettings;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  /** Present when `sendTo` was sent and the connection test passed: SENT, or FAILED if the gateway rejected it. */
  testMessage?: { logId: string; status: string };
}

export type MessagingProviderDescriptor = components['schemas']['ProviderDescriptorResponseDto'];
export type MessagingMediumProviders = components['schemas']['MessagingMediumProvidersResponseDto'];
export type MessagingProviders = components['schemas']['MessagingProvidersResponseDto'];

export const schoolsKeys = createEntityKeys('schools');
export const schoolSettingsKeys = createEntityKeys('school-settings');

/** `POST /schools` request/response shapes (#534's wizard, `#529`'s
 * `ProvisionSchoolDto`/response). Not in `schema.d.ts` yet — same
 * hand-typed-against-the-DTO gap `SchoolSummary` documents above, since
 * this repo regenerates `schema.d.ts` at integration time, not per-lane. */
export interface ProvisionSchoolAdminInput {
  name: string;
  email?: string;
  phone?: string;
}

export interface ProvisionSchoolInput {
  name: string;
  slug: string;
  admin: ProvisionSchoolAdminInput;
  idempotency_key: string;
}

export interface ProvisionSchoolResult {
  school: { id: string; slug: string; status: 'ACTIVE' | 'SUSPENDED' };
  admin: { user_id: string; existed: boolean };
  invitation: { id: string; status: string };
}

/** #8.7.13's super-admin school picker — `GET /schools` 401s for anyone
 * who isn't a SUPER_ADMIN (see `schools.controller.ts`), so callers should
 * pass `enabled: false` rather than firing this for an ADMIN, who has no
 * use for a picker anyway (they only ever configure their own school). */
export function useSchools(options: { enabled?: boolean; trial?: 'active' | 'expired' } = {}) {
  return useQuery({
    // Always under `lists()` so every mutation's `lists()` invalidation hits it.
    queryKey: options.trial ? schoolsKeys.list({ trial: options.trial }) : schoolsKeys.lists(),
    queryFn: async () =>
      (
        await apiClient.get<SchoolSummary[]>('/schools', {
          params: options.trial ? { trial: options.trial } : undefined,
        })
      ).data,
    enabled: options.enabled ?? true,
    retry: shouldRetryQuery,
  });
}

/** #534's create-school wizard. Non-optimistic — same reasoning as
 * `useUpdateSchoolSettings` above: a school that appears created but was
 * rejected would be worse than the pending spinner. `idempotency_key` is
 * the caller's job to generate once and reuse across retries (see
 * `new.tsx`'s `React.useState(() => crypto.randomUUID())`) — this hook
 * just forwards whatever it's given, so a retried `.mutate()` call with
 * the same key hits `ProvisioningService`'s Redis-backed no-op replay
 * instead of creating a second school. Invalidates the list query on
 * success so `/schools` reflects the new row without a manual refetch. */
export function useProvisionSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionSchoolInput) =>
      (await apiClient.post<ProvisionSchoolResult>('/schools', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
    },
  });
}

/** [8.14.5]: extracted for symmetry with `invoiceQueryOptions` — not
 * actually called from a route `loader`, since `schoolId` here comes from
 * `useSchools()` client-side (not a route param), so `_staff/settings.tsx`
 * cannot preload this data ahead of the loader running (see the plan's
 * "plan correction 5"). Kept as a factory anyway so `useSchoolSettings`
 * and any future loader-based caller share one `queryKey`/`queryFn`. */
export function schoolSettingsQueryOptions(schoolId: string) {
  return queryOptions({
    queryKey: schoolSettingsKeys.detail(schoolId),
    queryFn: async () =>
      (await apiClient.get<MaskedTenantSettings>(`/schools/${schoolId}/settings`)).data,
    // A SUPER_ADMIN's picker starts with no school selected, so `schoolId`
    // can be `''` before this hook has a real target — without this guard
    // that fires a GET against `/schools//settings`, a malformed URL, on
    // every mount.
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

export function useSchoolSettings(schoolId: string) {
  return useQuery(schoolSettingsQueryOptions(schoolId));
}

/**
 * Non-optimistic by design — #8.7.13's own acceptance criteria: "a config
 * that appears saved but was rejected would silently break every message
 * the school sends." No `onMutate`, no cache write before the server
 * responds; `isPending` is the only signal a caller has during the
 * request, same shape as `payments.ts`'s `useCreatePayment` (that file's
 * own comment is the fuller writeup of why this shape matters for a
 * mutation with real consequences if the UI gets ahead of the server).
 */
export function useUpdateSchoolSettings(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TenantSettingsInput) =>
      (await apiClient.patch<MaskedTenantSettings>(`/schools/${schoolId}/settings`, input)).data,
    onSuccess: (settings) => {
      queryClient.setQueryData(schoolSettingsKeys.detail(schoolId), settings);
      // `configured` / `selected` come from the saved settings.
      void queryClient.invalidateQueries({ queryKey: messagingProvidersKey(schoolId) });
    },
  });
}

const messagingProvidersKey = (schoolId: string) =>
  ['school-settings', 'messaging-providers', schoolId] as const;

/** Per medium: the companies and their fields, the selected one, and whether it is set up. */
export function useMessagingProviders(schoolId: string) {
  return useQuery({
    queryKey: messagingProvidersKey(schoolId),
    queryFn: async () =>
      (await apiClient.get<MessagingProviders>(`/schools/${schoolId}/settings/messaging/providers`))
        .data,
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

/** Doesn't touch the settings cache — a connection test changes nothing
 * persisted, whether it passes or fails. It sends no message, so "could not
 * confirm" would be wrong: it opts out of that toast. */
export function useTestSchoolConnection(schoolId: string) {
  return useMutation({
    mutationFn: async (input: TestConnectionInput) =>
      (await apiClient.post<ConnectionTestResult>(`/schools/${schoolId}/settings/test`, input))
        .data,
    meta: { handlesUnknownOutcome: true },
  });
}

/** "Send a test message": a real (paid) send. One Idempotency-Key per attempt (Rule 25): a retry
 * after a lost reply, or a reload, replays instead of sending again; a reply rotates it, so the
 * next click is a new send. Keeps the app's "could not confirm" toast for a lost reply. */
export function useSendTestMessage(schoolId: string) {
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: async (input: SendTestMessageInput) =>
      (
        await apiClient.post<ConnectionTestResult>(`/schools/${schoolId}/settings/test`, input, {
          headers: { 'Idempotency-Key': keyFor(input) },
        })
      ).data,
    onSuccess: rotate,
  });
}

/** #535's school detail page. `GET /schools/:id/stats` (#532) — five cheap
 * platform metrics, hand-typed against `SchoolStats`
 * (`server/src/modules/schools/schools.service.ts`) since it's not in
 * `schema.d.ts` yet, same gap `SchoolSummary` documents above.
 * `last_activity_at` travels as an ISO string over the wire even though
 * the server type is `Date | null` — same as every other timestamp this
 * file's siblings (`students.ts` etc.) leave as a string for the caller
 * to `new Date()` only where it's actually rendered. */
export interface SchoolStats {
  active_users: number;
  students: number;
  communications_queued: number;
  communications_failed_7d: number;
  last_activity_at: string | null;
}

const schoolStatsKeys = createEntityKeys<never, string>('school-stats');

export function schoolStatsQueryOptions(schoolId: string) {
  return queryOptions({
    queryKey: schoolStatsKeys.detail(schoolId),
    queryFn: async () => (await apiClient.get<SchoolStats>(`/schools/${schoolId}/stats`)).data,
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

export function useSchoolStats(schoolId: string) {
  return useQuery(schoolStatsQueryOptions(schoolId));
}

/** `PATCH /schools/:id/status` (#530) response — mirrors
 * `SchoolStatusResponse` (`schools.service.ts`), hand-typed for the same
 * not-yet-generated reason as `SchoolStats` above. */
export interface SchoolStatusResult {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  status_reason: string;
  status_changed_at: string;
}

export interface UpdateSchoolStatusInput {
  status: 'ACTIVE' | 'SUSPENDED';
  reason: string;
}

/** Optimistic-free: `DetailShell`'s confirm dialog only closes on success
 * (see `-status-action-dialog.tsx`), so there's no window where the UI
 * shows a status the server hasn't actually committed. Refetches the
 * detail-page queries that embed status (`schoolsKeys.detail`, the list)
 * on success instead of writing the cache by hand — same
 * invalidate-after-mutate shape `useProvisionSchool` above uses. */
export function useUpdateSchoolStatus(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSchoolStatusInput) =>
      (await apiClient.patch<SchoolStatusResult>(`/schools/${schoolId}/status`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: schoolsKeys.detail(schoolId) });
    },
  });
}

/** `GET /schools/:id/admins` (#531) list item — mirrors
 * `SchoolAdminListItem` (`school-admins.service.ts`), same hand-typed gap. */
export interface SchoolAdminListItem {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  membership_status: string;
  invitation: { id: string; status: InvitationStatus; expires_at: string } | null;
}

export const schoolAdminsKeys = createEntityKeys('school-admins');

export function schoolAdminsQueryOptions(schoolId: string) {
  return queryOptions({
    queryKey: schoolAdminsKeys.list({ schoolId }),
    queryFn: async () =>
      (await apiClient.get<SchoolAdminListItem[]>(`/schools/${schoolId}/admins`)).data,
    enabled: Boolean(schoolId),
    retry: shouldRetryQuery,
  });
}

export function useSchoolAdmins(schoolId: string) {
  return useQuery(schoolAdminsQueryOptions(schoolId));
}

export interface AddSchoolAdminInput {
  name: string;
  email?: string;
  phone?: string;
}

/** `POST /schools/:id/admins` (#531) — reuses the same find-or-create-user
 * path `POST /schools`'s own admin step does. Invalidates the admins list
 * on success, same pattern `useProvisionSchool` uses for the schools list. */
export function useAddSchoolAdmin(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddSchoolAdminInput) =>
      (await apiClient.post<SchoolAdminListItem>(`/schools/${schoolId}/admins`, input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}

/** `POST /schools/:id/admins/:userId/resend-invitation` (#531) — 204, no
 * body, same shape as `users.ts`'s own `useResendInvitation` for a staff
 * member's invitation. */
export function useResendSchoolAdminInvitation(schoolId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post<void>(`/schools/${schoolId}/admins/${userId}/resend-invitation`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}

/** `DELETE /schools/:id/admins/:userId/invitation` (#531) — 204, no body. */
export function useRevokeSchoolAdminInvitation(schoolId: string, userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/schools/${schoolId}/admins/${userId}/invitation`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: schoolAdminsKeys.list({ schoolId }) });
    },
  });
}
