import { describe, it, expect } from 'vitest';
import { MulterError } from 'multer';
import { QueryFailedError } from 'typeorm';
import { ImportFileErrorCode } from '@biddaloy/shared';
import { ImportFileError } from '../errors/import-file.error';
import { StaffUploadParseError } from '../../modules/users/staff-bulk-upload.parser';
import { mapKnownError } from './known-errors';

/** Builds what body-parser / http-errors throw: a plain Error with status + type. */
function httpError(message: string, status?: number, type?: string) {
  return Object.assign(new Error(message), { status, type });
}

describe('mapKnownError — body-parser errors', () => {
  it('maps entity.too.large to 413', () => {
    const mapped = mapKnownError(httpError('request entity too large', 413, 'entity.too.large'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('Request body too large');
  });

  it('maps charset.unsupported to 415 without echoing the charset', () => {
    const mapped = mapKnownError(
      httpError('unsupported charset "BOGUS"', 415, 'charset.unsupported'),
    );
    expect(mapped?.getStatus()).toBe(415);
    expect(mapped?.message).toBe('Unsupported content type or encoding');
    expect(mapped?.message).not.toMatch(/bogus/i);
  });

  it('[2634] maps parameters.too.many (urlencoded body with too many fields) to 413', () => {
    const mapped = mapKnownError(httpError('too many parameters', 413, 'parameters.too.many'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('Request body too large');
  });

  it('[2664] keeps body-parser’s own non-400 status (entity.verify.failed 403) with fixed text', () => {
    const mapped = mapKnownError(httpError('secret verify detail', 403, 'entity.verify.failed'));
    expect(mapped?.getStatus()).toBe(403);
    expect(mapped?.message).toBe('Request could not be processed');
  });

  it('maps encoding.unsupported to 415', () => {
    expect(
      mapKnownError(
        httpError('unsupported content encoding "x"', 415, 'encoding.unsupported'),
      )?.getStatus(),
    ).toBe(415);
  });

  it('maps a bad gzip error (status 400, zlib code, no type) to 400', () => {
    const mapped = mapKnownError(
      Object.assign(httpError('incorrect header check', 400), { code: 'Z_DATA_ERROR' }),
    );
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Invalid request body');
  });

  it('returns null for a 4xx Error that is not from body-parser (an SDK, other middleware)', () => {
    // It must stay a 500 so the server-side fault reaches Sentry.
    expect(mapKnownError(httpError('upstream said no', 404))).toBeNull();
    expect(mapKnownError(httpError('x', 400, 'some.other.type'))).toBeNull();
  });

  it('maps malformed JSON (entity.parse.failed) to 400', () => {
    expect(
      mapKnownError(
        httpError('Unexpected end of JSON input', 400, 'entity.parse.failed'),
      )?.getStatus(),
    ).toBe(400);
  });

  it('returns null for a plain Error, a 5xx status and non-errors', () => {
    expect(mapKnownError(new Error('boom'))).toBeNull();
    expect(mapKnownError(httpError('x', 503))).toBeNull();
    expect(mapKnownError('string')).toBeNull();
  });
});

/** A QueryFailedError shaped like the one the pg driver produces. */
function pgError(code: string, table: string, constraint?: string) {
  const driverError = Object.assign(new Error('duplicate key'), {
    code,
    table,
    constraint,
    detail: 'Key (name)=(Secret Name) already exists.',
  });
  return new QueryFailedError('INSERT ...', [], driverError);
}

describe('mapKnownError — unique violations', () => {
  it.each([
    ['classes', 'A class with this name already exists in this year'],
    ['class_sections', 'A section with this name already exists in this class'],
    ['somewhere_else', 'A record with these details already exists'],
  ])('maps 23505 on %s to a fixed 409', (table, text) => {
    const mapped = mapKnownError(pgError('23505', table));
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).toBe(text);
    expect(mapped?.message).not.toContain('Secret Name');
  });

  it('gives the academic-year name text only for the name index', () => {
    const mapped = mapKnownError(pgError('23505', 'academic_years', 'IDX_ay_name_tenant'));
    expect(mapped?.message).toBe('An academic year with this name already exists');
  });

  it('does not call a set-current race on academic_years a name clash', () => {
    // (is_current, tenant_id) is the second unique index on the table.
    const mapped = mapKnownError(pgError('23505', 'academic_years', 'IDX_ay_is_current_tenant'));
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).toBe('A record with these details already exists');
  });

  it('leaves other Postgres error codes alone', () => {
    expect(mapKnownError(pgError('23503', 'classes'))).toBeNull();
  });

  it('[#3172] maps the ACTIVE-assignment backstop indexes to the coded homework 409', () => {
    for (const index of [
      'IDX_homework_assignments_active_section',
      'IDX_homework_assignments_active_student',
    ]) {
      const mapped = mapKnownError(pgError('23505', 'homework_assignments', index));
      expect(mapped?.getStatus()).toBe(409);
      // The homework screen branches on this code, not on the text.
      expect(mapped?.getResponse()).toMatchObject({
        message: 'This homework is already assigned to that target',
        details: { code: 'HOMEWORK_TARGET_TAKEN' },
      });
    }
  });
});

/** A 23514 CHECK violation as pg reports it: the constraint name, and a detail row holding values. */
function checkViolation(constraint: string) {
  const driverError = Object.assign(new Error('violates check constraint'), {
    code: '23514',
    table: 'student_fees',
    constraint,
    detail: 'Failing row contains (777.77, ...).',
  });
  return new QueryFailedError('UPDATE ...', [], driverError);
}

describe('mapKnownError — student_fees money CHECKs (#2636)', () => {
  it('maps CHK_sf_paid_plus_discount to a fixed 409 that echoes no value', () => {
    const mapped = mapKnownError(checkViolation('CHK_sf_paid_plus_discount'));
    expect(mapped?.getStatus()).toBe(409);
    expect(mapped?.message).toBe('This would take more than the fee total');
    expect(JSON.stringify(mapped?.getResponse())).not.toContain('777.77');
  });

  it('maps CHK_sf_waived_settled to the same 409', () => {
    expect(mapKnownError(checkViolation('CHK_sf_waived_settled'))?.getStatus()).toBe(409);
  });

  it('leaves any other CHECK violation alone (stays a 500)', () => {
    expect(mapKnownError(checkViolation('CHK_sf_paid_amount'))).toBeNull();
  });
});

describe('mapKnownError — impossible dates (#2610)', () => {
  it.each(['22007', '22008'])('maps Postgres %s to a fixed 400 that echoes no value', (code) => {
    const driverError = Object.assign(
      new Error('date/time field value out of range: "2026-02-30"'),
      {
        code,
      },
    );
    const mapped = mapKnownError(new QueryFailedError('INSERT ...', [], driverError));
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Invalid date');
    expect(JSON.stringify(mapped?.getResponse())).not.toContain('2026-02-30');
  });
});

describe('mapKnownError — multer errors', () => {
  it('maps LIMIT_UNEXPECTED_FILE to 400 without echoing the field name', () => {
    const mapped = mapKnownError(new MulterError('LIMIT_UNEXPECTED_FILE', 'secretfield'));
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Unexpected upload field');
    expect(mapped?.message).not.toContain('secretfield');
  });

  it('keeps LIMIT_FILE_SIZE at 413 "File too large"', () => {
    const mapped = mapKnownError(new MulterError('LIMIT_FILE_SIZE', 'file'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('File too large');
  });

  it.each([
    'LIMIT_FILE_COUNT',
    'LIMIT_PART_COUNT',
    'LIMIT_FIELD_KEY',
    'LIMIT_FIELD_VALUE',
    'LIMIT_FIELD_COUNT',
  ] as const)('maps %s to 400', (code) => {
    expect(mapKnownError(new MulterError(code))?.getStatus()).toBe(400);
  });

  it('ignores an Error that is not a MulterError', () => {
    expect(
      mapKnownError(Object.assign(new Error('x'), { code: 'LIMIT_UNEXPECTED_FILE' })),
    ).toBeNull();
  });
});

describe('mapKnownError — import file errors (#3020)', () => {
  it('maps an ImportFileError to 400 with details.code and the fixed message', () => {
    const mapped = mapKnownError(
      new ImportFileError(ImportFileErrorCode.NO_ROWS, 'File contains no data rows'),
    );
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.getResponse()).toEqual({
      message: 'File contains no data rows',
      details: { code: 'IMPORT_FILE_NO_ROWS' },
    });
  });

  it('maps a parser subclass the same way', () => {
    const mapped = mapKnownError(
      new StaffUploadParseError(ImportFileErrorCode.UNREADABLE, 'Could not read file'),
    );
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.getResponse()).toMatchObject({ details: { code: 'IMPORT_FILE_UNREADABLE' } });
  });

  it('ignores a plain Error', () => {
    expect(mapKnownError(new Error('x'))).toBeNull();
  });
});
