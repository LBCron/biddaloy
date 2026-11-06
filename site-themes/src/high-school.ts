import { SiteTheme } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeManifest } from './manifest';

// Stub: Basic content under its own id and name until this theme's own wave.
export const HIGH_SCHOOL_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.HIGH_SCHOOL,
  name: { bn: 'হাই স্কুল', en: 'High school' },
};
