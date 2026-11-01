import type { TabSpec } from '../../codec/tab-spec';
import { noticeAttachmentsTab } from './notice-attachments.tab';
import { noticeRecipientsTab } from './notice-recipients.tab';
import { noticesTab } from './notices.tab';

/** [53.6.02] Restore order: notices first, then the two tabs that hang off it. */
export const noticesTabs: TabSpec<any, any>[] = [
  noticesTab,
  noticeAttachmentsTab,
  noticeRecipientsTab,
];

export { noticesTab, noticeAttachmentsTab, noticeRecipientsTab };
