import { ROLE_PERMISSIONS, UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RoleCard } from './-role-card';

afterEach(async () => {
  await cleanupTestState();
});

async function renderCard(role: UserRole, locale: 'en' | 'bn' = 'en') {
  const { localeReady } = renderWithProviders(<RoleCard role={role} />, {
    locale,
    tenantId: 'tenant-1',
    role: 'ADMIN',
  });
  await localeReady;
}

describe('RoleCard', () => {
  it('renders label, description, scope and permission count', async () => {
    await renderCard(UserRole.COMMITTEE);

    expect(await screen.findByRole('heading', { name: 'Committee member' })).toBeTruthy();
    expect(
      screen.getByText(
        'Read-only view of the dashboard, staff evaluations and the calendar. No student details.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Whole school')).toBeTruthy();
    expect(ROLE_PERMISSIONS[UserRole.COMMITTEE]).toHaveLength(6);
    expect(screen.getByText('6 permissions')).toBeTruthy();
  });

  it("lists all of COMMITTEE's permissions in collapsible groups", async () => {
    await renderCard(UserRole.COMMITTEE);
    await screen.findByRole('heading', { name: 'Committee member' });

    const groups = document.querySelectorAll('details');
    expect(groups.length).toBeGreaterThan(0);
    const items = document.querySelectorAll('details li');
    expect(items).toHaveLength(6);
    for (const group of groups) expect(group.open).toBe(false);
  });

  it('shows a narrower scope for TEACHER', async () => {
    await renderCard(UserRole.TEACHER);

    expect(await screen.findByText('Assigned sections only')).toBeTruthy();
  });

  it('renders in Bangla', async () => {
    await renderCard(UserRole.EXECUTIVE, 'bn');

    const heading = await screen.findByRole('heading', { name: 'একাডেমিক কো-অর্ডিনেটর' });
    expect(within(heading.parentElement as HTMLElement).queryByText('নির্বাহী')).toBeNull();
  });
});
