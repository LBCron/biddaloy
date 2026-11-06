import { IsNotEmpty, IsUUID } from 'class-validator';
import { MarkStatus, MarksSheetRowErrorCode } from '@biddaloy/shared';

export class CommitMarksSheetDto {
  @IsNotEmpty()
  @IsUUID()
  staging_id: string;

  @IsNotEmpty()
  @IsUUID()
  section_id: string;

  @IsNotEmpty()
  @IsUUID()
  subject_id: string;
}

export class MarksSheetSummaryDto {
  rows: number;
  new: number;
  changed: number;
  unchanged: number;
  absent: number;
  exempt: number;
  errors: number;
}

export class MarksSheetChangeDto {
  row: number;
  student_id: string;
  roll: number;
  student_name: string;
  component_id: string;
  component_name: string;
  old: string | null;
  old_status: MarkStatus | null;
  new: string | null;
  new_status: MarkStatus;
}

export class MarksSheetErrorDto {
  row: number;
  /** From the grid (server data); null when the sheet's key matched no student. */
  roll: number | null;
  /** The DB component name; null when the header text came from the file. */
  component_name: string | null;
  code: MarksSheetRowErrorCode;
}

export class MarksSheetValidateResultDto {
  staging_id: string | null;
  expires_at: string | null;
  summary: MarksSheetSummaryDto;
  changes: MarksSheetChangeDto[];
  errors: MarksSheetErrorDto[];
}

export class MarksSheetCommitResultDto {
  saved: number;
}
