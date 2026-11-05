import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Exams & Results (admin)', () => {
  test.use(loggedIn('admin'));

  test('exams', async ({ page }) => {
    await openFromSidebar(page, t('common.entities.exam_other'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('exams.list.addExam'),
      modalTitled(page, t('exams.examForm.createTitle')),
    );
  });

  test('seat plans', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.seatPlans'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('seatPlans.list.generateButton'),
      modalTitled(page, t('seatPlans.generate.title')),
    );
  });

  test('promotions', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.promotion'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('promotions.list.newRun'),
      modalTitled(page, t('promotions.newRunForm.title')),
    );
  });

  test('marks entry', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.marksEntry'));
    await expectReachableInMain(page);
  });

  test('results', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.results'));
    await expectReachableInMain(page);
  });

  test('final results', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.finalResults'));
    await expectReachableInMain(page);
  });
});
