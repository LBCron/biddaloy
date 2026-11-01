import { CommunicationStatus } from '@biddaloy/shared';
import { ApiError, isUnknownOutcomeError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  useMessagingProviders,
  useSendTestMessage,
  useTestSchoolConnection,
  useUpdateSchoolSettings,
  type MaskedMessagingBlock,
  type MaskedSecret,
  type MessagingProviderDescriptor,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { boundedNumericString, toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from '@tanstack/react-router';
import { PlugZapIcon, SendIcon } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SecretField } from '../../components/SecretField';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { mutationErrorKey, SettingsMutationError } from './settings-mutation-error';

export type MessagingMedium = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'MESSENGER';

const SETTINGS_KEY = {
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  MESSENGER: 'messenger',
} as const;

type Communications = NonNullable<TenantSettingsInput['communications']>;
type Values = Record<string, string>;
type Secrets = Record<string, string | null | undefined>;

type ProviderField = MessagingProviderDescriptor['fields'][number];

const isPort = (f: ProviderField) => f.format === 'port';

/** Shape checks: the descriptor's `format`, plus the email `from` it can't express yet. */
function formatOk(f: ProviderField, v: string): boolean {
  if (isPort(f)) return boundedNumericString(1, 65535).safeParse(toLatinDigits(v)).success;
  if (f.key === 'from') return z.email().safeParse(v).success;
  return true;
}

/** `details.code` of the server's daily test-send cap (the per-minute throttle 429 has none). */
const TEST_SEND_DAILY_CAP = 'TEST_SEND_DAILY_CAP';
/** `details.code` of the 400 the server gives a number or address it can't send to. */
const INVALID_TEST_ADDRESS = 'INVALID_TEST_ADDRESS';

/**
 * A failed "Send a test message", in words (D9: never the server's text). A test saves nothing,
 * so never "Couldn't save". A lost reply or 5xx may have sent it: say so, never "try again".
 */
function sendTestErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.details?.code;
    if (error.statusCode === 429 && code === TEST_SEND_DAILY_CAP)
      return 'sendTestMessage.capReached';
    if (error.statusCode === 409 && code === 'INSUFFICIENT_SMS_CREDIT')
      return 'sendTestMessage.noCredit';
    // A 409 with no code is the idempotency interceptor's "already being processed": the first
    // request is still running and may be sending, so it is not a plain failure.
    if (error.statusCode === 409 && code === undefined) return 'sendTestMessage.unconfirmed';
    // Only the server's address check says the number is bad; any other 400 (the DTO) is generic.
    if (error.statusCode === 400 && code === INVALID_TEST_ADDRESS)
      return 'sendTestMessage.invalidAddress';
    if (error.statusCode === 403) return 'mutationError.forbidden';
  }
  if (isUnknownOutcomeError(error)) return 'sendTestMessage.unconfirmed';
  return 'sendTestMessage.failed';
}

/** One form value per (company, field); `__` because RHF would nest a dot. */
const valueKey = (provider: string, field: string) => `${provider}__${field}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The saved block of one company: nested (`block[name]`), or the old flat layout for a sole company. */
function savedFields(
  saved: MaskedMessagingBlock | undefined,
  name: string,
  sole: boolean,
): Record<string, unknown> {
  const nested = saved?.[name];
  if (isRecord(nested)) return nested;
  return sole && saved ? saved : {};
}

interface ProviderConfigFormProps {
  medium: MessagingMedium;
  schoolId: string;
  /** The saved (masked) `communications.<medium>` block, from the settings GET. */
  saved: MaskedMessagingBlock | undefined;
  sectionId: string;
  title: string;
  description: string;
  /** Help hint (?) after the title, when the section has an index entry. */
  helpId?: string;
}

/** Settings › Communication card for one medium, drawn from the server's company schema. */
export function ProviderConfigForm(props: ProviderConfigFormProps) {
  const { t } = useTranslation('settings');
  const query = useMessagingProviders(props.schoolId);
  const entry = query.data?.[props.medium];
  // Bumped after "Remove saved details": the form reads its defaults once, so it remounts empty.
  const [generation, setGeneration] = React.useState(0);
  if (query.isError || query.isPending) {
    return (
      <SettingsSection
        id={props.sectionId}
        title={props.title}
        description={props.description}
        helpId={props.helpId}
      >
        <div className="mt-4">
          {query.isError ? (
            <ErrorState message={t('messaging.loadError')} onRetry={() => void query.refetch()} />
          ) : (
            <div aria-busy="true" className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
        </div>
      </SettingsSection>
    );
  }
  if (!entry || entry.providers.length === 0) return null;
  return (
    <ProviderConfigFormInner
      // The inner form reads its defaults once, so it remounts for a new school (a cached school's
      // query could hand it another school's values to save, PR #3325 review round 5) and after
      // "Remove saved details".
      key={`${props.schoolId}:${generation}`}
      {...props}
      // The mutation already invalidated this query: join that fetch, never start a second one.
      onRemoved={() =>
        void query.refetch({ cancelRefetch: false }).then(() => setGeneration((g) => g + 1))
      }
      providers={entry.providers}
      configured={entry.configured}
      selected={entry.selected}
    />
  );
}

function ProviderConfigFormInner({
  medium,
  schoolId,
  saved,
  sectionId,
  title,
  description,
  helpId,
  providers,
  configured,
  selected: savedSelected,
  onRemoved,
}: ProviderConfigFormProps & {
  providers: MessagingProviderDescriptor[];
  configured: boolean;
  selected: string | null;
  onRemoved: () => void;
}) {
  const { t } = useTranslation('settings');
  const { locale } = useLocale();
  const sole = providers.length === 1;
  const prefix = SETTINGS_KEY[medium];

  const defaults = React.useMemo(() => {
    const out: Values = {};
    for (const d of providers) {
      const own = savedFields(saved, d.name, sole);
      for (const f of d.fields) {
        if (f.kind === 'secret') continue;
        const v = own[f.key];
        out[valueKey(d.name, f.key)] =
          typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      }
    }
    out.provider = savedSelected ?? providers[0]!.name;
    return out;
    // Defaults are read once, when the form mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [secrets, setSecrets] = React.useState<Secrets>({});

  /**
   * A school with no saved company (one on the platform account) sends through `SMS_PROVIDER`,
   * which the form can't see. Naming the first listed company would test, and save, the wrong one
   * (PR #3325 review round 3, finding 1). So a company goes out only when one was saved, or the
   * admin picked one or filled in any of its fields.
   */
  const companyChosen = React.useCallback(
    (values: Values): boolean => {
      if (sole || savedSelected !== null || values.provider !== defaults.provider) return true;
      const shown = providers.find((d) => d.name === values.provider) ?? providers[0]!;
      return shown.fields.some((f) => {
        const key = valueKey(shown.name, f.key);
        return f.kind === 'secret'
          ? secrets[key] !== undefined
          : (values[key] ?? '') !== (defaults[key] ?? '');
      });
    },
    [sole, savedSelected, defaults, providers, secrets],
  );

  const schema = React.useMemo(() => {
    const shape: Record<string, z.ZodString> = { provider: z.string() };
    for (const d of providers) {
      for (const f of d.fields)
        if (f.kind !== 'secret') shape[valueKey(d.name, f.key)] = z.string();
    }
    return z.object(shape).superRefine((values, ctx) => {
      const chosen = providers.find((d) => d.name === values.provider);
      // No company chosen: nothing of it is sent, so its required fields are not needed (the server
      // accepts no block for a PLATFORM-metered school). A format check still applies.
      const needRequired = companyChosen(values);
      for (const f of chosen?.fields ?? []) {
        const key = valueKey(chosen!.name, f.key);
        const v = (values[key] ?? '').trim();
        if (f.kind === 'secret') continue;
        if (f.required && v === '' && needRequired) {
          ctx.addIssue({ code: 'custom', path: [key], message: t('messaging.required') });
        } else if (v !== '' && !formatOk(f, v)) {
          ctx.addIssue({ code: 'custom', path: [key], message: t('messaging.invalid') });
        }
      }
    });
  }, [providers, t, companyChosen]);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    ...useFormShellMode(),
  });
  const [sendTo, setSendTo] = React.useState('');
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);
  // Any company field saved (a masked secret counts): there is something to remove.
  const hasSaved = providers.some((d) =>
    d.fields.some((f) => savedFields(saved, d.name, sole)[f.key] !== undefined),
  );
  const providerName = form.watch('provider') ?? defaults.provider!;
  const current = providers.find((d) => d.name === providerName) ?? providers[0]!;

  // Not `&& !isSubmitSuccessful`: `.mutate()` is not awaited, so that flag would silence the
  // warning after a failed save, and (kept by the reset) for every edit after a good one.
  // `onSuccess` resets the form and the secrets, which clears both terms.
  useWarnUnsavedChanges(
    form.formState.isDirty || Object.values(secrets).some((v) => v !== undefined),
  );

  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testConnection = useTestSchoolConnection(schoolId);
  // A real send: one key per attempt, and a lost reply gets the "could not confirm" toast.
  const sendTest = useSendTestMessage(schoolId);

  /**
   * Only the chosen company's block goes out: other companies' saved blocks stay as they are.
   * `undefined` when no company was chosen: nothing is saved, and a test uses the live settings.
   */
  function buildConfig(values: Values): Communications[keyof Communications] | undefined {
    if (!companyChosen(values)) return undefined;
    const block: Record<string, unknown> = {};
    for (const f of current.fields) {
      if (f.kind === 'secret') {
        const s = secrets[valueKey(current.name, f.key)];
        if (s !== undefined) block[f.key] = s;
        continue;
      }
      const key = valueKey(current.name, f.key);
      const v = values[key] ?? '';
      if (v === '' && !f.required) {
        // #3331: a left-out field keeps its saved value, so clearing a saved one sends null.
        // The last-saved values (reset after each save), not the mount-time ones.
        if ((form.formState.defaultValues?.[key] ?? '') !== '') block[f.key] = null;
        continue;
      }
      block[f.key] = isPort(f) ? Number(toLatinDigits(v)) : v;
    }
    return { ...(sole ? {} : { provider: current.name }), [current.name]: block };
  }

  function handleSave(values: Values) {
    const config = buildConfig(values);
    updateSettings.mutate(
      { version: 1, communications: config ? { [prefix]: config } : {} },
      {
        onSuccess: () => {
          setSecrets({});
          form.reset(values, { keepIsSubmitSuccessful: true });
        },
      },
    );
  }

  /**
   * #3338: drops every saved company of this medium in one PATCH (null deletes a key), so a school
   * can always get back to the platform account, even when a company has a required text field.
   * `metering` is not sent: it is the platform's, and the merge leaves it as it is.
   */
  function handleRemove() {
    const nulls = Object.fromEntries(providers.map((d) => [d.name, null]));
    updateSettings.mutate(
      {
        version: 1,
        communications: { [prefix]: sole ? nulls : { provider: null, ...nulls } },
      },
      {
        onSuccess: () => {
          setConfirmingRemove(false);
          onRemoved();
        },
      },
    );
  }

  /**
   * The same checks as Save, but not through handleSubmit: that marks the form submitted and so
   * turns off the unsaved-changes warning, though a test saves nothing.
   */
  async function validValues(): Promise<Values | undefined> {
    return (await form.trigger(undefined, { shouldFocus: true })) ? form.getValues() : undefined;
  }

  async function handleTestConnection() {
    const values = await validValues();
    if (values) testConnection.mutate({ medium, ...configOf(values) });
  }

  async function handleSendTest() {
    const values = await validValues();
    if (!values) return;
    // A bn keyboard types Bangla digits; the server's phone check reads ASCII ones.
    const to = medium === 'SMS' ? toLatinDigits(sendTo.trim()) : sendTo.trim();
    sendTest.mutate({ medium, ...configOf(values), sendTo: to });
  }

  /** The test body's `config`: left out when no company was chosen, so the server tests what is live. */
  function configOf(values: Values): { config?: Record<string, unknown> } {
    const config = buildConfig(values) as Record<string, unknown> | undefined;
    return config ? { config } : {};
  }

  /** An earlier result belongs to the old company or address: drop it when either changes. */
  function resetResults() {
    testConnection.reset();
    sendTest.reset();
  }

  const label = (d: { label: { en: string; bn: string } }) => d.label[locale];
  const help = (field: string) => {
    const text = t(`help.messaging.${current.name}.${field}`, { defaultValue: '' });
    return text === '' ? undefined : text;
  };

  const errors = form.formState.errors;
  const advancedFields = current.fields.filter((f) => f.advanced);
  const plainFields = current.fields.filter((f) => !f.advanced);

  const textField = (f: ProviderField) => {
    const name = valueKey(current.name, f.key);
    const id = `${prefix}-${current.name}-${f.key}`;
    const helpText = help(f.key);
    return (
      <FormField
        key={name}
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel htmlFor={id} required={f.required}>
              {label(f)}
            </FormLabel>
            <FormControl>
              <Input id={id} className={f.kind === 'url' ? 'font-mono' : undefined} {...field} />
            </FormControl>
            {helpText && <FormDescription>{helpText}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
    );
  };

  const secretField = (f: ProviderField) => {
    const key = valueKey(current.name, f.key);
    const masked = savedFields(saved, current.name, sole)[f.key] as MaskedSecret | undefined;
    return (
      <div key={key} className="md:col-span-2">
        <SecretField
          id={`${prefix}-${current.name}-${f.key}`}
          label={label(f)}
          masked={masked}
          value={secrets[key]}
          onChange={(v) => setSecrets((prev) => ({ ...prev, [key]: v }))}
          {...(help(f.key) ? { description: help(f.key)! } : {})}
        />
      </div>
    );
  };

  const sendResult = sendTest.data;
  const sentStatus = sendResult?.testMessage?.status as CommunicationStatus | undefined;

  return (
    <Form {...form}>
      <SettingsSection
        id={sectionId}
        title={title}
        description={description}
        helpId={helpId}
        badge={
          <StatusBadge
            tone={configured ? 'success' : 'neutral'}
            label={t(configured ? 'channelStatus.ready' : 'channelStatus.notReady')}
          />
        }
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        advancedOpen={advancedFields.some((f) => errors[valueKey(current.name, f.key)])}
        advanced={
          advancedFields.length > 0 ? (
            <div className="mt-2 grid gap-4 md:grid-cols-2">{advancedFields.map(textField)}</div>
          ) : undefined
        }
        footerStart={
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              loading={testConnection.isPending}
              onClick={() => void handleTestConnection()}
            >
              <PlugZapIcon aria-hidden="true" />
              {t('testConnection.action')}
            </Button>
            {testConnection.data && (
              <p role="status">
                <StatusBadge
                  tone={testConnection.data.success ? 'success' : 'danger'}
                  label={t(
                    testConnection.data.success
                      ? 'testConnection.success'
                      : 'testConnection.failure',
                  )}
                />
              </p>
            )}
            {hasSaved && (
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => {
                  // A failed Save's error belongs to that Save, not to this question.
                  updateSettings.reset();
                  setConfirmingRemove(true);
                }}
              >
                {t('messaging.removeSaved')}
              </Button>
            )}
            {testConnection.isError && <SettingsMutationError error={testConnection.error} />}
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {!sole && (
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  {medium === 'SMS' ? (
                    <FormLabel
                      htmlFor={`${prefix}-provider`}
                      helpId="administration.settings.field.smsProvider"
                    >
                      {t(`${prefix}.provider`)}
                    </FormLabel>
                  ) : (
                    <FormLabel htmlFor={`${prefix}-provider`}>{t(`${prefix}.provider`)}</FormLabel>
                  )}
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      resetResults();
                    }}
                  >
                    <FormControl>
                      <SelectTrigger id={`${prefix}-provider`}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {providers.map((d) => (
                        <SelectItem key={d.name} value={d.name}>
                          {label(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          {plainFields.filter((f) => f.kind !== 'secret').map(textField)}
          {plainFields.filter((f) => f.kind === 'secret').map(secretField)}
        </div>

        {current.supportsTestMessage && (
          <div className="mt-4 grid gap-2">
            <label htmlFor={`${prefix}-sendTo`} className="text-label text-text-primary">
              {t(medium === 'EMAIL' ? 'sendTestMessage.email' : 'sendTestMessage.phone')}
            </label>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input
                id={`${prefix}-sendTo`}
                type={medium === 'EMAIL' ? 'email' : 'tel'}
                inputMode={medium === 'EMAIL' ? 'email' : 'tel'}
                value={sendTo}
                onChange={(e) => {
                  setSendTo(e.target.value);
                  sendTest.reset();
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                loading={sendTest.isPending}
                disabled={sendTo.trim() === ''}
                onClick={() => void handleSendTest()}
              >
                <SendIcon aria-hidden="true" />
                {t('sendTestMessage.label')}
              </Button>
            </div>
            {sentStatus && (
              // The connection passed but the gateway can still reject the send (FAILED).
              <p
                role={sentStatus === CommunicationStatus.FAILED ? 'alert' : 'status'}
                className={
                  sentStatus === CommunicationStatus.FAILED
                    ? 'text-destructive'
                    : 'text-text-secondary'
                }
              >
                {t(
                  sentStatus === CommunicationStatus.FAILED
                    ? 'sendTestMessage.failed'
                    : 'sendTestMessage.sent',
                )}{' '}
                <Link
                  to="/communications/message-log"
                  search={{ status: sentStatus }}
                  className="font-medium text-primary"
                >
                  {t('sendTestMessage.openLog')}
                </Link>
              </p>
            )}
            {sendResult && !sendResult.testMessage && sendResult.success && (
              <p role="status" className="text-text-secondary">
                {t('sendTestMessage.sink')}
              </p>
            )}
            {sendResult && !sendResult.success && (
              <p role="alert" className="text-destructive">
                {t('sendTestMessage.failed')}
              </p>
            )}
            {sendTest.isError && (
              <p role="alert" className="text-destructive">
                {t(sendTestErrorKey(sendTest.error))}
              </p>
            )}
          </div>
        )}
      </SettingsSection>
      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={t('messaging.removeConfirm')}
        // A failed removal says so here: the form's own error line is behind the dialog.
        description={`${t('messaging.removeConfirmDescription')}${
          updateSettings.isError ? ` ${t(mutationErrorKey(updateSettings.error))}` : ''
        }`}
        confirmLabel={t('messaging.removeConfirmYes')}
        busy={updateSettings.isPending}
        onConfirm={handleRemove}
      />
    </Form>
  );
}
