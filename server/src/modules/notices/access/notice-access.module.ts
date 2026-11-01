import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { AttentionModule } from '../../attention/attention.module';
import { SchoolsModule } from '../../schools/schools.module';
import { StorageModule } from '../../storage/storage.module';
import { Notice } from '../entities/notice.entity';
import { NoticeAttachment } from '../entities/notice-attachment.entity';
import { NoticeRecipient } from '../entities/notice-recipient.entity';
import { NoticeReaderController } from './notice-reader.controller';
import { NoticeReaderService } from './notice-reader.service';
import { NoticeFilesController } from './notice-files.controller';
import { NoticeFilesService } from './notice-files.service';

/** [53.2.02] Reader + files of the notice board. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notice, NoticeAttachment, NoticeRecipient]),
    AuthModule,
    AttentionModule,
    StorageModule,
    SchoolsModule,
  ],
  controllers: [NoticeReaderController, NoticeFilesController],
  providers: [NoticeReaderService, NoticeFilesService],
})
export class NoticeAccessModule {}
