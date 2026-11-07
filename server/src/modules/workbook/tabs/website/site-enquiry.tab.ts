import { SiteEnquiry } from '../../../website/entities/site-enquiry.entity';
import { createRefChildTab } from '../people/ref-child-tab.factory';

/**
 * [40.1.08] `site_enquiries`: messages from the public contact form. A restore never deletes one
 * (`deleteByAbsence: false`): a message that arrived after the backup was taken must survive it.
 */
export const siteEnquiriesTab = createRefChildTab<SiteEnquiry>({
  name: 'site_enquiries',
  entityClass: SiteEnquiry,
  refs: [],
  fields: [
    { key: 'name', type: 'string', required: true, label: { en: 'Name', bn: 'নাম' } },
    { key: 'phone', type: 'string', required: true, label: { en: 'Phone', bn: 'ফোন' } },
    { key: 'message', type: 'string', required: true, label: { en: 'Message', bn: 'বার্তা' } },
    { key: 'seen_at', type: 'datetime', label: { en: 'Seen at', bn: 'দেখার সময়' } },
    {
      key: 'created_at',
      type: 'datetime',
      required: true,
      label: { en: 'Sent at', bn: 'পাঠানোর সময়' },
    },
  ],
  // No business key: the send time and the sender keep two messages apart.
  naturalKey: ['created_at', 'name', 'phone', 'message'],
  checkRow: (row) => {
    const over = (k: string, max: number) =>
      typeof row[k] === 'string' && (row[k] as string).length > max;
    if (over('name', 120)) return { column: 'name', message: 'Name is longer than 120 characters' };
    if (over('phone', 20))
      return { column: 'phone', message: 'Phone is longer than 20 characters' };
    if (over('message', 2000))
      return { column: 'message', message: 'Message is longer than 2000 characters' };
    return null;
  },
  deleteByAbsence: false,
});
