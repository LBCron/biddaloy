import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { FinalResultCard } from './-final-result-card';

function finalCard(overrides: Record<string, unknown> = {}) {
  return {
    final_result_id: 'fr-1',
    academic_year_name: '2026',
    student: { full_name: 'Fatima', roll_number: 14 },
    final: { total_marks: 880, gpa: 4.67, grade: 'A', position: 2, is_fail: false },
    exams: [
      { exam_id: 'e1', exam_name: 'Half-yearly', total_marks: 400, gpa: 4.5 },
      { exam_id: 'e2', exam_name: 'Annual', total_marks: 480, gpa: 4.8 },
    ],
    exam_shares: [
      { exam_id: 'e1', share_percent: 40 },
      { exam_id: 'e2', share_percent: 60 },
    ],
    subjects: [],
    legend: [],
    attendance: { working_days: 200, present_days: 190 },
    remark: 'Keep it up',
    conduct: [
      { key: 'discipline', name_bn: 'শৃঙ্খলা', name_en: 'Discipline', grade: 'A' },
      { key: 'sports', name_bn: '', name_en: '', grade: null },
    ],
    issuer: {},
    logo_url: null,
    ...overrides,
  };
}

function renderCard(body: unknown) {
  server.use(
    http.get('/api/v1/students/:id/final-result-card', () =>
      body ? HttpResponse.json(body) : HttpResponse.json({ message: 'Not found' }, { status: 404 }),
    ),
  );
  return renderPortalCard(
    <FinalResultCard
      studentId="kid-a"
      academicYearId="y1"
      childName="Fatima"
      className="Class 8"
    />,
  );
}

describe('FinalResultCard', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders title, GPA, grade, position, shares, attendance, remark and conduct', async () => {
    renderCard(finalCard());

    expect(
      await screen.findByRole('heading', { name: 'Final result 2026 — Class 8' }),
    ).toBeTruthy();
    expect(screen.getAllByText(/GPA 4\.67/).length).toBeGreaterThan(0);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('4.67');
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByText('Half-yearly 40% · Annual 60%')).toBeTruthy();
    expect(screen.getByText('Present 190 of 200 days (95%)')).toBeTruthy();
    expect(screen.getByText('Keep it up')).toBeTruthy();
    expect(screen.getByText('Discipline: A')).toBeTruthy();
  });

  it('falls back to the key when a conduct item has no name, and a dash for no grade', async () => {
    renderCard(finalCard());
    expect(await screen.findByText('sports: —')).toBeTruthy();
  });

  it('hides the remark and attendance blocks when they are missing', async () => {
    renderCard(finalCard({ remark: null, attendance: { working_days: null, present_days: null } }));
    await screen.findByRole('heading', { name: /Final result/ });
    expect(screen.queryByText('Keep it up')).toBeNull();
    expect(screen.queryByText(/Present .* of/)).toBeNull();
  });

  it('opens the per-exam details from the button', async () => {
    renderCard(finalCard());
    await userEvent.click(await screen.findByRole('button', { name: 'Details and card' }));
    expect(screen.getByRole('cell', { name: 'Annual' })).toBeTruthy();
  });

  it('shows Absent, not 0 or a dash, for an exam with no marks', async () => {
    renderCard(
      finalCard({
        exams: [{ exam_id: 'e1', exam_name: 'Half-yearly', total_marks: null, gpa: null }],
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Details and card' }));
    expect(screen.getByRole('cell', { name: 'Absent' })).toBeTruthy();
  });

  it('renders nothing when no final is published (404)', async () => {
    const { container } = renderCard(null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('article')).toBeNull();
  });
});
