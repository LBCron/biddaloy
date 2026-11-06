import { SiteTheme } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeManifest } from './manifest';

// Stub: Basic content under its own id and name until this theme's own wave.
export const PRIMARY_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.PRIMARY,
  name: { bn: 'প্রাইমারি', en: 'Primary' },
};
