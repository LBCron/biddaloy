import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  HelpHint,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NoticeBar,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  RoutePending,
  StatusBadge,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useCommunicationLog,
  useSendCommunication,
  type Guardian,
  type SendCommunicationInput,
  type Student,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleAlertIcon, SendIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { deliveryErrorKey } from './-shared/delivery-error';
import { SelectedStudentRow } from './-shared/selected-student-row';
import { useSmsReadiness } from './-shared/sms-readiness';
import { SmsSegmentCounter } from './-shared/sms-segment-counter';
import { StudentSearch } from './-shared/student-search';
import { splitTemplateParams, WhatsappTemplateFields } from './-shared/whatsapp-template-fields';

/**
 * `/communications/send` — [8.11.9]'s Send Message page: one
 * staff-composed message to one recipient via `POST /communications/send`.
 *
 * The worker only has providers for SMS / WHATSAPP / EMAIL — a
 * PHONE_CALL or MESSENGER send would be accepted and then marked FAILED
 * (`No provider registered for medium …`), so the channel `Select` offers
 * exactly the three deliverable ones.
 *
 * This endpoint has no server preview (unlike the reminder routes), so
 * the shared "nothing sends until the sender has seen exactly what will
 * go out" rule is implemented as a confirm `Dialog` restating recipient,
 * channel and the full message — the pattern
 * `academic-years/-set-current-dialog.tsx` established.
 *
 * [8.14.17]: the permission check that used to live here (an `EmptyState`
 * shown when the viewer lacked `COMMUNICATION_SEND`) is gone — `_staff.tsx`'s
 * `RequirePermission` now refuses the whole route in place, keyed off the
 * same permission (`route-permissions.ts`), before this component ever
 * mounts. Duplicating the check here would be dead code.
 */
export const Route = createFileRoute('/_staff/communications/send')({
  loader: () => loadRouteNamespaces('communications'),
  pendingComponent: SendMessagePending,
  component: SendMessageForm,
});

const SENDABLE_MEDIUMS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
type SendableMedium = (typeof SENDABLE_MEDIUMS)[number];

/** Address a guardian is reachable at for the chosen channel — email for
 * EMAIL, phone (else alternate phone) otherwise, the server's
 * `addressForMedium` rule. `null` means "no address on file", which the
 * picker shows rather than silently prefilling nothing. */
function guardianAddressFor(guardian: Guardian, medium: SendableMedium): string | null {
  return medium === 'EMAIL'
    ? guardian.email || null
    : guardian.phone || guardian.alternate_phone || null;
}

function SendMessageForm() {
  // Phone numbers and counters render in the tenant's own region settings.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <SendMessageBody />
    </RegionConfigProvider>
  );
}

function SendMessageBody() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const sendMessage = useSendCommunication();

  const [medium, setMedium] = React.useState<SendableMedium>('SMS');
  const [subject, setSubject] = React.useState('');
  const [messageBody, setMessageBody] = React.useState('');
  const [templateName, setTemplateName] = React.useState('');
  const [templateLanguage, setTemplateLanguage] = React.useState('');
  const [templateParams, setTemplateParams] = React.useState('');
  const [student, setStudent] = React.useState<Student | null>(null);
  const [guardianId, setGuardianId] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // [78 D37/D38] Warn, never block, when SMS cannot go out right now. Called
  // here, above the result-panel early return, so the hook order is stable.
  const readiness = useSmsReadiness(medium === 'SMS');

  // Refreshes the queued message's delivery status after the send — the
  // 201 body always says QUEUED (dispatch is async via BullMQ), so the
  // result panel reads the log entry for where the message actually is.
  const sentLog = useCommunicationLog(sendMessage.data?.id);

  // Typed-but-unsent content is lost on leave — ask first.
  useWarnUnsavedChanges(
    !sendMessage.isSuccess &&
      (subject !== '' || messageBody !== '' || templateName !== '' || student !== null),
  );

  // [#2259] The server reads the address from the guardian's record; the page
  // only shows it. No guardian, or none for this channel, means Send stays off.
  const selectedGuardian =
    student?.guardians.find((guardian) => guardian.id === guardianId) ?? null;
  const address = selectedGuardian === null ? null : guardianAddressFor(selectedGuardian, medium);
  const canSend = selectedGuardian !== null && address !== null && address !== '';

  function buildPayload(): SendCommunicationInput {
    const params = splitTemplateParams(templateParams);
    return {
      medium,
      message_body: messageBody,
      guardian_id: guardianId ?? '',
      // `exactOptionalPropertyTypes` — omit rather than set `undefined`.
      ...(medium === 'EMAIL' && subject.trim() !== '' ? { subject: subject.trim() } : {}),
      ...(student !== null ? { student_id: student.id } : {}),
      ...(medium === 'WHATSAPP' && templateName.trim() !== ''
        ? {
            template_name: templateName.trim(),
            ...(templateLanguage.trim() !== ''
              ? { template_language: templateLanguage.trim() }
              : {}),
            ...(params.length > 0 ? { template_params: params } : {}),
          }
        : {}),
    };
  }

  function errorText(error: unknown): string {
    if (
      error instanceof ApiError &&
      error.statusCode === 409 &&
      error.details?.['code'] === 'INSUFFICIENT_SMS_CREDIT'
    ) {
      return t('bulk.review.projection.insufficientCredit', {
        required: formatNumber(Number(error.details['required']), config),
        available: formatNumber(Number(error.details['available']), config),
      });
    }
    if (error instanceof ApiError && error.statusCode === 400) {
      const code = error.details?.['code'];
      if (code === 'GUARDIAN_NO_ADDRESS') return t('send.errorNoAddress');
      if (code === 'GUARDIAN_NOT_LINKED') return t('send.errorNotLinked');
      return t('send.errorInvalid');
    }
    return t('send.errorMessage');
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    sendMessage.reset();
    setConfirmOpen(true);
  }

  // A stale send error must not greet the next open of the dialog.
  function handleConfirmOpenChange(open: boolean) {
    // Closing mid-request would detach the mutation: the send still lands but
    // the success state never renders, inviting a double send.
    if (!open && sendMessage.isPending) return;
    if (!open) sendMessage.reset();
    setConfirmOpen(open);
  }

  function handleConfirm() {
    sendMessage.mutate(buildPayload(), {
      onSuccess: () => setConfirmOpen(false),
    });
  }

  function handleSelectStudent(selected: Student) {
    setStudent(selected);
    setGuardianId(null);
  }

  function handleReset() {
    sendMessage.reset();
    setMessageBody('');
    setSubject('');
    setTemplateName('');
    setTemplateLanguage('');
    setTemplateParams('');
    setStudent(null);
    setGuardianId(null);
  }

  if (sendMessage.isSuccess) {
    const status = sentLog.data?.status ?? sendMessage.data.status;
    const failed = status === 'FAILED';
    const failureKey = deliveryErrorKey(sentLog.data?.error ?? null);
    return (
      <PageContainer size="narrow">
        <PageHeader title={t('send.title')} subtitle={t('send.description')} />
        <Card padded aria-labelledby="send-result-title">
          <h2 id="send-result-title" className="text-h2">
            {failed ? t('send.failedTitle') : t('send.resultTitle')}
          </h2>
          {failed ? (
            <div className="mt-1 flex flex-col gap-2 text-status-overdue-fg">
              <p>{t(failureKey ?? 'deliveryErrors.generic', { medium: t(`mediums.${medium}`) })}</p>
              {failureKey === 'deliveryErrors.notConfigured' ? (
                <Link
                  to="/settings"
                  search={{ section: 'communication' }}
                  className="text-link underline"
                >
                  {t('send.settingsLink')}
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-text-secondary">
              {t('send.resultDescription', { name: sendMessage.data.recipient_name })}
            </p>
          )}
          <dl className="mt-4 flex items-center gap-2">
            <dt className="text-text-secondary">{t('send.resultStatusLabel')}</dt>
            <dd>
              <StatusBadge domain="communication" status={status} />
            </dd>
          </dl>
          <div className="mt-5 flex justify-end border-t border-border-subtle pt-4">
            <Button type="button" onClick={handleReset}>
              {t('send.sendAnother')}
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  const isEmail = medium === 'EMAIL';
  const smsNotReady =
    medium === 'SMS' && readiness.data && readiness.data.sms !== 'READY'
      ? readiness.data.sms
      : null;
  const formatAddress = (address: string) => (isEmail ? address : formatPhone(address, config));

  return (
    <PageContainer size="narrow">
      <PageHeader title={t('send.title')} subtitle={t('send.description')} />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card padded aria-labelledby="send-recipient-title">
          <h2 id="send-recipient-title" className="text-h2">
            {t('send.recipientSectionTitle')}
          </h2>
          <p className="mt-1 text-text-secondary">{t('send.recipientSectionHelp')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              {student === null ? (
                <Label htmlFor="send-student-search">{t('send.linkStudentTitle')}</Label>
              ) : (
                <span className="text-label text-text-primary">{t('send.linkStudentTitle')}</span>
              )}
              {student === null ? (
                <StudentSearch
                  inputId="send-student-search"
                  searchLabel={t('send.linkStudentTitle')}
                  searchPlaceholder={t('send.studentSearchPlaceholder')}
                  noResultsLabel={t('send.studentNoResults')}
                  onSelect={handleSelectStudent}
                />
              ) : (
                <SelectedStudentRow
                  name={student.full_name}
                  registrationNumber={student.registration_number}
                  changeLabel={t('send.clearStudent')}
                  onChange={() => {
                    setStudent(null);
                    setGuardianId(null);
                  }}
                />
              )}
            </div>

            {student !== null && (
              // The group is named by the text span only, so the (?) stays out of its name.
              <fieldset className="md:col-span-2" aria-labelledby="send-guardian-pick-label">
                <legend className="mb-1.5 text-label text-text-primary">
                  <span className="inline-flex items-center gap-1">
                    <span id="send-guardian-pick-label">{t('send.guardianPickLabel')}</span>
                    <HelpHint
                      helpId="communications.sendMessage.field.guardian"
                      label={t('send.guardianPickLabel')}
                    />
                  </span>
                </legend>
                <RadioGroup
                  aria-label={t('send.guardianListLabel', { name: student.full_name })}
                  value={guardianId ?? ''}
                  onValueChange={(value) => {
                    const guardian = student.guardians.find((candidate) => candidate.id === value);
                    if (guardian !== undefined) setGuardianId(guardian.id);
                  }}
                  className="gap-0 divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle"
                >
                  {student.guardians.map((guardian) => {
                    const address = guardianAddressFor(guardian, medium);
                    const optionLabel = t('send.guardianOptionLabel', {
                      name: guardian.full_name,
                      relationship: guardian.relationship,
                    });
                    return (
                      <label
                        key={guardian.id}
                        htmlFor={`send-guardian-${guardian.id}`}
                        className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted"
                      >
                        <RadioGroupItem
                          id={`send-guardian-${guardian.id}`}
                          value={guardian.id}
                          aria-label={optionLabel}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span>{optionLabel}</span>
                          <span className="text-caption text-text-secondary">
                            {address === null || address === ''
                              ? t('send.guardianNoAddress')
                              : formatAddress(address)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>
              </fieldset>
            )}

            {selectedGuardian !== null && (
              <dl className="grid gap-0.5 md:col-span-2">
                <dt className="text-label text-text-primary">
                  {isEmail ? t('send.recipientEmailLabel') : t('send.recipientAddressLabel')}
                </dt>
                <dd>{canSend && address ? formatAddress(address) : t('send.guardianNoAddress')}</dd>
              </dl>
            )}
          </div>
        </Card>

        <Card padded>
          <h2 className="text-h2">{t('send.messageSectionTitle')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-medium" helpId="communications.sendMessage.field.medium">
                {t('send.mediumLabel')}
              </Label>
              <Select value={medium} onValueChange={(value) => setMedium(value as SendableMedium)}>
                <SelectTrigger
                  id="send-medium"
                  aria-label={t('send.mediumLabel')}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDABLE_MEDIUMS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`mediums.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {smsNotReady && (
                <NoticeBar tone="warning">{t(`send.smsNotReady.${smsNotReady}`)}</NoticeBar>
              )}
            </div>

            {isEmail && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-subject">{t('send.subjectLabel')}</Label>
                <Input
                  id="send-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="send-message" helpId="communications.sendMessage.field.message">
                {t('send.messageLabel')}
              </Label>
              <Textarea
                id="send-message"
                value={messageBody}
                onChange={(event) => setMessageBody(event.target.value)}
                required
                rows={5}
              />
              {medium === 'SMS' && <SmsSegmentCounter text={messageBody} />}
            </div>

            {medium === 'WHATSAPP' && (
              <div className="md:col-span-2">
                <WhatsappTemplateFields
                  idPrefix="send"
                  helperText={t('send.whatsappHelper')}
                  templateName={templateName}
                  onTemplateNameChange={setTemplateName}
                  templateLanguage={templateLanguage}
                  onTemplateLanguageChange={setTemplateLanguage}
                  templateParams={templateParams}
                  onTemplateParamsChange={setTemplateParams}
                />
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
            <span className="inline-flex items-center gap-1">
              <Button type="submit" className="flex-1 md:flex-none" disabled={!canSend}>
                <SendIcon aria-hidden />
                {t('send.submit')}
              </Button>
              <HelpHint helpId="communications.sendMessage.action.send" label={t('send.submit')} />
            </span>
          </div>
        </Card>
      </form>

      <Dialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
        <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
          <DialogHeader>
            <DialogTitle>{t('send.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('send.confirmDescription')}</DialogDescription>
          </DialogHeader>
          <dl className="grid gap-2">
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmRecipientLabel')}</dt>
              <dd>
                {selectedGuardian?.full_name} · {canSend && address ? formatAddress(address) : ''}
              </dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmChannelLabel')}</dt>
              <dd>{t(`mediums.${medium}`)}</dd>
            </div>
            {isEmail && subject.trim() !== '' && (
              <div className="grid gap-0.5">
                <dt className="font-medium">{t('send.confirmSubjectLabel')}</dt>
                <dd>{subject.trim()}</dd>
              </div>
            )}
            <div className="grid gap-0.5">
              <dt className="font-medium">{t('send.confirmMessageLabel')}</dt>
              <dd className="whitespace-pre-wrap">{messageBody}</dd>
            </div>
          </dl>
          {selectedGuardian !== null && (
            <p className="text-caption text-text-secondary">
              {t('send.guardianOptionLabel', {
                name: selectedGuardian.full_name,
                relationship: selectedGuardian.relationship,
              })}
            </p>
          )}
          {sendMessage.isError && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
              {errorText(sendMessage.error)}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={sendMessage.isPending}>
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="button" loading={sendMessage.isPending} onClick={handleConfirm}>
              {sendMessage.isPending ? t('send.confirmSending') : t('send.confirmSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function SendMessagePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
