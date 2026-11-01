import type { ReportFormatRule } from '@biddaloy/shared';
import { screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { cleanupTestState, renderWithProviders } from '../../test';

import { fieldsFromMeta, type MetaAreaLike } from './field-picker';
import { FormatRulesEditor } from './format-rules-editor';
import { useDesignerLabels } from './labels';

afterEach(cleanupTestState);

const area: MetaAreaLike = {
  key: 'FEES',
  fields: [],
  measures: [
    {
      key: 'outstanding',
      label_en: 'Still owed',
      label_bn: 'বাকি',
      type: 'MONEY',
      sensitivity: 'FINANCIAL',
    },
    { key: 'bills', label_en: 'Bills', label_bn: 'বিল', type: 'NUMBER', sensitivity: 'PUBLIC' },
  ],
};
const fields = fieldsFromMeta(area);

function Harness({ initial, bn = false }: { initial: ReportFormatRule[]; bn?: boolean }) {
  const [rules, setRules] = React.useState(initial);
  const labels = useDesignerLabels();
  return (
    <RegionConfigProvider value={bn ? REGION_BD_BN : REGION_BD_EN}>
      <FormatRulesEditor rules={rules} fields={fields} onChange={setRules} labels={labels.format} />
      <pre data-testid="state">{JSON.stringify(rules)}</pre>
    </RegionConfigProvider>
  );
}

const state = () =>
  JSON.parse(screen.getByTestId('state').textContent ?? '[]') as ReportFormatRule[];

const owedOver5000: ReportFormatRule = {
  field: 'outstanding',
  when: { field: 'outstanding', op: 'GT', value: 5000 },
  style: { tone: 'bad' },
};

async function open(initial: ReportFormatRule[], locale: 'en' | 'bn' = 'en') {
  const view = renderWithProviders(<Harness initial={initial} bn={locale === 'bn'} />, { locale });
  await view.localeReady;
  await screen.findByRole('heading');
  return view;
}

describe('FormatRulesEditor', () => {
  it('reads "If [Still owed] [is more than] [5,000] then [Red]" and is axe clean', async () => {
    const { container } = await open([owedOver5000]);
    expect(screen.getByRole('combobox', { name: 'Which detail' }).textContent).toContain(
      'Still owed',
    );
    expect(screen.getByRole('combobox', { name: 'How' }).textContent).toContain('is more than');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Value' }).value).toBe('5000');
    expect(screen.getByRole('combobox', { name: 'Colour' }).textContent).toContain('Red');
    await expect(container).toHaveNoViolations();
  });

  it('says the words in Bangla', async () => {
    await open([owedOver5000], 'bn');
    expect(screen.getByText('যদি')).toBeTruthy();
    expect(screen.getByText('হয়')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'রং' }).textContent).toContain('লাল');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'মান' }).value).toBe('৫০০০');
  });

  it('gives every tone a word and an icon, never colour alone', async () => {
    const { user } = await open([owedOver5000]);
    await user.click(screen.getByRole('combobox', { name: 'Colour' }));
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Green', 'Yellow', 'Red', 'Grey']);
    for (const option of options) expect(option.querySelector('svg')).not.toBeNull();
    await user.click(screen.getByRole('option', { name: 'Green' }));
    expect(state()[0]!.style.tone).toBe('good');
  });

  it("keeps the rule's field and its sentence's field the same", async () => {
    const { user } = await open([owedOver5000]);
    await user.click(screen.getByRole('combobox', { name: 'Which detail' }));
    await user.click(screen.getByRole('option', { name: 'Bills' }));
    expect(state()[0]!.field).toBe('bills');
    expect(state()[0]!.when.field).toBe('bills');
  });

  it('adds a rule that starts red, and removes one', async () => {
    const { user } = await open([]);
    expect(screen.getByText('No colour rules.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add another rule' }));
    expect(state()).toEqual([{ field: '', when: { field: '', op: 'EQ' }, style: { tone: 'bad' } }]);
    await user.click(screen.getByRole('button', { name: 'Remove this rule' }));
    expect(state()).toEqual([]);
  });

  it('writes no jargon', async () => {
    const { container } = await open([owedOver5000]);
    expect(container.textContent).not.toMatch(/dimension|measure|crosstab|aggregate/i);
  });
});
