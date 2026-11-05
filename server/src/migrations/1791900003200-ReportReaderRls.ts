import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#3521, Epic 8.15 D6] Row-level security behind a dedicated reporting role: a second tenant
 * wall under the one the compiler already injects. The runner switches to `report_reader` for the
 * length of each report transaction and names the school in `app.report_tenant`; under that role
 * Postgres itself returns only that school's rows, even for SQL that forgot its `tenant_id`.
 *
 * What it does NOT touch: the app's own role. The app connects as the table owner (in the
 * compose stack, the bootstrap `POSTGRES_USER`, a superuser), and owners and superusers skip RLS,
 * so no other query changes. Policies are `TO report_reader` only, never PUBLIC (PUBLIC includes
 * the report role and would cancel the wall).
 *
 * - The role is cluster-wide, not per database: created once, tolerant of two databases migrating
 *   at the same moment (`duplicate_object` / `unique_violation`). `down()` never drops it, because
 *   other databases on the cluster still hold grants to it.
 * - A table with its own `tenant_id` gets a policy on it. `student_fees` and `student_guardians`
 *   have none, so their policy asks the student. `users` is global (one login, many schools) and
 *   cannot be walled by row: the role may read only the four columns the areas use (id, name, status, and `deleted_at` for the soft-delete rule).
 * - `NULLIF(current_setting(..., true), '')` because a pooled connection that once set the value
 *   locally answers '' (not NULL), and `''::uuid` would throw.
 * - Every table an area reads must be listed here. A spec fails when one is missed.
 */
export class ReportReaderRls1791900003200 implements MigrationInterface {
  name = 'ReportReaderRls1791900003200';

  private static readonly WITH_TENANT = [
    'enrollments',
    'students',
    'class_sections',
    'classes',
    'academic_years',
    'guardians',
    'staff_profiles',
    'staff_hr_records',
    'staff_designation_history',
    'designations',
    'student_public_exams',
    'fee_structures',
    'payments',
    'attendance_records',
    'attendance_sessions',
    'final_results',
    'final_result_rows',
    'programs',
    'program_enrollments',
    'applications',
  ] as const;

  /** No `tenant_id` of their own: scoped through the student they point at. */
  private static readonly VIA_STUDENT = ['student_fees', 'student_guardians'] as const;

  private static readonly TENANT = "NULLIF(current_setting('app.report_tenant', true), '')::uuid";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE ROLE report_reader NOLOGIN NOINHERIT NOBYPASSRLS;
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END
      $$`);
    // The app's role must be a member to `SET ROLE` into it (a superuser needs no grant, a plain
    // owner does; PG16 asks for ADMIN OPTION, which the role's creator has).
    await queryRunner.query(
      `DO $$ BEGIN EXECUTE format('GRANT report_reader TO %I', current_user); END $$`,
    );
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO report_reader`);

    for (const table of ReportReaderRls1791900003200.WITH_TENANT) {
      await this.wall(queryRunner, table, `"tenant_id" = ${ReportReaderRls1791900003200.TENANT}`);
    }
    for (const table of ReportReaderRls1791900003200.VIA_STUDENT) {
      await this.wall(
        queryRunner,
        table,
        `EXISTS (SELECT 1 FROM "students" s WHERE s."id" = "${table}"."student_id" AND s."tenant_id" = ${ReportReaderRls1791900003200.TENANT})`,
      );
    }
    await queryRunner.query(
      `GRANT SELECT ("id", "full_name", "status", "deleted_at") ON "users" TO report_reader`,
    );
  }

  private async wall(queryRunner: QueryRunner, table: string, using: string): Promise<void> {
    await queryRunner.query(`GRANT SELECT ON "${table}" TO report_reader`);
    await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS "report_tenant" ON "${table}"`);
    await queryRunner.query(
      `CREATE POLICY "report_tenant" ON "${table}" FOR SELECT TO report_reader USING (${using})`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const all = [
      ...ReportReaderRls1791900003200.WITH_TENANT,
      ...ReportReaderRls1791900003200.VIA_STUDENT,
    ];
    await queryRunner.query(
      `REVOKE SELECT ("id", "full_name", "status", "deleted_at") ON "users" FROM report_reader`,
    );
    for (const table of all) {
      await queryRunner.query(`DROP POLICY IF EXISTS "report_tenant" ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`REVOKE SELECT ON "${table}" FROM report_reader`);
    }
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM report_reader`);
    // The role itself stays: other databases on this cluster still hold grants to it.
  }
}
