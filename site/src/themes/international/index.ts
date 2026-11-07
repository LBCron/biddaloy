import { SiteSectionKey } from '@biddaloy/shared';
import type { ThemeModule } from '../basic';
import about from './sections/about.astro';
import academics from './sections/academics.astro';
import admissions from './sections/admissions.astro';
import blog from './sections/blog.astro';
import contact from './sections/contact.astro';
import events from './sections/events.astro';
import gallery from './sections/gallery.astro';
import hero from './sections/hero.astro';
import notices from './sections/notices.astro';
import routine from './sections/routine.astro';
import teachers from './sections/teachers.astro';
import video from './sections/video.astro';
import Layout from './Layout.astro';

export default {
  Layout,
  sections: {
    [SiteSectionKey.HERO]: hero,
    [SiteSectionKey.ABOUT]: about,
    [SiteSectionKey.ACADEMICS]: academics,
    [SiteSectionKey.ROUTINE]: routine,
    [SiteSectionKey.ADMISSIONS]: admissions,
    [SiteSectionKey.TEACHERS]: teachers,
    [SiteSectionKey.NOTICES]: notices,
    [SiteSectionKey.EVENTS]: events,
    [SiteSectionKey.BLOG]: blog,
    [SiteSectionKey.CONTACT]: contact,
    [SiteSectionKey.GALLERY]: gallery,
    [SiteSectionKey.VIDEO]: video,
  },
} satisfies ThemeModule;
