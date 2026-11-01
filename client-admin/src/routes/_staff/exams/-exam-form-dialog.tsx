/**
 * Create/edit exam dialog — [19.6.1]. Same "owns its own mutation" +
 * form-shell error-surfacing shape as `classes/-class-form-dialog.tsx`.
 *
 * Academic year and class are create-only, mirroring `ClassFormDialog`'s
 * own academic-year rule — `UpdateExamDto` technically accepts both, but
 * `ExamsService.update` rejects the change once any Mark exists, so
 * offering it as an edit-mode field would mostly just surface that 400.
 * Changing an exam's class/year after creation is out of this ticket's
 * scope.
 */
import { ExamKind } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DatePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  HelpHint,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@biddaloy/ui/components';
import { useAcademicYears, useClasses, useCreateExam, useUpdateExam } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, parseServerDate, toIsoDate } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { examTemplatesQueryOptions } from './-use-exam-templates';

export interface ExamFormInitialValues {
  name: string;
  kind: ExamKind;
  mark_entry_deadline?: string | null;
}

export interface ExamFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  examId?: string;
  initialValues?: ExamFormInitialValues;
  defaultAcademicYearId?: string;
  /** Prefills the template select (palette "Create exam from template", #1289). */
  defaultTemplateId?: string;
  onSaved: () => void;
}

function FieldLabel({
  required,
  children,
  helpId,
  ...props
}: React.ComponentProps<typeof Label> & { required?: boolean; helpId?: string }) {
  // Asterisk via CSS content: visual only, so the label text stays exactly the field name.
  return (
    <Label
      {...props}
      helpId={helpId}
      className={required ? "after:ms-0.5 after:text-destructive after:content-['*']" : undefined}
    >
      {children}
    </Label>
  );
}

const EMPTY_VALUES: ExamFormInitialValues = { name: '', kind: ExamKind.TERM };
const NO_TEMPLATE = '__none__';
const EXAM_KINDS = Object.values(ExamKind);

export function ExamFormDialog({
  open,
  onOpenChange,
  mode,
  examId,
  initialValues,
  defaultAcademicYearId,
  defaultTemplateId,
  onSaved,
}: ExamFormDialogProps) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const { t: tt } = useTranslation('examsTemplateField');
  const academicYearsQuery = useAcademicYears({ limit: 100 });
  const createExam = useCreateExam();
  const updateExam = useUpdateExam(examId ?? '');
  const mutation = mode === 'create' ? createExam : updateExam;

  const [name, setName] = React.useState(initialValues?.name ?? '');
  const [kind, setKind] = React.useState<ExamKind>(initialValues?.kind ?? ExamKind.TERM);
  const [deadline, setDeadline] = React.useState<Date | undefined>(
    initialValues?.mark_entry_deadline
      ? parseServerDate(initialValues.mark_entry_deadline)
      : undefined,
  );
  const [academicYearId, setAcademicYearId] = React.useState(defaultAcademicYearId ?? '');
  const [classId, setClassId] = React.useState('');
  const [templateId, setTemplateId] = React.useState(defaultTemplateId ?? NO_TEMPLATE);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  // Only fetched while the create dialog is open (the parent is EXAM_MANAGE-gated).
  const templatesQuery = useQuery({
    ...examTemplatesQueryOptions(),
    enabled: open && mode === 'create',
  });
  const templates = templatesQuery.data ?? [];

  const classesQuery = useClasses(
    { academic_year_id: academicYearId },
    { enabled: !!academicYearId },
  );

  // [2622] A sync double-click can fire before `isPending` re-renders; this closes the gap.
  // Reopening calls `mutation.reset()`, which drops the pending `onSettled`, so it clears this too.
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const values = initialValues ?? EMPTY_VALUES;
    setName(values.name);
    setKind(values.kind);
    setDeadline(
      values.mark_entry_deadline ? parseServerDate(values.mark_entry_deadline) : undefined,
    );
    setAcademicYearId(defaultAcademicYearId ?? '');
    setClassId('');
    setTemplateId(defaultTemplateId ?? NO_TEMPLATE);
    setValidationError(null);
    mutation.reset();
    inFlight.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    if (!name.trim()) {
      setValidationError(t('examForm.errorNameRequired'));
      return;
    }
    if (mode === 'create' && (!academicYearId || !classId)) {
      setValidationError(t('examForm.errorAcademicYearClassRequired'));
      return;
    }
    setValidationError(null);
    inFlight.current = true;
    const settled = () => {
      inFlight.current = false;
    };

    if (mode === 'create') {
      const fromTemplate = templateId !== NO_TEMPLATE;
      createExam.mutate(
        {
          name: name.trim(),
          kind,
          academic_year_id: academicYearId,
          class_id: classId,
          ...(deadline ? { mark_entry_deadline: toIsoDate(deadline) } : {}),
          ...(fromTemplate ? { template_id: templateId } : {}),
        },
        {
          onSettled: settled,
          onSuccess: (exam) => {
            if (fromTemplate) {
              // `POST /exams` returns the Exam plus `components_created`.
              const count = (exam as { components_created?: number }).components_created ?? 0;
              if (count > 0)
                toast.success(tt('toast.created', { count, n: formatNumber(count, config) }));
              else toast.info(tt('toast.noRows'));
            }
            onSaved();
          },
        },
      );
    } else {
      updateExam.mutate(
        { name: name.trim(), kind, mark_entry_deadline: deadline ? toIsoDate(deadline) : null },
        { onSuccess: onSaved, onSettled: settled },
      );
    }
  }

  const title = mode === 'create' ? t('examForm.createTitle') : t('examForm.editTitle');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <div className="flex items-center gap-1">
              <DialogTitle>{title}</DialogTitle>
              {mode === 'edit' && <HelpHint helpId="examsResults.exams.action.edit" />}
            </div>
            <DialogDescription>{t('examForm.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="exam-form-name" required helpId="examsResults.exams.field.name">
              {t('examForm.nameLabel')}
            </FieldLabel>
            <Input
              id="exam-form-name"
              aria-required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('examForm.namePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="exam-form-kind" helpId="examsResults.exams.field.kind">
              {t('examForm.kindLabel')}
            </FieldLabel>
            <Select value={kind} onValueChange={(value) => setKind(value as ExamKind)}>
              <SelectTrigger id="exam-form-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXAM_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`kind.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="exam-form-deadline" helpId="examsResults.exams.field.deadline">
              {t('examForm.deadlineLabel')}
            </FieldLabel>
            <div className="flex items-center gap-2">
              <DatePicker
                id="exam-form-deadline"
                aria-label={t('examForm.deadlineLabel')}
                placeholder={t('examForm.deadlinePlaceholder')}
                config={config}
                value={deadline}
                onValueChange={setDeadline}
                clearable={false}
                className="min-h-11 flex-1 sm:min-h-9"
              />
              {deadline && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setDeadline(undefined)}
                >
                  {t('examForm.deadlineClear')}
                </Button>
              )}
            </div>
            <p className="text-caption text-text-secondary">{t('examForm.deadlineHelp')}</p>
          </div>

          {mode === 'create' && (
            <>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="exam-form-year" required>
                  {t('examForm.academicYearLabel')}
                </FieldLabel>
                <Select
                  value={academicYearId}
                  onValueChange={(value) => {
                    setAcademicYearId(value);
                    setClassId('');
                  }}
                >
                  <SelectTrigger id="exam-form-year" className="w-full">
                    <SelectValue placeholder={t('examForm.academicYearPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {academicYearsQuery.data?.data.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="exam-form-class" required>
                  {t('examForm.classLabel')}
                </FieldLabel>
                <Select value={classId} onValueChange={setClassId} disabled={!academicYearId}>
                  <SelectTrigger id="exam-form-class" className="w-full">
                    <SelectValue
                      placeholder={
                        academicYearId
                          ? t('examForm.classPlaceholder')
                          : t('examForm.classNeedsYear')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {classesQuery.data?.data.map((cls) => (
                      <SelectItem key={cls.id} value={cls.id}>
                        {cls.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {templates.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <FieldLabel
                    htmlFor="exam-form-template"
                    helpId="examsResults.exams.field.template"
                  >
                    {tt('label')}
                  </FieldLabel>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger id="exam-form-template" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEMPLATE}>{tt('none')}</SelectItem>
                      {templates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t(errorKey(mutation.error))}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t('examForm.saving') : t('examForm.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fixed sentence per server error code; never the server text (Rule 23). */
const ERROR_KEYS: Record<string, string> = {
  EXAM_PUBLISHED: 'examForm.errorPublished',
  EXAM_NAME_TAKEN: 'examForm.duplicateMessage',
  CLASS_HAS_NO_GRADE: 'examForm.errorClassNoGrade',
};

function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? (error.details?.code as string | undefined) : undefined;
  return (code && ERROR_KEYS[code]) || 'examForm.errorMessage';
}
