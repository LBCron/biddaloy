import type { SiteAnnouncementBar } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders, userEvent } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AnnouncementsEditor, announcementsInvalid } from './-announcements-editor';

const item = (id: string, extra = {}) => ({
  id,
  text: { bn: 'ঘোষণা', en: 'Notice' },
  enabled: true,
  ...extra,
});
const bar = (items: SiteAnnouncementBar['items'], style = 'static'): SiteAnnouncementBar =>
  ({ style, speed: 'NORMAL', items }) as SiteAnnouncementBar;

/** Holds the bar like the Pages tab does and exposes the latest value. */
function Harness({
  initial,
  seen,
}: {
  initial: SiteAnnouncementBar;
  seen: { value: SiteAnnouncementBar };
}) {
  const [value, setValue] = React.useState(initial);
  seen.value = value;
  return <AnnouncementsEditor value={value} onChange={setValue} />;
}

async function show(ui: React.ReactElement) {
  const { localeReady } = renderWithProviders(ui, { locale: 'en' });
  await localeReady;
}

describe('AnnouncementsEditor', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('adds a row, and stops at five', async () => {
    const seen = { value: bar([]) };
    await show(<Harness initial={bar([item('1'), item('2'), item('3'), item('4')])} seen={seen} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add an announcement' }));
    expect(seen.value.items).toHaveLength(5);
    expect(
      (screen.getByRole('button', { name: 'Add an announcement' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('You can keep at most 5 announcements.')).toBeTruthy();
  });

  it('removes a row', async () => {
    const seen = { value: bar([]) };
    await show(<Harness initial={bar([item('1'), item('2')])} seen={seen} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Remove announcement/ })[0]!);
    expect(seen.value.items.map((a) => a.id)).toEqual(['2']);
  });

  it('refuses an end date before the start date', async () => {
    const seen = { value: bar([]) };
    await show(
      <Harness
        initial={bar([item('1', { from: '2026-05-10', until: '2026-05-01' })])}
        seen={seen}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'The end date cannot be before the start date.',
    );
    expect(announcementsInvalid(seen.value)).toBe(true);
    expect(
      announcementsInvalid(bar([item('1', { from: '2026-05-01', until: '2026-05-01' })])),
    ).toBe(false);
  });

  it('refuses a link that leaves the site', () => {
    expect(announcementsInvalid(bar([item('1', { href: '//evil.example' })]))).toBe(true);
    expect(announcementsInvalid(bar([item('1', { href: '/notices' })]))).toBe(false);
  });

  it('saves the style and the speed (speed only for moving text)', async () => {
    const seen = { value: bar([]) };
    await show(<Harness initial={bar([item('1')])} seen={seen} />);
    expect(screen.queryByLabelText('Speed')).toBeNull();
    await userEvent.click(screen.getByRole('combobox', { name: 'How it shows' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Moving text' }));
    expect(seen.value.style).toBe('marquee');
    await userEvent.click(await screen.findByRole('combobox', { name: 'Speed' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Fast' }));
    expect(seen.value.speed).toBe('FAST');
  });

  it('drops an emptied date from the stored row', async () => {
    const seen = { value: bar([]) };
    await show(<Harness initial={bar([item('1', { from: '2026-05-01' })])} seen={seen} />);
    await userEvent.clear(screen.getByLabelText('Show from'));
    expect('from' in seen.value.items[0]!).toBe(false);
  });

  it('needs the Bangla text, and cuts text at 2000 characters', async () => {
    const seen = { value: bar([]) };
    await show(<Harness initial={bar([item('1', { text: { bn: '', en: '' } })])} seen={seen} />);
    expect(screen.getByText('Write the Bangla text.')).toBeTruthy();
    expect(announcementsInvalid(seen.value)).toBe(true);
    await userEvent.click(screen.getAllByRole('textbox')[0]!);
    await userEvent.paste('x'.repeat(2100));
    expect(seen.value.items[0]!.text.bn).toHaveLength(2000);
    expect(announcementsInvalid(seen.value)).toBe(false);
  });
});
