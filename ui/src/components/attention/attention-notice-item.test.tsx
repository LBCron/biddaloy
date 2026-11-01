import { AlertCategory, AlertSource } from '@biddaloy/shared';
import { createRootRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { alertItemFactory } from '../../test/factories/attention.factory';
import { renderWithRouter } from '../../test/render-with-router';

import {
  AttentionNoticeItem,
  NOTICE_IMPORTANT,
  NOTICE_SMS_APPROVAL,
  isNoticeAlert,
  noticeIdOf,
  type AttentionNoticeItemProps,
} from './attention-notice-item';

const important = alertItemFactory({
  source: AlertSource.NOTICE,
  category: AlertCategory.NOTICE,
  ruleKey: NOTICE_IMPORTANT,
  title: 'Exam routine',
  actionUrl: '/communications/notices/n-1',
});
const sms = alertItemFactory({
  source: AlertSource.NOTICE,
  category: AlertCategory.NOTICE,
  ruleKey: NOTICE_SMS_APPROVAL,
  title: 'Exam routine',
  actionUrl: '/communications/notices/n-1?sms=1',
});

async function renderItem(props: Partial<AttentionNoticeItemProps> & { item: typeof important }) {
  const root = createRootRoute({
    component: () => <AttentionNoticeItem onAcknowledge={vi.fn()} {...props} />,
  });
  const view = renderWithRouter(root, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  await waitFor(() => expect(view.container.querySelector('a')).not.toBeNull());
}

describe('AttentionNoticeItem', () => {
  it('important: opens the notice and acknowledges by notice id', async () => {
    const onAcknowledge = vi.fn();
    await renderItem({ item: important, onAcknowledge });
    expect(screen.getByRole('link', { name: 'Open notice' }).getAttribute('href')).toBe(
      '/communications/notices/n-1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read: Exam routine' }));
    expect(onAcknowledge).toHaveBeenCalledWith('n-1');
  });

  it('important: button is disabled while busy', async () => {
    await renderItem({ item: important, busy: true });
    expect(screen.getByRole('button', { name: /Mark as read/ })).toHaveProperty('disabled', true);
  });

  it('sms approval: only a link to ?sms=1, no inline approve', async () => {
    await renderItem({ item: sms });
    expect(screen.getByRole('link', { name: 'See' }).getAttribute('href')).toBe(
      '/communications/notices/n-1?sms=1',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('helpers pick notice alerts and the notice id', () => {
    expect(isNoticeAlert(important)).toBe(true);
    expect(isNoticeAlert(alertItemFactory())).toBe(false);
    expect(noticeIdOf(sms)).toBe('n-1');
  });
});
