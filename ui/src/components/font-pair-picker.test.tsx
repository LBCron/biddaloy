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

describe('FontPairPicker hostile input', () => {
  it('drops options whose family or url could break out, and strips family chars', async () => {
    const bad = (id: string, family: string, url: string) => ({
      id,
      heading: { family, url },
      body: { family: 'Body', url: '/f/b.woff2' },
    });
    const { container } = render(
      <FontPairPicker
        options={[
          bad('ok', 'Good Font-1', 'https://cdn.example.com/a.woff2'),
          bad('css', 'x");}body{display:none', '/f/h.woff2'),
          bad('url1', 'A', 'data:font/woff2;base64,AAAA'),
          bad('url2', 'A', 'http://evil.example/a.woff2'),
          bad('url3', 'A', '//evil.example/a.woff2'),
          bad('url4', 'A', '/f/a.woff2");}body{display:none;/*'),
        ]}
        value="ok"
        onChange={vi.fn()}
        lang="en"
        label="Text style"
      />,
    );
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('data:');
    expect(css).not.toContain('http://');
    expect(css).not.toContain('//evil');
    expect(css).toContain('Good Font-1');
    await userEvent.click(screen.getByRole('combobox', { name: 'Text style' }));
    // Only the clean option is left; the 'css' family reduces to "xbodydisplaynone" but its
    // body font is fine, so it survives stripped. Hostile urls are all dropped.
    const names = (await screen.findAllByRole('option')).length;
    expect(names).toBe(2);
  });
});

describe('FontPairPicker', () => {
  it('declares the font files and shows heading + body sample in one row', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <FontPairPicker
        options={options}
        value="one"
        onChange={onChange}
        lang="en"
        label="Text style"
      />,
    );
    expect(container.querySelector('style')?.textContent).toContain('url("/f/h2.woff2")');
    expect(screen.getAllByText('Our school')).toHaveLength(2);
    await userEvent.click(screen.getByRole('combobox', { name: 'Text style' }));
    await userEvent.click((await screen.findAllByRole('option'))[1]!);
    expect(onChange).toHaveBeenCalledWith('two');
  });
});
