import { describe, expect, it } from 'vitest';
import bn from './bn.json';
import en from './en.json';
import { t } from './t';

const keys = (o: unknown, p = ''): string[] =>
  Object.entries(o as object).flatMap(([k, v]) =>
    typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`],
  );

describe('i18n', () => {
  it('bn and en have the same keys', () => expect(keys(en).sort()).toEqual(keys(bn).sort()));
  it('t resolves nested keys per language', () => {
    expect(t('bn', 'nav.home')).toBe('হোম');
    expect(t('en', 'nav.home')).toBe('Home');
  });
  it('unknown key returns the key', () => expect(t('en', 'x.y')).toBe('x.y'));
});
