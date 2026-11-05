import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportCardNote } from './entities/report-card-note.entity';
import { ReportCardNotesService } from './report-card-notes.service';
import { ReportCardNotesController } from './report-card-notes.controller';
import { AuditModule } from '../audit/audit.module';
import { ClassModule } from '../classes/classes.module';
import { SchoolsModule } from '../schools/schools.module';

/**
 * [70.1.2] Report-card remarks and conduct grades; [70.3.1] service + controller.
 * `ClassModule` gives the teacher section scope, `SchoolsModule` the tenant's conduct items.
 * Exams, final results and enrollments are read through the shared entity manager.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReportCardNote]), AuditModule, ClassModule, SchoolsModule],
  controllers: [ReportCardNotesController],
  providers: [ReportCardNotesService],
  exports: [TypeOrmModule, ReportCardNotesService],
})
export class ReportCardNotesModule {}
