/**
 * [83.3.3] "Assign coordinator" (Epic 83 D13, D21). One teacher, one or more classes of the
 * current year, optional subject: blank subject = class coordinator, a subject = subject
 * coordinator. Cloned from `classes/-assign-teacher-dialog.tsx` (same `Field`, `Combobox`,
 * close guard). A duplicate shows the server's fixed 409 sentence beside Save.
 *
 * Opened by the Coordinators tab button and by the palette action `coordinators.assign`
 * (`?tab=coordinators&assign=1`).
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MultiCombobox,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useAllClasses,
  useAllSubjects,
  useAllTeachers,
  useAssignCoordinators,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { ErrorText, Field, useCloseGuard } from '../classes/-dialog-kit';

export interface AssignCoordinatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Staff detail: prefill the teacher (still changeable). */
  teacherId?: string | undefined;
  onAssigned?: () => void;
}

export function AssignCoordinatorDialog({
  open,
  onOpenChange,
  teacherId: initialTeacherId,
  onAssigned,
}: AssignCoordinatorDialogProps) {
  const { t, i18n } = useTranslation('teacherAssignments');
  const teachersQuery = useAllTeachers({ enabled: open });
  const subjectsQuery = useAllSubjects({ is_active: true });
  const yearsQuery = useAcademicYears();
  const currentYearId = yearsQuery.data?.data.find((y) => y.is_current)?.id;
  // D3/D14: current-year classes only; the server refuses any other year with a 422.
  const classesQuery = useAllClasses({
    ...(currentYearId ? { academicYearId: currentYearId } : {}),
    enabled: open && yearsQuery.isSuccess,
  });
  const assign = useAssignCoordinators();

  const [teacherId, setTeacherId] = React.useState<string | null>(initialTeacherId ?? null);
  const [classIds, setClassIds] = React.useState<string[]>([]);
  const [subjectId, setSubjectId] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTeacherId(initialTeacherId ?? null);
    setClassIds([]);
    setSubjectId(null);
    setValidationError(null);
    assign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const isDirty =
    teacherId !== (initialTeacherId ?? null) || classIds.length > 0 || subjectId !== null;
  const { requestClose, discardDialog } = useCloseGuard(isDirty, assign.isPending, onOpenChange);

  const teacherOptions = (teachersQuery.data ?? []).map((teacher) => ({
    value: teacher.id,
    label: `${teacher.user.full_name} (${teacher.employee_id})`,
  }));
  const classOptions = (classesQuery.data ?? []).map((klass) => ({
    value: klass.id,
    label: klass.name,
  }));
  // No subject chosen = class coordinator (the placeholder says so).
  const subjectOptions = (subjectsQuery.data ?? []).map((subject) => ({
    value: subject.id,
    label: `${i18n.language === 'bn' && subject.name_bn ? subject.name_bn : subject.name_en} (${subject.code})`,
  }));

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (assign.isPending) return;
    if (!teacherId) {
      setValidationError(t('assignCoordinatorDialog.errorTeacherRequired'));
      return;
    }
    if (classIds.length === 0) {
      setValidationError(t('assignCoordinatorDialog.errorClassesRequired'));
      return;
    }
    setValidationError(null);
    assign.mutate(
      { teacherId, classIds, ...(subjectId ? { subjectId } : {}) },
      {
        onSuccess: () => {
          toast.success(t('assignCoordinatorDialog.savedToast'));
          onOpenChange(false);
          onAssigned?.();
        },
      },
    );
  }

  const apiError = assign.error instanceof ApiError ? assign.error : null;
  const duplicate = assign.isError && apiError?.statusCode === 409;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
        <DialogContent size="md" onInteractOutside={(e) => e.preventDefault()}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t('assignCoordinatorDialog.title')}</DialogTitle>
              <DialogDescription>{t('assignCoordinatorDialog.description')}</DialogDescription>
            </DialogHeader>

            <Field id="assign-coordinator-teacher" label={t('fields.teacher')} required>
              <Combobox
                id="assign-coordinator-teacher"
                aria-label={t('fields.teacher')}
                options={teacherOptions}
                value={teacherId}
                onValueChange={setTeacherId}
                placeholder={t('assignCoordinatorDialog.teacherPlaceholder')}
              />
            </Field>

            <Field id="assign-coordinator-classes" label={t('fields.coordinatorClasses')} required>
              <MultiCombobox
                id="assign-coordinator-classes"
                aria-label={t('fields.coordinatorClasses')}
                options={classOptions}
                value={classIds}
                onValueChange={setClassIds}
                placeholder={t('assignCoordinatorDialog.classesPlaceholder')}
                max={50}
              />
            </Field>

            <Field id="assign-coordinator-subject" label={t('fields.coordinatorSubject')}>
              <Combobox
                id="assign-coordinator-subject"
                aria-label={t('fields.coordinatorSubject')}
                options={subjectOptions}
                value={subjectId}
                onValueChange={(value) => setSubjectId(value ?? null)}
                placeholder={t('assignCoordinatorDialog.subjectNone')}
              />
            </Field>

            {validationError && <ErrorText>{validationError}</ErrorText>}
            {assign.isError && (
              <ErrorText>
                {duplicate
                  ? t('assignCoordinatorDialog.errorDuplicate')
                  : t('assignCoordinatorDialog.errorGeneric')}
              </ErrorText>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={assign.isPending}
                onClick={requestClose}
              >
                {t('assignCoordinatorDialog.cancel')}
              </Button>
              <Button type="submit" loading={assign.isPending}>
                {assign.isPending
                  ? t('assignCoordinatorDialog.saving')
                  : t('assignCoordinatorDialog.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {discardDialog}
    </>
  );
}
