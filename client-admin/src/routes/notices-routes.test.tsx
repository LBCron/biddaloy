/**
 * [53.4.01] The six notice routes are thin wrappers: each registers at the right path with a
 * component, a loader and a pending component. The screens themselves are tested under
 * `features/notices`; gating is covered by `route-permissions.test.ts` and `portal.layout.test.tsx`.
 */
import { describe, expect, it } from 'vitest';

import { Route as StaffEdit } from './_staff/communications/notices/$noticeId/edit';
import { Route as StaffDetail } from './_staff/communications/notices/$noticeId/index';
import { Route as StaffList } from './_staff/communications/notices/index';
import { Route as StaffNew } from './_staff/communications/notices/new';
import { Route as PortalDetail } from './portal/notices/$noticeId';
import { Route as PortalList } from './portal/notices/index';

describe('notice routes', () => {
  it.each([
    ['/_staff/communications/notices/', StaffList],
    ['/_staff/communications/notices/new', StaffNew],
    ['/_staff/communications/notices/$noticeId/', StaffDetail],
    ['/_staff/communications/notices/$noticeId/edit', StaffEdit],
    ['/portal/notices/', PortalList],
    ['/portal/notices/$noticeId', PortalDetail],
  ] as const)('%s is wired with component, loader and pending state', (_id, route) => {
    expect(route.options.component).toBeTypeOf('function');
    expect(route.options.loader).toBeTypeOf('function');
    expect(route.options.pendingComponent).toBeTypeOf('function');
  });
});
