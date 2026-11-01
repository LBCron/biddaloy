import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplateComponent } from './entities/exam-template-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Result } from './entities/result.entity';
import { ResultSubject } from './entities/result-subject.entity';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { Subject } from '../academics/entities/subject.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { GradingScale } from '../grading/entities/grading-scale.entity';
import { GradingBand } from '../grading/entities/grading-band.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { School } from '../schools/entities/school.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { ProgramMilestone } from '../programs/entities/program-milestone.entity';
import { MilestoneAchievement } from '../programs/entities/milestone-achievement.entity';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AuditModule } from '../audit/audit.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassModule } from '../classes/classes.module';
import { CreditsModule } from '../communications/credits/credits.module';
import {
  COMMUNICATIONS_QUEUE,
  COMMUNICATIONS_QUEUE_JOB_OPTIONS,
} from '../communications/communications.constants';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { ExamComponentsService } from './exam-components.service';
import { ExamComponentsController } from './exam-components.controller';
import { ExamTemplatesService } from './exam-templates.service';
import { ExamTemplatesController } from './exam-templates.controller';
import { SubjectChoicesService } from '../students/subject-choices.service';
import { SubjectChoicesController } from '../students/subject-choices.controller';
import { MarksService } from './marks.service';
import { MarkGridService } from './mark-grid.service';
import { MarksController } from './marks.controller';
import { AttendanceComponentService } from './attendance-component.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { ResultsService } from './results.service';
import { ResultsController, StudentResultsController } from './results.controller';
import { TranscriptService } from './transcript.service';
import { TranscriptController } from './transcript.controller';
import { AnalysisService } from './analysis.service';
import { AnalysisController } from './analysis.controller';
import { ResultSmsService } from './result-sms.service';
import { FamilyAccessService } from '../students/family-access.service';
import { ExamSchedulesService } from './exam-schedules.service';
import { ExamResultRecomputer } from './result-recomputer.service';
import { ExamsDashboardController } from './exams-dashboard.controller';
import { ExamsDashboardService } from './exams-dashboard.service';
import {
  ExamSchedulesController,
  StudentExamScheduleController,
} from './exam-schedules.controller';

/**
 * [19.2.1]/[19.3.1] Registers the seven exam/marks/results tables plus the
 * cross-module entities (`Student`, `ClassSection`, `ClassSubject`) the
 * 19.3.1 CRUD services need. `SubjectChoicesService`/`Controller` live
 * physically under `students/` (they read/write `StudentSubjectChoice`,
 * a student-owned row) but are wired here rather than in `StudentModule`,
 * since 19.3.1's "fourth subject" feature is exam/marks scoped work, not
 * a students-module change.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Exam,
      ExamComponent,
      ExamTemplate,
      ExamTemplateComponent,
      Mark,
      MarkGrid,
      Result,
      ResultSubject,
      ExamSchedule,
      StudentSubjectChoice,
      Student,
      Enrollment,
      ClassSection,
      ClassSubject,
      Class,
      AcademicYear,
      AcademicTerm,
      Subject,
      TeacherClassSection,
      GradingScale,
      GradingBand,
      CommunicationLog,
      School,
      ProgramEnrollment,
      ProgramMilestone,
      MilestoneAchievement,
    ]),
    AuditModule,
    DashboardModule,
    AttendanceModule,
    // `TeacherScopeService` for `MarksAuthorizationService` (47.2.3).
    // ClassModule imports no exams code, so there is no cycle.
    ClassModule,
    CreditsModule,
    // Re-registers the same queue communications.module.ts registers —
    // an accepted pattern in this codebase (health.module.ts does the
    // same) rather than importing the whole CommunicationsModule for one
    // queue handle.
    BullModule.registerQueue({
      name: COMMUNICATIONS_QUEUE,
      defaultJobOptions: COMMUNICATIONS_QUEUE_JOB_OPTIONS,
    }),
  ],
  controllers: [
    ExamsController,
    ExamComponentsController,
    ExamTemplatesController,
    SubjectChoicesController,
    MarksController,
    ResultsController,
    StudentResultsController,
    TranscriptController,
    AnalysisController,
    ExamSchedulesController,
    StudentExamScheduleController,
    ExamsDashboardController,
  ],
  providers: [
    ExamsService,
    ExamComponentsService,
    ExamTemplatesService,
    SubjectChoicesService,
    MarksService,
    MarkGridService,
    AttendanceComponentService,
    MarksAuthorizationService,
    ResultsService,
    TranscriptService,
    AnalysisService,
    ResultSmsService,
    FamilyAccessService,
    ExamSchedulesService,
    ExamResultRecomputer,
    ExamsDashboardService,
  ],
  // `ExamResultRecomputer` is bound to the grading module's `RESULT_RECOMPUTER`
  // token there (a scale edit recomputes PROCESSED exams). No import cycle:
  // this module does not import `GradingModule`.
  exports: [
    TypeOrmModule,
    AnalysisService,
    ExamTemplatesService,
    ExamResultRecomputer,
    ExamsDashboardService,
    // [83.3.2] My coordination's pending grids use `progress()` (D22).
    MarkGridService,
  ],
})
export class ExamsModule {}
