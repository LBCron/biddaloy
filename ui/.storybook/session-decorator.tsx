import type { Decorator } from '@storybook/react-vite';

import { setActiveRole, setActiveTenant } from '../src/api/auth-state';

/**
 * Signs a story in as `role` in a fake tenant, so `apiClient` sends `X-Tenant-ID` (it refuses to
 * send a request without one) and permission checks see the role. Set on every render, not once at
 * module level: a story smoke test resets the auth state after each test.
 */
export function withSession(role: string, tenantId = 'story-tenant'): Decorator {
  // eslint-disable-next-line react/display-name -- a factory, same reason as `withMemoryRouter`
  return (StoryFn) => {
    setActiveTenant(tenantId);
    setActiveRole(role);
    return <StoryFn />;
  };
}
