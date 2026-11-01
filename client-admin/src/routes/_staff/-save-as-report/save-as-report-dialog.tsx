/**
 * [8.15.52] "Keep this as a report": the dialog behind `ExportMenu`'s `onKeepAsReport`.
 *
 * ```
 *  ┌ Keep this as a report ─────────────────────┐
 *  │ Report name   [ Class 8 · A — Students ]   │
 *  │ Who can see it  [x] Admin  [ ] Teacher …   │
 *  │ Ask when running                           │
 *  │   Academic year · 2026      (o) ask        │
 *  │ This filter will not go into the report:   │
 *  │   What you typed in search                 │
 *  │                       [Cancel] [Keep as report]
 *  └────────────────────────────────────────────┘
 * ```
 *
 * Save is two requests: `POST /reports/definitions` (a draft), then `…/:id/publish`, because a
 * draft cannot be run. Both carry an `Idempotency-Key` (one per body, so a double click or a lost
 * reply never makes a second report), the mutation never retries, and an `inFlight` ref closes the
 * gap before React re-renders the busy button. If the draft is saved but publishing fails, the form
 * locks and a retry only publishes: it never creates a second draft.
 *
 * The report's `key` is made once per opening (`students-1a2b3c4d`): a Bangla name gives nothing the
 * key pattern accepts, and a key that changed on every attempt would defeat the idempotency key.
 * One name field fills both the Bangla and the English name, because only the language in use is
 * loaded here.
 *
 * Everything the list cannot carry over is shown first, in plain words, never dropped silently
 * (`list-to-definition.ts`).
 */
import { Permission, roleHasPermission, UserRole } from '@biddaloy/shared';
import { ApiError, apiClient } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import { academicYearsQueryOptions, useActiveRole } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateRange, renderDigits } from '@biddaloy/ui/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import * as React from 'react';

import {
  planListReport,
  type ListKind,
  type ListToDefinitionInput,
  type PromptChoice,
} from './list-to-definition';

/** The roles a report can be shown to (`REPORT_VISIBLE_ROLES` on the server). */
const VISIBLE_ROLES = (
  [
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.COMMITTEE,
    UserRole.OFFICE_STAFF,
    UserRole.EXAM_CONTROLLER,
  ] as const
).filter((role) => roleHasPermission(role, Permission.REPORTS_VIEW));

export interface SaveAsReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which list this is opened from. */
  kind: ListKind;
  /** The list's filters, as its URL holds them. */
  filters: Record<string, string | undefined>;
  /** The names behind `class_id` and `section_id`. */
  names?: ListToDefinitionInput['names'];
  /** The columns showing in the list, in order. */
  columns?: readonly string[];
}

export function SaveAsReportDialog({ open, onOpenChange, ...rest }: SaveAsReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {/* The form mounts with the dialog, so its queries only run while it is open. */}
        <SaveAsReportForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** One `Idempotency-Key` per request body: the same body re-sends the same key, a new body a new one. */
function useKeyPerBody() {
  const held = React.useRef(new Map<string, { json: string; key: string }>());
  return React.useCallback((slot: string, body: unknown) => {
    const json = JSON.stringify(body) ?? '';
    const current = held.current.get(slot);
    if (current?.json === json) return current.key;
    const key = crypto.randomUUID();
    held.current.set(slot, { json, key });
    return key;
  }, []);
}

/** The draft was saved; only switching it on failed. `inner` is what the server said. */
class PublishFailedError extends Error {
  constructor(readonly inner: unknown) {
    super('PUBLISH_FAILED');
  }
}

function SaveAsReportForm({
  kind,
  filters,
  names,
  columns,
  onClose,
}: Omit<SaveAsReportDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const { t } = useTranslation('common');
  const { t: tStaff } = useTranslation('staff');
  const config = useRegionConfig();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ownRole = useActiveRole();
  const keyFor = useKeyPerBody();

  // The students area has a row per year, so the report needs the current year to ask about.
  const years = useQuery({
    ...academicYearsQueryOptions({ limit: 100 }),
    enabled: kind === 'students',
  });
  const waitingForYear = kind === 'students' && years.isPending;
  const currentYear = years.data?.data.find((y) => y.is_current)?.name;

  const inputKey = JSON.stringify([kind, filters, names, columns, currentYear]);
  const plan = React.useMemo(
    () => planListReport({ kind, filters, names, columns, academicYear: currentYear }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `inputKey` is the value of these
    [inputKey],
  );

  const defaultName = plan.name.scope
    ? t('saveAsReport.defaultName', {
        scope: plan.name.scope,
        area: t(`saveAsReport.area.${plan.name.area}`),
      })
    : t(`saveAsReport.area.${plan.name.area}`);
  const [typedName, setTypedName] = React.useState<string | null>(null);
  const name = typedName ?? defaultName;
  const [nameError, setNameError] = React.useState(false);

  const [roles, setRoles] = React.useState<ReadonlySet<string>>(
    () =>
      new Set([
        UserRole.ADMIN,
        ...(ownRole && (VISIBLE_ROLES as readonly string[]).includes(ownRole) ? [ownRole] : []),
      ]),
  );
  const [ask, setAsk] = React.useState<Partial<Record<PromptChoice['key'], boolean>>>({});

  // Made once per opening (see the header).
  const [reportKey] = React.useState(() => `${kind}-${crypto.randomUUID().slice(0, 8)}`);
  const createdId = React.useRef<string | null>(null);
  const [locked, setLocked] = React.useState(false);
  const inFlight = React.useRef(false);

  const save = useMutation({
    mutationFn: async () => {
      const title = { en: name.trim(), bn: name.trim() };
      const body = {
        key: reportKey,
        name_en: title.en,
        name_bn: title.bn,
        visible_roles: VISIBLE_ROLES.filter((r) => roles.has(r)),
        definition: { ...plan.build(ask, title) },
      };
      if (createdId.current === null) {
        const created = await apiClient.post<{ id: string }>('/reports/definitions', body, {
          headers: { 'Idempotency-Key': keyFor('create', body) },
        });
        createdId.current = created.data.id;
        setLocked(true);
      }
      try {
        await apiClient.post(`/reports/definitions/${createdId.current}/publish`, undefined, {
          headers: { 'Idempotency-Key': keyFor('publish', { id: createdId.current }) },
        });
      } catch (error) {
        throw new PublishFailedError(error);
      }
      return createdId.current;
    },
    retry: false,
    // The form says what happened itself, including "could not confirm" for a lost reply.
    meta: { handlesUnknownOutcome: true },
    onSuccess: (id) => {
      // The hub caches its catalogue (`reportCatalogueKeys` in `@biddaloy/ui/hooks`).
      void queryClient.invalidateQueries({ queryKey: ['report-catalogue'] });
      onClose();
      toast.success(t('saveAsReport.saved'), {
        action: {
          label: t('saveAsReport.open'),
          onClick: () => router.history.push(`/reports/${id}`),
        },
      });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || save.isPending) return;
    if (name.trim() === '') {
      setNameError(true);
      return;
    }
    setNameError(false);
    inFlight.current = true;
    save.mutate();
  }

  const failure = save.error;
  const cause = failure instanceof PublishFailedError ? failure.inner : failure;
  const rejected = cause instanceof ApiError && cause.statusCode >= 400 && cause.statusCode < 500;
  const errorText =
    failure === null
      ? null
      : failure instanceof PublishFailedError && rejected
        ? t('saveAsReport.publishError')
        : rejected
          ? t('saveAsReport.error')
          : t('outcomeUnknown');

  const promptValue = (prompt: PromptChoice) =>
    typeof prompt.value === 'string'
      ? renderDigits(prompt.value, config.numerals)
      : formatDateRange(prompt.value.from, prompt.value.to, config);
  const partsList = (keys: string[]) => keys.map((k) => t(`saveAsReport.parts.${k}`)).join(', ');

  const disabled = locked || save.isPending;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t('saveAsReport.title')}</DialogTitle>
        <DialogDescription>{t('saveAsReport.description')}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="save-as-report-name">{t('saveAsReport.nameLabel')}</Label>
        <Input
          id="save-as-report-name"
          value={name}
          maxLength={160}
          disabled={disabled}
          aria-required="true"
          aria-invalid={nameError}
          aria-describedby={nameError ? 'save-as-report-name-error' : undefined}
          onChange={(event) => {
            setTypedName(event.target.value);
            setNameError(false);
          }}
        />
        {nameError && (
          <p id="save-as-report-name-error" role="alert" className="text-sm text-destructive">
            {t('saveAsReport.nameRequired')}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-label font-medium text-text-primary">
          {t('saveAsReport.whoLabel')}
        </legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {VISIBLE_ROLES.map((role) => (
            <label key={role} className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                checked={roles.has(role)}
                // Admins always see every report, so the box stays on.
                disabled={disabled || role === UserRole.ADMIN}
                onCheckedChange={(checked) =>
                  setRoles((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(role);
                    else next.delete(role);
                    return next;
                  })
                }
              />
              {tStaff(`roles.${role}`)}
            </label>
          ))}
        </div>
        <p className="text-caption text-text-secondary">{t('saveAsReport.whoHint')}</p>
      </fieldset>

      {plan.prompts.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label font-medium text-text-primary">
            {t('saveAsReport.asksHeading')}
          </legend>
          {plan.prompts.map((prompt) => {
            const asked = ask[prompt.key] ?? true;
            const id = `save-as-report-ask-${prompt.key}`;
            const label = t(`saveAsReport.prompt.${prompt.name}`);
            return (
              <div key={prompt.key} className="flex items-start gap-3">
                <Switch
                  id={id}
                  checked={asked}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    setAsk((previous) => ({ ...previous, [prompt.key]: checked }))
                  }
                />
                <Label htmlFor={id} className="flex flex-col font-normal">
                  <span className="font-medium">
                    {t('saveAsReport.asksSwitch', { name: label })}
                  </span>
                  <span className="text-caption text-text-secondary">
                    {t(asked ? 'saveAsReport.asksOn' : 'saveAsReport.asksOff', {
                      value: promptValue(prompt),
                    })}
                  </span>
                </Label>
              </div>
            );
          })}
        </fieldset>
      )}

      {(plan.unmappedFilters.length > 0 || plan.unmappedColumns.length > 0) && (
        <div className="flex flex-col gap-1 text-sm text-text-secondary" role="note">
          {plan.unmappedFilters.length > 0 && (
            <p className="flex items-start gap-2">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {t('saveAsReport.unmappedFilters', {
                  count: plan.unmappedFilters.length,
                  list: partsList(plan.unmappedFilters),
                })}
              </span>
            </p>
          )}
          {plan.unmappedColumns.length > 0 && (
            <p className="flex items-start gap-2">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>
                {t('saveAsReport.unmappedColumns', {
                  count: plan.unmappedColumns.length,
                  list: partsList(plan.unmappedColumns),
                })}
              </span>
            </p>
          )}
        </div>
      )}

      {errorText !== null && (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={save.isPending}>
            {t('actions.cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" loading={save.isPending} disabled={waitingForYear}>
          {save.isPending ? t('saveAsReport.saving') : t('saveAsReport.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
