import { describe, expect, it } from 'vitest';

import { NOTICE_LIMITS } from './notices';

describe('NOTICE_LIMITS (D6/D16/D21)', () => {
  it('holds the decided values', () => {
    expect(NOTICE_LIMITS).toMatchObject({
      titleMax: 140,
      bodyMax: 5000,
      filesMax: 3,
      fileBytesMax: 5 * 1024 * 1024,
      recipientsMax: 5000,
    });
  });
  it('allows exactly four mime types', () => {
    expect([...NOTICE_LIMITS.mimeTypes].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });
});
