import fs from 'node:fs';

import { adminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages';

import { createClassWithStudents, runSuffix } from './helpers';

/**
 * [8.15.18] "Export all" on the students list: filter by class, download everything that matches as
 * CSV, and check the file is exactly the list: the server's header row, one row per student, and a
 * row count equal to the list's own total (the number on the download button).
 *
 * The class is chosen through the list's own address (`?class_id=`), the state the filter writes.
 * The class dropdown holds only the first 100 classes, and the shared test school holds far more
 * than that, so a class made a moment ago may not be offered in it.
 */
const STUDENT_EXPORT_HEADER = [
  'Roll',
  'Registration No.',
  'Name',
  'Class',
  'Section',
  'Guardian',
  'Status',
];

test.describe('export all', () => {
  test.use(loggedIn('admin'));
  test.setTimeout(90_000);

  test('a filtered students list downloads as CSV with its header and as many rows as the list', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const suffix = runSuffix();
    const { chain, students } = await createClassWithStudents(
      request,
      session,
      `E2E Export ${suffix}`,
      ['MALE', 'FEMALE', 'MALE', 'FEMALE'],
    );
    const total = students.length;
    const list = new ListShellPage(page, {
      titleKey: 'students.list.title',
      openLabelKey: 'students.list.view',
    });

    await test.step('the list is filtered to the class and says how many it holds', async () => {
      await page.goto(`/students?class_id=${chain.classId}`);
      await list.expectLoaded();
      await list.expectResultCount(total);
      const group = page.getByRole('group', { name: t('common.export.groupLabel') });
      await expect(
        group.getByRole('button', { name: new RegExp(t('common.export.excel')) }),
      ).toContainText(t('common.export.people_other', { n: total }));
    });

    await test.step('CSV from "আরও নামানোর উপায়" downloads exactly that list', async () => {
      const group = page.getByRole('group', { name: t('common.export.groupLabel') });
      await group.getByRole('button', { name: t('common.export.moreOptions') }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('menuitem', { name: t('common.export.csv') }).click(),
      ]);

      expect(download.suggestedFilename()).toMatch(/\.csv$/);
      // Every cell is quoted and the file starts with a byte-order mark (`csv-stream.writer.ts`).
      const text = fs.readFileSync((await download.path())!, 'utf8').replace(/^\uFEFF/, '');
      const [header, ...rows] = text
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map((line) => line.slice(1, -1).split('","'));
      expect(header).toEqual(STUDENT_EXPORT_HEADER);

      // As many rows as the list's total, and they are this class's students, nobody else.
      expect(rows).toHaveLength(total);
      expect(rows.map((row) => row[2]).sort()).toEqual(students.map((s) => s.name).sort());
      expect(new Set(rows.map((row) => row[3]))).toEqual(new Set([chain.className]));
    });
  });
});
