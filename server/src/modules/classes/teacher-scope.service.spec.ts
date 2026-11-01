import { describe, it, expect } from 'vitest';
import { visibleSectionIdsSql } from './teacher-scope.service';

/**
 * [83.2.1] D18 — the coordinator UNION joins the teaching rows only when a caller asks for it.
 * The integration spec proves the data; this proves no caller gets it by accident.
 */
describe('visibleSectionIdsSql (83.2.1)', () => {
  it('without the flag reads only teacher_class_sections (today’s answer)', () => {
    for (const flag of [undefined, false]) {
      const sql = visibleSectionIdsSql(flag);
      expect(sql).toContain('FROM teacher_class_sections tcs');
      expect(sql).not.toContain('coordinator_assignments');
      expect(sql).not.toContain('UNION');
    }
  });

  it('with the flag adds a UNION over coordinator_assignments, current year only', () => {
    const sql = visibleSectionIdsSql(true);
    expect(sql).toContain('FROM teacher_class_sections tcs');
    expect(sql).toContain('UNION');
    expect(sql).toContain('FROM coordinator_assignments ca');
    // Tenant filter on the coordinator table itself, and the current-year join (D3/D14).
    expect(sql).toContain('ca.tenant_id = $1');
    expect(sql).toMatch(/ay\.is_current = true/);
    // Subject coordinators count too: no class-level-only filter at the end.
    expect(sql.trimEnd().endsWith('AND ca.subject_id IS NULL')).toBe(false);
  });

  // [83.3.1] D4: results and analysis show every subject, so only class coordinators widen them.
  it("'classLevel' keeps class-coordinator rows only", () => {
    const sql = visibleSectionIdsSql('classLevel');
    expect(sql).toContain('FROM coordinator_assignments ca');
    expect(sql.trimEnd().endsWith('AND ca.subject_id IS NULL')).toBe(true);
  });
});
