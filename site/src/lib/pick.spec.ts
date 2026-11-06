import { describe, expect, it } from 'vitest';
import { pick } from './pick';

describe('pick', () => {
  it('bn returns bn', () => expect(pick({ bn: 'ক', en: 'a' }, 'bn')).toBe('ক'));
  it('en returns en when present', () => expect(pick({ bn: 'ক', en: 'a' }, 'en')).toBe('a'));
  it('en falls back to bn when en empty', () => expect(pick({ bn: 'ক', en: '' }, 'en')).toBe('ক'));
  it('empty or missing is undefined', () => {
    expect(pick({ bn: '', en: '' }, 'bn')).toBeUndefined();
    expect(pick(undefined, 'en')).toBeUndefined();
  });
});
