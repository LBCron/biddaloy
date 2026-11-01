import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, guardianFactory, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { EditGuardianDialog } from './-edit-guardian-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('EditGuardianDialog (?) hint [#3293]', () => {
  it('shows the preferred channel (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(
        <EditGuardianDialog guardian={guardianFactory()} config={REGION_BD_BN} onClose={vi.fn()} />,
      ),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('dialog');
    await expectHelp('people.guardians.field.preferredCommunication');
  });
});
