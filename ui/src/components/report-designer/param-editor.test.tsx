import type { ReportParameter } from '@biddaloy/shared';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../../test';

import { useDesignerLabels } from './labels';
import { ParamEditor } from './param-editor';

afterEach(cleanupTestState);

const classQuestion: ReportParameter = {
  key: 'p_class',
  type: 'CLASS',
  label_en: 'Class',
  label_bn: 'শ্রেণি',
  required: false,
};
const sectionQuestion: ReportParameter = {
  key: 'p_section',
  type: 'SECTION',
  label_en: 'Section',
  label_bn: 'শাখা',
  required: false,
};
const statusQuestion: ReportParameter = {
  key: 'p_status',
  type: 'ENUM',
  label_en: 'Status',
  label_bn: 'অবস্থা',
  required: true,
  options: [
    { value: 'PAID', label_en: 'Paid', label_bn: 'জমা' },
    { value: 'DUE', label_en: 'Still owed', label_bn: 'বাকি' },
  ],
};

function Harness({
  initial,
  siblings = [],
}: {
  initial: ReportParameter;
  siblings?: ReportParameter[];
}) {
  const [value, setValue] = React.useState(initial);
  const labels = useDesignerLabels();
  return (
    <>
      <ParamEditor
        parameter={value}
        onChange={setValue}
        siblings={siblings}
        labels={labels.filter.params}
      />
      <pre data-testid="state">{JSON.stringify(value)}</pre>
    </>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '{}') as ReportParameter;

async function open(initial: ReportParameter, siblings: ReportParameter[] = []) {
  const view = renderWithProviders(<Harness initial={initial} siblings={siblings} />, {
    locale: 'en',
  });
  await view.localeReady;
  await screen.findByRole('group');
  return view;
}

describe('ParamEditor', () => {
  it('names the kind of answer, has labelled fields and is axe clean', async () => {
    const { container } = await open(classQuestion);
    expect(screen.getByText('Class', { selector: 'p' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Question (in Bangla)' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Question (in English)' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('edits the wording in both languages and whether an answer is required', async () => {
    const { user } = await open(classQuestion);
    const english = screen.getByRole('textbox', { name: 'Question (in English)' });
    await user.clear(english);
    await user.type(english, 'Which class');
    await user.click(screen.getByRole('checkbox', { name: 'An answer is required' }));
    expect(state()).toMatchObject({ label_en: 'Which class', label_bn: 'শ্রেণি', required: true });
  });

  it('sets a starting answer, and removes it again when emptied', async () => {
    const { user } = await open(classQuestion);
    const start = screen.getByRole('textbox', { name: 'Starts as' });
    await user.type(start, 'Six');
    expect(state().default).toBe('Six');
    await user.clear(start);
    expect('default' in state()).toBe(false);
  });

  it('offers a choice question its own options, in words, as the starting answer', async () => {
    const { user } = await open(statusQuestion);
    await user.click(screen.getByRole('combobox', { name: 'Starts as' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Nothing',
      'Paid',
      'Still owed',
    ]);
    await user.click(screen.getByRole('option', { name: 'Paid' }));
    expect(state().default).toBe('PAID');
  });

  it('lets a section question depend on another question', async () => {
    const { user } = await open(sectionQuestion, [classQuestion, sectionQuestion]);
    await user.click(screen.getByRole('combobox', { name: 'Depends on the answer to' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Nothing', 'Class']);
    await user.click(screen.getByRole('option', { name: 'Class' }));
    expect(state().depends_on).toBe('p_class');
    await user.click(screen.getByRole('combobox', { name: 'Depends on the answer to' }));
    await user.click(screen.getByRole('option', { name: 'Nothing' }));
    expect('depends_on' in state()).toBe(false);
  });

  it('shows no dependency choice for a question that cannot depend on anything', async () => {
    await open(classQuestion, [classQuestion]);
    expect(screen.queryByRole('combobox', { name: 'Depends on the answer to' })).toBeNull();
  });

  it('writes no jargon', async () => {
    const { container } = await open(sectionQuestion, [classQuestion, sectionQuestion]);
    expect(container.textContent).not.toMatch(
      /dimension|measure|crosstab|aggregate|parameter|prompt/i,
    );
  });
});
