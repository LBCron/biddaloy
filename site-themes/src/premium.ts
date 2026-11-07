import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('ঐতিহ্য ও আধুনিকতার মিলন', 'Heritage, held with a modern hand');
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'premium/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, a finished demo school: Kalponagar Grammar School, est. 1961.
 */
const DEFAULTS: Record<string, BilingualText> = {
  'hero.kicker': t('প্রতিষ্ঠিত ১৯৬১', 'Established 1961'),
  'hero.headline': t('ঐতিহ্য, আধুনিক হাতে', 'Heritage, held with a modern hand'),
  'hero.tagline': t(
    'ছয় দশকের পথচলা। প্রতিটি শিক্ষার্থীর জন্য মনোযোগ, মর্যাদা আর সময়।',
    'Six decades of teaching. Attention, dignity and time for every student.',
  ),
  'hero.ctaPrimary': t('ভর্তির আবেদন', 'Apply for admission'),
  'hero.ctaSecondary': t('যোগাযোগ', 'Contact'),
  'about.title': t('কল্পনগর গ্রামার স্কুল', 'Kalponagar Grammar School'),
  'about.body': t(
    'কল্পনগরে ১৯৬১ সাল থেকে আমরা পড়াচ্ছি। শান্ত পরিবেশ, অভিজ্ঞ শিক্ষক, আর সময় নিয়ে শেখার সংস্কৃতি।',
    'We have taught in Kalponagar since 1961. A quiet campus, experienced teachers and a culture of learning without hurry.',
  ),
  'notices.title': t('বিজ্ঞপ্তি', 'Notices'),
  'teachers.title': t('আমাদের শিক্ষকবৃন্দ', 'Our faculty'),
  'admissions.title': t('ভর্তি', 'Admissions'),
  'admissions.body': t(
    'প্রতি বছর সীমিত আসনে ভর্তি নেওয়া হয়। অভিভাবকের সঙ্গে আলাপের পর আসন নিশ্চিত হয়।',
    'A limited number of seats is offered each year. A seat is confirmed after a conversation with the family.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('কল্পনগর', 'Kalponagar'),
  'academics.title': t('পাঠক্রম', 'Curriculum'),
  'academics.body': t(
    'প্রাথমিক: ভাষা, গণিত ও পরিবেশ পরিচিতির ভিত।\n\nমাধ্যমিক: বিজ্ঞান, মানবিক ও ব্যবসায় শিক্ষায় গভীর পাঠ।\n\nসহ-পাঠ: সাহিত্য, সংগীত ও বিতর্ক, পাঠের পাশাপাশি।',
    'Primary: foundations in language, mathematics and the world around us.\n\nSecondary: considered study in science, the humanities and business.\n\nBeyond the classroom: literature, music and debate alongside the syllabus.',
  ),
};

export const PREMIUM_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.PREMIUM,
  name: t('প্রিমিয়াম', 'Premium'),
  // primary = header, buttons, headings (white on it passes AA); secondary = hover and the darkest band;
  // accent = one brass for hairlines and ornaments only, never text. Warm neutrals throughout.
  palettes: [
    {
      id: 'ivory-oxblood',
      name: t('আইভরি ও অক্সব্লাড', 'Ivory and oxblood'),
      vars: {
        primary: '#5a1e2b',
        secondary: '#71283a',
        accent: '#8f7a4d',
        surface: '#f4f1ea',
        ink: '#2b2520',
      },
    },
    {
      id: 'ivory-ink',
      name: t('আইভরি ও কালি', 'Ivory and ink'),
      vars: {
        primary: '#1f2a33',
        secondary: '#2f3b45',
        accent: '#8f7a4d',
        surface: '#f5f3ee',
        ink: '#23272b',
      },
    },
    {
      id: 'linen-forest',
      name: t('লিনেন ও বন', 'Linen and forest'),
      vars: {
        primary: '#223b2f',
        secondary: '#2e4d3d',
        accent: '#9a8450',
        surface: '#f3f1ea',
        ink: '#22281f',
      },
    },
  ],
  fonts: {
    bn: [
      font('tiro-bangla', 'Tiro Bangla', [400], ['bengali']),
      font('noto-serif-bengali', 'Noto Serif Bengali', [400], ['bengali']),
      // Shared with Basic: the same files, not copied.
      font('hind-siliguri', 'Hind Siliguri', [400, 700], ['bengali', 'latin'], ''),
    ],
    en: [
      font('cormorant-garamond', 'Cormorant Garamond', [400], ['latin']),
      font('libre-caslon-text', 'Libre Caslon Text', [400], ['latin']),
      font('fraunces', 'Fraunces', [400], ['latin']),
      font('source-serif-4', 'Source Serif 4', [400], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'tiro-bangla', body: 'noto-serif-bengali' },
    en: { heading: 'cormorant-garamond', body: 'libre-caslon-text' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
