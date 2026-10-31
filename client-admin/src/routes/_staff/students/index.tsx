import { EnrollmentStatus, Permission, RoleScope, roleScope } from '@biddaloy/shared';
import {
  Button,
  CachedDataNotice,
  ExportMenu,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  downloadListExport,
  studentQueryOptions,
  studentsQueryOptions,
  useClasses,
  useActiveRole,
  useClassSections,
  useHasPermission,
  useOrganisationVocabulary,
  useStudents,
  type Student,
  type StudentListFilters,
  type StudentSortField,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { downloadCsv, formatDate, formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  IdCardIcon,
  ImageUpIcon,
  PlusIcon,
  SendIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { readVisibleColumns } from '../-save-as-report/list-to-definition';
import { SaveAsReportDialog } from '../-save-as-report/save-as-report-dialog';
import { useLandingFlag } from '../-use-landing-flag';
import { ListReportHint } from '../../../components/list-report-hint';
import { previewIdsNav } from '../../../components/print/preview-ids';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { isSameAppRedirect } from '../../../same-app-redirect';

import { BulkPhotoDialog } from './-bulk-photo-dialog';
import { DEFAULT_PAGE_SIZE } from './-constants';
import { SendReminderDialog } from './-send-reminder-dialog';
import { GENDER_VALUES } from './-student-form-schema';

/** `DataTableSort.id` values that map onto a server-sortable field —
 * `StudentSortField`'s own allowlist, keyed by this page's column ids
 * rather than the server's column names, since a column's `id` (what
 * `DataTable` reports back through `onSortingChange`) is this page's own
 * naming, not the API's. */
const SORT_FIELD_BY_COLUMN: Partial<Record<string, StudentSortField>> = {
  registration: 'registration_number',
  name: 'full_name',
};

/** `useListShellState`'s generic `filters` bag round-trips through the
 * URL as `Record<string, string>` — this narrows the handful of keys this
 * page actually reads/writes, same shape as `StudentListFilters` minus
 * `page`/`limit`/`sort`/`order` (those are `ListShellState`'s own,
 * separately-typed fields). */
interface StudentFilters {
  search?: string | undefined;
  class_id?: string | undefined;
  section_id?: string | undefined;
  shift?: string | undefined;
  version?: string | undefined;
  enrollment_status?: string | undefined;
  gender?: string | undefined;
  /** [8.15.33] Free text on the student record; the server matches it exactly, in any letter case. */
  religion?: string | undefined;
  date_of_birth_from?: string | undefined;
  date_of_birth_to?: string | undefined;
}

/** What the table shows until a person changes it with the Columns menu. */
const DEFAULT_COLUMN_VISIBILITY = {
  dateOfBirth: false,
  gender: false,
  address: false,
  preferredCommunication: false,
};

const studentsSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
  photos: z.coerce.string().optional().catch(undefined),
  limit: z.number().int().positive().max(100).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  search: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  shift: z.string().optional().catch(undefined),
  version: z.string().optional().catch(undefined),
  enrollment_status: z.string().optional().catch(undefined),
  gender: z.string().optional().catch(undefined),
  // Coerced: a religion typed as digits would otherwise be parsed to a number and dropped.
  religion: z.coerce.string().optional().catch(undefined),
  date_of_birth_from: z.string().optional().catch(undefined),
  date_of_birth_to: z.string().optional().catch(undefined),
  // Reserved key `use-list-shell-state.ts` stores the row selection
  // under (comma-joined ids) — must be declared here or TanStack
  // Router's `validateSearch` strips it from the URL on every navigation,
  // since a plain `z.object` drops any key it doesn't know about.
  selected: z.string().optional().catch(undefined),
  // [28.4.5/D22] Palette "Open performance" flag: row "View" links open the
  // student's Performance tab. TanStack parses `?x=1` as a number, so coerce.
  openPerformance: z.coerce.string().optional().catch(undefined),
  // [8.15.42] Opened from a report's count: the address of that report, for "ফিরে যান".
  from: z.string().optional().catch(undefined),
});

function toStudentListFilters(filters: StudentFilters, sortColumnId: string | undefined) {
  const sortField = sortColumnId ? SORT_FIELD_BY_COLUMN[sortColumnId] : undefined;
  return {
    ...(filters.search !== undefined ? { search: filters.search } : {}),
    ...(filters.class_id !== undefined ? { class_id: filters.class_id } : {}),
    ...(filters.section_id !== undefined ? { section_id: filters.section_id } : {}),
    ...(filters.shift !== undefined ? { shift: filters.shift } : {}),
    ...(filters.version !== undefined ? { version: filters.version } : {}),
    ...(filters.enrollment_status !== undefined
      ? { enrollment_status: filters.enrollment_status }
      : {}),
    ...(filters.gender !== undefined ? { gender: filters.gender } : {}),
    ...(filters.religion !== undefined ? { religion: filters.religion } : {}),
    ...(filters.date_of_birth_from !== undefined
      ? { date_of_birth_from: filters.date_of_birth_from }
      : {}),
    ...(filters.date_of_birth_to !== undefined
      ? { date_of_birth_to: filters.date_of_birth_to }
      : {}),
    ...(sortField !== undefined ? { sort: sortField } : {}),
  };
}

export const Route = createFileRoute('/_staff/students/')({
  validateSearch: studentsSearchSchema,
  // Without `loaderDeps`, the loader only reruns when the route's own
  // path params change — every filter/sort/page value here lives in the
  // search string instead, so they all have to be listed explicitly for
  // a filter change to actually trigger a refetch.
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    limit: search.limit ?? DEFAULT_PAGE_SIZE,
    sort: search.sort,
    order: search.order,
    search: search.search,
    classId: search.class_id,
    sectionId: search.section_id,
    shift: search.shift,
    version: search.version,
    enrollmentStatus: search.enrollment_status,
    gender: search.gender,
    religion: search.religion,
    dateOfBirthFrom: search.date_of_birth_from,
    dateOfBirthTo: search.date_of_birth_to,
  }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/index.tsx`'s identical
      // comment for why.
      queryClient
        .ensureQueryData(
          studentsQueryOptions({
            page: deps.page,
            limit: deps.limit,
            ...toStudentListFilters(
              {
                search: deps.search,
                class_id: deps.classId,
                section_id: deps.sectionId,
                shift: deps.shift,
                version: deps.version,
                enrollment_status: deps.enrollmentStatus,
                gender: deps.gender,
                religion: deps.religion,
                date_of_birth_from: deps.dateOfBirthFrom,
                date_of_birth_to: deps.dateOfBirthTo,
              },
              deps.sort,
            ),
            ...(deps.order !== undefined ? { order: deps.order } : {}),
          }),
        )
        .catch(swallowUnlessOffline),
      // 'backup' feeds the [14.13.2] migrate-a-whole-school link below the
      // (empty) list — same permission-gated one-liner as
      // `students/import.tsx`, pointed the other direction.
      // 'staff' holds the role names the keep-as-report dialog lists.
      loadRouteNamespaces('students', 'backup', 'staff', 'reportDesigner', 'reports'),
    ]),
  pendingComponent: StudentsListPending,
  component: StudentsListPage,
});

function StudentsListPage() {
  const { t } = useTranslation('students');
  const { t: tBackup } = useTranslation('backup');
  const queryClient = useQueryClient();
  const [state, actions] = useListShellState();
  const filters = state.filters as StudentFilters;
  const { openPerformance, from } = Route.useSearch();
  const router = useRouter();
  const { t: tDesigner } = useTranslation('reportDesigner');
  // [8.15.42] Only a path inside this app is followed.
  const backTo = from !== undefined && isSameAppRedirect(from) ? from : null;

  const vocabularyQuery = useOrganisationVocabulary();
  // [D5] A shift/version filter field only exists once the tenant has 2+
  // entries — a single-shift school has nothing to filter on.
  const shifts = vocabularyQuery.data?.shifts ?? [];
  const versions = vocabularyQuery.data?.versions ?? [];
  const showShiftFilter = shifts.length >= 2;
  const showVersionFilter = versions.length >= 2;

  // [8.12.3]: the filter bag is lifted into a variable so the exact same
  // object feeds the query *and* `CachedDataNotice`'s key. Rebuilding the
  // key by hand at the render site is how the notice silently stops
  // matching the query it is supposed to be describing.
  // Annotated, not inferred: spreading a conditional `order` into a
  // fresh object widens it to `string`, which `StudentListFilters` (an
  // `'asc' | 'desc'` union) rightly rejects.
  //
  // [CodeRabbit, PR #916] `shift`/`version` stripped from the filter bag
  // here, before it reaches `toStudentListFilters` — that helper is a
  // pure function of the URL's filter bag alone and has no vocabulary to
  // gate on. Without this, a URL carrying `?shift=Morning` from before
  // the tenant's vocabulary shrank to one shift (or a bookmarked/shared
  // link) would keep silently filtering the list with no visible chip
  // to explain or clear it (D5 says the *field* disappears, not that the
  // filter stops applying).
  const effectiveFilters: StudentFilters = {
    ...filters,
    ...(showShiftFilter ? {} : { shift: undefined }),
    ...(showVersionFilter ? {} : { version: undefined }),
  };
  const studentListFilters: StudentListFilters = {
    page: state.page,
    limit: state.limit,
    ...toStudentListFilters(effectiveFilters, state.sorting?.id),
    ...(state.sorting ? { order: state.sorting.desc ? 'desc' : 'asc' } : {}),
  };
  const studentsQuery = useStudents(studentListFilters);
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(filters.class_id);

  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canAddStudent = useHasPermission(Permission.STUDENT_CREATE);
  const canBulkImport = useHasPermission(Permission.STUDENT_BULK_UPLOAD);
  const canUpdateStudent = useHasPermission(Permission.STUDENT_UPDATE);
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canExportAll = useHasPermission(Permission.REPORTS_EXPORT);
  // [8.15.52] Keeping the list as a report is a designer's job.
  const canDesignReports = useHasPermission(Permission.REPORTS_DESIGN);
  // A section-scoped role (TEACHER) only lists the sections it teaches this year, so an
  // unfiltered empty list means "no section assigned", not "no students yet". Checked by role
  // scope, not a permission: SUPER_ADMIN holds every permission.
  const isTeacher = roleScope(useActiveRole()) === RoleScope.ASSIGNED_SECTIONS;
  // Only real list filters count; URL flags such as `photos` or `openPerformance` do not.
  const hasActiveFilter = Object.values(toStudentListFilters(effectiveFilters, undefined)).some(
    (v) => v !== '',
  );
  const navigate = useNavigate();
  const isEmpty =
    !studentsQuery.isLoading && !studentsQuery.isError && (studentsQuery.data?.total ?? 0) === 0;

  // A class AND a section chosen: offer to print the whole section without selecting rows.
  const wholeClass =
    filters.class_id !== undefined && filters.section_id !== undefined
      ? {
          sectionId: filters.section_id,
          label: `${classesQuery.data?.data.find((k) => k.id === filters.class_id)?.name ?? ''}-${
            sectionsQuery.data?.find((x) => x.id === filters.section_id)?.section_name ?? ''
          }`,
        }
      : undefined;

  function printPreview(target: { ids: string[] } | { class_section_id: string }) {
    const nav = 'ids' in target ? previewIdsNav(target.ids) : { search: target, state: {} };
    void navigate({
      to: '/print/preview',
      state: nav.state,
      search: {
        kind: 'STUDENT_ID_CARD',
        subject_type: 'STUDENT',
        from: '/students',
        ...nav.search,
      },
    });
  }

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);
  // The columns showing when the dialog was opened (the table keeps them in localStorage).
  const [keepAsReport, setKeepAsReport] = React.useState<{ columns: string[] } | null>(null);
  const [photosDialogOpen, setPhotosDialogOpen] = useLandingFlag('photos', canUpdateStudent);

  // FilterBar's `onChange` patches one key at a time — intercept `class_id`
  // changes to also clear `section_id`, since a section chosen under the
  // *previous* class would otherwise silently over-scope results to a
  // section that doesn't belong to the newly selected class.
  function handleFiltersChange(patch: Record<string, string | null>) {
    actions.setFilters('class_id' in patch ? { ...patch, section_id: null } : patch);
  }

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('list.searchLabel'),
      placeholder: t('list.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('list.classLabel'),
      allLabel: t('list.allClasses'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('list.sectionLabel'),
      allLabel: t('list.allSections'),
      options: (sectionsQuery.data ?? []).map((section) => ({
        value: section.id,
        label: section.section_name,
      })),
    },
    {
      kind: 'select',
      key: 'enrollment_status',
      label: t('list.statusLabel'),
      allLabel: t('list.allStatuses'),
      options: Object.values(EnrollmentStatus).map((status) => ({
        value: status,
        label: t(`status.enrollment.${status}`, { ns: 'common' }),
      })),
    },
    {
      kind: 'select',
      key: 'gender',
      label: t('list.genderFilterLabel'),
      allLabel: t('list.allGenders'),
      options: GENDER_VALUES.map((value) => ({
        value,
        label: t(`form.fields.genderOptions.${value}`),
      })),
    },
    {
      kind: 'text',
      key: 'religion',
      label: t('list.religionFilterLabel'),
      placeholder: t('list.religionFilterPlaceholder'),
    },
    ...(showShiftFilter
      ? [
          {
            kind: 'select' as const,
            key: 'shift',
            label: t('list.shiftLabel'),
            allLabel: t('list.allShifts'),
            options: shifts.map((value) => ({ value, label: value })),
          },
        ]
      : []),
    ...(showVersionFilter
      ? [
          {
            kind: 'select' as const,
            key: 'version',
            label: t('list.versionLabel'),
            allLabel: t('list.allVersions'),
            options: versions.map((value) => ({ value, label: value })),
          },
        ]
      : []),
    {
      kind: 'date-range',
      fromKey: 'date_of_birth_from',
      toKey: 'date_of_birth_to',
      label: t('list.dateOfBirthRangeLabel'),
      fromLabel: t('list.dateOfBirthFromLabel'),
      toLabel: t('list.dateOfBirthToLabel'),
    },
  ];

  async function exportSelectedToCsv() {
    // `selectedIds` persists across pages, but `studentsQuery.data` only
    // holds the current page — resolve every selected student by id so a
    // selection made on an earlier page isn't silently dropped from the
    // export. `ensureQueryData` reuses the cache for rows already fetched
    // (e.g. via the current page or a visited detail page).
    const rows = await Promise.all(
      Array.from(state.selectedIds).map((id) =>
        queryClient.ensureQueryData(studentQueryOptions(id)),
      ),
    );
    const header = ['Roll', 'Registration No.', 'Name', 'Class', 'Section', 'Guardian', 'Status'];
    const lines = rows.map((student) => [
      student.roll_number,
      student.registration_number,
      student.full_name,
      student.class_section.class.name,
      student.class_section.section_name,
      primaryGuardianName(student),
      student.enrollment_status,
    ]);
    downloadCsv('students.csv', [header, ...lines]);
  }

  const regionConfig = useTenantRegionConfig();

  // Known values get a translated label; legacy free text is shown as typed.
  function genderLabel(gender: string | null | undefined): string {
    if (!gender) return t('list.emptyValue');
    return (GENDER_VALUES as readonly string[]).includes(gender)
      ? t(`form.fields.genderOptions.${gender}`)
      : gender;
  }

  const columns: DataTableColumn<Student>[] = [
    {
      id: 'roll',
      header: t('list.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll_number, regionConfig),
      align: 'end',
    },
    {
      id: 'registration',
      header: t('list.columnRegistration'),
      accessorFn: (row) => row.registration_number,
      sortable: true,
    },
    {
      id: 'name',
      header: t('list.columnName'),
      accessorFn: (row) => row.full_name,
      sortable: true,
      // [8.14.7] The row's own name is the natural card title.
      card: 'title',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => `${row.class_section.class.name} · ${row.class_section.section_name}`,
      card: 'subtitle',
    },
    {
      id: 'guardian',
      header: t('list.columnGuardian'),
      accessorFn: (row) => primaryGuardianName(row) ?? t('list.noGuardian'),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge domain="enrollment" status={row.enrollment_status as EnrollmentStatus} />
      ),
      // [8.14.7] Same "value + badge on the end side" grammar as
      // `portal/fees.tsx`'s invoice rows.
      card: 'badge',
    },
    {
      id: 'dateOfBirth',
      header: t('list.columnDateOfBirth'),
      accessorFn: (row) =>
        row.date_of_birth ? formatDate(row.date_of_birth, regionConfig) : t('list.emptyValue'),
    },
    {
      id: 'gender',
      header: t('list.columnGender'),
      accessorFn: (row) => genderLabel(row.gender),
    },
    {
      id: 'address',
      header: t('list.columnAddress'),
      accessorFn: (row) => row.home_address ?? t('list.emptyValue'),
    },
    {
      id: 'preferredCommunication',
      header: t('list.columnPreferredCommunication'),
      accessorFn: (row) =>
        row.preferred_communication
          ? t(`form.preferredCommunicationOptions.${row.preferred_communication}`)
          : t('list.emptyValue'),
    },
  ];

  // The Export menu and the [8.15.55] tip both open the "keep as report" dialog with the shown columns.
  function openKeepAsReport() {
    setKeepAsReport({
      columns: readVisibleColumns(
        'students-list',
        columns.map((column) => column.id),
        DEFAULT_COLUMN_VISIBILITY,
      ),
    });
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <CachedDataNotice queryKey={studentsQueryOptions(studentListFilters).queryKey} />
      <ListShell
        title={t('list.title')}
        actions={[
          {
            id: 'import',
            helpId: 'people.students.action.import',
            label: t('list.importStudents'),
            icon: <UploadIcon className="size-4" aria-hidden />,
            priority: 'secondary',
            allowed: canBulkImport,
            to: '/students/import',
          },
          {
            id: 'print-section',
            label: t('list.printWholeClass', { name: wholeClass?.label ?? '' }),
            icon: <IdCardIcon className="size-4" aria-hidden />,
            priority: 'secondary',
            allowed: canPrint && wholeClass !== undefined,
            onClick: () => wholeClass && printPreview({ class_section_id: wholeClass.sectionId }),
          },
          {
            id: 'add',
            helpId: 'people.students.action.add',
            label: t('list.addStudent'),
            icon: <PlusIcon className="size-4" aria-hidden />,
            priority: 'primary',
            allowed: canAddStudent,
            to: '/students/new',
          },
          {
            id: 'photos',
            label: t('bulkPhotos.action'),
            icon: <ImageUpIcon className="size-4" aria-hidden />,
            priority: 'tertiary',
            allowed: canUpdateStudent,
            onClick: () => setPhotosDialogOpen(true),
          },
        ]}
        // [8.15.17] One button downloads every student matching the filters above; the ticked
        // rows' CSV is the secondary item.
        tabs={
          <div className="flex flex-wrap items-center gap-3">
            {backTo !== null && (
              <Button asChild variant="link" className="h-auto px-0">
                <a
                  href={backTo}
                  onClick={(event) => {
                    event.preventDefault();
                    router.history.push(backTo);
                  }}
                >
                  <ArrowLeftIcon aria-hidden="true" />
                  {tDesigner('back')}
                </a>
              </Button>
            )}
            <ExportMenu
              totalCount={studentsQuery.data?.total ?? 0}
              selectedCount={state.selectedIds.size}
              canExportAll={canExportAll}
              unit="people"
              narrowByClass
              onExportAll={(format) =>
                downloadListExport('/students/export', studentListFilters, format)
              }
              onExportSelected={exportSelectedToCsv}
              {...(canDesignReports ? { onKeepAsReport: openKeepAsReport } : {})}
            />
            <ListReportHint list="students" filters={state.filters} onKeep={openKeepAsReport} />
          </div>
        }
        filters={{ fields: filterFields, values: state.filters, onChange: handleFiltersChange }}
        tableId="students-list"
        caption={t('list.caption')}
        columns={columns}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('list.view'),
            to: `/students/${row.id}${openPerformance ? '?tab=performance' : ''}`,
            'data-focus-anchor': row.id,
          },
          {
            intent: 'edit',
            label: t('list.edit'),
            to: `/students/${row.id}/edit`,
            allowed: canUpdateStudent,
          },
          {
            intent: 'pay',
            label: t('list.collectFees'),
            to: `/payments/record?student_id=${row.id}`,
            allowed: canCollectFees,
          },
        ]}
        data={studentsQuery.data?.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={studentsQuery.data?.total ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        selectedIds={state.selectedIds}
        onSelectedIdsChange={actions.setSelectedIds}
        columnsMenu
        columnsMenuLabel={t('list.columnsButton')}
        sortMenuLabel={t('list.sortMenuLabel')}
        sortOptionLabel={(header, direction) =>
          direction === 'asc'
            ? t('list.sortOptionLabelAscending', { header })
            : direction === 'desc'
              ? t('list.sortOptionLabelDescending', { header })
              : header
        }
        defaultColumnVisibility={DEFAULT_COLUMN_VISIBILITY}
        loading={studentsQuery.isLoading}
        isFetching={studentsQuery.isFetching}
        {...(studentsQuery.isError ? { error: t('list.errorMessage') } : {})}
        emptyState={{
          title: t('list.emptyMessage'),
          explanation:
            isTeacher && !hasActiveFilter
              ? t('list.emptyTeacherExplanation')
              : t('list.emptyExplanation'),
          ...(canAddStudent
            ? {
                action: {
                  label: t('list.addStudent'),
                  onClick: () => void navigate({ to: '/students/new' }),
                },
              }
            : {}),
        }}
        announceResults={(count, total) =>
          t('list.announceResults', { visible: count, total, count: total })
        }
        bulkActions={
          <>
            {canSendReminder && (
              <Button type="button" variant="outline" onClick={() => setReminderDialogOpen(true)}>
                <SendIcon className="size-4" aria-hidden />
                {t('list.sendReminder')}
              </Button>
            )}
            {canPrint && (
              <Button
                type="button"
                variant="outline"
                onClick={() => printPreview({ ids: Array.from(state.selectedIds) })}
              >
                <IdCardIcon className="size-4" aria-hidden />
                {t('list.printIdCards', { count: state.selectedIds.size })}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => actions.setSelectedIds(new Set())}>
              <XIcon className="size-4" aria-hidden />
              {t('list.clearSelection')}
            </Button>
          </>
        }
      />
      {/* [14.13.2]: the migrate-a-whole-school entry point, offered where a
          newcomer looking at an empty student list is already looking —
          same permission-gated one-liner `students/import.tsx` links back
          from. */}
      {isEmpty && canManageBackup && (
        <p className="mt-2 text-muted-foreground">
          {tBackup('migrateWholeSchool')}{' '}
          <Link to="/settings" className="text-primary">
            {tBackup('migrateWholeSchoolLink')}
          </Link>
        </p>
      )}
      <BulkPhotoDialog open={photosDialogOpen} onOpenChange={setPhotosDialogOpen} />
      {canDesignReports && (
        <SaveAsReportDialog
          open={keepAsReport !== null}
          onOpenChange={(open) => {
            if (!open) setKeepAsReport(null);
          }}
          kind="students"
          filters={{ ...effectiveFilters }}
          names={{
            className: classesQuery.data?.data.find((k) => k.id === filters.class_id)?.name,
            sectionName: sectionsQuery.data?.find((x) => x.id === filters.section_id)?.section_name,
          }}
          columns={keepAsReport?.columns ?? []}
        />
      )}
      <SendReminderDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        studentIds={Array.from(state.selectedIds)}
        onSent={() => actions.setSelectedIds(new Set())}
      />
    </RegionConfigProvider>
  );
}

function primaryGuardianName(student: Student): string | undefined {
  return (student.guardians.find((g) => g.is_primary_contact) ?? student.guardians[0])?.full_name;
}

function StudentsListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
