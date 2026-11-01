/** [Epic 42] Admission rounds, admin half: add a round that guardians can apply to online. */
import { expect, type Page } from '@playwright/test';

import { beat } from '../helpers/capture';
import { gifTour } from '../helpers/gif';
import { tr } from '../helpers/nav';

const ns = 'admission-staff-intakes';
/** Same title as gif-intakes-zphone.tour.ts picks on the public form. */
const TITLE = process.env.GUIDE_INTAKE_TITLE ?? 'Admission 2027: Class 7';
const OPEN = process.env.GUIDE_INTAKE_OPEN ?? '2026-10-20';
const CLOSE = process.env.GUIDE_INTAKE_CLOSE ?? '2026-12-15';

async function pickDate(p: Page, label: string, iso: string): Promise<void> {
  await p.getByLabel(label, { exact: true }).click();
  await expect(p.getByRole('grid', { name: tr('common', 'date.calendar') })).toBeVisible();
  const cell = p.locator(`[role="grid"] [data-date="${iso}"]`);
  for (let i = 0; i < 6 && !(await cell.isVisible()); i++) {
    await p.getByRole('button', { name: tr('common', 'date.nextMonth') }).click();
    await p.waitForTimeout(250);
  }
  await cell.click();
  await expect(cell).toBeHidden();
}

gifTour(
  'admission rounds: add a round',
  { card: 'admin', file: 'people-admission-intakes-flow.gif' },
  async (p) => {
    await p.goto('/admissions/intakes');
    await expect(p.getByRole('heading', { level: 1, name: tr(ns, 'list.title') })).toBeVisible();
    await beat(p, 1000);
    await p.getByRole('button', { name: tr(ns, 'list.addIntake') }).click();
    const dialog = p.getByRole('dialog', { name: tr(ns, 'createDialog.title') });
    await expect(dialog).toBeVisible();
    await beat(p);
    await dialog.locator('#intake-title').pressSequentially(TITLE, { delay: 35 });
    await dialog.locator('#intake-class-section').click();
    await p
      .getByRole('option', { name: /Class 7/ })
      .first()
      .click();
    await beat(p, 400);
    await dialog.locator('#intake-seat-count').fill('');
    await dialog.locator('#intake-seat-count').pressSequentially('40', { delay: 80 });
    await pickDate(p, tr(ns, 'form.openDateLabel'), OPEN);
    await pickDate(p, tr(ns, 'form.closeDateLabel'), CLOSE);
    await beat(p);
    // No papers required: the phone half then has nothing to upload.
    for (const box of await dialog.getByRole('checkbox').all()) {
      if (await box.isChecked()) await box.uncheck();
    }
    await beat(p, 600);
    await dialog.getByRole('button', { name: tr(ns, 'createDialog.save') }).click();
    await expect(dialog).toBeHidden();
    await expect(p.getByRole('main').getByText(TITLE)).toBeVisible();
    await beat(p, 1200);
  },
);
