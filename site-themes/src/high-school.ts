import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('জ্ঞান, শৃঙ্খলা, সাফল্য', 'Knowledge, discipline, achievement');
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'high-school/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, a finished demo school: Rampura Model High School.
 */
const DEFAULTS: Record<string, BilingualText> = {
  // The hero draws a four-digit year found in the kicker as the outlined numeral.
  'hero.kicker': t('প্রতিষ্ঠিত ১৯৬৮', 'Established 1968'),
  'hero.headline': t('জ্ঞান, শৃঙ্খলা, সাফল্য', 'Knowledge, discipline, achievement'),
  'hero.tagline': t(
    'ষষ্ঠ থেকে দশম শ্রেণি। এসএসসিতে প্রতি বছর ৯৮ শতাংশ পাস।',
    'Class 6 to 10. Ninety-eight in a hundred pass the SSC every year.',
  ),
  'hero.ctaPrimary': t('ভর্তির আবেদন করুন', 'Apply for admission'),
  'hero.ctaSecondary': t('যোগাযোগ করুন', 'Contact us'),
  'about.title': t('রামপুরা মডেল উচ্চ বিদ্যালয়', 'Rampura Model High School'),
  'about.body': t(
    'রামপুরায় ১৯৬৮ সাল থেকে আমরা শিক্ষা দিয়ে আসছি। পড়াশোনা, নিয়ম আর চরিত্র গঠন, তিনটিতেই সমান নজর।',
    'We have taught in Rampura since 1968. Study, discipline and character get equal care here.',
  ),
  'notices.title': t('নোটিশ বোর্ড', 'Notice board'),
  'teachers.title': t('আমাদের শিক্ষকমণ্ডলী', 'Our teachers'),
  'admissions.title': t('ভর্তি তথ্য', 'Admissions'),
  'admissions.body': t(
    'ষষ্ঠ শ্রেণিতে ভর্তি পরীক্ষার মাধ্যমে আসন পূরণ হয়। ফরম ও তারিখ অফিস থেকে নেওয়া যায়।',
    'Class 6 seats are filled through an admission test. Forms and dates are available at the office.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('রামপুরা, ঢাকা', 'Rampura, Dhaka'),
  'academics.title': t('শ্রেণি ও বিভাগ', 'Classes and groups'),
  'academics.body': t(
    'ষষ্ঠ ও সপ্তম শ্রেণি: বাংলা, ইংরেজি, গণিত, বিজ্ঞান, সমাজ ও ধর্ম।\n\nঅষ্টম শ্রেণি: বিষয়ের ভিত্তি পাকা করা, আর নবম শ্রেণির বিভাগ বাছাইয়ের প্রস্তুতি।\n\nনবম ও দশম শ্রেণি: বিজ্ঞান, মানবিক ও ব্যবসায় শিক্ষা বিভাগে এসএসসির প্রস্তুতি।',
    'Class 6 and 7: Bangla, English, maths, science, social studies and religion.\n\nClass 8: firm foundations in every subject, and preparation for choosing a group.\n\nClass 9 and 10: SSC preparation in the Science, Humanities and Business Studies groups.',
  ),
};

export const HIGH_SCHOOL_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.HIGH_SCHOOL,
  name: t('হাই স্কুল', 'High school'),
  // primary = bars, buttons, links (4.5:1 on surface); secondary = darkest bar; accent = gold, decoration
  // and gold text on the secondary bar only.
  palettes: [
    {
      id: 'heritage-green',
      name: t('ঐতিহ্য সবুজ', 'Heritage green'),
      vars: {
        primary: '#0f4d3a',
        secondary: '#0a3a2c',
        accent: '#c9a227',
        surface: '#f7f5ef',
        ink: '#15211c',
      },
    },
    {
      id: 'maroon',
      name: t('মেরুন', 'Maroon'),
      vars: {
        primary: '#6b1f2b',
        secondary: '#4a141d',
        accent: '#c9a227',
        surface: '#f8f4f1',
        ink: '#221a1c',
      },
    },
    {
      id: 'navy-brass',
      name: t('নেভি ও পিতল', 'Navy and brass'),
      vars: {
        primary: '#16304f',
        secondary: '#0f2238',
        accent: '#b48a3c',
        surface: '#f4f6f8',
        ink: '#16202b',
      },
    },
  ],
  fonts: {
    bn: [
      font('noto-serif-bengali', 'Noto Serif Bengali', [700], ['bengali']),
      font('noto-sans-bengali', 'Noto Sans Bengali', [400, 700], ['bengali']),
      font('tiro-bangla', 'Tiro Bangla', [400], ['bengali']),
      // Shared with Basic: the same files, not copied.
      font('hind-siliguri', 'Hind Siliguri', [400, 700], ['bengali', 'latin'], ''),
    ],
    en: [
      font('source-serif-4', 'Source Serif 4', [700], ['latin']),
      font('ibm-plex-sans', 'IBM Plex Sans', [400, 700], ['latin']),
      font('libre-caslon-text', 'Libre Caslon Text', [700], ['latin']),
      font('source-sans-3', 'Source Sans 3', [400, 700], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'noto-serif-bengali', body: 'noto-sans-bengali' },
    en: { heading: 'source-serif-4', body: 'ibm-plex-sans' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
