import { IsIn, IsUUID, ValidateIf } from 'class-validator';

export class TranscriptQueryDto {
  @IsUUID()
  academic_year_id: string;
}

export const DOCUMENT_PRINT_KINDS = ['REPORT_CARD', 'TRANSCRIPT', 'FINAL_REPORT_CARD'] as const;
export type DocumentPrintKind = (typeof DOCUMENT_PRINT_KINDS)[number];

export class DocumentPrintDto {
  @IsIn(DOCUMENT_PRINT_KINDS)
  document: DocumentPrintKind;

  @ValidateIf((o: DocumentPrintDto) => o.document === 'REPORT_CARD')
  @IsUUID()
  exam_id?: string;

  @ValidateIf(
    (o: DocumentPrintDto) => o.document === 'TRANSCRIPT' || o.document === 'FINAL_REPORT_CARD',
  )
  @IsUUID()
  academic_year_id?: string;
}
