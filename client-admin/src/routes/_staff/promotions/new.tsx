/**
 * [26.6.1] `/promotions/new` — draft a promotion run: source class, target
 * year, target class (D13, suggested + editable), published exams to
 * average (D21), BLOCK/SNAKE (D8), with D14's blocking-reason handling.
 *
 * See the `## Plan — #1003` GitHub comment for the full design. Two
 * points worth restating here since they're easy to get wrong by
 * pattern-matching a different form:
 * - No `useEffect` syncing target year/class to the source class. Each is
 *   a suggested default the user can override, and changing the source
 *   clears the overrides (`changeSource` below).
 * - There is no selectable "Graduate" option. It only ever appears as a
 *   read-only state when the suggestion has `target_class: null` and no
 *   `blocking_reason` — see `2.4` in the plan.
 */
import { PlacementAlgorithm } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Checkbox,
  ConfirmDialog,
  Label,
  RadioGroup,
  RadioGroupItem,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  HelpHint,
} from '@biddaloy/ui/components';
import {
  examsQueryOptions,
  useAcademicYears,
  useAllClasses,
  useClasses,
  useCreatePromotionRun,
  useSuggestPromotionTarget,
  type BlockingReason,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

const searchSchema = z.object({ classId: z.string().uuid().optional().catch(undefined) });

export const Route = createFileRoute('/_staff/promotions/new')({
  validateSearch: searchSchema,
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('promotions', 'common'),
  pendingComponent: NewPromotionRunPending,
  component: NewPromotionRunPage,
});

const BLOCKING_KEY: Record<BlockingReason, string> = {
  PICK_TARGET_CLASS: 'blocking.pickTargetClass',
  TARGET_SECTIONS_MISSING: 'blocking.targetSectionsMissing',
  RETAIN_CLASS_MISSING: 'blocking.retainClassMissing',
};

const KNOWN_BLOCKING_REASONS = new Set<string>(Object.keys(BLOCKING_KEY));

function isBlockingReason(code: unknown): code is BlockingReason {
  return typeof code === 'string' && KNOWN_BLOCKING_REASONS.has(code);
}

function NewPromotionRunPage() {
  const { t } = useTranslation('promotions');
  const navigate = Route.useNavigate();
  const { classId } = Route.useSearch();

  const [sourceClassId, setSourceClassId] = React.useState<string | undefined>(classId);
  const [targetYearOverride, setTargetYearOverride] = React.useState<string>();
  const [targetClassOverride, setTargetClassOverride] = React.useState<string>();
  const [deselectedExamIds, setDeselectedExamIds] = React.useState<ReadonlySet<string>>(new Set());
  const [algorithm, setAlgorithm] = React.useState<PlacementAlgorithm>(PlacementAlgorithm.BLOCK);

  const [discardOpen, setDiscardOpen] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const mutation = useCreatePromotionRun();
  const closePage = useCloseFullPage(() => void navigate({ to: '/promotions' }));
  // A pending create must not be abandoned by Close / Cancel / Esc.
  const close = () => {
    if (!mutation.isPending) closePage();
  };

  function changeSource(id: string) {
    if (!id) return;
    mutation.reset();
    setSourceClassId(id);
    setTargetYearOverride(undefined);
    setTargetClassOverride(undefined);
    setDeselectedExamIds(new Set());
  }

  function changeTargetYear(id: string) {
    // Radix `Select`'s hidden native-select fallback can fire `onValueChange`
    // with `''` while syncing to a controlled value that starts empty
    // (before classes/years have loaded) — never treat that as a real pick.
    if (!id) return;
    mutation.reset();
    setTargetYearOverride(id);
    setTargetClassOverride(undefined);
  }

  function changeTargetClass(id: string) {
    if (!id) return;
    mutation.reset();
    setTargetClassOverride(id);
  }

  const classesQuery = useAllClasses();
  const yearsQuery = useAcademicYears({ limit: 100 });
  const classes = classesQuery.data ?? [];
  const years = yearsQuery.data?.data ?? [];

  const sourceClass = classes.find((cls) => cls.id === sourceClassId);
  const sourceYear = years.find((year) => year.id === sourceClass?.academic_year_id);

  const defaultTargetYearId = sourceYear
    ? years
        .filter((year) => year.start_date > sourceYear.start_date)
        .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0]?.id
    : undefined;
  const targetYearId = targetYearOverride ?? defaultTargetYearId;
  const targetYearName = years.find((year) => year.id === targetYearId)?.name;

  const suggestion = useSuggestPromotionTarget(sourceClassId, targetYearId);

  const targetClassesQuery = useClasses(
    targetYearId ? { academic_year_id: targetYearId, limit: 100 } : {},
  );
  const targetClasses = targetYearId ? (targetClassesQuery.data?.data ?? []) : [];
  const targetClassId = targetClassOverride ?? suggestion.data?.target_class?.id;

  const examsQuery = useQuery({
    ...examsQueryOptions(
      sourceClass
        ? { class_id: sourceClass.id, academic_year_id: sourceClass.academic_year_id, limit: 100 }
        : {},
    ),
    enabled: sourceClass !== undefined,
  });
  const published = (examsQuery.data?.data ?? []).filter((exam) => exam.status === 'PUBLISHED');
  const selectedExamIds = published
    .filter((exam) => !deselectedExamIds.has(exam.id))
    .map((exam) => exam.id);

  function toggleExam(examId: string, checked: boolean) {
    mutation.reset();
    setDeselectedExamIds((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(examId);
      else next.add(examId);
      return next;
    });
  }

  const suggestionReason = suggestion.data?.blocking_reason;
  const mutationErrorRawCode =
    mutation.error instanceof ApiError ? mutation.error.details?.code : undefined;
  const mutationErrorCode = isBlockingReason(mutationErrorRawCode)
    ? mutationErrorRawCode
    : undefined;
  const reason: BlockingReason | undefined = mutationErrorCode ?? suggestionReason;

  const isBlocked = (() => {
    if (reason === undefined) return false;
    if (reason === 'RETAIN_CLASS_MISSING') return true;
    if (reason === 'PICK_TARGET_CLASS') return targetClassId === undefined;
    if (reason === 'TARGET_SECTIONS_MISSING') {
      return targetClassId === suggestion.data?.target_class?.id;
    }
    return false;
  })();

  const showGraduateReadOnly =
    suggestion.data !== undefined &&
    suggestion.data.target_class === null &&
    suggestion.data.blocking_reason === undefined &&
    targetClassOverride === undefined;

  // Translated, never the raw `error.message`.
  const otherErrorKey =
    mutation.error != null && mutationErrorCode === undefined
      ? 'newRunForm.createFailed'
      : suggestion.isError
        ? 'newRunForm.suggestFailed'
        : undefined;

  const dirty =
    sourceClassId !== classId ||
    targetYearOverride !== undefined ||
    targetClassOverride !== undefined ||
    deselectedExamIds.size > 0 ||
    algorithm !== PlacementAlgorithm.BLOCK;

  const submitDisabled =
    !sourceClassId ||
    !targetYearId ||
    suggestion.isLoading ||
    selectedExamIds.length === 0 ||
    isBlocked ||
    mutation.isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceClassId || !targetYearId || submitDisabled) return;
    mutation.mutate(
      {
        source_class_id: sourceClassId,
        target_academic_year_id: targetYearId,
        exam_ids: selectedExamIds,
        algorithm,
        ...(targetClassId !== undefined ? { target_class_id: targetClassId } : {}),
      },
      {
        onSuccess: (run) => {
          void navigate({ to: '/promotions/$runId', params: { runId: run.id } });
        },
      },
    );
  }

  const optionClass =
    'flex min-h-11 items-start gap-3 rounded-md border border-border-subtle p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary';
  const cardClass = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';
  const placeholder = t('newRunForm.placeholder');
  const required = (
    <span aria-hidden="true" className="text-status-overdue-fg">
      {' '}
      *
    </span>
  );

  return (
    <FullPageShell
      title={t('newRunForm.title')}
      onClose={close}
      size="form"
      dirty={dirty}
      secondary={{
        label: t('newRunForm.cancel'),
        onClick: () => (dirty ? setDiscardOpen(true) : close()),
        disabled: mutation.isPending,
      }}
      primary={{
        label: t('newRunForm.create'),
        onClick: () => formRef.current?.requestSubmit(),
        disabled: submitDisabled,
        busy: mutation.isPending,
      }}
    >
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        <section className={cardClass}>
          <h2 className="text-h2">{t('newRunForm.classesTitle')}</h2>
          <p className="mt-0.5 text-text-secondary">{t('newRunForm.classesHelp')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promotion-source-class">
                {t('newRunForm.sourceClassLabel')}
                {required}
              </Label>
              <Select value={sourceClassId ?? ''} onValueChange={changeSource}>
                <SelectTrigger
                  id="promotion-source-class"
                  aria-label={t('newRunForm.sourceClassLabel')}
                  className="w-full"
                >
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => {
                    const yearName = years.find((year) => year.id === cls.academic_year_id)?.name;
                    return (
                      <SelectItem key={cls.id} value={cls.id}>
                        {yearName ? `${cls.name} (${yearName})` : cls.name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promotion-target-year">
                {t('newRunForm.targetYearLabel')}
                {required}
              </Label>
              <Select value={targetYearId ?? ''} onValueChange={changeTargetYear}>
                <SelectTrigger
                  id="promotion-target-year"
                  aria-label={t('newRunForm.targetYearLabel')}
                  className="w-full"
                >
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-caption text-text-secondary">{t('newRunForm.suggestedHelp')}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              {showGraduateReadOnly ? (
                <span className="inline-flex items-center gap-1">
                  <span className="text-sm font-medium">{t('newRunForm.targetClassLabel')}</span>
                  <HelpHint
                    helpId="examsResults.promotion.field.targetClass"
                    label={t('newRunForm.targetClassLabel')}
                  />
                </span>
              ) : (
                <Label
                  htmlFor="promotion-target-class"
                  helpId="examsResults.promotion.field.targetClass"
                >
                  {t('newRunForm.targetClassLabel')}
                </Label>
              )}
              {showGraduateReadOnly ? (
                <p className="text-text-secondary">{t('newRunForm.graduateOption')}</p>
              ) : (
                <Select
                  value={targetClassId ?? ''}
                  onValueChange={changeTargetClass}
                  disabled={!targetYearId}
                >
                  <SelectTrigger
                    id="promotion-target-class"
                    aria-label={t('newRunForm.targetClassLabel')}
                    className="w-full"
                  >
                    <SelectValue placeholder={placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {targetClasses.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!showGraduateReadOnly && (
                <p className="text-caption text-text-secondary">{t('newRunForm.suggestedHelp')}</p>
              )}
            </div>
          </div>

          {reason !== undefined && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md bg-status-overdue-bg p-3 text-status-overdue-fg"
            >
              <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{t(BLOCKING_KEY[reason])}</p>
                {targetYearId && (
                  <Link
                    to="/classes"
                    search={{ academic_year_id: targetYearId }}
                    className="font-medium underline underline-offset-2"
                  >
                    {t('newRunForm.openClasses', { year: targetYearName ?? '' })}
                  </Link>
                )}
              </div>
            </div>
          )}
          {otherErrorKey !== undefined && (
            <p role="alert" className="mt-4 text-status-overdue-fg">
              {t(otherErrorKey)}
            </p>
          )}
        </section>

        <section className={cardClass}>
          <fieldset>
            <legend className="text-h2">{t('newRunForm.examsLabel')}</legend>
            <p className="mt-0.5 text-text-secondary">
              {t('newRunForm.examsHelp')}{' '}
              <HelpHint
                helpId="examsResults.promotion.field.exams"
                label={t('newRunForm.examsLabel')}
              />
            </p>
            {published.length === 0 ? (
              <p className="mt-3 text-text-secondary">{t('newRunForm.noPublishedExams')}</p>
            ) : (
              <div className="mt-3 divide-y divide-border-subtle">
                {published.map((exam) => (
                  <label key={exam.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      checked={!deselectedExamIds.has(exam.id)}
                      onCheckedChange={(checked) => toggleExam(exam.id, checked === true)}
                    />
                    {exam.name}
                  </label>
                ))}
              </div>
            )}
            {published.length > 0 && selectedExamIds.length === 0 && (
              <p role="alert" className="mt-2 text-status-overdue-fg">
                {t('newRunForm.examsRequired')}
              </p>
            )}
          </fieldset>
        </section>

        <section className={cardClass}>
          <fieldset>
            <legend className="text-h2">{t('newRunForm.algorithmLabel')}</legend>
            <p className="mt-0.5 text-text-secondary">
              {t('newRunForm.algorithmHelp')}{' '}
              <HelpHint
                helpId="examsResults.promotion.field.algorithm"
                label={t('newRunForm.algorithmLabel')}
              />
            </p>
            <RadioGroup
              aria-label={t('newRunForm.algorithmLabel')}
              value={algorithm}
              onValueChange={(value) => setAlgorithm(value as PlacementAlgorithm)}
              className="mt-4 grid gap-3 md:grid-cols-2"
            >
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the Radix radio is a button inside the label */}
              <label className={optionClass}>
                <RadioGroupItem value={PlacementAlgorithm.BLOCK} className="mt-1" />
                <span>
                  <span className="block font-medium">{t('newRunForm.algorithmBlock')}</span>
                  <span className="block text-text-secondary">
                    {t('newRunForm.algorithmBlockHelp')}
                  </span>
                </span>
              </label>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- the Radix radio is a button inside the label */}
              <label className={optionClass}>
                <RadioGroupItem value={PlacementAlgorithm.SNAKE} className="mt-1" />
                <span>
                  <span className="block font-medium">{t('newRunForm.algorithmSnake')}</span>
                  <span className="block text-text-secondary">
                    {t('newRunForm.algorithmSnakeHelp')}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>
        </section>
      </form>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="danger"
        title={t('fullPage.discardTitle', { ns: 'common' })}
        description={t('fullPage.discardDescription', { ns: 'common' })}
        confirmLabel={t('fullPage.discardConfirm', { ns: 'common' })}
        cancelLabel={t('fullPage.keepEditing', { ns: 'common' })}
        onConfirm={() => {
          setDiscardOpen(false);
          close();
        }}
      />
    </FullPageShell>
  );
}

function NewPromotionRunPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
