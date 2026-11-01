import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AttentionModule } from '../attention/attention.module';
import { AudienceModule } from '../audience/audience.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { PushModule } from '../push/push.module';
import { SchoolsModule } from '../schools/schools.module';
import { Student } from '../students/entities/student.entity';
import { StorageModule } from '../storage/storage.module';
import { Notice } from './entities/notice.entity';
import { NoticeAttachment } from './entities/notice-attachment.entity';
import { NoticeRecipient } from './entities/notice-recipient.entity';
import { NoticeLinksModule } from './links/notice-links.module';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { NoticeRecipientsService } from './notice-recipients.service';

/** [53.2.04] Notice authoring: drafts, Chosen list, publish, edit, withdraw, copy, report. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notice,
      NoticeAttachment,
      NoticeRecipient,
      TeacherClassSection,
      Student,
    ]),
    AuthModule,
    AudienceModule,
    NoticeLinksModule,
    AttentionModule,
    PushModule,
    AuditModule,
    SchoolsModule,
    StorageModule,
  ],
  controllers: [NoticesController],
  // Provided here, not imported: the same load-order cycle AudienceModule documents.
  providers: [NoticesService, NoticeRecipientsService, TeacherScopeService],
})
export class NoticesModule {}
