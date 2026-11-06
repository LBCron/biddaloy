/**
 * `AppHeader` is pure layout — no loading/error/disabled state of its
 * own, same reasoning `app-shell.stories.tsx`'s own header comment gives
 * for `AppShell`. `Default` shows the full staff-shell control set;
 * `MinimalPortal` shows the lighter set `portal.tsx` actually renders
 * (identity + sync status + theme only — no search, no notifications,
 * see that route file's own comment on why).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserIcon } from 'lucide-react';

import { AppHeader } from './app-header';
import { Button } from './button';
import { NotificationBell } from './notification-bell';

const meta: Meta<typeof AppHeader> = {
  title: 'Components/AppHeader',
  component: AppHeader,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AppHeader>;

function Identity() {
  return (
    <>
      <span className="truncate font-semibold text-foreground">Greenview School</span>
      <span className="text-muted-foreground">Admin</span>
    </>
  );
}

export const Default: Story = {
  args: {
    start: <Identity />,
    end: (
      <>
        <Button variant="ghost" size="sm">
          Search… Ctrl+K
        </Button>
        <NotificationBell
          label="Notifications"
          panelTitle="Notifications"
          emptyLabel="You're all caught up."
          markAllReadLabel="Mark all read"
        />
        <Button variant="ghost" size="icon" iconOnly aria-label="Account menu">
          <UserIcon />
        </Button>
      </>
    ),
  },
};

/** The guardian portal's lighter control set — identity, sync status, and
 * theme only, per `client-admin/src/routes/portal.tsx`'s own comment on
 * why search/notifications don't apply there yet. */
export const MinimalPortal: Story = {
  args: {
    start: <Identity />,
    end: (
      <Button variant="ghost" size="icon" iconOnly aria-label="Theme">
        <UserIcon />
      </Button>
    ),
  },
};
