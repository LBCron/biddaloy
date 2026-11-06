/**
 * The registry of /settings categories.
 *
 * To add a section to a category: (1) render it inside that category's `case` in `renderCategory` in `SchoolSettingsPage.tsx`; (2) if old links point at it with `/settings#<id>`, give it that `id` and add the id to the category's `anchors` here.
 */
import type { LucideIcon } from 'lucide-react';
import {
  BellDotIcon,
  Building2Icon,
  DatabaseIcon,
  GraduationCapIcon,
  LockIcon,
  MessageSquareIcon,
  PrinterIcon,
  ReceiptTextIcon,
  WalletIcon,
} from 'lucide-react';

export const SETTINGS_CATEGORY_IDS = [
  'school',
  'academics',
  'finance',
  'billing',
  'communication',
  'alerts',
  'printing',
  'security',
  'backup',
] as const;
export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

export interface SettingsCategory {
  id: SettingsCategoryId;
  icon: LucideIcon;
  /** DOM ids of sections in this category that old links point at (`/settings#<anchor>`). */
  anchors: readonly string[];
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: 'school', icon: Building2Icon, anchors: ['regional-section', 'organisation-section'] },
  { id: 'academics', icon: GraduationCapIcon, anchors: ['attendance-section', 'attendance-devices-section'] },
  { id: 'finance', icon: WalletIcon, anchors: [] },
  { id: 'billing', icon: ReceiptTextIcon, anchors: ['seats-billing-section'] },
  { id: 'communication', icon: MessageSquareIcon, anchors: [] },
  { id: 'alerts', icon: BellDotIcon, anchors: ['alerts-section'] },
  { id: 'printing', icon: PrinterIcon, anchors: ['printers-section'] },
  { id: 'security', icon: LockIcon, anchors: [] },
  { id: 'backup', icon: DatabaseIcon, anchors: [] },
];

/** Which category to show. `undefined` = nothing chosen (phone shows the list, desktop shows the first allowed). */
export function resolveSettingsCategory(
  input: {
    section?: SettingsCategoryId | undefined;
    backup?: string | undefined;
    hash?: string | undefined;
  },
  allowed: ReadonlySet<SettingsCategoryId>,
): SettingsCategoryId | undefined {
  const pick = (id: SettingsCategoryId | undefined) => (id && allowed.has(id) ? id : undefined);
  return (
    pick(input.section) ??
    (input.backup !== undefined ? pick('backup') : undefined) ??
    pick(SETTINGS_CATEGORIES.find((c) => input.hash && c.anchors.includes(input.hash))?.id)
  );
}
