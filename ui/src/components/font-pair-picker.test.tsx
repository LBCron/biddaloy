import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FontPairPicker } from './font-pair-picker';

const options = [
  {
    id: 'one',
    heading: { family: 'Head One', url: '/f/h1.woff2' },
    body: { family: 'Body One', url: '/f/b1.woff2' },
  },
  {
    id: 'two',
    heading: { family: 'Head Two', url: '/f/h2.woff2' },
    body: { family: 'Body Two', url: '/f/b2.woff2' },
  },
];

describe('FontPairPicker', () => {
  it('declares the font files and shows heading + body sample in one row', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <FontPairPicker options={options} value="one" onChange={onChange} lang="en" label="Text style" />,
    );
    expect(container.querySelector('style')?.textContent).toContain('url("/f/h2.woff2")');
    expect(screen.getAllByText('Our school')).toHaveLength(2);
    await userEvent.click(screen.getByRole('combobox', { name: 'Text style' }));
    await userEvent.click((await screen.findAllByRole('option'))[1]!);
    expect(onChange).toHaveBeenCalledWith('two');
  });
});
