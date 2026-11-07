import { SiteTheme } from '@biddaloy/shared';
import type { BilingualText } from '@biddaloy/shared';
import { BASIC } from './basic';
import type { ThemeFont, ThemeManifest } from './manifest';

const t = (bn: string, en: string): BilingualText => ({ bn, en });
const SAMPLE = t('আমাদের স্কুলে সবাই নিরাপদ', 'Everyone is safe at our school');
const BN = ['bengali', 'latin'];
const font = (
  id: string,
  family: string,
  weights: number[],
  subsets: string[],
  dir = 'primary/',
): ThemeFont => ({
  id,
  family,
  files: weights.flatMap((w) => subsets.map((s) => `${dir}${id}-${w}-${s}.woff2`)),
  sample: SAMPLE,
});

/**
 * Same sections, fields and pages as Basic (so switching themes never loses content, D25); only the
 * default texts are this theme's, a finished demo school: Surjomukhi Children's School.
 */
const DEFAULTS: Record<string, BilingualText> = {
  'hero.kicker': t('প্লে গ্রুপ থেকে পঞ্চম শ্রেণি', 'Play group to Class 5'),
  'hero.headline': t(
    'আপনার সন্তানের প্রথম স্কুল, নিরাপদ ও আনন্দের',
    "Your child's first school, safe and happy",
  ),
  'hero.tagline': t(
    'ছোট ক্লাস, যত্নশীল শিক্ষক, আর প্রতিদিন নিরাপদে বাড়ি ফেরা।',
    'Small classes, caring teachers, and a safe journey home every day.',
  ),
  'hero.ctaPrimary': t('ভর্তির আবেদন করুন', 'Apply for admission'),
  'hero.ctaSecondary': t('যোগাযোগ করুন', 'Contact us'),
  'about.title': t('সূর্যমুখী শিশু বিদ্যালয়ের কথা', 'About Surjomukhi Children’s School'),
  'about.body': t(
    'আমরা ধানমন্ডিতে শিশুদের জন্য একটি শান্ত, আলোয় ভরা স্কুল গড়েছি। এখানে খেলতে খেলতে শেখা হয়, আর অভিভাবক নিশ্চিন্তে থাকেন।',
    'We built a calm, sunlit school for little ones in Dhanmondi. Children learn through play, and parents can rest easy.',
  ),
  'notices.title': t('নোটিশ বোর্ড', 'Notice board'),
  'teachers.title': t('আমাদের শিক্ষক', 'Our teachers'),
  'admissions.title': t('ভর্তি চলছে', 'Admissions are open'),
  'admissions.body': t(
    'প্লে গ্রুপ থেকে পঞ্চম শ্রেণি পর্যন্ত ভর্তি নেওয়া হয়। আবেদনের পর অভিভাবককে স্কুলে ডেকে কথা বলা হয়।',
    'We admit children from Play group to Class 5. After you apply, we invite you to the school for a chat.',
  ),
  'contact.title': t('যোগাযোগ', 'Contact'),
  'contact.address': t('ধানমন্ডি, ঢাকা', 'Dhanmondi, Dhaka'),
  'academics.title': t('আমরা যা শেখাই', 'What we teach'),
  'academics.body': t(
    'প্লে গ্রুপ ও নার্সারি: ছড়া, রং, গল্প আর খেলা।\n\nকেজি: অক্ষর, সংখ্যা আর হাতের লেখার শুরু।\n\nপ্রথম থেকে পঞ্চম শ্রেণি: বাংলা, ইংরেজি, গণিত, বিজ্ঞান আর সমাজ।',
    'Play group and Nursery: rhymes, colours, stories and play.\n\nKG: letters, numbers and first handwriting.\n\nClass 1 to 5: Bangla, English, maths, science and social studies.',
  ),
};

export const PRIMARY_THEME: ThemeManifest = {
  ...BASIC,
  id: SiteTheme.PRIMARY,
  name: t('প্রাইমারি', 'Primary'),
  // Colours: primary = links, buttons, headings (4.5:1 on surface); secondary + accent are decoration only.
  palettes: [
    {
      id: 'sunlit',
      name: t('রোদেলা', 'Sunlit'),
      vars: {
        primary: '#3f7a4b',
        secondary: '#3f7fa6',
        accent: '#d4603f',
        surface: '#fff8ec',
        ink: '#2e3a33',
      },
    },
    {
      id: 'meadow',
      name: t('মাঠ', 'Meadow'),
      vars: {
        primary: '#3e7c47',
        secondary: '#e0a526',
        accent: '#c7563a',
        surface: '#f6fbf1',
        ink: '#27352c',
      },
    },
    {
      id: 'seaside',
      name: t('সমুদ্রতীর', 'Seaside'),
      vars: {
        primary: '#2f6f9f',
        secondary: '#f0b65a',
        accent: '#d9573e',
        surface: '#f2f8fc',
        ink: '#243141',
      },
    },
    {
      id: 'sunset',
      name: t('গোধূলি', 'Sunset'),
      vars: {
        primary: '#b8502f',
        secondary: '#4f8a5b',
        accent: '#3f7fa6',
        surface: '#fff4ea',
        ink: '#35312d',
      },
    },
  ],
  fonts: {
    bn: [
      font('baloo-da-2', 'Baloo Da 2', [700], BN),
      // Shared with Basic: the same files, not copied.
      font('hind-siliguri', 'Hind Siliguri', [400, 700], BN, ''),
      font('galada', 'Galada', [400], ['bengali']),
      font('noto-sans-bengali', 'Noto Sans Bengali', [400, 700], ['bengali']),
    ],
    en: [
      font('baloo-2', 'Baloo 2', [700], ['latin']),
      font('nunito', 'Nunito', [400, 700], ['latin']),
      font('fredoka', 'Fredoka', [600], ['latin']),
    ],
  },
  defaultTypography: {
    bn: { heading: 'baloo-da-2', body: 'hind-siliguri' },
    en: { heading: 'baloo-2', body: 'nunito' },
  },
  sections: BASIC.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const d = DEFAULTS[`${s.key}.${f.key}`];
      return d ? { ...f, defaults: d } : f;
    }),
  })),
};
