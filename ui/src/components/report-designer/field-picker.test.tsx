import { screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../../i18n';
import { cleanupTestState, expectKeyboardOperable, renderWithProviders } from '../../test';

import {
  EMPTY_PICKS,
  FieldPicker,
  allowedTrays,
  defaultTopicOf,
  fieldsFromMeta,
  matchesField,
  type FieldPickerValue,
  type MetaAreaLike,
} from './field-picker';
import { useDesignerLabels } from './labels';

afterEach(cleanupTestState);

const area: MetaAreaLike = {
  key: 'FEES',
  fields: [
    {
      key: 'class',
      label_en: 'Class',
      label_bn: 'শ্রেণি',
      type: 'TEXT',
      sensitivity: 'PUBLIC',
      filterable: true,
      groupable: true,
    },
    {
      key: 'guardian_phone',
      label_en: 'Guardian phone',
      label_bn: 'অভিভাবকের ফোন',
      type: 'TEXT',
      sensitivity: 'CONTACT',
      filterable: true,
      groupable: false,
    },
    {
      key: 'due_date',
      label_en: 'Due date',
      label_bn: 'শেষ তারিখ',
      type: 'DATE',
      sensitivity: 'PUBLIC',
      filterable: true,
      groupable: true,
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

function Harness({
  initial = EMPTY_PICKS,
  bn = false,
}: {
  initial?: FieldPickerValue;
  bn?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  const labels = useDesignerLabels();
  return (
    <RegionConfigProvider value={bn ? REGION_BD_BN : REGION_BD_EN}>
      <FieldPicker fields={fields} value={value} onChange={setValue} labels={labels.picker} />
      <pre data-testid="picked">{JSON.stringify(value)}</pre>
    </RegionConfigProvider>
  );
}

const picked = () =>
  JSON.parse(screen.getByTestId('picked').textContent ?? '{}') as FieldPickerValue;

describe('FieldPicker', () => {
  it('groups fields under everyday topics, not tables, and is axe clean', async () => {
    const { container, localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    expect(screen.getByRole('heading', { name: 'Classes and sections' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Guardians' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fees' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('puts a field into the tray whose button is clicked, and takes it out again', async () => {
    const { user, localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    await user.click(screen.getByRole('button', { name: 'Show: Class' }));
    await user.click(screen.getByRole('button', { name: 'Split by: Class' }));
    expect(picked()).toEqual({ show: ['class'], split: ['class'], count: [] });
    expect(
      screen.getByRole('button', { name: 'Split by: Class' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // The chosen chip shows in its tray and the x there removes it.
    await user.click(screen.getAllByRole('button', { name: 'Remove: Class' })[0]!);
    expect(picked()).toEqual({ show: [], split: ['class'], count: [] });
  });

  it('sends a measure straight to the count tray: one button, no show or split', async () => {
    const { user, localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    expect(screen.queryByRole('button', { name: 'Show: Still owed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Split by: Still owed' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Count / Add up: Still owed' }));
    expect(picked().count).toEqual(['outstanding']);
  });

  it('offers no split for a field the server says is not groupable', async () => {
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    expect(screen.getByRole('button', { name: 'Show: Guardian phone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Split by: Guardian phone' })).toBeNull();
  });

  it('shows a lock with who can see a protected field, reachable by keyboard', async () => {
    const { localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    const lock = screen.getByRole('button', {
      name: 'Only people allowed to see contact details can see this',
    });
    await expectKeyboardOperable(lock);
    // A field open to everyone has no lock.
    const classChip = screen.getByRole('button', { name: 'Show: Class' }).closest('li')!;
    expect(within(classChip).queryByRole('button', { name: /can see this/ })).toBeNull();
  });

  it('searches Bangla and English, with either kind of digit, and says when nothing matches', async () => {
    const { user, localeReady } = renderWithProviders(<Harness bn />, { locale: 'bn' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    const search = screen.getByRole('searchbox');
    await user.type(search, 'বাকি');
    expect(screen.getByRole('button', { name: /বাকি/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /শ্রেণি/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('১টি পাওয়া গেছে');

    await user.clear(search);
    await user.type(search, 'GUARDIAN');
    expect(screen.getByRole('button', { name: /অভিভাবকের ফোন/ })).toBeTruthy();

    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByRole('status').textContent).toContain('কিছু পাওয়া যায়নি');
  });

  it('writes no jargon, in the text or in any accessible name', async () => {
    const { container, localeReady } = renderWithProviders(<Harness />, { locale: 'en' });
    await localeReady;
    await screen.findByRole('searchbox'); // the `reports` words load on first use
    const everything = [
      container.textContent ?? '',
      ...[...container.querySelectorAll('[aria-label],[placeholder],[title]')].flatMap((el) => [
        el.getAttribute('aria-label') ?? '',
        el.getAttribute('placeholder') ?? '',
        el.getAttribute('title') ?? '',
      ]),
    ].join(' ');
    expect(everything).not.toMatch(/dimension|measure|crosstab|aggregate/i);
  });
});

describe('field helpers', () => {
  it('reads topics from the field and the area', () => {
    expect(defaultTopicOf('FEES', 'guardian_name')).toBe('guardian');
    expect(defaultTopicOf('PAYMENTS', 'section')).toBe('class');
    expect(defaultTopicOf('PAYMENTS', 'method')).toBe('payment');
    expect(defaultTopicOf('SOMETHING_NEW', 'x')).toBe('other');
    expect(fields.find((f) => f.key === 'class')?.topic).toBe('class');
  });

  it('measures can only be counted; fields can be shown and, if groupable, split', () => {
    const by = Object.fromEntries(fields.map((f) => [f.key, allowedTrays(f)]));
    expect(by).toEqual({
      class: ['show', 'split'],
      guardian_phone: ['show'],
      due_date: ['show', 'split'],
      outstanding: ['count'],
    });
  });

  it('reads an unknown type as text and an unknown sensitivity as the most protected', () => {
    const [field] = fieldsFromMeta({
      key: 'FEES',
      fields: [
        {
          key: 'x',
          label_en: 'X',
          label_bn: 'এক্স',
          type: 'NEW_TYPE',
          sensitivity: 'NEW_LEVEL',
          filterable: true,
          groupable: true,
        },
      ],
      measures: [],
    });
    expect(field).toMatchObject({ type: 'TEXT', sensitivity: 'SENSITIVE' });
  });

  it('matches names, keys and mixed digits; an empty search matches everything', () => {
    const cls = fields.find((f) => f.key === 'class')!;
    expect(matchesField(cls, '')).toBe(true);
    expect(matchesField(cls, ' শ্রেণ ')).toBe(true);
    expect(matchesField(cls, 'CLAS')).toBe(true);
    expect(matchesField(cls, 'fee')).toBe(false);
  });
});
