/** [Epic 42] Staff: add a staff member, then give them a teacher profile. */
import { expect } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

/** A person not yet on the staff list (set GUIDE_STAFF_NAME to re-run against the same DB). */
const NAME = process.env.GUIDE_STAFF_NAME ?? 'Nusrat Jahan';
const EMAIL = `${NAME.toLowerCase().replace(/\s+/g, '.')}@example.com`;
const EMPLOYEE_ID = process.env.GUIDE_STAFF_ID ?? 'T-2041';

gifTour(
  'staff: add member to teacher profile',
  { card: 'admin', file: 'staff-add-teacher.gif' },
  async (p) => {
    await p.goto('/staff');
    await expect(
      p.getByRole('heading', { level: 1, name: tr('staff', 'list.title') }),
    ).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr('staff', 'list.addUser') }).click();
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await beat(p);
    await dialog
      .getByLabel(tr('staff', 'addUser.nameLabel'))
      .pressSequentially(NAME, { delay: 40 });
    await dialog
      .getByLabel(tr('staff', 'addUser.emailLabel'))
      .pressSequentially(EMAIL, { delay: 25 });
    await dialog.getByRole('combobox', { name: tr('staff', 'addUser.roleLabel') }).click();
    await p.getByRole('option', { name: new RegExp(`^${tr('staff', 'roles.TEACHER')}`) }).click();
    await beat(p);
    await dialog.getByRole('button', { name: tr('staff', 'addUser.save') }).click();
    await expect(dialog).toBeHidden();
    await beat(p, 1000);
    // Teacher profile
    await p.getByRole('button', { name: tr('staff', 'list.promoteTeacher') }).click();
    const promote = p.getByRole('dialog', { name: tr('staff', 'teacherForm.promoteTitle') });
    await expect(promote).toBeVisible();
    await beat(p);
    await promote
      .getByRole('combobox', { name: tr('staff', 'teacherForm.memberLabel') })
      .pressSequentially(NAME.split(' ')[0], { delay: 60 });
    await p
      .getByRole('option', { name: new RegExp(NAME) })
      .first()
      .click();
    await beat(p);
    await promote
      .getByLabel(tr('staff', 'teacherForm.employeeIdLabel'))
      .pressSequentially(EMPLOYEE_ID, { delay: 60 });
    await promote
      .getByRole('checkbox', { name: tr('staff', 'teacherForm.designations.SUBJECT_TEACHER') })
      .check();
    await beat(p);
    await promote.getByRole('button', { name: tr('staff', 'teacherForm.promoteSave') }).click();
    await expect(promote).toBeHidden();
    await beat(p, 800);
  },
);
