import {
  cleanupTestState,
  hiddenPairResultFactory,
  renderWithRouter,
  paginate,
  server,
  subjectFactory,
  surveyDetailFactory,
  surveyFactory,
  surveyResultsFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';
import { pickDate } from '../../../../test/pick-date';

/** [28.4.2] Survey admin screens against the real route tree. */
function render(entry: string) {
  // Latin numerals, so count assertions do not depend on tenant settings timing.
  server.use(http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })));
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('survey form dialog', () => {
  it('prefills the template questions, anonymous and minimum 3', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    const dialog = await screen.findByRole('dialog', { name: 'New teacher survey' });
    expect(
      await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByDisplayValue('Treats students with respect')).toBeTruthy();
    expect(screen.getByDisplayValue('Is ready to help when I am stuck')).toBeTruthy();
    expect(screen.getByDisplayValue('3')).toBeTruthy();
    expect(dialog.textContent).toContain('Anonymous — hidden from management');
  });

  it('never claims answers are untraceable, in either state', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    const dialog = await screen.findByRole('dialog', { name: 'New teacher survey' });
    expect(dialog.textContent?.toLowerCase()).not.toContain('untraceable');
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Anonymous/ }));
    expect(dialog.textContent).toContain('Management still sees only totals and comments.');
    expect(dialog.textContent).not.toMatch(/person's name/);
    expect(dialog.textContent?.toLowerCase()).not.toContain('untraceable');
  });

  it('blocks submit and names what is missing', async () => {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save as draft' }));
    const alert = await screen.findByText('Enter a title.');
    expect(alert).toBeTruthy();
    expect(screen.getByText('Choose a teacher.')).toBeTruthy();
  });
});

describe('survey list and results', () => {
  it('lists surveys from the server', async () => {
    server.use(
      http.get('/api/v1/surveys', () =>
        HttpResponse.json([surveyFactory({ id: 's1', title: 'Term 2 survey', status: 'OPEN' })]),
      ),
    );
    render('/staff/evaluations?tab=surveys');
    expect(await screen.findByText('Term 2 survey')).toBeTruthy();
    // The title is plain text now; the row's Open action is the link.
    expect(screen.queryByRole('link', { name: 'Term 2 survey' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy();
  });

  it('shows the waiting message for sealed results and never an average', async () => {
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({ id: 's1', title: 'Term 2 survey', status: 'CLOSED' }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(
          surveyResultsFactory({
            surveyId: 's1',
            minResponses: 5,
            results: [hiddenPairResultFactory(2)],
          }),
        ),
      ),
    );
    render('/staff/evaluations/surveys/s1');
    const status = await screen.findByRole('status', undefined, { timeout: 4000 });
    expect(status.textContent).toContain('Waiting for more responses (2 of 5).');
    expect(screen.getByText('Waiting')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Average/)).toBeNull());
  });

  it('open survey seals each card until closed, never "Waiting for more responses"', async () => {
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({ id: 's1', title: 'Term 2 survey', status: 'OPEN' }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(
          surveyResultsFactory({
            surveyId: 's1',
            minResponses: 5,
            results: [hiddenPairResultFactory(6)],
          }),
        ),
      ),
    );
    render('/staff/evaluations/surveys/s1');
    expect(
      await screen.findByText('Results appear once the survey is closed.', undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
    expect(screen.getByText('After closing')).toBeTruthy();
    expect(screen.queryByText(/Waiting for more responses/)).toBeNull();
  });

  it('a non-anonymous survey never promises names', async () => {
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({
            id: 's1',
            title: 'Term 2 survey',
            status: 'OPEN',
            anonymous: false,
          }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(surveyResultsFactory({ surveyId: 's1', minResponses: 5, results: [] })),
      ),
    );
    render('/staff/evaluations/surveys/s1');
    expect(
      await screen.findByText('Not marked anonymous', undefined, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.queryByText('Names shown')).toBeNull();
  });

  it('closing an open survey asks first; only the confirm calls the API', async () => {
    let closed = 0;
    server.use(
      http.get('/api/v1/surveys/s1', () =>
        HttpResponse.json(
          surveyDetailFactory({ id: 's1', title: 'Term 2 survey', status: 'OPEN' }),
        ),
      ),
      http.get('/api/v1/surveys/s1/results', () =>
        HttpResponse.json(surveyResultsFactory({ surveyId: 's1', minResponses: 5, results: [] })),
      ),
      http.post('/api/v1/surveys/s1/close', () => {
        closed += 1;
        return HttpResponse.json(surveyDetailFactory({ id: 's1', status: 'CLOSED' }));
      }),
    );
    render('/staff/evaluations/surveys/s1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close survey' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(closed).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Close survey' }));
    await waitFor(() => expect(closed).toBe(1));
  });
});

describe('survey form page validation and rows', () => {
  async function open() {
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 });
    return userEvent.setup();
  }

  it('adds and removes target and question rows', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Add another teacher' }));
    expect(screen.getAllByRole('button', { name: /Remove teacher/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove teacher 1' }));
    await user.click(screen.getByRole('button', { name: 'Add a question' }));
    expect(screen.getByLabelText('Question 4')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove question 4' }));
    expect(screen.queryByLabelText('Question 4')).toBeNull();
  });

  it('puts each error under its own field, with a screen-reader summary', async () => {
    const user = await open();
    await user.clear(screen.getByLabelText('Question 1'));
    await user.clear(screen.getByDisplayValue('3'));
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));

    const title = screen.getByLabelText(/^Survey title/);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(await screen.findByText('Enter a title.')).toBeTruthy();
    expect(screen.getByText('Every question needs text.')).toBeTruthy();
    expect(screen.getByText('Minimum answers must be 3 or more.')).toBeTruthy();
    // The row error: a teacher is needed first.
    expect(screen.getByText('Choose a teacher.')).toBeTruthy();
    const summary = screen.getByRole('alert');
    expect(summary.className).toContain('sr-only');
    // The first invalid control takes focus.
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('flags a survey with every question removed', async () => {
    const user = await open();
    for (const b of screen.getAllByRole('button', { name: /Remove question/ })) await user.click(b);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Add at least one question.')).toBeTruthy();
  });

  it('uses date pickers, not browser date inputs', async () => {
    await open();
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Opens on, / })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Closes on, / })).toBeTruthy();
  });
});

describe('survey form page submit', () => {
  async function fill() {
    server.use(
      http.get('/api/v1/subjects', ({ request }) =>
        HttpResponse.json(paginate([subjectFactory()], request.url)),
      ),
    );
    render('/staff/evaluations?tab=surveys&publishSurvey=1');
    await screen.findByRole('dialog', { name: 'New teacher survey' });
    await screen.findByDisplayValue('Explains lessons clearly', undefined, { timeout: 4000 });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Survey title/), 'Term 2');
    for (const label of ['Teacher 1', 'Subject 1']) {
      await user.click(screen.getByRole('combobox', { name: label }));
      await user.click((await screen.findAllByRole('option'))[0]!);
    }
    await pickDate(user, 'Opens on', '2026-05-01');
    await pickDate(user, 'Closes on', '2026-05-10');
    return user;
  }

  it('creates and publishes, then closes the form and drops the URL flag', async () => {
    let published = false;
    server.use(
      http.post('/api/v1/surveys/:id/publish', () => {
        published = true;
        return HttpResponse.json(surveyDetailFactory(), { status: 201 });
      }),
    );
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(published).toBe(true));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New teacher survey' })).toBeNull(),
    );
  });

  it('shows a translated sentence, never the server text or a UUID, when the teacher is not assigned', async () => {
    server.use(
      http.post('/api/v1/surveys', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'A chosen teacher is not assigned to the chosen subject',
            timestamp: 't',
            path: '/',
            requestId: 'r',
          },
          { status: 400 },
        ),
      ),
    );
    const user = await fill();
    await user.click(screen.getByLabelText(/^Survey title/));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(
      await screen.findByText(
        'A teacher is not assigned to the chosen subject. Change the teacher or the subject.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/7c43a1de/)).toBeNull();
  });

  it('retry after a failed publish PATCHes the draft with the edited title, then publishes', async () => {
    const patched: unknown[] = [];
    let creates = 0;
    let publishes = 0;
    server.use(
      http.post('/api/v1/surveys', () => {
        creates += 1;
        return HttpResponse.json(surveyDetailFactory({ id: 'draft-1' }), { status: 201 });
      }),
      http.patch('/api/v1/surveys/:id', async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(surveyDetailFactory({ id: 'draft-1' }));
      }),
      http.post('/api/v1/surveys/:id/publish', () => {
        publishes += 1;
        return publishes === 1
          ? HttpResponse.json(
              { statusCode: 400, message: 'nope', timestamp: 't', path: '/', requestId: 'r' },
              { status: 400 },
            )
          : HttpResponse.json(surveyDetailFactory(), { status: 201 });
      }),
    );
    const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(publishes).toBe(1));
    await user.type(screen.getByLabelText(/^Survey title/), ' edited');
    await user.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(publishes).toBe(2));
    expect(creates).toBe(1);
    expect(patched).toHaveLength(1);
    expect((patched[0] as { title: string }).title).toBe('Term 2 edited');
  });
});
