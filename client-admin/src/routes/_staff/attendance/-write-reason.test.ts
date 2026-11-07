import { ApiError } from '@biddaloy/ui/api';
import { describe, expect, it } from 'vitest';

import { saveErrorKey, writeReasonKey } from './-write-reason';

const apiError = (statusCode: number, details?: unknown) =>
  Object.assign(Object.create(ApiError.prototype) as ApiError, { statusCode, details });

describe('writeReasonKey', () => {
  it('uses the known reason and falls back for anything else', () => {
    expect(writeReasonKey('DEVICE_SCHOOL')).toBe('registerBanner.DEVICE_SCHOOL');
    expect(writeReasonKey('SOMETHING_NEW')).toBe('registerBanner.UNKNOWN');
    expect(writeReasonKey(null)).toBe('registerBanner.UNKNOWN');
  });
});

describe('saveErrorKey', () => {
  it('names the reason only for a 403 that carries one', () => {
    expect(saveErrorKey(apiError(403, { reason: 'CLASS_TEACHER_ONLY' }))).toBe(
      'registerBanner.CLASS_TEACHER_ONLY',
    );
    expect(saveErrorKey(apiError(403))).toBe('mark.errorToast');
    expect(saveErrorKey(apiError(500, { reason: 'CLASS_TEACHER_ONLY' }))).toBe('mark.errorToast');
    expect(saveErrorKey(new Error('offline'))).toBe('mark.errorToast');
  });
});
