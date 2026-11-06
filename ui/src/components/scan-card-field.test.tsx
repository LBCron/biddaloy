import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test';

import { ScanCardField } from './scan-card-field';

function Host({ error, onSubmit }: { error?: string; onSubmit?: () => void }) {
  const [value, setValue] = React.useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <ScanCardField
        value={value}
        onChange={setValue}
        label="Card number"
        scanLabel="Scan card"
        scanHint="Tap the card on the reader"
        error={error}
        helpKey="students.cardNo"
      />
    </form>
  );
}

describe('ScanCardField', () => {
  it('Scan card focuses the input and shows the live hint', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { locale: 'en' });
    await user.click(screen.getByRole('button', { name: 'Scan card' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Card number'));
    expect(screen.getByRole('status').textContent).toBe('Tap the card on the reader');
  });

  it('Enter inside the field does not submit the host form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(<Host onSubmit={onSubmit} />, { locale: 'en' });
    await user.type(screen.getByLabelText('Card number'), 'AB-12{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Card number')).toHaveProperty('value', 'AB-12');
  });

  it('rejects characters outside letters, digits and hyphen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />, { locale: 'en' });
    await user.type(screen.getByLabelText('Card number'), 'a b_c!1-2');
    expect(screen.getByLabelText('Card number')).toHaveProperty('value', 'abc1-2');
  });

  it('shows the error and links it to the input', () => {
    renderWithProviders(<Host error="Card already in use" />, { locale: 'en' });
    const input = screen.getByLabelText('Card number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Card already in use').id).toBe(input.getAttribute('aria-describedby'));
  });
});
