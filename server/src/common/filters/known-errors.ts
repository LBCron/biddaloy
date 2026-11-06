import {
  BadRequestException,
  ConflictException,
  GoneException,
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
    mapBodyParserError(unwrapAdapterError(exception)) ??
    mapHomeworkActiveUnique(exception) ??
    mapFinalResultUnique(exception) ??
    mapCardNoUnique(exception) ??
    mapUniqueViolation(exception) ??
    mapStudentFeeCheckViolation(exception) ??
    mapInvalidDate(exception) ??
    mapDeadlock(exception) ??
    mapMulterError(exception) ??
    mapWrappedMulterError(exception) ??
    mapImportFileError(exception)
  );
}

// [76.2.06] One card per person per school (students + staff). Fixed sentence: never names who
// holds it (Rule 23). Services pre-check where they can; the partial unique indexes are the backstop.
const CARD_NO_INDEXES = new Set(['UQ_students_tenant_card_no', 'UQ_staff_profiles_tenant_card_no']);
export const CARD_NO_TAKEN_MESSAGE = 'This card number is already in use';

export function cardNoTaken(): ConflictException {
  return new ConflictException({
    message: CARD_NO_TAKEN_MESSAGE,
    details: { code: 'CARD_NO_TAKEN' },
  });
}

function mapCardNoUnique(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, constraint } = exception.driverError as { code?: string; constraint?: string };
  return code === '23505' && CARD_NO_INDEXES.has(constraint ?? '') ? cardNoTaken() : null;
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

// [81.2.1] Marks sheet import. Fixed sentences, no id in them (Rules 23/24); the code is what
// the screen branches on.
export function marksGridSubmitted(): ConflictException {
  return new ConflictException({
    message: 'This marks list is submitted. Ask an admin to reopen it before uploading a sheet.',
    details: { code: 'GRID_SUBMITTED' },
  });
}

export function marksSheetExpired(): GoneException {
  return new GoneException({
    message: 'This upload has expired. Upload the sheet again.',
    details: { code: 'MARKS_SHEET_EXPIRED' },
  });
}

// [70.2.1] Final-result refusals. One fixed sentence each, no id or name in it (Rules 23/24);
// the code is what the screen branches on. The service throws these directly.
export function finalSourceUnpublished(): ConflictException {
  return new ConflictException({
    message: 'Every exam in a final result must be published first.',
    details: { code: 'FINAL_SOURCE_UNPUBLISHED' },
  });
}

export function finalSharesNotHundred(): ConflictException {
  return new ConflictException({
    message: 'The shares for each subject must add up to 100.',
    details: { code: 'FINAL_SHARES_NOT_HUNDRED' },
  });
}

export function finalNoExams(): ConflictException {
  return new ConflictException({
    message: 'Add at least one exam to this final result first.',
    details: { code: 'FINAL_NO_EXAMS' },
  });
}

export function finalNotDraft(): ConflictException {
  return new ConflictException({
    message: 'A published final result cannot be changed. Reopen it first.',
    details: { code: 'FINAL_NOT_DRAFT' },
  });
}

export function finalNotProcessed(): ConflictException {
  return new ConflictException({
    message: 'Build this final result before publishing it.',
    details: { code: 'FINAL_NOT_PROCESSED' },
  });
}

export function finalPublished(): ConflictException {
  return new ConflictException({
    message: 'This final result is published. Reopen it first.',
    details: { code: 'FINAL_PUBLISHED' },
  });
}

export function finalStale(): ConflictException {
  return new ConflictException({
    message: 'An exam in this final result changed after it was built. Build it again first.',
    details: { code: 'FINAL_STALE' },
  });
}

export function finalAlreadyExists(): ConflictException {
  return new ConflictException({
    message: 'This class already has a final result for this year.',
    details: { code: 'FINAL_ALREADY_EXISTS' },
  });
}

// One live final result per (tenant, class, year): `create` checks first, and the partial unique
// index on `final_results` (its only unique index) is the race backstop for two creates at once.
function mapFinalResultUnique(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code, table } = exception.driverError as { code?: string; table?: string };
  if (code !== '23505' || table !== 'final_results') return null;
  return finalAlreadyExists();
}

export function finalNotPublished(): ConflictException {
  return new ConflictException({
    message: 'This final result is not published.',
    details: { code: 'FINAL_NOT_PUBLISHED' },
  });
}

/** [70.3.1] D28: notes are frozen while the exam or final result is published; reopen unlocks. */
export function reportCardNotesLocked(): ConflictException {
  return new ConflictException({
    message: 'This result is published, so its remarks and conduct are locked. Reopen it first.',
    details: { code: 'REPORT_CARD_NOTES_LOCKED' },
  });
}

/** [70.3.4] Reopening an exam that a PUBLISHED final counts: say where to go first. */
export function examInPublishedFinal(): ConflictException {
  return new ConflictException({
    message:
      'A published final result counts this exam. Reopen that final result first, on the Final results page.',
    details: { code: 'EXAM_IN_PUBLISHED_FINAL' },
  });
}

// [70.3.4] 40P01 deadlock_detected: Postgres rolled the whole transaction back, so nothing was
// written and the same request can simply be sent again. Two lock orders meet rarely (a late
// final in `ResultsService.reopen` vs that final's own publish); a 409 the user retries beats a 500.
export function concurrentUpdate(): ConflictException {
  return new ConflictException({
    message: 'Someone else changed this at the same moment. Nothing was saved. Try again.',
    details: { code: 'CONCURRENT_UPDATE' },
  });
}

function mapDeadlock(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code } = exception.driverError as { code?: string };
  return code === '40P01' ? concurrentUpdate() : null;
}

function mapInvalidDate(exception: unknown): HttpException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const { code } = exception.driverError as { code?: string };
  return INVALID_DATE_CODES.has(code ?? '') ? new BadRequestException('Invalid date') : null;
}

// @nestjs/platform-express 12.3 turns an http-errors instance (body-parser's 413/415) into an
// HttpException and keeps the original as `cause`; map from the original, as before.
function unwrapAdapterError(exception: unknown): unknown {
  return exception instanceof HttpException && exception.cause instanceof Error
    ? exception.cause
    : exception;
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

// Nest 12.3 rewrites a MulterError into a plain BadRequestException before any filter runs
// ("Unexpected file field - <the client's field name>"), so the code is gone and the message is
// all that is left. These are multer's own fixed sentences; the client's field name follows " - ".
const WRAPPED_MULTER_MESSAGE =
  /^(Unexpected (file )?field|Too many (parts|files|fields)|Field (name (too long|missing|nesting too deep|array index too large)|value too long)|Invalid field name)( - |$)/;

function mapWrappedMulterError(exception: unknown): HttpException | null {
  if (!(exception instanceof BadRequestException)) return null;
  return WRAPPED_MULTER_MESSAGE.test(exception.message)
    ? new BadRequestException('Unexpected upload field')
    : null;
}
