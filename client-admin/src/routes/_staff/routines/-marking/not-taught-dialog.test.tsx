import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectHelp, withHelp } from '../../../../help/test-utils';

import { NotTaughtDialog } from './not-taught-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('NotTaughtDialog (?) hint [#3293]', () => {
  it('shows the reason (?)', async () => {
    const { localeReady } = renderWithProviders(
      withHelp(
        <NotTaughtDialog
          open
          onOpenChange={vi.fn()}
          section="Class 6 A"
          subject="Math"
          period="1"
          lessonTitle="Fractions"
          pending={false}
          error={false}
          onCloseFocus={vi.fn()}
          onSubmit={vi.fn()}
        />,
      ),
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;
    await screen.findByRole('dialog');
    await expectHelp('academics.myRoutine.field.notTaughtReason');
    // The legend shows once (no hidden copy) and the (?) sits outside it, named for it.
    expect(screen.getAllByText('Reason')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Reason' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Help: Reason' })).toBeTruthy();
  });
});
