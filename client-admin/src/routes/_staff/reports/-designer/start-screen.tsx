/**
 * [8.15.41] `/reports/new` before the designer: pick a ready report or ask a question. The blank
 * page is last, and small.
 *
 * ```
 *  একটি তৈরি রিপোর্ট থেকে শুরু করুন
 *  [ ছাত্রছাত্রীর তালিকা ] [ শ্রেণি ও লিঙ্গ অনুযায়ী ছাত্রসংখ্যা ] …     <- one click makes a copy to change
 *
 *  একটি প্রশ্ন দিয়ে শুরু করুন
 *  ┌ কতজন …, … অনুযায়ী? ────────┐ ┌ কাদের তালিকা, যারা …? ┐ …
 *  │ [ছাত্রছাত্রী v] [শ্রেণি v] [লিঙ্গ v] │ │ [ছাত্রী v] [শ্রেণি v]  │
 *  │ [শুরু করুন]                │ │ [শুরু করুন]            │
 *  └────────────────────────────┘ └───────────────────────┘
 *  ফাঁকা থেকে শুরু                                            <- small link, last
 * ```
 *
 * A ready report is cloned on the server into a draft (`POST …/clone`) and opens in the editor. A
 * question never touches the server: it hands the designer a plan (`planStarter`) and nothing is
 * saved until the person saves. Every field and count name in a dropdown is the registry's own label
 * from `GET /reports/meta`.
 */
import {
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { Skeleton } from '@biddaloy/ui/components';
import {
  allClassesQueryOptions,
  useCloneReportDefinition,
  useReportCatalogue,
  type ReportMeta,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import {
  STARTERS,
  STARTER_IDS,
  initialAnswers,
  planStarter,
  splitKeysFor,
  type StarterAnswers,
  type StarterBlank,
  type StarterId,
  type StarterPlan,
} from './question-starters';

export interface StartScreenProps {
  meta: ReportMeta;
  /** A question was chosen: open the designer with this plan. `null` is the blank page. */
  onStart: (plan: StarterPlan | null) => void;
}

/** Radix Select has no empty item value, so "anything" is this word. */
const ANY = '__any';

export function StartScreen({ meta, onStart }: StartScreenProps) {
  const { t } = useTranslation('reportDesigner');
  const { t: tReports } = useTranslation('reports');
  const { locale } = useLocale();
  const navigate = useNavigate();
  const catalogue = useReportCatalogue();
  const clone = useCloneReportDefinition();
  const [cloneFailed, setCloneFailed] = React.useState(false);
  const inFlight = React.useRef(false);

  const ready = (catalogue.data ?? []).flatMap((folder) => folder.reports);

  async function startFrom(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setCloneFailed(false);
    try {
      const copy = await clone.mutateAsync(id);
      await navigate({ to: '/reports/$reportId/edit', params: { reportId: copy.id } });
    } catch {
      setCloneFailed(true);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-6 md:gap-8">
        <PageHeader title={t('title.new')} subtitle={t('start.subtitle')} />

        <section aria-labelledby="start-ready" className="flex flex-col gap-3">
          <h2 id="start-ready" className="text-h2">
            {t('start.ready.title')}
          </h2>
          {catalogue.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : ready.length === 0 ? (
            <p className="text-text-secondary">{t('start.ready.none')}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ready.map((entry) => {
                const name = (locale === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={clone.isPending}
                      onClick={() => void startFrom(entry.id)}
                      className="flex min-h-24 w-full flex-col items-start gap-1 rounded-lg border border-border-subtle bg-surface p-4 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 md:p-5"
                    >
                      <span className="font-medium text-text-primary">{name}</span>
                      <span className="text-text-secondary">
                        {tReports('hub.definedDescription')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {cloneFailed && (
            <p role="alert" className="text-sm text-destructive">
              {t('start.ready.error')}
            </p>
          )}
        </section>

        <section aria-labelledby="start-question" className="flex flex-col gap-3">
          <h2 id="start-question" className="text-h2">
            {t('start.question.title')}
          </h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {STARTER_IDS.map((id) => (
              <li key={id}>
                <StarterCard id={id} meta={meta} onStart={onStart} />
              </li>
            ))}
          </ul>
        </section>

        <div>
          <Button
            type="button"
            variant="link"
            className="h-auto px-0"
            onClick={() => onStart(null)}
          >
            {t('start.blank')}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}

function StarterCard({
  id,
  meta,
  onStart,
}: {
  id: StarterId;
  meta: ReportMeta;
  onStart: (plan: StarterPlan) => void;
}) {
  const { t } = useTranslation('reportDesigner');
  const { t: tReports } = useTranslation('reports');
  const { locale } = useLocale();
  const [answers, setAnswers] = React.useState<StarterAnswers>(() => initialAnswers(id));
  const headingId = React.useId();

  // The school's classes, for "who are in [class]". A role that may not read them just has no list.
  const classes = useQuery({ ...allClassesQueryOptions(), enabled: id === 'whoList' });

  const labelOf = (areaKeys: string[], key: string) => {
    for (const area of meta.areas.filter((a) => areaKeys.includes(a.key))) {
      const item = [...area.fields, ...area.measures].find((x) => x.key === key);
      if (item) return locale === 'bn' ? item.label_bn : item.label_en;
    }
    return key;
  };

  const set = (blank: string, value: string) =>
    setAnswers((previous) => {
      const next = { ...previous, [blank]: value === ANY ? '' : value };
      // A different subject has different splits: drop the ones that no longer fit.
      if (id === 'howMany' && blank === 'subject') {
        const allowed = splitKeysFor(value);
        if (!allowed.includes(next.first ?? '')) next.first = allowed[0] ?? '';
        if (!allowed.includes(next.second ?? '')) next.second = '';
      }
      return next;
    });

  function options(blank: StarterBlank): { value: string; label: string }[] {
    if (blank.kind === 'values') {
      if (blank.field === 'class') {
        return [...new Set((classes.data ?? []).map((c) => c.name))].map((name) => ({
          value: name,
          label: name,
        }));
      }
      const gender = meta.areas
        .find((a) => a.key === 'STUDENTS')
        ?.fields.find((f) => f.key === 'gender');
      return (gender?.enum_values ?? ['MALE', 'FEMALE']).map((value) => ({
        value,
        label: ['MALE', 'FEMALE', 'OTHER'].includes(value)
          ? tReports(`studentCount.gender.${value}`)
          : value,
      }));
    }
    const subject = answers.subject;
    return blank.choices
      .filter((choice) =>
        id === 'howMany' && blank.id !== 'subject'
          ? splitKeysFor(subject).includes(choice.key)
          : true,
      )
      .map((choice) => ({
        value: choice.value,
        label: labelOf(
          choice.area === 'ANY'
            ? [subject === 'STAFF.staff' ? 'STAFF' : 'STUDENTS']
            : [choice.area],
          choice.key,
        ),
      }));
  }

  const blankLabel = (blank: StarterBlank): string => {
    switch (`${id}.${blank.id}`) {
      case 'howMany.subject':
        return t('starters.howMany.subject');
      case 'howMany.first':
        return t('starters.howMany.first');
      case 'howMany.second':
        return t('starters.howMany.second');
      case 'whoList.gender':
        return t('starters.whoList.gender');
      case 'whoList.class':
        return t('starters.whoList.class');
      case 'howMuch.amount':
        return t('starters.howMuch.amount');
      case 'howMuch.by':
        return t('starters.howMuch.by');
      default:
        return t('starters.perMonth.what');
    }
  };

  const title = {
    howMany: t('starters.howMany.title'),
    whoList: t('starters.whoList.title'),
    howMuch: t('starters.howMuch.title'),
    perMonth: t('starters.perMonth.title'),
  }[id];

  return (
    <Card padded role="group" aria-labelledby={headingId}>
      <div className="flex flex-col gap-3">
        <h3 id={headingId} className="text-h3">
          {title}
        </h3>
        <div className="flex flex-wrap gap-3">
          {STARTERS[id].blanks.map((blank) => {
            const labelId = `${headingId}-${blank.id}`;
            const optional = blank.kind === 'values' || blank.optional === true;
            const value = answers[blank.id] || (optional ? ANY : '');
            return (
              <div key={blank.id} className="flex min-w-40 flex-1 flex-col gap-1">
                <span id={labelId} className="text-caption text-text-secondary">
                  {blankLabel(blank)}
                </span>
                <Select value={value} onValueChange={(next) => set(blank.id, next)}>
                  <SelectTrigger aria-labelledby={labelId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {optional && <SelectItem value={ANY}>{t('start.question.any')}</SelectItem>}
                    {options(blank).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
        <div>
          <Button type="button" onClick={() => onStart(planStarter(id, answers))}>
            {t('start.question.go')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
