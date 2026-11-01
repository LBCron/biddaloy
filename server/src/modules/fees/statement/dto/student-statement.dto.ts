import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

export class StatementQueryDto {
  @ApiPropertyOptional({
    example: '2026-01-01',
    description: 'First day shown. Earlier entries fold into the opening balance.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Last day shown. Default: everything.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export const STATEMENT_ENTRY_KINDS = ['BILL', 'DISCOUNT', 'PAYMENT', 'REVERSAL'] as const;
export type StatementEntryKind = (typeof STATEMENT_ENTRY_KINDS)[number];

/** One line: `বিল` (charged) is `debit`, `জমা` (paid) and discounts are `credit`, and `balance` is what is still owed after it. */
export class StatementEntryDto {
  @ApiProperty({ example: '2026-05-01' }) date: string;
  @ApiProperty({ enum: STATEMENT_ENTRY_KINDS }) kind: StatementEntryKind;
  @ApiProperty() description: string;
  @ApiProperty({ description: 'Charged: a bill, or a payment taken back.' }) debit: number;
  @ApiProperty({ description: 'Paid or discounted.' }) credit: number;
  @ApiProperty({ description: 'Still owed after this line.' }) balance: number;
}

export class WalletMoveDto {
  @ApiProperty() date: string;
  @ApiProperty() kind: string;
  @ApiProperty({ description: 'Positive adds to the wallet, negative takes from it.' })
  amount: number;
  @ApiProperty({ nullable: true, type: String }) note: string | null;
}

export class StudentStatementDto {
  @ApiProperty({ format: 'uuid' }) student_id: string;
  @ApiProperty() student_name: string;
  @ApiProperty() registration_number: string;
  @ApiProperty({ nullable: true, type: String }) from: string | null;
  @ApiProperty({ nullable: true, type: String }) to: string | null;
  @ApiProperty({ description: 'Still owed before the first line shown.' }) opening_balance: number;
  @ApiProperty({
    description:
      'Still owed after the last line shown; equals the total on the student fees tab when `to` is not set.',
  })
  closing_balance: number;
  @ApiProperty({ type: [StatementEntryDto] }) entries: StatementEntryDto[];
  @ApiProperty({
    description: 'The advance money held for the student. It does not change what is owed.',
  })
  wallet_balance: number;
  @ApiProperty({ type: [WalletMoveDto] }) wallet_moves: WalletMoveDto[];
}
