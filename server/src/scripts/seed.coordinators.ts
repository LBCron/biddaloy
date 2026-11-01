import type { DataSource } from 'typeorm';
import { ASSISTANT_TEACHER_EMAIL, DEMO_ACADEMIC_YEAR, DEMO_CLASSES } from './seed.util';

// Like seed.arrival.ts: must not import anything that reaches AppModule.

/** The e2e class teacher login: class coordinator of these classes (D31). */
const CLASS_COORDINATOR_EMAIL = 'teacher@biddaloy.test';
const COORDINATED_CLASSES = ['Class 6', 'Class 7'];
/** The e2e assistant teacher login: Mathematics subject coordinator of Class 6 (D31). */
const MATHS_COORDINATED_CLASS = 'Class 6';

/**
 * [83.3.4] D31 — one class coordinator and one subject coordinator for Playwright, on the
 * dev seed's current year (`DEMO_ACADEMIC_YEAR`), so no e2e spec needs API setup. Idempotent:
 * `ON CONFLICT DO NOTHING` on `UQ_coordinator_assignment`; a missing class, subject or teacher
 * skips that row. Returns how many rows it added.
 */
export async function ensureCoordinatorsSeed(ds: DataSource, tenantId: string): Promise<number> {
  // Coordinator rows count only on the current year (D14). If a developer made another year
  // current, rows on the demo year would never show, so seed nothing and say why.
  const [year] = await ds.query(
    `SELECT is_current FROM academic_years WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL`,
    [tenantId, DEMO_ACADEMIC_YEAR.name],
  );
  if (!year?.is_current) {
    console.warn(
      `Demo year ${DEMO_ACADEMIC_YEAR.name} is not the current academic year — skipping coordinator seed.`,
    );
    return 0;
  }
  const teacherOf = async (email: string): Promise<string | undefined> =>
    (
      await ds.query(
        `SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id
          WHERE u.email = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL LIMIT 1`,
        [email, tenantId],
      )
    )[0]?.id;
  // The seeded class itself: name AND shift AND version, like the seed's own unique key, so a
  // developer's other "Class 6" (another shift or version) in the same year is never picked.
  const classesNamed = async (names: string[]): Promise<string[]> => {
    const ids: string[] = [];
    for (const seed of DEMO_CLASSES.filter((c) => names.includes(c.name))) {
      const [row] = await ds.query(
        `SELECT c.id FROM classes c
           JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.tenant_id = $1
          WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND ay.name = $2
            AND c.name = $3 AND c.shift IS NOT DISTINCT FROM $4 AND c.version IS NOT DISTINCT FROM $5
          LIMIT 1`,
        [tenantId, DEMO_ACADEMIC_YEAR.name, seed.name, seed.shift, seed.version],
      );
      if (row && !ids.includes(row.id)) ids.push(row.id);
    }
    return ids;
  };
  const [maths] = await ds.query(
    `SELECT id FROM subjects WHERE tenant_id = $1 AND code = 'MATH' AND deleted_at IS NULL`,
    [tenantId],
  );

  const rows: [string, string, string | null][] = [];
  const classTeacher = await teacherOf(CLASS_COORDINATOR_EMAIL);
  if (classTeacher) {
    for (const classId of await classesNamed(COORDINATED_CLASSES)) {
      rows.push([classTeacher, classId, null]);
    }
  }
  const assistant = await teacherOf(ASSISTANT_TEACHER_EMAIL);
  if (assistant && maths) {
    for (const classId of await classesNamed([MATHS_COORDINATED_CLASS])) {
      rows.push([assistant, classId, maths.id]);
    }
  }

  let added = 0;
  for (const [teacherId, classId, subjectId] of rows) {
    const inserted: unknown[] = await ds.query(
      `INSERT INTO coordinator_assignments (tenant_id, teacher_id, class_id, subject_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId, teacherId, classId, subjectId],
    );
    added += inserted.length;
  }
  return added;
}
