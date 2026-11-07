import { adminApiSession, createTeacher } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [40.3.11] School website content, admin side: a blog post is written and published, the
 * enquiries tab opens, a teacher is put on the website from the staff page, and the notice form
 * offers "pin on the home page" only once the notice is on the website.
 *
 * Only what the screens show today: it does not open the public site (the site container is not
 * part of this run), so the API-level public reads are covered by the server's own specs.
 * The post title carries a unique suffix so a re-run on the same database never matches an old row.
 */
test.use(loggedIn('admin'));

test('admin writes and publishes a blog post', async ({ page }) => {
  const title = `স্কুল মেলা ${Date.now()}`;
  await page.goto('/website/blog');
  await page
    .getByRole('link', { name: t('website.blog.new') })
    .or(page.getByRole('button', { name: t('website.blog.new') }))
    .first()
    .click();

  // The first title box is the Bangla one (it is the required one).
  await page
    .getByRole('textbox', { name: new RegExp(`^${t('website.blog.postTitle')} \\(`) })
    .first()
    .fill(title);
  await page.getByRole('button', { name: t('website.blog.publish'), exact: true }).click();
  await expect(page.getByText(t('website.blog.publishedToast'))).toBeVisible();

  await page.goto('/website/blog');
  const row = page.getByRole('row', { name: new RegExp(title) });
  await expect(row).toBeVisible();
  await expect(row.getByText(t('website.blog.published'))).toBeVisible();
});

test('the enquiries tab opens', async ({ page }) => {
  await page.goto('/website/enquiries');
  await expect(page.getByRole('heading', { name: t('website.enquiries.title') })).toBeVisible();
});

test('admin puts a teacher on the website from the staff page', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const teacher = await createTeacher(request, session, `Web Teacher ${Date.now()}`);
  await page.goto(`/staff/${teacher.userId}?tab=websiteProfile`);

  const show = page.getByLabel(t('staff.tabs.websiteProfileFields.show'));
  await expect(show).toBeVisible();
  await show.check();
  await page.getByRole('button', { name: t('staff.tabs.websiteProfileFields.save') }).click();
  await expect(page.getByText(t('staff.tabs.websiteProfileFields.saved'))).toBeVisible();

  // The saved choice survives a reload.
  await page.reload();
  await expect(page.getByLabel(t('staff.tabs.websiteProfileFields.show'))).toBeChecked();
});

test('a notice can be pinned on the home page only once it is shown on the website', async ({
  page,
}) => {
  await page.goto('/communications/notices/new');
  const pin = page.getByLabel(t('notices.compose.pinOnHome'));
  await expect(pin).toBeDisabled();
  await page.getByLabel(t('notices.compose.showOnWebsite')).check();
  await expect(pin).toBeEnabled();
  await pin.check();
  await expect(pin).toBeChecked();
});
