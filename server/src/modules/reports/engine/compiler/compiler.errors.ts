import { UnprocessableEntityException } from '@nestjs/common';

/**
 * [8.15.15] Why a definition could not be compiled. Messages are fixed sentences:
 * no field name, value or parameter the author typed is ever echoed back (Security
 * Rule 23). `path` points at the part of the definition (`dataset.filters[2]`) so
 * the designer can mark the right control.
 */
export const COMPILE_ERROR_CODES = [
  'UNSUPPORTED_SCHEMA',
  'UNKNOWN_AREA',
  'UNKNOWN_FIELD',
  'UNKNOWN_MEASURE',
  'NOT_FILTERABLE',
  'NOT_GROUPABLE',
  'NOT_SORTABLE',
  'BAD_OP',
  'BAD_VALUE',
  'UNKNOWN_PARAM',
  'MISSING_PARAM',
  'NOTHING_TO_SHOW',
  'BAD_CALCULATION',
] as const;

export type CompileErrorCode = (typeof COMPILE_ERROR_CODES)[number];

const MESSAGES: Record<CompileErrorCode, string> = {
  UNSUPPORTED_SCHEMA: 'This report was made with a version that is not supported.',
  UNKNOWN_AREA: 'This report uses a subject that does not exist.',
  UNKNOWN_FIELD: 'This report uses a field that does not exist.',
  UNKNOWN_MEASURE: 'This report counts or adds up something that does not exist.',
  NOT_FILTERABLE: 'This report filters on a field that cannot be filtered.',
  NOT_GROUPABLE: 'This report splits by a field that cannot be split.',
  NOT_SORTABLE: 'This report sorts by a field that cannot be sorted.',
  BAD_OP: 'A filter in this report uses a condition that does not fit its field.',
  BAD_VALUE: 'A filter in this report has a value that does not fit its field.',
  UNKNOWN_PARAM: 'This report asks for an answer that it does not define.',
  MISSING_PARAM: 'Please answer every required question before running this report.',
  NOTHING_TO_SHOW: 'There is nothing to show: pick at least one field to show or add up.',
  BAD_CALCULATION: 'A calculation in this report cannot be used.',
};

export class ReportCompileError extends UnprocessableEntityException {
  constructor(
    readonly code: CompileErrorCode,
    readonly path: string,
  ) {
    super({ message: MESSAGES[code], details: { code, path } });
    this.name = 'ReportCompileError';
  }
}
