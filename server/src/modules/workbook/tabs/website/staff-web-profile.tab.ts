import { StaffWebProfile } from '../../../website/entities/staff-web-profile.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';
import { usersTab } from '../people/users.tab';

/** [40.1.08] `staff_web_profiles`: a staff member's public website card. The photo is a storage file, not a workbook row. */
export const staffWebProfilesTab = createRefChildTab<StaffWebProfile>({
  name: 'staff_web_profiles',
  entityClass: StaffWebProfile,
  refs: [{ key: 'user', fk: 'user_id', tab: usersTab, label: { en: 'Staff', bn: 'কর্মী' } }],
  fields: [
    {
      key: 'show_on_website',
      type: 'bool',
      required: true,
      label: { en: 'Show on website', bn: 'ওয়েবসাইটে দেখান' },
    },
    { key: 'featured', type: 'bool', required: true, label: { en: 'Featured', bn: 'বিশেষ' } },
    { key: 'sort_order', type: 'int', required: true, label: { en: 'Order', bn: 'ক্রম' } },
    { key: 'subjects', type: 'json', required: true, label: { en: 'Subjects', bn: 'বিষয়' } },
    { key: 'bio', type: 'json', label: { en: 'Bio', bn: 'পরিচিতি' } },
    { key: 'credentials', type: 'json', label: { en: 'Credentials', bn: 'যোগ্যতা' } },
  ],
  naturalKey: ['user'],
  // A removed staff member is not in the `users` tab; their card is left out rather than failing the export.
  filterRows: async (rows, tenantId, m) => {
    const known = new Set((await usersTab.load(tenantId, m)).map((u) => u.id));
    return rows.filter((r) => known.has(r.user_id));
  },
  checkRow: (row) =>
    row.subjects == null ||
    (Array.isArray(row.subjects) && row.subjects.every((v) => typeof v === 'string'))
      ? null
      : { column: 'subjects', message: 'Subjects must be a list of text' },
  excluded: ['photo_media_id'], // the picture is a storage file, not a workbook row
});
