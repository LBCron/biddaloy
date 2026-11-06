/**
 * Vocabulary assertions for [8.14.14]'s focus-ring migration — same shape
 * as `button.test.tsx:72-81`'s "two-tone offset ring, not the old
 * brand-on-brand 50%-alpha ring" test, run against every control this
 * ticket touched. `ui/scripts/check-focus-ring.spec.mjs` covers the guard
 * script's own matcher; this file covers that the migrated components
 * actually carry the canonical string.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DatePicker } from '../components/date-picker';
import { REGION_BD_EN } from '../i18n/region-config';
import { Checkbox } from '../primitives/checkbox';
import { Input } from '../primitives/input';
import { RadioGroup, RadioGroupItem } from '../primitives/radio-group';
import { Tabs, TabsList, TabsTrigger } from '../primitives/tabs';
import { Textarea } from '../primitives/textarea';

/** Asserts the canonical two-tone offset ring is present and none of the
 * deleted old-vocabulary classes survive. */
function expectCanonicalRing(className: string, offsetSurface = 'ring-offset-background') {
  expect(className).toContain('focus-visible:ring-2');
  expect(className).toContain('focus-visible:ring-ring');
  expect(className).toContain('focus-visible:ring-offset-2');
  expect(className).toContain(`focus-visible:${offsetSurface}`);
  expect(className).not.toContain('ring-ring/50');
  expect(className).not.toContain('border-ring');
  expect(className).not.toContain('outline-ring');
  expect(className).not.toContain('ring-[3px]');
}

describe('focus-ring vocabulary', () => {
  it('Input carries the canonical ring, not the old border-ring/ring-3/ring-ring-50 combo', () => {
    render(<Input aria-label="Guardian phone" />);
    expectCanonicalRing(screen.getByRole('textbox').className);
  });

  it('Textarea carries the canonical ring', () => {
    render(<Textarea aria-label="Note" />);
    expectCanonicalRing(screen.getByRole('textbox').className);
  });

  it('Checkbox carries the canonical ring', () => {
    render(<Checkbox aria-label="Send SMS receipt" />);
    expectCanonicalRing(screen.getByRole('checkbox').className);
  });

  it('RadioGroupItem carries the canonical ring', () => {
    render(
      <RadioGroup defaultValue="cash" aria-label="Payment method">
        <RadioGroupItem value="cash" aria-label="Cash" />
      </RadioGroup>,
    );
    expectCanonicalRing(screen.getByRole('radio').className);
  });

  it('TabsTrigger carries the canonical ring and no longer double-stacks an outline', () => {
    render(
      <Tabs defaultValue="fees">
        <TabsList>
          <TabsTrigger value="fees">Fees</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const trigger = screen.getByRole('tab', { name: 'Fees' });
    expectCanonicalRing(trigger.className);
    expect(trigger.className).not.toContain('focus-visible:outline-1');
    // The trigger's third-deviation stacking fix. Triggers are `flex-1`
    // siblings that are all `relative`, so without this the next trigger's
    // `data-[state=active]:bg-card` paints over the focused trigger's ring.
    // Nothing else pins this: the guard script only bans old spellings, and
    // it is not a class the canonical-string check would notice going missing.
    expect(trigger.className).toContain('focus-visible:z-10');
  });

  it('DatePicker day cell uses the popover-offset deviation, not ring-offset-background', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState<Date | undefined>(new Date(2024, 0, 5));
      return (
        <DatePicker
          aria-label="Enrollment date"
          value={value}
          onValueChange={setValue}
          config={REGION_BD_EN}
        />
      );
    }
    render(<Controlled />);

    await user.click(screen.getByRole('button', { name: /^Enrollment date, / }));
    await screen.findByRole('grid');
    const day = document.querySelector<HTMLElement>('[data-date="2024-01-05"]')!;

    expectCanonicalRing(day.className, 'ring-offset-popover');
    expect(day.className).toContain('focus-visible:relative');
    expect(day.className).toContain('focus-visible:z-10');
    expect(day.className).not.toContain('ring-offset-background');
    expect(day.className).not.toContain('focus-visible:outline');
  });

  it('aria-invalid:ring-3 survives the migration untouched, on Input', () => {
    render(<Input aria-label="Guardian phone" aria-invalid />);
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('aria-invalid:ring-3');
    expect(input.className).toContain('aria-invalid:ring-destructive/20');
  });

  it('aria-invalid:ring-3 survives the migration untouched, on Textarea', () => {
    render(<Textarea aria-label="Note" aria-invalid />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('aria-invalid:ring-3');
    expect(textarea.className).toContain('aria-invalid:ring-destructive/20');
  });

  it('aria-invalid:ring-3 survives the migration untouched, on Checkbox', () => {
    render(<Checkbox aria-label="Consent" aria-invalid />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.className).toContain('aria-invalid:ring-3');
    expect(checkbox.className).toContain('aria-invalid:ring-destructive/20');
  });

  it('aria-invalid:ring-3 survives the migration untouched, on RadioGroupItem', () => {
    render(
      <RadioGroup aria-label="Section">
        <RadioGroupItem value="a" aria-label="Section A" aria-invalid />
      </RadioGroup>,
    );
    const radio = screen.getByRole('radio', { name: 'Section A' });
    expect(radio.className).toContain('aria-invalid:ring-3');
    expect(radio.className).toContain('aria-invalid:ring-destructive/20');
  });
});
