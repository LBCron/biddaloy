import {
  BadRequestException,
  ConflictException,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ImportFileError } from '../errors/import-file.error';

/**
 * Maps errors that are not HttpExceptions but are the client's fault to a
 * proper 4xx. Every message is a fixed string: never copy the caught error's
 * message in (Rule 23 — e.g. the body-parser charset error echoes the value).
 * The filter still logs the ORIGINAL exception.
 */
export function mapKnownError(exception: unknown): HttpException | null {
  return (
    mapBodyParserError(exception) ??
    mapHomeworkActiveUnique(exception) ??
    mapUniqueViolation(exception) ??
    mapStudentFeeCheckViolation(exception) ??
    mapInvalidDate(exception) ??
    mapMulterError(exception) ??
    mapImportFileError(exception)
  );
}

// Keyed on the table, never the index name (brittle) and never `detail`
// (it contains the submitted value — Rule 23).
const DUPLICATE_MESSAGE_BY_TABLE: Record<string, string> = {
  classes: 'A class with this name already exists in this year',
  class_sections: 'A section with this name already exists in this class',
  academic_years: 'An academic year with this name already exists',
  // [83.2.2] Same sentence as CoordinatorsService's own 409 (the service maps it first).
  coordinator_assignments: 'This coordinator assignment already exists.',
};

// [#3172] One ACTIVE homework assignment per (homework, target). The service checks first and
// throws this same 409; the two partial unique indexes are the race backstop. The code is what
// the homework screen branches on.
const HOMEWORK_ACTIVE_INDEXES = new Set([
  'IDX_homework_assignments_active_section',
  'IDX_homework_assignments_active_student',
]);

export function homeworkTargetTaken(): ConflictException {
  return new ConflictException({
    message: 'This homework is already assigned to that target',
    details: { code: 'HOMEWORK_TARGET_TAKEN' },
  });
}

function mapHomeworkActiveUnique(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, constraint } = exception.driverError as { code?: string; constraint?: string };
  if (code !== '23505' || !HOMEWORK_ACTIVE_INDEXES.has(constraint ?? '')) return null;
  return homeworkTargetTaken();
}

// `academic_years` has a second unique index, (is_current, tenant_id): a set-current
// race there is not a name clash, so the name text is only for the name index.
const ACADEMIC_YEAR_NAME_INDEX = 'IDX_ay_name_tenant';
const GENERIC_DUPLICATE = 'A record with these details already exists';

function mapUniqueViolation(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, table, constraint } = exception.driverError as {
    code?: string;
    table?: string;
    constraint?: string;
  };
  if (code !== '23505') return null;
  if (table === 'academic_years' && constraint !== ACADEMIC_YEAR_NAME_INDEX) {
    return new ConflictException(GENERIC_DUPLICATE);
  }
  return new ConflictException(DUPLICATE_MESSAGE_BY_TABLE[table ?? ''] ?? GENERIC_DUPLICATE);
}

// The money CHECKs on `student_fees` (migration 1791900000300). Services check the balance
// first; this is the backstop so a path that missed it is a 409, not a 500. Fixed text.
const STUDENT_FEE_MONEY_CHECKS = new Set(['CHK_sf_paid_plus_discount', 'CHK_sf_waived_settled']);

function mapStudentFeeCheckViolation(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, constraint } = exception.driverError as { code?: string; constraint?: string };
  if (code !== '23514' || !STUDENT_FEE_MONEY_CHECKS.has(constraint ?? '')) return null;
  return new ConflictException({
    message: 'This would take more than the fee total',
    details: { code: 'STUDENT_FEE_OVER_TOTAL' },
  });
}

// 22007 invalid_datetime_format, 22008 datetime_field_overflow: an impossible date
// (2026-02-30) that a shape-only DTO check let through to Postgres. The message
// would echo the value, so the text is fixed. `@IsRealDate` still gives a per-field one.
const INVALID_DATE_CODES = new Set(['22007', '22008']);

// Parser-written fixed sentences (no input in them, see ImportFileError); the code is
// what clients branch on (#3020).
function mapImportFileError(exception: unknown): HttpException | null {
  if (!(exception instanceof ImportFileError)) return null;
  return new BadRequestException({
    message: exception.message,
    details: { code: exception.code },
  });
}

function mapInvalidDate(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code } = exception.driverError as { code?: string };
  return INVALID_DATE_CODES.has(code ?? '') ? new BadRequestException('Invalid date') : null;
}

// The `type` values body-parser / raw-body set. Any other Error carrying a 4xx
// `status` (an SDK, other middleware) is not a request-body problem and stays a 500.
const BODY_PARSER_TYPES = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'parameters.too.many',
  'entity.verify.failed',
  'request.aborted',
  'request.size.invalid',
  'charset.unsupported',
  'encoding.unsupported',
]);

function mapBodyParserError(exception: unknown): HttpException | null {
  // HttpException also carries a numeric `status`; it already has its own body.
  if (!(exception instanceof Error) || exception instanceof HttpException) return null;
  const { status, type, code } = exception as Error & {
    status?: unknown;
    type?: unknown;
    code?: unknown;
  };
  if (typeof status !== 'number' || status < 400 || status > 499) return null;
  // A bad gzip/deflate body: body-parser rethrows the zlib error (code Z_*) with no `type`.
  const isZlib = typeof code === 'string' && code.startsWith('Z_');
  if (!isZlib && !(typeof type === 'string' && BODY_PARSER_TYPES.has(type))) return null;
  if (type === 'entity.too.large' || type === 'parameters.too.many') {
    return new PayloadTooLargeException('Request body too large');
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new HttpException('Unsupported content type or encoding', 415);
  }
  if (status === 400) return new BadRequestException('Invalid request body');
  // Keep the library's own 4xx (entity.verify.failed is 403); never echo its message.
  return new HttpException('Request could not be processed', status);
}

// Decided by `code`, never by message: multer 2.4 reworded "Unexpected field",
// which silently broke Nest's own message-based mapping. The message is fixed
// so the client's field name is not echoed (Rule 23).
function mapMulterError(exception: unknown): HttpException | null {
  if (!(exception instanceof Error) || exception.name !== 'MulterError') return null;
  return (exception as Error & { code?: string }).code === 'LIMIT_FILE_SIZE'
    ? new PayloadTooLargeException('File too large')
    : new BadRequestException('Unexpected upload field');
}
