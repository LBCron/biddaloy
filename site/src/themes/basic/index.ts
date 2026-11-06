import { SiteSectionKey } from '@biddaloy/shared';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import about from './sections/about.astro';
import admissions from './sections/admissions.astro';
import blog from './sections/blog.astro';
import contact from './sections/contact.astro';
import events from './sections/events.astro';
import hero from './sections/hero.astro';
import notices from './sections/notices.astro';
import teachers from './sections/teachers.astro';
import Layout from './Layout.astro';

export interface ThemeModule {
  Layout: AstroComponentFactory;
  sections: Partial<Record<SiteSectionKey, AstroComponentFactory>>;
}

export default {
  Layout,
  sections: {
    [SiteSectionKey.HERO]: hero,
    [SiteSectionKey.ABOUT]: about,
    [SiteSectionKey.ADMISSIONS]: admissions,
    [SiteSectionKey.TEACHERS]: teachers,
    [SiteSectionKey.NOTICES]: notices,
    [SiteSectionKey.EVENTS]: events,
    [SiteSectionKey.BLOG]: blog,
    [SiteSectionKey.CONTACT]: contact,
  },
} satisfies ThemeModule;
