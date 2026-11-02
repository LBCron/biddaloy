import type { ReportLayoutType } from '@biddaloy/shared';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../../test';

import { useDesignerLabels } from './labels';
import { LayoutSwitcher } from './layout-switcher';
import { suggestLayout, type LayoutSuggestion } from './suggest-layout';

afterEach(cleanupTestState);

function Harness({ suggestion }: { suggestion: LayoutSuggestion }) {
  const [value, setValue] = React.useState<ReportLayoutType>(suggestion.layout);
  const labels = useDesignerLabels();
  return (
    <LayoutSwitcher
      value={value}
      onChange={setValue}
      suggestion={suggestion}
      labels={labels.layout}
    />
  );
}

const twoSplits = suggestLayout({
  splitBy: [
    { key: 'class', isDate: false },
    { key: 'section', isDate: false },
  ],
  counts: ['students'],
});

async function open(suggestion = twoSplits, locale: 'en' | 'bn' = 'en') {
  const view = renderWithProviders(<Harness suggestion={suggestion} />, { locale });
  await view.localeReady;
  await screen.findByRole('group');
  return view;
}

describe('LayoutSwitcher', () => {
  it('shows four picture buttons with the suggestion chosen and its reason, axe clean', async () => {
    const { container } = await open();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'TABLE',
      'GROUPED',
      'CROSSTAB',
      'CHART',
    ]);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Table of counts/ }).checked).toBe(
      true,
    );
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'You picked two splits, so a table of rows and columns is shown',
    );
    await expect(container).toHaveNoViolations();
  });

  it('says it in Bangla, with the ticket wording', async () => {
    await open(twoSplits, 'bn');
    expect(screen.getByRole('status').textContent).toBe(
      'দুটি ভাগ বেছেছেন, তাই সারি-কলামের ছক দেখানো হচ্ছে',
    );
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      expect.stringContaining('তালিকা'),
      expect.stringContaining('দলভিত্তিক'),
      expect.stringContaining('ছক'),
      expect.stringContaining('চার্ট'),
    ]);
  });

  it('always allows a manual switch, and goes back to the suggestion on request', async () => {
    const { user } = await open();
    await user.click(screen.getByRole<HTMLInputElement>('radio', { name: /Chart/ }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Chart/ }).checked).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('You chose this yourself.');

    await user.click(screen.getByRole('button', { name: 'Use the suggestion' }));
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Table of counts/ }).checked).toBe(
      true,
    );
  });

  it('moves between the buttons with the arrow keys', async () => {
    const { user } = await open();
    screen.getByRole<HTMLInputElement>('radio', { name: /Table of counts/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Chart/ }).checked).toBe(true);
  });

  it('writes no jargon', async () => {
    const { container } = await open();
    expect(container.textContent).not.toMatch(/dimension|measure|crosstab|aggregate/i);
  });
});
