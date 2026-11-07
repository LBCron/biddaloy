import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('বিশ্বমানের শিক্ষা, ঘরের কাছে', 'A world-class education, close to home');
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'international/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, a finished demo school: Dreamhill International School. The last
 * word of the headline is drawn as the italic accent; the academics paragraphs are the pathway.
 */
const DEFAULTS: Record<string, BilingualText> = {
  'hero.kicker': t('কেমব্রিজ কারিকুলাম', 'Cambridge curriculum'),
  'hero.headline': t('বিশ্বের পথে প্রথম পদক্ষেপ', 'The first step toward the world'),
  'hero.tagline': t(
    'প্লে গ্রুপ থেকে এ-লেভেল পর্যন্ত, ইংরেজি ও বাংলা দুই ভাষাতেই।',
    'From Play Group to A-Level, in English and in Bangla.',
  ),
  'hero.ctaPrimary': t('ক্যাম্পাস ঘুরে দেখুন', 'Book a campus tour'),
  'hero.ctaSecondary': t('যোগাযোগ করুন', 'Contact us'),
  'about.title': t('ড্রিমহিল ইন্টারন্যাশনাল স্কুল', 'Dreamhill International School'),
  'about.body': t(
    'গুলশানে আমরা কেমব্রিজ পাঠ্যক্রমে পড়াই। ছোট ক্লাস, অভিজ্ঞ শিক্ষক, আর প্রতিটি শিশুর জন্য আলাদা নজর।',
    'We teach the Cambridge curriculum in Gulshan. Small classes, experienced teachers and individual attention for every child.',
  ),
  'notices.title': t('নোটিশ বোর্ড', 'Notice board'),
  'teachers.title': t('আমাদের শিক্ষক', 'Our teachers'),
  'admissions.title': t('ভর্তি', 'Admissions'),
  'admissions.body': t(
    'প্রতি বছর জানুয়ারি ও আগস্টে ভর্তি। ক্যাম্পাস ঘুরে দেখে, ছোট আলাপের পর আসন নিশ্চিত হয়।',
    'Admission is open each January and August. Visit the campus, have a short conversation, and your seat is confirmed.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('গুলশান, ঢাকা', 'Gulshan, Dhaka'),
  'academics.title': t('প্লে থেকে এ-লেভেল', 'From Play to A-Level'),
  'academics.body': t(
    'প্লে গ্রুপ: খেলার মধ্য দিয়ে ভাষা ও আত্মবিশ্বাস।\n\nআর্লি ইয়ার্স: পড়া, গোনা আর কৌতূহল।\n\nপ্রাইমারি: ইংরেজি, গণিত ও বিজ্ঞানের ভিত।\n\nলোয়ার সেকেন্ডারি: বিষয়ভিত্তিক গভীরতা ও গবেষণার অভ্যাস।\n\nআইজিসিএসই: কেমব্রিজ পরীক্ষার প্রস্তুতি।\n\nএ-লেভেল: বিশ্ববিদ্যালয়ের জন্য বিষয় বেছে নেওয়া।',
    'Play Group: language and confidence through play.\n\nEarly Years: reading, counting and curiosity.\n\nPrimary: foundations in English, maths and science.\n\nLower Secondary: depth in each subject and the habit of inquiry.\n\nIGCSE: preparation for the Cambridge examinations.\n\nA-Level: choosing the subjects that lead to university.',
  ),
};

export const INTERNATIONAL_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.INTERNATIONAL,
  name: t('ইন্টারন্যাশনাল', 'International'),
  // Each palette is one deep ground (primary, secondary) and one signal accent. The accent is read as
  // text only on primary or secondary; on the surface it is a rule or a fill, never type.
  palettes: [
    {
      id: 'midnight-gold',
      name: t('মধ্যরাত ও সোনা', 'Midnight and gold'),
      vars: {
        primary: '#0a1e3c',
        secondary: '#132c52',
        accent: '#f0b429',
        surface: '#f5f3ec',
        ink: '#15213a',
      },
    },
    {
      id: 'graphite-lime',
      name: t('গ্রাফাইট ও লাইম', 'Graphite and lime'),
      vars: {
        primary: '#1c1f26',
        secondary: '#2a2f3a',
        accent: '#b9d44a',
        surface: '#f4f4f1',
        ink: '#15181f',
      },
    },
    {
      id: 'bordeaux-cream',
      name: t('বোর্দো ও ক্রিম', 'Bordeaux and cream'),
      vars: {
        primary: '#4a1a2e',
        secondary: '#63263f',
        accent: '#d9a441',
        surface: '#f6f1ea',
        ink: '#22151b',
      },
    },
  ],
  fonts: {
    bn: [
      font('noto-sans-bengali', 'Noto Sans Bengali', [400, 700], ['bengali']),
      font('noto-serif-bengali', 'Noto Serif Bengali', [700], ['bengali']),
      // Shared with Basic: the same files, not copied.
      font('hind-siliguri', 'Hind Siliguri', [400, 700], ['bengali', 'latin'], ''),
    ],
    en: [
      font('fraunces', 'Fraunces', [300], ['latin']),
      font('inter', 'Inter', [400, 700], ['latin']),
      font('cormorant-garamond', 'Cormorant Garamond', [400], ['latin']),
      font('source-sans-3', 'Source Sans 3', [400, 700], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'noto-sans-bengali', body: 'noto-sans-bengali' },
    en: { heading: 'fraunces', body: 'inter' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
