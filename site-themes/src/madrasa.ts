import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('জ্ঞান, আদব, চরিত্র', 'Knowledge, manners, character');
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'madrasa/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, for a finished demo school: Jamia Darul Uloom Madrasa.
 */
const DEFAULTS: Record<string, BilingualText> = {
  'hero.kicker': t('জামিয়া দারুল উলূম মাদ্রাসা', 'Jamia Darul Uloom Madrasa'),
  'hero.headline': t(
    'জ্ঞান, আদব ও চরিত্র গঠনের শান্ত আঙিনা',
    'A calm place for knowledge, manners and character',
  ),
  'hero.tagline': t(
    'কুরআন ও দ্বীনি শিক্ষার সঙ্গে আধুনিক পাঠ। হিফজ, কিতাব, দাখিল ও আলিম বিভাগ।',
    'Quran and religious studies alongside modern subjects. Hifz, Kitab, Dakhil and Alim departments.',
  ),
  'hero.ctaPrimary': t('ভর্তির আবেদন করুন', 'Apply for admission'),
  'hero.ctaSecondary': t('যোগাযোগ করুন', 'Contact us'),
  'about.title': t('আমাদের কথা', 'About us'),
  'about.body': t(
    'জামিয়া দারুল উলূম মাদ্রাসা শিক্ষার্থীদের কুরআন শিক্ষা, দ্বীনি জ্ঞান ও সুন্দর আচরণে গড়ে তোলে। আবাসিক ও অনাবাসিক, দুই ব্যবস্থাই আছে।',
    'Jamia Darul Uloom Madrasa nurtures students in Quran learning, religious knowledge and good manners. Both residential and day places are available.',
  ),
  'notices.title': t('নোটিশ বোর্ড', 'Notice board'),
  'teachers.title': t('আমাদের উস্তাদগণ', 'Our teachers'),
  'admissions.title': t('ভর্তি তথ্য', 'Admissions'),
  'admissions.body': t(
    'হিফজ, কিতাব, দাখিল ও আলিম বিভাগে ভর্তি চলছে। ফরম ও তারিখ অফিস থেকে নেওয়া যায়। আলিয়া বোর্ডের পাঠ ও কওমি ধারার পাঠ, দুটির তথ্যই অফিসে পাওয়া যায়।',
    'Admission is open for the Hifz, Kitab, Dakhil and Alim departments. Forms and dates are available at the office. Details of both the Alia board and the Qawmi courses are available there.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('দারুল উলূম রোড, ঢাকা', 'Darul Uloom Road, Dhaka'),
  'academics.title': t('আমাদের বিভাগ', 'Our departments'),
  // Each blank-line-separated paragraph is one programme card in this theme.
  'academics.body': t(
    'হিফজ: কুরআন মুখস্থ, তাজবিদসহ।\n\nকিতাব: আরবি, ফিকহ, হাদিস ও তাফসিরের পাঠ।\n\nদাখিল: বাংলা, ইংরেজি, গণিত, বিজ্ঞানসহ দ্বীনি বিষয়।\n\nআলিম: উচ্চ মাধ্যমিক স্তরের দ্বীনি ও সাধারণ বিষয়।',
    'Hifz: memorising the Quran, with tajweed.\n\nKitab: Arabic, fiqh, hadith and tafsir studies.\n\nDakhil: Bangla, English, maths and science alongside religious subjects.\n\nAlim: religious and general subjects at higher-secondary level.',
  ),
};

export const MADRASA_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.MADRASA,
  name: t('মাদ্রাসা', 'Madrasa'),
  // primary = bars, buttons, links (white text on it, and itself on the surface, both 4.5:1); secondary = the lighter
  // band (white text on it, 4.5:1); accent = gold, hairlines and markers only, it never carries text (D28).
  palettes: [
    {
      id: 'forest-sand',
      name: t('বন সবুজ ও বালি', 'Forest and sand'),
      vars: {
        primary: '#0f3d2e',
        secondary: '#17543f',
        accent: '#b8903f',
        surface: '#fbf7ee',
        ink: '#1d2a24',
      },
    },
    {
      id: 'teal-ivory',
      name: t('টিল ও আইভরি', 'Teal and ivory'),
      vars: {
        primary: '#124b4c',
        secondary: '#1a6164',
        accent: '#b08a3e',
        surface: '#f8f6f0',
        ink: '#1b2726',
      },
    },
    {
      id: 'earth-olive',
      name: t('মাটি ও জলপাই', 'Earth and olive'),
      vars: {
        primary: '#4e5a2a',
        secondary: '#6a7a3a',
        accent: '#9d7a35',
        surface: '#f7f2e8',
        ink: '#27291e',
      },
    },
  ],
  // The Arabic face (Amiri) is loaded by theme.css itself, for lang="ar" text only, whatever pair is picked.
  fonts: {
    bn: [
      font('noto-serif-bengali', 'Noto Serif Bengali', [400, 700], ['bengali']),
      font('tiro-bangla', 'Tiro Bangla', [400], ['bengali']),
      font('noto-sans-bengali', 'Noto Sans Bengali', [400, 700], ['bengali']),
    ],
    en: [
      font('source-serif-4', 'Source Serif 4', [700], ['latin']),
      font('source-sans-3', 'Source Sans 3', [400, 700], ['latin']),
      font('noto-serif', 'Noto Serif', [700], ['latin']),
      font('inter', 'Inter', [400, 700], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'noto-serif-bengali', body: 'noto-serif-bengali' },
    en: { heading: 'source-serif-4', body: 'source-sans-3' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
