import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { Student } from '../students/entities/student.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AudienceController } from './audience.controller';
import { AudienceService } from './audience.service';

@Module({
  imports: [TypeOrmModule.forFeature([TeacherClassSection, Student])],
  // Provided here, not via ClassModule: same load-order cycle StudentModule documents.
  providers: [AudienceService, TeacherScopeService],
  controllers: [AudienceController],
  exports: [AudienceService],
})
export class AudienceModule {}
