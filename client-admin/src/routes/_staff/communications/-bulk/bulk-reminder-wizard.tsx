/**
 * [8.11.9]'s bulk fee-reminder wizard: Recipients (dues filters +
 * explicit selection, ≤500) → Message (named batch, template, channels)
 * → Review (mandatory server preview) → submit.
 *
 * Rendered as a `FullPageShell` (D21/D22/D23: a flow with steps and a
 * table is a full-page modal on the host route `?mode=bulk`); the step row
 * is local (`wizard-steps.tsx`) because `WizardShell` brings its own `h1`
 * and footer.
 *
 * Two rules carried over from the single-reminder page, because a sent
 * SMS cannot be recalled:
 *
 * 1. **Filters never define the recipient set** — `useFeeDues` only
 *    proposes rows; a student is included exactly when the sender ticked
 *    their checkbox. The running "N of 500" counter is that promise made
 *    visible.
 * 2. **Nothing sends until the server preview matches the current
 *    inputs.** The review step fingerprints every input the preview
 *    depends on; editing any earlier step changes the fingerprint,
 *    which swaps the footer button back to Preview until the preview is
 *    re-run. Client-side guessing can't reproduce the server's skip
 *    logic, so the preview is `POST /reminder/bulk/preview`, not a local
 *    computation.
 */
import { FeeStatus } from '@biddaloy/shared';
import { ApiError, captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Input,
  HelpHint,
  Label,
  Textarea,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useBulkReminderPreview,
  useClasses,
  useClassSections,
  useFeeDues,
  useSendBulkReminder,
  type BulkReminderPreview,
  type FeeDueRow,
  type SendBulkReminderInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  FullPageShell,
  useWizardShellStep,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import {
  formatMonthName,
  formatNumber,
  formatServerAmount,
  renderDigits,
} from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { PlaceholderButtons } from '../-shared/placeholder-buttons';
import { RecipientList } from '../-shared/recipient-list';
import { MAX_BULK_REMINDER_STUDENTS } from '../-shared/reminder-limits';
import { skipReasonKey } from '../-shared/skip-reason';
import { SmsSegmentCounter } from '../-shared/sms-segment-counter';
import {
  findUnknownLabels,
  hasStrayBraces,
  findUnsupportedPlaceholders,
  toServerTemplate,
  usePlaceholderLabels,
} from '../-shared/template-placeholders';
import { splitTemplateParams, WhatsappTemplateFields } from '../-shared/whatsapp-template-fields';

import { BulkSmsProjectionCard } from './bulk-sms-projection-card';
import { WizardSteps } from './wizard-steps';

/** Mirror of the server's `MAX_BULK_REMINDER_STUDENTS` (`@ArrayMaxSize`
 * on `SendBulkReminderDto.student_ids`) — enforced here so the sender
 * learns about the cap while selecting, not from a 400. */
const MAX_STUDENTS = MAX_BULK_REMINDER_STUDENTS;

const STEP_IDS = ['recipients', 'message', 'review'] as const;
type StepId = (typeof STEP_IDS)[number];

const BULK_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type BulkMedium = (typeof BULK_MEDIUMS)[number];

export function BulkReminderWizard() {
  const { t } = useTranslation('communications');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const labels = usePlaceholderLabels();

  const [stepId, setStepId] = useWizardShellStep(STEP_IDS);

  // --- Recipients step state -------------------------------------------
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  // --- Message step state ----------------------------------------------
  const [batchName, setBatchName] = React.useState('');
  /** Display form (`{Student name}`); `serverTemplate` is what goes on the wire. */
  const [template, setTemplate] = React.useState('');
  const [mediums, setMediums] = React.useState<ReadonlySet<BulkMedium>>(
    () => new Set<BulkMedium>(BULK_MEDIUMS),
  );
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');

  // --- Review step state (same guard shape as `reminders.tsx`) ---------
  const [acceptedPreview, setAcceptedPreview] = React.useState<{
    fingerprint: string;
    result: BulkReminderPreview;
  } | null>(null);
  const previewRequestRef = React.useRef(0);

  const classId = filters['classId'];
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId);
  const duesQuery = useFeeDues({
    page,
    limit: pageSize,
    ...(classId !== undefined ? { class_id: classId } : {}),
    ...(filters['sectionId'] !== undefined ? { section_id: filters['sectionId'] } : {}),
    ...(filters['month'] !== undefined ? { month: Number(filters['month']) } : {}),
    ...(filters['year'] !== undefined ? { year: Number(filters['year']) } : {}),
    ...(filters['status'] !== undefined
      ? { status: filters['status'] as FeeStatus.PENDING | FeeStatus.PARTIALLY_PAID }
      : {}),
  });

  const preview = useBulkReminderPreview();
  const send = useSendBulkReminder();

  const serverTemplate = toServerTemplate(template, labels);
  const strayBraces = hasStrayBraces(template, labels);
  const unknownTokens = [
    ...findUnknownLabels(template, labels).map((word) => `{${word}}`),
    ...findUnsupportedPlaceholders(serverTemplate),
  ];
  const selectedCount = selectedIds.size;

  /** Every input the server preview depends on, in canonical order —
   * mutating any earlier step changes this string, which invalidates the
   * review step until the preview is re-run against the new inputs. */
  const fingerprint = JSON.stringify({
    studentIds: Array.from(selectedIds).sort(),
    batchName,
    template: serverTemplate,
    mediums: Array.from(mediums).sort(),
    templateName,
    templateLanguage,
    templateParams,
  });

  const previewMatchesInputs =
    acceptedPreview !== null && acceptedPreview.fingerprint === fingerprint;

  function buildInput(): SendBulkReminderInput {
    const params = splitTemplateParams(templateParams);
    return {
      student_ids: Array.from(selectedIds).sort(),
      message_template: serverTemplate,
      batch_name: batchName.trim(),
      mediums: Array.from(mediums).sort(),
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(mediums.has('WHATSAPP') && templateName.trim() !== ''
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
    // Snapshot before the request, and discard out-of-order responses —
    // same reasoning as the single-reminder page's own handler.
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const requestedFingerprint = fingerprint;
    preview.mutate(buildInput(), {
      onSuccess: (result) => {
        if (previewRequestRef.current !== requestId) return;
        setAcceptedPreview({ fingerprint: requestedFingerprint, result });
      },
    });
  }

  function handleSubmit() {
    if (!previewMatchesInputs) return;
    const notifyTenantId = captureNotificationTenant();
    // Queued, not sent: `POST /communications/reminder/bulk` only enqueues
    // (`ui/src/hooks/reminders.ts:22-30`). The terminal outcome is produced
    // by the batch detail route, the only place that polls for it.
    send.mutate(buildInput(), {
      onSuccess: () =>
        notifyOutcome({
          tenantId: notifyTenantId,
          variant: 'info',
          message: t('notifications.batchQueued'),
        }),
      onError: () =>
        notifyOutcome({
          tenantId: notifyTenantId,
          variant: 'error',
          message: t('notifications.batchQueueFailed'),
        }),
    });
  }

  /** 400s as one translated sentence (the server's own text is English),
   * 429 as the rate-limit note (`POST /reminder/bulk*` is STRICT_RATE_LIMIT
   * 5/min), anything else generic. */
  function requestErrorMessage(error: unknown, invalidKey: string, fallbackKey: string): string {
    if (error instanceof ApiError && error.statusCode === 400) return t(invalidKey);
    if (error instanceof ApiError && error.statusCode === 429) return t('bulk.review.rateLimited');
    return t(fallbackKey);
  }

  /** [15.6.8/#551] `reminders.service.ts`'s 409 on send — `details.code ===
   * 'INSUFFICIENT_SMS_CREDIT'` carries `required`/`available` the review
   * step's own preview-time shortfall can't guarantee still matches (a
   * concurrent send from elsewhere can eat the balance between preview and
   * submit). `undefined` for every other error, so the caller falls back
   * to `requestErrorMessage`'s generic handling. */
  function insufficientCreditMessage(error: unknown): string | undefined {
    if (!(error instanceof ApiError) || error.statusCode !== 409) return undefined;
    if (error.details?.code !== 'INSUFFICIENT_SMS_CREDIT') return undefined;
    return t('bulk.review.projection.insufficientCredit', {
      required: formatNumber(Number(error.details.required), config),
      available: formatNumber(Number(error.details.available), config),
    });
  }

  function handleFilterChange(patch: Record<string, string | null>) {
    setFilters((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') delete next[key];
        else next[key] = value;
      }
      // A class change invalidates any picked section, same dependency
      // `fees/dues.tsx` enforces.
      if ('classId' in patch && !('sectionId' in patch)) delete next['sectionId'];
      return next;
    });
    setPage(1);
  }

  function toggleMedium(medium: BulkMedium) {
    setMediums((current) => {
      const next = new Set(current);
      if (next.has(medium)) next.delete(medium);
      else next.add(medium);
      return next;
    });
  }

  function insertPlaceholder(token: string) {
    setTemplate((current) => (current === '' ? token : `${current} ${token}`));
  }

  const currentYear = new Date().getFullYear();
  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'classId',
      label: t('bulk.recipients.filterClass'),
      allLabel: t('bulk.recipients.allOption'),
      options: (classesQuery.data?.data ?? []).map((cls) => ({ value: cls.id, label: cls.name })),
    },
    {
      kind: 'select',
      key: 'sectionId',
      label: t('bulk.recipients.filterSection'),
      allLabel: t('bulk.recipients.allOption'),
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'month',
      label: t('bulk.recipients.filterMonth'),
      allLabel: t('bulk.recipients.allOption'),
      options: Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: formatMonthName(i + 1, config),
      })),
    },
    {
      kind: 'select',
      key: 'year',
      label: t('bulk.recipients.filterYear'),
      allLabel: t('bulk.recipients.allOption'),
      options: [currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((year) => ({
        value: String(year),
        label: renderDigits(String(year), config.numerals),
      })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('bulk.recipients.filterStatus'),
      allLabel: t('bulk.recipients.allOption'),
      options: [
        { value: FeeStatus.PENDING, label: t('bulk.recipients.statusPending') },
        { value: FeeStatus.PARTIALLY_PAID, label: t('bulk.recipients.statusPartiallyPaid') },
      ],
    },
  ];

  const dueRows = duesQuery.data?.data ?? [];
  const columns: DataTableColumn<FeeDueRow>[] = [
    {
      id: 'student',
      header: t('bulk.recipients.nameHeader'),
      card: 'title',
      accessorFn: (row) => (
        <>
          <p className="font-medium">{row.full_name}</p>
          <p className="text-caption text-text-secondary">{row.registration_number}</p>
        </>
      ),
    },
    {
      id: 'classSection',
      header: t('bulk.recipients.classSectionHeader'),
      accessorFn: (row) => `${row.class_name ?? '—'} · ${row.section_name ?? '—'}`,
    },
    {
      id: 'due',
      header: t('bulk.recipients.dueHeader'),
      align: 'end',
      accessorFn: (row) => formatServerAmount(row.total_due, config),
    },
    {
      id: 'monthsOverdue',
      header: t('bulk.recipients.monthsOverdueHeader'),
      align: 'end',
      accessorFn: (row) => formatNumber(row.months_overdue, config),
    },
  ];

  const smsInPlay = mediums.has('SMS');

  const previewResult = previewMatchesInputs ? acceptedPreview.result : null;
  const projection = previewResult?.projection;
  // [15.6.8/#551] Send is only ever blocked by metering short of the
  // projected units — OFF (unmetered/own provider) never blocks on
  // credit, whatever `sms_units` says.
  const creditBlocked = projection?.metering === 'PLATFORM' && (projection.shortfall ?? 0) > 0;

  // Student-level and guardian-level skips flattened into one
  // reason-grouped view — "7 students skipped" alone would hide *why*.
  const skippedByReason = new Map<string, number>();
  if (previewResult !== null) {
    for (const student of previewResult.students) {
      for (const entry of student.skipped) {
        skippedByReason.set(entry.reason, (skippedByReason.get(entry.reason) ?? 0) + 1);
      }
    }
  }

  const stepValid: Record<StepId, boolean> = {
    recipients: selectedCount >= 1 && selectedCount <= MAX_STUDENTS,
    message:
      batchName.trim() !== '' &&
      template.trim() !== '' &&
      unknownTokens.length === 0 &&
      !strayBraces &&
      mediums.size >= 1,
    review:
      previewMatchesInputs &&
      (previewResult?.recipients_count ?? 0) > 0 &&
      !send.isPending &&
      !creditBlocked,
  };

  const stepLabels = [
    t('bulk.steps.recipients'),
    t('bulk.steps.message'),
    t('bulk.steps.review'),
  ] as const;
  const currentIndex = Math.max(0, STEP_IDS.indexOf(stepId as StepId));
  const currentStepId = STEP_IDS[currentIndex] ?? 'recipients';

  // Steps stay mounted once visited, so Back keeps filters and selection.
  const [visited, setVisited] = React.useState<ReadonlySet<StepId>>(() => new Set([currentStepId]));
  React.useEffect(() => {
    setVisited((prev) => (prev.has(currentStepId) ? prev : new Set(prev).add(currentStepId)));
  }, [currentStepId]);

  // Next/Back is the same footer button across a step change, so keyboard
  // focus would stay at the very bottom of the new step: move it to the
  // step announcement, as `WizardShell` does.
  const announcementRef = React.useRef<HTMLDivElement>(null);
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    announcementRef.current?.focus();
  }, [currentStepId]);

  function goNext() {
    const next = STEP_IDS[currentIndex + 1];
    if (stepValid[currentStepId] && next !== undefined) setStepId(next);
  }

  function goBack() {
    const previous = STEP_IDS[currentIndex - 1];
    if (previous !== undefined) setStepId(previous);
  }

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const close = () =>
    void navigate({
      to: '/communications/reminders',
      search: { mode: undefined, step: undefined },
    });
  const dirty = !send.isSuccess && (selectedCount > 0 || batchName !== '' || template !== '');

  let primary: React.ComponentProps<typeof FullPageShell>['primary'];
  if (send.isSuccess) {
    const batchId = send.data.id;
    primary = {
      label: t('bulk.result.viewBatch'),
      onClick: () => void navigate({ to: '/communications/batches/$batchId', params: { batchId } }),
    };
  } else if (currentStepId === 'recipients') {
    primary = {
      label: t('bulk.nextToMessage'),
      onClick: goNext,
      disabled: !stepValid.recipients,
    };
  } else if (currentStepId === 'message') {
    primary = { label: t('bulk.nextToReview'), onClick: goNext, disabled: !stepValid.message };
  } else if (!previewMatchesInputs) {
    primary = {
      label: preview.isPending ? t('bulk.review.previewing') : t('bulk.review.previewAction'),
      onClick: handlePreview,
      busy: preview.isPending,
    };
  } else {
    const count = previewResult?.recipients_count ?? 0;
    primary = {
      label: t('bulk.sendToCount', { count, n: formatNumber(count, config) }),
      onClick: handleSubmit,
      busy: send.isPending,
      disabled: !stepValid.review,
    };
  }

  const secondary = send.isSuccess
    ? undefined
    : currentIndex === 0
      ? {
          label: tCommon('actions.cancel'),
          onClick: () => (dirty ? setDiscardOpen(true) : close()),
        }
      : { label: t('bulk.back'), onClick: goBack };

  return (
    <FullPageShell
      title={t('bulk.title')}
      size="wide"
      onClose={close}
      dirty={dirty}
      primary={primary}
      {...(secondary !== undefined ? { secondary } : {})}
    >
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="danger"
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscardOpen(false);
          close();
        }}
      />
      {send.isSuccess ? (
        <Card padded aria-labelledby="bulk-result-title">
          <h2 id="bulk-result-title" className="text-h2">
            {t('bulk.result.title')}
          </h2>
          <p className="mt-1 text-text-secondary">
            {t('bulk.result.queued', { name: send.data.batch_name })}
          </p>
        </Card>
      ) : (
        <>
          <WizardSteps
            labels={stepLabels}
            currentIndex={currentIndex}
            onStepClick={(index) => {
              const target = STEP_IDS[index];
              if (target !== undefined && index < currentIndex) setStepId(target);
            }}
          />
          <div ref={announcementRef} tabIndex={-1} aria-live="polite" className="sr-only">
            {tCommon('wizard.stepAnnouncement', {
              current: currentIndex + 1,
              total: STEP_IDS.length,
              label: stepLabels[currentIndex] ?? '',
            })}
          </div>

          <div hidden={currentStepId !== 'recipients'}>
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-h2">{t('bulk.recipients.title')}</h2>
                <p className="mt-1 text-text-secondary">{t('bulk.recipients.help')}</p>
              </div>
              <FilterBar
                fields={filterFields}
                values={filters}
                onChange={handleFilterChange}
                {...(duesQuery.data !== undefined ? { resultCount: duesQuery.data.total } : {})}
              />

              {/* The AC's "explicit selection" counter — announced politely so
                  a keyboard/screen-reader user always knows the running total
                  without leaving the table. */}
              <p aria-live="polite" className="font-medium">
                {t('bulk.recipients.selectedCount', {
                  n: formatNumber(selectedCount, config),
                  max: formatNumber(MAX_STUDENTS, config),
                })}
              </p>
              {selectedCount > MAX_STUDENTS && (
                <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                  <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                  {t('bulk.recipients.overCap', {
                    max: formatNumber(MAX_STUDENTS, config),
                    excess: formatNumber(selectedCount - MAX_STUDENTS, config),
                  })}
                </p>
              )}

              <DataTable
                tableId="bulk-reminder-recipients"
                caption={t('bulk.recipients.tableCaption')}
                columns={columns}
                data={dueRows}
                getRowId={(row) => row.student_id}
                sorting={null}
                onSortingChange={() => undefined}
                page={page}
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                totalCount={duesQuery.data?.total ?? 0}
                onPageChange={setPage}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
                loading={duesQuery.isPending}
                isFetching={duesQuery.isFetching}
                {...(duesQuery.isError ? { error: t('bulk.recipients.loadError') } : {})}
                emptyState={{
                  title: t('bulk.recipients.empty'),
                  explanation: t('bulk.recipients.emptyHelp'),
                }}
              />
            </div>
          </div>

          {visited.has('message') && (
            <div hidden={currentStepId !== 'message'}>
              <div className="flex flex-col gap-3">
                <div>
                  <h2 className="text-h2">{t('bulk.message.title')}</h2>
                  <p className="mt-1 text-text-secondary">{t('bulk.message.help')}</p>
                </div>
                <Card padded>
                  <div className="grid gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="bulk-batch-name">{t('bulk.message.batchNameLabel')}</Label>
                      <Input
                        id="bulk-batch-name"
                        value={batchName}
                        onChange={(event) => setBatchName(event.target.value)}
                        required
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="inline-flex items-center gap-1">
                        <Label htmlFor="bulk-template">{t('bulk.message.messageLabel')}</Label>
                        <HelpHint helpId="communications.feeReminders.section.bulkMessage" />
                      </span>
                      <Textarea
                        id="bulk-template"
                        value={template}
                        onChange={(event) => setTemplate(event.target.value)}
                        rows={4}
                        required
                      />
                      {smsInPlay && (
                        <>
                          <SmsSegmentCounter text={template} />
                          <p className="text-caption text-text-secondary">
                            {t('reminders.smsEstimateNote')}
                          </p>
                        </>
                      )}
                      {(unknownTokens.length > 0 || strayBraces) && (
                        <p
                          role="alert"
                          className="flex items-center gap-1 text-caption text-destructive"
                        >
                          <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                          {strayBraces
                            ? t('reminders.strayBrace')
                            : t('reminders.unknownPlaceholder', {
                                token: unknownTokens.join(', '),
                              })}
                        </p>
                      )}
                    </div>

                    <PlaceholderButtons labels={labels} onInsert={insertPlaceholder} />

                    <fieldset>
                      {/* The (?) sits outside the legend so it stays out of the group's name. */}
                      <legend className="sr-only">{t('bulk.message.mediumsLabel')}</legend>
                      <div className="mb-1.5 flex items-center gap-1 text-label text-text-primary">
                        <span aria-hidden="true">{t('bulk.message.mediumsLabel')}</span>
                        <HelpHint helpId="communications.feeReminders.field.bulkMediums" />
                      </div>
                      <div className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle">
                        {BULK_MEDIUMS.map((medium) => (
                          <label
                            key={medium}
                            htmlFor={`bulk-medium-${medium}`}
                            className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted md:min-h-8"
                          >
                            <Checkbox
                              id={`bulk-medium-${medium}`}
                              checked={mediums.has(medium)}
                              onCheckedChange={() => toggleMedium(medium)}
                            />
                            {t(`mediums.${medium}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {mediums.has('WHATSAPP') && (
                      <WhatsappTemplateFields
                        idPrefix="bulk"
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
                </Card>
              </div>
            </div>
          )}

          {visited.has('review') && (
            <div hidden={currentStepId !== 'review'}>
              <div className="flex flex-col gap-3">
                <div>
                  <h2 className="text-h2">{t('bulk.review.title')}</h2>
                  {/* Why sending is not yet possible, in words — never
                      previewed vs. previewed-then-edited, same split as the
                      single page. */}
                  {acceptedPreview !== null && !previewMatchesInputs ? (
                    <p className="mt-1 text-status-due-fg">{t('bulk.review.stale')}</p>
                  ) : (
                    acceptedPreview === null && (
                      <p className="mt-1 text-text-secondary">
                        {t('bulk.review.notPreviewedHint')}
                      </p>
                    )
                  )}
                </div>

                {preview.isError && (
                  <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                    <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {requestErrorMessage(
                      preview.error,
                      'bulk.review.previewInvalid',
                      'bulk.review.previewErrorMessage',
                    )}
                  </p>
                )}

                {previewResult !== null && (
                  <Card padded aria-label={t('bulk.steps.review')} className="flex flex-col gap-4">
                    <p className="font-medium">
                      {t('bulk.review.summary', {
                        recipients: formatNumber(previewResult.recipients_count, config),
                        skipped: formatNumber(previewResult.skipped_count, config),
                      })}
                    </p>
                    {previewResult.recipients_count === 0 && (
                      <p
                        role="alert"
                        className="flex items-center gap-1 text-caption text-destructive"
                      >
                        <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                        {t('bulk.review.noRecipients')}
                      </p>
                    )}

                    {projection !== undefined && <BulkSmsProjectionCard projection={projection} />}

                    {skippedByReason.size > 0 && (
                      <div>
                        <h3 className="text-h3">{t('bulk.review.skippedByReasonTitle')}</h3>
                        <ul className="divide-y divide-border-subtle">
                          {Array.from(skippedByReason.entries()).map(([reason, count]) => (
                            <li key={reason} className="flex justify-between gap-4 py-3">
                              <span>{t(skipReasonKey(reason))}</span>
                              <span className="text-text-secondary">
                                {t('bulk.review.reasonCount', {
                                  count,
                                  n: formatNumber(count, config),
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <h3 className="text-h3">{t('bulk.review.perStudentTitle')}</h3>
                      <div className="mt-2 divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle">
                        {previewResult.students.map((student) => (
                          <details key={student.student_id}>
                            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 font-medium">
                              {student.student_name} ·{' '}
                              {t('bulk.review.studentRecipients', {
                                count: student.recipients.length,
                                n: formatNumber(student.recipients.length, config),
                              })}{' '}
                              ·{' '}
                              {t('bulk.review.studentSkipped', {
                                count: student.skipped.length,
                                n: formatNumber(student.skipped.length, config),
                              })}
                            </summary>
                            <div className="px-3 pb-3">
                              <RecipientList
                                recipients={student.recipients}
                                skipped={student.skipped}
                              />
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}

                {send.isError && (
                  <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                    <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {insufficientCreditMessage(send.error) ??
                      requestErrorMessage(
                        send.error,
                        'bulk.review.sendInvalid',
                        'bulk.review.sendErrorMessage',
                      )}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </FullPageShell>
  );
}
