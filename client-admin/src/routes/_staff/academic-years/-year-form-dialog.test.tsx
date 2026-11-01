import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../help/test-utils';

import { YearFormDialog } from './-year-form-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('YearFormDialog (?) hints [#3293]', () => {
  it('shows the dates and current-year (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(
        <YearFormDialog
          open
          onOpenChange={vi.fn()}
          mode="create"
          isPending={false}
          isError={false}
          onSubmit={vi.fn()}
        />,
      ),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('dialog');
    await expectHelp('academics.academicYears.field.dates');
    await expectHelp('academics.academicYears.field.isCurrent');
  });
});
