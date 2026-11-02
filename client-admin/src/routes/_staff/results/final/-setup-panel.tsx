/**
 * [70.5.3] Setup tab: which exams count and how much each is worth, in one card. The rarely used
 * rules sit in a closed "More rules" fold (D6). Shares must total 100, checked as you type; the
 * server re-checks (`effectiveShares`). TERM exams start ticked and MONTHLY unticked (D3), because
 * the server created the weights that way; this panel only edits them.
 */
import type {
  FinalResultMode,
  FinalResultRounding,
  FinalResultSummary,
  FinalResultWeightDto,
} from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  ErrorState,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import { useClassSubjects, useExams, useUpdateFinalResult } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { subjectLabel } from '../../exams/-detail/subject-label';

import { buildWeights, equalShares, previewShares, sumShares } from './-share-rules';

export interface SetupExam {
  id: string;
  name: string;
  kind: string;
}

export interface SetupPanelProps {
  summary: FinalResultSummary;
}

const NUM = 'w-24 text-end tabular-nums';
const text = (v: number | undefined) => (v === undefined ? '' : String(v));
const num = (v: string | undefined): number | undefined =>
  v === undefined || v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v);

/** Loads the class's published exams, then hands off to the form with them in hand. */
export function SetupPanel({ summary }: SetupPanelProps) {
  const { t } = useTranslation('exams');
  const query = useExams({
    academic_year_id: summary.academic_year.id,
    class_id: summary.class.id,
    limit: 100,
  });
  if (query.isLoading) return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <ErrorState message={t('finalResults.loadError')} onRetry={() => void query.refetch()} />
    );
  const exams = (query.data?.data ?? [])
    .filter((e) => e.status === 'PUBLISHED')
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
  // Remount when the server copy changes (a rebuild, a reopen, our own save) so the form never
  // shows or saves stale values.
  const version = JSON.stringify([
    summary.status,
    summary.mode,
    summary.best_of_count,
    summary.rounding,
    summary.fail_if_any_exam_fails,
    summary.weights,
  ]);
  return <SetupForm key={version} summary={summary} exams={exams} />;
}

export function SetupForm({ summary, exams }: { summary: FinalResultSummary; exams: SetupExam[] }) {
  const { t, i18n } = useTranslation('exams');
  const config = useRegionConfig();
  const update = useUpdateFinalResult(summary.id);
  const subjects = useClassSubjects(summary.class.id, summary.academic_year.id);
  const locked = summary.status === 'PUBLISHED';

  const counted = new Set(summary.weights.map((w) => w.exam_id));
  const [ticked, setTicked] = React.useState<Set<string>>(
    () =>
      new Set(
        counted.size > 0
          ? exams.filter((e) => counted.has(e.id)).map((e) => e.id)
          : exams.filter((e) => e.kind === 'TERM').map((e) => e.id),
      ),
  );
  const [shares, setShares] = React.useState<Record<string, string>>(() => {
    const whole = summary.weights.filter((w) => w.subject_id === null);
    const eq = equalShares(ticked.size);
    const ids = [...ticked];
    return Object.fromEntries(
      exams.map((e) => [
        e.id,
        text(whole.find((w) => w.exam_id === e.id)?.share_percent ?? eq[ids.indexOf(e.id)]),
      ]),
    );
  });
  const [perSubject, setPerSubject] = React.useState(() =>
    summary.weights.some((w) => w.subject_id !== null),
  );
  const [subjectShares, setSubjectShares] = React.useState<Record<string, Record<string, string>>>(
    () => {
      const out: Record<string, Record<string, string>> = {};
      for (const w of summary.weights) {
        if (w.subject_id === null) continue;
        (out[w.subject_id] ??= {})[w.exam_id] = text(w.share_percent);
      }
      return out;
    },
  );
  const [rounding, setRounding] = React.useState<FinalResultRounding>(summary.rounding);
  const [failAny, setFailAny] = React.useState(summary.fail_if_any_exam_fails);
  const [bestOf, setBestOf] = React.useState<boolean>(summary.mode === 'BEST_OF');
  const [bestOfCount, setBestOfCount] = React.useState(text(summary.best_of_count ?? 2));

  const examIds = exams.filter((e) => ticked.has(e.id)).map((e) => e.id);
  const parsed = (row: Record<string, string> | undefined) =>
    Object.fromEntries(examIds.map((id) => [id, num(row?.[id])]));
  const wholeParsed = parsed(shares);
  const wholeSum = sumShares(examIds.map((id) => wholeParsed[id]));
  const wholeBad = !bestOf && examIds.length > 0 && wholeSum !== 100;

  const subjectList = subjects.data ?? [];
  const subjectRows = Object.fromEntries(
    subjectList.map((s) => [s.subject_id, parsed(subjectShares[s.subject_id] ?? shares)]),
  );
  const rowBad = (subjectId: string) =>
    perSubject && !bestOf && sumShares(examIds.map((id) => subjectRows[subjectId]?.[id])) !== 100;
  const anyRowBad = subjectList.some((s) => rowBad(s.subject_id));
  const countNum = num(bestOfCount);
  const countBad = bestOf && (countNum === undefined || countNum < 1 || countNum > examIds.length);
  const invalid = examIds.length === 0 || wholeBad || anyRowBad || countBad;

  const weights = (): FinalResultWeightDto[] =>
    buildWeights({
      examIds,
      shares: wholeParsed,
      subjectShares: perSubject && !bestOf ? subjectRows : {},
      bestOf,
    });

  const save = () => {
    update.mutate(
      {
        mode: (bestOf ? 'BEST_OF' : 'WEIGHTED') satisfies FinalResultMode,
        best_of_count: bestOf ? (countNum ?? null) : null,
        rounding,
        fail_if_any_exam_fails: failAny,
        weights: weights(),
      },
      {
        onSuccess: () => toast.success(t('finalResults.setup.saved')),
        onError: () => toast.error(t('finalResults.setup.saveError')),
      },
    );
  };

  if (exams.length === 0) {
    return <p className="text-text-secondary">{t('finalResults.setup.noExams')}</p>;
  }

  const preview = previewShares;
  const previewWeights = weights();

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border-subtle p-4 md:p-6">
      <section aria-labelledby="final-exams" className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 id="final-exams" className="text-h3">
            {t('finalResults.setup.examsHeading')}
          </h2>
        </div>
        <p className="text-caption text-text-secondary">{t('help.finalResults.share')}</p>
        <ul className="flex flex-col gap-1">
          {exams.map((e) => {
            const on = ticked.has(e.id);
            return (
              <li key={e.id} className="flex min-h-11 items-center gap-3 md:min-h-8">
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <Checkbox
                    checked={on}
                    disabled={locked}
                    onCheckedChange={(v) => {
                      // A newly ticked exam starts with whatever is left of the 100.
                      if (v === true && (shares[e.id] ?? '') === '') {
                        const rest = 100 - sumShares(examIds.map((id) => wholeParsed[id]));
                        setShares((p) => ({ ...p, [e.id]: rest > 0 ? String(rest) : '' }));
                      }
                      setTicked((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(e.id);
                        else next.delete(e.id);
                        return next;
                      });
                    }}
                  />
                  <span className="truncate">{e.name}</span>
                </label>
                {on && !bestOf && (
                  <span className="flex items-center gap-1">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="0.01"
                      className={NUM}
                      aria-label={`${e.name} · ${t('finalResults.setup.shareColumn')}`}
                      aria-invalid={wholeBad}
                      disabled={locked}
                      value={shares[e.id] ?? ''}
                      onChange={(ev) => setShares((p) => ({ ...p, [e.id]: ev.target.value }))}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {!bestOf && examIds.length > 0 && (
          <p
            role={wholeBad ? 'alert' : 'status'}
            className={
              wholeBad
                ? 'flex items-center gap-1 text-caption text-destructive'
                : 'text-caption text-text-secondary'
            }
          >
            {wholeBad && <CircleAlertIcon aria-hidden="true" className="size-3.5" />}
            {wholeBad
              ? t('finalResults.setup.shareError', {
                  sum: formatNumber(wholeSum, config, { decimals: wholeSum % 1 ? 2 : 0 }),
                })
              : t('finalResults.setup.shareSum', { sum: formatNumber(wholeSum, config) })}
          </p>
        )}
      </section>

      <details className="rounded-md border border-border-subtle">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium md:min-h-8">
          {t('finalResults.setup.moreRules')}
        </summary>
        <div className="flex flex-col gap-5 border-t border-border-subtle p-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <span id="rounding-label" className="text-label">
                {t('finalResults.rules.rounding.label')}
              </span>
            </div>
            <p className="text-caption text-text-secondary">{t('help.finalResults.rounding')}</p>
            <RadioGroup
              aria-labelledby="rounding-label"
              value={rounding}
              onValueChange={(v) => setRounding(v as FinalResultRounding)}
              disabled={locked}
            >
              {(
                [
                  ['WHOLE', 'whole'],
                  ['TWO_DECIMALS', 'twoDecimals'],
                ] as const
              ).map(([value, key]) => (
                <label key={value} className="flex min-h-11 items-center gap-3 md:min-h-8">
                  <RadioGroupItem value={value} />
                  {t(`finalResults.rules.rounding.${key}`)}
                </label>
              ))}
            </RadioGroup>
          </div>

          <SwitchRow
            id="fail-any"
            label={t('finalResults.rules.failIfAnyExamFails.label')}
            description={t('help.finalResults.failIfAnyExamFails')}
            checked={failAny}
            disabled={locked}
            onChange={setFailAny}
          />
          <SwitchRow
            id="per-subject"
            label={t('finalResults.rules.perSubjectShare.label')}
            description={t('help.finalResults.perSubjectShare')}
            checked={perSubject}
            disabled={locked || bestOf}
            onChange={setPerSubject}
          />
          <SwitchRow
            id="best-of"
            label={t('finalResults.rules.bestOf.label')}
            description={t('help.finalResults.bestOf')}
            checked={bestOf}
            disabled={locked}
            onChange={setBestOf}
          />
          {bestOf && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="best-of-count">{t('finalResults.rules.bestOf.countLabel')}</Label>
              <Input
                id="best-of-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={examIds.length}
                className={NUM}
                aria-invalid={countBad}
                disabled={locked}
                value={bestOfCount}
                onChange={(ev) => setBestOfCount(ev.target.value)}
              />
              {countBad && (
                <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
                  <CircleAlertIcon aria-hidden="true" className="size-3.5" />
                  {t('finalResults.rules.bestOf.countError')}
                </p>
              )}
            </div>
          )}
        </div>
      </details>

      {!bestOf && examIds.length > 0 && subjectList.length > 0 && (
        <section aria-labelledby="final-preview" className="flex flex-col gap-2">
          <h2 id="final-preview" className="text-h3">
            {t('finalResults.setup.previewHeading')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th scope="col" className="py-1 pe-3 font-medium">
                    {t('finalResults.rules.perSubjectShare.subjectColumn')}
                  </th>
                  {exams
                    .filter((e) => ticked.has(e.id))
                    .map((e) => (
                      <th key={e.id} scope="col" className="px-2 py-1 text-end font-medium">
                        {e.name}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {subjectList.map((s) => {
                  const name = subjectLabel(s.subject, i18n.language);
                  const shown = preview(previewWeights, examIds, s.subject_id);
                  return (
                    <tr key={s.subject_id} className="border-t border-border-subtle">
                      <th scope="row" className="py-1 pe-3 font-normal">
                        {name}
                      </th>
                      {examIds.map((id) => (
                        <td key={id} className="px-2 py-1 text-end tabular-nums">
                          {perSubject && !locked ? (
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              max={100}
                              step="0.01"
                              className={NUM}
                              aria-label={`${name} · ${exams.find((e) => e.id === id)?.name}`}
                              aria-invalid={rowBad(s.subject_id)}
                              value={subjectShares[s.subject_id]?.[id] ?? shares[id] ?? ''}
                              onChange={(ev) =>
                                setSubjectShares((p) => ({
                                  ...p,
                                  [s.subject_id]: {
                                    ...Object.fromEntries(examIds.map((x) => [x, shares[x] ?? ''])),
                                    ...p[s.subject_id],
                                    [id]: ev.target.value,
                                  },
                                }))
                              }
                            />
                          ) : (
                            `${formatNumber(shown[id] ?? 0, config, { decimals: (shown[id] ?? 0) % 1 ? 2 : 0 })}%`
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {anyRowBad && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              <CircleAlertIcon aria-hidden="true" className="size-3.5" />
              {t('finalResults.setup.subjectShareError')}
            </p>
          )}
          <p className="text-caption text-text-secondary">{t('finalResults.setup.previewNote')}</p>
        </section>
      )}

      {locked && <p className="text-text-secondary">{t('finalResults.setup.locked')}</p>}

      <div>
        <Button
          type="button"
          className="w-full md:w-auto"
          disabled={locked || invalid}
          loading={update.isPending}
          onClick={save}
        >
          {t('finalResults.setup.save')}
        </Button>
      </div>
    </div>
  );
}

function SwitchRow(props: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={props.id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
        aria-describedby={`${props.id}-desc`}
      />
      <div className="flex min-w-0 flex-col">
        <Label htmlFor={props.id}>{props.label}</Label>
        <span id={`${props.id}-desc`} className="text-caption text-text-secondary">
          {props.description}
        </span>
      </div>
    </div>
  );
}
