/**
 * [Epic 42 / W12] Communications shots left over from W11: send message, fee reminders, reminder history.
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('communications');
const f = (name: string) => `${dir}/${name}.png`;

async function pickStudent(page: Page, ns: string, key: string, q: string) {
  const box = page.getByPlaceholder(tr(ns, key));
  await box.fill(q);
  await page.waitForTimeout(2000);
  await page.locator('main li button, main [role="option"]').first().click();
  await page.waitForTimeout(1500);
}

test('comms W12: send message', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'office-staff');
  await step('send-message-01', async () => {
    await go(page, '/communications/send');
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1440, height: 1250 });
    await pickStudent(page, 'communications', 'send.studentSearchPlaceholder', 'a');
    await page
      .getByRole('radio')
      .first()
      .check({ force: true })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await page
      .locator('#send-message')
      .fill('Tomorrow is a half day. School closes at 12 noon. Please send the child with lunch.');
    await page.waitForTimeout(800);
    await snap(page, f('send-message-01'), []);
  });
  await step('send-message-02', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: tr('communications', 'send.submit') }).click();
    await page.waitForTimeout(1500);
    await snap(page, f('send-message-02'), []);
  });
});

test('comms W12: fee reminders', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'accountant');
  await step('fee-reminders-01', async () => {
    await go(page, '/communications/reminders');
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1440, height: 1550 });
    const ph = tr('communications', 'reminders.studentSearchPlaceholder');
    for (let i = 0; i < 12; i += 1) {
      await page.getByPlaceholder(ph).fill('a');
      await page.waitForTimeout(1800);
      await page.locator('main li button, main [role="option"]').nth(i).click();
      await page.waitForTimeout(1800);
      const bal =
        (await page
          .getByText(tr('communications', 'reminders.balanceLabel'))
          .locator('xpath=following-sibling::*[1]')
          .first()
          .textContent()) ?? '';
      if (/[1-9]/.test(bal.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))))) break;
      await page
        .locator('main')
        .getByRole('button', { name: /Change|বদলান/ })
        .click();
      await page.waitForTimeout(800);
    }
    await page
      .locator('textarea')
      .first()
      .fill(
        'Dear parent, {{student_name}} has {{due_amount}} due for {{due_month}}. Please pay at the school office.',
      );
    await page.waitForTimeout(500);
    await page
      .getByRole('button', { name: tr('communications', 'reminders.previewAction') })
      .click();
    await page.waitForTimeout(3500);
    await snap(page, f('fee-reminders-01'), []);
  });
  await step('fee-reminders-02', async () => {
    await go(page, '/communications/reminders');
    await page.getByRole('button', { name: tr('communications', 'bulk.entryAction') }).click();
    await page.waitForTimeout(2500);
    for (const i of [1, 2, 3]) await page.getByRole('checkbox').nth(i).check();
    await page.getByRole('button', { name: tr('communications', 'bulk.nextToMessage') }).click();
    await page.waitForTimeout(1500);
    await page
      .getByLabel(tr('communications', 'bulk.message.batchNameLabel'))
      .fill('October fee reminder');
    await page
      .getByLabel(tr('communications', 'bulk.message.messageLabel'))
      .fill(
        'Dear parent, {{student_name}} has {{due_amount}} due for {{due_month}}. Please pay at the school office.',
      );
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: tr('communications', 'bulk.nextToReview') }).click();
    await page.waitForTimeout(1500);
    await page
      .getByRole('button', { name: tr('communications', 'reminders.previewAction') })
      .click();
    await page.waitForTimeout(4000);
    await page.setViewportSize({ width: 1440, height: 760 });
    await page.waitForTimeout(500);
    await snap(page, f('fee-reminders-02'), []);
  });
});

test('comms W12: reminder history', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'accountant');
  await step('reminder-history-01', async () => {
    await go(page, '/communications/batches');
    await page.waitForTimeout(2500);
    await page.setViewportSize({ width: 1440, height: 1300 });
    await page.locator('main a[href*="/communications/batches/"]').first().click();
    await page.waitForTimeout(3000);
    await snap(page, f('reminder-history-01'), []);
  });
  await step('reminder-history-02', async () => {
    await go(page, '/communications/batches');
    await page.waitForTimeout(2500);
    await snap(page, f('reminder-history-02'), []);
  });
});

test('comms W12: message log', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  await step('message-log-01', async () => {
    await go(page, '/communications/message-log');
    await page.waitForTimeout(3000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await snap(page, f('message-log-01'), []);
  });
  await step('message-log-02', async () => {
    await page
      .getByRole('button', { name: tr('communications', 'messageLog.viewDetail') })
      .first()
      .click();
    await page.waitForTimeout(1500);
    await snap(page, f('message-log-02'), []);
  });
});
