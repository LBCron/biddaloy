import type { AdmissionApplicantDto } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../help/test-utils';

import { AdmitApplicantModal } from './AdmitApplicantModal';
import { EvaluateApplicantForm } from './EvaluateApplicantForm';
import { EMPTY_INTAKE_FORM, IntakeForm } from './IntakeForm';

afterEach(async () => {
  await cleanupTestState();
});

describe('admission (?) hints [#3293]', () => {
  it('shows the intake dates (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(<IntakeForm value={EMPTY_INTAKE_FORM} onChange={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByLabelText(/title/i);
    await expectHelp('people.admissionIntakes.field.dates');
  });

  it('shows the evaluation notes (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(<EvaluateApplicantForm applicantId="a-1" open onOpenChange={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('dialog');
    await expectHelp('people.admissionApplicants.field.notes');
  });

  it('shows the guardian choice (?) when a guardian matches [#3314]', async () => {
    server.use(
      http.get('/api/v1/admission/applicants/a-1/guardian-match', () =>
        HttpResponse.json({
          guardian: {
            id: 'g-1',
            full_name: 'Rahim Uddin',
            phone: '01711111111',
            student_names: [],
          },
        }),
      ),
    );
    const applicant = {
      id: 'a-1',
      applicant_name: 'Karim',
      guardian_name: 'Rahim Uddin',
      guardian_phone: '01711111111',
      status: 'SHORTLISTED',
    } as AdmissionApplicantDto;
    const { localeReady } = renderWithProviders(
      withHelp(<AdmitApplicantModal applicant={applicant} open onOpenChange={vi.fn()} />),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByText(/Existing guardian: Rahim Uddin/);
    await expectHelp('people.admissionApplicants.field.guardianChoice');
  });
});
