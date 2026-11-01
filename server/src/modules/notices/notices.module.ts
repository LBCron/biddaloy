import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notice } from './entities/notice.entity';
import { NoticeAttachment } from './entities/notice-attachment.entity';
import { NoticeRecipient } from './entities/notice-recipient.entity';

/** [53.1.02] Notice board. Entities only; services/controllers land in later tickets. */
@Module({
  imports: [TypeOrmModule.forFeature([Notice, NoticeAttachment, NoticeRecipient])],
})
export class NoticesModule {}
