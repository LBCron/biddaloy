import { Permission } from '@biddaloy/shared';
import {
  Button,
  HelpHint,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  RowActions,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useClassSections,
  useCoordinators,
  useHasPermission,
  useSectionTeachers,
  useUnassignTeacher,
  type ClassSectionWithCount,
  type SectionTeacherAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { UserPlusIcon, UsersIcon } from 'lucide-react';
import * as React from 'react';

import { AssignTeacherDialog, sortByAssignmentType } from '../-assign-teacher-dialog';
import { CoordinatorsTable } from '../../staff/-coordinators-table';

import { TabQueryState } from './tab-query-state';

export interface TeachersTabProps {
  classId: string;
}

/** [29.0] Was read-only (teacher CRUD is still #177 — this tab never
 * creates/edits `Teacher` entities). Now assign/remove of section teacher
 * *assignments* lives here: one section can have one class-teacher and any
 * number of subject-teachers, so the tab is organized per-section (via
 * `useClassSections`) rather than as one class-wide roster — each section
 * gets its own `useSectionTeachers` query and its own Assign button, wired
 * to the shared `useAssignTeacher`/`useUnassignTeacher` hooks and
 * `AssignTeacherDialog` from wave 2. */
export function TeachersTab({ classId }: TeachersTabProps) {
  const { t } = useTranslation('classes');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const sectionsQuery = useClassSections(classId);
  const [assigningSection, setAssigningSection] = React.useState<ClassSectionWithCount | null>(
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <TabQueryState
        query={sectionsQuery}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.teachers.errorMessage')}
      >
        {(sections) =>
          sections.length === 0 ? (
            <EmptyState
              icon={<UsersIcon aria-hidden="true" />}
              title={t('detail.teachers.emptyMessage')}
              explanation={t('detail.teachers.emptyExplanation')}
            />
          ) : (
            sections.map((section) => (
              <SectionTeachersPanel
                key={section.id}
                classId={classId}
                section={section}
                canManage={canManage}
                onAssign={() => setAssigningSection(section)}
              />
            ))
          )
        }
      </TabQueryState>

      {canManage && <ClassCoordinatorsBlock classId={classId} />}

      {canManage && assigningSection && (
        <AssignDialogForSection
          classId={classId}
          section={assigningSection}
          onClose={() => setAssigningSection(null)}
        />
      )}
    </div>
  );
}

/**
 * [83.3.3] D32: who coordinates this class. Read-only here (assign and remove live on
 * Teaching assignments › Coordinators). Hidden when the class has none. `GET /coordinators`
 * needs CLASS_MANAGE, so the caller renders it for that permission only.
 */
function ClassCoordinatorsBlock({ classId }: { classId: string }) {
  const { t } = useTranslation('classes');
  const query = useCoordinators({ classId });
  if (!query.isError && (query.data?.length ?? 0) === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-h3">{t('detail.teachers.coordinators.title')}</h3>
      <CoordinatorsTable
        tableId={`class-coordinators-${classId}`}
        caption={t('detail.teachers.coordinators.caption')}
        rows={query.data}
        loading={query.isLoading}
        fetching={query.isFetching}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        hideClass
        emptyState={{
          title: t('detail.teachers.coordinators.title'),
          explanation: t('detail.teachers.coordinators.caption'),
        }}
      />
    </section>
  );
}

/** Reads the section's current class teacher from the already-cached
 * `useSectionTeachers` query (same key as the panel's — no extra request). */
function AssignDialogForSection({
  classId,
  section,
  onClose,
}: {
  classId: string;
  section: ClassSectionWithCount;
  onClose: () => void;
}) {
  const query = useSectionTeachers(classId, section.id);
  const current = query.data?.find((a) => a.assignment_type === 'CLASS_TEACHER');
  return (
    <AssignTeacherDialog
      open
      onOpenChange={(open) => !open && onClose()}
      classId={classId}
      sectionId={section.id}
      currentClassTeacher={current && { teacherId: current.teacher_id, name: current.full_name }}
      onAssigned={onClose}
    />
  );
}

interface SectionTeachersPanelProps {
  classId: string;
  section: ClassSectionWithCount;
  canManage: boolean;
  onAssign: () => void;
}

function SectionTeachersPanel({
  classId,
  section,
  canManage,
  onAssign,
}: SectionTeachersPanelProps) {
  const { t } = useTranslation('classes');
  const query = useSectionTeachers(classId, section.id);
  const unassignTeacher = useUnassignTeacher(classId, section.id);
  const [removing, setRemoving] = React.useState<SectionTeacherAssignment | null>(null);
  // [47.4.1] Label comes from assignment_type, never subject nullness.
  const roleLabel = (a: SectionTeacherAssignment) =>
    a.assignment_type === 'SUBJECT_TEACHER' && a.subject_name
      ? `${t('assignmentType.SUBJECT_TEACHER')} · ${a.subject_name}`
      : t(`assignmentType.${a.assignment_type}`);

  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h3">{section.section_name}</h3>
        {canManage && (
          <span className="inline-flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              onClick={onAssign}
              aria-label={t('detail.teachers.assignAria', { section: section.section_name })}
            >
              <UserPlusIcon aria-hidden="true" />
              {t('detail.teachers.assign')}
            </Button>
            <HelpHint helpId="academics.classes.action.assignTeacher" />
          </span>
        )}
      </div>

      {query.isPending && (
        <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-6 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="mt-3">
          <ErrorState
            message={t('detail.teachers.errorMessage')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void query.refetch()}
          />
        </div>
      )}

      {unassignTeacher.isError && (
        <p role="alert" className="mt-3 text-caption text-destructive">
          {t('detail.teachers.removeError')}
        </p>
      )}

      {query.data &&
        (query.data.length === 0 ? (
          <p className="mt-3 text-text-secondary">{t('detail.teachers.emptySectionMessage')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-subtle">
            {sortByAssignmentType(query.data).map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{assignment.full_name}</p>
                  <p className="text-caption text-text-secondary">{roleLabel(assignment)}</p>
                </div>
                <RowActions
                  actions={[
                    {
                      intent: 'remove',
                      label: t('detail.teachers.remove'),
                      onClick: () => setRemoving(assignment),
                      allowed: canManage,
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        ))}

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          tone="danger"
          title={t('detail.teachers.removeConfirmTitle')}
          description={t('detail.teachers.removeConfirmDescription', {
            name: removing.full_name,
            section: section.section_name,
          })}
          confirmLabel={t('detail.teachers.remove')}
          busy={unassignTeacher.isPending}
          onConfirm={() =>
            unassignTeacher.mutate(removing.id, { onSettled: () => setRemoving(null) })
          }
        />
      )}
    </div>
  );
}
