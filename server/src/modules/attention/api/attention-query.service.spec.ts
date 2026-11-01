import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { AttentionQueryService } from './attention-query.service';

describe('AttentionQueryService.studentAlerts teacher scope', () => {
  function make(canSee: boolean) {
    const query = vi.fn(async (sql: string) =>
      sql.includes('FROM students') ? [{ id: 's1' }] : [],
    );
    const teacherScope = { canSeeStudent: vi.fn(async () => canSee) };
    const schools = { getResolvedSettings: async () => ({ region: { locale: 'en' } }) };
    const service = new AttentionQueryService(
      { query } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      teacherScope as never,
      schools as never,
      {} as never,
    );
    return { service, teacherScope };
  }
  const teacher = { userId: 'u1', role: UserRole.TEACHER };

  it('allows a teacher who can see the student (shared current-year scope)', async () => {
    const { service, teacherScope } = make(true);
    await expect(service.studentAlerts('t1', teacher, 's1')).resolves.toEqual([]);
    expect(teacherScope.canSeeStudent).toHaveBeenCalledWith({
      userId: 'u1',
      tenantId: 't1',
      studentId: 's1',
      // [83.3.1] D4 read: coordinators of the student's class see its alerts too.
      includeCoordinated: true,
    });
  });

  // Epic 75 D13: a teacher miss reads exactly like a missing student.
  it('404 "Student not found" when the teacher cannot see the student', async () => {
    await expect(make(false).service.studentAlerts('t1', teacher, 's1')).rejects.toMatchObject({
      status: 404,
      message: 'Student not found',
    });
  });

  it('ADMIN skips the teacher scope', async () => {
    const { service, teacherScope } = make(false);
    await expect(
      service.studentAlerts('t1', { userId: 'u1', role: UserRole.ADMIN }, 's1'),
    ).resolves.toEqual([]);
    expect(teacherScope.canSeeStudent).not.toHaveBeenCalled();
  });
});
