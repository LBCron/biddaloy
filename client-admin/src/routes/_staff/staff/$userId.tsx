/**
 * [8.11.8] — one staff member's page: Profile · Permissions (read-only
 * from `ROLE_PERMISSIONS`) · Login History, mirroring
 * `guardians/$guardianId.tsx`'s `DetailShell`/`useDetailShellTab` shape.
 *
 * The Login History tab is mounted only behind
 * `useHasPermission(Permission.AUDIT_LOG_READ)` — `GET /audit-logs` is
 * ADMIN-only server-side, so the UI and the server agree instead of
 * showing a tab that can only 403.
 *
 * "Remove from school" deletes only this school's membership row. When
 * the viewed user *is* the logged-in user the dialog renders the action
 * disabled with an explanation — self-removal is prevented client-side
 * and again by the server's own 400.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import {
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  useCurrentUserId,
  useHasPermission,
  useTeachers,
  useUser,
  userQueryOptions,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatDate, formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleMinusIcon, KeyRoundIcon, PencilIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { SubjectApplicationsTab } from '../../../features/applications/subject-applications-tab';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { AcrTab } from './-detail/acr-tab';
import { AttendanceLeaveTab } from './-detail/attendance-leave-tab';
import { StaffDocumentsTab } from './-detail/documents-tab';
import { HrRecordTab } from './-detail/hr-record-tab';
import { IncidentsTab } from './-detail/incidents-tab';
import { LoginHistoryTab } from './-detail/login-history-tab';
import { PerformanceTab } from './-detail/performance-tab';
import { PermissionsTab } from './-detail/permissions-tab';
import { ProfileTab } from './-detail/profile-tab';
import { ResetPasswordDialog } from './-detail/reset-password-dialog';
import { TeachingAssignmentsTab } from './-detail/teaching-assignments-tab';
import { EditTeacherDialog } from './-edit-teacher-dialog';
import { EditUserDialog } from './-edit-user-dialog';
import { RemoveMemberDialog } from './-remove-member-dialog';

const staffDetailSearchSchema = z.object({
  // Invalid values fall back to the first tab inside `useDetailShellTab`,
  // same as `guardians/$guardianId.tsx`.
  tab: z.string().optional(),
});

export const Route = createFileRoute('/_staff/staff/$userId')({
  validateSearch: staffDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(userQueryOptions(params.userId)).catch(swallowUnlessOffline),
      loadRouteNamespaces(
        'staff',
        // [83.3.3] Teaching assignments tab › Coordination block.
        'teacherAssignments',
        'staffAttendance',
        'leave',
        'evaluations',
        'performance',
        'printHistory',
        // [52.5.2] Applications tab: type/status labels + the row summary.
        'applications',
        'applicationsList',
        'feeStructures',
        'common',
      ),
    ]),
  pendingComponent: StaffDetailPending,
  component: StaffDetailPage,
});

function StaffDetailPage() {
  const { userId } = Route.useParams();
  const { t } = useTranslation('staff');
  const navigate = useNavigate();
  const userQuery = useUser(userId);
  const teacherQuery = useTeachers({ user_id: userId, limit: 1 });
  const teacher = teacherQuery.data?.data[0];

  const canUpdate = useHasPermission(Permission.USER_UPDATE);
  const canRemove = useHasPermission(Permission.MEMBER_REMOVE);
  const canReadAuditLogs = useHasPermission(Permission.AUDIT_LOG_READ);
  const canReadHrRecord = useHasPermission(Permission.STAFF_HR_READ);
  const canReadAcr = useHasPermission(Permission.ACR_READ);
  const canReadStaffAttendance = useHasPermission(Permission.STAFF_ATTENDANCE_READ);
  const canManageApplications = useHasPermission(Permission.APPLICATION_MANAGE);
  const search = Route.useSearch();
  // D18: a staff card exposes HR data, so printing needs both permissions.
  const canPrintStaffCard = useHasPermission(Permission.DOCUMENT_PRINT) && canReadHrRecord;
  const currentUserId = useCurrentUserId();

  const isTeacher = teacher !== undefined;
  // A deep link to the teacher tab must survive until `useTeachers` answers.
  const teacherTabPending = teacherQuery.isPending && search.tab === 'teachingAssignments';
  const hasStaffProfile = userQuery.data?.staff_profile_id != null;
  const tabIds = [
    'profile',
    'permissions',
    ...(isTeacher || teacherTabPending ? (['teachingAssignments'] as const) : []),
    ...(canReadHrRecord ? (['hrRecord'] as const) : []),
    ...(canReadAcr ? (['acr', 'incidents', 'performance'] as const) : []),
    ...(canPrintStaffCard ? (['documents'] as const) : []),
    ...(hasStaffProfile && canReadStaffAttendance ? (['attendanceLeave'] as const) : []),
    ...(hasStaffProfile && canManageApplications ? (['applications'] as const) : []),
    ...(canReadAuditLogs ? (['loginHistory'] as const) : []),
  ] as const;
  const [activeTab, setActiveTab] = useDetailShellTab(tabIds);

  const [editUserOpen, setEditUserOpen] = React.useState(false);
  const [editTeacherOpen, setEditTeacherOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);

  const regionConfig = useTenantRegionConfig();

  const tabs = [
    {
      id: 'profile',
      label: t('detail.tabs.profile'),
      content: <ProfileTab userId={userId} onEditTeacher={() => setEditTeacherOpen(true)} />,
    },
    {
      id: 'permissions',
      label: t('detail.tabs.permissions'),
      content: <PermissionsTab userId={userId} />,
    },
    ...(teacherTabPending
      ? [
          {
            id: 'teachingAssignments',
            label: t('detail.tabs.teachingAssignments'),
            content: <Skeleton className="h-40 w-full" />,
          },
        ]
      : []),
    ...(teacher !== undefined
      ? [
          {
            id: 'teachingAssignments',
            label: t('detail.tabs.teachingAssignments'),
            content: <TeachingAssignmentsTab teacherId={teacher.id} />,
          },
        ]
      : []),
    ...(canReadHrRecord
      ? [
          {
            id: 'hrRecord',
            label: t('detail.tabs.hrRecord'),
            content: <HrRecordTab userId={userId} />,
          },
        ]
      : []),
    ...(canReadAcr
      ? [
          {
            id: 'acr',
            label: t('tabs.acr', { ns: 'evaluations' }),
            content: <AcrTab userId={userId} />,
          },
          {
            id: 'incidents',
            label: t('tabs.incidents', { ns: 'evaluations' }),
            content: <IncidentsTab userId={userId} />,
          },
          {
            id: 'performance',
            label: t('title', { ns: 'performance' }),
            content: (
              <PerformanceTab userId={userId} subjectName={userQuery.data?.full_name ?? ''} />
            ),
          },
        ]
      : []),
    ...(canPrintStaffCard
      ? [
          {
            id: 'documents',
            label: t('detail.tabs.documents'),
            content: (
              <StaffDocumentsTab userId={userId} onOpenHrRecord={() => setActiveTab('hrRecord')} />
            ),
          },
        ]
      : []),
    ...(hasStaffProfile && canReadStaffAttendance && userQuery.data?.staff_profile_id
      ? [
          {
            id: 'attendanceLeave',
            label: t('detailTab.label', { ns: 'staffAttendance' }),
            content: (
              <AttendanceLeaveTab
                staffProfileId={userQuery.data.staff_profile_id}
                userId={userId}
                staffName={userQuery.data.full_name}
              />
            ),
          },
        ]
      : []),
    ...(hasStaffProfile && canManageApplications && userQuery.data?.staff_profile_id
      ? [
          {
            id: 'applications',
            label: t('detail.tabs.applications'),
            content: (
              <SubjectApplicationsTab
                subject={{
                  kind: 'STAFF',
                  staffProfileId: userQuery.data.staff_profile_id,
                  userId,
                }}
                subjectName={userQuery.data.full_name}
                ns="staff"
              />
            ),
          },
        ]
      : []),
    ...(canReadAuditLogs
      ? [
          {
            id: 'loginHistory',
            label: t('detail.tabs.loginHistory'),
            content: <LoginHistoryTab userId={userId} />,
          },
        ]
      : []),
  ];

  const user = userQuery.data;

  return (
    <RegionConfigProvider value={regionConfig}>
      {userQuery.isPending ? (
        <PageContainer size="wide">
          <Skeleton className="h-7 w-64" />
        </PageContainer>
      ) : isNotFoundError(userQuery.error) ? (
        <PageContainer size="wide">
          <RecordNotFoundState onBack={() => void navigate({ to: '/staff' })} />
        </PageContainer>
      ) : userQuery.isError || user === undefined ? (
        <PageContainer size="wide">
          <ErrorState
            message={
              userQuery.error instanceof ApiError && userQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void userQuery.refetch()}
          />
        </PageContainer>
      ) : (
        <>
          <DetailShell
            name={user.full_name}
            statusBadge={
              <>
                <StatusBadge domain="user" status={user.status} />
                {user.invitation_status !== 'ACTIVATED' && (
                  <StatusBadge domain="invitation" status={user.invitation_status} />
                )}
              </>
            }
            facts={[
              {
                label: t('detail.facts.role'),
                value: user.role !== null ? t(`roles.${user.role}`) : '—',
              },
              ...(teacher !== undefined
                ? [{ label: t('detail.profile.employeeId'), value: teacher.employee_id }]
                : []),
              {
                label: t('detail.facts.memberSince'),
                value: formatDate(new Date(user.member_since ?? user.created_at), regionConfig),
              },
              {
                label: t('detail.facts.lastSignIn'),
                value: user.last_login_at
                  ? formatDateTime(new Date(user.last_login_at), regionConfig)
                  : t('detail.facts.neverSignedIn'),
              },
            ]}
            actions={[
              {
                id: 'resetPassword',
                helpId: 'people.staff.action.resetPassword',
                label: t('detail.actions.resetPassword'),
                icon: <KeyRoundIcon />,
                allowed: canUpdate && user.id !== currentUserId,
                priority: 'secondary',
                onClick: () => setResetPasswordOpen(true),
              },
              {
                id: 'editUser',
                helpId: 'people.staff.action.edit',
                label: t('detail.actions.editUser'),
                icon: <PencilIcon />,
                allowed: canUpdate,
                priority: 'primary',
                onClick: () => setEditUserOpen(true),
              },
              {
                id: 'remove',
                label: t('detail.actions.remove'),
                icon: <CircleMinusIcon />,
                allowed: canRemove,
                priority: 'tertiary',
                onClick: () => setRemoveOpen(true),
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabs={tabs}
          />

          <EditUserDialog
            open={editUserOpen}
            onOpenChange={setEditUserOpen}
            user={userQuery.data}
          />
          {teacher !== undefined && (
            <EditTeacherDialog
              open={editTeacherOpen}
              onOpenChange={setEditTeacherOpen}
              teacher={teacher}
            />
          )}
          <RemoveMemberDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            user={userQuery.data}
            isSelf={userQuery.data.id === currentUserId}
            onRemoved={() => void navigate({ to: '/staff' })}
          />
          {userQuery.data.id !== currentUserId && (
            <ResetPasswordDialog
              open={resetPasswordOpen}
              onOpenChange={setResetPasswordOpen}
              user={userQuery.data}
            />
          )}
        </>
      )}
    </RegionConfigProvider>
  );
}

function StaffDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
