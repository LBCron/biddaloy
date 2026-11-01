import { Module } from '@nestjs/common';
import { ClassModule } from './classes.module';
import { ExamsModule } from '../exams/exams.module';
import { AttentionModule } from '../attention/attention.module';
import { SchoolsModule } from '../schools/schools.module';
import { CoordinationService } from './coordination.service';
import { CoordinationController } from './coordination.controller';

/**
 * [83.3.2] My coordination's routes. Its own module, in the classes folder: the overview needs
 * `MarkGridService` (ExamsModule) and the notify needs `ManualAlertsService` (AttentionModule),
 * and both of those modules import `ClassModule` — so `ClassModule` itself cannot import them
 * without a cycle. Nothing imports this module back.
 */
@Module({
  imports: [ClassModule, ExamsModule, AttentionModule, SchoolsModule],
  providers: [CoordinationService],
  controllers: [CoordinationController],
})
export class CoordinationModule {}
