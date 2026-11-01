import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportCardNote } from './entities/report-card-note.entity';

/**
 * [70.1.2] Report-card remarks and conduct grades. Entity only for now; the
 * service and controller arrive in later Epic 70 tickets.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReportCardNote])],
  exports: [TypeOrmModule],
})
export class ReportCardNotesModule {}
