import { Notice } from '../../../modules/notices/entities/notice.entity';
import { NoticeAttachment } from '../../../modules/notices/entities/notice-attachment.entity';
import { NoticeRecipient } from '../../../modules/notices/entities/notice-recipient.entity';
import type { DemoSlice } from '../context';

/** Stub: the notice board tables exist (53.1.02); #3374 fills them and deletes `owedBy`. */
export const slice: DemoSlice = {
  name: 'notices',
  covers: [Notice, NoticeAttachment, NoticeRecipient],
  owedBy: '#3374',
  run: async () => 0,
};
