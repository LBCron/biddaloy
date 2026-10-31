import type { ReportFilter, ReportParameter } from '@biddaloy/shared';
import { screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { REGION_BD_BN, RegionConfigProvider } from '../../i18n';
import { cleanupTestState, expectKeyboardOperable, renderWithProviders } from '../../test';

import { fieldsFromMeta, type MetaAreaLike } from './field-picker';
import {
  FilterBuilder,
  filterOpFor,
  opWordOf,
  opWordsFor,
  type FilterBuilderValue,
} from './filter-builder';
import { useDesignerLabels } from './labels';

afterEach(cleanupTestState);

const base = { sensitivity: 'PUBLIC', filterable: true, groupable: true };
const area: MetaAreaLike = {
  key: 'FEES',
  fields: [
    { ...base, key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT' },
    { ...base, key: 'roll', label_en: 'Roll', label_bn: 'রোল', type: 'NUMBER' },
    { ...base, key: 'due_date', label_en: 'Due date', label_bn: 'শেষ তারিখ', type: 'DATE' },
    {
      ...base,
      key: 'status',
      label_en: 'Status',
      label_bn: 'অবস্থা',
      type: 'ENUM',
      enum_values: ['PAID', 'DUE'],
    },
    {
      ...base,
      key: 'hidden',
      label_en: 'Hidden',
      label_bn: 'লুকানো',
      type: 'TEXT',
      filterable: false,
    },
  ],
  measures: [
    {
      key: 'outstanding',
      label_en: 'Still owed',
      label_bn: 'বাকি',
      type: 'MONEY',
      sensitivity: 'FINANCIAL',
    },
  ],
};
const fields = fieldsFromMeta(area);

const enumLabel = (_field: string, value: string) =>
  value === 'PAID'
    ? { label_en: 'Paid', label_bn: 'জমা' }
    : { label_en: 'Still owed', label_bn: 'বাকি' };

function Harness({ initial, bn = false }: { initial: ReportFilter[]; bn?: boolean }) {
  const [value, setValue] = React.useState<FilterBuilderValue>({
    filters: initial,
    parameters: [],
  });
  const labels = useDesignerLabels();
  return (
    <RegionConfigProvider {...(bn ? { value: REGION_BD_BN } : {})}>
      <FilterBuilder
        {...value}
        fields={fields}
        onChange={setValue}
        labels={labels.filter}
        enumLabel={enumLabel}
      />
      <pre data-testid="state">{JSON.stringify(value)}</pre>
    </RegionConfigProvider>
  );
}

const state = () =>
  JSON.parse(screen.getByTestId('state').textContent ?? '{}') as {
    filters: ReportFilter[];
    parameters: ReportParameter[];
  };

async function open(initial: ReportFilter[], bn = false) {
  const view = renderWithProviders(<Harness initial={initial} bn={bn} />, {
    locale: bn ? 'bn' : 'en',
  });
  await view.localeReady;
  await screen.findByRole('heading'); // the `reports` words load on first use
  return view;
}

describe('FilterBuilder', () => {
  it('reads as a sentence under "Only those who…" and is axe clean', async () => {
    const { container } = await open([{ field: 'class', op: 'EQ' }]);
    expect(screen.getByRole('heading', { name: 'Only those who…' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Which detail' }).textContent).toContain('Class');
    await expect(container).toHaveNoViolations();
  });

  it('offers only fields that can be filtered, never a count or an amount', async () => {
    const { user } = await open([{ field: 'class', op: 'EQ' }]);
    await user.click(screen.getByRole('combobox', { name: 'Which detail' }));
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Class', 'Roll', 'Due date', 'Status']);
  });

  it('shows the words that fit the field: more and less only for numbers, between for dates', async () => {
    const { user } = await open([{ field: 'roll', op: 'EQ' }]);
    await user.click(screen.getByRole('combobox', { name: 'How' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'is',
      'is not',
      'is more than',
      'is less than',
      'is between',
    ]);
  });

  it('turns several typed values into "is any of" and one into a plain "is"', async () => {
    const { user } = await open([{ field: 'class', op: 'EQ' }]);
    const box = screen.getByRole('textbox', { name: 'Value' });
    await user.type(box, 'Six, Seven');
    expect(state().filters[0]).toEqual({ field: 'class', op: 'IN', value: ['Six', 'Seven'] });
    await user.clear(box);
    await user.type(box, 'Six');
    expect(state().filters[0]).toEqual({ field: 'class', op: 'EQ', value: 'Six' });
  });

  it('reads a range of numbers typed in Bangla digits, and says when it is not a number', async () => {
    const { user } = await open([{ field: 'roll', op: 'BETWEEN' }], true);
    const from = screen.getByRole('textbox', { name: 'শুরু' });
    const to = screen.getByRole('textbox', { name: 'শেষ' });
    await user.type(from, '৫');
    await user.type(to, '১০');
    expect(state().filters[0]).toEqual({ field: 'roll', op: 'BETWEEN', value: [5, 10] });
    await user.type(to, 'ক');
    expect(screen.getByText('একটি সংখ্যা লিখুন')).toBeTruthy();
    expect(to.getAttribute('aria-invalid')).toBe('true');
  });

  it('picks values of a choice field by their names, never the stored constants', async () => {
    const { user } = await open([{ field: 'status', op: 'EQ' }]);
    await user.click(screen.getByRole('combobox', { name: 'Value' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Paid', 'Still owed']);
    await user.click(screen.getByRole('option', { name: 'Paid' }));
    expect(state().filters[0]).toEqual({ field: 'status', op: 'EQ', value: 'PAID' });
  });

  it('turns a condition into a question asked when running, and back', async () => {
    const { user } = await open([{ field: 'class', op: 'EQ' }]);
    const ask = screen.getByRole('switch', { name: 'Ask when running' });
    await expectKeyboardOperable(ask, { keys: ['Space'] });
    // The keyboard test toggled it on and off; start from a known state.
    if (ask.getAttribute('aria-checked') === 'true') await user.click(ask);

    await user.click(ask);
    expect(state().filters[0]).toEqual({ field: 'class', op: 'IN', value: { param: 'p_class' } });
    expect(state().parameters).toEqual([
      { key: 'p_class', type: 'CLASS', label_en: 'Class', label_bn: 'শ্রেণি', required: false },
    ]);
    // The question is edited right below the sentence.
    const group = screen.getByRole('group', { name: /What is asked when the report runs/ });
    expect(within(group).getByRole('textbox', { name: 'Question (in English)' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull();

    await user.click(ask);
    expect(state()).toEqual({ filters: [{ field: 'class', op: 'EQ' }], parameters: [] });
  });

  it('offers no question for a number, which the engine cannot read as an answer yet', async () => {
    await open([{ field: 'roll', op: 'GT' }]);
    expect(screen.queryByRole('switch', { name: 'Ask when running' })).toBeNull();
  });

  it('gives a date range its own kind of question', async () => {
    const { user } = await open([{ field: 'due_date', op: 'BETWEEN' }]);
    await user.click(screen.getByRole('switch', { name: 'Ask when running' }));
    expect(state().parameters[0]).toMatchObject({ key: 'p_due_date', type: 'DATE_RANGE' });
    expect(state().filters[0]).toEqual({
      field: 'due_date',
      op: 'BETWEEN',
      value: { param: 'p_due_date' },
    });
  });

  it('adds and removes conditions, and says so when there are none', async () => {
    const { user } = await open([]);
    expect(screen.getByText('No conditions, so everything is shown.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add another condition' }));
    expect(state().filters).toEqual([{ field: '', op: 'EQ' }]);
    await user.click(screen.getByRole('button', { name: 'Remove this condition' }));
    expect(state().filters).toEqual([]);
  });

  it('removing a condition that asked a question removes the question too', async () => {
    const { user } = await open([{ field: 'class', op: 'EQ' }]);
    await user.click(screen.getByRole('switch', { name: 'Ask when running' }));
    await user.click(screen.getByRole('button', { name: 'Remove this condition' }));
    expect(state()).toEqual({ filters: [], parameters: [] });
  });

  it('writes no jargon, in the text or in any accessible name', async () => {
    const { container } = await open([{ field: 'class', op: 'EQ' }]);
    await screen.findByRole('switch');
    const everything = [
      container.textContent ?? '',
      ...[...container.querySelectorAll('[aria-label],[placeholder]')].map(
        (el) => `${el.getAttribute('aria-label')} ${el.getAttribute('placeholder')}`,
      ),
    ].join(' ');
    expect(everything).not.toMatch(/dimension|measure|crosstab|aggregate/i);
  });
});

describe('operator words', () => {
  it('follow the type of the field', () => {
    expect(opWordsFor('TEXT')).toEqual(['is', 'isNot']);
    expect(opWordsFor('ENUM')).toEqual(['is', 'isNot']);
    expect(opWordsFor('BOOLEAN')).toEqual(['is']);
    expect(opWordsFor('DATE')).toEqual(['is', 'between']);
    for (const type of ['NUMBER', 'MONEY', 'PERCENT'] as const) {
      expect(opWordsFor(type)).toEqual(['is', 'isNot', 'more', 'less', 'between']);
    }
  });

  it('map to the engine operators and back', () => {
    expect(filterOpFor('is', 'a')).toBe('EQ');
    expect(filterOpFor('is', ['a', 'b'])).toBe('IN');
    expect(filterOpFor('isNot', ['a', 'b'])).toBe('NOT_IN');
    expect(filterOpFor('isNot', undefined)).toBe('NEQ');
    expect(filterOpFor('more', 5)).toBe('GT');
    expect(filterOpFor('less', 5)).toBe('LT');
    expect(filterOpFor('between', [1, 2])).toBe('BETWEEN');
    expect(opWordOf('GTE')).toBe('more');
    expect(opWordOf('LTE')).toBe('less');
    expect(opWordOf('NOT_IN')).toBe('isNot');
    expect(opWordOf('CONTAINS')).toBe('is');
  });
});
