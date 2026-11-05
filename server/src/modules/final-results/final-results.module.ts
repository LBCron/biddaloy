import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinalResult } from './entities/final-result.entity';
import { FinalResultWeight } from './entities/final-result-weight.entity';
import { FinalResultRow } from './entities/final-result-row.entity';
import { FinalResultSubject } from './entities/final-result-subject.entity';
import { FinalResultsService } from './final-results.service';
import { FinalResultsController } from './final-results.controller';
import { AuditModule } from '../audit/audit.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassModule } from '../classes/classes.module';
import { ExamsModule } from '../exams/exams.module';

/**
 * [70.1.2] Cross-exam final results: entities; [70.2.1] service + controller.
 * `ExamsModule` gives the SMS sender (`ResultSmsService.sendForFinal`), `AttendanceModule` the
 * publish-time attendance snapshot, `ClassModule` the teacher section scope. Other entities
 * (exams, results, students) are read through the shared connection's entity manager.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FinalResult, FinalResultWeight, FinalResultRow, FinalResultSubject]),
    AuditModule,
    AttendanceModule,
    ClassModule,
    ExamsModule,
  ],
  controllers: [FinalResultsController],
  providers: [FinalResultsService],
  exports: [TypeOrmModule, FinalResultsService],
})
export class FinalResultsModule {}
