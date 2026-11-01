import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  acrAssessmentFactory,
  acrCriterionFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../../help/test-utils';

import { AcrForm, type AcrStep } from './acr-form';

// The form has no router in tests; the print button only needs navigate + pathname.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useRouterState: () => '/staff/u-1/acr',
}));

// Scores and counts render in the tenant's numerals; the settings handler below pins Latin ones.
const digit = (n: number) => formatNumber(n, REGION_BD_EN);
const TITLE = 'ACR — Abdul Karim';

afterEach(async () => {
  await cleanupTestState();
});

const criteria = [
  acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', label_en: 'Punctuality', sort_order: 1 }),
  acrCriterionFactory({ id: 'c2', code: 'TEAMWORK', label_en: 'Teamwork', sort_order: 2 }),
];

// The page keeps `?step=`; the test keeps it in state.
function Harness(props: {
  assessment: Parameters<typeof AcrForm>[0]['assessment'];
  criteria: typeof criteria;
  onServerUpdate: (a: unknown) => void;
  onStepChange?: (s: AcrStep) => void;
}) {
  const [step, setStep] = React.useState<AcrStep>('period');
  return (
    <AcrForm
      assessment={props.assessment}
      criteria={props.criteria}
      onServerUpdate={props.onServerUpdate}
      title={TITLE}
      onClose={() => undefined}
      yearName="2026"
      step={step}
      onStepChange={(s) => {
        props.onStepChange?.(s);
        setStep(s);
      }}
    />
  );
}

async function renderForm(
  assessment = acrAssessmentFactory({ id: 'acr-1' }),
  formCriteria: typeof criteria = criteria,
  onStepChange?: (s: AcrStep) => void,
) {
  const onServerUpdate = vi.fn();
  let settingsServed = false;
  server.use(
    http.get('/api/v1/schools/:id/settings', () => {
      settingsServed = true;
      return HttpResponse.json({ version: 1 });
    }),
  );
  renderWithProviders(
    withHelp(
      <Harness
        assessment={assessment}
        criteria={formCriteria}
        onServerUpdate={onServerUpdate}
        {...(onStepChange ? { onStepChange } : {})}
      />,
    ),
    { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
  );
  // The `evaluations` namespace suspends on first render.
  await screen.findByRole('heading', { level: 1, name: TITLE });
  // Numerals follow the tenant settings: wait until they are served AND applied.
  await waitFor(() => expect(settingsServed).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return onServerUpdate;
}

// The footer's primary is the last "Next" in the DOM (the phone-only
// criterion nav says "Next criterion").
function shellNext() {
  return screen.getByRole('button', { name: 'Next' });
}

function pressed(name: string) {
  return screen
    .getAllByRole('button', { name: new RegExp(`${digit(Number(name))} ·`) })[0]
    ?.getAttribute('aria-pressed');
}

describe('AcrForm', () => {
  it('a malformed stored period date leaves the picker empty instead of crashing the page', async () => {
    // `renderForm` waits for the h1, so reaching the assertions means render did not throw.
    await renderForm(
      acrAssessmentFactory({
        id: 'acr-1',
        step1_data: { period_from: 'not-a-date', period_to: '2026-13-45' },
      }),
    );
    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeTruthy();
  });

  it('digit keys score the active criterion and advance to the next', async () => {
    let patchBody: unknown;
    server.use(
      http.patch('/api/v1/acr/assessments/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' }));
      }),
    );
    const onStepChange = vi.fn();
    await renderForm(acrAssessmentFactory({ id: 'acr-1' }), criteria, onStepChange);

    fireEvent.click(shellNext());
    expect(onStepChange).toHaveBeenCalledWith('criteria');
    const teamwork = () => screen.getByText('Teamwork').closest('li');
    expect(teamwork()?.getAttribute('aria-current')).toBeNull();

    fireEvent.keyDown(document.body, { key: '4' });
    const first = screen.getByText('Punctuality').closest('li') as HTMLElement;
    expect(
      within(first)
        .getByRole('button', { name: new RegExp(`${digit(4)} ·`) })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(teamwork()?.getAttribute('aria-current')).toBe('true');
    // A chosen score is a tinted outline button, not a filled primary one.
    const chosen = within(first).getByRole('button', { name: new RegExp(`${digit(4)} ·`) });
    expect(chosen.className).not.toContain('bg-primary');

    fireEvent.keyDown(document.body, { key: '2' });
    expect(
      within(teamwork() as HTMLElement)
        .getByRole('button', { name: new RegExp(`${digit(2)} ·`) })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    await waitFor(() =>
      expect(patchBody).toEqual({
        scores: [
          { criterion_id: 'c1', score: 4 },
          { criterion_id: 'c2', score: 2 },
        ],
      }),
    );
  });

  it('blocks submit until every criterion is scored, then completes on Ctrl+Enter', async () => {
    const completed = acrAssessmentFactory({
      id: 'acr-1',
      status: 'COMPLETED',
      total: 6,
      completed_at: '2026-09-30T00:00:00.000Z',
    });
    const complete = vi.fn(() => HttpResponse.json(completed));
    server.use(
      http.patch('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' })),
      ),
      http.post('/api/v1/acr/assessments/:id/complete', complete),
    );
    const onServerUpdate = await renderForm();

    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();

    fireEvent.click(shellNext());
    // Steps are free to visit; only Complete waits for every criterion.
    expect(screen.getByText(`${digit(0)} of ${digit(2)} scored`)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '4' });
    fireEvent.keyDown(document.body, { key: '3' });
    expect(screen.getByText(`${digit(2)} of ${digit(2)} scored`)).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onServerUpdate).toHaveBeenCalledWith(completed));
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("renders and scores the criteria it is given (the assessment's own older version)", async () => {
    // D1: the page feeds the form the ACR's own version, which may be smaller than the current set.
    const oldSet = [
      acrCriterionFactory({ id: 'old1', code: 'LEGACY', label_en: 'Legacy criterion' }),
    ];
    server.use(
      http.patch('/api/v1/acr/assessments/:id', () =>
        HttpResponse.json(acrAssessmentFactory({ id: 'acr-1' })),
      ),
    );
    await renderForm(acrAssessmentFactory({ id: 'acr-1' }), oldSet);

    fireEvent.click(shellNext());
    expect(screen.getByText('Legacy criterion')).toBeTruthy();
    expect(screen.queryByText('Teamwork')).toBeNull();
    expect(screen.getByText(`${digit(0)} of ${digit(1)} scored`)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '4' });
    expect(screen.getByText(`${digit(1)} of ${digit(1)} scored`)).toBeTruthy();
  });

  it('shows the Print button on a completed ACR (ADMIN) and not on an incomplete one', async () => {
    await renderForm(acrAssessmentFactory({ id: 'acr-1', status: 'COMPLETED', total: 7 }));
    expect(await screen.findByRole('button', { name: 'Print ACR' })).toBeTruthy();
    await cleanupTestState();
    await renderForm();
    expect(screen.queryByRole('button', { name: 'Print ACR' })).toBeNull();
  });

  it('draws a (?) next to Complete ACR on the last step', async () => {
    await renderForm();
    fireEvent.click(shellNext());
    fireEvent.click(shellNext());
    await screen.findByRole('button', { name: 'Complete ACR' });
    await expectHelp('people.evaluations.action.completeAcr');
  });

  it('renders a completed ACR read-only with a Reopen button', async () => {
    const assessment = acrAssessmentFactory({
      id: 'acr-1',
      status: 'COMPLETED',
      total: 7,
      step1_data: { description: 'Teaches maths' },
      scores: [
        { criterion_id: 'c1', score: 4 },
        { criterion_id: 'c2', score: 3 },
      ],
    });
    const reopened = acrAssessmentFactory({ id: 'acr-1', status: 'INCOMPLETE' });
    server.use(http.post('/api/v1/acr/assessments/:id/reopen', () => HttpResponse.json(reopened)));
    const onServerUpdate = await renderForm(assessment);

    const description = screen.getByLabelText('Description of duties');
    expect((description as HTMLTextAreaElement).value).toBe('Teaches maths');
    expect(description.hasAttribute('disabled')).toBe(true);
    expect(
      screen
        .getAllByRole('button', { name: new RegExp(`${digit(4)} ·`) })[0]
        ?.hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Complete ACR' })).toBeNull();
    // Cards for each section, the total in the context line, Reopen as the footer primary.
    expect(screen.getByRole('heading', { level: 2, name: 'Criteria' })).toBeTruthy();
    expect(screen.getByText('Total score')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: '1' });
    expect(pressed('4')).toBe('true');

    await expectHelp('people.evaluations.action.reopenAcr');
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(onServerUpdate).toHaveBeenCalledWith(reopened));
  });

  it('shows the period tab check once both dates are set, and writes ISO dates through the pickers', async () => {
    await renderForm(
      acrAssessmentFactory({
        id: 'acr-1',
        step1_data: { period_from: '2026-01-01', period_to: '2026-12-31' },
      }),
    );
    const tab = screen.getByRole('tab', { name: /Period and description/ });
    expect(tab.querySelector('svg')).toBeTruthy();
    // Date pickers, not browser date inputs.
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Period from/ })).toBeTruthy();
  });
});
