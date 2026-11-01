import { resolveTemplateLocale } from './account-access-templates';

describe('resolveTemplateLocale', () => {
  it('maps a bn region locale to Bangla, ignoring case', () => {
    expect(resolveTemplateLocale('bn-BD')).toBe('bn');
    expect(resolveTemplateLocale('BN')).toBe('bn');
  });

  it('maps any other stored locale to English', () => {
    expect(resolveTemplateLocale('en-BD')).toBe('en');
    expect(resolveTemplateLocale('en-US')).toBe('en');
  });

  // [#3136] Raw stored settings are untyped: a missing locale means the platform default
  // region (bn-BD), the same answer resolveTenantSettings gives, not English.
  it('falls back to the default region (Bangla) for undefined', () => {
    expect(resolveTemplateLocale(undefined)).toBe('bn');
  });

  it('falls back to the default region (Bangla) for null', () => {
    expect(resolveTemplateLocale(null)).toBe('bn');
  });

  it('falls back to the default region (Bangla) for an empty string', () => {
    expect(resolveTemplateLocale('')).toBe('bn');
  });

  it('falls back to the default region (Bangla) for a non-string value', () => {
    expect(resolveTemplateLocale(42)).toBe('bn');
  });
});
