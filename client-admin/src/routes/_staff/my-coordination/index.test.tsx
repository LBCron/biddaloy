import {
  apiErrorBody,
  cleanupTestState,
  renderWithRouter,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [83.4.1] Academics › My coordination against the real route tree, as a TEACHER. */
const teachers = [
  {
    user_id: 'u-maths',
    teacher_id: 't-maths',
    full_name: 'Maths Teacher',
    section_names: ['A'],
    subject_names: ['Mathematics'],
  },
  {
    user_id: 'u-bangla',
    teacher_id: 't-bangla',
    full_name: 'Bangla Teacher',
    section_names: ['B'],
    subject_names: ['Bangla'],
  },
];
const classX = {
  class_id: 'k6',
  class_name: 'Class 6',
  subject_id: null,
  subject_name: null,
  sections: [
    {
      section_id: 's-a',
      section_name: 'A',
      attendance_taken: true,
      taken_by_name: 'Maths Teacher',
      class_teacher_name: 'Maths Teacher',
    },
    {
      section_id: 's-b',
      section_name: 'B',
      attendance_taken: false,
      taken_by_name: null,
      class_teacher_name: null,
    },
  ],
  pending_grids: [
    {
      exam_id: 'e1',
      exam_name: 'Term 1',
      section_id: 's-b',
      section_name: 'B',
      subject_id: 'm1',
      subject_name: 'Mathematics',
      teacher_name: 'Maths Teacher',
      state: 'DRAFT',
    },
  ],
  teachers,
};
const classY = { ...classX, class_id: 'k7', class_name: 'Class 7', pending_grids: [] };
const NEVER_SAY = /\b(scope|slice|grant|recipient|audience|widen)\b/i;

function mockOverview(classes: unknown[]) {
  server.use(
    http.get('/api/v1/coordination/overview', () =>
      HttpResponse.json({ date: '2026-10-20', classes }),
    ),
  );
}

function render(entry = '/my-coordination') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-coordination', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state for a teacher who coordinates nothing (D25)', async () => {
    mockOverview([]);
    render();
    expect(
      await screen.findByText('You are not a coordinator of any class yet — ask an admin.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'My coordination' })).toBeTruthy();
  });

  it('one card per class; a not-taken section links to its register; pending grids listed', async () => {
    mockOverview([classX, classY]);
    render();
    expect(await screen.findByRole('heading', { level: 2, name: 'Class 6' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Class 7' })).toBeTruthy();
    const card = screen.getByRole('article', { name: 'Class 6' });
    const notTaken = within(card).getByText('Not taken').closest('a');
    expect(notTaken?.getAttribute('href')).toBe('/attendance/s-b?date=2026-10-20');
    expect(within(card).getByText('Term 1 · Mathematics · B')).toBeTruthy();
    expect(document.body.textContent ?? '').not.toMatch(NEVER_SAY);
  });

  it('an impossible ?date= falls back to the school day instead of crashing', async () => {
    let asked = '';
    server.use(
      http.get('/api/v1/coordination/overview', ({ request }) => {
        asked = new URL(request.url).search;
        return HttpResponse.json({ date: '2026-10-20', classes: [classX] });
      }),
    );
    render('/my-coordination?date=2026-13-45');
    expect(await screen.findByRole('heading', { level: 2, name: 'Class 6' })).toBeTruthy();
    expect(asked).toBe('');
  });

  it('?then=notify opens the dialog with every teacher of the first class pre-checked', async () => {
    mockOverview([classX]);
    render('/my-coordination?then=notify');
    const dialog = await screen.findByRole('dialog', { name: 'Notify teachers' });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  it('unchecking a teacher posts the rest; a 422 shows the sentence beside Send', async () => {
    mockOverview([classX]);
    let body: unknown;
    server.use(
      http.post('/api/v1/coordination/alerts', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(apiErrorBody(422, 'x', '/api/v1/coordination/alerts'), {
          status: 422,
        });
      }),
    );
    const user = userEvent.setup();
    render('/my-coordination?then=notify');
    const dialog = await screen.findByRole('dialog', { name: 'Notify teachers' });
    await user.click(within(dialog).getAllByRole('checkbox')[1]!);
    await user.type(within(dialog).getByRole('textbox'), 'Marks by Thursday.');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(body).toEqual({ userIds: ['u-maths'], message: 'Marks by Thursday.' }),
    );
    expect(
      await within(dialog).findByText(
        'None of the chosen teachers teach the classes you coordinate.',
      ),
    ).toBeTruthy();
  });
});
