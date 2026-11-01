import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PlatformAlert } from './platform-alerts/platform-alert.entity';
import { PlatformAlertsController } from './platform-alerts/platform-alerts.controller';
import { PlatformAlertsService } from './platform-alerts/platform-alerts.service';
import { CommunicationsModule } from '../communications/communications.module';

@Module({
  // ponytail: importing the whole CommunicationsModule pulls its providers/queue wiring into health; ceiling = alerts only need the resolver + registry, extract a slim module if this grows.
  // CommunicationsModule gives the alert path its provider + config resolver (never its queue:
  // alerts must keep working while Redis is down). The readiness probe registers its own
  // queue; each registration is its own Queue instance; pass the shared
  // options so a job added here behaves like every other producer's.
  imports: [
    TypeOrmModule.forFeature([PlatformAlert]),
    CommunicationsModule,
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [HealthController, PlatformAlertsController],
  providers: [HealthService, PlatformAlertsService],
})
export class HealthModule {}
