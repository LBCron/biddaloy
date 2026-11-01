/**
 * [28.3.2] The ACR form: a `FullPageShell` with three step tabs (period ·
 * criteria · closing remarks) and a Back / Next / Complete footer, autosaved
 * through `useAcrAutosave` (28.3.1). Every step is reachable at any time —
 * autosave keeps each one — only Complete waits for every criterion.
 *
 * Form fields are LOCAL state seeded once from `assessment` — never bound
 * to the query cache. `useUpdateAcr` writes each PATCH response into the
 * detail cache, and a slow response must not overwrite what the admin has
 * typed since. The server answer is only adopted on complete/reopen, when
 * the caller swaps `assessment` (and `key`s this component) with the
 * mutation result.
 *
 * Keyboard (D21): 4/3/2/1 score the active criterion and advance (only
 * outside text fields); Ctrl+Enter completes once every criterion is
 * scored. A completed ACR renders read-only, stacked, with Reopen.
 */
import { Permission } from '@biddaloy/shared';
import {
  DatePicker,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcrAutosave,
  useCompleteAcr,
  useHasPermission,
  useReopenAcr,
  type AcrAssessment,
  type AcrCriterion,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatNumber, parseDate, toIsoDate } from '@biddaloy/ui/utils';
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react';
import * as React from 'react';

import { AcrPrintButton } from './acr-print-button';
import { CriterionStep, SCORE_VALUES, type ScoreValue } from './criterion-step';

/** `step1_data` is an open server record: a malformed stored date must leave the
 * picker empty, not throw out of render (`parseDate` throws on a non-date). */
function safeParseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}

interface Step1 {
  period_from: string;
  period_to: string;
  employment_duration: string;
  description: string;
}
interface Step3 {
  special_qualification: string;
  honesty_reputation: string;
  promotion_eligible: '' | 'yes' | 'no';
  training: string;
  recommendations: string;
}

function str(data: Record<string, unknown> | null, key: string): string {
  const v = data?.[key];
  return typeof v === 'string' ? v : '';
}

function seedStep1(data: Record<string, unknown> | null): Step1 {
  return {
    period_from: str(data, 'period_from'),
    period_to: str(data, 'period_to'),
    employment_duration: str(data, 'employment_duration'),
    description: str(data, 'description'),
  };
}

function seedStep3(data: Record<string, unknown> | null): Step3 {
  const eligible = str(data, 'promotion_eligible');
  return {
    special_qualification: str(data, 'special_qualification'),
    honesty_reputation: str(data, 'honesty_reputation'),
    promotion_eligible: eligible === 'yes' || eligible === 'no' ? eligible : '',
    training: str(data, 'training'),
    recommendations: str(data, 'recommendations'),
  };
}

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export const ACR_STEPS = ['period', 'criteria', 'closing'] as const;
export type AcrStep = (typeof ACR_STEPS)[number];

const CARD = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';

export interface AcrFormProps {
  assessment: AcrAssessment;
  criteria: readonly AcrCriterion[];
  /** Fired with the server's answer after Complete / Reopen succeed. */
  onServerUpdate: (assessment: AcrAssessment) => void;
  /** Full-page title, "ACR — {name}". */
  title: string;
  onClose: () => void;
  step: AcrStep;
  onStepChange: (step: AcrStep) => void;
  /** Academic year name for the context line. */
  yearName: string;
}

export function AcrForm({
  assessment,
  criteria,
  onServerUpdate,
  title,
  onClose,
  step,
  onStepChange,
  yearName,
}: AcrFormProps) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const completed = assessment.status === 'COMPLETED';
  const readOnly = completed || !canWrite;

  const ordered = React.useMemo(
    () =>
      [...criteria].sort((a, b) => a.block.localeCompare(b.block) || a.sort_order - b.sort_order),
    [criteria],
  );

  const [step1, setStep1] = React.useState(() => seedStep1(assessment.step1_data));
  const [step3, setStep3] = React.useState(() => seedStep3(assessment.step3_data));
  const [scores, setScores] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(assessment.scores.map((s) => [s.criterion_id, s.score])),
  );
  const stepId = step;
  const [activeIndex, setActiveIndex] = React.useState(0);

  const autosave = useAcrAutosave(assessment.id);
  const complete = useCompleteAcr();
  const reopen = useReopenAcr();

  const allScored = ordered.length > 0 && ordered.every((c) => scores[c.id] !== undefined);

  function patchStep1(patch: Partial<Step1>) {
    const next = { ...step1, ...patch };
    setStep1(next);
    autosave.stageStep1({ ...next });
  }
  function patchStep3(patch: Partial<Step3>) {
    const next = { ...step3, ...patch };
    setStep3(next);
    autosave.stageStep3({ ...next });
  }
  const score = React.useCallback(
    (index: number, value: ScoreValue) => {
      const criterion = ordered[index];
      if (!criterion || readOnly) return;
      setScores((prev) => ({ ...prev, [criterion.id]: value }));
      autosave.stageScore(criterion.id, value);
      setActiveIndex(Math.min(index + 1, ordered.length - 1));
    },
    [ordered, readOnly, autosave],
  );

  const submit = React.useCallback(async () => {
    if (readOnly || complete.isPending) return;
    if (!allScored) {
      toast.error(t('acr.submitBlocked'));
      return;
    }
    // `flush` resolves false when a save failed — never complete on that.
    if (!(await autosave.flush())) {
      toast.error(t('acr.completeError'));
      return;
    }
    try {
      onServerUpdate(await complete.mutateAsync(assessment.id));
    } catch {
      toast.error(t('acr.completeError'));
    }
  }, [readOnly, complete, allScored, autosave, assessment.id, onServerUpdate, t]);

  // Latest handlers for the one document listener, so it is bound once.
  const live = React.useRef({ score, submit, activeIndex, stepId });
  live.current = { score, submit, activeIndex, stepId };
  React.useEffect(() => {
    if (readOnly) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void live.current.submit();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTextTarget(e.target)) return;
      const value = Number(e.key);
      if (
        live.current.stepId === 'criteria' &&
        (SCORE_VALUES as readonly number[]).includes(value)
      ) {
        e.preventDefault();
        live.current.score(live.current.activeIndex, value as ScoreValue);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [readOnly]);

  async function handleReopen() {
    try {
      onServerUpdate(await reopen.mutateAsync(assessment.id));
    } catch {
      toast.error(t('acr.reopenError'));
    }
  }

  const dateField = (
    id: string,
    label: string,
    value: string,
    onChange: (iso: string) => void,
    min?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <DatePicker
        id={id}
        config={regionConfig}
        aria-label={label}
        value={safeParseDate(value)}
        min={safeParseDate(min)}
        disabled={readOnly}
        onValueChange={(d) => onChange(d ? toIsoDate(d) : '')}
      />
    </div>
  );

  const step1Content = (
    <div className={`${CARD} grid gap-4 md:grid-cols-2`}>
      {dateField('acr-period-from', t('acr.step1.periodFrom'), step1.period_from, (v) =>
        patchStep1({ period_from: v }),
      )}
      {dateField(
        'acr-period-to',
        t('acr.step1.periodTo'),
        step1.period_to,
        (v) => patchStep1({ period_to: v }),
        step1.period_from || undefined,
      )}
      <div className="md:col-span-2">
        <TextField
          label={t('acr.step1.employmentDuration')}
          value={step1.employment_duration}
          disabled={readOnly}
          onChange={(v) => patchStep1({ employment_duration: v })}
        />
      </div>
      <div className="md:col-span-2">
        <AreaField
          label={t('acr.step1.description')}
          value={step1.description}
          disabled={readOnly}
          onChange={(v) => patchStep1({ description: v })}
        />
      </div>
    </div>
  );

  const step2Content = (
    <CriterionStep
      criteria={ordered}
      scores={scores}
      activeIndex={activeIndex}
      onActiveChange={setActiveIndex}
      onScore={score}
      readOnly={readOnly}
    />
  );

  const eligibleId = React.useId();
  const step3Content = (
    <div className={`${CARD} flex flex-col gap-4`}>
      <AreaField
        label={t('acr.step3.specialQualification')}
        value={step3.special_qualification}
        disabled={readOnly}
        onChange={(v) => patchStep3({ special_qualification: v })}
      />
      <AreaField
        label={t('acr.step3.honestyReputation')}
        value={step3.honesty_reputation}
        disabled={readOnly}
        onChange={(v) => patchStep3({ honesty_reputation: v })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend id={eligibleId} className="font-medium">
          {t('acr.step3.promotionEligibility')}
        </legend>
        <RadioGroup
          aria-labelledby={eligibleId}
          value={step3.promotion_eligible}
          disabled={readOnly}
          onValueChange={(v) => patchStep3({ promotion_eligible: v === 'yes' ? 'yes' : 'no' })}
          className="flex flex-col gap-1"
        >
          {(['yes', 'no'] as const).map((v) => (
            <div key={v} className="flex min-h-11 items-center gap-3 md:min-h-8">
              <RadioGroupItem id={`${eligibleId}-${v}`} value={v} />
              <Label htmlFor={`${eligibleId}-${v}`}>
                {t(v === 'yes' ? 'acr.step3.promotionYes' : 'acr.step3.promotionNo')}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      <AreaField
        label={t('acr.step3.training')}
        value={step3.training}
        disabled={readOnly}
        onChange={(v) => patchStep3({ training: v })}
      />
      <AreaField
        label={t('acr.step3.recommendations')}
        value={step3.recommendations}
        disabled={readOnly}
        onChange={(v) => patchStep3({ recommendations: v })}
      />
      {!readOnly && <p className="hidden text-text-secondary md:block">{t('acr.submitHint')}</p>}
    </div>
  );

  const steps = [
    { id: 'period' as const, content: step1Content },
    { id: 'criteria' as const, content: step2Content },
    { id: 'closing' as const, content: step3Content },
  ];
  const index = ACR_STEPS.indexOf(step);
  const periodDone = step1.period_from !== '' && step1.period_to !== '';

  const context = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <dt className="text-caption text-text-secondary">{t('acr.yearLabel')}</dt>
            <dd className="font-medium">{yearName}</dd>
          </div>
          {completed && (
            <div className="flex items-center gap-2">
              <dt className="text-caption text-text-secondary">{t('acr.total')}</dt>
              <dd className="font-medium">{formatNumber(assessment.total, regionConfig)}</dd>
            </div>
          )}
        </dl>
        <StatusBadge
          tone={completed ? 'success' : 'warning'}
          label={t(`acr.status.${assessment.status}`)}
        />
        {completed && <AcrPrintButton assessment={assessment} />}
      </div>
      <p
        role="status"
        aria-live="polite"
        className="flex min-h-5 items-center gap-1.5 text-caption text-text-secondary"
      >
        {autosave.state === 'saved' && <CheckIcon className="size-4" aria-hidden="true" />}
        {autosave.state === 'saving' && (
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        )}
        {autosave.state === 'error' && (
          <CircleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
        )}
        {autosave.state === 'idle' ? '' : t(`acr.save.${autosave.state}`)}
      </p>
    </div>
  );

  const closeLabel = t('actions.close', { ns: 'common' });
  const primary = completed
    ? canWrite
      ? {
          label: t('acr.reopen'),
          onClick: () => void handleReopen(),
          busy: reopen.isPending,
          helpId: 'people.evaluations.action.reopenAcr',
        }
      : { label: closeLabel, onClick: onClose }
    : index < ACR_STEPS.length - 1
      ? {
          label: t('wizard.next', { ns: 'common' }),
          onClick: () => onStepChange(ACR_STEPS[index + 1]!),
        }
      : readOnly
        ? { label: closeLabel, onClick: onClose }
        : {
            label: t('acr.submit'),
            onClick: () => void submit(),
            busy: complete.isPending,
            helpId: 'people.evaluations.action.completeAcr',
          };
  const secondary =
    !completed && index > 0
      ? {
          label: t('wizard.back', { ns: 'common' }),
          onClick: () => onStepChange(ACR_STEPS[index - 1]!),
        }
      : undefined;

  return (
    <FullPageShell
      title={title}
      onClose={onClose}
      dirty={autosave.state === 'saving' || autosave.state === 'error'}
      size="form"
      primary={primary}
      {...(secondary ? { secondary } : {})}
    >
      <div className="space-y-6">
        {context}
        {completed ? (
          <>
            <p role="status" className="text-text-secondary">
              {t('acr.completedReadOnly')}
            </p>
            {steps.map(({ id, content }) => (
              <section key={id} aria-labelledby={`acr-s-${id}`} className="space-y-3">
                <h2 id={`acr-s-${id}`} className="text-h2">
                  {t(`acr.steps.${id}`)}
                </h2>
                {content}
              </section>
            ))}
          </>
        ) : (
          <Tabs value={step} onValueChange={(v) => onStepChange(v as AcrStep)}>
            <TabsList variant="line" aria-label={t('acr.stepsLabel')}>
              {steps.map(({ id }) => (
                <TabsTrigger key={id} value={id}>
                  {t(`acr.steps.${id}`)}
                  {id === 'period' && periodDone && (
                    <CircleCheckIcon className="size-4 text-status-paid-fg" aria-hidden="true" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {steps.map(({ id, content }) => (
              <TabsContent key={id} value={id} className="space-y-4 pt-4 md:pt-6">
                {content}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </FullPageShell>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AreaField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
