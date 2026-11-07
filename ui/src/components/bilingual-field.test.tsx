import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BilingualField, type BilingualValue } from './bilingual-field';

function Harness({ onChange }: { onChange: (v: BilingualValue) => void }) {
  const [v, setV] = React.useState<BilingualValue>({ bn: '', en: '' });
  return (
    <BilingualField
      label="Title"
      required
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe('BilingualField', () => {
  it('requires bn only and shows the en hint', () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByLabelText<HTMLInputElement>(/Title \(বাংলা\)/).required).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/Title \(English\)/).required).toBe(false);
    expect(screen.getByText('ঐচ্ছিক, খালি রাখলে বাংলা দেখাবে')).toBeTruthy();
  });

  it('an empty en keeps { bn, en: "" }', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.type(screen.getByLabelText(/Title \(বাংলা\)/), 'ক');
    expect(onChange).toHaveBeenLastCalledWith({ bn: 'ক', en: '' });
  });
});
