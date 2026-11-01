import { act, screen, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../i18n';
import { cleanupTestState, expectTabOrder, renderWithProviders } from '../test';

import {
  defaultPromptValues,
  missingPrompts,
  promptParams,
  PromptSummary,
  ReportPrompts,
  sanitizePromptValues,
  type PromptChoices,
  type PromptParameter,
  type PromptValues,
} from './report-prompts';

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupTestState();
});

const TODAY = new Date(2026, 9, 15); // 15 October 2026

const choices: PromptChoices = {
  classes: [{ name: 'Class 6' }, { name: 'Class 7' }],
  sections: [
    { name: 'A', className: 'Class 6' },
    { name: 'B', className: 'Class 6' },
    { name: 'C', className: 'Class 7' },
  ],
  academicYears: [{ name: '2025' }, { name: '2026', isCurrent: true }],
};

const param = (
  over: Partial<PromptParameter> & Pick<PromptParameter, 'key' | 'type'>,
): PromptParameter => ({
  label_en: over.key,
  label_bn: over.key,
  required: false,
  ...over,
});

const year = param({
  key: 'year',
  type: 'ACADEMIC_YEAR',
  label_en: 'Academic year',
  label_bn: 'শিক্ষাবর্ষ',
  required: true,
});
const classes = param({ key: 'class', type: 'CLASS', label_en: 'Class', label_bn: 'শ্রেণি' });
const sections = param({
  key: 'section',
  type: 'SECTION',
  label_en: 'Section',
  label_bn: 'শাখা',
  depends_on: 'class',
});

/** The prompt shapes the five ready reports use: year only, year + class, year + class + section, a date range, and a choice. */
const SYSTEM_REPORT_SHAPES: Record<string, PromptParameter[]> = {
  studentCount: [year],
  studentList: [year, classes, sections],
  duesByClass: [year, classes],
  collections: [
    param({
      key: 'period',
      type: 'DATE_RANGE',
      label_en: 'Dates',
      label_bn: 'তারিখ',
      required: true,
    }),
  ],
  attendance: [
    param({ key: 'day', type: 'DATE', label_en: 'Day', label_bn: 'দিন', required: true }),
    param({
      key: 'status',
      type: 'ENUM',
      label_en: 'Status',
      label_bn: 'অবস্থা',
      required: true,
      options: [
        { value: 'PRESENT', label_en: 'Present', label_bn: 'উপস্থিত' },
        { value: 'ABSENT', label_en: 'Absent', label_bn: 'অনুপস্থিত' },
      ],
    }),
  ],
};

function Harness({
  parameters,
  initial,
  onRun,
  startOpen = true,
}: {
  parameters: PromptParameter[];
  initial?: PromptValues;
  onRun: () => void;
  startOpen?: boolean;
}) {
  const [value, setValue] = React.useState<PromptValues>(
    initial ?? defaultPromptValues(parameters, choices, TODAY),
  );
  const [open, setOpen] = React.useState(startOpen);
  return (
    <RegionConfigProvider value={REGION_BD_EN}>
      <PromptSummary
        parameters={parameters}
        value={value}
        expanded={open}
        onToggle={() => setOpen((o) => !o)}
      />
      <ReportPrompts
        parameters={parameters}
        value={value}
        onChange={setValue}
        onRun={() => {
          onRun();
          setOpen(false);
        }}
        choices={choices}
        open={open}
        onOpenChange={setOpen}
      />
    </RegionConfigProvider>
  );
}

async function renderPrompts(
  props: React.ComponentProps<typeof Harness>,
  locale: 'en' | 'bn' = 'en',
) {
  const view = renderWithProviders(<Harness {...props} />, { locale });
  await act(async () => {
    await view.localeReady;
  });
  // The `reports` words load on first use; the screen is blank until they have.
  await screen.findAllByRole('button');
  return view;
}

describe('defaults', () => {
  it('every prompt shape of the ready reports has an answer, so the report can run straight away', () => {
    for (const [report, parameters] of Object.entries(SYSTEM_REPORT_SHAPES)) {
      const values = defaultPromptValues(parameters, choices, TODAY);
      expect(missingPrompts(parameters, values), report).toEqual([]);
    }
  });

  it('year is the current one, class and section are all, a date is today, a range is this month', () => {
    const values = defaultPromptValues(
      [
        year,
        classes,
        sections,
        param({ key: 'day', type: 'DATE' }),
        param({ key: 'period', type: 'DATE_RANGE' }),
      ],
      choices,
      TODAY,
    );
    expect(values).toEqual({
      year: '2026',
      class: [],
      section: [],
      day: '2026-10-15',
      period: { from: '2026-10-01', to: '2026-10-31' },
    });
  });

  it("a definition's own default wins", () => {
    const values = defaultPromptValues(
      [
        { ...year, default: '2025' },
        { ...classes, default: 'Class 7' },
      ],
      choices,
      TODAY,
    );
    expect(values).toEqual({ year: '2025', class: ['Class 7'] });
  });

  it('a required class with no default is not answered, so the report waits', () => {
    const required = { ...classes, required: true };
    const values = defaultPromptValues([required], choices, TODAY);
    expect(missingPrompts([required], values)).toEqual(['class']);
  });

  it('leaves unanswered optional prompts out of what the report receives', () => {
    const params = promptParams([year, classes, sections], {
      year: '2026',
      class: [],
      section: [],
    });
    expect(params).toEqual({ year: '2026' });
  });
});

describe('sanitizePromptValues', () => {
  it('drops a wrong type, an unknown key and a malformed date from the address bar', () => {
    const values = sanitizePromptValues(
      {
        year: 2026,
        class: 'Class 6',
        evil: '<script>',
        day: 'tomorrow',
        period: { from: '2026-10-01', to: 'x' },
      },
      [
        year,
        classes,
        param({ key: 'day', type: 'DATE' }),
        param({ key: 'period', type: 'DATE_RANGE' }),
      ],
    );
    expect(values).toEqual({ year: '2026', class: ['Class 6'] });
  });

  it('survives a value that is not an object', () => {
    expect(sanitizePromptValues('nope', [year])).toEqual({});
  });
});

describe('ReportPrompts', () => {
  it('asks for a required class in plain words, beside the field, and does not run', async () => {
    const onRun = vi.fn();
    const { user, container } = await renderPrompts({
      parameters: [{ ...classes, required: true }],
      onRun,
    });
    await user.click(screen.getByRole('button', { name: 'Show report' }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByText('Pick a class')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Class' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await expect(container).toHaveNoViolations();

    // Focus went to the unanswered field, which opens its choices.
    await user.click(screen.getByRole('option', { name: 'Class 6' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Show report' }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('offers only the sections of the chosen classes, and empties them when the class changes', async () => {
    const { user } = await renderPrompts({ parameters: [classes, sections], onRun: vi.fn() });
    const sectionBox = screen.getByRole('combobox', { name: 'Section' });

    // No class chosen: every section is on offer.
    await user.click(sectionBox);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['A', 'B', 'C']);
    await user.click(screen.getByRole('option', { name: 'A' }));
    expect(screen.getByRole('button', { name: 'Remove A' })).toBeTruthy();

    // Choosing a class clears the section answer and narrows what is offered.
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(screen.getByRole('option', { name: 'Class 7' }));
    expect(screen.queryByRole('button', { name: 'Remove A' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['C']);
  });

  it('Enter in a text box runs the report', async () => {
    const onRun = vi.fn();
    const { user } = await renderPrompts({
      parameters: [param({ key: 'q', type: 'TEXT', label_en: 'Name contains', label_bn: 'নাম' })],
      onRun,
    });
    await user.type(screen.getByRole('textbox', { name: 'Name contains' }), 'Rahim{Enter}');
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('Start again puts every answer back to its default', async () => {
    const { user } = await renderPrompts({
      parameters: [classes],
      initial: { class: ['Class 7'] },
      onRun: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Remove Class 7' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.queryByRole('button', { name: 'Remove Class 7' })).toBeNull();
  });

  it('tabs through every prompt to the button, and is axe clean', async () => {
    const { container } = await renderPrompts({
      parameters: SYSTEM_REPORT_SHAPES.studentList!,
      onRun: vi.fn(),
    });
    await expectTabOrder([
      screen.getByRole('button', { name: /Change/ }),
      screen.getByRole('combobox', { name: 'Academic year' }),
      screen.getByRole('combobox', { name: 'Class' }),
      screen.getByRole('combobox', { name: 'Section' }),
      screen.getByRole('button', { name: 'Show report' }),
      screen.getByRole('button', { name: 'Start again' }),
    ]);
    await expect(container).toHaveNoViolations();
  });

  it('renders every kind of prompt, a date range and a choice included', async () => {
    const { container } = await renderPrompts({
      parameters: [...SYSTEM_REPORT_SHAPES.collections!, ...SYSTEM_REPORT_SHAPES.attendance!],
      onRun: vi.fn(),
    });
    expect(screen.getByRole('button', { name: 'Dates — From' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dates — To' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Day' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('Present');
    await expect(container).toHaveNoViolations();
  });

  it('shows nothing while closed', async () => {
    await renderPrompts({ parameters: [year], onRun: vi.fn(), startOpen: false });
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('on a phone the prompts are a bottom sheet, and closing it after a change runs the report', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const onRun = vi.fn();
    const { user } = await renderPrompts({ parameters: [classes], onRun });
    const sheet = screen.getByRole('dialog', { name: 'Choices for this report' });

    // Nothing changed: closing only closes.
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Change/ }));
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(screen.getByRole('option', { name: 'Class 6' }));
    await user.click(screen.getByRole('button', { name: 'Show results' }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});

describe('PromptSummary', () => {
  it('says the answers in one line and opens the prompts when pressed', async () => {
    const { user } = await renderPrompts({
      parameters: [year, classes, sections],
      initial: { year: '2026', class: ['Class 6'], section: [] },
      onRun: vi.fn(),
      startOpen: false,
    });
    const line = screen.getByRole('button', { name: /2026.*Class 6.*All sections.*Change/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    await user.click(line);
    expect(line.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('form', { name: 'Choices for this report' })).toBeTruthy();
  });

  it('writes dates and years in the school numerals, in Bangla', async () => {
    const view = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_BN}>
        <PromptSummary
          parameters={[year, classes, param({ key: 'period', type: 'DATE_RANGE' })]}
          value={{ year: '2026', class: [], period: { from: '2026-10-01', to: '2026-10-31' } }}
          expanded={false}
          onToggle={() => undefined}
        />
      </RegionConfigProvider>,
      { locale: 'bn' },
    );
    await act(async () => {
      await view.localeReady;
    });
    const text = screen.getByRole('button').textContent ?? '';
    expect(text).toContain('২০২৬');
    expect(text).toContain('সব শ্রেণি');
    expect(text).toContain('বদলান');
    expect(text).not.toMatch(/[0-9]/);
  });
});
