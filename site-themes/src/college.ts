import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('ফলাফলই আমাদের অভ্যাস', 'Results are our habit');
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'college/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, for a finished demo school: Shopnopur College.
 */
const DEFAULTS: Record<string, BilingualText> = {
  'hero.kicker': t('স্বপ্নপুর কলেজ · প্রতিষ্ঠিত ১৯৯৪', 'Shopnopur College · Established 1994'),
  'hero.headline': t('ফলাফলই আমাদের অভ্যাস', 'Results are our habit'),
  'hero.tagline': t(
    'একাদশ ও দ্বাদশ শ্রেণি: বিজ্ঞান, ব্যবসায় শিক্ষা ও মানবিক বিভাগ। এইচএসসিতে ধারাবাহিক ভালো ফল।',
    'Classes 11 and 12: Science, Business Studies and Humanities. Steady results in the HSC.',
  ),
  'hero.ctaPrimary': t('ভর্তির আবেদন করুন', 'Apply for admission'),
  'hero.ctaSecondary': t('যোগাযোগ করুন', 'Contact us'),
  'about.title': t('স্বপ্নপুর কলেজ', 'Shopnopur College'),
  'about.body': t(
    '১৯৯৪ সাল থেকে আমরা একাদশ ও দ্বাদশ শ্রেণির শিক্ষার্থীদের এইচএসসির জন্য তৈরি করে আসছি। নিয়মিত ক্লাস, নিয়মিত পরীক্ষা আর অভিজ্ঞ শিক্ষকের নজর, এই তিনটিই আমাদের ভিত্তি।',
    'Since 1994 we have prepared Class 11 and 12 students for the HSC. Regular classes, regular tests and the attention of experienced teachers are our foundation.',
  ),
  'notices.title': t('নোটিশ বোর্ড', 'Notice board'),
  'teachers.title': t('আমাদের শিক্ষকমণ্ডলী', 'Our faculty'),
  'admissions.title': t('একাদশ শ্রেণিতে ভর্তি', 'Admission to Class 11'),
  // Each blank-line-separated paragraph is one numbered step in this theme.
  'admissions.body': t(
    'আবেদন ফরম নিন।\n\nকাগজপত্র জমা দিন।\n\nভর্তি পরীক্ষায় অংশ নিন।\n\nফল দেখে ভর্তি নিশ্চিত করুন।',
    'Collect the application form.\n\nSubmit your documents.\n\nSit the admission test.\n\nSee the result and confirm your seat.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('স্বপ্নপুর, ঢাকা', 'Shopnopur, Dhaka'),
  'academics.title': t('বিভাগসমূহ', 'Departments'),
  'academics.body': t(
    'বিজ্ঞান বিভাগ: পদার্থ, রসায়ন, জীববিজ্ঞান ও উচ্চতর গণিত।\n\nব্যবসায় শিক্ষা বিভাগ: হিসাববিজ্ঞান, ব্যবসায় সংগঠন ও ব্যবস্থাপনা, ফিন্যান্স ও ব্যাংকিং।\n\nমানবিক বিভাগ: অর্থনীতি, পৌরনীতি, ইতিহাস ও সমাজবিজ্ঞান।',
    'Science: physics, chemistry, biology and higher mathematics.\n\nBusiness Studies: accounting, business organisation and management, finance and banking.\n\nHumanities: economics, civics, history and social science.',
  ),
};

export const COLLEGE_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.COLLEGE,
  name: t('কলেজ', 'College'),
  // primary = bars, buttons, links (white text on it, and itself on the surface, both 4.5:1); secondary = the darkest
  // band; accent = one hot colour for markers and rules only, it never carries text (D28).
  palettes: [
    {
      id: 'forest-ink',
      name: t('বন সবুজ ও কালি', 'Forest and ink'),
      vars: {
        primary: '#0f5132',
        secondary: '#0e1b2a',
        accent: '#e0552c',
        surface: '#ffffff',
        ink: '#0e1b2a',
      },
    },
    {
      id: 'oxford',
      name: t('অক্সফোর্ড নীল', 'Oxford blue'),
      vars: {
        primary: '#1f2f6b',
        secondary: '#0e1b2a',
        accent: '#d9772b',
        surface: '#ffffff',
        ink: '#0e1b2a',
      },
    },
    {
      id: 'slate-ember',
      name: t('ইস্পাত ও অঙ্গার', 'Slate and ember'),
      vars: {
        primary: '#2f3a44',
        secondary: '#1c242b',
        accent: '#c8452e',
        surface: '#fafaf8',
        ink: '#15202b',
      },
    },
  ],
  fonts: {
    bn: [
      font('anek-bangla', 'Anek Bangla', [700], ['bengali']),
      // Shared with Basic: the same files, not copied.
      font('hind-siliguri', 'Hind Siliguri', [400, 700], ['bengali', 'latin'], ''),
      font('noto-serif-bengali', 'Noto Serif Bengali', [700], ['bengali']),
      font('noto-sans-bengali', 'Noto Sans Bengali', [400, 700], ['bengali']),
    ],
    en: [
      font('space-grotesk', 'Space Grotesk', [700], ['latin']),
      font('inter', 'Inter', [400, 700], ['latin']),
      font('fraunces', 'Fraunces', [700], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'anek-bangla', body: 'hind-siliguri' },
    en: { heading: 'space-grotesk', body: 'inter' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
