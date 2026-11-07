/**
 * [Epic 42 pilot] Media for the "Attendance" guide page (`attendance.attendance`).
 *
 * Signs in as the demo class teacher (`class-teacher-8a`) and shoots the
 * section list, the marking screen and its states, plus a GIF of the daily
 * workflow. The demo seed anchored on a school day (`--anchor 2026-10-22`)
 * leaves some of that day's registers not started; `resetCaptureDay` puts
 * the two the tour submits back to that state so every run starts the same.
 */
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

import bnAttendance from '../../../ui/src/i18n/locales/bn/attendance.json';
import bnNav from '../../../ui/src/i18n/locales/bn/nav.json';
import bnAttendanceImport from '../../../ui/src/i18n/locales/bn/attendanceImport.json';
import bnDashboard from '../../../ui/src/i18n/locales/bn/dashboard.json';
import enAttendance from '../../../ui/src/i18n/locales/en/attendance.json';
import enAttendanceImport from '../../../ui/src/i18n/locales/en/attendanceImport.json';
import enDashboard from '../../../ui/src/i18n/locales/en/dashboard.json';
import enNav from '../../../ui/src/i18n/locales/en/nav.json';
import { beat, guideLang, imgDir, loginAs, prepare, recordGif, shoot } from '../helpers/capture';
import { tr } from '../helpers/nav';

const DAY = process.env.GUIDE_DAY ?? '2026-10-22';
const OLD_DAY = process.env.GUIDE_OLD_DAY ?? '2026-10-15';
const SHOT_SECTION = 'Class 10 – B';
const GIF_SECTION = 'Class 6 – B';

const lang = guideLang();
const a = lang === 'bn' ? bnAttendance : enAttendance;
const nav = lang === 'bn' ? bnNav : enNav;
const up = lang === 'bn' ? bnAttendanceImport : enAttendanceImport;
const dashboard = lang === 'bn' ? bnDashboard : enDashboard;
const dir = imgDir('attendance');
const file = (name: string) => `${dir}/attendance-${name}`;

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

/** `pg` comes with the server workspace but has no types here (the server uses TypeORM). */
async function pgClient(connectionString: string | undefined): Promise<PgClient> {
  const moduleName = 'pg';
  const pg = (await import(moduleName)) as {
    default: { Client: new (config: { connectionString?: string }) => PgClient };
  };
  return new pg.default.Client({ connectionString });
}

/** Remove the capture day's register for the sections the tour submits. */
async function resetCaptureDay(): Promise<void> {
  const db = await pgClient(process.env.DATABASE_URL);
  await db.connect();
  try {
    const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
    if (!rows[0]?.name.startsWith('biddaloy_demo')) {
      throw new Error('resetCaptureDay only runs against a biddaloy_demo* database');
    }
    await db.query(
      `DELETE FROM attendance_sessions s
        USING class_sections cs, classes c
        WHERE s.section_id = cs.id AND cs.class_id = c.id AND s.date = $1
          AND (c.name || ' – ' || cs.section_name) = ANY($2)`,
      [DAY, [SHOT_SECTION, GIF_SECTION]],
    );
  } finally {
    await db.end();
  }
}

const sectionLink = (page: Page, name: string) =>
  page.getByRole('main').getByRole('link', { name: new RegExp(name) });

/** A count badge ("Present 17" / "উপস্থিত ১৭"): any digits, either script. */
const countBadge = (template: string) => new RegExp(`^${template.replace('{{n}}', '[0-9০-৯]+')}$`);

const rows = (page: Page) => page.getByRole('main').locator('ul.divide-y > li');

test.describe.configure({ mode: 'serial' });

test.beforeAll(resetCaptureDay);

test('desktop: menu, sections, register, states', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');

  // 01 — where Attendance sits: the menu group, and the dashboard card.
  const sidebar = page.getByRole('complementary').getByRole('navigation');
  const group = sidebar.getByRole('button', { name: nav.groups.attendance, exact: true });
  const card = page.getByRole('region', { name: dashboard.widgets['my-pending-sections'].title });
  await expect(group).toBeVisible();
  await shoot(page, file('01-menu.png'), [{ target: group }, { target: card }]);
  await group.click();
  const menuLink = sidebar.getByRole('link', { name: nav.items.attendance, exact: true });
  await expect(menuLink).toBeVisible();
  await shoot(page, file('01b-menu-open.png'), [{ target: menuLink }]);

  // 02 — today is the weekly holiday in the demo school.
  await menuLink.click();
  await expect(page.getByText(a.list.holidayTitle)).toBeVisible();
  await shoot(page, file('02-holiday.png'), [
    { target: page.getByText(a.list.holidayTitle).locator('..') },
  ]);

  // 03 — the section list on a school day.
  await page.goto(`/attendance?date=${DAY}`);
  const title = page.getByRole('heading', { level: 1, name: a.list.title });
  await expect(sectionLink(page, SHOT_SECTION)).toBeVisible();
  await shoot(page, file('03-sections.png'), [
    { target: title.locator('..') },
    { target: page.getByText(a.list.filterStatus, { exact: true }).locator('..') },
    { target: page.locator('#attendance-list-date').locator('..') },
    { target: sectionLink(page, SHOT_SECTION) },
  ]);

  // 04 — the marking screen before anything is marked.
  await sectionLink(page, SHOT_SECTION).click();
  const allPresent = page.getByRole('button', { name: a.mark.allPresent });
  await expect(allPresent).toBeVisible();
  const first = rows(page).first();
  const counts = page.getByText(countBadge(a.mark.presentCount)).locator('..');
  const submit = page.getByRole('button', { name: a.mark.submitOnline });
  await shoot(page, file('04-register.png'), [
    { target: page.getByRole('heading', { level: 1 }).locator('..') },
    { target: page.locator('#attendance-date').locator('..') },
    { target: page.getByRole('tablist', { name: a.period.tabsLabel }) },
    { target: counts },
    { target: allPresent },
    { target: first.locator('button').first() },
    { target: first.locator('button').last() },
    { target: submit.locator('..') },
  ]);

  // 05 — All present, then two absent students tapped.
  await allPresent.click();
  await rows(page).nth(2).locator('button').first().click();
  await rows(page).nth(5).locator('button').first().click();
  await page.mouse.move(0, 0);
  await shoot(page, file('05-marked.png'), [
    { target: page.getByText(countBadge(a.mark.absentCount)) },
    { target: rows(page).nth(2) },
    { target: rows(page).nth(5) },
  ]);

  // 06 — Late with minutes, from the status button.
  await rows(page).nth(7).locator('button').last().click();
  await page
    .getByRole('button', { name: new RegExp(a.statusControl.status.LATE) })
    .last()
    .click();
  const minutes = page.getByLabel(a.statusControl.minutesLateLabel);
  if (await minutes.isVisible()) await minutes.fill('15');
  else await rows(page).nth(7).locator('button').last().click();
  await shoot(page, file('06-late.png'), [
    { target: page.getByLabel(a.statusControl.minutesLateLabel) },
  ]);
  await page.keyboard.press('Escape');

  // 07 — submitting with students left unmarked asks first.
  await page.getByRole('button', { name: a.mark.reset, exact: true }).click();
  await rows(page).nth(0).locator('button').first().click();
  await rows(page).nth(1).locator('button').first().click();
  await submit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // The ✕ closes it in both languages. The footer's Cancel button is cut off in
  // Bangla (three long labels overflow the small dialog), so the page points at ✕.
  await shoot(page, file('07-unmarked-dialog.png'), [
    { target: dialog.getByRole('button', { name: a.mark.confirmUnmarkedMarkRestPresent }) },
    { target: dialog.getByRole('button', { name: a.mark.confirmUnmarkedSubmit }) },
    {
      target: dialog.getByRole('button', {
        name: lang === 'bn' ? 'বন্ধ করুন' : 'Close',
        exact: true,
      }),
    },
  ]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: a.mark.reset, exact: true }).click();
});

test('desktop: GIF of the daily workflow, then the list after submitting', async ({
  browser,
  page,
}, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  const storageState = await page.context().storageState();

  await recordGif(
    browser,
    { storageState, viewport: { width: 1440, height: 900 } },
    file('take.gif'),
    async (p) => {
      await p.goto(`/attendance?date=${DAY}`);
      await expect(sectionLink(p, GIF_SECTION)).toBeVisible();
      await beat(p, 1200);
      await sectionLink(p, GIF_SECTION).click();
      await expect(p.getByRole('button', { name: a.mark.allPresent })).toBeVisible();
      await beat(p);
      await p.getByRole('button', { name: a.mark.allPresent }).click();
      await beat(p);
      await rows(p).nth(3).locator('button').first().click();
      await beat(p);
      await rows(p).nth(6).locator('button').first().click();
      await beat(p);
      await p.getByRole('button', { name: a.mark.submitOnline }).click();
      await expect(p.getByText(a.mark.savedToast)).toBeVisible();
    },
    { trimStartSec: 1 },
  );

  // 08 — what the list shows right after a teacher submits. The recording
  // context rotated the refresh token, so this page signs in again.
  await loginAs(page, 'class-teacher-8a');
  await page.goto(`/attendance?date=${DAY}`);
  await expect(sectionLink(page, GIF_SECTION)).toBeVisible();
  await shoot(page, file('08-after-submit.png'), [{ target: sectionLink(page, GIF_SECTION) }]);
});

test('desktop: an old register is read-only for the teacher', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  await page.goto(`/attendance?date=${OLD_DAY}`);
  await sectionLink(page, SHOT_SECTION).click();
  const banner = page.getByText(
    a.mark.readOnlyNoPermission.split('{{days}}')[0].trim().slice(0, 12),
  );
  await expect(banner).toBeVisible();
  await shoot(page, file('09-old-register.png'), [
    { target: banner },
    { target: rows(page).first().getByRole('button').last() },
  ]);
});

test('phone: sections, register and the daily workflow', async ({ browser, page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');

  await page.goto(`/attendance?date=${DAY}`);
  await expect(sectionLink(page, SHOT_SECTION)).toBeVisible();
  await shoot(page, file('phone-01-sections.png'), [{ target: sectionLink(page, SHOT_SECTION) }]);

  await sectionLink(page, SHOT_SECTION).click();
  const allPresent = page.getByRole('button', { name: a.mark.allPresent });
  await expect(allPresent).toBeVisible();
  await shoot(page, file('phone-02-register.png'), [
    { target: allPresent },
    { target: rows(page).first().locator('button').first() },
    { target: page.getByRole('button', { name: a.mark.submitOnline }) },
  ]);

  const storageState = await page.context().storageState();
  const phone = info.project.use;
  await recordGif(
    browser,
    {
      storageState,
      viewport: { width: 390, height: 844 },
      userAgent: phone.userAgent,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    },
    file('take-phone.gif'),
    async (p) => {
      await p.goto(`/attendance?date=${DAY}`);
      await expect(sectionLink(p, SHOT_SECTION)).toBeVisible();
      await beat(p, 1200);
      await sectionLink(p, SHOT_SECTION).tap();
      await expect(p.getByRole('button', { name: a.mark.allPresent })).toBeVisible();
      await beat(p);
      await p.getByRole('button', { name: a.mark.allPresent }).tap();
      await beat(p);
      await rows(p).nth(2).locator('button').first().tap();
      await beat(p);
      await p.getByRole('button', { name: a.mark.submitOnline }).tap();
      await expect(p.getByText(a.mark.savedToast)).toBeVisible();
    },
    { trimStartSec: 1, width: 390 },
  );
});

// Not guide media: evidence for the pilot report. An admin editing a register
// older than the correction window gets no reason box, but the server requires
// a reason there, so the save fails.
test('evidence: admin edit of an old register', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop' || lang !== 'en');
  await prepare(page);
  await loginAs(page, 'admin');
  await page.goto(`/attendance?date=${OLD_DAY}`);
  await sectionLink(page, SHOT_SECTION).first().click();
  await expect(page.getByRole('button', { name: a.mark.allPresent })).toBeVisible();
  await rows(page).nth(3).locator('button').first().click();
  await page.getByRole('button', { name: a.mark.submitOnline }).click();
  await expect(page.getByText(a.mark.errorToast)).toBeVisible();
  await page.screenshot({
    path: process.env.GUIDE_EVIDENCE ?? 'test-results/guide/evidence-admin-old-register.png',
  });
});

// [76.6.01] Upload an attendance sheet: pick, download, drop a filled file, review, save, detail.
// Last in the file on purpose: the sheet is for DAY, so saving writes DAY's register of
// SHOT_SECTION, and the earlier shots of that section need it unmarked (`resetCaptureDay` clears
// it before the next run). Shot 04 (the sheet open in Excel) is not made here; take it by hand.
test('desktop: upload an attendance sheet', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(120_000);
  await prepare(page);
  // Admin, not the class teacher: Class 10 – B is a DEVICE section, which only admin may write by sheet.
  await loginAs(page, 'admin');
  await page.goto(`/attendance?date=${DAY}`);

  // 01 — the way in: Attendance > Uploaded sheets in the menu, then the page's upload button.
  // There is no menu item for the wizard itself (D14); the palette is the other way in.
  const sidebar = page.getByRole('complementary').getByRole('navigation');
  const menuLink = sidebar.getByRole('link', { name: nav.items.uploads, exact: true });
  // The group opens by itself on /attendance; a click would fold it shut.
  await sidebar.getByRole('button', { name: nav.groups.attendance, exact: true }).waitFor();
  await page.waitForTimeout(1500); // let the sidebar settle: isVisible() does not wait
  if (!(await menuLink.isVisible())) {
    await sidebar.getByRole('button', { name: nav.groups.attendance, exact: true }).click();
  }
  await menuLink.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(up.history.title);
  const uploadNew = page.getByRole('button', { name: up.history.uploadNew, exact: true });
  await shoot(page, file('uploads-01-menu.png'), [{ target: menuLink }, { target: uploadNew }]);
  await uploadNew.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(up.pageTitle);

  // 02 — pick the section and DAY (the wizard starts on the real today).
  await page.getByLabel(SHOT_SECTION).check();
  // The date field is a button named "<label>, <value>", not a labelled input.
  const dateButton = page.getByRole('button', { name: new RegExp(`^${up.pick.date},`) });
  await dateButton.click();
  await expect(page.getByRole('grid', { name: tr('common', 'date.calendar') })).toBeVisible();
  const dayCell = page.locator(`[role="grid"] [data-date="${DAY}"]`);
  for (let i = 0; i < 12 && !(await dayCell.isVisible()); i++) {
    await page.getByRole('button', { name: tr('common', 'date.previousMonth') }).click();
  }
  await dayCell.click();
  await expect(dayCell).toBeHidden();
  await shoot(page, file('uploads-02-pick.png'), [
    { target: page.getByRole('group', { name: up.pick.sections }) },
    { target: dateButton },
  ]);

  // 03 — the download button, then the real sheet is filled in below.
  const downloadButton = page.getByRole('button', { name: up.download.button });
  await shoot(page, file('uploads-03-download.png'), [{ target: downloadButton }]);
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const sheetPath = await (await downloadPromise).path();

  // Fill the downloaded sheet: three students present, plus one row with a roll that does not exist.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(sheetPath);
  const ws = wb.worksheets[0];
  const code = lang === 'bn' ? 'উ' : 'P';
  for (let r = 2; r <= 5; r += 1) ws.getRow(r).getCell(6).value = code;
  ws.getRow(5).getCell(4).value = 999;
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  // 05 — the drop box.
  const chooser = page.getByLabel(up.upload.chooseFile);
  await expect(chooser).toBeAttached();
  await shoot(page, file('uploads-05-drop.png'), [
    { target: page.getByText(up.upload.dropzone).first() },
  ]);
  await chooser.setInputFiles({
    name: 'sheet.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  });
  await page.getByRole('button', { name: up.upload.reviewChanges }).click();

  // 06 — the review: counts, the error row and the skip box.
  const skip = page.getByLabel(up.review.skipErrors);
  await expect(skip).toBeVisible();
  await shoot(page, file('uploads-06-review.png'), [
    { target: page.getByRole('table').first() },
    { target: skip },
  ]);
  await skip.check();
  await page.getByRole('button', { name: up.review.save.split('{{count}}')[1].trim() }).click();

  // 08 — the upload's page, after saving.
  await expect(page).toHaveURL(/\/attendance\/imports\/[0-9a-f-]{36}$/);
  await shoot(page, file('uploads-08-detail.png'), [{ target: page.getByRole('table').first() }]);
});
