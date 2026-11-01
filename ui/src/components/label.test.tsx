import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';

import { HelpProvider, type HelpIndex } from './help-hint';
import { Label, type LabelProps } from './label';

const index: HelpIndex = {
  'x.field.name': {
    title: { bn: 'পাতা', en: 'Page title' },
    summary: { bn: 'নাম', en: 'Name help' },
    path: 'p',
    anchor: '',
    knownIssues: 0,
  },
};

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

function renderLabel(withProvider: boolean, props: LabelProps = {}) {
  const label = (
    <>
      <Label htmlFor="n" {...props}>
        Name
      </Label>
      <input id="n" />
    </>
  );
  return render(
    withProvider ? (
      <HelpProvider index={index} lang="en" baseUrl="https://g.test">
        {label}
      </HelpProvider>
    ) : (
      label
    ),
  );
}

describe('Label helpId', () => {
  it('names the (?) after the label text, not the guide page title', async () => {
    renderLabel(true, { helpId: 'x.field.name' });
    expect(await screen.findByRole('button', { name: 'Help: Name' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Page title/ })).toBeNull();
  });

  it('clicking the label still focuses the input; the (?) is a sibling', async () => {
    renderLabel(true, { helpId: 'x.field.name' });
    await screen.findByRole('button', { name: 'Help: Name' });
    await userEvent.click(screen.getByText('Name'));
    expect(document.activeElement).toBe(document.getElementById('n'));
    expect(screen.getByText('Name').closest('label')?.querySelector('button')).toBeNull();
  });

  it('helpLabel overrides the text', async () => {
    renderLabel(true, { helpId: 'x.field.name', helpLabel: 'Full name' });
    expect(await screen.findByRole('button', { name: 'Help: Full name' })).toBeTruthy();
  });

  it('keeps its DOM (no wrapper) when the hint does not resolve', () => {
    const { container } = renderLabel(false, { helpId: 'x.field.name' });
    expect(container.firstElementChild?.tagName).toBe('LABEL');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
