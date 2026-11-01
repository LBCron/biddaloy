import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import {
  createFineStructure,
  createGuardian,
  currentAcademicYear,
  post,
  type ApiSession,
} from '../api';
import { t } from '../i18n';

/**
 * [2656] Every create/send dialog that must send ONE request when its submit button is
 * double-clicked. A new create/send dialog adds an entry here (see 21-ui-patterns.md).
 * `double-submit.spec.ts` stays generic: each entry carries all its page knowledge.
 */
export interface DialogEntry {
  name: string;
  route: string;
  /** Create the data the dialog needs through the API, named with `suffix`. May return a
   * `route` that replaces the entry's own (for a detail page that only exists after prepare). */
  prepare?(
    request: APIRequestContext,
    session: ApiSession,
    suffix: string,
  ): Promise<void | { route: string }>;
  /** Fill what the dialog needs, using `suffix` so every run creates unique data. */
  fill(page: Page, suffix: string): Promise<void>;
  /** Open the dialog (or reveal the form) before `fill`. */
  open(page: Page, suffix: string): Promise<void>;
  /** The submit button's translation key. */
  submitKey: string;
  /** The write request the double-click must send exactly once. */
  postUrl: RegExp;
  /** Web-first assertion that the submit finished (dialog closed / detail shown). */
  done(page: Page, suffix: string): Promise<void>;
}

/** Dialogs not covered yet, with the reason. Each material item is a follow-up issue. */
export const DEFERRED: { name: string; reason: string }[] = [
  {
    name: 'academic year',
    reason: 'start/end dates are picked in a calendar popover; needs a date-picker driver',
  },
  {
    name: 'new promotion',
    reason: 'needs a published exam with marks for the source class (heavy fixture)',
  },
  {
    name: 'fees/dues reminder',
    reason: 'same SendReminderDialog as the students-list reminder, which is covered',
  },
];

const dialogClosed = (page: Page) =>
  expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });

const addButton = (page: Page, key: string) =>
  page
    .getByRole('button', { name: t(key) })
    .first()
    .click();

export const REGISTRY: DialogEntry[] = [
  {
    name: 'program',
    route: '/programs',
    open: (page) => addButton(page, 'programs.actions.add'),
    fill: (page, suffix) =>
      page.getByLabel(new RegExp(t('programs.formDialog.nameLabel'))).fill(`Dbl program ${suffix}`),
    submitKey: 'programs.formDialog.save',
    postUrl: /\/api\/v1\/programs$/,
    done: dialogClosed,
  },
  {
    name: 'exam template',
    route: '/exams/templates',
    open: (page) => addButton(page, 'examTemplates.list.add'),
    fill: (page, suffix) =>
      page.getByLabel(new RegExp(t('examTemplates.form.nameLabel'))).fill(`Dbl template ${suffix}`),
    submitKey: 'examTemplates.form.save',
    postUrl: /\/api\/v1\/exam-templates$/,
    done: dialogClosed,
  },
  {
    name: 'shift',
    route: '/routines/setup',
    open: (page) => addButton(page, 'routines.shiftsPanel.addAction'),
    fill: (page, suffix) =>
      page
        .getByRole('dialog')
        .getByLabel(t('routines.shiftsPanel.name'))
        .fill(`Dbl shift ${suffix}`),
    submitKey: 'routines.shiftsPanel.dialogConfirm',
    postUrl: /\/api\/v1\/routines\/shifts$/,
    done: dialogClosed,
  },
  {
    name: 'class',
    route: '/classes',
    open: (page) => addButton(page, 'classes.list.addClass'),
    fill: async (page, suffix) => {
      await page
        .getByLabel(new RegExp(t('classes.classForm.nameLabel')))
        .fill(`Dbl class ${suffix}`);
      await page.locator('#class-form-year').click();
      await page.getByRole('option').first().click();
    },
    submitKey: 'classes.classForm.save',
    postUrl: /\/api\/v1\/classes$/,
    done: dialogClosed,
  },
  {
    name: 'exam',
    route: '/exams',
    prepare: async (request, session, suffix) => {
      const year = await post<{ id: string }>(request, session, '/academic-years', {
        name: `Dbl year ${suffix}`,
        start_date: '2031-01-01',
        end_date: '2031-12-31',
      });
      await post(request, session, '/classes', {
        name: `Dbl exam class ${suffix}`,
        academic_year_id: year.id,
      });
    },
    open: (page) => addButton(page, 'exams.list.addExam'),
    fill: async (page, suffix) => {
      await page.locator('#exam-form-name').fill(`Dbl exam ${suffix}`);
      await page.locator('#exam-form-year').click();
      await page.getByRole('option', { name: `Dbl year ${suffix}` }).click();
      await page.locator('#exam-form-class').click();
      await page.getByRole('option', { name: `Dbl exam class ${suffix}` }).click();
    },
    submitKey: 'exams.examForm.save',
    postUrl: /\/api\/v1\/exams$/,
    done: dialogClosed,
  },
  {
    name: 'single message',
    route: '/communications/send',
    prepare: async (request, session, suffix) => {
      const guardian = await createGuardian(request, session, `Dbl guardian ${suffix}`);
      const year = await post<{ id: string }>(request, session, '/academic-years', {
        name: `Dbl msg year ${suffix}`,
        start_date: '2032-01-01',
        end_date: '2032-12-31',
      });
      const klass = await post<{ id: string }>(request, session, '/classes', {
        name: `Dbl msg class ${suffix}`,
        academic_year_id: year.id,
      });
      const section = await post<{ id: string }>(
        request,
        session,
        `/classes/${klass.id}/sections`,
        {
          section_name: 'A',
        },
      );
      await post(request, session, '/students', {
        full_name: `Dbl student ${suffix}`,
        class_section_id: section.id,
        guardian_ids: [guardian.id],
      });
    },
    open: async () => undefined,
    fill: async (page, suffix) => {
      await page
        .getByRole('textbox', { name: t('communications.send.linkStudentTitle') })
        .fill(`Dbl student ${suffix}`);
      await page.getByRole('button', { name: new RegExp(`Dbl student ${suffix}`) }).click();
      await page.getByRole('radio', { name: new RegExp(`Dbl guardian ${suffix}`) }).click();
      await page
        .getByRole('textbox', { name: t('communications.send.messageLabel') })
        .fill('Dbl message');
      await page
        .getByRole('button', { name: t('communications.send.submit'), exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
    submitKey: 'communications.send.confirmSend',
    postUrl: /\/api\/v1\/communications\/send$/,
    done: dialogClosed,
  },
  {
    name: 'students-list reminder',
    route: '/students',
    open: async (page) => {
      await page.getByRole('row').nth(1).getByRole('checkbox').check();
      await addButton(page, 'students.list.sendReminder');
    },
    fill: (page) =>
      page
        .getByRole('dialog')
        .getByRole('textbox', { name: t('students.sendReminderDialog.messageLabel') })
        .fill('Dbl reminder'),
    submitKey: 'students.sendReminderDialog.send',
    postUrl: /\/api\/v1\/communications\/reminder\/bulk$/,
    done: dialogClosed,
  },
  {
    name: 'fine rule',
    route: '/fees/fines/rules',
    prepare: async (request, session, suffix) => {
      const year = await currentAcademicYear(request, session);
      await createFineStructure(
        request,
        session,
        { academicYearId: year.id, classId: '', sectionId: '', className: '' },
        `Dbl fine ${suffix}`,
        50,
      );
      // A fresh class keeps the (year, trigger, class) rule unique, so the save is not a 409.
      await post(request, session, '/classes', {
        name: `Dbl fine class ${suffix}`,
        academic_year_id: year.id,
      });
    },
    open: (page) => addButton(page, 'fees.fines.rules.addRule'),
    fill: async (page, suffix) => {
      await page.locator('#fine-rule-fee').click();
      await page.getByRole('option', { name: new RegExp(`Dbl fine ${suffix}`) }).click();
      await page.locator('#fine-rule-class').click();
      await page.getByRole('option', { name: `Dbl fine class ${suffix}` }).click();
    },
    submitKey: 'fees.fines.rules.form.save',
    postUrl: /\/api\/v1\/fees\/fine-rules$/,
    done: dialogClosed,
  },
  {
    name: 'section',
    route: '/classes',
    prepare: async (request, session, suffix) => {
      const year = await currentAcademicYear(request, session);
      const klass = await post<{ id: string }>(request, session, '/classes', {
        name: `Dbl sec class ${suffix}`,
        academic_year_id: year.id,
      });
      return { route: `/classes/${klass.id}` };
    },
    open: async (page) => {
      await addButton(page, 'classes.sections.addSection');
    },
    fill: (page) =>
      page
        .getByRole('dialog')
        .getByLabel(new RegExp(t('classes.sectionForm.nameLabel')))
        .fill('A'),
    submitKey: 'classes.sectionForm.save',
    postUrl: /\/api\/v1\/classes\/[0-9a-f-]+\/sections$/,
    done: dialogClosed,
  },
  {
    name: 'homework reassign',
    route: '/academics/homework',
    // [#1013] A homework with one live assignment row; the dialog is prefilled from it.
    prepare: async (request, session, suffix) => {
      const year = await currentAcademicYear(request, session);
      const klass = await post<{ id: string }>(request, session, '/classes', {
        name: `Dbl hw class ${suffix}`,
        academic_year_id: year.id,
      });
      const section = await post<{ id: string }>(
        request,
        session,
        `/classes/${klass.id}/sections`,
        { section_name: 'A' },
      );
      const subject = await post<{ id: string }>(request, session, '/subjects', {
        code: `HW${suffix}`.slice(0, 20),
        name_en: `Dbl hw ${suffix}`,
      });
      const homework = await post<{ id: string }>(request, session, '/homework', {
        class_id: klass.id,
        subject_id: subject.id,
        title: `Dbl hw ${suffix}`,
        grading_mode: 'TICK',
      });
      await post(request, session, `/homework/${homework.id}/assign`, {
        section_id: section.id,
        assigned_date: '2026-01-01',
        due_date: '2026-01-08',
      });
      return { route: `/academics/homework/${homework.id}` };
    },
    open: (page) =>
      page
        .getByRole('button', {
          name: t('homework.detail.assignments.reassign', {
            target: t('homework.detail.assignments.sectionTarget', { section: 'A' }),
          }),
        })
        .first()
        .click(),
    fill: async () => {}, // prefilled from the row
    submitKey: 'common.actions.save',
    postUrl: /\/api\/v1\/homework-assignments\/[0-9a-f-]+\/reassign$/,
    done: dialogClosed,
  },
  {
    name: 'student',
    route: '/students/new',
    // [2683] Its own class and section, picked by name: the first option may be another
    // entry's class with no sections, or another worker's data.
    prepare: async (request, session, suffix) => {
      const year = await currentAcademicYear(request, session);
      const klass = await post<{ id: string }>(request, session, '/classes', {
        name: `Dbl student class ${suffix}`,
        academic_year_id: year.id,
      });
      await post(request, session, `/classes/${klass.id}/sections`, { section_name: 'A' });
    },
    open: async () => undefined,
    fill: async (page, suffix) => {
      await page
        .getByLabel(new RegExp(`^${t('students.form.fields.fullName')}`))
        .fill(`Dbl student ${suffix}`);
      await page.getByLabel(t('students.form.fields.class')).click();
      await page.getByRole('option', { name: `Dbl student class ${suffix}` }).click();
      await page.getByLabel(t('students.form.fields.section')).click();
      await page.getByRole('option', { name: 'A', exact: true }).click();
    },
    submitKey: 'students.new.submitAction',
    postUrl: /\/api\/v1\/students$/,
    done: (page) => expect(page).toHaveURL(/\/students\/[0-9a-f-]{36}/, { timeout: 15_000 }),
  },
];
