import { join } from 'node:path';
import { ACR_CRITERIA_SLOTS, CR80, DocumentKind } from '@biddaloy/shared';
import type { PrintElement, TemplateDefinition } from '@biddaloy/shared';
import { ADMIT_CARD_SUGGESTIONS } from './admit-card.suggestions';
import { STUDENT_CERTIFICATE_SUGGESTIONS } from './student-certificate.suggestions';
import { RESULT_CERTIFICATE_SUGGESTIONS } from './result-certificate.suggestions';
import {
  NAVY,
  PLACEHOLDER_ASSET,
  SANS,
  SERIF_BN,
  WHITE,
  ids,
  split,
  text,
  type Rect,
  type TextOpts,
} from './suggestion-helpers';

export type SuggestionOrientation = 'portrait' | 'landscape';
export type SuggestionStyle = 'classic' | 'modern';
export type ArtworkSide = 'front' | 'back';

export interface PrintSuggestion {
  key: string;
  documentKind: DocumentKind;
  orientation: SuggestionOrientation;
  style: SuggestionStyle;
  nameKey: string;
  /** File names inside `ARTWORK_DIR`. */
  artwork: { front: string; back?: string };
  definition: TemplateDefinition;
}

export const ARTWORK_DIR = join(__dirname, 'artwork');

/** Zones in mm, copied from `artwork/README.md`. Student and staff share them. */
interface Zones {
  photo: Rect;
  name: Rect;
  cls: Rect;
  info: Rect;
  school: Rect;
  /** Logo circle (cx, cy, r). */
  logo: [number, number, number];
  qr: Rect;
  address: Rect;
  validity: Rect;
}

const ZONES: Record<`${SuggestionOrientation}-${SuggestionStyle}`, Zones> = {
  'portrait-classic': {
    photo: [15, 27, 24, 30],
    name: [6, 59, 42, 6.5],
    cls: [6, 66.5, 42, 4.5],
    info: [6, 72, 42, 10.6],
    // The README has no school-name zone for portrait; the strip under the logo circle is clear.
    school: [6, 20.5, 42, 5],
    logo: [27, 13, 6.5],
    qr: [12, 14, 30, 30],
    address: [6, 48, 42, 14],
    validity: [6, 64, 42, 8],
  },
  'portrait-modern': {
    photo: [13, 22, 28, 34],
    name: [6, 60, 42, 7],
    cls: [6, 68, 42, 4.5],
    info: [6, 74.5, 42, 8.1],
    school: [19, 7, 29, 8],
    logo: [11, 11, 5.5],
    qr: [12, 10, 30, 30],
    address: [6, 43, 42, 15],
    validity: [6, 60, 42, 7],
  },
  'landscape-classic': {
    photo: [6, 20, 22, 28],
    name: [33, 21, 47, 7],
    cls: [33, 29, 47, 5],
    info: [33, 36, 47, 11],
    school: [19, 4, 63, 8],
    logo: [12, 7.5, 4.5],
    qr: [6, 12, 28, 28],
    address: [39, 12, 41, 15],
    validity: [39, 30, 41, 10],
  },
  'landscape-modern': {
    photo: [5, 11, 22, 28],
    name: [36, 18, 44, 7],
    cls: [36, 26, 44, 5],
    info: [36, 34, 44, 14],
    school: [36, 6, 34, 8],
    logo: [76, 10, 5],
    qr: [52, 12, 28, 28],
    address: [17, 12, 30, 15],
    validity: [17, 30, 30, 10],
  },
};

const PRIMARY: Partial<Record<DocumentKind, string>> = {
  [DocumentKind.STUDENT_ID_CARD]: '#0B3A6B',
  [DocumentKind.STAFF_ID_CARD]: '#2B2F36',
  [DocumentKind.ACR_ASSESSMENT]: '#0B3A6B',
};

function build(kind: DocumentKind, o: SuggestionOrientation, s: SuggestionStyle): PrintSuggestion {
  const student = kind === DocumentKind.STUDENT_ID_CARD;
  const p = student ? 'student' : 'staff';
  const key = `${p}-${o}-${s}`;
  const z = ZONES[`${o}-${s}`];
  const c = PRIMARY[kind] ?? NAVY;
  const portrait = o === 'portrait';
  const align = portrait ? 'center' : 'left';
  const nameFont = s === 'classic' ? SERIF_BN : SANS;
  const [nameBn, nameEn] = split(z.name, 2) as [Rect, Rect];
  const [classCell, sectionCell] = split(z.cls, 2, true) as [Rect, Rect];
  const [infoA, infoB] = split(z.info, 2) as [Rect, Rect];
  const [ifFoundEn, ifFoundBn, phone, site] = split(z.address, 4) as [Rect, Rect, Rect, Rect];
  const [lx, ly, lr] = z.logo;
  const line = { pt: 7, color: c, align } as const;

  const front: PrintElement[] = [
    {
      id: '',
      type: 'IMAGE',
      x: z.photo[0],
      y: z.photo[1],
      w: z.photo[2],
      h: z.photo[3],
      field: `${p}.photo`,
      fit: 'COVER',
      alignY: 'top',
    },
    {
      id: '',
      type: 'IMAGE',
      x: lx - lr,
      y: ly - lr,
      w: lr * 2,
      h: lr * 2,
      field: 'school.logo',
      fit: 'CONTAIN',
      alignY: 'center',
    },
    // School name is on the dark header band in the classic designs, beside the logo in modern.
    text(z.school, {
      field: 'school.name',
      pt: 7,
      color: s === 'classic' ? WHITE : c,
      weight: 700,
      align,
    }),
    text(nameBn, { field: `${p}.name_bn`, font: nameFont, pt: 8, color: c, weight: 700, align }),
    text(nameEn, { field: `${p}.name`, font: nameFont, pt: 7, color: c, weight: 600, align }),
    ...(student
      ? [
          text(classCell, { field: 'student.class', ...line }),
          text(sectionCell, { field: 'student.section', ...line }),
          text(infoA, { field: 'student.roll', ...line }),
        ]
      : [
          text(z.cls, { field: 'staff.designation', ...line }),
          text(infoA, { field: 'staff.employee_id', ...line }),
        ]),
    text(infoB, { field: `${p}.blood_group`, ...line }),
  ];
  const back: PrintElement[] = [
    { id: '', type: 'QR', x: z.qr[0], y: z.qr[1], w: z.qr[2], h: z.qr[3] },
    text(ifFoundEn, {
      text: 'If found, please return to the school.',
      pt: 5,
      color: c,
      align: 'center',
    }),
    text(ifFoundBn, {
      text: 'পাওয়া গেলে অনুগ্রহ করে বিদ্যালয়ে ফেরত দিন।',
      pt: 5,
      color: c,
      align: 'center',
    }),
    text(phone, {
      field: student ? 'guardian.phone' : 'school.phone',
      pt: 6,
      color: c,
      weight: 600,
      align: 'center',
    }),
    // Empty when the school's website is off (the cell just prints blank).
    text(site, { field: 'school.website_url', pt: 6, color: c, align: 'center' }),
    text(z.validity, { field: 'card.valid_until', pt: 7, color: c, weight: 600, align: 'center' }),
  ];
  const background = { assetId: PLACEHOLDER_ASSET, print: true };
  return {
    key,
    documentKind: kind,
    orientation: o,
    style: s,
    nameKey: `print.suggestion.${key.replaceAll('-', '_')}`,
    artwork: { front: `${key}-front.svg`, back: `${key}-back.svg` },
    definition: {
      page: {
        widthMm: portrait ? CR80.heightMm : CR80.widthMm,
        heightMm: portrait ? CR80.widthMm : CR80.heightMm,
        sides: ['front', 'back'],
      },
      copyLabel: { text: 'Copy {n}' },
      front: { background, elements: ids('front', front) },
      back: { background, elements: ids('back', back) },
    },
  };
}

/** A4 portrait, front only: header, one row per criterion slot (EN, BN, score), total. */
function buildAcr(): PrintSuggestion {
  const c = PRIMARY[DocumentKind.ACR_ASSESSMENT] ?? NAVY;
  const rows: PrintElement[] = Array.from({ length: ACR_CRITERIA_SLOTS }, (_, i) => {
    const y = 44 + 7.5 * i;
    const n = i + 1;
    return [
      text([11, y, 84, 7], { field: `acr.criterion.${n}.label`, pt: 8, color: c, align: 'left' }),
      text([97, y, 85, 7], {
        field: `acr.criterion.${n}.label_bn`,
        font: SERIF_BN,
        pt: 8,
        color: c,
        align: 'left',
      }),
      text([184, y, 15, 7], {
        field: `acr.criterion.${n}.score`,
        pt: 9,
        color: c,
        weight: 700,
        align: 'center',
      }),
    ];
  }).flat();
  const front: PrintElement[] = [
    text([10, 8, 190, 8], { field: 'school.name', pt: 14, color: c, weight: 700, align: 'center' }),
    text([10, 17, 190, 7], {
      text: 'Annual Confidential Report (ACR)',
      pt: 11,
      color: c,
      weight: 600,
      align: 'center',
    }),
    text([10, 26, 120, 6], { field: 'staff.name', pt: 11, color: c, weight: 700, align: 'left' }),
    text([10, 32, 120, 5], {
      field: 'staff.name_bn',
      font: SERIF_BN,
      pt: 9,
      color: c,
      align: 'left',
    }),
    text([10, 36, 120, 4.5], { field: 'staff.designation', pt: 9, color: c, align: 'left' }),
    text([150, 26, 50, 6], { field: 'acr.year', pt: 11, color: c, weight: 700, align: 'right' }),
    ...rows,
    text([10, 276, 30, 7], { text: 'Completed:', pt: 8, color: c, align: 'left' }),
    text([40, 276, 50, 7], { field: 'acr.completed_on', pt: 9, color: c, align: 'left' }),
    text([132, 276, 38, 7], { text: 'Total', pt: 10, color: c, weight: 700, align: 'right' }),
    text([172, 276, 26, 7], { field: 'acr.total', pt: 11, color: c, weight: 700, align: 'center' }),
  ];
  return {
    key: 'acr-a4-standard',
    documentKind: DocumentKind.ACR_ASSESSMENT,
    orientation: 'portrait',
    style: 'classic',
    nameKey: 'print.suggestion.acr_a4_standard',
    artwork: { front: 'acr-a4-standard-front.svg' },
    definition: {
      page: { widthMm: 210, heightMm: 297, sides: ['front'] },
      copyLabel: { text: 'Copy {n}' },
      front: {
        background: { assetId: PLACEHOLDER_ASSET, print: true },
        elements: ids('front', front),
      },
    },
  };
}

export const PRINT_SUGGESTIONS: readonly PrintSuggestion[] = [
  ...[DocumentKind.STUDENT_ID_CARD, DocumentKind.STAFF_ID_CARD].flatMap((kind) =>
    (['portrait', 'landscape'] as const).flatMap((o) =>
      (['classic', 'modern'] as const).map((s) => build(kind, o, s)),
    ),
  ),
  buildAcr(),
  ...ADMIT_CARD_SUGGESTIONS,
  ...STUDENT_CERTIFICATE_SUGGESTIONS,
  ...RESULT_CERTIFICATE_SUGGESTIONS,
];
