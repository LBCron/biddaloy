import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { SchoolsModule } from '../../schools/schools.module';
import { CalendarModule } from '../../calendar/calendar.module';
import { AttendanceModule } from '../attendance.module';
import { AttendanceImport } from '../entities/attendance-import.entity';
import { AttendanceImportController } from './attendance-import.controller';
import { AttendanceImportService } from './attendance-import.service';

/** Epic 76 D7/D11. Registered in app.module.ts only: attendance.module.ts is another ticket's. */
@Module({
  imports: [
    // AttendanceModule re-exports TypeOrmModule (session / record repos) and the two services.
    AttendanceModule,
    TypeOrmModule.forFeature([AttendanceImport, AcademicYear, Class, ClassSection, Student]),
    SchoolsModule,
    CalendarModule,
  ],
  controllers: [AttendanceImportController],
  providers: [AttendanceImportService],
})
export class AttendanceImportModule {}
