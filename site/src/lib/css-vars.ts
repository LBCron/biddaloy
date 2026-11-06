import { SiteTheme } from '@biddaloy/shared';
import type { SiteTextStyle } from '@biddaloy/shared';
import { THEMES } from '@biddaloy/site-themes';
import type { SiteManifest } from './types';

const RANGES: Record<string, string> = {
  bengali:
    'U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1,U+11DF0-11DF1',
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
};

const SIZE = { S: '0.85', M: '1', L: '1.2', XL: '1.45' } as const;
const WEIGHT = { regular: '400', medium: '500', bold: '700' } as const;

export interface ThemeCss {
  /** `--primary` ... `--font-body-en`, as a flat map. */
  vars: Record<string, string>;
  /** `@font-face` rules for only the fonts the config uses. */
  fontFaces: string;
}

/** Palette + typography from the manifest; unknown palette/font ids fall back to the theme's first/default. */
export function themeCss(m: Pick<SiteManifest, 'theme' | 'palette' | 'typography'>): ThemeCss {
  const theme = THEMES[m.theme] ?? THEMES[SiteTheme.BASIC];
  const pal = theme.palettes.find((p) => p.id === m.palette) ?? theme.palettes[0];
  const vars: Record<string, string> = { ...pal.vars };
  const faces: string[] = [];
  for (const lang of ['bn', 'en'] as const) {
    for (const role of ['heading', 'body'] as const) {
      const id = m.typography?.[lang]?.[role] ?? theme.defaultTypography[lang][role];
      const font = theme.fonts[lang].find((f) => f.id === id) ?? theme.fonts[lang][0];
      vars[`font-${role}-${lang}`] = `"${font.family}"`;
      for (const file of font.files) {
        const rule = fontFace(font.family, file);
        if (rule && !faces.includes(rule)) faces.push(rule);
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[`--${k}`] = v;
  return { vars: out, fontFaces: faces.join('\n') };
}

/** File names are `<id>-<weight>-<subset>.woff2`. */
function fontFace(family: string, file: string): string | undefined {
  const mt = /-(\d{3})-([a-z]+)\.woff2$/.exec(file);
  if (!mt) return undefined;
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${mt[1]};font-display:swap;src:url(/fonts/${file}) format("woff2");unicode-range:${RANGES[mt[2]] ?? RANGES.latin}}`;
}

/** Per-section text style (D28, D29), as inline CSS variables. */
export function textStyleVars(style?: SiteTextStyle): Record<string, string> {
  const o: Record<string, string> = {};
  if (style?.size) o['--h-size'] = SIZE[style.size];
  if (style?.weight) o['--h-weight'] = WEIGHT[style.weight];
  if (style?.align) o['--h-align'] = style.align === 'center' ? 'center' : 'start';
  return o;
}

export const toStyle = (v: Record<string, string>) =>
  Object.entries(v)
    .map(([k, x]) => `${k}:${x}`)
    .join(';');
