import {
  Button,
  Card,
  DatePicker,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentStatement,
  type Student,
  type StatementEntry,
  type StudentStatement,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatServerAmount, toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import {
  STATEMENT_ROOT_CLASS,
  StatementHeadline,
  StatementPrintHeader,
  StatementWallet,
  isOwed,
  usePrintStatement,
} from '../../features/statement/statement-shared';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

/**
 * [8.15.38] `/portal/statement` — a guardian's view of what the school charged their child, what was
 * paid, and what is still owed. Phone first:
 *
 * ```
 *  হিসাব
 *  Fatima · Class 6 A · Roll 12
 *  [Fatima] [Karim]                      ← child switcher, only with more than one child
 *  [From] [To]                           [ডাউনলোড / প্রিন্ট]
 *  ┌────────────────────────┐
 *  │ এখন বাকি: ৳১,২০০       │  ← large; or "সব পরিশোধ হয়েছে"; then "শেষ জমা: …"
 *  └────────────────────────┘
 *  শুরুতে বাকি ৳০
 *  ┌ ০১ মার্চ · Tuition ────┐   one card per line: date, what, বিল / জমা, "এর পরে বাকি"
 *  শেষে বাকি ৳১,২০০
 * ```
 *
 * Words (D21, the 8.15 glossary): বিল / জমা / বাকি. The API's `debit` / `credit` / `balance` never
 * reach the screen. The headline, the "last paid" rule, the print header and the wallet note come
 * from `features/statement/statement-shared.tsx`, the same code the staff Fees tab uses, so staff
 * and guardian read the same closing balance for the same student.
 *
 * - **No "Pay now".** Online payment (Epic 3.0) is not live; this page is for reading and for
 *   keeping a copy. Add the button beside the download button only when that epic ships.
 * - **One "ডাউনলোড / প্রিন্ট" button.** It opens the browser's print dialog for this page's
 *   statement alone (the school's name on top); "Save as PDF" there is the download. The server
 *   never makes a PDF (print module, D1/D2).
 * - **No default start date.** A guardian cannot read `/academic-years`, so the page cannot know
 *   when the current year began; it asks for everything and says so. The closing balance does not
 *   depend on the start date (an earlier start only changes which lines are listed), so it still
 *   matches the staff screen. The pickers narrow the list.
 * - **Heading structure.** `useRouteFocus` focuses the `<h1>`: one when settled (the page title),
 *   none while loading or failing, as in `portal/fees.tsx`.
 *
 * Region config comes from a value-less `RegionConfigProvider` (a guardian cannot read the school
 * settings), as in `portal/fees.tsx`.
 */
const statementSearchSchema = z.object({
  /** Which linked student to show. The server re-checks the link on every request; an id that is
   * not in the caller's own list falls back to the first child. */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/statement')({
  validateSearch: statementSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'fees'),
    ]),
  pendingComponent: PortalStatementPending,
  component: PortalStatementRoute,
});

function PortalStatementRoute() {
  return (
    <RegionConfigProvider>
      <PortalStatement />
    </RegionConfigProvider>
  );
}

function StatementSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  );
}

function PortalStatement() {
  const { t } = useTranslation('fees');
  const { t: tPortal } = useTranslation('portal');
  const { t: tNav } = useTranslation('nav');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();
  const handlePrint = usePrintStatement();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];
  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const [from, setFrom] = React.useState<Date | undefined>(undefined);
  const [to, setTo] = React.useState<Date | undefined>(undefined);
  const statementQuery = useStudentStatement({
    studentId: selected?.id,
    audience: 'portal',
    from: from ? toIsoDate(from) : undefined,
    to: to ? toIsoDate(to) : undefined,
  });

  if (studentsQuery.isPending) return <StatementSkeleton label={t('statement.portal.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('statement.loadError')}
        retryLabel={tPortal('fees.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer>
        <PageHeader title={tNav('items.portalStatement')} />
        <EmptyState
          title={tPortal('empty.title')}
          explanation={tPortal('empty.explanation')}
          action={{ label: tPortal('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  if (statementQuery.isPending) {
    return (
      <StatementSkeleton label={t('statement.portal.loading')} showPicker={students.length > 1} />
    );
  }

  if (statementQuery.isError) {
    // One error frame, no `<h1>`, and never the server's own message.
    return (
      <ErrorState
        message={t('statement.loadError')}
        retryLabel={tPortal('fees.error.retry')}
        onRetry={() => void statementQuery.refetch()}
      />
    );
  }

  const statement = statementQuery.data;

  return (
    <PageContainer>
      <PageHeader
        title={tNav('items.portalStatement')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
      <div className="flex flex-col gap-4">
        {students.length > 1 && (
          <StudentPicker
            label={tPortal('fees.pickerLabel')}
            items={students.map((student) => ({
              id: student.id,
              name: student.full_name,
              meta: studentMeta(student),
            }))}
            selectedId={selected.id}
            to="/portal/statement"
          />
        )}

        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-text-secondary">{t('statement.from')}</span>
            <DatePicker
              value={from}
              onValueChange={setFrom}
              config={config}
              aria-label={t('statement.fromLabel')}
              placeholder={t('statement.anyDate')}
              max={to}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-caption text-text-secondary">{t('statement.to')}</span>
            <DatePicker
              value={to}
              onValueChange={setTo}
              config={config}
              aria-label={t('statement.toLabel')}
              placeholder={t('statement.today')}
              min={from}
            />
          </div>
          <Button type="button" className="w-full sm:ms-auto sm:w-auto" onClick={handlePrint}>
            <PrinterIcon aria-hidden className="size-4" />
            {t('statement.portal.download')}
          </Button>
        </div>
        {from === undefined && (
          <p className="text-text-secondary print:hidden">{t('statement.portal.allDates')}</p>
        )}

        <div className={`${STATEMENT_ROOT_CLASS} flex flex-col gap-4`}>
          <StatementPrintHeader statement={statement} from={from} to={to} />
          <Card className="p-4">
            <StatementHeadline statement={statement} to={to} />
          </Card>
          <EntryCards statement={statement} config={config} />
          <StatementWallet statement={statement} />
        </div>
      </div>
    </PageContainer>
  );
}

function EntryCards({ statement, config }: { statement: StudentStatement; config: RegionConfig }) {
  const { t } = useTranslation('fees');
  const money = (amount: number | string) => formatServerAmount(amount, config);

  if (statement.entries.length === 0) {
    return (
      <EmptyState
        title={t('statement.empty.title')}
        explanation={t('statement.empty.explanation')}
      />
    );
  }

  return (
    <section aria-label={t('statement.portal.entriesLabel')} className="flex flex-col gap-3">
      <p className="flex items-baseline justify-between gap-2 font-semibold">
        <span>{t('statement.opening')}</span>
        <span className="tabular-nums">{money(statement.opening_balance)}</span>
      </p>
      <ol className="flex flex-col gap-3">
        {statement.entries.map((entry, index) => (
          <li key={`${entry.date}-${entry.kind}-${index}`}>
            <EntryCard entry={entry} config={config} />
          </li>
        ))}
      </ol>
      <p className="flex items-baseline justify-between gap-2 font-semibold">
        <span>{t('statement.closing')}</span>
        <span className="tabular-nums">{money(statement.closing_balance)}</span>
      </p>
    </section>
  );
}

function EntryCard({ entry, config }: { entry: StatementEntry; config: RegionConfig }) {
  const { t } = useTranslation('fees');
  const money = (amount: number | string) => formatServerAmount(amount, config);
  const charged = isOwed(entry.debit);
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-caption text-text-secondary">{formatDate(entry.date, config)}</p>
      <p className="font-medium">
        {entry.description}
        {(entry.kind === 'DISCOUNT' || entry.kind === 'REVERSAL') && (
          <span className="ms-2 text-caption text-text-secondary">
            {t(`statement.kind.${entry.kind}`)}
          </span>
        )}
      </p>
      <p className="flex items-baseline justify-between gap-2">
        <span>{charged ? t('statement.columns.charged') : t('statement.columns.paid')}</span>
        <span className="tabular-nums">{money(charged ? entry.debit : entry.credit)}</span>
      </p>
      <p className="text-text-secondary tabular-nums">
        {t('statement.portal.owedAfter', { amount: money(entry.balance) })}
      </p>
    </Card>
  );
}

function PortalStatementPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

/** The same "class section · roll" line `portal/fees.tsx` renders, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t: tPortal } = useTranslation('portal');
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? tPortal('children.metaNoClass', { roll })
      : tPortal('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
}
