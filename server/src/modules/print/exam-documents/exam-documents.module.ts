import { Module } from '@nestjs/common';
import { FeeModule } from '../../fees/fees.module';
import { SchoolsModule } from '../../schools/schools.module';
import { StudentModule } from '../../students/students.module';
import { PrintAssetsModule } from '../assets/print-assets.module';
import { PrintJobsModule } from '../jobs/print-jobs.module';
import { ExamDocumentsController, FinalDocumentsController } from './exam-documents.controller';
import { ExamDocumentsService } from './exam-documents.service';
import { FamilyAdmitCardController } from './family-admit-card.controller';
import { FamilyAdmitCardService } from './family-admit-card.service';

/** [48.2.05] Exam "Print" tab feeds + [48.2.09] portal admit-card self-print. */
@Module({
  imports: [FeeModule, SchoolsModule, StudentModule, PrintJobsModule, PrintAssetsModule],
  controllers: [ExamDocumentsController, FinalDocumentsController, FamilyAdmitCardController],
  providers: [ExamDocumentsService, FamilyAdmitCardService],
})
export class ExamDocumentsModule {}
