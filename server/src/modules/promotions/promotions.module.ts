import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromotionRun } from './entities/promotion-run.entity';
import { PromotionEntry } from './entities/promotion-entry.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Result } from '../exams/entities/result.entity';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { FinalResultRow } from '../final-results/entities/final-result-row.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { User } from '../users/entities/user.entity';
import { EnrollmentModule } from '../enrollments/enrollments.module';
import { AuditModule } from '../audit/audit.module';
import { StudentModule } from '../students/students.module';
import { PromotionsService } from './promotions.service';
import { PromotionsController } from './promotions.controller';

/**
 * [788] Promotion-run workflow: draft creation, override editing, refresh,
 * and the money-tier commit that moves students into next-year enrollments
 * atomically (D9/D11/D18/D19/D26).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PromotionRun,
      PromotionEntry,
      Class,
      ClassSection,
      AcademicYear,
      Exam,
      Result,
      FinalResult,
      FinalResultRow,
      Student,
      Enrollment,
      User,
    ]),
    EnrollmentModule,
    AuditModule,
    StudentModule,
  ],
  providers: [PromotionsService],
  controllers: [PromotionsController],
})
export class PromotionsModule {}
