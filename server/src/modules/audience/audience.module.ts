import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { SchoolsModule } from '../schools/schools.module';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceController } from './audience.controller';
import { AudienceService } from './audience.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TeacherClassSection, Student]),
    AttendanceModule,
    SchoolsModule,
  ],
  // Provided here, not via ClassModule: same load-order cycle StudentModule documents.
  providers: [AudienceService, TeacherScopeService],
  controllers: [AudienceController],
  exports: [AudienceService],
})
export class AudienceModule {}
