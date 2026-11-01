import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinalResult } from './entities/final-result.entity';
import { FinalResultWeight } from './entities/final-result-weight.entity';
import { FinalResultRow } from './entities/final-result-row.entity';
import { FinalResultSubject } from './entities/final-result-subject.entity';

/**
 * [70.1.2] Cross-exam final results. Entities only for now; the service and
 * controller arrive in later Epic 70 tickets.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([FinalResult, FinalResultWeight, FinalResultRow, FinalResultSubject]),
  ],
  exports: [TypeOrmModule],
})
export class FinalResultsModule {}
