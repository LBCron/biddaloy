import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { School } from '../../schools/entities/school.entity';
import { SchoolsModule } from '../../schools/schools.module';
import { StorageModule } from '../../storage/storage.module';
import { Notice } from '../entities/notice.entity';
import { NoticeAttachment } from '../entities/notice-attachment.entity';
import { NoticeRecipient } from '../entities/notice-recipient.entity';
import { NoticeLinksService } from './notice-links.service';
import { PublicNoticeController } from './public-notice.controller';

/** [53.2.02] Public and personal notice links. 53.2.05 imports this module. */
@Module({
  imports: [
    TypeOrmModule.forFeature([School, Notice, NoticeRecipient, NoticeAttachment]),
    SchoolsModule,
    StorageModule,
  ],
  providers: [NoticeLinksService],
  controllers: [PublicNoticeController],
  exports: [NoticeLinksService],
})
export class NoticeLinksModule {}
