/**
 * [21.9.1] D12: the substitution log — a date-ranged list of cover /
 * cancellation overlays, filterable by covering teacher, covered-for
 * teacher, or section. Filters are query params so a filtered view is
 * bookmarkable/sharable, same convention every other filtered list route
 * in this codebase follows.
 *
 * [2897] Each record comes with a `slot` summary (section, period, subject,
 * the slot's teachers) joined by the server from any year, so rows from an
 * earlier year are not blank. `class_id` lives in the URL but is never
 * sent to the API — it only narrows the section filter's options.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  DataTable,
  ErrorState,
  StatusBadge,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useClasses,
  useClassSections,
  useDeleteSubstitution,
  useSubstitutions,
  useTeachers,
  type SubstitutionLogRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import {
  formatDate,
  formatNumber,
  formatTime,
  formatWeekday,
  tenantTodayIso,
} from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { addDays } from './-marking/dates';
import { subjectName } from './-subject-name';
import { SubstitutionDialog } from './-substitution-dialog';

const searchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  substitute_teacher_id: z.string().uuid().optional().catch(undefined),
  covered_for_teacher_id: z.string().uuid().optional().catch(undefined),
  class_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/substitutions')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: SubstitutionsPage,
});

function SubstitutionsPage() {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [deleting, setDeleting] = React.useState<SubstitutionLogRow | null>(null);
  const deleteSubstitution = useDeleteSubstitution();

  const { class_id, ...apiFilters } = search;
  const teachersQuery = useTeachers({});
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(class_id);
  const substitutionsQuery = useSubstitutions(apiFilters);

  const teacherName = (id: string | null | undefined) =>
    (id && teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name) || '—';

  const teacherOptions = (teachersQuery.data?.data ?? []).map((teacher) => ({
    value: teacher.id,
    label: teacher.user.full_name,
  }));

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'date-range',
      fromKey: 'from',
      toKey: 'to',
      label: t('substitutionsPage.dateLabel'),
      fromLabel: t('substitutionsPage.fromLabel'),
      toLabel: t('substitutionsPage.toLabel'),
    },
    {
      kind: 'select',
      key: 'substitute_teacher_id',
      label: t('substitutionsPage.coveringTeacherLabel'),
      allLabel: t('substitutionsPage.anyTeacher'),
      options: teacherOptions,
    },
    {
      kind: 'select',
      key: 'covered_for_teacher_id',
      label: t('substitutionsPage.coveredForTeacherLabel'),
      allLabel: t('substitutionsPage.anyTeacher'),
      options: teacherOptions,
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('substitutionsPage.classLabel'),
      allLabel: t('substitutionsPage.anyClass'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('substitutionsPage.sectionLabel'),
      // ponytail: FilterBar has no disabled select, so before a class is
      // chosen the section filter offers nothing and says why in its own
      // "all" label. Upgrade: a `disabled` flag on SelectFilterField.
      allLabel: class_id
        ? t('substitutionsPage.anySection')
        : t('substitutionsPage.pickClassFirst'),
      options: class_id
        ? (sectionsQuery.data ?? []).map((section) => ({
            value: section.id,
            label: section.section_name,
          }))
        : [],
    },
  ];

  const values: Record<string, string> = Object.fromEntries(
    Object.entries(search).filter(([, value]) => Boolean(value)) as [string, string][],
  );
  const hasFilters = Object.keys(values).length > 0;

  function handleFilterChange(patch: Record<string, string | null>) {
    setPage(1);
    void navigate({
      search: (prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(patch).map(([key, value]) => [key, value ?? undefined]),
        ),
        // A different class makes the chosen section meaningless.
        ...('class_id' in patch ? { section_id: undefined } : {}),
      }),
    });
  }

  interface Row {
    substitution: SubstitutionLogRow;
    sequence: number;
    periodCell: string;
    subject: string;
    section: string;
    absent: string;
  }

  const rows: Row[] = (substitutionsQuery.data ?? []).map((substitution) => {
    const slot = substitution.slot;
    return {
      substitution,
      sequence: slot?.period_sequence ?? 0,
      periodCell: slot
        ? t('substitutionsPage.periodCell', {
            period: t('agenda.periodLabel', {
              sequence: formatNumber(slot.period_sequence, config),
            }),
            time: formatTime(slot.starts_at, config),
          })
        : '—',
      subject: slot
        ? subjectName(
            { name_en: slot.subject_name_en, name_bn: slot.subject_name_bn },
            i18n.language,
          )
        : '—',
      section: slot
        ? t('substitutionsPage.sectionName', {
            className: slot.class_name,
            sectionName: slot.section_name,
          })
        : '—',
      absent: slot ? slot.teacher_ids.map(teacherName).join(', ') || '—' : '—',
    };
  });
  // Server order is date desc; within a day, period order.
  rows.sort(
    (a, b) => b.substitution.date.localeCompare(a.substitution.date) || a.sequence - b.sequence,
  );
  const pageSize = 25;
  // #3022: the server refuses to delete a record dated before the school's today, so
  // the action is not offered (it would only ever answer 409). `config` may be the locale
  // default rather than the school's own zone (settings not loaded, or a role that cannot
  // read them). That default is Asia/Dhaka (UTC+6), and every zone (UTC-12 to UTC+14) is
  // within 18 hours of it: so only a record older than yesterday is surely past. Yesterday's stays offered; the server decides, and its 409
  // has its own sentence (`pastDeleteError`).
  const surelyPastBefore = addDays(tenantTodayIso(config), -1);

  function handleDelete() {
    if (!deleting) return;
    deleteSubstitution.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null);
        toast.success(t('substitutionsPage.deletedToast'));
      },
      onError: (err) => {
        setDeleting(null);
        const isPast = err instanceof ApiError && err.details?.['code'] === 'SUBSTITUTION_IN_PAST';
        toast.error(
          t(isPast ? 'substitutionsPage.pastDeleteError' : 'substitutionsPage.deleteError'),
        );
      },
    });
  }

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'date',
      header: t('substitutionsPage.columns.date'),
      card: 'title',
      accessorFn: (row) => (
        <>
          <span className="font-medium whitespace-nowrap">
            {formatDate(row.substitution.date, config)}
          </span>
          <span className="block text-caption text-text-secondary">
            {formatWeekday(row.substitution.date, config)}
          </span>
        </>
      ),
    },
    {
      id: 'period',
      header: t('substitutionsPage.columns.period'),
      card: 'subtitle',
      accessorFn: (row) => (
        <>
          {row.periodCell}
          <span className="block text-caption text-text-secondary">{row.subject}</span>
        </>
      ),
    },
    {
      id: 'section',
      header: t('substitutionsPage.columns.section'),
      card: 'field',
      accessorFn: (row) => row.section,
    },
    {
      id: 'absent',
      header: t('substitutionsPage.columns.absent'),
      card: 'field',
      accessorFn: (row) => row.absent,
    },
    {
      id: 'substitute',
      header: t('substitutionsPage.columns.substitute'),
      card: 'field',
      accessorFn: (row) =>
        row.substitution.is_cancelled ? '—' : teacherName(row.substitution.substitute_teacher_id),
    },
    {
      id: 'status',
      header: t('substitutionsPage.columns.status'),
      card: 'badge',
      accessorFn: (row) => (
        <StatusBadge
          tone={row.substitution.is_cancelled ? 'neutral' : 'info'}
          label={
            row.substitution.is_cancelled
              ? t('substitutionsPage.cancelledLabel')
              : t('substitutionsPage.statusCovered')
          }
        />
      ),
    },
    {
      id: 'reason',
      header: t('substitutionsPage.columns.reason'),
      card: 'field',
      accessorFn: (row) => (
        <span className="text-text-secondary">{row.substitution.reason || '—'}</span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('substitutionsPage.title')}
        subtitle={t('substitutionsPage.subtitle')}
        actions={[
          {
            id: 'add',
            helpId: 'academics.routineSubstitutions.action.add',
            priority: 'primary',
            icon: <PlusIcon />,
            label: t('substitutionsPage.addAction'),
            onClick: () => setDialogOpen(true),
          },
        ]}
      />

      <FilterBar
        fields={fields}
        values={values}
        onChange={handleFilterChange}
        resultCount={rows.length}
      />

      {substitutionsQuery.isError ? (
        <ErrorState
          message={t('substitutionsPage.error')}
          onRetry={() => void substitutionsQuery.refetch()}
        />
      ) : (
        <DataTable
          tableId="routine-substitutions"
          caption={t('substitutionsPage.caption')}
          columns={columns}
          data={rows.slice((page - 1) * pageSize, page * pageSize)}
          getRowId={(row) => row.substitution.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={pageSize}
          totalCount={rows.length}
          onPageChange={setPage}
          loading={substitutionsQuery.isPending}
          rowActions={(row) => [
            {
              intent: 'delete',
              label: t('substitutionsPage.deleteAction'),
              allowed: row.substitution.date >= surelyPastBefore,
              onClick: () => setDeleting(row.substitution),
            },
          ]}
          emptyState={{
            title: t('substitutionsPage.emptyTitle'),
            explanation: t('substitutionsPage.emptyExplanation'),
            ...(hasFilters
              ? {
                  action: {
                    label: t('substitutionsPage.clearFilters'),
                    onClick: () => void navigate({ search: {} }),
                  },
                }
              : {}),
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        tone="danger"
        title={t('substitutionsPage.deleteTitle', {
          date: deleting ? formatDate(deleting.date, config) : '',
        })}
        description={t('substitutionsPage.deleteDescription')}
        confirmLabel={t('substitutionsPage.deleteConfirm')}
        cancelLabel={t('substitutionsPage.cancel')}
        busy={deleteSubstitution.isPending}
        onConfirm={handleDelete}
      />

      <SubstitutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={() => void substitutionsQuery.refetch()}
      />
    </PageContainer>
  );
}
