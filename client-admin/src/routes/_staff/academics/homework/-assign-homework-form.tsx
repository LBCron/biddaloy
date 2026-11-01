/**
 * [22.4.1] One form, three modes: `create` builds a new Homework + its first
 * assignment in one submit; `assign` (used from the detail page's dialog)
 * only assigns an existing homework to another section/student; `reassign`
 * (#1013) is `assign` prefilled from an existing row, saved over it. Local
 * `useState`, not FormShell — same reasoning `-year-form-dialog.tsx`'s
 * header gives for a short field count.
 */
import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  Button,
  HelpHint,
  Card,
  DatePicker,
  DialogClose,
  Input,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useAllStudents,
  useClasses,
  useClassSections,
  useClassSubjects,
  type AssignHomeworkInput,
  type CreateHomeworkInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseServerDate } from '@biddaloy/ui/utils';
import { CircleAlert } from 'lucide-react';
import * as React from 'react';

import { subjectName } from './-subject-name';

export type AssignHomeworkFormMode = 'create' | 'assign' | 'reassign';

export interface AssignHomeworkFormInitial {
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  /** reassign: the row's student, if it targets one. */
  studentId?: string;
  /** reassign: the held student's name, shown if they are not in the loaded page. */
  studentName?: string;
  /** reassign: ISO `YYYY-MM-DD` dates of the row being changed. */
  assignedDate?: string;
  dueDate?: string;
}

export interface AssignHomeworkFormSubmitPayload {
  homework?: CreateHomeworkInput;
  assignment: AssignHomeworkInput;
}

export interface AssignHomeworkFormProps {
  mode: AssignHomeworkFormMode;
  /** create: optional prefill from search params. assign: `classId` is
   * REQUIRED and fixed (the homework's own class). */
  initial?: AssignHomeworkFormInitial;
  isPending: boolean;
  /** Caller-supplied message, rendered in a `role="alert"` block. */
  error?: string;
  /** Put on the `<form id>` so a footer button outside it can `form=`-submit. */
  formId?: string;
  /** Fires when anything has been typed/picked (create mode: the page's `dirty`). */
  onDirtyChange?: (dirty: boolean) => void;
  /** The host renders the submit button (a FullPageShell footer). */
  hideFooter?: boolean;
  onSubmit: (payload: AssignHomeworkFormSubmitPayload) => void;
}

type Target = 'section' | 'student';

/** `date.toISOString().slice(0, 10)` converts to UTC first, which in any
 * timezone ahead of UTC can roll the date back a day — see
 * `-year-form-dialog.tsx:65` for the same fix. Copied per-file rather than
 * extracted, following that file's own precedent. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function Required() {
  const { t } = useTranslation('homework');
  return (
    <>
      <span className="text-destructive" aria-hidden="true">
        *
      </span>
      <span className="sr-only">{t('form.required')}</span>
    </>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1 text-caption text-destructive">
      <CircleAlert className="size-3.5" aria-hidden="true" />
      {message}
    </p>
  );
}

export function AssignHomeworkForm({
  mode,
  initial,
  isPending,
  error,
  formId,
  onDirtyChange,
  hideFooter = false,
  onSubmit,
}: AssignHomeworkFormProps) {
  const { t, i18n } = useTranslation('homework');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();

  const [classId, setClassId] = React.useState(initial?.classId ?? '');
  const [subjectId, setSubjectId] = React.useState(initial?.subjectId ?? '');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [gradingMode, setGradingMode] = React.useState<string>(HomeworkGradingMode.TICK);

  const [target, setTarget] = React.useState<Target>(initial?.studentId ? 'student' : 'section');
  const [sectionId, setSectionId] = React.useState(initial?.sectionId ?? '');
  const [studentId, setStudentId] = React.useState(initial?.studentId ?? '');

  const today = React.useMemo(() => new Date(), []);
  const [assignedDate, setAssignedDate] = React.useState<Date | undefined>(() =>
    initial?.assignedDate ? parseServerDate(initial.assignedDate) : today,
  );
  const [dueDate, setDueDate] = React.useState<Date | undefined>(() =>
    initial?.dueDate ? parseServerDate(initial.dueDate) : addDays(today, 7),
  );

  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<
      Record<
        'class' | 'subject' | 'title' | 'section' | 'student' | 'assignedDate' | 'dueDate',
        string
      >
    >
  >({});

  // Prefilled values (search params) are not "typed", so compare to them.
  const dirty =
    classId !== (initial?.classId ?? '') ||
    subjectId !== (initial?.subjectId ?? '') ||
    sectionId !== (initial?.sectionId ?? '') ||
    studentId !== '' ||
    gradingMode !== HomeworkGradingMode.TICK ||
    target !== 'section' ||
    (assignedDate !== undefined && toLocalDateString(assignedDate) !== toLocalDateString(today)) ||
    (dueDate !== undefined &&
      toLocalDateString(dueDate) !== toLocalDateString(addDays(today, 7))) ||
    title.trim() !== '' ||
    description.trim() !== '';
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const classesQuery = useClasses();
  const selectedClass = classesQuery.data?.data.find((klass) => klass.id === classId);
  const classSubjectsQuery = useClassSubjects(
    mode === 'create' ? classId || undefined : undefined,
    selectedClass?.academic_year_id,
  );
  const sectionsQuery = useClassSections(classId || undefined);
  // Every page of the section (a page is capped at 100): a student past the first page must
  // still be pickable, not silently missing from the select (#3173).
  const studentsQuery = useAllStudents(sectionId !== '' ? { section_id: sectionId } : {}, {
    enabled: target === 'student' && sectionId !== '',
  });
  const students = studentsQuery.data ?? [];

  // reassign: a student who moved to another class has a section this class does not list.
  // Clear it (and the student) so "Pick a section." asks for a new pick instead of a 400.
  React.useEffect(() => {
    if (mode !== 'reassign' || !sectionsQuery.data || sectionId === '') return;
    if (!sectionsQuery.data.some((s) => s.id === sectionId)) {
      setSectionId('');
      setStudentId('');
    }
  }, [mode, sectionsQuery.data, sectionId]);

  function handleClassChange(value: string) {
    setClassId(value);
    setSubjectId('');
    setSectionId('');
    setStudentId('');
  }

  function handleSectionChange(value: string) {
    setSectionId(value);
    setStudentId('');
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isPending) return;

    const errors: typeof fieldErrors = {};
    if (mode === 'create') {
      if (classId === '') errors.class = t('form.errorClass');
      if (subjectId === '') errors.subject = t('form.errorSubject');
      if (title.trim() === '') errors.title = t('form.errorTitle');
    }
    if (sectionId === '') errors.section = t('form.errorSection');
    if (target === 'student' && studentId === '') errors.student = t('form.errorStudent');
    if (!assignedDate) errors.assignedDate = t('form.errorDate');
    if (!dueDate) errors.dueDate = t('form.errorDate');
    else if (assignedDate && toLocalDateString(dueDate) < toLocalDateString(assignedDate)) {
      errors.dueDate = t('form.dueBeforeAssigned');
    }
    setFieldErrors(errors);
    // Every field that can be in error, in order; the date pickers' ids don't follow the key.
    const focusIds = {
      class: 'homework-form-class',
      subject: 'homework-form-subject',
      title: 'homework-form-title',
      section: 'homework-form-section',
      student: 'homework-form-student',
      assignedDate: 'homework-form-assigned',
      dueDate: 'homework-form-due',
    } as const;
    const first = (Object.keys(focusIds) as (keyof typeof focusIds)[]).find((key) => errors[key]);
    if (first) document.getElementById(focusIds[first])?.focus();
    if (Object.keys(errors).length > 0 || !assignedDate || !dueDate) return;

    const assignment: AssignHomeworkInput = {
      ...(target === 'student' ? { student_id: studentId } : { section_id: sectionId }),
      assigned_date: toLocalDateString(assignedDate),
      due_date: toLocalDateString(dueDate),
    };

    if (mode === 'create') {
      onSubmit({
        homework: {
          subject_id: subjectId,
          class_id: classId,
          title: title.trim(),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
          grading_mode: gradingMode as CreateHomeworkInput['grading_mode'],
        },
        assignment,
      });
      return;
    }

    onSubmit({ assignment });
  }

  const invalid = (key: keyof typeof fieldErrors) => ({
    'aria-invalid': fieldErrors[key] ? (true as const) : undefined,
    'aria-describedby': fieldErrors[key] ? `homework-form-${key}-error` : undefined,
  });

  const targetCard =
    'flex h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 md:h-8 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground';

  const whoFields = (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-1.5 md:col-span-2">
        <span className="inline-flex items-center gap-1">
          <span id="homework-form-target" className="text-label text-text-primary">
            {t('form.targetLabel')}
          </span>
          <HelpHint helpId="academics.homework.field.target" />
        </span>
        <RadioGroup
          aria-labelledby="homework-form-target"
          value={target}
          onValueChange={(value) => setTarget(value as Target)}
          className="grid grid-cols-2 gap-2 md:max-w-sm"
        >
          <label className={targetCard}>
            <RadioGroupItem value="section" />
            {t('form.target.section')}
          </label>
          <label className={targetCard}>
            <RadioGroupItem value="student" />
            {t('form.target.student')}
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="homework-form-section" className="text-label text-text-primary">
          {t('form.sectionLabel')} <Required />
        </label>
        <Select value={sectionId} onValueChange={handleSectionChange} disabled={classId === ''}>
          <SelectTrigger id="homework-form-section" {...invalid('section')}>
            <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {(sectionsQuery.data ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.section_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="homework-form-section-error" message={fieldErrors.section} />
      </div>

      {target === 'student' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="homework-form-student" className="text-label text-text-primary">
            {t('form.studentLabel')} <Required />
          </label>
          <Select value={studentId} onValueChange={setStudentId} disabled={sectionId === ''}>
            <SelectTrigger id="homework-form-student" {...invalid('student')}>
              <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {mode === 'reassign' &&
                studentId !== '' &&
                studentId === initial?.studentId &&
                initial.studentName &&
                !students.some((s) => s.id === studentId) && (
                  <SelectItem value={studentId}>{initial.studentName}</SelectItem>
                )}
              {students.map((student) => (
                <SelectItem key={student.id} value={student.id}>
                  {student.full_name} · {student.registration_number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id="homework-form-student-error" message={fieldErrors.student} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="homework-form-assigned" className="text-label text-text-primary">
          {t('form.assignedDateLabel')} <Required />
        </label>
        <DatePicker
          id="homework-form-assigned"
          aria-label={t('form.assignedDateLabel')}
          config={regionConfig}
          value={assignedDate}
          onValueChange={setAssignedDate}
          {...invalid('assignedDate')}
        />
        <FieldError id="homework-form-assignedDate-error" message={fieldErrors.assignedDate} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-1">
          <label htmlFor="homework-form-due" className="text-label text-text-primary">
            {t('form.dueDateLabel')} <Required />
          </label>
          <HelpHint helpId="academics.homework.field.dueDate" />
        </span>
        <DatePicker
          id="homework-form-due"
          aria-label={t('form.dueDateLabel')}
          config={regionConfig}
          value={dueDate}
          onValueChange={setDueDate}
          {...invalid('dueDate')}
        />
        <FieldError id="homework-form-dueDate-error" message={fieldErrors.dueDate} />
      </div>
    </div>
  );

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {mode === 'create' ? (
        <>
          <Card padded aria-labelledby="hw-what">
            <h2 id="hw-what" className="text-h2">
              {t('form.sectionWhat')}
            </h2>
            <p className="mt-1 text-text-secondary">{t('form.sectionWhatHint')}</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="homework-form-class" className="text-label text-text-primary">
                  {t('form.classLabel')} <Required />
                </label>
                <Select value={classId} onValueChange={handleClassChange}>
                  <SelectTrigger id="homework-form-class" {...invalid('class')}>
                    <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(classesQuery.data?.data ?? []).map((klass) => (
                      <SelectItem key={klass.id} value={klass.id}>
                        {klass.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="homework-form-class-error" message={fieldErrors.class} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="homework-form-subject" className="text-label text-text-primary">
                  {t('form.subjectLabel')} <Required />
                </label>
                <Select value={subjectId} onValueChange={setSubjectId} disabled={classId === ''}>
                  <SelectTrigger id="homework-form-subject" {...invalid('subject')}>
                    <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(classSubjectsQuery.data ?? []).map((cs) => (
                      <SelectItem key={cs.subject_id} value={cs.subject_id}>
                        {subjectName(cs.subject, i18n.language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="homework-form-subject-error" message={fieldErrors.subject} />
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label htmlFor="homework-form-title" className="text-label text-text-primary">
                  {t('form.titleLabel')} <Required />
                </label>
                <Input
                  id="homework-form-title"
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                  {...invalid('title')}
                />
                <FieldError id="homework-form-title-error" message={fieldErrors.title} />
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label htmlFor="homework-form-description" className="text-label text-text-primary">
                  {t('form.descriptionLabel')}
                </label>
                <Textarea
                  id="homework-form-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5 md:col-span-2">
                <span className="inline-flex items-center gap-1">
                  <label
                    htmlFor="homework-form-grading-mode"
                    className="text-label text-text-primary"
                  >
                    {t('form.gradingModeLabel')} <Required />
                  </label>
                  <HelpHint helpId="academics.homework.field.gradingMode" />
                </span>
                <Select value={gradingMode} onValueChange={setGradingMode}>
                  <SelectTrigger
                    id="homework-form-grading-mode"
                    aria-describedby="homework-form-grading-help"
                  >
                    <SelectValue placeholder={tCommon('form.selectPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(HomeworkGradingMode).map((mode_) => (
                      <SelectItem key={mode_} value={mode_}>
                        {t(`form.gradingMode.${mode_}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="homework-form-grading-help" className="text-caption text-text-secondary">
                  {t(`form.gradingModeHelp.${gradingMode}`)}
                </p>
              </div>
            </div>
          </Card>

          <Card padded aria-labelledby="hw-who">
            <h2 id="hw-who" className="text-h2">
              {t('form.sectionWho')}
            </h2>
            <p className="mt-1 text-text-secondary">{t('form.sectionWhoHint')}</p>
            <div className="mt-4">{whoFields}</div>
          </Card>
        </>
      ) : (
        whoFields
      )}

      {error !== undefined && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {mode !== 'create' && !hideFooter && (
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              {tCommon('actions.cancel')}
            </Button>
          </DialogClose>
          <Button type="submit" loading={isPending}>
            {mode === 'reassign' ? tCommon('actions.save') : t('form.assignSubmit')}
          </Button>
        </div>
      )}
    </form>
  );
}
