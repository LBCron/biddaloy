import { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import {
  AggregateFn,
  FieldSensitivity,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import type { TeacherScopeService } from '../../../classes/teacher-scope.service';
import { ReportCompiler } from '../compiler/report-compiler';
import { TEST_FEES_AREA, TEST_STUDENTS_AREA } from '../compiler/test-areas';
import { ReportRegistry } from '../registry/registry';
import {
  ReportAccessDeniedError,
  RoleScopePolicy,
  type ReportRunContext,
} from './role-scope.policy';
import { roleMaySee } from './sensitivity-permissions';

const TENANT = '33333333-3333-4333-8333-333333333333';
const ctxFor = (role: UserRole): ReportRunContext => ({ tenantId: TENANT, userId: 'u1', role });

/** A policy whose teacher-scope answer we choose: `null` = tenant-wide, a list = assigned sections. */
function policyWith(sections: string[] | null) {
  const sectionScope = vi.fn().mockResolvedValue(sections);
  return {
    policy: new RoleScopePolicy({ sectionScope } as unknown as TeacherScopeService),
    sectionScope,
  };
}

describe('RoleScopePolicy', () => {
  describe('rows', () => {
    it('a TEACHER is limited to the sections they teach', async () => {
      const { policy } = policyWith(['sec-1', 'sec-2']);
      const clauses = await policy.scopeFor(ctxFor(UserRole.TEACHER), TEST_STUDENTS_AREA);
      expect(clauses).toEqual([
        {
          sql: 's.class_section_id IN (:...scopeSections)',
          params: { scopeSections: ['sec-1', 'sec-2'] },
          aliases: ['s'],
        },
      ]);
    });

    it('asks the same teacher-scope service the screens use, for this school and user', async () => {
      const { policy, sectionScope } = policyWith(['sec-1']);
      await policy.scopeFor(ctxFor(UserRole.TEACHER), TEST_STUDENTS_AREA);
      expect(sectionScope).toHaveBeenCalledWith({
        role: UserRole.TEACHER,
        userId: 'u1',
        tenantId: TENANT,
      });
    });

    it('a TEACHER with no assigned section sees nothing', async () => {
      const { policy } = policyWith([]);
      const clauses = await policy.scopeFor(ctxFor(UserRole.TEACHER), TEST_STUDENTS_AREA);
      expect(clauses).toEqual([{ sql: '1 = 0', params: {} }]);
    });

    it('an area with no section (staff) is closed to a TEACHER', async () => {
      const { policy } = policyWith(['sec-1']);
      await expect(
        policy.scopeFor(ctxFor(UserRole.TEACHER), TEST_FEES_AREA),
      ).rejects.toBeInstanceOf(ReportAccessDeniedError);
    });

    it.each([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.COMMITTEE])(
      '%s is not narrowed to sections',
      async (role) => {
        const { policy } = policyWith(null);
        expect(await policy.scopeFor(ctxFor(role), TEST_STUDENTS_AREA)).toEqual([]);
      },
    );

    it.each([UserRole.PARENT, UserRole.STUDENT])(
      '%s cannot run defined reports (D13)',
      async (role) => {
        const { policy, sectionScope } = policyWith(null);
        await expect(policy.scopeFor(ctxFor(role), TEST_STUDENTS_AREA)).rejects.toBeInstanceOf(
          ReportAccessDeniedError,
        );
        expect(sectionScope).not.toHaveBeenCalled();
      },
    );
  });

  describe('fields', () => {
    const field = (sensitivity: FieldSensitivity, key = 'x') => ({ key, sensitivity });

    it('PUBLIC fields are open to every role that can run reports', () => {
      const { policy } = policyWith(null);
      for (const role of [UserRole.ADMIN, UserRole.TEACHER, UserRole.COMMITTEE]) {
        expect(policy.fieldAllowed(ctxFor(role), field(FieldSensitivity.PUBLIC))).toBe(true);
      }
    });

    it('financial fields need a payment permission: ACCOUNTANT yes, TEACHER no', () => {
      expect(roleMaySee(UserRole.ACCOUNTANT, FieldSensitivity.FINANCIAL)).toBe(true);
      expect(roleMaySee(UserRole.TEACHER, FieldSensitivity.FINANCIAL)).toBe(false);
    });

    it('SENSITIVE fields (religion, health) are ADMIN only', () => {
      expect(roleMaySee(UserRole.ADMIN, FieldSensitivity.SENSITIVE)).toBe(true);
      for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER]) {
        expect(roleMaySee(role, FieldSensitivity.SENSITIVE)).toBe(false);
      }
    });

    it('COMMITTEE asking for a student name is masked, gender and religion are not', () => {
      const { policy } = policyWith(null);
      const committee = ctxFor(UserRole.COMMITTEE);
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.PERSONAL, 'name'))).toBe(false);
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.CONTACT, 'phone'))).toBe(false);
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.FINANCIAL, 'amount'))).toBe(
        false,
      );
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.PUBLIC, 'gender'))).toBe(true);
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.SENSITIVE, 'religion'))).toBe(
        true,
      );
      expect(policy.fieldAllowed(committee, field(FieldSensitivity.SENSITIVE, 'health'))).toBe(
        false,
      );
    });
  });

  describe('applied for the runner, not the author', () => {
    const adminAuthored: ReportDefinitionJson = {
      schema: 1,
      subjectArea: ReportSubjectArea.STUDENTS,
      parameters: [],
      dataset: {
        // The author (an admin) asked for the student name, the guardian's phone and a head count.
        dimensions: [{ field: 'name' }, { field: 'guardian_phone' }, { field: 'class' }],
        measures: [],
        filters: [],
        sort: [],
      },
      layout: { type: ReportLayoutType.TABLE },
      page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
      drill: [],
      calculated: [],
      format: [],
    };

    function compilerFor(sections: string[] | null) {
      const { policy } = policyWith(sections);
      const registry = new ReportRegistry([TEST_STUDENTS_AREA]);
      return new ReportCompiler(new DataSource({ type: 'postgres' }), registry, policy);
    }

    it("a teacher running an admin's report gets only their own sections", async () => {
      const compiled = await compilerFor(['sec-1']).compile(
        adminAuthored,
        {},
        ctxFor(UserRole.TEACHER),
        500,
      );
      const [sql, params] = compiled.query.getQueryAndParameters();
      expect(sql).toContain('s.class_section_id IN ($');
      expect(params).toContain('sec-1');
      // A teacher can open the guardians of their own sections on screen, so the phone stays.
      expect(compiled.masked).toEqual([]);
    });

    it("an EXECUTIVE (no GUARDIAN_READ) running an admin's report loses the guardian phone", async () => {
      const compiled = await compilerFor(null).compile(
        adminAuthored,
        {},
        ctxFor(UserRole.EXECUTIVE),
        500,
      );
      const [sql] = compiled.query.getQueryAndParameters();
      expect(compiled.masked).toEqual(['guardian_phone']);
      expect(sql).not.toContain('g.phone');
    });

    it('the same report run by an admin shows everything and is not narrowed', async () => {
      const compiled = await compilerFor(null).compile(
        adminAuthored,
        {},
        ctxFor(UserRole.ADMIN),
        500,
      );
      const [sql] = compiled.query.getQueryAndParameters();
      expect(compiled.masked).toEqual([]);
      expect(sql).not.toContain('class_section_id IN');
      expect(sql).toContain('g.phone');
    });

    it('COMMITTEE gets no person-level column: the student name is dropped', async () => {
      const counts: ReportDefinitionJson = {
        ...adminAuthored,
        dataset: {
          dimensions: [{ field: 'name' }, { field: 'gender' }, { field: 'class' }],
          measures: [{ field: 'students', fn: AggregateFn.COUNT }],
          filters: [],
          sort: [],
        },
      };
      // `name` is not groupable-checked here because it is masked before SQL is built.
      const compiled = await compilerFor(null).compile(counts, {}, ctxFor(UserRole.COMMITTEE), 500);
      expect(compiled.columns.map((c) => c.key)).toEqual(['gender', 'class', 'students']);
      expect(compiled.masked).toEqual(['name']);
    });

    it('a guardian is refused before any SQL is built', async () => {
      await expect(
        compilerFor(null).compile(adminAuthored, {}, ctxFor(UserRole.PARENT), 500),
      ).rejects.toBeInstanceOf(ReportAccessDeniedError);
    });
  });
});
