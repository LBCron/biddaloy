import { SiteTheme } from '@biddaloy/shared';
import basic from './basic';
import college from './college';
import highSchool from './high-school';
import international from './international';
import madrasa from './madrasa';
import premium from './premium';
import primary from './primary';

/** One module per SiteTheme; later waves replace a stub's file, never this map. */
export const themes = {
  [SiteTheme.BASIC]: basic,
  [SiteTheme.PRIMARY]: primary,
  [SiteTheme.HIGH_SCHOOL]: highSchool,
  [SiteTheme.COLLEGE]: college,
  [SiteTheme.MADRASA]: madrasa,
  [SiteTheme.INTERNATIONAL]: international,
  [SiteTheme.PREMIUM]: premium,
};
