import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PaletteSwatches } from './palette-swatches';

const palettes = [
  { id: 'a', name: { bn: 'সবুজ', en: 'Green' }, colors: ['#1', '#2', '#3', '#4', '#5'] },
  { id: 'b', name: { bn: 'নীল', en: 'Blue' }, colors: ['#1', '#2', '#3', '#4', '#5'] },
];

function Harness({ onChange }: { onChange: (id: string) => void }) {
  const [v, setV] = React.useState<string | undefined>('a');
  return (
    <PaletteSwatches
      palettes={palettes}
      value={v}
      lang="en"
      label="Colours"
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
    />
  );
}

describe('PaletteSwatches', () => {
  it('arrow key moves the selection; selected is aria-checked; name labels the option', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Green' }).getAttribute('aria-checked')).toBe('true');
    screen.getByRole('radio', { name: 'Green' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Blue' })),
    );
    await userEvent.keyboard(' ');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('b'));
    expect(screen.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true');
  });
});
