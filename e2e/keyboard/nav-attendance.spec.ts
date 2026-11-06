import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Attendance (admin)', () => {
  test.use(loggedIn('admin'));

  test('attendance reports', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.attendanceReports'));
    await expectReachableInMain(page);
  });

  test('attendance register', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.attendanceRegister'));
    await expectReachableInMain(page);
  });

  test('staff attendance', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.staffAttendance'));
    await expectReachableInMain(page);
  });

  test('attendance uploads', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.uploads'));
    await expectReachableInMain(page);
    // [76.5.08] The Uploads list's primary task is the upload wizard.
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('attendanceImport.history.uploadNew'),
      page.getByRole('heading', { level: 1, name: t('attendanceImport.pageTitle') }),
    );
  });
});
