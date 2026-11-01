/**
 * [48.3.08] `/print/document?doc=<kind>&...`: one chromeless route for the eight code-rendered
 * exam documents (D12). Loads the data, shows A4 pages under a Close / Print bar, prints in
 * place with `window.print()` (not a dialog, so a multi-page print is never clipped). Report
 * cards and transcripts write their audit row first; no log row, no print (D17, D26).
 *
 * [8.15.30] `doc=report` is the ninth kind, but not an exam document: it has its own screen
 * (`-document/report-pages.tsx`) and `PrintDocumentPage` only chooses between the two, so the
 * exam hooks below never run for a report. Its audit is the report run itself, not a
 * `document-prints` row (see that file).
 */
import { Permission } from '@biddaloy/shared';
import {
  BlankMarksSheet,
  Button,
  EmptyState,
  ErrorState,
  ExamRoutineNotice,
  InvigilatorSheet,
  ReportCard,
  SeatListSheet,
  SeatStickerSheet,
  Skeleton,
  TabulationSheet,
  YearlyTranscript,
  toast,
} from '@biddaloy/ui/components';
import {
  admitCardRosterQueryOptions,
  examComponentsAllQueryOptions,
  examScheduleQueryOptions,
  logDocumentPrint,
  resultDetailQueryOptions,
  seatPlanDetailQueryOptions,
  seatPlansQueryOptions,
  useClass,
  useClassSections,
  useExam,
  useGradingScale,
  useHasPermission,
  useSchoolProfile,
  useTabulation,
  useTranscript,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber, renderDigits } from '@biddaloy/ui/utils';
import { useQueries, useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { MonitorIcon, PrinterIcon, XIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { copyPageLink, useIsWide } from '../../../components/print/desktop-only-gate';
import { loadRouteNamespaces } from '../../../route-loaders';

import {
  marksPages,
  reportCardProps,
  routineRows,
  seatPages,
  stickerRows,
  tabulationProps,
  transcriptProps,
} from './-document/build-pages';
import { ReportDocumentPage } from './-document/report-pages';

const DOCS = [
  'seat-list',
  'invigilator',
  'stickers',
  'marks-sheet',
  'routine',
  'tabulation',
  'report-cards',
  'transcript',
  'report',
] as const;
/** The exam documents; `report` is handled by its own screen. */
type Doc = Exclude<(typeof DOCS)[number], 'report'>;

const DOC_KEY: Record<Doc, string> = {
  'seat-list': 'seatList',
  invigilator: 'invigilator',
  stickers: 'stickers',
  'marks-sheet': 'marksSheet',
  routine: 'routine',
  tabulation: 'tabulation',
  'report-cards': 'reportCards',
  transcript: 'transcript',
};

const uuid = z.string().uuid().optional().catch(undefined);

/**
 * `params` is the report's prompt answers as JSON. The router already parses a JSON-looking search
 * value, so it can arrive as an object or as a string; anything that is not a plain object is
 * "no answers" (the report then runs with its defaults), never an error.
 */
const reportParams = z
  .unknown()
  .transform((raw): Record<string, unknown> | undefined => {
    let value = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  })
  .catch(undefined)
  // Without this the key is required of every link to this page (`params: unknown`).
  .optional();
const searchSchema = z.object({
  // A bad or missing value falls back rather than breaking the page.
  doc: z.enum(DOCS).catch('seat-list'),
  exam_id: uuid,
  section_id: uuid,
  student_id: uuid,
  academic_year_id: uuid,
  // [8.15.30] `doc=report`: which report, and what its prompts were answered with.
  definitionId: uuid,
  params: reportParams,
  // An in-app path only: never navigate to an address typed into the URL.
  from: z
    .string()
    .regex(/^\/(?![/\\])/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_staff/print/document')({
  staticData: { chromeless: true },
  validateSearch: searchSchema,
  loader: () =>
    // `reportView` is for the report renderers; the names of the other kinds come from the first four.
    loadRouteNamespaces('examDocuments', 'printTemplates', 'exams', 'common', 'reportView'),
  component: PrintDocumentPage,
});

const STICKERS_PER_PAGE = 12;

function PrintDocumentPage() {
  const search = Route.useSearch();
  if (search.doc === 'report') {
    return (
      <ReportDocumentPage
        definitionId={search.definitionId}
        params={search.params}
        from={search.from}
      />
    );
  }
  return <ExamDocumentPage doc={search.doc} />;
}

function ExamDocumentPage({ doc }: { doc: Doc }) {
  const { t, i18n } = useTranslation('examDocuments');
  const { t: tG } = useTranslation('printTemplates');
  const { t: tE } = useTranslation('exams');
  const search = Route.useSearch();
  const { exam_id: examId, section_id: sectionId, student_id: studentId } = search;
  const academicYearId = search.academic_year_id;
  const router = useRouter();
  const wide = useIsWide();
  const config = useRegionConfig();
  const lang = i18n.language;
  const canResults = useHasPermission(Permission.RESULT_READ);

  const is = (...kinds: Doc[]) => kinds.includes(doc);
  const needsExam = doc !== 'transcript';
  const missing = needsExam
    ? examId === undefined ||
      ((doc === 'tabulation' || doc === 'report-cards') && sectionId === undefined)
    : studentId === undefined || academicYearId === undefined;
  const blocked = doc === 'report-cards' && !canResults;
  const on = !missing && !blocked;

  // ---- data (every hook runs; `enabled` keeps the unused ones quiet) ----
  const exam = useExam(needsExam ? examId : undefined);
  const classQ = useClass(exam.data?.class_id);
  const sectionsQ = useClassSections(is('marks-sheet') ? exam.data?.class_id : undefined);
  const profile = useSchoolProfile();
  const plans = useQuery({
    ...seatPlansQueryOptions(examId ? { examId } : {}),
    enabled: on && is('seat-list', 'invigilator', 'stickers'),
  });
  const planIds = (plans.data ?? []).filter((p) => p.status === 'PUBLISHED').map((p) => p.id);
  const details = useQueries({ queries: planIds.map((id) => seatPlanDetailQueryOptions(id)) });
  const schedule = useQuery({
    ...examScheduleQueryOptions(examId),
    enabled: on && is('seat-list', 'invigilator', 'stickers', 'routine', 'marks-sheet'),
  });
  const roster = useQuery({
    ...admitCardRosterQueryOptions(examId),
    enabled: on && is('marks-sheet'),
  });
  const components = useQuery({
    ...examComponentsAllQueryOptions(examId),
    enabled: on && is('marks-sheet'),
  });
  const tab = useTabulation(on && is('tabulation', 'report-cards') ? examId : undefined, sectionId);
  // Section membership comes from the tabulation (a result row has no section).
  const studentIds = React.useMemo(
    () =>
      [...(tab.data?.rows ?? [])]
        .sort((a, b) => a.roll_number - b.roll_number)
        .map((r) => r.student_id),
    [tab.data],
  );
  const results = useQueries({
    queries: studentIds.map((id) => ({
      ...resultDetailQueryOptions(examId, id),
      enabled: on && doc === 'report-cards',
    })),
  });
  const scale = useGradingScale(
    doc === 'report-cards' ? results[0]?.data?.result.grading_scale_id : undefined,
  );
  const transcript = useTranscript(
    on && doc === 'transcript' ? studentId : undefined,
    academicYearId,
  );

  const all = [
    ...(needsExam ? [exam] : []),
    profile,
    ...(is('marks-sheet') ? [sectionsQ] : []),
    plans,
    ...details,
    schedule,
    roster,
    components,
    tab,
    ...results,
    transcript,
  ];
  const loading = all.some((q) => q.isLoading) || (doc === 'report-cards' && scale.isLoading);
  const failed = all.some((q) => q.isError);

  // ---- build the pages ----
  const p = profile.data;
  const issuer = p && {
    name: p.name,
    name_bn: p.name_bn,
    address: p.address,
    phone: p.phone,
    email: p.email,
    registration_id: p.registration_id,
    logo_key: p.logo_url ? 'active' : null,
  };
  const logoUrl = p?.logo_url ?? null;
  const printedOn = formatDateTime(new Date(), config);
  const examName = exam.data?.name ?? '';
  const className = classQ.data?.name ?? tab.data?.section.class_name ?? '';
  const sch = schedule.data ?? [];
  const fmt = (n: number) => formatNumber(n, config);
  const signs = {
    classTeacher: t('sign.classTeacher'),
    examController: t('sign.examController'),
    headTeacher: t('sign.headTeacher'),
  };

  let pages: React.ReactNode = null;
  let count = 0;
  let title = '';
  let subtitle: string[] = [className];
  let logIds: string[] = [];

  if (issuer && !loading && !failed && on) {
    const common = { issuer, logoUrl, activeLanguage: lang, printedOn };
    const detailData = details.flatMap((d) => (d.data ? [d.data] : []));
    const seatLabels = {
      room: t('col.room', { room: '' }).trim(),
      seat: t('col.seat'),
      roll: t('col.roll'),
      name: t('col.name'),
      section: t('col.section'),
    };
    if (is('seat-list', 'invigilator')) {
      const sp = seatPages(detailData, sch, lang, config);
      count = sp.length;
      const base = { ...common, examName, className, pages: sp };
      pages =
        doc === 'seat-list' ? (
          <SeatListSheet
            {...base}
            labels={{
              ...seatLabels,
              // The sheet fills these `{{slot}}`s itself.
              seats: t('col.seats', {
                from: '{{first}}',
                to: '{{last}}',
                interpolation: { escapeValue: false },
              }),
              fromSeatPlan: t('page.fromSeatPlan'),
              pageOf: t('page.pageOf', {
                n: '{{page}}',
                total: '{{total}}',
                interpolation: { escapeValue: false },
              }),
            }}
          />
        ) : (
          <InvigilatorSheet
            {...base}
            labels={{
              ...seatLabels,
              present: t('col.present'),
              scriptNo: t('col.scriptNo'),
              signature: t('col.signature'),
              invigilator: t('sign.invigilator'),
            }}
          />
        );
    } else if (doc === 'stickers') {
      const rows = stickerRows(detailData, sch);
      count = Math.ceil(rows.length / STICKERS_PER_PAGE);
      pages = (
        <SeatStickerSheet
          issuer={issuer}
          stickers={rows}
          perPage={STICKERS_PER_PAGE}
          labels={{ roll: seatLabels.roll, room: seatLabels.room, seat: seatLabels.seat }}
        />
      );
    } else if (doc === 'marks-sheet' && roster.data && components.data) {
      const names = new Map<string, string>();
      for (const s of sch) {
        if (!s.subject) continue;
        names.set(
          s.subject_id,
          lang.startsWith('bn') && s.subject.name_bn ? s.subject.name_bn : s.subject.name_en,
        );
      }
      const sectionName = (sectionsQ.data ?? []).find((s) => s.id === sectionId)?.section_name;
      const mp = marksPages(roster.data, components.data, names, className, sectionName);
      count = mp.length;
      pages = (
        <BlankMarksSheet
          {...common}
          examName={examName}
          pages={mp}
          labels={{
            roll: t('col.roll'),
            name: t('col.name'),
            total: t('col.total'),
            teacher: t('sign.classTeacher'),
          }}
        />
      );
    } else if (doc === 'routine') {
      const rows = routineRows(sch, lang, config);
      count = rows.length > 0 ? 1 : 0;
      pages = (
        <ExamRoutineNotice
          {...common}
          examName={examName}
          className={className}
          rows={rows}
          labels={{
            title: t('doc.routine'),
            date: t('col.date'),
            day: t('col.day'),
            subject: t('col.subject'),
            time: t('col.time'),
            headTeacher: signs.headTeacher,
          }}
        />
      );
    } else if (doc === 'tabulation' && tab.data) {
      const tp = tabulationProps(tab.data, lang);
      count = tp.rows.length > 0 ? 1 : 0;
      subtitle = [tab.data.section.class_name, tab.data.section.name];
      pages = (
        <TabulationSheet
          {...common}
          examName={tab.data.exam.name}
          className={tab.data.section.class_name}
          section={tab.data.section.name}
          subjects={tp.subjects}
          rows={tp.rows}
          legend=""
          labels={{
            title: t('doc.tabulation'),
            roll: t('col.roll'),
            name: t('col.name'),
            fullMarks: t('col.fullMarks', { n: '' }).trim(),
            obtained: t('col.marks'),
            grade: t('col.grade'),
            total: t('col.total'),
            gpa: t('col.gpa'),
            merit: t('col.merit'),
            summary: t('tabulation.summary', {
              examinees: fmt(tp.examinees),
              passed: fmt(tp.passed),
              failed: fmt(tp.failed),
            }),
            ...signs,
          }}
        />
      );
    } else if (doc === 'report-cards') {
      const loaded = results.flatMap((r) => (r.data ? [r.data] : []));
      count = loaded.length;
      logIds = loaded.map((d) => d.student.id);
      const bands = scale.data?.bands ?? [];
      const rt = (k: string) => tE(`reportCard.${k}`);
      subtitle = [tab.data?.section.class_name ?? '', tab.data?.section.name ?? ''];
      pages = loaded.map((d) => (
        <div key={d.student.id} className="break-after-page">
          <ReportCard
            data={reportCardProps(d, examName, bands)}
            issuer={issuer}
            logoUrl={logoUrl}
            activeLanguage={lang}
            labels={{
              examLabel: rt('examLabel'),
              rollLabel: rt('rollLabel'),
              subject: rt('subject'),
              obtained: rt('obtained'),
              grade: rt('grade'),
              gpa: rt('gpa'),
              totalMarks: rt('totalMarks'),
              totalGpa: rt('totalGpa'),
              overallGrade: rt('overallGrade'),
              position: rt('position'),
              positionValue: rt('positionValue'),
              fail: rt('fail'),
              fourthSubject: rt('fourthSubject'),
              absent: rt('absent'),
              legendTitle: rt('legendTitle'),
              programs: rt('programs'),
              progress: rt('progress'),
              latestMilestone: rt('latestMilestone'),
              scoreGrade: rt('scoreGrade'),
            }}
          />
        </div>
      ));
    } else if (doc === 'transcript' && transcript.data) {
      const tr = transcriptProps(transcript.data);
      count = tr.exams.length > 0 ? 1 : 0;
      title = tr.student.name;
      subtitle = [tr.student.className, tr.student.section];
      pages = (
        <YearlyTranscript
          {...common}
          {...tr}
          labels={{
            title: t('doc.transcript'),
            roll: t('col.roll'),
            subject: t('col.subject'),
            obtained: t('col.marks'),
            grade: t('col.grade'),
            gpa: t('col.gpa'),
            total: t('col.total'),
            exam: t('col.exam'),
            position: t('col.merit'),
            classTeacher: signs.classTeacher,
            headTeacher: signs.headTeacher,
          }}
        />
      );
    }
  }
  if (!title) title = examName;

  const close = () => router.history.push(search.from ?? '/exams');
  const [printing, setPrinting] = React.useState(false);
  // Report cards already logged by an attempt that failed part-way: a retry skips them, so one
  // print never gets two log rows. Cleared once the whole set is logged and printed.
  const logged = React.useRef(new Set<string>());
  const print = async () => {
    setPrinting(true);
    try {
      if (doc === 'transcript' && studentId && academicYearId) {
        await logDocumentPrint(studentId, {
          document: 'TRANSCRIPT',
          academic_year_id: academicYearId,
        });
      } else if (doc === 'report-cards' && examId) {
        // One at a time: a failure stops the rest instead of leaving rows for cards never printed.
        for (const id of logIds) {
          if (logged.current.has(id)) continue;
          await logDocumentPrint(id, { document: 'REPORT_CARD', exam_id: examId });
          logged.current.add(id);
        }
        logged.current = new Set();
      }
    } catch {
      // No print without its log row (Epic 32 D9).
      toast.error(t('page.logError'));
      return;
    } finally {
      setPrinting(false);
    }
    window.print();
  };

  const bar = (ready: boolean) => (
    <header className="flex items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-3 print:hidden">
      <div className="min-w-0">
        <h1 className="truncate text-h3 font-semibold text-text-primary">
          {[t(`doc.${DOC_KEY[doc]}`), title].filter(Boolean).join(' · ')}
        </h1>
        {ready ? (
          <p className="text-body-sm truncate text-text-secondary">
            {[...subtitle, renderDigits(t('page.pages', { count }), config.numerals)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={close}>
          <XIcon aria-hidden /> {t('page.close')}
        </Button>
        <Button disabled={!ready || printing} onClick={() => void print()}>
          <PrinterIcon aria-hidden /> {t('page.print')}
        </Button>
      </div>
    </header>
  );

  // Printing needs a big screen and a printer (D15).
  if (!wide) {
    return (
      <>
        {bar(false)}
        <EmptyState
          icon={<MonitorIcon aria-hidden />}
          title={tG('gate.title')}
          explanation={tG('gate.body')}
          action={{ label: tG('gate.copy'), onClick: () => void copyPageLink(tG) }}
        />
      </>
    );
  }

  let body: React.ReactNode;
  if (missing || blocked) {
    body = <EmptyState title={t('page.empty')} explanation={t('page.emptyHint')} />;
  } else if (failed) {
    body = (
      <ErrorState
        message={t('page.loadError')}
        onRetry={() => all.forEach((q) => q.isError && void q.refetch())}
      />
    );
  } else if (loading || !issuer) {
    body = (
      <Skeleton
        role="status"
        aria-label={t('page.loading')}
        className="h-96 w-full max-w-[210mm]"
      />
    );
  } else if (!pages || count === 0) {
    body = <EmptyState title={t('page.empty')} explanation={t('page.emptyHint')} />;
  } else {
    body = pages;
  }

  const ready = !missing && !blocked && !failed && !loading && Boolean(pages) && count > 0;
  return (
    <div className="min-h-screen bg-muted print:min-h-0 print:bg-transparent">
      {bar(ready)}
      <main className="flex flex-col items-center gap-6 p-6 print:block print:gap-0 print:p-0">
        {body}
      </main>
    </div>
  );
}
