import { EnrollmentStatus } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';
import type { DemoStudent } from './students';
import { noticePool } from './notices';

const student = (id: string, status: EnrollmentStatus, over: Partial<DemoStudent> = {}) =>
  ({ id, tenantId: 'T', status, guardianIds: ['g'], ...over }) as DemoStudent;

describe('noticePool', () => {
  it('keeps only ACTIVE students: the recipient insert silently drops the others', () => {
    const pool = noticePool(
      [
        student('active', EnrollmentStatus.ACTIVE),
        student('graduated', EnrollmentStatus.GRADUATED),
        student('transferred', EnrollmentStatus.TRANSFERRED),
      ],
      'T',
      () => false,
    );
    expect(pool.map((s) => s.id)).toEqual(['active']);
  });

  it('leaves out other branches, skipped students and students with no guardian', () => {
    const pool = noticePool(
      [
        student('keep', EnrollmentStatus.ACTIVE),
        student('other-branch', EnrollmentStatus.ACTIVE, { tenantId: 'X' }),
        student('card-family', EnrollmentStatus.ACTIVE),
        student('no-guardian', EnrollmentStatus.ACTIVE, { guardianIds: [] }),
      ],
      'T',
      (s) => s.id === 'card-family',
    );
    expect(pool.map((s) => s.id)).toEqual(['keep']);
  });
});
