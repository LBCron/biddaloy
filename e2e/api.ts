// [8.5.3] Thin API helper for specs that need seeded-on-the-fly data —
// a fresh access token via the refresh cookie already in the test's
// request context, then tenant-scoped calls with the same headers the
// SPA sends (Bearer + X-Tenant-ID).
import {
  ALERT_RULES,
  ExamComponentKind,
  ExamComponentSource,
  ExamKind,
  type AlertRuleKey,
} from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';

import type {
  AcrResponse,
  CreateAcrBody,
  CreateIncidentBody,
  CreateSurveyBody,
  IncidentResponse,
  SaveAcrCriteriaBody,
  SurveyResponse,
} from './fixtures/evaluations';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from './seed-contract';

interface RefreshResponse {
  access_token: string;
  memberships: { tenantId: string; role: string; name: string }[];
}

export interface ApiSession {
  token: string;
  tenantId: string;
}

/** Fresh admin login independent of the test's own storage state — for
 * seeding data while the browser runs as a less-privileged role. Its own
 * token family, so it never trips refresh-rotation reuse detection. */
export async function adminApiSession(request: APIRequestContext): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS.admin, password },
  });
  if (!response.ok()) {
    throw new Error(`admin login failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === 'ADMIN');
  if (!membership) throw new Error('no ADMIN membership for seed admin');
  return { token: body.access_token, tenantId: membership.tenantId };
}

/** Same shape as `adminApiSession`, for the SUPER_ADMIN platform console
 * (`e2e/platform/provision-and-suspend.spec.ts`, #536). The seeded
 * super_admin account has an ordinary ADMIN-tier membership on Default
 * School too (`seed.util.ts`'s `ROLE_TEST_USERS`) — `ContextGuard`
 * requires *some* `X-Tenant-ID` even for a platform route
 * (`/schools*`), but never applies that tenant's own suspension check to
 * a SUPER_ADMIN-active request (see `ContextGuard`'s own comment), so
 * this tenant choice has no bearing on which school the calls below
 * actually manage. */
export async function superAdminApiSession(request: APIRequestContext): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS.super_admin, password },
  });
  if (!response.ok()) {
    throw new Error(`super_admin login failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === 'SUPER_ADMIN');
  if (!membership) throw new Error('no SUPER_ADMIN membership for seed super_admin');
  return { token: body.access_token, tenantId: membership.tenantId };
}

/** Same shape as `adminApiSession`, but for the seeded PARENT account —
 * a fresh login independent of whatever role the test's own browser
 * `storageState` is on. [38.5.1]'s `journeys/fines.spec.ts` uses this to
 * fetch the seeded parent's real `Guardian` id (`GET /guardians/mine`)
 * from inside a test whose *browser* is signed in as accountant/admin, so
 * the fine-bearing student it creates can be linked to a guardian that
 * can actually log into the portal — `createGuardian` alone makes a
 * `Guardian` row with no login. */
export async function parentApiSession(request: APIRequestContext): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS.parent, password },
  });
  if (!response.ok()) {
    throw new Error(`parent login failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === 'PARENT');
  if (!membership) throw new Error('no PARENT membership for seed parent');
  return { token: body.access_token, tenantId: membership.tenantId };
}

export async function apiSession(request: APIRequestContext, role: string): Promise<ApiSession> {
  const response = await request.post('/api/v1/auth/refresh');
  if (!response.ok()) {
    throw new Error(`refresh failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === role.toUpperCase());
  if (!membership) throw new Error(`no ${role} membership on this session`);
  return { token: body.access_token, tenantId: membership.tenantId };
}

export async function post<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  data: object,
): Promise<T> {
  const response = await request.post(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`POST ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** `POST <path>` with a `multipart/form-data` body — for endpoints behind
 * `@UseInterceptors(FileInterceptor(...))`, like `/calendar-import/validate`
 * (17.3.6). `post` above always sends JSON, which Nest's multer
 * interceptor never sees as `file`. */
export async function postMultipart<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<T> {
  const response = await request.post(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
    multipart: { file },
  });
  if (!response.ok()) {
    throw new Error(
      `POST ${path} (multipart) failed: ${response.status()} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** `PATCH <path>` — same shape as `post` above. `journeys/backup-restore.spec.ts`
 * (#614) uses this to rename its seeded student between two restores, so the
 * second restore's diff shows exactly one update. */
export async function patch<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await request.patch(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`PATCH ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Submits one section-subject mark sheet. #2246 refuses a sheet with blank
 * cells (409 GRID_INCOMPLETE); specs that only mark the student they care
 * about mark every blank the server reports as ABSENT (what a blank used to
 * count as), then submit. */
export async function submitMarkSheet(
  request: APIRequestContext,
  session: ApiSession,
  examId: string,
  body: { section_id: string; subject_id: string },
): Promise<void> {
  const headers = { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId };
  const url = `/api/v1/exams/${examId}/marks/submit`;
  let response = await request.post(url, { headers, data: body });
  if (response.status() === 409) {
    const { details } = (await response.json()) as {
      details?: { code?: string; blank?: { student_id: string; component_id: string }[] };
    };
    if (details?.code === 'GRID_INCOMPLETE' && details.blank) {
      await patch(request, session, `/exams/${examId}/marks`, {
        ...body,
        cells: details.blank.map((c) => ({ ...c, value: null, status: 'ABSENT' })),
      });
      response = await request.post(url, { headers, data: body });
    }
  }
  if (!response.ok()) {
    throw new Error(`POST ${url} failed: ${response.status()} ${await response.text()}`);
  }
}

/** `PUT <path>` — same shape as `post`/`patch` above. [38.5.1]'s
 * `markAbsentDaysInPreviousMonth` uses this for
 * `PUT /attendance/sections/:sectionId/register`, the one write endpoint
 * in this file that isn't POST or PATCH. */
export async function put<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await request.put(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`PUT ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** [9.11] `journeys/attendance.spec.ts`'s "server state" leg — asserts
 * through the API rather than re-reading the UI it just wrote, since a UI
 * that lies to itself would pass a UI-only assertion. */
export async function get<T>(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
): Promise<T> {
  const response = await request.get(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
  });
  if (!response.ok()) {
    throw new Error(`GET ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** `DELETE <path>` — for specs that clean up what they created (afterAll). */
export async function del(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
): Promise<void> {
  const response = await request.delete(`/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'X-Tenant-ID': session.tenantId,
    },
  });
  if (!response.ok()) {
    throw new Error(`DELETE ${path} failed: ${response.status()} ${await response.text()}`);
  }
}

/** [48] The demo school's seeded "First Term Exam" (`ensureSeatPlanDemoSeed`: a schedule and a
 * published seat plan) for seeded Class 6. `GET /exams` is newest first and capped at 100 rows,
 * and other specs create exams, so filter by the seeded class instead of hoping the oldest
 * exam is on page 1. */
export async function seededFirstTermExamId(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  const { classId } = await findSeedSectionA(request, session);
  const exams = await get<{ data: { id: string; name: string }[] }>(
    request,
    session,
    `/exams?class_id=${classId}&limit=100`,
  );
  const exam = exams.data.find((e) => e.name === 'First Term Exam');
  if (!exam) throw new Error('No seeded "First Term Exam" — has `yarn seed` run?');
  return exam.id;
}

/** Students require a real class section (`class_section_id` is a
 * mandatory UUID) — build the academic-year → class → section chain
 * once per call. Unique names keep this idempotent-enough for a shared
 * seeded database. */
export interface ClassSectionChain {
  academicYearId: string;
  classId: string;
  sectionId: string;
  className: string;
}

/** Inclusive `YYYY-MM-DD` bounds of a academic year. */
export interface AcademicYearBounds {
  start_date: string;
  end_date: string;
}

export async function createClassSection(
  request: APIRequestContext,
  session: ApiSession,
  academicYear: AcademicYearBounds & { id?: string } = {
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  },
): Promise<ClassSectionChain> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const className = `E2E ${suffix}`.slice(0, 50);
  // `id` reuses an existing year instead of creating one — needed when a spec
  // depends on a date-based year lookup (e.g. the fine sweep), which is
  // ambiguous while two years overlap.
  const year =
    academicYear.id !== undefined
      ? { id: academicYear.id }
      : await post<{ id: string }>(request, session, '/academic-years', {
          name: `E2E Year ${suffix}`,
          start_date: academicYear.start_date,
          end_date: academicYear.end_date,
        });
  const klass = await post<{ id: string }>(request, session, '/classes', {
    name: className,
    academic_year_id: year.id,
  });
  const section = await post<{ id: string }>(request, session, `/classes/${klass.id}/sections`, {
    section_name: 'A',
  });
  return { academicYearId: year.id, classId: klass.id, sectionId: section.id, className };
}

/** `createClassSection`'s fresh academic year has no grading scale, and
 * processing exam results 409s without one ("No grading scale found").
 * Gives the year a default scale with the seeded scale's bands. Copy is
 * not approval-gated (only `bands/confirm` is), so no step-up is needed. */
export async function ensureGradingScale(
  request: APIRequestContext,
  session: ApiSession,
  academicYearId: string,
): Promise<void> {
  const scales = await get<{ id: string; bands: unknown[] }[]>(request, session, '/grading/scales');
  const source = scales.find((scale) => scale.bands.length > 0);
  if (!source) throw new Error('No seeded grading scale with bands to copy');
  const scale = await post<{ id: string }>(request, session, '/grading/scales', {
    academic_year_id: academicYearId,
    name: `E2E Scale ${Date.now()}`,
  });
  await post(request, session, `/grading/scales/${scale.id}/copy`, { source_scale_id: source.id });
}

/** `POST /presets/apply` — applies a curriculum pack to a FRESH school
 * (ADMIN). Returns the created-row counts per table. */
export async function applyPreset(
  request: APIRequestContext,
  session: ApiSession,
  options: { presetId: string; startYear: number; stages: string[]; versions?: string[] },
): Promise<{ created: Record<string, number> }> {
  return post(request, session, '/presets/apply', {
    preset_id: options.presetId,
    start_year: options.startYear,
    stages: options.stages,
    ...(options.versions ? { versions: options.versions } : {}),
  });
}

/** `POST /platform/schools/:id/preset/reset` — SUPER_ADMIN only; `reason`
 * must be 10-500 chars. 409s while the school holds operational data. */
export async function resetPreset(
  request: APIRequestContext,
  superSession: ApiSession,
  schoolId: string,
  reason: string,
): Promise<{ deleted: Record<string, number> }> {
  return post(request, superSession, `/platform/schools/${schoolId}/preset/reset`, { reason });
}

/** `GET /presets/status` — `AVAILABLE` | `APPLIED` | `CUSTOM` (ADMIN). */
export async function presetState(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  return (await get<{ state: string }>(request, session, '/presets/status')).state;
}

/** `POST /exam-templates` (ADMIN) — an empty template; rows come from
 * `PATCH /exam-templates/:id` or, in the keyboard spec, the grid. */
export async function createExamTemplate(
  request: APIRequestContext,
  session: ApiSession,
  name: string,
  kind = 'TERM',
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/exam-templates', { name, kind });
}

export async function createGuardian(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  phone = '01712345678',
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/guardians', {
    full_name: fullName,
    relationship: 'Father',
    phone,
  });
}

/** A staff member (tenant user) for the /staff/$userId detail page —
 * `POST /users` creates the account plus the school membership in one
 * call and returns both. */
export async function createStaffUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  const created = await post<{ user: { id: string } }>(request, session, '/users', {
    full_name: fullName,
    email: `staff-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.example.com`,
    role: 'TEACHER',
    // CreateUserDto requires tenantId in the body even though the server
    // resolves the tenant from X-Tenant-ID — same as the add-user dialog.
    tenantId: session.tenantId,
  });
  return { id: created.user.id };
}

/** A staff member created passwordless, for `journeys/activation.spec.ts`
 * (12.2) — `POST /users` with no `password` issues an invite, and
 * `ACCOUNT_ACCESS_ECHO_SECRETS=true` (see `server/.env.example`, required
 * for this spec to run at all) puts the raw token in
 * `invitation.debug.token` so the spec can build the `/activate?token=…`
 * link without scraping the delivery provider's logs. */
export async function createInvitedStaffUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string; token: string }> {
  const created = await post<{ user: { id: string }; invitation: { debug?: { token: string } } }>(
    request,
    session,
    '/users',
    {
      full_name: fullName,
      email: `activate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.example.com`,
      role: 'TEACHER',
      tenantId: session.tenantId,
    },
  );
  const token = created.invitation.debug?.token;
  if (!token) {
    throw new Error(
      'No invitation.debug.token in the response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
    );
  }
  return { id: created.user.id, token };
}

/** A guardian user created passwordless with a unique phone, for
 * `journeys/password-recovery.spec.ts` (12.4) — same `POST /users` +
 * `ACCOUNT_ACCESS_ECHO_SECRETS` trick as `createInvitedStaffUser`, but
 * with `phone` instead of `email` (recovery via phone OTP needs a real
 * phone-identified account) and consumed straight through 12.2's
 * `/activate` flow so the account ends up with a real password before the
 * recovery spec ever touches it.
 *
 * `role` defaults to `PARENT`, but pass `STUDENT` for a spec that drives
 * `/portal/account`: both roles reach the portal (`GUARDIAN_ROLES`), but
 * that page hard-errors for a PARENT with no `guardians` row, because it
 * treats its `GET /guardians/mine` 404 as a page-level failure — and a
 * user minted here has no guardian row. A STUDENT never issues that
 * request (`account.tsx`'s `enabled: isParent`), so the page loads on
 * `GET /users/me` alone. */
export async function createInvitedParentUser(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  role: 'PARENT' | 'STUDENT' | 'TEACHER' = 'PARENT',
): Promise<{ id: string; phone: string; token: string }> {
  const phone = `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const created = await post<{ user: { id: string }; invitation: { debug?: { token: string } } }>(
    request,
    session,
    '/users',
    {
      full_name: fullName,
      phone,
      role,
      tenantId: session.tenantId,
    },
  );
  const token = created.invitation.debug?.token;
  if (!token) {
    throw new Error(
      'No invitation.debug.token in the response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
    );
  }
  return { id: created.user.id, phone, token };
}

/** A date the tenant will accept an attendance register for. Fridays are
 * the seeded tenant's default weekly off (`weeklyOffDays: [5]` in
 * `tenant-settings-defaults.ts`) — `PUT …/register` 422s and the UI
 * renders the roster read-only — so any spec that marks "today" goes red
 * every Friday. Falls back to Thursday (inside the default 2-day
 * correction window) rather than touching shared tenant settings.
 *
 * "Today" is the school's date (the default region timezone, Asia/Dhaka in
 * `tenant-settings-defaults.ts`), as the server decides it — not the
 * runner's clock. In UTC CI, 18:00–24:00 is already tomorrow in Dhaka, and
 * the seed's FINALIZED past registers would sit on the runner's "today". */
export function markableDateIso(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  if (d.getUTCDay() === 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The school is closed on Friday. Screens that read "today" from the
 * browser can see a Friday on either clock (the runner's or Dhaka's), so a
 * spec that needs a school day skips when it is Friday on EITHER. */
export function isFridayAnywhere(): boolean {
  const dhaka = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())}T00:00:00Z`,
  );
  return dhaka.getUTCDay() === 5 || new Date().getDay() === 5;
}

/** N students in one shared, freshly-created section — for pagination
 * specs that need more than a page's worth of rows without paying for a
 * class chain per student. */
export async function createStudentsInSection(
  request: APIRequestContext,
  session: ApiSession,
  namePrefix: string,
  count: number,
  academicYear?: AcademicYearBounds & { id?: string },
): Promise<ClassSectionChain> {
  const chain = await createClassSection(request, session, academicYear);
  for (let i = 1; i <= count; i += 1) {
    await post(request, session, '/students', {
      full_name: `${namePrefix} ${String(i).padStart(2, '0')}`,
      class_section_id: chain.sectionId,
    });
  }
  return chain;
}

/** A reminder batch for the /communications/batches/$batchId detail
 * page — a student with open dues and a linked guardian (so the batch
 * has at least one real recipient), then one bulk-reminder POST. */
export async function createReminderBatch(
  request: APIRequestContext,
  session: ApiSession,
  batchName: string,
): Promise<{ id: string }> {
  const guardian = await createGuardian(request, session, `${batchName} Guardian`);
  const { studentId } = await createStudentWithDues(request, session, `${batchName} Student`, {
    guardianId: guardian.id,
  });
  return post<{ id: string }>(request, session, '/communications/reminder/bulk', {
    student_ids: [studentId],
    message_template: 'Dear {{guardian_name}}, {{student_name}} has dues of {{due_amount}}.',
    batch_name: batchName,
  });
}

/** [16.5.1] `POST /invoices` no longer takes an arbitrary line-item body —
 * an invoice is always minted from a real payment's allocations
 * (D2/D18). This pays off `studentId`'s outstanding bill in full through
 * the real checkout flow, which mints (or repairs) the invoice as part of
 * the same request. Caller must have called `createStudentWithDues` (or
 * similar) first so there's an open bill to pay. */
export async function createInvoice(
  request: APIRequestContext,
  session: ApiSession,
  studentId: string,
): Promise<{ id: string }> {
  // `GET /fees/dues` has no `student_id` filter — it narrows students by
  // class/section/search/status, not by id — so the student's own
  // `full_name` (unique enough within this call's freshly-created chain)
  // stands in for `search`.
  const student = await get<{ full_name: string }>(request, session, `/students/${studentId}`);
  const dues = await get<{
    data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
  }>(request, session, `/fees/dues?search=${encodeURIComponent(student.full_name)}`);
  const due = dues.data.find((row) => row.student_id === studentId)?.dues[0];
  if (!due) {
    throw new Error(`createInvoice: no outstanding due found for student "${studentId}"`);
  }
  const result = await post<{ invoice_id: string }>(request, session, '/payments/checkout', {
    idempotency_key: crypto.randomUUID(),
    lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
    payment_method: 'CASH',
  });
  return { id: result.invoice_id };
}

/** [16.5.3] Mints a public share token for `invoiceId` and returns just
 * the token — the opaque path segment `/i/$token` (the unauthenticated
 * receipt route) resolves against, not the full share URL. */
export async function createInvoiceShareToken(
  request: APIRequestContext,
  session: ApiSession,
  invoiceId: string,
): Promise<string> {
  const { url } = await post<{ url: string; token_id: string }>(
    request,
    session,
    `/invoices/${invoiceId}/share`,
    {},
  );
  return url.split('/i/').pop()!;
}

/** A student with an outstanding fee: builds the class chain, a fee
 * structure for that class, and generates a StudentFee row for the
 * January 2026 period. Returns everything a fee journey needs. */
export async function createStudentWithDues(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  options: { amount?: number; guardianId?: string } = {},
): Promise<{ studentId: string; chain: ClassSectionChain }> {
  const chain = await createClassSection(request, session);
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: chain.sectionId,
    ...(options.guardianId ? { guardian_ids: [options.guardianId] } : {}),
  });
  const feeStructure = await post<{ id: string }>(request, session, '/fee-structures', {
    fee_type: 'MONTHLY_TUITION',
    name: `E2E Tuition ${Date.now()}`,
    amount: options.amount ?? 500,
    class_id: chain.classId,
    academic_year_id: chain.academicYearId,
  });
  await post(request, session, '/fees/generate', {
    academic_year_id: chain.academicYearId,
    period_start: '2026-01-01',
    period_type: 'MONTH',
    student_ids: [student.id],
    fee_structure_ids: [feeStructure.id],
    notify_families: false,
  });
  return { studentId: student.id, chain };
}

/**
 * [38.1.4] A school-wide FINE fee structure — the rule/fine-specific
 * helpers (create a `FineRule`, log a manual fine) land in 38.2.5 once
 * those endpoints exist; this is only the fee-structure half, cloned from
 * `createStudentWithDues`'s own `/fee-structures` POST.
 */
export async function createFineStructure(
  request: APIRequestContext,
  session: ApiSession,
  chain: ClassSectionChain,
  name: string,
  amount: number,
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/fee-structures', {
    fee_type: 'FINE',
    name,
    amount,
    academic_year_id: chain.academicYearId,
  });
}

/** The school's current academic year — the one the Fines rules page and the
 * Log fine / Add rule fee pickers default to. Fee structures made in a fresh
 * `createClassSection` year never show up there, so specs that pick a fee
 * through the UI (or sweep by month) work inside this year instead. */
export async function currentAcademicYear(
  request: APIRequestContext,
  session: ApiSession,
): Promise<AcademicYearBounds & { id: string }> {
  // Paginated; same first page + `is_current ?? first` rule the rules panel uses.
  const { data: years } = await get<{
    data: { id: string; is_current: boolean; start_date: string; end_date: string }[];
  }>(request, session, '/academic-years');
  const year = years.find((y) => y.is_current) ?? years[0];
  if (!year) throw new Error('no academic year seeded');
  return { id: year.id, start_date: year.start_date, end_date: year.end_date };
}

export async function currentAcademicYearId(
  request: APIRequestContext,
  session: ApiSession,
): Promise<string> {
  return (await currentAcademicYear(request, session)).id;
}

/** [38.2.5] `POST /fees/fine-rules` — creates a `FineRule` targeting a
 * `FineSweepService`-computed trigger (e.g. `ATTENDANCE_ABSENT`) against a
 * `FeeType.FINE` fee structure such as `createFineStructure` above. */
export async function createFineRule(
  request: APIRequestContext,
  session: ApiSession,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  return post<{ id: string }>(request, session, '/fees/fine-rules', body);
}

/** [38.2.5] `POST /fees/fines` — logs a manual fine against one or more
 * students for a `FeeType.FINE` fee structure. */
export async function logFine(
  request: APIRequestContext,
  session: ApiSession,
  body: Record<string, unknown>,
): Promise<{ bill_ids: string[] }> {
  return post<{ bill_ids: string[] }>(request, session, '/fees/fines', body);
}

/** [38.2.5] `POST /fees/fines/generate` — bills the attendance-fine sweep
 * for one month from active `FineRule`s. */
export async function generateFines(
  request: APIRequestContext,
  session: ApiSession,
  body: Record<string, unknown>,
): Promise<{ fee_generation_ids: string[]; generated_count: number; skipped_count: number }> {
  return post(request, session, '/fees/fines/generate', body);
}

/** [38.5.1] Marks `count` non-Friday days in the previous calendar month
 * ABSENT for one student, via one `PUT .../register` call per day — a
 * register write doesn't need to cover the whole roster, just the entries
 * it's given (`RegisterEntryDto[]`), so this writes only `studentId`'s own
 * entry each time. Gives an `ATTENDANCE_ABSENT` `FineRule` something real
 * to sweep in `journeys/fines.spec.ts`. Each day is a fresh session
 * (`base_version: 0` — no prior write to conflict with). */
export async function markAbsentDaysInPreviousMonth(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
  studentId: string,
  count: number,
  /** The section's academic year; days outside it are skipped (a register
   * write outside the year 422s). */
  academicYear?: AcademicYearBounds,
): Promise<string[]> {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const dates: string[] = [];
  for (let day = 1; dates.length < count; day += 1) {
    const candidate = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), day);
    if (candidate.getMonth() !== previousMonth.getMonth()) {
      throw new Error(`Ran out of days in the previous month to mark ABSENT (${count} requested)`);
    }
    // Fridays are the seeded tenant's default weekly off — same reasoning
    // `markableDateIso` above documents — a register write for one lands
    // read-only / 422s.
    const iso = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(
      candidate.getDate(),
    ).padStart(2, '0')}`;
    const inYear =
      !academicYear || (iso >= academicYear.start_date && iso <= academicYear.end_date);
    if (candidate.getDay() !== 5 && inYear) {
      dates.push(iso);
    }
  }
  for (const date of dates) {
    await put(request, session, `/attendance/sections/${sectionId}/register`, {
      date,
      base_version: 0,
      client_request_id: crypto.randomUUID(),
      entries: [{ student_id: studentId, status: 'ABSENT' }],
    });
  }
  return dates;
}

export async function createStudent(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
): Promise<{ id: string }> {
  const chain = await createClassSection(request, session);
  return post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: chain.sectionId,
  });
}

/** A student linked to an already-created guardian — for
 * `journeys/invite-guardians.spec.ts` (12.6), which needs several
 * students sharing one guardian by phone. */
export async function createStudentWithGuardian(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  guardianId: string,
): Promise<{ id: string }> {
  const chain = await createClassSection(request, session);
  return post<{ id: string }>(request, session, '/students', {
    full_name: fullName,
    class_section_id: chain.sectionId,
    guardian_ids: [guardianId],
  });
}

/** A brand-new tenant user with role TEACHER, its own Teacher profile,
 * and an explicit password (bypassing the invite-email flow, which
 * nothing in this environment can deliver) so a spec can log in as
 * this exact teacher — as opposed to `loggedIn('teacher')`, which is
 * the one shared seeded account and must never have its section
 * mappings mutated by an individual spec (other specs use it purely
 * for role/permission checks and could run in a parallel worker). */
export interface FreshTeacher {
  email: string;
  password: string;
  userId: string;
  teacherId: string;
}

export async function createTeacherForSection(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  section: { classId: string; sectionId: string },
): Promise<FreshTeacher> {
  return createTeacher(request, session, fullName, section);
}

/** Creates a fresh TEACHER user + `Teacher` row. `section` omitted =
 * zero `TeacherClassSection` rows — for specs that need a teacher with no
 * assignments at all (e.g. an empty-state assertion on the
 * teaching-assignments screen). */
export async function createTeacher(
  request: APIRequestContext,
  session: ApiSession,
  fullName: string,
  section?: { classId: string; sectionId: string },
): Promise<FreshTeacher> {
  // `crypto.randomUUID()`, not `Math.random()` — CodeQL flags `Math.random()`
  // as insecure randomness wherever the value it seeds ends up in a field
  // named like a credential (`password` here), even in test-only code.
  const suffix = crypto.randomUUID();
  const email = `teacher-${suffix}@e2e.example.com`;
  const password = `E2e-Teacher-${suffix}`;
  const created = await post<{ user: { id: string } }>(request, session, '/users', {
    full_name: fullName,
    email,
    password,
    role: 'TEACHER',
    tenantId: session.tenantId,
  });
  const teacher = await post<{ id: string }>(request, session, '/teachers', {
    user_id: created.user.id,
    employee_id: `E2E-${suffix}`,
  });
  if (section) {
    await post(
      request,
      session,
      `/classes/${section.classId}/sections/${section.sectionId}/teachers`,
      { teacher_id: teacher.id },
    );
  }
  return { email, password, userId: created.user.id, teacherId: teacher.id };
}

/** Logs in as an arbitrary email/password (not a seed-contract role) and
 * returns Playwright storage state for a fresh browser context — the
 * same shape `e2e/fixtures/test.ts`'s `freshLogin` builds for seeded
 * accounts, generalised for a teacher created on the fly by
 * `createTeacherForSection`. */
export async function loginAsFreshUser(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<{
  cookies: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`login failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    memberships: { tenantId: string; role: string }[];
  };
  const membership = body.memberships[0];
  if (!membership) throw new Error(`no membership in login response for ${email}`);
  const state = await request.storageState();
  return {
    cookies: state.cookies,
    origins: [
      {
        origin: baseURL.replace(/\/$/, ''),
        localStorage: [
          {
            name: 'biddaloy:activeTenant',
            value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
          },
        ],
      },
    ],
  };
}

/** `GET /schools` (#533) — every school on the platform, SUPER_ADMIN only.
 * Used by `e2e/platform/provision-and-suspend.spec.ts` (#536) to resolve
 * the already-seeded "Rose Valley School" (`seed.util.ts`'s
 * `ensureSecondSchoolMembership`) to an id without any DB access. */
export async function findSchoolIdBySlug(
  request: APIRequestContext,
  session: ApiSession,
  slug: string,
): Promise<string> {
  const schools = await get<{ id: string; slug: string }[]>(request, session, '/schools');
  const found = schools.find((school) => school.slug === slug);
  if (!found) throw new Error(`No seeded school with slug "${slug}" (GET /schools)`);
  return found.id;
}

/** `POST /schools/:id/admins` (#531) — adds an existing (or new) user as
 * ADMIN of `schoolId`, matched by email. [68.1.14] A *verified* user who is
 * not yet a member is not enrolled: they get a JOIN_SCHOOL request
 * (`invitation.status === 'PENDING'`, `invitation.id` = the request) that
 * they accept themselves — see `acceptSchoolInvite`. An unverified contact
 * held by someone else is a 409 CONTACT_IN_USE. */
export async function addSchoolAdmin(
  request: APIRequestContext,
  session: ApiSession,
  schoolId: string,
  fullName: string,
  email: string,
): Promise<{ userId: string; invitation: { id: string; status: string } }> {
  const created = await post<{
    admin: { user_id: string; existed: boolean };
    invitation: { id: string; status: string };
  }>(request, session, `/schools/${schoolId}/admins`, { name: fullName, email });
  return { userId: created.admin.user_id, invitation: created.invitation };
}

/** `POST /account/school-invites/:id/accept` — the signed-in user accepts a
 * JOIN_SCHOOL request (e.g. the one `addSchoolAdmin` files for an existing
 * person) and becomes a member. 204, so not through `post` (no JSON body). */
export async function acceptSchoolInvite(
  request: APIRequestContext,
  session: ApiSession,
  inviteId: string,
): Promise<void> {
  const response = await request.post(`/api/v1/account/school-invites/${inviteId}/accept`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  if (!response.ok()) {
    throw new Error(`accept invite failed: ${response.status()} ${await response.text()}`);
  }
}

/** `POST /schools/:id/admins/:userId/resend-invitation` — #536's own
 * addition to `SchoolAdminsService.resendInvitation` (see that method's
 * doc comment): a `POST /schools`/`POST /schools/:id/admins`-created
 * ADMIN has no ADMIN-scoped route to reach the
 * `ACCOUNT_ACCESS_ECHO_SECRETS` debug echo `createInvitedStaffUser`
 * above relies on (that route requires the ADMIN to already be signed
 * in), so this SUPER_ADMIN-scoped resend is the only way to read a
 * freshly-provisioned admin's invite link without scraping the delivery
 * provider's logs or touching the database. */
export async function resendSchoolAdminInvitation(
  request: APIRequestContext,
  session: ApiSession,
  schoolId: string,
  userId: string,
): Promise<string> {
  const result = await post<{ debug?: { token: string } }>(
    request,
    session,
    `/schools/${schoolId}/admins/${userId}/resend-invitation`,
    {},
  );
  const token = result.debug?.token;
  if (!token) {
    throw new Error(
      'No invitation.debug.token in the resend-invitation response — is ' +
        'ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
    );
  }
  return token;
}

/** `POST /schools` (#529) — creates a school and its first ADMIN
 * atomically, SUPER_ADMIN only. [14.11.4]'s `journeys/backup-restore.spec.ts`
 * uses this to seed a *dedicated* tenant rather than the shared default
 * one: a successful restore rewrites the whole tenant, and
 * `playwright.config.ts`'s `fullyParallel: true` means the shared tenant
 * can be mid-use by another worker at any moment. The created ADMIN has no
 * password yet — only an invitation — see `resendSchoolAdminInvitation`
 * and `activateInvite` to finish signing them in. */
export async function provisionSchool(
  request: APIRequestContext,
  session: ApiSession,
  name: string,
  slug: string,
  adminName: string,
  adminEmail: string,
): Promise<{ schoolId: string; adminUserId: string }> {
  const created = await post<{ school: { id: string }; admin: { user_id: string } }>(
    request,
    session,
    '/schools',
    {
      name,
      slug,
      admin: { name: adminName, email: adminEmail },
      idempotency_key: crypto.randomUUID(),
    },
  );
  return { schoolId: created.school.id, adminUserId: created.admin.user_id };
}

/** A password every D10 rule set accepts (staff: 8+ chars, upper, lower, digit,
 * symbol; family: 8+ chars and a digit). Use it wherever a spec sets one. */
export const E2E_PASSWORD = 'Strong-Pass-1';

/** `POST /auth/activate` — consumes an invite token, sets a password, and
 * signs the caller in, all in one call. Used instead of driving
 * `/activate?token=…` through a browser (`ActivatePage`,
 * `journeys/platform/provision-and-suspend.spec.ts`'s style) when the spec
 * has no other reason to open a page yet — the returned access token plus
 * the refresh cookie this call leaves on `request`'s own cookie jar are
 * enough to build a `storageState` for a fresh `browser.newContext()`. */
export async function activateInvite(
  request: APIRequestContext,
  token: string,
  password: string,
): Promise<ApiSession & { role: string }> {
  const response = await request.post('/api/v1/auth/activate', { data: { token, password } });
  if (!response.ok()) {
    throw new Error(`activate failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships[0];
  if (!membership) throw new Error('no membership in activate response');
  return { token: body.access_token, tenantId: membership.tenantId, role: membership.role };
}

/** `POST /auth/step-up/otp/request` — retried with a short wait when the
 * echoed `debug.otp` is missing. `StepUpService.requestOtp` (16.2.2)
 * swallows `OtpService`'s 60s-per-identifier cooldown into the same
 * uniform 202 it always returns (never leaking whether a resend was
 * actually issued), so a second journey in the same run requesting a
 * step-up OTP for the same seeded admin identifier within 60s of another
 * gets 202 with no `debug` block at all — not a failure, just "wait out
 * the cooldown." `OtpService`'s `COOLDOWN_MS` is 60s, so this retries a
 * few times past that window rather than once. */
export async function requestStepUpOtp(
  request: APIRequestContext,
  session: ApiSession,
  identifier: string,
  scope: string,
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.post('/api/v1/auth/step-up/otp/request', {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      data: { identifier, scope },
    });
    if (!response.ok()) {
      throw new Error(`step-up otp/request failed: ${response.status()} ${await response.text()}`);
    }
    const body = (await response.json()) as { debug?: { otp?: string } };
    if (body.debug?.otp) return body.debug.otp;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  throw new Error(
    'No debug.otp in step-up otp/request response after retrying past the 60s cooldown — ' +
      'ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
  );
}

/** `PUT /acr/criteria` — saves a new ACR form version (copy-on-write). */
export async function saveAcrCriteria(
  request: APIRequestContext,
  session: ApiSession,
  body: SaveAcrCriteriaBody,
): Promise<{ id: string | null; version: number }> {
  return put(request, session, '/acr/criteria', body);
}

/** `POST /acr/assessments` — starts an INCOMPLETE ACR on the latest form version. */
export async function createAcr(
  request: APIRequestContext,
  session: ApiSession,
  body: CreateAcrBody,
): Promise<AcrResponse> {
  return post<AcrResponse>(request, session, '/acr/assessments', body);
}

/** `POST /acr/assessments/:id/complete` (assessor only, D7). */
export async function completeAcr(
  request: APIRequestContext,
  session: ApiSession,
  id: string,
): Promise<AcrResponse> {
  return post<AcrResponse>(request, session, `/acr/assessments/${id}/complete`, {});
}

/** `POST /incidents`. */
export async function createIncident(
  request: APIRequestContext,
  session: ApiSession,
  body: CreateIncidentBody,
): Promise<IncidentResponse> {
  return post<IncidentResponse>(request, session, '/incidents', body);
}

/** `POST /surveys` — a DRAFT; `publishSurvey`/`closeSurvey` move it on. */
export async function createSurvey(
  request: APIRequestContext,
  session: ApiSession,
  body: CreateSurveyBody,
): Promise<SurveyResponse> {
  return post<SurveyResponse>(request, session, '/surveys', body);
}

export async function publishSurvey(
  request: APIRequestContext,
  session: ApiSession,
  id: string,
): Promise<SurveyResponse> {
  return post<SurveyResponse>(request, session, `/surveys/${id}/publish`, {});
}

export async function closeSurvey(
  request: APIRequestContext,
  session: ApiSession,
  id: string,
): Promise<SurveyResponse> {
  return post<SurveyResponse>(request, session, `/surveys/${id}/close`, {});
}

/** [13.7.1] A trial school made the way a stranger makes one: `POST
 * /auth/register/start` then `/verify` with the code echoed in `debug.otp`
 * (`ACCOUNT_ACCESS_ECHO_SECRETS`). The contact details are unique per call
 * (a second open trial for the same contact is a 409 `TRIAL_ALREADY_OPEN`).
 * The refresh cookie lands on `request`, so `request.storageState()` builds a
 * browser context signed in as this admin. */
export interface RegisteredSchool {
  session: ApiSession;
  role: string;
  adminName: string;
  schoolName: string;
  email: string;
  phone: string;
}

export function uniqueRegistration(): Pick<
  RegisteredSchool,
  'adminName' | 'schoolName' | 'email' | 'phone'
> {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    adminName: `Reg Admin ${n}`,
    schoolName: `E2E Trial School ${n}`,
    email: `reg-${n}@e2e.example.com`,
    phone: `+88017${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`,
  };
}

export async function registerTrialSchool(request: APIRequestContext): Promise<RegisteredSchool> {
  const who = uniqueRegistration();
  const started = await request.post('/api/v1/auth/register/start', {
    data: {
      admin_name: who.adminName,
      school_name: who.schoolName,
      country_code: 'BD',
      address: '1 Test Road, Dhaka',
      phone: who.phone,
      email: who.email,
      terms_accepted: true,
      captcha_token: 'no-captcha',
    },
  });
  if (!started.ok()) throw new Error(`register/start ${started.status()} ${await started.text()}`);
  const start = (await started.json()) as { registration_id: string; debug?: { otp: string } };
  if (!start.debug?.otp) throw new Error('register/start did not echo an OTP');
  const verified = await request.post('/api/v1/auth/register/verify', {
    data: { registration_id: start.registration_id, otp: start.debug.otp },
  });
  if (!verified.ok()) {
    throw new Error(`register/verify ${verified.status()} ${await verified.text()}`);
  }
  const body = (await verified.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.role === 'ADMIN');
  if (!membership) throw new Error('no ADMIN membership after register/verify');
  return {
    ...who,
    session: { token: body.access_token, tenantId: membership.tenantId },
    role: membership.role,
  };
}

/** `GET /backup/template?variant=starter` — the real starter workbook, then
 * `rows` appended under its header (row 1 holds the column keys; the SAMPLE
 * row is ignored on import). `exceljs` is the server's own dependency. */
export async function starterWorkbook(
  request: APIRequestContext,
  session: ApiSession,
  rows: Record<string, Record<string, string | boolean>[]>,
): Promise<Buffer> {
  const res = await request.get('/api/v1/backup/template?variant=starter&lang=en', {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  if (!res.ok()) throw new Error(`template ${res.status()} ${await res.text()}`);
  // Lazy: only the specs that build a workbook pay for loading exceljs.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  for (const [sheetName, sheetRows] of Object.entries(rows)) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) throw new Error(`starter has no sheet ${sheetName}`);
    const keys = (sheet.getRow(1).values as (string | undefined)[]).slice(1);
    for (const row of sheetRows) {
      sheet.addRow(keys.map((key) => (key ? (row[key] ?? null) : null)));
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** New schools have no seat limit during the free period (Epic 49), so a limit test sets one.
 * ponytail: raw SQL via the server's `pg`; swap for a platform grant once the e2e has one. */
export async function setSeatLimit(schoolId: string, limit: number): Promise<void> {
  await runSqlOnOneRow(
    `UPDATE schools SET seat_limit = $2 WHERE id = $1`,
    [schoolId, limit],
    `setSeatLimit: school ${schoolId}`,
  );
}

/** Runs one raw SQL statement on the e2e database and returns its row count.
 * ponytail: raw SQL via the server's `pg`; swap for an endpoint if one appears. */
async function runSql(sql: string, params: unknown[] = []): Promise<number | null> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — raw-SQL e2e helpers need the e2e database');
  // `pg` is hoisted from the server and has no types here. A typed shape instead of
  // `@ts-expect-error`, which would break tsc the day `@types/pg` gets hoisted too.
  const { Client } = (await import('pg' as string)) as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string, params: unknown[]): Promise<{ rowCount: number | null }>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rowCount;
  } finally {
    await client.end();
  }
}

/** `runSql` for an UPDATE that must hit exactly one row. 0 rows means DATABASE_URL is not
 * the database the server uses. */
async function runSqlOnOneRow(sql: string, params: unknown[], what: string): Promise<void> {
  if ((await runSql(sql, params)) !== 1) {
    throw new Error(`${what} not found in ${new URL(process.env.DATABASE_URL!).pathname}`);
  }
}

/** Opens a REDIS_DOWN platform alert. The e2e server runs with NODE_ENV=test,
 * so the live probe is off and cannot clear it behind the test's back. */
export const openPlatformAlert = () =>
  runSql(`INSERT INTO platform_alerts (kind) VALUES ('REDIS_DOWN') ON CONFLICT DO NOTHING`);

/** Clears every open platform alert. */
export const clearPlatformAlerts = () =>
  runSql(`UPDATE platform_alerts SET cleared_at = now() WHERE cleared_at IS NULL`);

// ---------------------------------------------------------------------------
// [66.3.99] Study plans (Epic 66)
// ---------------------------------------------------------------------------

export interface StudyPlanLessonInput {
  title: string;
  periods: number;
}

export interface StudyPlanBody {
  section_id: string;
  subject_id: string;
  /** `null` = whole year. */
  academic_term_id: string | null;
  lessons?: StudyPlanLessonInput[];
}

/** `POST /study-plans`. The caller needs write scope on the section x subject (ADMIN always has it). */
export async function createStudyPlan(
  request: APIRequestContext,
  session: ApiSession,
  body: StudyPlanBody,
): Promise<{ id: string; lessons: { id: string; title: string; periods: number }[] }> {
  return post(request, session, '/study-plans', body);
}

/** A fresh subject offered by the class for the year — a plan needs the class to offer it. */
export async function createOfferedSubject(
  request: APIRequestContext,
  session: ApiSession,
  scope: { classId: string; academicYearId: string },
  nameEn: string,
): Promise<{ id: string; code: string; nameEn: string }> {
  const code = `SP${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code,
    name_en: nameEn,
  });
  await post(request, session, `/classes/${scope.classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: scope.academicYearId,
  });
  return { id: subject.id, code, nameEn };
}

/** `POST /study-plan-templates` (ADMIN / head teacher). */
export async function createStudyPlanTemplate(
  request: APIRequestContext,
  session: ApiSession,
  body: {
    name: string;
    class_grade: number;
    subject_code: string;
    lessons: StudyPlanLessonInput[];
  },
): Promise<{ id: string; name: string }> {
  return post(request, session, '/study-plan-templates', body);
}

/** `PUT /lesson-deliveries` — records one period (upsert). */
export async function putLessonDelivery(
  request: APIRequestContext,
  session: ApiSession,
  body: {
    section_id: string;
    subject_id: string;
    date: string;
    period_slot_id: string;
    status: 'TAUGHT' | 'PARTLY' | 'NOT_TAUGHT';
    reason?: string;
  },
): Promise<{ id: string }> {
  return put(request, session, '/lesson-deliveries', body);
}

/** The demo tenant's current-year "Class 6" / section "A" (the routine and study-plan seeds live there). */
export async function findSeedSectionA(
  request: APIRequestContext,
  session: ApiSession,
): Promise<{ classId: string; sectionId: string; className: string; academicYearId: string }> {
  const classes = await get<{ data: { id: string; name: string; academic_year_id: string }[] }>(
    request,
    session,
    '/classes?limit=100',
  );
  const klass = classes.data.find((c) => c.name === 'Class 6');
  if (!klass) throw new Error('seeded "Class 6" not found — run the seed script first');
  const sections = await get<{ id: string; section_name: string }[]>(
    request,
    session,
    `/classes/${klass.id}/sections`,
  );
  const section = sections.find((s) => s.section_name === 'A');
  if (!section) throw new Error('seeded Class 6 section "A" not found');
  return {
    classId: klass.id,
    sectionId: section.id,
    className: klass.name,
    academicYearId: klass.academic_year_id,
  };
}

/** The school's own calendar: the date it is *there* now, and which weekdays are off. The server records
 * lesson deliveries against this date, so specs must reason in it, never in the machine's timezone. */
export interface SchoolCalendar {
  today: string;
  weeklyOffDays: number[];
  isSchoolDay: (date: string) => boolean;
}

export async function schoolCalendar(
  request: APIRequestContext,
  session: ApiSession,
): Promise<SchoolCalendar> {
  const settings = await get<{ timezone: string; weeklyOffDays: number[] }>(
    request,
    session,
    '/calendar-settings',
  );
  // en-CA formats as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(
    new Date(),
  );
  const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
  return {
    today,
    weeklyOffDays: settings.weeklyOffDays,
    isSchoolDay: (date) => !settings.weeklyOffDays.includes(weekday(date)),
  };
}

/** The latest date on or before `from` that falls on `weekday` (0 = Sunday). */
export function lastWeekdayOnOrBefore(weekday: number, from: string): string {
  const d = new Date(`${from}T00:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface StudyPlanScene {
  classId: string;
  className: string;
  academicYearId: string;
  /** `YYYY-MM-DD` the academic year starts (a routine slot is valid from then). */
  yearStart: string;
  /** Two fresh sections of the seeded Class 6: a spec's own, so no earlier run's deliveries get in the way. */
  sectionAId: string;
  sectionAName: string;
  sectionBId: string;
  sectionBName: string;
  subject: { id: string; code: string; nameEn: string };
  teacher: FreshTeacher;
  routineId: string;
  /** Period slot ids of the seeded class's shift, by sequence number. */
  periodSlotIds: Record<number, string>;
}

/**
 * [66.3.99] A fresh subject taught by a fresh teacher in two fresh sections of the seeded Class 6
 * (its shift and published routine come along): the subject is offered by the class, the teacher is its
 * SUBJECT_TEACHER in both sections (so a plan is theirs to write), and nothing else touches them. Routine slots are added per
 * spec with `addRoutineSlot`.
 */
export async function createStudyPlanScene(
  request: APIRequestContext,
  admin: ApiSession,
  label: string,
): Promise<StudyPlanScene> {
  const sectionA = await findSeedSectionA(request, admin);
  const mkSection = async () => {
    const name = `Z${crypto.randomUUID().slice(0, 5)}`;
    const created = await post<{ id: string }>(
      request,
      admin,
      `/classes/${sectionA.classId}/sections`,
      { section_name: name },
    );
    return { id: created.id, name };
  };
  const sectionOne = await mkSection();
  const sectionTwo = await mkSection();
  const subject = await createOfferedSubject(request, admin, sectionA, `${label} Subject`);
  const teacher = await createTeacher(request, admin, `${label} Teacher`);
  for (const sectionId of [sectionOne.id, sectionTwo.id]) {
    await post(request, admin, `/classes/${sectionA.classId}/sections/${sectionId}/teachers`, {
      teacher_id: teacher.teacherId,
      subject_id: subject.id,
    });
  }
  const calendarSettings = await get<{ currentAcademicYear?: { start_date: string } | null }>(
    request,
    admin,
    '/calendar-settings',
  );
  const calendarYearStart = calendarSettings.currentAcademicYear?.start_date ?? '2026-01-01';
  const routines = await get<{ id: string; academic_year_id: string; state: string }[]>(
    request,
    admin,
    '/routines',
  );
  const routine = routines.find(
    (r) => r.academic_year_id === sectionA.academicYearId && r.state === 'PUBLISHED',
  );
  if (!routine) throw new Error('no published routine for the seeded year — run the seed script');
  const klass = await get<{ shift_id: string }>(request, admin, `/classes/${sectionA.classId}`);
  const periods = await get<{ id: string; sequence: number }[]>(
    request,
    admin,
    `/routines/shifts/${klass.shift_id}/period-slots`,
  );
  return {
    classId: sectionA.classId,
    className: sectionA.className,
    academicYearId: sectionA.academicYearId,
    yearStart: calendarYearStart,
    sectionAId: sectionOne.id,
    sectionAName: sectionOne.name,
    sectionBId: sectionTwo.id,
    sectionBName: sectionTwo.name,
    subject,
    teacher,
    routineId: routine.id,
    periodSlotIds: Object.fromEntries(periods.map((p) => [p.sequence, p.id])),
  };
}

/**
 * A weekly routine slot on the published routine, taught by the scene's teacher,
 * valid from the year start so past days (a missed lesson, last week's lost period) have it.
 * A published routine refuses a back-dated slot (#2254), so the slot is created from today
 * and then back-dated in the database (#2407).
 * ponytail: raw SQL like `endTrial`; the shared routine can't go back to DRAFT. Upgrade path:
 * seed the scene's history in the seed script.
 */
export async function addRoutineSlot(
  request: APIRequestContext,
  admin: ApiSession,
  scene: StudyPlanScene,
  slot: { sectionId: string; subjectId?: string; weekday: number; period: number },
): Promise<string> {
  const periodSlotId = scene.periodSlotIds[slot.period];
  if (!periodSlotId) throw new Error(`the seeded shift has no period ${slot.period}`);
  const { today } = await schoolCalendar(request, admin);
  const created = await post<{ slot: { id: string } }>(
    request,
    admin,
    `/routines/${scene.routineId}/slots`,
    {
      section_id: slot.sectionId,
      period_slot_id: periodSlotId,
      weekday: slot.weekday,
      subject_id: slot.subjectId ?? scene.subject.id,
      recurrence: 'WEEKLY',
      valid_from: today,
      teacher_ids: [scene.teacher.teacherId],
    },
  );
  await backdateRoutineSlot(created.slot.id, scene.yearStart);
  return created.slot.id;
}

async function backdateRoutineSlot(slotId: string, validFrom: string): Promise<void> {
  await runSqlOnOneRow(
    `UPDATE routine_slots SET valid_from = $2 WHERE id = $1`,
    [slotId, validFrom],
    `backdateRoutineSlot: slot ${slotId}`,
  );
}

/** Removes slots a spec added to the shared seeded routine, so the next run finds the period free. */
export async function removeRoutineSlots(
  request: APIRequestContext,
  admin: ApiSession,
  slotIds: string[],
): Promise<void> {
  for (const id of slotIds) {
    await request.delete(`/api/v1/routines/slots/${id}`, {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
    });
  }
}

/** An API session (token + tenant) for any account by email and password — for forced calls made with a
 * less-privileged user's own token, which the UI would never send. */
export async function sessionForCredentials(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<ApiSession> {
  const response = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!response.ok()) {
    throw new Error(`login failed for ${email}: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships[0];
  if (!membership) throw new Error(`no membership for ${email}`);
  return { token: body.access_token, tenantId: membership.tenantId };
}

/** A raw request with a session's headers, for asserting a refusal (the typed helpers throw on non-2xx). */
export async function rawRequest(
  request: APIRequestContext,
  session: ApiSession,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  path: string,
  data?: object,
): Promise<{ status: number; body: unknown }> {
  const response = await request.fetch(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    ...(data ? { data } : {}),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON (an HTML 404 page): keep the text
  }
  return { status: response.status(), body };
}

/** The seed admin's session in the SECOND seeded school (Rose Valley): a real, valid token for a different
 * tenant, for proving that school A's data does not answer to it. */
export async function secondSchoolAdminSession(request: APIRequestContext): Promise<ApiSession> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS.admin, password },
  });
  if (!response.ok()) throw new Error(`admin login failed: ${response.status()}`);
  const body = (await response.json()) as RefreshResponse;
  const membership = body.memberships.find((m) => m.name === 'Rose Valley School');
  if (!membership) throw new Error('the seed admin has no Rose Valley School membership');
  return { token: body.access_token, tenantId: membership.tenantId };
}

/** Takes subjects a spec made off the seeded Class 6 again and deletes them. Left behind they pile up: the
 * class's subject list is read by the portal syllabus and other journeys, and the create-plan wizard only
 * lists the first 100 subjects by name. (Fresh sections and teachers have no delete endpoint.) Best effort:
 * a failure here must not mask the test's own result. */
export async function detachOfferedSubjects(
  request: APIRequestContext,
  admin: ApiSession,
  scope: { classId: string; academicYearId: string },
  subjectIds: string[],
): Promise<void> {
  const headers = { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId };
  for (const id of subjectIds) {
    await request.delete(
      `/api/v1/classes/${scope.classId}/subjects/${id}?academic_year_id=${scope.academicYearId}`,
      { headers },
    );
    await request.delete(`/api/v1/subjects/${id}`, { headers });
  }
}

/** `POST /platform/billing/schools/:id/grant` as the platform super admin: a free GRANT order for
 * `months` (idempotent per key). It asks for a `seats.expiring` / `seats.exhausted` recheck about
 * 5 s later. `request` must be its own context: the super-admin login would replace the cookie
 * jar of a context that holds a school admin's session. */
export async function grantSeats(
  request: APIRequestContext,
  schoolId: string,
  seats: number,
  months: number,
): Promise<void> {
  const session = await superAdminApiSession(request);
  await post(request, session, `/platform/billing/schools/${schoolId}/grant`, {
    seats,
    months,
    reason: 'e2e seat grant',
    idempotency_key: `e2e-${crypto.randomUUID()}`,
  });
}

/** Raises a fresh school's WARNING `seats.expiring` alert (about 5 s on) by its 90 %-used path:
 * 9 ACTIVE students, then a grant (asks for the recheck) and a limit of 10 set inside those 5 s
 * (a grant leaves the limit NULL in the free period). The 30-day path cannot fire here: inside
 * `BILLING_FREE_UNTIL` a school is covered until the free period ends (`seatCover`).
 * The students sit in a new, non-current year, so `attendance.not_taken` adds no alert.
 * Uses its own super-admin context.
 * ponytail: raw SQL via the server's `pg` for the limit; swap for an endpoint if one appears. */
export async function raiseSeatsExpiring(
  playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'],
  school: { api: APIRequestContext; session: ApiSession },
  baseURL: string,
): Promise<void> {
  await createStudentsInSection(school.api, school.session, 'Seat', 9);
  const superAdmin = await playwright.request.newContext({ baseURL });
  try {
    await grantSeats(superAdmin, school.session.tenantId, 25, 1);
    await setSeatLimit(school.session.tenantId, 10);
  } finally {
    await superAdmin.dispose();
  }
}

/** Switches off every attention rule the school can switch off except `keep`, so a
 * scheduled tick (DAILY runs every 15 min) cannot add an alert of its own mid-test.
 * Rules that cannot be switched off (e.g. `setup.incomplete`) are the caller's to avoid. */
export async function onlyAttentionRule(
  request: APIRequestContext,
  session: ApiSession,
  keep: AlertRuleKey,
): Promise<void> {
  const path = `/schools/${session.tenantId}/settings`;
  const current = await get<{ version: number }>(request, session, path);
  const rules = Object.fromEntries(
    ALERT_RULES.filter((r) => r.canDisable && r.key !== keep).map((r) => [
      r.key,
      { enabled: false },
    ]),
  );
  await patch(request, session, path, { version: current.version, attention: { rules } });
}

/** [70.5.5] A TERM exam of `classId` with one written component, the given marks, processed and published. */
export async function publishedTermExam(
  request: APIRequestContext,
  session: ApiSession,
  scope: { classId: string; sectionId: string; academicYearId: string; subjectId: string },
  name: string,
  marks: Record<string, string>,
): Promise<{ id: string }> {
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name,
    kind: ExamKind.TERM,
    academic_year_id: scope.academicYearId,
    class_id: scope.classId,
  });
  const component = await post<{ id: string }>(request, session, `/exams/${exam.id}/components`, {
    subject_id: scope.subjectId,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });
  await patch(request, session, `/exams/${exam.id}/marks`, {
    section_id: scope.sectionId,
    subject_id: scope.subjectId,
    cells: Object.entries(marks).map(([studentId, value]) => ({
      student_id: studentId,
      component_id: component.id,
      value,
      status: 'PRESENT',
    })),
  });
  // Processing refuses while any section's sheet is open; unmarked students go in ABSENT.
  const sections = await get<{ id: string }[]>(
    request,
    session,
    `/classes/${scope.classId}/sections`,
  );
  for (const section of sections) {
    await submitMarkSheet(request, session, exam.id, {
      section_id: section.id,
      subject_id: scope.subjectId,
    });
  }
  await post(request, session, `/exams/${exam.id}/results/process`, {});
  await post(request, session, `/exams/${exam.id}/results/publish`, {});
  return exam;
}

/** [70.5.5] A fresh subject assigned to the class for the year (results only count those). */
export async function newClassSubject(
  request: APIRequestContext,
  session: ApiSession,
  classId: string,
  yearId: string,
): Promise<{ id: string }> {
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `E2EFR-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Final Subject',
    name_bn: 'ই২ই চূড়ান্ত বিষয়',
  });
  // Results only count subjects assigned to the class.
  await post(request, session, `/classes/${classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: yearId,
  });
  return subject;
}
