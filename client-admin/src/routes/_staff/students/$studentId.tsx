import { EnrollmentStatus, Permission, STUDENT_CERTIFICATE_KINDS } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import {
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  StatusBadge,
  StudentAlertStrip,
} from '@biddaloy/ui/components';
import {
  studentQueryOptions,
  useHasPermission,
  useStudent,
  useStudentAttention,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  HandCoinsIcon,
  IdCardIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { IssueCertificateModal } from '../../../components/print/certificates/issue-certificate-modal';
import { SubjectApplicationsTab } from '../../../features/applications/subject-applications-tab';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ActivityTab } from './-detail/activity-tab';
import { AttendanceTab } from './-detail/attendance-tab';
import { CommunicationTab } from './-detail/communication-tab';
import { DeleteStudentDialog } from './-detail/delete-student-dialog';
import { DocumentsTab, ISSUE_TRIGGER_ID } from './-detail/documents-tab';
import { EnrollmentTab } from './-detail/enrollment-tab';
import { FeesTab } from './-detail/fees-tab';
import { FinesTab } from './-detail/fines-tab';
import { GuardiansTab } from './-detail/guardians-tab';
import { HomeworkTab } from './-detail/homework-tab';
import { InvoicesTab } from './-detail/invoices-tab';
import { LeaveDialog } from './-detail/leave-dialog';
import { NotesTab } from './-detail/notes-tab';
import { OverviewTab } from './-detail/overview-tab';
import { PaymentsTab } from './-detail/payments-tab';
import { PerformanceTab } from './-detail/performance-tab';
import { ProgramsPanel } from './-detail/programs-panel';
import { PromotionOverrideBadge } from './-detail/promotion-override-badge';
import { ReadmitDialog } from './-detail/readmit-dialog';
import { RecordsTab } from './-detail/records-tab';
import { RecurringFeesTab } from './-detail/recurring-fees-tab';
import { ResultsPanel } from './-detail/results-panel';
import { SubjectChoicesPanel } from './-detail/subject-choices-panel';
import { SendReminderDialog } from './-send-reminder-dialog';

const studentDetailSearchSchema = z.object({
  // `useDetailShellTab` falls back to the first tab for anything not in
  // its own `tabIds` list, so an invalid value here isn't validated away
  // by this schema — it's handled once, there, not duplicated here.
  tab: z.string().optional(),
  // [31.5.0] Full-page modals opened from this page, so Back closes them and a refresh keeps them.
  logFine: z.coerce.string().optional().catch(undefined),
  enrolProgram: z.coerce.string().optional().catch(undefined),
  // Enrolment id of the programme row whose milestone is being recorded.
  recordMilestone: z.string().uuid().optional().catch(undefined),
  /** [48.3.B-01] The issue-certificate overlay: a kind, or `pick` to choose one. */
  issue: z
    .enum([...STUDENT_CERTIFICATE_KINDS, 'pick'])
    .optional()
    .catch(undefined),
  step: z.string().optional(),
  /** Opens the Leave dialog (the TC card's fix link); removed again on open. */
  leave: z.literal('1').optional().catch(undefined),
});

/**
 * [8.10.2] — one page for a student's enrolment history, fees, payments,
 * invoices, guardians and message history, replacing [8.9.1]'s
 * name-only stub. Eight tabs (`DetailShell`/`useDetailShellTab`, both
 * already built for this), each its own component below so each one's
 * data query only ever runs once its tab is first activated — opening
 * this page fires exactly one request (`useStudent`, shared by the
 * header and the default-active Overview tab), not eight.
 */
export const Route = createFileRoute('/_staff/students/$studentId')({
  validateSearch: studentDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(studentQueryOptions(params.studentId))
        .catch(swallowUnlessOffline),
      // 'portal' namespace — `-detail/attendance-tab.tsx` renders
      // AttendanceMonthGrid, which reads its copy from that namespace;
      // without this, a first visit before it's cached elsewhere suspends
      // to the top-level blank fallback instead of the tab's own skeleton.
      // (Deliberately not spelled as a literal useTranslation(...) call in
      // this comment — check-i18n-keys.mjs's namespace-resolution regex
      // isn't a real parser and would match that text as this file's own
      // useTranslation call, misrouting every t() call below.)
      // 'exams' — [19.6.1]'s Subject choices tab (`-detail/subject-choices-
      // panel.tsx`) reads its copy from that namespace.
      // 'fees' — `-detail/recurring-fees-tab.tsx` reads its copy from that
      // namespace; without this, the first visit to Recurring fees
      // suspends the whole page (i18n's useSuspense: true) instead of just
      // that tab, which also drops keyboard focus off the tab strip.
      // 'fines' — [38.4.4]'s `-detail/fines-tab.tsx` reads its copy from
      // that namespace; same suspend-the-whole-page reasoning as 'fees'.
      // 'feeGeneration' — that same tab always mounts `GenerateFeesModal`
      // (closed) when the caller can manage fees, and the modal reads its
      // own copy from that namespace even while closed — same suspend-the-
      // whole-page failure one level down.
      // 'promotions' — [26.5.2]'s override badge (header + Enrollment tab)
      // reads its `badge` copy from that namespace.
      // 'programs' — [34.5.1]'s Programs tab (`-detail/programs-panel.tsx`)
      // reads its copy from that namespace.
      loadRouteNamespaces(
        'students',
        'common',
        'attention',
        'portal',
        'payments',
        'exams',
        'fees',
        'fines',
        'feeGeneration',
        'promotions',
        'programs',
        // [39.x] Records/Notes tabs + Leave/Readmit dialogs read their copy
        // from these; same suspend-the-whole-page reasoning as 'fees'.
        'student-records',
        'student-notes',
        'performance',
        'student-lifecycle',
        // The readmit dialog's seat-limit 409 message (`MutationErrorMessage`) reads 'trial'.
        'trial',
        // The seat-limit action (`SeatLimitReachedAction`) reads 'billing'.
        'billing',
        'printHistory',
        // [48] The Documents tab reads 'certificates'; the issue-certificate
        // modal (`?issue=`) also reads 'printPreview' and 'printEditor'. Same
        // suspend-the-whole-page reasoning as 'fees'.
        'certificates',
        'printPreview',
        'printEditor',
        // students-7a's Activity tab reads `auditLogs:actions.*`; same
        // suspend-the-whole-page reasoning as 'fees'.
        'auditLogs',
        // [52.5.2] Applications tab: tab copy + type/status labels + the row summary.
        'applications',
        'applicationsList',
        'feeStructures',
        'staff',
        // [68.0 #2279] The Fees tab's write-off and payout dialogs open the step-up modal,
        // which reads 'approval'. Unloaded, it suspends the whole page mid-mutation: the
        // dialog's effects re-run, reset the mutation, and the dialog never closes.
        'approval',
      ),
    ]),
  pendingComponent: StudentDetailPending,
  component: StudentDetailPage,
});

// People -> study -> money -> history (D20).
const TAB_IDS = [
  'overview',
  'guardians',
  'enrollment',
  'attendance',
  'results',
  'homework',
  'subject-choices',
  'programs',
  'performance',
  'fees',
  'fines',
  'recurring-fees',
  'payments',
  'invoices',
  'communication',
  'notes',
  'records',
  'documents',
  'applications',
  'activity',
] as const;

function StudentDetailPage() {
  const { studentId } = Route.useParams();
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const search = Route.useSearch();
  const setKey = (key: 'logFine' | 'enrolProgram' | 'recordMilestone', value: string | undefined) =>
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, [key]: value }),
      replace: value === undefined,
    });
  const navigateSearch = Route.useNavigate();
  const studentQuery = useStudent(studentId);
  // [67.2.08] Never blocks the page: error/403 leaves `data` undefined and the strip renders nothing.
  const alerts = useStudentAttention(studentId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = React.useState(false);
  const [readmitDialogOpen, setReadmitDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const canUpdate = useHasPermission(Permission.STUDENT_UPDATE);
  const canSeeMessages = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canManageLifecycle = useHasPermission(Permission.STUDENT_LIFECYCLE_MANAGE);
  const canReadRecords = useHasPermission(Permission.STUDENT_RECORDS_READ);
  const canReadNotes = useHasPermission(Permission.STUDENT_NOTES_READ);
  const canViewPerformance = useHasPermission(Permission.MARK_VIEW);
  const { t: tPerformance } = useTranslation('performance');
  const canDelete = useHasPermission(Permission.STUDENT_DELETE);
  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canIssueCertificate = useHasPermission(Permission.CERTIFICATE_ISSUE);
  const canReadRegister = useHasPermission(Permission.PRINT_HISTORY_READ);
  // Not `useCloseFullPage` ("history back"): the wizard may have been opened by a link, so Close
  // drops `?issue`/`?step` in place. The wizard replaces its step changes, so Back stays closed.
  const issueFocusPending = React.useRef(false);
  const closeIssue = React.useCallback(() => {
    issueFocusPending.current = true;
    void navigateSearch({
      search: (p) => ({ ...p, issue: undefined, step: undefined }),
      replace: true,
    });
  }, [navigateSearch]);
  // The modal is unmounted, not closed in place, so give focus back to the button that opened it
  // once `?issue` is gone — a frame later, after the dialog's own focus restore (a 0ms timer that
  // would land on <body>).
  React.useEffect(() => {
    if (search.issue !== undefined || !issueFocusPending.current) return;
    issueFocusPending.current = false;
    const frame = window.requestAnimationFrame(() =>
      document.getElementById(ISSUE_TRIGGER_ID)?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [search.issue]);
  // `?leave=1` opens the Leave dialog once (only for someone who may record leaving), then the
  // param goes away.
  React.useEffect(() => {
    if (search.leave !== '1') return;
    if (canManageLifecycle) setLeaveDialogOpen(true);
    void navigateSearch({ search: (p) => ({ ...p, leave: undefined }), replace: true });
  }, [search.leave, navigateSearch, canManageLifecycle]);
  const canManageApplications = useHasPermission(Permission.APPLICATION_MANAGE);
  // The Fees/Payments/Invoices tabs format currency — same reasoning as
  // `/settings`'s own `RegionConfigProvider` wrap: `useRegionConfig()`
  // has no ambient provider above the route tree, so without this every
  // amount on this page would silently fall back to the context's
  // hardcoded default region rather than the active tenant's actual one.
  const regionConfig = useTenantRegionConfig();

  const isActive = studentQuery.data?.enrollment_status === EnrollmentStatus.ACTIVE;

  // Leave <-> Readmit swaps the header action, so the button that opened the
  // dialog unmounts and focus would fall to <body>. Remember the replacement
  // and focus it once the status has flipped AND the dialog has closed
  // (focus is still trapped in the dialog while the refetch lands).
  const pendingFocus = React.useRef<{ target: string; wasActive: boolean } | null>(null);
  React.useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || pending.wasActive === isActive || leaveDialogOpen || readmitDialogOpen) return;
    pendingFocus.current = null;
    document.querySelector<HTMLElement>(`[data-action-id="${pending.target}"]`)?.focus();
  }, [isActive, leaveDialogOpen, readmitDialogOpen]);

  const guardians = studentQuery.data?.guardians ?? [];
  const primaryGuardian = guardians.find((g) => g.is_primary_contact) ?? guardians[0];

  return (
    <RegionConfigProvider value={regionConfig}>
      {studentQuery.isPending ? (
        <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />
      ) : isNotFoundError(studentQuery.error) ? (
        <PageContainer>
          <RecordNotFoundState onBack={() => void navigate({ to: '/students' })} />
        </PageContainer>
      ) : studentQuery.isError ? (
        <PageContainer>
          <ErrorState
            message={
              studentQuery.error instanceof ApiError && studentQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void studentQuery.refetch()}
          />
        </PageContainer>
      ) : (
        <>
          <StudentAlertStrip
            studentName={studentQuery.data.full_name}
            alerts={alerts.data ?? []}
            className="mb-4"
          />
          <DetailShell
            name={studentQuery.data.full_name}
            facts={[
              {
                label: t('detail.facts.registrationNumber'),
                value: studentQuery.data.registration_number,
              },
              {
                label: t('detail.facts.class'),
                value: t('detail.facts.classValue', {
                  class: studentQuery.data.class_section.class.name,
                  section: studentQuery.data.class_section.section_name,
                }),
              },
              {
                label: t('detail.facts.roll'),
                value: formatNumber(studentQuery.data.roll_number, regionConfig),
              },
              ...(primaryGuardian
                ? [
                    {
                      label: t('detail.facts.primaryGuardian'),
                      value: primaryGuardian.phone
                        ? `${primaryGuardian.full_name} · ${formatPhone(primaryGuardian.phone, regionConfig)}`
                        : primaryGuardian.full_name,
                    },
                  ]
                : []),
            ]}
            statusBadge={
              <>
                <StatusBadge
                  domain="enrollment"
                  status={studentQuery.data.enrollment_status as EnrollmentStatus}
                />
                <PromotionOverrideBadge studentId={studentId} />
              </>
            }
            actions={[
              {
                id: 'edit',
                label: t('detail.actions.edit'),
                icon: <PencilIcon />,
                allowed: canUpdate,
                priority: 'secondary',
                onClick: () =>
                  void navigate({ to: '/students/$studentId/edit', params: { studentId } }),
              },
              // Secondary = a real button in the header (Tab-reachable), not
              // buried in "More actions". Status changes only via these events.
              {
                id: 'record-leaving',
                helpId: 'people.students.action.recordLeaving',
                label: t('detail.actions.recordLeaving'),
                icon: <LogOutIcon />,
                allowed: canManageLifecycle && isActive,
                priority: 'secondary',
                onClick: () => {
                  pendingFocus.current = { target: 'readmit', wasActive: true };
                  setLeaveDialogOpen(true);
                },
              },
              {
                id: 'readmit',
                helpId: 'people.students.action.readmit',
                label: t('detail.actions.readmit'),
                icon: <RotateCcwIcon />,
                allowed: canManageLifecycle && !isActive,
                priority: 'secondary',
                onClick: () => {
                  pendingFocus.current = { target: 'record-leaving', wasActive: false };
                  setReadmitDialogOpen(true);
                },
              },
              {
                id: 'collect-fees',
                helpId: 'people.students.action.collectFees',
                label: t('detail.actions.collectFees'),
                icon: <HandCoinsIcon />,
                allowed: canCollectFees,
                priority: 'primary',
                onClick: () =>
                  void navigate({ to: '/payments/record', search: { student_id: studentId } }),
              },
              {
                id: 'send-reminder',
                label: t('detail.actions.sendReminder'),
                icon: <SendIcon />,
                allowed: canSendReminder,
                priority: 'tertiary',
                onClick: () => setReminderDialogOpen(true),
              },
              {
                id: 'print-id-card',
                label: t('detail.actions.printIdCard'),
                icon: <IdCardIcon />,
                allowed: canPrint,
                priority: 'tertiary',
                onClick: () =>
                  void navigate({
                    to: '/print/preview',
                    search: {
                      kind: 'STUDENT_ID_CARD',
                      subject_type: 'STUDENT',
                      ids: studentId,
                      from: `/students/${studentId}`,
                    },
                  }),
              },
              {
                id: 'delete',
                label: t('detail.actions.delete'),
                icon: <Trash2Icon />,
                allowed: canDelete,
                priority: 'destructive',
                onClick: () => setDeleteDialogOpen(true),
              },
              // Last on purpose: the 3rd secondary goes into More, keeping Edit and the
              // leave/readmit action inline (PageHeaderActions groups by priority).
              {
                id: 'messages',
                label: t('detail.actions.messages'),
                icon: <MessageSquareTextIcon />,
                allowed: canSeeMessages,
                priority: 'secondary',
                to: '/communications/message-log',
                search: { student: studentId },
              },
            ]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            tabs={[
              {
                id: 'overview',
                label: t('detail.tabs.overview'),
                content: <OverviewTab studentId={studentId} />,
              },
              {
                id: 'guardians',
                label: t('detail.tabs.guardians'),
                content: <GuardiansTab studentId={studentId} />,
              },
              {
                id: 'enrollment',
                label: t('detail.tabs.enrollment'),
                content: (
                  <EnrollmentTab
                    studentId={studentId}
                    studentName={studentQuery.data.full_name}
                    enrollmentStatus={studentQuery.data.enrollment_status}
                  />
                ),
              },
              {
                id: 'attendance',
                label: t('detail.tabs.attendance'),
                content: <AttendanceTab studentId={studentId} />,
              },
              {
                id: 'results',
                // [19.9.1] — 'exams' namespace: exam-owned, mounted here.
                label: t('detail.tabs.results', { ns: 'exams' }),
                content: <ResultsPanel studentId={studentId} />,
              },
              {
                id: 'homework',
                label: t('detail.tabs.homework'),
                content: <HomeworkTab studentId={studentId} />,
              },
              {
                id: 'subject-choices',
                // [19.6.1] — 'exams' namespace, not 'students': this tab
                // is the fourth-subject picker, owned by the exams
                // feature even though it's mounted on student detail.
                label: t('detail.tabs.fourthSubject', { ns: 'exams' }),
                content: <SubjectChoicesPanel studentId={studentId} />,
              },
              {
                id: 'programs',
                // [34.5.1] — 'programs' namespace, same pattern as above.
                label: t('detail.tabs.programs', { ns: 'programs' }),
                content: (
                  <ProgramsPanel
                    studentId={studentId}
                    enrolOpen={search.enrolProgram === '1'}
                    onEnrolOpenChange={(open) => setKey('enrolProgram', open ? '1' : undefined)}
                    recordEnrollmentId={search.recordMilestone}
                    onRecordChange={(id) => setKey('recordMilestone', id)}
                  />
                ),
              },
              ...(canViewPerformance
                ? [
                    {
                      id: 'performance',
                      label: tPerformance('title'),
                      content: (
                        <PerformanceTab
                          studentId={studentId}
                          subjectName={studentQuery.data.full_name}
                        />
                      ),
                    },
                  ]
                : []),
              {
                id: 'fees',
                label: t('detail.tabs.fees'),
                content: <FeesTab studentId={studentId} />,
              },
              {
                id: 'fines',
                label: t('detail.tabs.fines'),
                content: (
                  <FinesTab
                    studentId={studentId}
                    logOpen={search.logFine === '1'}
                    onLogOpenChange={(open) => setKey('logFine', open ? '1' : undefined)}
                  />
                ),
              },
              {
                id: 'recurring-fees',
                label: t('detail.tabs.recurringFees'),
                content: <RecurringFeesTab studentId={studentId} />,
              },
              {
                id: 'payments',
                label: t('detail.tabs.payments'),
                content: <PaymentsTab studentId={studentId} />,
              },
              {
                id: 'invoices',
                label: t('detail.tabs.invoices'),
                content: <InvoicesTab studentId={studentId} />,
              },
              {
                id: 'communication',
                label: t('detail.tabs.communication'),
                content: <CommunicationTab studentId={studentId} />,
              },
              ...(canReadNotes
                ? [
                    {
                      id: 'notes',
                      label: t('detail.tabs.notes'),
                      content: <NotesTab studentId={studentId} />,
                    },
                  ]
                : []),
              ...(canReadRecords
                ? [
                    {
                      id: 'records',
                      label: t('detail.tabs.records'),
                      content: <RecordsTab studentId={studentId} />,
                    },
                  ]
                : []),
              ...(canPrint || canIssueCertificate || canReadRegister
                ? [
                    {
                      id: 'documents',
                      label: t('detail.tabs.documents'),
                      content: <DocumentsTab studentId={studentId} />,
                    },
                  ]
                : []),
              ...(canManageApplications
                ? [
                    {
                      id: 'applications',
                      label: t('detail.tabs.applications'),
                      content: (
                        <SubjectApplicationsTab
                          subject={{ kind: 'STUDENT', studentId }}
                          subjectName={studentQuery.data.full_name}
                          ns="students"
                        />
                      ),
                    },
                  ]
                : []),
              {
                id: 'activity',
                label: t('detail.tabs.activity'),
                content: <ActivityTab studentId={studentId} />,
              },
            ]}
          />

          <SendReminderDialog
            open={reminderDialogOpen}
            onOpenChange={setReminderDialogOpen}
            studentIds={[studentId]}
            onSent={() => {
              // The dialog already closes itself on success — a single
              // student's reminder leaves nothing else (no selection) to
              // clear the way the list page's bulk send does.
            }}
          />
          {search.issue !== undefined && canIssueCertificate ? (
            <IssueCertificateModal
              studentId={studentId}
              initialKind={search.issue === 'pick' ? undefined : search.issue}
              onClose={closeIssue}
              onRecordLeaving={() =>
                void navigateSearch({
                  search: (p) => ({ ...p, issue: undefined, step: undefined, leave: '1' as const }),
                  replace: true,
                })
              }
            />
          ) : null}
          <LeaveDialog
            open={leaveDialogOpen}
            onOpenChange={setLeaveDialogOpen}
            studentId={studentId}
            studentName={studentQuery.data.full_name}
          />
          <ReadmitDialog
            open={readmitDialogOpen}
            onOpenChange={setReadmitDialogOpen}
            studentId={studentId}
            studentName={studentQuery.data.full_name}
          />
          <DeleteStudentDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            studentId={studentId}
            studentName={studentQuery.data.full_name}
            onDeleted={() => void navigate({ to: '/students' })}
          />
        </>
      )}
    </RegionConfigProvider>
  );
}

function StudentDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
