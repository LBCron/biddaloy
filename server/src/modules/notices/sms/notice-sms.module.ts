import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AttentionModule } from '../../attention/attention.module';
import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../../auth/auth.module';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../../communications/communications.constants';
import { CreditsModule } from '../../communications/credits/credits.module';
import { SchoolsModule } from '../../schools/schools.module';
import { Notice } from '../entities/notice.entity';
import { NoticeRecipient } from '../entities/notice-recipient.entity';
import { NoticeLinksModule } from '../links/notice-links.module';
import { NoticeSmsController } from './notice-sms.controller';
import { NoticeSmsService } from './notice-sms.service';

/** [53.5.01] Notice SMS approval: the only place a notice SMS is queued (D24). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Notice, NoticeRecipient]),
    AuthModule,
    AttentionModule,
    AuditModule,
    CreditsModule,
    NoticeLinksModule,
    SchoolsModule,
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [NoticeSmsController],
  providers: [NoticeSmsService],
})
export class NoticeSmsModule {}
