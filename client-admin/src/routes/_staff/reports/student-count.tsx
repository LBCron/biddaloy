/**
 * [8.15.54] `/reports/student-count` — the early BANBEIS head count (Epic 8.15 D23). Temporary:
 * [8.15.32]'s system report replaces it, and the epic close removes the coded endpoint.
 *
 * Opening the page shows the current year's numbers at once, with no button to press: students by
 * class × gender (split by religion only when the school has recorded more than one religion), a
 * "Total" row and column, and a second small table of teachers and staff. Excel and Print sit in
 * the header. On a phone each class is a card.
 *
 * ```
 *  Student count (BANBEIS)                         [Download to Excel] [Print]
 *  Take the student numbers for the BANBEIS annual survey from here.
 *  Academic year 2026 · Change
 *
 *  Class      | Boys | Girls | Total
 *  Class 6    |   40 |    38 |    78
 *  Total      |  ... |   ... |  ...
 * ```
 *
 * Privacy (D14): a COMMITTEE caller gets `count: null` for cells under 5. Those show "—" with an
 * explanation, never "0". A row or column total that would need a hidden cell also shows "—"
 * (adding the visible cells would understate it, and subtracting would reveal the hidden one); the
 * grand total is the server's true total, which is never hidden. Staff gender is not stored, so
 * staff are counted by type only.
 *
 * [8.15.42] A count is a link: a class × gender (× religion) number opens the student list with the
 * same class, gender and religion, so "girls in class 6" is one click from the number. The list shows
 * the current year's active students, so a link is made only for the current year, only for a
 * visible number above zero (a hidden count never opens the people it hides), only for a recorded
 * gender and religion, and only for a person who may open the student list. The list's "ফিরে যান"
 * comes back here.
 *
 * Words come from `reports.json` `studentCount.*` (the 8.15 glossary: "Excel-এ নামান", never
 * "export"). Numbers go through `formatNumber`, so Bangla digits follow the school's setting.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DrillLink,
  EmptyState,
  ErrorState,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  allClassesQueryOptions,
  downloadStudentCountExport,
  useHasPermission,
  useSchoolProfile,
  useStudentCount,
  type StaffCountRow,
  type StudentCountResponse,
  type StudentCountRow,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useTenantRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber, renderDigits } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';
import { STAFF_ROUTE_PERMISSIONS } from '../../../route-permissions';
import { useActiveSchoolName } from '../../../use-active-school-name';

import './-student-count-print.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const studentCountSearchSchema = z.object({
  // A hand-edited or stale id is dropped (the server then answers for the current year).
  academic_year_id: z.string().regex(UUID_RE).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/reports/student-count')({
  validateSearch: studentCountSearchSchema,
  loader: () => loadRouteNamespaces('reports', 'reportDesigner', 'common'),
  pendingComponent: StudentCountPending,
  component: StudentCountPage,
});

function StudentCountPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

/** The server's "not given" label (`NOT_GIVEN_BN`): shown through `studentCount.notGiven` instead. */
const NOT_GIVEN = 'উল্লেখ নেই';
const KNOWN_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/** `null` = a hidden cell (D14) somewhere in what was added up, so the sum is unknowable. */
type Count = number | null;

function sum(values: readonly Count[]): Count {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Values in the order first seen, with "not given" last. */
function distinct(values: readonly string[]): string[] {
  const seen = [...new Set(values)];
  return [...seen.filter((v) => v !== NOT_GIVEN), ...seen.filter((v) => v === NOT_GIVEN)];
}

interface CountModel {
  classes: { key: string; name: string }[];
  genders: string[];
  religions: string[];
  /** Religion columns appear only when more than one religion is recorded. */
  split: boolean;
  /** Students in one class × gender × religion; a combination the server did not list is a true 0. */
  at: (classKey: string, gender: string, religion: string) => Count;
}

function buildModel(rows: readonly StudentCountRow[]): CountModel {
  const classOf = (row: StudentCountRow) => `${row.class_order}\u0000${row.class_name}`;
  const classes = [
    ...new Map(
      [...rows]
        .sort((a, b) => a.class_order - b.class_order || a.class_name.localeCompare(b.class_name))
        .map((row) => [classOf(row), { key: classOf(row), name: row.class_name }] as const),
    ).values(),
  ];
  const present = distinct(rows.map((row) => row.gender));
  const genders = [
    ...KNOWN_GENDERS.filter((g) => present.includes(g)),
    ...present.filter((g) => !(KNOWN_GENDERS as readonly string[]).includes(g)),
  ];
  const religions = distinct(rows.map((row) => row.religion));
  const cells = new Map<string, Count>();
  for (const row of rows) {
    const key = `${classOf(row)}\u0000${row.gender}\u0000${row.religion}`;
    const previous = cells.get(key);
    const next: Count = row.suppressed || row.count === null ? null : row.count;
    cells.set(key, previous === undefined ? next : sum([previous, next]));
  }
  return {
    classes,
    genders,
    religions,
    split: religions.length > 1,
    at: (classKey, gender, religion) => {
      const key = `${classKey}\u0000${gender}\u0000${religion}`;
      // `null` is a hidden cell (kept as `null`); only a combination never listed is a true 0.
      return cells.has(key) ? (cells.get(key) as Count) : 0;
    },
  };
}

function StudentCountPage() {
  const { t } = useTranslation('reports');
  const regionConfig = useTenantRegionConfig();
  const { academic_year_id: yearId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const query = useStudentCount(yearId);
  const canExport = useHasPermission(Permission.REPORTS_EXPORT);
  // The year list is reference data some report viewers (COMMITTEE) may not read: then there is
  // simply no "Change" control, and the query is never sent.
  const canReadYears = useHasPermission(Permission.ACADEMIC_STRUCTURE_READ);
  const years = useQuery({ ...academicYearsQueryOptions({ limit: 100 }), enabled: canReadYears });

  const [busyTable, setBusyTable] = React.useState<'students' | 'staff' | null>(null);
  const [downloadFailed, setDownloadFailed] = React.useState(false);
  async function download(table: 'students' | 'staff') {
    if (busyTable !== null) return;
    setBusyTable(table);
    setDownloadFailed(false);
    try {
      await downloadStudentCountExport({
        ...(query.data?.academic_year_id ? { academicYearId: query.data.academic_year_id } : {}),
        table,
      });
    } catch {
      setDownloadFailed(true);
    } finally {
      setBusyTable(null);
    }
  }

  const data = query.data;
  const yearName = data?.academic_year_name
    ? renderDigits(data.academic_year_name, regionConfig.numerals)
    : null;
  const yearOptions = years.data?.data ?? [];
  const activeYearId = data?.academic_year_id ?? yearId ?? '';

  return (
    <RegionConfigProvider value={regionConfig}>
      <PageContainer>
        <div className="student-count flex flex-col gap-4 md:gap-6">
          <div className="print:hidden">
            <PageHeader
              title={t('studentCount.title')}
              subtitle={t('studentCount.help')}
              actions={[
                {
                  id: 'download',
                  label: t('studentCount.actions.download'),
                  icon: <DownloadIcon aria-hidden className="size-4" />,
                  priority: 'primary',
                  allowed: canExport,
                  disabled: data === undefined,
                  busy: busyTable === 'students',
                  onClick: () => void download('students'),
                },
                {
                  id: 'print',
                  label: t('studentCount.actions.print'),
                  icon: <PrinterIcon aria-hidden className="size-4" />,
                  priority: 'secondary',
                  disabled: data === undefined,
                  onClick: () => window.print(),
                },
              ]}
            />
          </div>

          {downloadFailed && (
            <p role="alert" className="text-sm text-destructive print:hidden">
              {t('studentCount.actions.downloadError')}
            </p>
          )}

          <PrintHeader yearName={yearName} />

          {(yearName !== null || yearOptions.length > 0) && (
            <p className="flex flex-wrap items-center gap-1 print:hidden">
              {yearName !== null && (
                <span className="font-medium">{t('studentCount.year', { year: yearName })}</span>
              )}
              {(yearName === null ? yearOptions.length > 0 : yearOptions.length > 1) && (
                <>
                  {yearName !== null && <span aria-hidden="true">·</span>}
                  <Menu>
                    <MenuTrigger asChild>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto px-1"
                        aria-label={t('studentCount.changeLabel')}
                      >
                        {t('studentCount.change')}
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="start" className="min-w-48">
                      <MenuRadioGroup
                        value={activeYearId}
                        onValueChange={(id) => void navigate({ search: { academic_year_id: id } })}
                      >
                        {yearOptions.map((year) => (
                          <MenuRadioItem key={year.id} value={year.id}>
                            {renderDigits(year.name, regionConfig.numerals)}
                          </MenuRadioItem>
                        ))}
                      </MenuRadioGroup>
                    </MenuContent>
                  </Menu>
                </>
              )}
            </p>
          )}

          {query.isError ? (
            <ErrorState
              message={t('studentCount.loadError')}
              onRetry={() => void query.refetch()}
            />
          ) : data === undefined ? (
            <div aria-busy="true" className="flex flex-col gap-4">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <CountBody
              data={data}
              region={regionConfig}
              // The student list has no year choice, so only the current year can be opened.
              yearIsCurrent={
                yearId === undefined ||
                (years.data?.data.find((y) => y.id === activeYearId)?.is_current ?? false)
              }
              canExport={canExport}
              busyTable={busyTable}
              onDownloadStaff={() => void download('staff')}
            />
          )}
        </div>
      </PageContainer>
    </RegionConfigProvider>
  );
}

/** What a printed page starts with: the school, its EIIN and the year (hidden on screen). */
function PrintHeader({ yearName }: { yearName: string | null }) {
  const { t } = useTranslation('reports');
  const { locale } = useLocale();
  const profile = useSchoolProfile();
  const fallbackName = useActiveSchoolName();
  const school =
    (locale === 'bn' ? profile.data?.name_bn : null) ?? profile.data?.name ?? fallbackName;
  const eiin = profile.data?.registration_id;
  return (
    <header className="hidden print:block">
      <h1 className="text-h2 font-semibold">{school}</h1>
      <p className="text-body-lg">{t('studentCount.title')}</p>
      <p className="text-caption">
        {[
          yearName !== null ? t('studentCount.year', { year: yearName }) : null,
          eiin ? `${t('studentCount.print.eiin')}: ${eiin}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </p>
    </header>
  );
}

interface CountBodyProps {
  data: StudentCountResponse;
  region: RegionConfig;
  yearIsCurrent: boolean;
  canExport: boolean;
  busyTable: 'students' | 'staff' | null;
  onDownloadStaff: () => void;
}

function CountBody({
  data,
  region,
  yearIsCurrent,
  canExport,
  busyTable,
  onDownloadStaff,
}: CountBodyProps) {
  const { t } = useTranslation('reports');
  const { t: tDesigner } = useTranslation('reportDesigner');
  const router = useRouter();
  const here = useRouterState({ select: (state) => state.location.href });
  const canOpenStudents = useHasPermission(STAFF_ROUTE_PERMISSIONS['/_staff/students/']!);
  const canReadClasses = useHasPermission(Permission.ACADEMIC_STRUCTURE_READ);
  // The list filters by id; this screen only has the class name.
  const classList = useQuery({
    ...allClassesQueryOptions(
      data.academic_year_id !== null ? { academic_year_id: data.academic_year_id } : {},
    ),
    enabled: yearIsCurrent && canOpenStudents && canReadClasses && data.academic_year_id !== null,
  });
  const model = React.useMemo(() => buildModel(data.rows), [data.rows]);

  if (data.academic_year_id === null) {
    return (
      <EmptyState
        title={t('studentCount.noYear.title')}
        explanation={t('studentCount.noYear.explanation')}
      />
    );
  }

  const hiddenTip = t('studentCount.hidden');
  const anyHidden =
    data.rows.some((row) => row.suppressed || row.count === null) ||
    data.staff.rows.some((row) => row.suppressed || row.count === null);

  /** A number, or "—" for a hidden one (never "0"), with the reason for a screen reader and a hover. */
  const show = (count: Count) =>
    count === null ? (
      <span role="img" aria-label={hiddenTip} title={hiddenTip}>
        —
      </span>
    ) : (
      formatNumber(count, region)
    );
  const plain = (count: Count) => (count === null ? '—' : formatNumber(count, region));

  const genderLabel = (gender: string) =>
    gender === NOT_GIVEN
      ? t('studentCount.notGiven')
      : (KNOWN_GENDERS as readonly string[]).includes(gender)
        ? t(`studentCount.gender.${gender}`)
        : gender;
  const religionLabel = (religion: string) =>
    religion === NOT_GIVEN ? t('studentCount.notGiven') : religion;

  /**
   * A count as a link to the student list with the same class (and gender, and religion). No link
   * for a hidden or zero count, an unrecorded gender or religion, another year, or a class the
   * list cannot be filtered by.
   */
  const linkFor = (
    klass: { name: string },
    gender: string | null,
    religion: string | null,
    count: Count,
    node: React.ReactNode,
  ): React.ReactNode => {
    if (!yearIsCurrent || count === null || count <= 0) return node;
    if (gender === NOT_GIVEN || religion === NOT_GIVEN) return node;
    const classId = classList.data?.find((c) => c.name === klass.name)?.id;
    if (classId === undefined) return node;
    const { href } = router.buildLocation({
      to: '/students',
      search: {
        class_id: classId,
        enrollment_status: 'ACTIVE',
        ...(gender !== null ? { gender } : {}),
        ...(religion !== null ? { religion } : {}),
        from: here,
      },
    });
    const what = [
      klass.name,
      gender !== null ? genderLabel(gender) : null,
      religion !== null ? religionLabel(religion) : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');
    return (
      <DrillLink
        href={href}
        label={tDesigner('drill.open', { what, value: plain(count) })}
        onOpen={() => router.history.push(href)}
      >
        {node}
      </DrillLink>
    );
  };

  const { classes, genders, religions, split, at } = model;
  const cellOf = (classKey: string, gender: string, religion: string | null): Count =>
    religion === null
      ? sum(religions.map((r) => at(classKey, gender, r)))
      : at(classKey, gender, religion);
  const genderTotalOf = (classKey: string, gender: string) => cellOf(classKey, gender, null);
  const classTotalOf = (classKey: string) => sum(genders.map((g) => genderTotalOf(classKey, g)));
  const columnTotal = (gender: string, religion: string | null) =>
    sum(classes.map((c) => cellOf(c.key, gender, religion)));
  const genderColumnTotal = (gender: string) =>
    sum(classes.map((c) => genderTotalOf(c.key, gender)));
  const grandTotal: Count = data.totals.students;

  const noStudents = classes.length === 0;
  const numberCell = 'px-3 py-2 text-end tabular-nums';
  const headCell = 'px-3 py-2 text-start font-medium text-text-secondary';

  return (
    <>
      <section aria-labelledby="student-count-classes" className="flex flex-col gap-3">
        <h2 id="student-count-classes" className="text-h2">
          {t('studentCount.classes.title')}
        </h2>
        {noStudents ? (
          <EmptyState
            title={t('studentCount.noStudents.title')}
            explanation={t('studentCount.noStudents.explanation')}
          />
        ) : (
          <>
            <Card className="hidden overflow-hidden md:block print:block">
              {/* eslint-disable jsx-a11y/no-noninteractive-tabindex --
                WCAG SCR29: a focusable, labelled scroll region keeps a wide table
                keyboard-reachable. Re-enabled right after the element. */}
              <div
                role="region"
                tabIndex={0}
                aria-label={t('studentCount.classes.caption')}
                className="overflow-x-auto"
              >
                <table className="w-full border-collapse text-body">
                  <caption className="sr-only">{t('studentCount.classes.caption')}</caption>
                  <thead className="bg-muted">
                    <tr>
                      <th scope="col" rowSpan={split ? 2 : 1} className={headCell}>
                        {t('studentCount.classes.class')}
                      </th>
                      {genders.map((gender) => (
                        <th
                          key={gender}
                          scope="colgroup"
                          colSpan={split ? religions.length + 1 : 1}
                          className={`${headCell} ${split ? 'text-center' : 'text-end'}`}
                        >
                          {genderLabel(gender)}
                        </th>
                      ))}
                      <th scope="col" rowSpan={split ? 2 : 1} className={`${headCell} text-end`}>
                        {t('studentCount.classes.total')}
                      </th>
                    </tr>
                    {split && (
                      <tr>
                        {genders.flatMap((gender) => [
                          ...religions.map((religion) => (
                            <th
                              key={`${gender}-${religion}`}
                              scope="col"
                              className={`${headCell} text-end`}
                            >
                              {religionLabel(religion)}
                            </th>
                          )),
                          <th
                            key={`${gender}-total`}
                            scope="col"
                            className={`${headCell} text-end`}
                          >
                            {t('studentCount.classes.total')}
                          </th>,
                        ])}
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {classes.map((klass) => (
                      <tr key={klass.key}>
                        <th scope="row" className="px-3 py-2 text-start font-medium">
                          {klass.name}
                        </th>
                        {genders.flatMap((gender) => [
                          ...(split ? religions : []).map((religion) => (
                            <td key={`${gender}-${religion}`} className={numberCell}>
                              {linkFor(
                                klass,
                                gender,
                                religion,
                                cellOf(klass.key, gender, religion),
                                show(cellOf(klass.key, gender, religion)),
                              )}
                            </td>
                          )),
                          <td key={`${gender}-total`} className={numberCell}>
                            {linkFor(
                              klass,
                              gender,
                              null,
                              genderTotalOf(klass.key, gender),
                              show(genderTotalOf(klass.key, gender)),
                            )}
                          </td>,
                        ])}
                        <td className={`${numberCell} font-medium`}>
                          {linkFor(
                            klass,
                            null,
                            null,
                            classTotalOf(klass.key),
                            show(classTotalOf(klass.key)),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-muted font-medium">
                    <tr>
                      <th scope="row" className="px-3 py-2 text-start">
                        {t('studentCount.classes.total')}
                      </th>
                      {genders.flatMap((gender) => [
                        ...(split ? religions : []).map((religion) => (
                          <td key={`${gender}-${religion}`} className={numberCell}>
                            {show(columnTotal(gender, religion))}
                          </td>
                        )),
                        <td key={`${gender}-total`} className={numberCell}>
                          {show(genderColumnTotal(gender))}
                        </td>,
                      ])}
                      <td className={numberCell}>{show(grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
            </Card>

            {/* Phone: one card per class, e.g. "Class 6 — Boys 40 · Girls 38 · Total 78". */}
            <ul className="flex flex-col gap-3 md:hidden print:hidden">
              {classes.map((klass) => (
                <li key={klass.key}>
                  <Card padded>
                    <p>
                      <span className="font-medium">{klass.name}</span>
                      {' — '}
                      {genders
                        .map((g) => `${genderLabel(g)} ${plain(genderTotalOf(klass.key, g))}`)
                        .join(' · ')}
                      {' · '}
                      {t('studentCount.cardTotal', { n: plain(classTotalOf(klass.key)) })}
                    </p>
                    {split && (
                      <ul className="mt-2 flex flex-col gap-0.5 text-caption text-text-secondary">
                        {religions.map((religion) => (
                          <li key={religion}>
                            {religionLabel(religion)}
                            {' — '}
                            {genders
                              .map((g) => `${genderLabel(g)} ${plain(at(klass.key, g, religion))}`)
                              .join(' · ')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </li>
              ))}
              <li>
                <Card padded>
                  <p className="font-medium">
                    {t('studentCount.classes.total')} {plain(grandTotal)}
                  </p>
                </Card>
              </li>
            </ul>
          </>
        )}
      </section>

      <StaffTable
        rows={data.staff.rows}
        total={data.staff.total}
        show={show}
        canExport={canExport}
        busy={busyTable === 'staff'}
        onDownload={onDownloadStaff}
      />

      {anyHidden && (
        <p className="text-caption text-text-secondary">{t('studentCount.hiddenNote')}</p>
      )}
    </>
  );
}

interface StaffTableProps {
  rows: readonly StaffCountRow[];
  total: number;
  show: (count: Count) => React.ReactNode;
  canExport: boolean;
  busy: boolean;
  onDownload: () => void;
}

/** Teachers and staff by type. Gender is not stored for staff, so there is no gender column. */
function StaffTable({ rows, total, show, canExport, busy, onDownload }: StaffTableProps) {
  const { t } = useTranslation('reports');
  const order = ['TEACHING', 'NON_TEACHING', 'UNASSIGNED'] as const;
  const sorted = order.flatMap((type) => rows.filter((row) => row.staff_type === type));
  return (
    <section aria-labelledby="student-count-staff" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="student-count-staff" className="text-h2">
          {t('studentCount.staff.title')}
        </h2>
        {canExport && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={busy}
            aria-label={t('studentCount.actions.downloadStaff')}
            className="print:hidden"
            onClick={onDownload}
          >
            <DownloadIcon aria-hidden="true" />
            {t('studentCount.actions.download')}
          </Button>
        )}
      </div>
      <Card className="overflow-hidden md:w-fit md:min-w-72">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{t('studentCount.staff.caption')}</caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium text-text-secondary">
                {t('studentCount.staff.type')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium text-text-secondary">
                {t('studentCount.staff.count')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {sorted.map((row) => (
              <tr key={row.staff_type}>
                <th scope="row" className="px-3 py-2 text-start font-normal">
                  {t(`studentCount.staff.${row.staff_type}`)}
                </th>
                <td className="px-3 py-2 text-end tabular-nums">
                  {show(row.suppressed ? null : row.count)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted font-medium">
            <tr>
              <th scope="row" className="px-3 py-2 text-start">
                {t('studentCount.staff.total')}
              </th>
              <td className="px-3 py-2 text-end tabular-nums">{show(total)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </section>
  );
}
