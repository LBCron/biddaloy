import { SiteAnnouncementStyle, SiteMarqueeSpeed, SiteTheme } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { BASIC } from './basic';
import { COLLEGE_THEME } from './college';
import { HIGH_SCHOOL_THEME } from './high-school';
import { INTERNATIONAL_THEME } from './international';
import { MADRASA_THEME } from './madrasa';
import type { ThemeManifest } from './manifest';
import { PREMIUM_THEME } from './premium';
import { PRIMARY_THEME } from './primary';

export * from './manifest';
export * from './validate';
export { BASIC };

export const THEMES: Record<SiteTheme, ThemeManifest> = {
  [SiteTheme.BASIC]: BASIC,
  [SiteTheme.PRIMARY]: PRIMARY_THEME,
  [SiteTheme.HIGH_SCHOOL]: HIGH_SCHOOL_THEME,
  [SiteTheme.COLLEGE]: COLLEGE_THEME,
  [SiteTheme.MADRASA]: MADRASA_THEME,
  [SiteTheme.INTERNATIONAL]: INTERNATIONAL_THEME,
  [SiteTheme.PREMIUM]: PREMIUM_THEME,
};

/** A fresh config: first palette, default fonts, every page and section with bn/en defaults (D25). */
export function defaultConfigFor(theme: SiteTheme): SiteConfig {
  const m = THEMES[theme];
  return {
    theme,
    palette: m.palettes[0].id,
    typography: m.defaultTypography,
    announcements: {
      style: SiteAnnouncementStyle.STATIC,
      speed: SiteMarqueeSpeed.NORMAL,
      items: [],
    },
    pages: m.pages.map((p) => ({
      page: p.page,
      enabled: true,
      sections: p.sections.map((key) => {
        const def = m.sections.find((s) => s.key === key);
        const data: Record<string, unknown> = {};
        for (const f of def?.fields ?? []) {
          if (f.defaults) data[f.key] = { ...f.defaults };
          else if ('initial' in f) data[f.key] = f.initial;
        }
        return { key, enabled: def?.enabledByDefault !== false, data };
      }),
    })),
  };
}
