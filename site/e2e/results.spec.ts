import { expect, test, type Page } from '@playwright/test';

// res.localhost is the stub school with the results page on, one published exam and an Umami id.
test.use({ baseURL: 'http://res.localhost:4321' });

const EXAM = '00000000-0000-4000-8000-00000000e001';
const SECTION = '00000000-0000-4000-8000-0000000005a1';
const rows = [
  { handle: 'h1', roll: 1, name: 'রহিম উদ্দিন', gpa: 5, grade: 'A+', passed: true },
  { handle: 'h2', roll: 2, name: 'করিম মিয়া', gpa: 0, grade: 'F', passed: false },
];

/** A fake Turnstile that hands out a token at once, and the two results routes the island calls. */
async function stub(page: Page, o: { names?: boolean } = {}) {
  await page.route('https://challenges.cloudflare.com/**', (r) =>
    r.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile={render:(_e,o)=>{o.callback('tok');return 'w'},reset:()=>{}}`,
    }),
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/_api/island/results', (r) => {
    const body = r.request().postDataJSON();
    bodies.push(body);
    const one = body.roll ? rows.filter((x) => x.roll === body.roll) : rows;
    return r.fulfill({
      json: {
        page: 1,
        pageSize: 100,
        total: one.length,
        showNames: o.names !== false,
        rows: one.map((x) => ({ ...x, name: o.names === false ? null : x.name })),
      },
    });
  });
  await page.route('**/_api/island/results/detail', (r) =>
    r.fulfill({
      json: {
        subjects: [
          { name: { bn: 'গণিত', en: 'Math' }, obtained: 80, grade: 'A+', gpa: 5, passed: true },
          { name: { bn: 'ইংরেজি', en: 'English' }, obtained: 72, grade: 'A', gpa: 4, passed: true },
        ],
      },
    }),
  );
  return bodies;
}

async function filter(page: Page, roll?: string) {
  await page.selectOption('select[name=exam]', EXAM);
  await page.selectOption('select[name=section]', SECTION); // the one class is picked for the guardian
  if (roll) await page.fill('input[name=roll]', roll);
  await page.getByRole('button', { name: 'ফল দেখুন' }).click();
}

test('exam list is in the first HTML; only the published exam is offered', async ({ page }) => {
  await stub(page);
  await page.goto('/bn/results/');
  await expect(page.locator('select[name=exam] option')).toHaveText([
    'বেছে নিন',
    'Half yearly 2026',
  ]);
});

test('filter shows the table; a roll narrows to one row; names show', async ({ page }) => {
  const bodies = await stub(page);
  await page.goto('/bn/results/');
  await filter(page);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.results-table')).toContainText('রহিম উদ্দিন');
  expect(bodies[0]).toMatchObject({
    exam_id: EXAM,
    class_section_id: SECTION,
    captcha_token: 'tok',
  });
  await filter(page, '2');
  await expect(page.locator('.results-table tbody tr')).toHaveCount(1);
});

test('expanding a row loads its subjects', async ({ page }) => {
  await stub(page);
  await page.goto('/bn/results/');
  await filter(page);
  await page.locator('.results-table summary').first().click();
  await expect(page.locator('.results-table .subjects li')).toHaveCount(2);
  await expect(page.locator('.results-table .subjects')).toContainText('গণিত');
});

test('names off: no name column and no name anywhere', async ({ page }) => {
  await stub(page, { names: false });
  await page.goto('/bn/results/');
  await filter(page);
  await expect(page.locator('.results-table th')).toHaveCount(4);
  await expect(page.locator('main')).not.toContainText('রহিম');
});

test('390 px: rows stack with labels and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/bn/results/');
  await filter(page);
  await expect(page.locator('.results-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.results-table tbody td').nth(1)).toHaveCSS('display', 'flex');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('print hides the form and keeps the table', async ({ page }) => {
  await stub(page);
  await page.goto('/bn/results/');
  await filter(page);
  await expect(page.locator('.results-form')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.results-form')).toBeHidden();
  await expect(page.locator('.results-table')).toBeVisible();
});

test('analytics: one deferred tag on a site with an Umami id, none on one without', async ({
  page,
}) => {
  await page.goto('/bn/');
  const tag = page.locator('script[data-website-id]');
  await expect(tag).toHaveCount(1);
  await expect(tag).toHaveAttribute('src', 'https://stats.example.test/script.js');
  await expect(tag).toHaveAttribute('data-do-not-track', 'true');
  await page.goto('http://ok.localhost:4321/bn/');
  await expect(page.locator('script[data-website-id]')).toHaveCount(0);
});
