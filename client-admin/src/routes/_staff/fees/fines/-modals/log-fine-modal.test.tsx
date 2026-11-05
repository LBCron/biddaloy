import { FeeType } from '@biddaloy/shared';
import { notifyOutcome } from '@biddaloy/ui/api';
import {
  cleanupTestState,
  feeStructureFactory,
  renderWithProviders,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogFineModal } from './log-fine-modal';

vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome: vi.fn(),
}));

const fineStructure = feeStructureFactory({
  fee_type: FeeType.FINE,
  name: 'Late fine',
  amount: 100,
});
const otherFineStructure = feeStructureFactory({
  fee_type: FeeType.FINE,
  name: 'Uniform fine',
  amount: 200,
});
const student1 = studentFactory({ full_name: 'Karim Rahman' });
const student2 = studentFactory({ full_name: 'Fatima Begum' });

function withFineStructures() {
  return http.get('/api/v1/fee-structures', () =>
    HttpResponse.json({
      data: [fineStructure, otherFineStructure],
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  );
}

function withStudentSearch() {
  return http.get('/api/v1/students', () =>
    HttpResponse.json({ data: [student1, student2], total: 2, page: 1, limit: 20, totalPages: 1 }),
  );
}

async function renderModal(props: { prefillStudentIds?: string[] } = {}) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(<LogFineModal open onOpenChange={onOpenChange} {...props} />, {
    tenantId: 'tenant-1',
    locale: 'en',
  });
  await view.localeReady;
  return { ...view, onOpenChange };
}

describe('LogFineModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prefills the amount from the chosen fine type and stays editable', async () => {
    server.use(withFineStructures());
    const user = userEvent.setup();
    await renderModal();

    await user.click(await screen.findByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Late fine' }));

    const amountInput = await screen.findByRole('textbox', { name: 'Amount' });
    await waitFor(() => expect((amountInput as HTMLInputElement).value).not.toBe(''));

    await user.clear(amountInput);
    await user.type(amountInput, '150');
    expect((amountInput as HTMLInputElement).value).toContain('150');
  });

  it('blocks submit without a reason', async () => {
    server.use(withFineStructures(), withStudentSearch());
    const user = userEvent.setup();
    await renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Students' }), 'Karim');
    await user.click(await screen.findByRole('button', { name: /Karim Rahman/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Late fine' }));

    const submitButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Log fine' });
    expect(submitButton.disabled).toBe(true);
  });

  it('submits one request with both selected students', async () => {
    let requestBody: unknown;
    server.use(
      withFineStructures(),
      withStudentSearch(),
      http.post('/api/v1/fees/fines', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ bill_ids: ['bill-1', 'bill-2'] }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    await renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Students' }), 'a');
    await user.click(await screen.findByRole('button', { name: /Karim Rahman/ }));
    await user.click(await screen.findByRole('button', { name: /Fatima Begum/ }));

    await user.click(await screen.findByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Late fine' }));

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Late twice this week');

    await user.click(screen.getByRole('button', { name: 'Log fine' }));

    await waitFor(() => expect(requestBody).toBeTruthy());
    expect((requestBody as { student_ids: string[] }).student_ids).toEqual([
      student1.id,
      student2.id,
    ]);
    // Two bills came back, so the toast uses the plural form.
    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ message: '2 fines logged' }),
      ),
    );
  });

  it('renders as a full-page frame with a labelled date picker', async () => {
    server.use(withFineStructures());
    await renderModal();

    expect(await screen.findByRole('heading', { level: 1, name: 'Log fine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Incident date, / })).toBeTruthy();
  });

  it('names the chip remove button "Remove <name>"', async () => {
    server.use(withFineStructures(), withStudentSearch());
    const user = userEvent.setup();
    await renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Students' }), 'Karim');
    await user.click(await screen.findByRole('button', { name: /Karim Rahman/ }));
    expect(screen.getByRole('button', { name: 'Remove Karim Rahman' })).toBeTruthy();
  });

  it('shows the translated sentence, never the server text, when saving fails', async () => {
    server.use(
      withFineStructures(),
      withStudentSearch(),
      http.post('/api/v1/fees/fines', () =>
        HttpResponse.json({ statusCode: 400, message: 'Raw server text' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    await renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Students' }), 'Karim');
    await user.click(await screen.findByRole('button', { name: /Karim Rahman/ }));
    await user.click(await screen.findByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Late fine' }));
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Late twice this week');
    await user.click(screen.getByRole('button', { name: 'Log fine' }));

    expect(await screen.findByText('Failed to log fine')).toBeTruthy();
    expect(screen.queryByText('Raw server text')).toBeNull();
  });

  it('preselects prefillStudentIds and shows their names', async () => {
    server.use(
      withFineStructures(),
      http.get('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(params.id === student1.id ? student1 : student2),
      ),
    );
    await renderModal({ prefillStudentIds: [student1.id, student2.id] });

    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
    expect(await screen.findByText('Fatima Begum')).toBeTruthy();
  });
});
