import { AlertCategory, AlertSource } from '@biddaloy/shared';
import { createRootRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { alertItemFactory } from '../../test/factories/attention.factory';
import { renderWithRouter } from '../../test/render-with-router';

import { AlertItemCard } from './alert-item-card';
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
  actionUrl: '/communications/notices/11111111-1111-4111-8111-111111111111',
});
const sms = alertItemFactory({
  source: AlertSource.NOTICE,
  category: AlertCategory.NOTICE,
  ruleKey: NOTICE_SMS_APPROVAL,
  title: 'Exam routine',
  actionUrl: '/communications/notices/11111111-1111-4111-8111-111111111111?sms=1',
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
      '/communications/notices/11111111-1111-4111-8111-111111111111',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark as read: Exam routine' }));
    expect(onAcknowledge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', important);
  });

  it('with onOpen the open action is a button that calls it, not a link', async () => {
    const onOpen = vi.fn();
    const root = createRootRoute({
      component: () => <AttentionNoticeItem item={important} onOpen={onOpen} />,
    });
    const view = renderWithRouter(root, { locale: 'en' });
    await act(async () => {
      await view.localeReady;
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open notice' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('important: button is disabled while busy', async () => {
    await renderItem({ item: important, busy: true });
    expect(screen.getByRole('button', { name: /Mark as read/ })).toHaveProperty('disabled', true);
  });

  it('sms approval: only a link to ?sms=1, no inline approve', async () => {
    await renderItem({ item: sms });
    expect(screen.getByRole('link', { name: 'See' }).getAttribute('href')).toBe(
      '/communications/notices/11111111-1111-4111-8111-111111111111?sms=1',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('helpers pick notice alerts and the notice id', () => {
    expect(isNoticeAlert(important)).toBe(true);
    expect(isNoticeAlert(alertItemFactory())).toBe(false);
    expect(noticeIdOf(sms)).toBe('11111111-1111-4111-8111-111111111111');
    expect(
      noticeIdOf({ actionUrl: '/communications/notices/11111111-1111-4111-8111-111111111111/' }),
    ).toBe('11111111-1111-4111-8111-111111111111');
    expect(noticeIdOf({ actionUrl: '/communications/notices/not-a-uuid' })).toBeUndefined();
  });

  it('important: a non-UUID id shows the link only, no acknowledge', async () => {
    await renderItem({ item: { ...important, actionUrl: '/communications/notices/n-1' } });
    expect(screen.getByRole('link', { name: 'Open notice' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AlertItemCard with notice alerts', () => {
  async function renderCard(item: typeof important) {
    const onAcknowledge = vi.fn();
    const onPrimary = vi.fn();
    const root = createRootRoute({
      component: () => (
        <ul>
          <AlertItemCard
            item={item}
            onPrimary={onPrimary}
            onHide={vi.fn()}
            onSnooze={vi.fn()}
            onAcknowledge={onAcknowledge}
          />
        </ul>
      ),
    });
    const view = renderWithRouter(root, { locale: 'en' });
    await act(async () => {
      await view.localeReady;
    });
    // the card opens through onPrimary (a button), so wait for the open action, not a link
    await screen.findByRole('button', { name: /Open notice|See/ });
    return { onAcknowledge, onPrimary };
  }

  it('important: Mark as read only, no Close, no Snooze', async () => {
    const item = { ...important, closable: true };
    const { onAcknowledge } = await renderCard(item);
    expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
    expect(screen.queryByText('Snooze')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Mark as read/ }));
    expect(onAcknowledge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', item);
  });

  it('important: Open notice runs onPrimary, so the modal closes and does not return focus', async () => {
    const { onPrimary } = await renderCard(important);
    await userEvent.click(screen.getByRole('button', { name: 'Open notice' }));
    expect(onPrimary).toHaveBeenCalledWith(important);
  });

  it('sms approval: one See action through onPrimary, no inline approve', async () => {
    const { onPrimary } = await renderCard(sms);
    expect(screen.queryByRole('link')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See' }));
    expect(onPrimary).toHaveBeenCalledWith(sms);
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
});
