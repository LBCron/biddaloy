import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';

import { HelpProvider, type HelpIndex } from './help-hint';
import { RadioRows } from './radio-rows';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

const options = [
  { value: 'a', title: 'Template A', caption: 'Ten lessons' },
  { value: 'b', title: 'Template B', caption: 'Six lessons', disabled: true },
  { value: 'c', title: 'Template C' },
];

function setup() {
  const onValueChange = vi.fn();
  render(
    <RadioRows value="a" onValueChange={onValueChange} options={options} legend="Templates" />,
  );
  return onValueChange;
}

describe('RadioRows', () => {
  it('names the fieldset by its legend', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Templates' })).toBeTruthy();
  });

  it('names the radiogroup by the legend too', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Templates' })).toBeTruthy();
  });

  it('a label query for the legend finds one element, the radiogroup', () => {
    setup();
    expect(screen.getAllByLabelText('Templates')).toEqual([screen.getByRole('radiogroup')]);
  });

  it('names each radio by its title only; the caption is the description, read once', () => {
    setup();
    const radio = screen.getByRole('radio', { name: 'Template A' });
    const id = radio.getAttribute('aria-describedby');
    expect(document.getElementById(id as string)?.textContent).toBe('Ten lessons');
  });

  it('clicking the caption selects too', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioRows value="c" onValueChange={onValueChange} options={options} legend="Templates" />,
    );
    await userEvent.click(screen.getByText('Template A'));
    expect(onValueChange).toHaveBeenCalledWith('a');
  });

  it('clicking the label selects', async () => {
    const onValueChange = setup();
    await userEvent.click(screen.getByText('Template C'));
    expect(onValueChange).toHaveBeenCalledWith('c');
  });

  it('disabled option cannot be chosen', async () => {
    const onValueChange = setup();
    await userEvent.click(screen.getByText('Template B'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  describe('helpId', () => {
    const index: HelpIndex = {
      'x.field.t': {
        title: { bn: 'পাতা', en: 'Page title' },
        summary: { bn: 'ক', en: 'Pick one' },
        path: 'p',
        anchor: '',
        knownIssues: 0,
      },
    };
    const rows = (
      <RadioRows
        value="a"
        onValueChange={vi.fn()}
        options={options}
        legend="Templates"
        helpId="x.field.t"
      />
    );

    it('puts the (?) beside the legend, outside it, named after the legend', async () => {
      render(
        <HelpProvider index={index} lang="en" baseUrl="https://g.test">
          {rows}
        </HelpProvider>,
      );
      const hint = await screen.findByRole('button', { name: 'Help: Templates' });
      expect(hint.closest('legend')).toBeNull();
      expect(hint.closest('fieldset')).not.toBeNull();
      expect(screen.getByRole('group', { name: 'Templates' })).toBeTruthy();
      expect(screen.getByRole('radiogroup', { name: 'Templates' })).toBeTruthy();
      expect(screen.getAllByLabelText('Templates')).toEqual([screen.getByRole('radiogroup')]);
    });

    it('renders no (?) with legendHidden: there is no visible label for it to sit beside', () => {
      render(
        <HelpProvider index={index} lang="en" baseUrl="https://g.test">
          <RadioRows
            value="a"
            onValueChange={vi.fn()}
            options={options}
            legend="Templates"
            legendHidden
            helpId="x.field.t"
          />
        </HelpProvider>,
      );
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByRole('group', { name: 'Templates' })).toBeTruthy();
    });

    it('renders no (?) when the hint does not resolve', () => {
      render(rows);
      expect(screen.queryByRole('button')).toBeNull();
    });
  });
});
