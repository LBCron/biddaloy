import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MarksAuthorizationService } from './marks-authorization.util';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { TeacherAssignmentType, UserRole } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';

type Roles = Awaited<ReturnType<TeacherScopeService['rolesInSection']>>;

/** `TeacherScopeService` is stubbed: its join (live subjects only, tenant
 * filtering) is covered by `teacher-scope.service.integration.spec.ts`. Here
 * we only check the decision made from what it returns. */
function buildService(roles: Partial<Roles> = {}) {
  const rolesInSection = vi.fn(async (): Promise<Roles> => ({
    homeroom: null,
    subjectIds: [],
    inYearWindow: true,
    coordinated: { allSubjects: false, subjectIds: [] },
    ...roles,
  }));
  const service = new MarksAuthorizationService({
    rolesInSection,
  } as unknown as TeacherScopeService);
  return { service, rolesInSection };
}

const input = (role: UserRole, over: Partial<{ sectionId: string; subjectId: string }> = {}) => ({
  role,
  userId: 'u1',
  tenantId: TENANT_ID,
  sectionId: 's1',
  subjectId: 'subj1',
  ...over,
});

describe('MarksAuthorizationService.assertCanWrite', () => {
  it('allows ADMIN without asking TeacherScopeService', async () => {
    const { service, rolesInSection } = buildService();
    await expect(service.assertCanWrite(input(UserRole.ADMIN))).resolves.toBeUndefined();
    expect(rolesInSection).not.toHaveBeenCalled();
  });

  it('allows a TEACHER who teaches the (live) subject in the section', async () => {
    const { service, rolesInSection } = buildService({ homeroom: null, subjectIds: ['subj1'] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).resolves.toBeUndefined();
    // The tenant and section reach the scope query — it is the isolation boundary.
    expect(rolesInSection).toHaveBeenCalledWith({
      userId: 'u1',
      tenantId: TENANT_ID,
      sectionId: 's1',
    });
  });

  // Epic 75 D31: outside the year window (current year, or last year while its class has a
  // DRAFT exam) the section is closed even with a subject or homeroom row.
  it('rejects write and read outside the year window', async () => {
    const { service } = buildService({
      homeroom: TeacherAssignmentType.CLASS_TEACHER,
      subjectIds: ['subj1'],
      inYearWindow: false,
    });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(NotFoundException);
  });

  it('rejects a TEACHER with a different subject in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['other'] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  // D16: homeroom never grants write.
  it.each([
    TeacherAssignmentType.CLASS_TEACHER,
    TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
  ] as const)('rejects a %s homeroom teacher who does not teach the subject', async (homeroom) => {
    const { service } = buildService({ homeroom, subjectIds: [] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  // A soft-deleted subject never appears in `subjectIds` (the service filters
  // it), so its former teacher is denied.
  it('rejects a TEACHER whose subject was soft-deleted (absent from subjectIds)', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: [] });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects any other role', async () => {
    const { service } = buildService();
    await expect(service.assertCanWrite(input(UserRole.ACCOUNTANT))).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('MarksAuthorizationService.assertCanRead', () => {
  it('allows a TEACHER who teaches the subject', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['subj1'] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
  });

  // D3: homeroom reads every subject of its own section.
  it.each([
    TeacherAssignmentType.CLASS_TEACHER,
    TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
  ] as const)(
    "allows a %s homeroom teacher to read another teacher's subject",
    async (homeroom) => {
      const { service } = buildService({ homeroom, subjectIds: [] });
      await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
    },
  );

  it('rejects a TEACHER with no row in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: [] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(NotFoundException);
  });

  it('rejects a TEACHER with only another subject in the section', async () => {
    const { service } = buildService({ homeroom: null, subjectIds: ['other'] });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(NotFoundException);
  });
});

// [#1362] Per-role table. write = may write marks to an unmapped section-subject;
// read = may read its grid. TEACHER is section-scoped (denied when unmapped).
describe('MarksAuthorizationService per-role table', () => {
  const TABLE: Array<[UserRole, boolean, boolean]> = [
    [UserRole.ADMIN, true, true],
    [UserRole.EXECUTIVE, false, true],
    [UserRole.ACCOUNTANT, false, false],
    // SUPER_ADMIN is out of tenant data scope, reads and writes, until product
    // decides (D-N); EXAM_CONTROLLER reads only (D16); OFFICE_STAFF and COMMITTEE
    // hold no mark permission, so COMMITTEE never reaches marks (D9).
    [UserRole.SUPER_ADMIN, false, false],
    [UserRole.EXAM_CONTROLLER, false, true],
    [UserRole.OFFICE_STAFF, false, false],
    [UserRole.COMMITTEE, false, false],
    [UserRole.TEACHER, false, false],
    [UserRole.PARENT, false, false],
    [UserRole.STUDENT, false, false],
  ];
  it.each(TABLE)('%s: write=%s read=%s', async (role, write, read) => {
    const { service } = buildService();
    const w = service.assertCanWrite(input(role));
    const r = service.assertCanRead(input(role));
    // D33: the section-scoped TEACHER gets a 404 like a missing section; others keep the 403.
    const denied = role === UserRole.TEACHER ? NotFoundException : ForbiddenException;
    if (write) await expect(w).resolves.toBeUndefined();
    else await expect(w).rejects.toThrow(denied);
    if (read) await expect(r).resolves.toBeUndefined();
    else await expect(r).rejects.toThrow(denied);
  });
});

describe('MarksAuthorizationService teacher miss body (D33/D13)', () => {
  it('says exactly what a missing section says', async () => {
    const { service } = buildService();
    await expect(service.assertCanRead(input(UserRole.TEACHER))).rejects.toThrow(
      'Section not found',
    );
  });
});

describe('MarksAuthorizationService.writableSubjects (D33/D44)', () => {
  const who = (role: UserRole) => ({ role, userId: 'u1', tenantId: TENANT_ID });

  it('is null (no filter) for a role that is not section-scoped', async () => {
    const { service, rolesInSection } = buildService();
    expect(await service.writableSubjects(who(UserRole.ADMIN), ['s1'])).toBeNull();
    expect(await service.writableSubjects(who(UserRole.EXECUTIVE), ['s1'])).toBeNull();
    expect(rolesInSection).not.toHaveBeenCalled();
  });

  it('gives a TEACHER only their subject rows inside the year window; homeroom adds nothing', async () => {
    const byId: Record<string, Partial<Roles>> = {
      home: { homeroom: TeacherAssignmentType.CLASS_TEACHER },
      both: { homeroom: TeacherAssignmentType.CLASS_TEACHER, subjectIds: ['y'] },
      subj: { subjectIds: ['x'] },
      none: {},
      old: { subjectIds: ['x'], inYearWindow: false },
    };
    const service = new MarksAuthorizationService({
      rolesInSection: vi.fn(async ({ sectionId }: { sectionId: string }) => ({
        homeroom: null,
        subjectIds: [],
        inYearWindow: true,
        ...byId[sectionId],
      })),
    } as unknown as TeacherScopeService);
    const map = await service.writableSubjects(who(UserRole.TEACHER), [
      'home',
      'both',
      'subj',
      'none',
      'old',
    ]);
    expect(Object.fromEntries([...map!].map(([k, v]) => [k, [...v]]))).toEqual({
      home: [],
      both: ['y'],
      subj: ['x'],
      none: [],
      old: [],
    });
  });
});

/** [83.3.1] D4/D19: coordinator rows open reads, never writes. */
describe('MarksAuthorizationService: coordinators (83.3.1)', () => {
  it('a class coordinator reads every subject of the section', async () => {
    const { service } = buildService({ coordinated: { allSubjects: true, subjectIds: [] } });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
  });

  it('a subject coordinator reads their subject only', async () => {
    const { service } = buildService({
      coordinated: { allSubjects: false, subjectIds: ['subj1'] },
    });
    await expect(service.assertCanRead(input(UserRole.TEACHER))).resolves.toBeUndefined();
    await expect(
      service.assertCanRead(input(UserRole.TEACHER, { subjectId: 'bangla' })),
    ).rejects.toThrow();
  });

  it('no coordinator grant ever opens a write', async () => {
    const { service } = buildService({ coordinated: { allSubjects: true, subjectIds: ['subj1'] } });
    await expect(service.assertCanWrite(input(UserRole.TEACHER))).rejects.toThrow();
    const writable = await service.writableSubjects(
      { role: UserRole.TEACHER, userId: 'u1', tenantId: TENANT_ID },
      ['s1'],
    );
    expect([...(writable?.get('s1') ?? [])]).toEqual([]);
  });
});
