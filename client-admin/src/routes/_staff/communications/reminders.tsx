import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  HelpHint,
  Card,
  Checkbox,
  Label,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useLastReminders,
  useSendSingleReminder,
  useSingleReminderPreview,
  useStudent,
  useStudentFeeSummary,
  type ReminderPreview,
  type SendSingleReminderInput,
  type Student,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatPhone, formatServerAmount } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleAlertIcon, RefreshCwIcon, SendIcon, UsersIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { BulkReminderWizard } from './-bulk/bulk-reminder-wizard';
import { PlaceholderButtons } from './-shared/placeholder-buttons';
import { RecipientList } from './-shared/recipient-list';
import { SelectedStudentRow } from './-shared/selected-student-row';
import { skipReasonKey } from './-shared/skip-reason';
import { SmsSegmentCounter } from './-shared/sms-segment-counter';
import { StudentSearch } from './-shared/student-search';
import {
  findUnknownLabels,
  hasStrayBraces,
  findUnsupportedPlaceholders,
  toServerTemplate,
  usePlaceholderLabels,
} from './-shared/template-placeholders';
import { splitTemplateParams, WhatsappTemplateFields } from './-shared/whatsapp-template-fields';

/**
 * `/communications/reminders` — [8.11.9]'s single-student fee reminder:
 * compose → **mandatory server preview** → send.
 *
 * The story's teeth live in the staleness guard here: Send is enabled
 * only while the inputs (student, selected guardians, template, channel
 * override, WhatsApp fields) exactly match what the last successful
 * preview was run against — any edit hides the preview (and so Send) until
 * the preview is re-run. A sent SMS cannot be recalled, so "preview ran
 * once, then the template was edited" must not count as previewed.
 *
 * Gated on COMMUNICATION_BULK_SEND, not COMMUNICATION_SEND: the server's
 * reminder routes are `@Roles(ADMIN, ACCOUNTANT, EXECUTIVE)` — a TEACHER
 * holds COMMUNICATION_SEND but would 403 on every request this page
 * makes. Same UX-gate-not-security-boundary framing as `/fees/generate`.
 */
/**
 * `mode=bulk` switches the page from the single-student form to
 * [8.11.9]'s bulk wizard — a search param rather than a second route so
 * the wizard's own `?step=` (`useWizardShellStep`'s contract) and the
 * mode both survive a refresh together.
 */
const remindersSearchSchema = z.object({
  mode: z.enum(['bulk']).optional().catch(undefined),
  step: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/reminders')({
  validateSearch: remindersSearchSchema,
  loader: () => loadRouteNamespaces('communications'),
  pendingComponent: FeeRemindersPending,
  component: FeeRemindersPage,
});

const OVERRIDE_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type OverrideMedium = (typeof OVERRIDE_MEDIUMS)[number];
/** Sentinel for "no override" — Radix `Select` cannot carry an empty
 * string value, so the default option needs a real one. */
const PREFERRED = 'PREFERRED';

// [8.14.17]: the permission check that used to live at the top of
// `FeeRemindersPage` (an `EmptyState` shown when the viewer lacked
// `COMMUNICATION_BULK_SEND`) is gone — `_staff.tsx`'s `RequirePermission`
// now refuses the whole route in place, keyed off the same permission
// (`route-permissions.ts`), before this component ever mounts.
function FeeRemindersPage() {
  const regionConfig = useTenantRegionConfig();
  const { mode } = Route.useSearch();

  // Money (the outstanding balance) and dates (last reminder) both render
  // through the tenant's own region settings — same reasoning as
  // `/payments/record`'s own provider wrap.
  return (
    <RegionConfigProvider value={regionConfig}>
      {mode === 'bulk' ? <BulkReminderWizard /> : <SingleReminderForm />}
    </RegionConfigProvider>
  );
}

function SingleReminderForm() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const labels = usePlaceholderLabels();

  const [studentId, setStudentId] = React.useState<string | null>(null);
  const [guardianIds, setGuardianIds] = React.useState<string[]>([]);
  /** Display form (`{Student name}`); `serverTemplate` is what goes on the wire. */
  const [template, setTemplate] = React.useState('');
  const [mediumOverride, setMediumOverride] = React.useState<string>(PREFERRED);
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');
  /** Fingerprint of the inputs the last *accepted* preview ran against,
   * paired with that preview's own response — one state so the guard and
   * the rendered recipients can never disagree. `preview.data` (React
   * Query's last-settled response) is deliberately not rendered: with two
   * previews in flight, a slow earlier response can settle *after* a
   * newer one and would then be shown against the newer fingerprint. */
  const [acceptedPreview, setAcceptedPreview] = React.useState<{
    fingerprint: string;
    result: ReminderPreview;
  } | null>(null);
  /** Monotonic id of the most recent preview request — a response from
   * any older request is discarded in its onSuccess. */
  const previewRequestRef = React.useRef(0);

  const studentQuery = useStudent(studentId ?? undefined);
  const feeSummary = useStudentFeeSummary(studentId ?? undefined);
  const lastReminders = useLastReminders(studentId === null ? [] : [studentId]);

  const preview = useSingleReminderPreview();
  const send = useSendSingleReminder();

  const student = studentQuery.data;

  // A freshly loaded student starts with every guardian selected — the
  // server's own default when `guardian_ids` is omitted, made visible.
  // Keyed by student *id*, not object identity: a background refetch (or
  // any cache update) hands back a new `student` object for the same
  // student, and re-running then would silently re-select guardians the
  // user had deliberately deselected.
  const guardianDefaultsForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (student !== undefined && guardianDefaultsForRef.current !== student.id) {
      guardianDefaultsForRef.current = student.id;
      setGuardianIds(student.guardians.map((guardian) => guardian.id));
    }
  }, [student]);

  const serverTemplate = toServerTemplate(template, labels);
  const strayBraces = hasStrayBraces(template, labels);
  const unknownTokens = [
    ...findUnknownLabels(template, labels).map((word) => `{${word}}`),
    ...findUnsupportedPlaceholders(serverTemplate),
  ];

  // Typed-but-unsent content is lost on leave — ask first.
  useWarnUnsavedChanges(!send.isSuccess && (studentId !== null || template !== ''));

  /** The staleness guard's identity: every input the server preview
   * depends on, in a canonical order. */
  const fingerprint = JSON.stringify({
    studentId,
    guardianIds: [...guardianIds].sort(),
    template: serverTemplate,
    mediumOverride,
    templateName,
    templateLanguage,
    templateParams,
  });

  const previewMatchesInputs =
    acceptedPreview !== null && acceptedPreview.fingerprint === fingerprint;

  const canPreview =
    studentId !== null &&
    template.trim() !== '' &&
    unknownTokens.length === 0 &&
    !strayBraces &&
    guardianIds.length > 0 &&
    !preview.isPending;

  const canSend =
    previewMatchesInputs &&
    (acceptedPreview?.result.recipients.length ?? 0) > 0 &&
    !send.isPending &&
    !send.isSuccess;

  // SMS limits only matter when an SMS can actually go out: an explicit
  // SMS override, or no override while a selected guardian prefers SMS.
  // An EMAIL/WHATSAPP-only send quoting "160 per segment" would be noise
  // (the send.tsx composer gates its counter the same way).
  const smsInPlay =
    mediumOverride === 'SMS' ||
    (mediumOverride === PREFERRED &&
      (student?.guardians.some(
        (guardian) =>
          guardianIds.includes(guardian.id) && guardian.preferred_communication === 'SMS',
      ) ??
        false));

  function buildInput(): SendSingleReminderInput {
    const params = splitTemplateParams(templateParams);
    return {
      message_template: serverTemplate,
      guardian_ids: guardianIds,
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(mediumOverride !== PREFERRED ? { medium: mediumOverride as OverrideMedium } : {}),
      ...(mediumOverride === 'WHATSAPP' && templateName.trim() !== ''
        ? {
            whatsapp_template_name: templateName.trim(),
            ...(templateLanguage.trim() !== ''
              ? { whatsapp_template_language: templateLanguage.trim() }
              : {}),
            ...(params.length > 0 ? { whatsapp_template_params: params } : {}),
          }
        : {}),
    };
  }

  function handlePreview() {
    if (studentId === null) return;
    // Snapshot before the request: if the user edits while the preview is
    // in flight, the snapshot no longer equals the live fingerprint and
    // Send stays disabled — exactly the guard's job. The request id makes
    // the guard survive out-of-order responses too: a slow earlier
    // preview settling after a newer one must not overwrite the newer
    // preview's fingerprint or recipients.
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedFingerprint = fingerprint;
    preview.mutate(
      { studentId, input: buildInput() },
      {
        onSuccess: (result) => {
          if (previewRequestRef.current !== requestId) return;
          setAcceptedPreview({ fingerprint: requestedFingerprint, result });
        },
      },
    );
  }

  function handleSend() {
    if (studentId === null) return;
    send.mutate({ studentId, input: buildInput() });
  }

  function handleSelectStudent(selected: Student) {
    setStudentId(selected.id);
    // Invalidate any in-flight preview — its response belongs to the
    // previous student.
    previewRequestRef.current += 1;
    setAcceptedPreview(null);
    preview.reset();
    send.reset();
  }

  function handleChangeStudent() {
    setStudentId(null);
    setGuardianIds([]);
    // Clear the "defaults already applied for" marker too. Without this,
    // re-picking the *same* student leaves the ref matching their id, the
    // default-all effect never runs, and the guardian checklist stays empty
    // with Preview permanently disabled and nothing on screen explaining why.
    guardianDefaultsForRef.current = null;
    previewRequestRef.current += 1;
    setAcceptedPreview(null);
    preview.reset();
    send.reset();
  }

  function handleStartAnother() {
    handleChangeStudent();
    setTemplate('');
    setMediumOverride(PREFERRED);
    setTemplateName('');
    setTemplateLanguage('');
    setTemplateParams('');
  }

  function toggleGuardian(id: string) {
    setGuardianIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  function insertPlaceholder(token: string) {
    setTemplate((current) => (current === '' ? token : `${current} ${token}`));
  }

  const lastReminder = studentId === null ? undefined : lastReminders.data?.get(studentId);

  const header = (
    <PageHeader
      title={t('reminders.title')}
      subtitle={t('reminders.description')}
      actions={[
        {
          id: 'bulk',
          helpId: 'communications.feeReminders.action.bulkSend',
          label: t('bulk.entryAction'),
          icon: <UsersIcon aria-hidden />,
          priority: 'secondary',
          onClick: () =>
            void navigate({ to: '/communications/reminders', search: { mode: 'bulk' } }),
        },
      ]}
    />
  );

  if (send.isSuccess) {
    const result = send.data;
    return (
      <PageContainer size="narrow">
        {header}
        <Card padded aria-labelledby="reminder-result-title">
          <h2 id="reminder-result-title" className="text-h2">
            {t('reminders.resultTitle')}
          </h2>
          <h3 className="mt-4 text-h3">
            {t('reminders.resultSentTitle', {
              count: result.sent.length,
              n: formatNumber(result.sent.length, config),
            })}
          </h3>
          <ul className="divide-y divide-border-subtle">
            {result.sent.map((entry) => (
              <li
                key={entry.communication_log_id}
                className="flex min-h-11 items-center justify-between gap-2"
              >
                <span>
                  {entry.guardian_name} · {t(`mediums.${entry.medium}`)}
                </span>
                <StatusBadge domain="communication" status={entry.status} />
              </li>
            ))}
          </ul>
          <h3 className="mt-4 text-h3">
            {t('reminders.resultSkippedTitle', {
              count: result.skipped.length,
              n: formatNumber(result.skipped.length, config),
            })}
          </h3>
          {result.skipped.length === 0 ? (
            <p className="mt-2 text-text-secondary">{t('recipientList.noneSkipped')}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {result.skipped.map((entry) => (
                <li
                  key={entry.guardian_id}
                  className="flex flex-col gap-0.5 py-3 md:flex-row md:justify-between md:gap-4"
                >
                  <span className="font-medium">{entry.guardian_name}</span>
                  <span className="text-text-secondary">{t(skipReasonKey(entry.reason))}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex justify-end border-t border-border-subtle pt-4">
            <Button type="button" onClick={handleStartAnother}>
              {t('reminders.startAnother')}
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow">
      {header}

      <Card padded aria-labelledby="reminder-student-title">
        <h2 id="reminder-student-title" className="text-h2">
          {t('reminders.studentSectionTitle')}
        </h2>
        <div className="mt-4">
          {studentId === null ? (
            <StudentSearch
              inputId="reminder-student-search"
              searchLabel={t('reminders.studentSearchLabel')}
              searchPlaceholder={t('reminders.studentSearchPlaceholder')}
              noResultsLabel={t('reminders.studentNoResults')}
              onSelect={handleSelectStudent}
            />
          ) : (
            <>
              <SelectedStudentRow
                name={student?.full_name ?? '…'}
                registrationNumber={student?.registration_number ?? ''}
                changeLabel={t('send.clearStudent')}
                onChange={handleChangeStudent}
              />
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
                {feeSummary.data !== undefined && (
                  <div>
                    <dt className="text-caption text-text-secondary">
                      {t('reminders.balanceLabel')}
                    </dt>
                    {/* tabular-nums per design contract §2 — this balance is
                        re-rendered as the selected student changes, and
                        proportional figures make it jitter. Effective for Latin
                        digits (`en`); a no-op on Bengali numerals, whose face
                        ships no `tnum` — see §2's note. */}
                    <dd className="font-medium tabular-nums">
                      {formatServerAmount(feeSummary.data.summary.balance, config)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-caption text-text-secondary">
                    {t('reminders.lastReminderLabel')}
                  </dt>
                  <dd className="font-medium">
                    {lastReminder === undefined
                      ? t('reminders.lastReminderNever')
                      : t('reminders.lastReminderValue', {
                          date: formatDate(new Date(lastReminder.sent_at), config),
                          medium: t(`mediums.${lastReminder.medium}`),
                        })}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </Card>

      {student !== undefined && studentId !== null && (
        <>
          <Card padded aria-labelledby="reminder-guardians-title">
            <div className="flex items-center gap-1">
              <h2 id="reminder-guardians-title" className="text-h2">
                {t('reminders.guardiansLabel')}
              </h2>
              <HelpHint
                helpId="communications.feeReminders.field.guardians"
                label={t('reminders.guardiansLabel')}
              />
            </div>
            {student.guardians.length === 0 ? (
              <p
                role="alert"
                className="mt-4 flex items-center gap-1 text-caption text-destructive"
              >
                <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                {t('reminders.noGuardians')}
              </p>
            ) : (
              <div className="mt-4 divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle">
                {student.guardians.map((guardian) => {
                  const address =
                    guardian.preferred_communication === 'EMAIL'
                      ? guardian.email
                      : guardian.phone !== null && guardian.phone !== ''
                        ? formatPhone(guardian.phone, config)
                        : null;
                  return (
                    <label
                      key={guardian.id}
                      htmlFor={`reminder-guardian-${guardian.id}`}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted"
                    >
                      <Checkbox
                        id={`reminder-guardian-${guardian.id}`}
                        checked={guardianIds.includes(guardian.id)}
                        onCheckedChange={() => toggleGuardian(guardian.id)}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span>
                          {t('reminders.guardianOptionLabel', {
                            name: guardian.full_name,
                            relationship: guardian.relationship,
                          })}
                        </span>
                        <span className="text-caption text-text-secondary">
                          {t('reminders.guardianContact', {
                            medium: t(`mediums.${guardian.preferred_communication}`),
                            address:
                              address === null || address === ''
                                ? t('reminders.guardianNoAddress')
                                : address,
                          })}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Card>

          <Card padded aria-labelledby="reminder-message-title">
            <h2 id="reminder-message-title" className="text-h2">
              {t('reminders.messageSectionTitle')}
            </h2>
            <div className="mt-4 grid gap-4">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="reminder-template"
                  helpId="communications.feeReminders.field.message"
                >
                  {t('reminders.messageLabel')}
                </Label>
                <Textarea
                  id="reminder-template"
                  value={template}
                  onChange={(event) => setTemplate(event.target.value)}
                  rows={4}
                />
                {smsInPlay && (
                  <>
                    <SmsSegmentCounter text={template} />
                    {/* The template is not what gets sent — placeholders
                        expand per student/guardian. The preview shows the
                        real per-recipient counts; this one is only a
                        composing aid. */}
                    <p className="text-caption text-text-secondary">
                      {t('reminders.smsEstimateNote')}
                    </p>
                  </>
                )}
                {(unknownTokens.length > 0 || strayBraces) && (
                  <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                    <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {strayBraces
                      ? t('reminders.strayBrace')
                      : t('reminders.unknownPlaceholder', { token: unknownTokens.join(', ') })}
                  </p>
                )}
              </div>

              <PlaceholderButtons labels={labels} onInsert={insertPlaceholder} />

              <div className="flex flex-col gap-1.5 md:w-1/2">
                <Label
                  htmlFor="reminder-medium-override"
                  helpId="communications.feeReminders.field.medium"
                >
                  {t('reminders.mediumOverrideLabel')}
                </Label>
                <Select value={mediumOverride} onValueChange={setMediumOverride}>
                  <SelectTrigger
                    id="reminder-medium-override"
                    aria-label={t('reminders.mediumOverrideLabel')}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PREFERRED}>
                      {t('reminders.mediumOverrideDefault')}
                    </SelectItem>
                    {OVERRIDE_MEDIUMS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(`mediums.${value}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {mediumOverride === 'WHATSAPP' && (
                <WhatsappTemplateFields
                  idPrefix="reminder"
                  helperText={t('reminders.whatsappHelper')}
                  templateName={templateName}
                  onTemplateNameChange={setTemplateName}
                  templateLanguage={templateLanguage}
                  onTemplateLanguageChange={setTemplateLanguage}
                  templateParams={templateParams}
                  onTemplateParamsChange={setTemplateParams}
                />
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-end">
              {/* Why there is no Send yet, in words: never previewed → the
                  standing rule; previewed-then-edited → the staleness
                  warning. */}
              {!previewMatchesInputs &&
                (acceptedPreview !== null ? (
                  <p className="text-status-due-fg md:me-auto">{t('reminders.previewStale')}</p>
                ) : (
                  <p className="text-text-secondary md:me-auto">{t('reminders.sendHint')}</p>
                ))}
              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant={previewMatchesInputs ? 'outline' : 'default'}
                  className="flex-1 md:flex-none"
                  disabled={!canPreview}
                  loading={preview.isPending}
                  onClick={handlePreview}
                >
                  {previewMatchesInputs && <RefreshCwIcon aria-hidden />}
                  {preview.isPending
                    ? t('reminders.previewing')
                    : previewMatchesInputs
                      ? t('reminders.previewAgain')
                      : t('reminders.previewAction')}
                </Button>
                <HelpHint
                  helpId="communications.feeReminders.action.preview"
                  label={t('reminders.previewAction')}
                />
              </span>
            </div>
            {preview.isError && (
              <p
                role="alert"
                className="mt-3 flex items-center gap-1 text-caption text-destructive"
              >
                <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                {preview.error instanceof ApiError && preview.error.statusCode === 400
                  ? t('reminders.previewInvalid')
                  : t('reminders.previewErrorMessage')}
              </p>
            )}
          </Card>

          {acceptedPreview !== null && previewMatchesInputs && (
            <Card padded aria-labelledby="reminder-preview-title">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="reminder-preview-title" className="text-h2">
                  {t('reminders.previewTitle')}
                </h2>
                <StatusBadge tone="success" label={t('reminders.previewFresh')} />
              </div>
              <RecipientList
                recipients={acceptedPreview.result.recipients}
                skipped={acceptedPreview.result.skipped}
              />
              <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:items-center md:justify-between">
                <p className="text-text-secondary">{t('reminders.irreversibleNote')}</p>
                {acceptedPreview.result.recipients.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Button
                      type="button"
                      className="flex-1 md:flex-none"
                      disabled={!canSend}
                      loading={send.isPending}
                      onClick={handleSend}
                    >
                      <SendIcon aria-hidden />
                      {send.isPending
                        ? t('reminders.sending')
                        : t('reminders.sendToCount', {
                            count: acceptedPreview.result.recipients.length,
                            n: formatNumber(acceptedPreview.result.recipients.length, config),
                          })}
                    </Button>
                    <HelpHint helpId="communications.feeReminders.action.send" />
                  </span>
                )}
              </div>
              {send.isError && (
                <p
                  role="alert"
                  className="mt-3 flex items-center gap-1 text-caption text-destructive"
                >
                  <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                  {send.error instanceof ApiError &&
                  send.error.statusCode === 409 &&
                  send.error.details?.['code'] === 'INSUFFICIENT_SMS_CREDIT'
                    ? t('bulk.review.projection.insufficientCredit', {
                        required: formatNumber(Number(send.error.details['required']), config),
                        available: formatNumber(Number(send.error.details['available']), config),
                      })
                    : send.error instanceof ApiError && send.error.statusCode === 400
                      ? t('reminders.sendInvalid')
                      : t('reminders.errorMessage')}
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}

function FeeRemindersPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
