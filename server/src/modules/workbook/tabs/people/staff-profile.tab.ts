import type { EntityManager } from 'typeorm';
import { StaffProfile } from '../../../staff-profiles/entities/staff-profile.entity';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import { optionalKeyOf } from '../../codec/tab-spec';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `staff_profiles` tab: the generic staff record every staff `User`
 * (TEACHER/ADMIN/ACCOUNTANT/EXECUTIVE) gets, backing attendance and leave.
 *
 * `entity: StaffProfile`, table `staff_profiles`
 * (`server/src/modules/staff-profiles/entities/staff-profile.entity.ts`,
 * migration `1789800014000-StaffAttendanceLeave.ts`).
 *
 * `employee_id` is the natural key here, unlike `teachers.tab.ts` where it's
 * globally unique — `staff_profiles.employee_id` is only unique **per
 * tenant** (`UQ_staff_profiles_tenant_employee_id`), so `upsert` below scopes
 * its lookup by `tenant_id` too, the same pattern as `students.tab.ts`'s
 * `registration_number`.
 *
 * Registered in `EXPECTED_TABS` immediately before `teachers`: `teachers`
 * now FKs `staff_profile_id`, but that column is excluded from
 * `teachers.tab.ts` as system-derived, so there is no ordering dependency
 * from this tab's own columns onto `teachers` — only the reverse.
 */
export interface StaffProfileRow {
  id: string;
  /** Null when the cell is blank (the member left); the stored login is kept. */
  user_id: string | null;
  employee_id: string;
  joining_date: string | null; // 'YYYY-MM-DD'
  card_no: string | null;
  // The `users` tab's own natural key, kept alongside the resolved `user_id`
  // for parity with the row/entity branching pattern in other tabs.
  user_key: string;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'user',
    type: 'ref',
    ref: 'users',
    requiredOnNewRow: true,
    label: { en: 'User', bn: 'ব্যবহারকারী' },
  },
  {
    key: 'employee_id',
    type: 'string',
    required: true,
    label: { en: 'Employee ID', bn: 'কর্মচারী আইডি' },
  },
  {
    key: 'card_no',
    type: 'string',
    label: { en: 'Card number', bn: 'কার্ড নম্বর' },
  },
  {
    key: 'joining_date',
    type: 'date',
    label: { en: 'Joining date', bn: 'যোগদানের তারিখ' },
  },
];

/**
 * `StaffProfile` columns deliberately left out of the workbook. The
 * completeness gate (`registry.completeness.spec.ts`) fails if a new
 * `StaffProfile` column appears in neither `columns` nor here.
 */
const excluded: readonly string[] = [
  'user_id', // exported instead as the `user` ref column, keyed by the referenced tab's natural key
  'tenant_id', // implicit: every row is scoped to the workbook's own tenant
];

const MAX_LENGTHS: Record<string, number> = {
  employee_id: 50,
  card_no: 64,
};

export const staffProfileTab: TabSpec<StaffProfile, StaffProfileRow> = {
  name: 'staff_profiles',
  entity: StaffProfile,
  excluded,
  dependsOn: ['users'],
  columns,
  naturalKey: ['employee_id'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<StaffProfile[]> {
    return m.find(StaffProfile, { where: { tenant_id: tenantId }, relations: ['user'] });
  },

  toRow(entity: StaffProfile, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      user: optionalKeyOf(ctx, 'users', entity.user_id),
      employee_id: entity.employee_id,
      card_no: entity.card_no,
      joining_date: entity.joining_date,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StaffProfileRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'staff_profiles', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'staff_profiles',
          row: rowNo,
          column: column.key,
          message: `Column "${column.key}": is longer than the ${limit} characters allowed.`,
          severity: 'error',
          value: raw,
        });
        continue;
      }

      values[column.key] = result.value;
    }

    if (errors.length > 0) return { errors };

    const userKey = values.user as string;
    const userId = userKey ? ctx.ref('users', userKey) : undefined;
    if (userKey && !userId) {
      errors.push({
        tab: 'staff_profiles',
        row: rowNo,
        column: 'user',
        message: `Column "user": no user with the key "${userKey}" was found.`,
        severity: 'error',
        value: userKey,
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        user_id: userId ?? null,
        employee_id: values.employee_id as string,
        card_no: (values.card_no as string | null) ?? null,
        joining_date: (values.joining_date as string | null) ?? null,
        user_key: userKey,
      },
    };
  },

  keyOf(x: StaffProfileRow | StaffProfile): string {
    return x.employee_id;
  },

  diffFields(row: StaffProfileRow, existing: StaffProfile): string[] {
    const changed: string[] = [];
    if (row.user_id && row.user_id !== existing.user_id) changed.push('user_id');
    if (row.employee_id !== existing.employee_id) changed.push('employee_id');
    if (row.card_no !== existing.card_no) changed.push('card_no');
    const rowJoiningDate = row.joining_date;
    const existingJoiningDate = existing.joining_date
      ? formatDateOnly(existing.joining_date)
      : null;
    if (rowJoiningDate !== existingJoiningDate) changed.push('joining_date');
    return changed;
  },

  async upsert(
    row: StaffProfileRow,
    existing: StaffProfile | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<StaffProfile> {
    // `employee_id` is unique per tenant (`UQ_staff_profiles_tenant_employee_id`),
    // like `Teacher.employee_id` — scope the lookup accordingly.
    let staffProfile =
      existing ??
      (await m.findOne(StaffProfile, {
        where: { tenant_id: tenantId, employee_id: row.employee_id },
      }));

    // `staff_profiles (tenant_id, user_id)` is unique too
    // (`UQ_staff_profiles_tenant_user`; no soft delete here, so every row
    // counts). The row's user may already hold a different profile (its
    // employee id edited after export): `m.save` would hit 23505 and abort
    // the restore, so name it instead — same as `teachers.tab.ts`. With no
    // match by employee id, the user's own profile is taken over.
    // The login is NOT NULL, so a blank cell (a departed member) never clears it.
    const userId = row.user_id ?? staffProfile?.user_id;
    if (!userId) throw new Error(`Staff profile "${row.employee_id}" needs a login.`);
    if (staffProfile?.user_id !== userId) {
      const byUser = await m.findOne(StaffProfile, {
        where: { tenant_id: tenantId, user_id: userId },
      });
      if (byUser && staffProfile && byUser.id !== staffProfile.id) {
        throw new Error(
          `Staff profile with user "${row.user_key || userId}" already belongs to a ` +
            `different staff profile and cannot be reassigned by a restore.`,
        );
      }
      staffProfile ??= byUser;
    }
    staffProfile ??= new StaffProfile();

    staffProfile.tenant_id = tenantId;
    staffProfile.user_id = userId;
    staffProfile.employee_id = row.employee_id;
    staffProfile.card_no = row.card_no;
    // `Date(row.joining_date)` would parse the ISO string as UTC midnight,
    // then TypeORM's Postgres driver formats a `Date` value via local
    // calendar getters for a `date` column — on a west-of-UTC server that
    // shifts to the previous local day. A date *string* passes through
    // unchanged, so keep it one.
    staffProfile.joining_date = (row.joining_date ?? null) as unknown as Date | null;

    return m.save(StaffProfile, staffProfile);
  },

  async remove(entity: StaffProfile, m: EntityManager): Promise<void> {
    await m.remove(StaffProfile, entity);
  },
};
