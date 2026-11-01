import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { CoordinatorAssignment } from '../academics/entities/coordinator-assignment.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { AuditModule } from '../audit/audit.module';
import { SchoolsModule } from '../schools/schools.module';
import { ClassService, SectionService } from './classes.service';
import { ClassController } from './classes.controller';
import { TeacherScopeService } from './teacher-scope.service';
import { MyClassController } from './my-class.controller';
import { CoordinatorsService } from './coordinators.service';
import { CoordinatorsController } from './coordinators.controller';

@Module({
  // Teacher/TeacherClassSection/Student are registered entity-only (no
  // StudentsModule/AcademicsModule import) — same reasoning as
  // `academic-year.module.ts`'s own comment: ClassService/SectionService
  // need to count/join against them ([8.11.2]'s delete guard, enrolled
  // counts, and the read-only teachers tab) without a cross-module DI
  // cycle. `Enrollment` is not injected by either service — the delete
  // guard and the section enrolled-count both count `Student` (joined
  // through `class_section`), since `POST /students` never writes an
  // `Enrollment` row (see `classes.service.ts`'s comments).
  imports: [
    TypeOrmModule.forFeature([
      Class,
      ClassSection,
      Teacher,
      TeacherClassSection,
      // [83.2.2] Coordinator rows: CRUD here, read by TeacherScopeService (D20).
      CoordinatorAssignment,
      Subject,
      Student,
      Enrollment,
    ]),
    AuditModule,
    // Only `SchoolSettingsReader` is used ([33.2.1] vocabulary lookup) —
    // same reasoning as its other consumers (16.2.2's step-up flow).
    SchoolsModule,
  ],
  providers: [ClassService, SectionService, TeacherScopeService, CoordinatorsService],
  controllers: [ClassController, MyClassController, CoordinatorsController],
  exports: [ClassService, SectionService, TeacherScopeService, CoordinatorsService],
})
export class ClassModule {}
