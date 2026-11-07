import { SiteMediaSlot, SitePage, SiteSectionKey, SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import type { ThemeField, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const text = (key: string, defaults: BilingualText): ThemeField => ({
  key,
  kind: 'text',
  required: true,
  defaults,
});
const rich = (key: string, defaults: BilingualText): ThemeField => ({
  key,
  kind: 'richtext',
  required: true,
  defaults,
});
/** Optional text with no default: shown only when the school fills it in. */
const optional = (key: string): ThemeField => ({ key, kind: 'text', required: false });
const images = (key: string, slot: SiteMediaSlot): ThemeField => ({
  key,
  kind: 'images',
  required: false,
  slot,
});

const flag = (key: string, kind: ThemeField['kind'], initial: unknown): ThemeField => ({
  key,
  kind,
  required: false,
  initial,
});

const woff = (family: string, weights: number[], subsets: string[]) =>
  weights.flatMap((w) => subsets.map((s) => `${family}-${w}-${s}.woff2`));
const BN = ['bengali', 'latin'];
const LATIN = ['latin'];
const SAMPLE = t('ভালো মানুষ হওয়ার শিক্ষা', 'Education that builds good people');

export const BASIC: ThemeManifest = {
  id: SiteTheme.BASIC,
  name: t('বেসিক', 'Basic'),
  palettes: [
    {
      id: 'blue',
      name: t('নীল', 'Blue'),
      vars: {
        primary: '#1a4fd6',
        secondary: '#0f3aa8',
        accent: '#e8eefc',
        surface: '#ffffff',
        ink: '#17181c',
      },
    },
    {
      id: 'green',
      name: t('সবুজ', 'Green'),
      vars: {
        primary: '#176d3a',
        secondary: '#0f4f2a',
        accent: '#e6f4ea',
        surface: '#ffffff',
        ink: '#17181c',
      },
    },
    {
      id: 'maroon',
      name: t('মেরুন', 'Maroon'),
      vars: {
        primary: '#8c1d2f',
        secondary: '#6a1523',
        accent: '#fbeaed',
        surface: '#ffffff',
        ink: '#17181c',
      },
    },
  ],
  fonts: {
    bn: [
      {
        id: 'hind-siliguri',
        family: 'Hind Siliguri',
        files: woff('hind-siliguri', [400, 500, 600, 700], BN),
        sample: SAMPLE,
      },
      {
        id: 'noto-serif-bengali',
        family: 'Noto Serif Bengali',
        files: woff('noto-serif-bengali', [400, 700], BN),
        sample: SAMPLE,
      },
    ],
    en: [
      {
        id: 'inter',
        family: 'Inter',
        files: woff('inter', [400, 600, 700], LATIN),
        sample: SAMPLE,
      },
      {
        id: 'source-serif',
        family: 'Source Serif',
        files: woff('source-serif', [400, 700], LATIN),
        sample: SAMPLE,
      },
    ],
  },
  defaultTypography: {
    bn: { heading: 'hind-siliguri', body: 'hind-siliguri' },
    en: { heading: 'inter', body: 'inter' },
  },
  sections: [
    {
      key: SiteSectionKey.HERO,
      fields: [
        text('kicker', t('আপনার স্কুলের স্লোগান', 'Your school tagline')),
        text(
          'headline',
          t(
            'ভালো মানুষ হওয়ার শিক্ষা, প্রতিদিন।',
            'An education that builds good people, every day.',
          ),
        ),
        text(
          'tagline',
          t('আমাদের স্কুল সম্পর্কে এক-দুই লাইন লিখুন।', 'Write a line or two about your school.'),
        ),
        text('ctaPrimary', t('ভর্তির আবেদন করুন', 'Apply for admission')),
        text('ctaSecondary', t('যোগাযোগ করুন', 'Contact us')),
        images('images', SiteMediaSlot.HERO),
      ],
    },
    {
      key: SiteSectionKey.ABOUT,
      fields: [
        text('title', t('আমাদের কথা', 'About us')),
        rich(
          'body',
          t(
            'আপনার স্কুলের ইতিহাস ও লক্ষ্য এখানে লিখুন।',
            'Write your school history and mission here.',
          ),
        ),
        images('images', SiteMediaSlot.ABOUT),
      ],
    },
    { key: SiteSectionKey.NOTICES, fields: [text('title', t('নোটিশ বোর্ড', 'Notice board'))] },
    { key: SiteSectionKey.TEACHERS, fields: [text('title', t('আমাদের শিক্ষক', 'Our teachers'))] },
    {
      key: SiteSectionKey.ADMISSIONS,
      fields: [
        text('title', t('ভর্তি তথ্য', 'Admissions')),
        rich(
          'body',
          t('ভর্তির নিয়ম ও তারিখ এখানে লিখুন।', 'Write admission rules and dates here.'),
        ),
      ],
    },
    {
      key: SiteSectionKey.CONTACT,
      fields: [
        text('title', t('যোগাযোগ', 'Contact')),
        text('address', t('স্কুলের ঠিকানা লিখুন', 'Write your school address')),
        // The map, WhatsApp and Facebook links the site shows when filled (latitude and longitude
        // as plain numbers, WhatsApp as a number or wa.me link, Facebook as an https link).
        optional('lat'),
        optional('lng'),
        optional('whatsapp'),
        optional('facebook'),
      ],
    },
    {
      key: SiteSectionKey.ACADEMICS,
      fields: [
        text('title', t('শিক্ষা কার্যক্রম', 'Academics')),
        rich(
          'body',
          t(
            'আপনার স্কুলের শ্রেণি ও পাঠ্যক্রমের কথা এখানে লিখুন।',
            'Write about your classes and curriculum here.',
          ),
        ),
      ],
    },
    { key: SiteSectionKey.ROUTINE, fields: [text('title', t('ক্লাস রুটিন', 'Class routine'))] },
    {
      key: SiteSectionKey.GALLERY,
      enabledByDefault: false,
      fields: [
        text('heading', t('ছবির গ্যালারি', 'Photo gallery')),
        flag('albumId', 'uuid', null),
        flag('showPageLink', 'bool', false),
      ],
    },
    {
      key: SiteSectionKey.VIDEO,
      enabledByDefault: false,
      fields: [
        text('heading', t('ভিডিও', 'Video')),
        { ...flag('headingPosition', 'choice', 'above'), options: ['above', 'below'] },
        flag('videoId', 'youtubeId', null),
        flag('startSeconds', 'seconds', null),
      ],
    },
  ],
  pages: [
    {
      page: SitePage.HOME,
      sections: [
        SiteSectionKey.HERO,
        SiteSectionKey.ABOUT,
        SiteSectionKey.NOTICES,
        SiteSectionKey.TEACHERS,
        SiteSectionKey.GALLERY,
        SiteSectionKey.VIDEO,
      ],
    },
    { page: SitePage.ABOUT, sections: [SiteSectionKey.ABOUT] },
    { page: SitePage.ACADEMICS, sections: [SiteSectionKey.ACADEMICS, SiteSectionKey.ROUTINE] },
    { page: SitePage.ADMISSIONS, sections: [SiteSectionKey.ADMISSIONS] },
    { page: SitePage.NOTICES, sections: [SiteSectionKey.NOTICES] },
    { page: SitePage.TEACHERS, sections: [SiteSectionKey.TEACHERS] },
    { page: SitePage.RESULTS, sections: [], enabledByDefault: false },
    { page: SitePage.GALLERY, sections: [SiteSectionKey.GALLERY] },
    { page: SitePage.CONTACT, sections: [SiteSectionKey.CONTACT] },
  ],
};
