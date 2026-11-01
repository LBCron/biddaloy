import type { RuleMessage } from '@biddaloy/shared';
import { resolveTemplateLocale } from '../../account-access/account-access-templates';

export type AttentionLocale = 'bn' | 'en';

/** One resolver (#3136): no stored locale means the bn-BD default. */
export function resolveLocale(regionLocale?: string | null): AttentionLocale {
  return resolveTemplateLocale(regionLocale);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function toBanglaDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function render(
  messages: { bn: RuleMessage; en: RuleMessage },
  locale: AttentionLocale,
  params: Record<string, string | number>,
): RuleMessage {
  const sub = (s: string) =>
    s.replace(/\{(\w+)\}/g, (m, name: string) => {
      if (!Object.hasOwn(params, name)) return m;
      const v = String(params[name]);
      return locale === 'bn' ? toBanglaDigits(v) : v;
    });
  const m = messages[locale];
  return {
    title: sub(m.title),
    why: sub(m.why),
    steps: m.steps.map(sub),
    ...(m.action !== undefined ? { action: sub(m.action) } : {}),
  };
}
