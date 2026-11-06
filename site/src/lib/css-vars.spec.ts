import { SiteTheme } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import { textStyleVars, themeCss } from './css-vars';

const typo = {
  bn: { heading: 'hind-siliguri', body: 'hind-siliguri' },
  en: { heading: 'inter', body: 'inter' },
};

describe('themeCss', () => {
  it('emits palette vars and font family vars', () => {
    const { vars } = themeCss({ theme: SiteTheme.BASIC, palette: 'green', typography: typo });
    expect(vars['--primary']).toBe('#176d3a');
    expect(vars['--ink']).toBe('#17181c');
    expect(vars['--font-heading-bn']).toBe('"Hind Siliguri"');
    expect(vars['--font-body-en']).toBe('"Inter"');
  });
  it('unknown palette and font ids fall back', () => {
    const { vars } = themeCss({
      theme: SiteTheme.BASIC,
      palette: 'nope',
      typography: { bn: { heading: 'x', body: 'x' }, en: { heading: 'y', body: 'y' } },
    });
    expect(vars['--primary']).toBe('#1a4fd6');
    expect(vars['--font-heading-bn']).toBe('"Hind Siliguri"');
  });
  it('emits @font-face only for fonts in use, swap, deduped', () => {
    const { fontFaces } = themeCss({ theme: SiteTheme.BASIC, palette: 'blue', typography: typo });
    expect(fontFaces).toContain('font-display:swap');
    expect(fontFaces).toContain('/fonts/hind-siliguri-700-bengali.woff2');
    expect(fontFaces).not.toContain('noto-serif');
    expect(fontFaces.split('\n').filter((l) => l.includes('hind-siliguri-400-latin')).length).toBe(
      1,
    );
  });
});

describe('textStyleVars', () => {
  it('maps size, weight, align', () =>
    expect(textStyleVars({ size: 'XL', weight: 'bold', align: 'center' })).toEqual({
      '--h-size': '1.45',
      '--h-weight': '700',
      '--h-align': 'center',
    }));
  it('empty style -> no vars', () => expect(textStyleVars(undefined)).toEqual({}));
});
