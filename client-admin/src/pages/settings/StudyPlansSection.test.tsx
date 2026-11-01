import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatTime } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudyPlansSection } from './StudyPlansSection';
import { WithTestRouter } from './with-test-router';

const SCHOOL_ID = 'school-1';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };
const SMS_LABEL = "Also send the guardians' weekly summary by SMS";

const STORED = {
  statusDeadline: '19:30',
  reminderTime: '07:15',
  escalateAfterSchoolDays: 4,
  weeklyDigestTime: '16:00',
  guardianDigestSms: true,
};

function mockCredits(body: object = { metering: 'OFF', available: 0, reserved: 0, ledger: {} }) {
  server.use(http.get(`/api/v1/schools/${SCHOOL_ID}/sms-credits`, () => HttpResponse.json(body)));
}

function mockPatch() {
  const patchBody = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      patchBody(await request.json());
      return HttpResponse.json({ version: 1 });
    }),
  );
  return patchBody;
}

function renderSection(
  props: Partial<React.ComponentProps<typeof StudyPlansSection>> = {},
  options: typeof opts | (Omit<typeof opts, 'locale'> & { locale: 'bn' }) = opts,
) {
  return renderWithProviders(
    <WithTestRouter>
      <RegionConfigProvider>
        <StudyPlansSection schoolId={SCHOOL_ID} studyPlans={undefined} smsConfigured {...props} />
      </RegionConfigProvider>
    </WithTestRouter>,
    options,
  );
}

describe('StudyPlansSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the defaults when studyPlans is undefined', async () => {
    mockCredits();
    renderSection();

    expect(await screen.findByRole('combobox', { name: 'Status deadline' })).toHaveProperty(
      'value',
      '6:00 PM',
    );
    expect(screen.getByRole('combobox', { name: 'Teacher reminder' })).toHaveProperty(
      'value',
      '8:00 AM',
    );
    expect(screen.getByLabelText('Tell the academic coordinator and admin after')).toHaveProperty(
      'value',
      '2',
    );
    expect(screen.getByRole('combobox', { name: 'Weekly summary time' })).toHaveProperty(
      'value',
      '5:00 PM',
    );
    expect(screen.getByLabelText(SMS_LABEL).getAttribute('aria-checked')).toBe('false');
  });

  it('updates the first summary tile as the deadline changes, before saving', async () => {
    mockCredits();
    const { user } = renderSection();

    const summary = await screen.findByRole('region', { name: 'What happens with these settings' });
    expect(summary.querySelector('li')?.textContent).toContain('6:00 PM');

    const picker = screen.getByRole('combobox', { name: 'Status deadline' });
    await user.click(picker);
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard(formatTime('20:30', REGION_BD_EN));
    await user.click(
      await screen.findByRole('option', { name: formatTime('20:30', REGION_BD_EN) }),
    );
    expect(await within(summary).findByText(/8:30\sPM/, { selector: 'strong' })).toBeTruthy();
  });

  it('saves only { version: 1, studyPlans } with all five fields', async () => {
    mockCredits();
    const patchBody = mockPatch();
    const { user } = renderSection({ studyPlans: STORED });

    const days = await screen.findByLabelText('Tell the academic coordinator and admin after');
    await user.clear(days);
    await user.type(days, '5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      studyPlans: { ...STORED, escalateAfterSchoolDays: 5 },
    });
  });

  it.each(['0', '11'])('rejects %s school days with a field error and does not save', async (v) => {
    mockCredits();
    const patchBody = mockPatch();
    const { user } = renderSection();

    const days = await screen.findByLabelText('Tell the academic coordinator and admin after');
    await user.clear(days);
    await user.type(days, v);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a number from 1 to 10.')).toBeTruthy();
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('rejects a malformed time and does not save', async () => {
    mockCredits();
    const patchBody = mockPatch();
    // The time picker only offers HH:mm, so a bad value can only arrive from stored data.
    const { user } = renderSection({ studyPlans: { ...STORED, statusDeadline: '9' } });

    await screen.findByLabelText('Tell the academic coordinator and admin after');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a time like 18:00.')).toBeTruthy();
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('disables the SMS checkbox with the hint when SMS is not set up', async () => {
    mockCredits();
    renderSection({ smsConfigured: false });

    const box = await screen.findByLabelText(SMS_LABEL);
    expect(box.hasAttribute('disabled') || box.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(screen.getByText(/No SMS company added\./)).toBeTruthy();
  });

  // PR #3325 review round 2, finding 8: unknown (still loading, or failed) is not "not set up".
  it('neither disables the SMS checkbox nor says "not set up" while SMS readiness is unknown', async () => {
    mockCredits();
    renderSection({ smsConfigured: null });

    const box = await screen.findByLabelText(SMS_LABEL);
    expect(box.hasAttribute('disabled') || box.getAttribute('aria-disabled') === 'true').toBe(
      false,
    );
    expect(screen.queryByText(/No SMS company added\./)).toBeNull();
  });

  it('shows the current balance when credits are metered', async () => {
    mockCredits({ metering: 'PLATFORM', available: 2150, reserved: 0, ledger: {} });
    renderSection({ studyPlans: STORED });

    expect(await screen.findByText(/Current balance: 2150 credits/)).toBeTruthy();
  });

  it('warns when leaving with unsaved changes', async () => {
    mockCredits();
    const { user } = renderSection();

    const input = await screen.findByLabelText('Tell the academic coordinator and admin after');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);

    await user.type(input, '3');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('shows summary values in Bangla digits', async () => {
    mockCredits();
    renderSection({}, { ...opts, locale: 'bn' });

    const summary = await screen.findByRole('region', { name: 'এখনকার সেটিংয়ে যা হয়' });
    expect(summary.textContent).toContain('সন্ধ্যা ৬:০০');
    expect(summary.textContent).toContain('পরের স্কুল-দিন সকাল ৮:০০');
  });
});
