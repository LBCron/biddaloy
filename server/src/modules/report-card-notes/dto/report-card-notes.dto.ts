import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Most notes one save may carry; a section is far smaller. */
export const REPORT_CARD_NOTES_MAX = 200;
export const REMARK_MAX = 300;

/** Target of a `my-class` call: exactly one of the two (checked in the service). */
export class NotesTargetQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'exam_id must be a UUID' })
  exam_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'final_result_id must be a UUID' })
  final_result_id?: string;
}

/** Office routes name the section in the query (the target is in the path). */
export class NotesSectionQueryDto {
  @IsUUID('all', { message: 'section_id must be a UUID' })
  section_id: string;
}

/** `missing` counts: no section means the whole class. */
export class NotesOptionalSectionQueryDto {
  @IsOptional()
  @IsUUID('all', { message: 'section_id must be a UUID' })
  section_id?: string;
}

/**
 * One student's remark and conduct grades. Keys and grades are checked in the service.
 * `conduct` is the full grid for the school's current items (an item left out is cleared);
 * an omitted `remark` keeps the stored one, `null` or blank clears it.
 */
export class ReportCardNoteBodyDto {
  @IsUUID('all', { message: 'student_id must be a UUID' })
  student_id: string;

  @IsOptional()
  @IsString({ message: 'remark must be text' })
  @MaxLength(REMARK_MAX, { message: `remark can be at most ${REMARK_MAX} characters` })
  remark?: string | null;

  @IsObject({ message: 'conduct must be an object' })
  conduct: Record<string, string>;
}

export class SaveReportCardNotesBodyDto {
  @IsArray({ message: 'notes must be a list' })
  @ArrayMaxSize(REPORT_CARD_NOTES_MAX, {
    message: `notes can have at most ${REPORT_CARD_NOTES_MAX} items`,
  })
  @ValidateNested({ each: true })
  @Type(() => ReportCardNoteBodyDto)
  notes: ReportCardNoteBodyDto[];
}
