import { Permission } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import { ErrorState, RecordNotFoundState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { classQueryOptions, useClass, useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ClassFormDialog } from './-class-form-dialog';
import { DeleteClassDialog } from './-delete-class-dialog';
import { FeeStructuresTab } from './-detail/fee-structures-tab';
import { HomeworkTab } from './-detail/homework-tab';
import { PerformanceTab } from './-detail/performance-tab';
import { SectionsTab } from './-detail/sections-tab';
import { StudentsTab } from './-detail/students-tab';
import { SubjectsTab } from './-detail/subjects-tab';
import { TeachersTab } from './-detail/teachers-tab';

export const Route = createFileRoute('/_staff/classes/$classId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(classQueryOptions(params.classId)).catch(swallowUnlessOffline),
      // 'feeStructures' — `-detail/fee-structures-tab.tsx` reads its copy
      // from that namespace; 'staff' — `-detail/teachers-tab.tsx` does the
      // same. Without these, the first visit to either tab suspends the
      // whole page (i18n's useSuspense: true) instead of just that tab,
      // taking keyboard focus with it — same failure mode
      // `students/$studentId.tsx`'s loader comment documents.
      loadRouteNamespaces(
        'classes',
        'common',
        'feeStructures',
        'staff',
        'performance',
        // [83.3.3] Teachers tab › Coordinators block.
        'teacherAssignments',
      ),
    ]),
  pendingComponent: ClassDetailPending,
  component: ClassDetailPage,
});

const TAB_IDS = [
  'sections',
  'students',
  'feeStructures',
  'teachers',
  'subjects',
  'homework',
  'performance',
] as const;

function ClassDetailPage() {
  const { classId } = Route.useParams();
  const { t } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();

  const classQuery = useClass(classId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const canViewPerformance = useHasPermission(Permission.MARK_VIEW);
  const { t: tPerformance } = useTranslation('performance');
  const regionConfig = useTenantRegionConfig();

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (classQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isNotFoundError(classQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/classes' })} />;
  }

  if (classQuery.isError) {
    const forbidden = classQuery.error instanceof ApiError && classQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void classQuery.refetch()}
      />
    );
  }

  const klass = classQuery.data;

  return (
    <RegionConfigProvider value={regionConfig}>
      <DetailShell
        name={klass.name}
        facts={[
          {
            label: t('detail.factGrade'),
            value:
              klass.numeric_grade == null
                ? t('list.noGrade')
                : formatNumber(klass.numeric_grade, regionConfig),
          },
          { label: t('detail.factAcademicYear'), value: klass.academic_year.name },
          ...(klass.shift ? [{ label: t('list.shiftLabel'), value: klass.shift }] : []),
          ...(klass.version ? [{ label: t('list.versionLabel'), value: klass.version }] : []),
          {
            label: t('detail.factSections'),
            value: t('detail.sectionCount', {
              count: klass.sections.length,
            }),
          },
        ]}
        actions={[
          {
            id: 'edit',
            helpId: 'academics.classes.action.edit',
            label: t('list.edit'),
            icon: <PencilIcon aria-hidden="true" />,
            onClick: () => setEditOpen(true),
            allowed: canManage,
            priority: 'secondary',
          },
          {
            id: 'delete',
            helpId: 'academics.classes.action.delete',
            label: t('list.delete'),
            icon: <Trash2Icon aria-hidden="true" />,
            onClick: () => setDeleteOpen(true),
            priority: 'destructive',
            allowed: canManage,
          },
        ]}
        tabs={[
          {
            id: 'sections',
            label: t('detail.tabSections'),
            content: <SectionsTab classId={klass.id} />,
          },
          {
            id: 'students',
            label: t('detail.tabStudents'),
            content: <StudentsTab classId={klass.id} />,
          },
          {
            id: 'feeStructures',
            label: t('detail.tabFeeStructures'),
            content: <FeeStructuresTab classId={klass.id} />,
          },
          {
            id: 'teachers',
            label: t('detail.tabTeachers'),
            content: <TeachersTab classId={klass.id} />,
          },
          {
            id: 'subjects',
            label: t('detail.tabSubjects'),
            content: <SubjectsTab classId={klass.id} academicYearId={klass.academic_year.id} />,
          },
          {
            id: 'homework',
            label: t('detail.tabHomework'),
            content: <HomeworkTab classId={klass.id} />,
          },
          ...(canViewPerformance
            ? [
                {
                  id: 'performance',
                  label: tPerformance('title'),
                  content: (
                    <PerformanceTab
                      classId={klass.id}
                      className={klass.name}
                      academicYearId={klass.academic_year.id}
                    />
                  ),
                },
              ]
            : []),
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {canManage && editOpen && (
        <ClassFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          classId={klass.id}
          initialValues={{
            name: klass.name,
            numericGrade: klass.numeric_grade ?? undefined,
            // Without these, saving from this page sent shift/version null
            // and erased them.
            shift: klass.shift ?? null,
            version: klass.version ?? null,
          }}
          onSaved={() => setEditOpen(false)}
        />
      )}

      {canManage && deleteOpen && (
        <DeleteClassDialog
          open
          onOpenChange={setDeleteOpen}
          classId={klass.id}
          className={klass.name}
          onDeleted={() => void navigate({ to: '/classes' })}
        />
      )}
    </RegionConfigProvider>
  );
}

function ClassDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
