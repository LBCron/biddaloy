import type { EntityManager } from 'typeorm';
import { School } from '../../../schools/entities/school.entity';
import { TenantSettingsDto } from '../../../schools/dto/tenant-settings.dto';
import { getSecretPaths } from '../../../schools/settings/secret-paths.util';
import { alignMediumShapes } from '../../../schools/settings/tenant-settings-merge.util';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `school` tab: the destination school's own profile.
 *
 * This is the worked example every other tab copies, so it is written to show
 * the shape rather than to be clever. One row, no dependencies, and it is
 * never deleted by a restore — a backup can update the school's profile but
 * cannot remove the school it is being restored into.
 */

/** The validated in-memory row. Distinct from `School`: no lifecycle state. */
export interface SchoolRow {
  id: string;
  name: string;
  name_bn: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_id: string | null;
  country_code: string | null;
  settings: Record<string, unknown> | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  // Exported for a human reading the workbook (and kept as this tab's own
  // `naturalKey`), but never applied by `upsert` — see the comment there.
  // It stays a real column rather than moving to `excluded` alongside
  // `slug` because, unlike `slug`, it is genuinely useful information in
  // the file itself; only the *write* path treats it as identity.
  {
    key: 'name',
    type: 'string',
    required: true,
    label: { en: 'School name', bn: 'বিদ্যালয়ের নাম' },
  },
  {
    key: 'name_bn',
    type: 'string',
    label: { en: 'School name (Bangla)', bn: 'বিদ্যালয়ের নাম (বাংলা)' },
  },
  { key: 'address', type: 'string', label: { en: 'Address', bn: 'ঠিকানা' } },
  { key: 'phone', type: 'string', label: { en: 'Phone', bn: 'ফোন' } },
  { key: 'email', type: 'string', label: { en: 'Email', bn: 'ইমেইল' } },
  { key: 'registration_id', type: 'string', label: { en: 'Registration ID', bn: 'নিবন্ধন নম্বর' } },
  { key: 'country_code', type: 'string', label: { en: 'Country code', bn: 'দেশের কোড' } },
  { key: 'settings', type: 'json', label: { en: 'Settings', bn: 'সেটিংস' } },
];

/**
 * Entity columns deliberately left out of the workbook. The completeness gate
 * (`registry.completeness.spec.ts`) fails if a new `School` column appears in
 * neither `columns` nor here, so this list is the record of a decision rather
 * than an oversight.
 */
const excluded: readonly string[] = [
  'slug', // identity of the tenant itself; restoring it would rename the destination school
  'logo_key', // the image lives in the storage bucket; a workbook cannot carry it
  'status', // lifecycle state of the destination tenant, not profile data
  'status_reason', // see `status`
  'status_changed_at', // see `status`
  'trial_ends_at', // commercial state of the destination tenant; a file must not extend a trial
  'seat_limit', // commercial state of the destination tenant; a file must not raise its seats
  'onboarding', // setup progress of the destination tenant
  'created_in_demo', // how the destination school was made (demo visitor signup); a file must not flip it, the demo reset and boot check rely on it
];

/**
 * The varchar bounds declared on `School`. Kept next to the columns so that
 * changing one without the other is obvious in review.
 */
const MAX_LENGTHS: Record<string, number> = {
  name: 200,
  name_bn: 200,
  phone: 20,
  email: 100,
  registration_id: 100,
  country_code: 2,
};

/**
 * Deletes every `@Secret()`-marked path from a settings object.
 *
 * Not `redactSecretPaths` from `schools/settings/settings-audit-redact.util`:
 * that replaces each secret with the literal `[REDACTED]`, which is correct
 * for an audit log and destructive here. This JSON is re-imported later, so a
 * `[REDACTED]` marker would merge back over the destination's real credential
 * and break its SMS or WhatsApp integration. Deleting the key instead means
 * `upsert`'s merge simply leaves the stored secret alone.
 *
 * Driven by `getSecretPaths(TenantSettingsDto)` for the same reason that
 * function exists: adding a new `@Secret()` field to the schema must be enough,
 * with no separate list here to forget to update.
 */
export function stripSecretPaths(settings: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(settings);

  for (const path of getSecretPaths(TenantSettingsDto)) {
    const segments = path.split('.');
    let cursor: Record<string, unknown> | undefined = result;

    for (const key of segments.slice(0, -1)) {
      const next: unknown = cursor?.[key];
      cursor = isPlainObject(next) ? next : undefined;
      if (!cursor) break;
    }

    if (cursor) delete cursor[segments[segments.length - 1]];
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges `incoming` into `existing`, overwriting only keys `incoming`
 * actually has.
 *
 * `mergeTenantSettings` in `schools/settings/` is not reusable here: it is
 * shaped for a `TenantSettingsDto` patch and names `region`/`attendance`/
 * `auth`/`communications` explicitly, whereas an imported settings blob is an
 * arbitrary object.
 *
 * Absent-means-unchanged is what protects the destination's secrets. Export
 * strips them, so an imported object never carries them; replacing the whole
 * settings object instead would wipe every credential the destination had.
 */
export function deepMergePresent(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (incoming === null) return existing;
  const base: Record<string, unknown> = existing ? structuredClone(existing) : {};

  for (const [key, value] of Object.entries(incoming)) {
    const current = base[key];
    base[key] =
      isPlainObject(value) && isPlainObject(current) ? deepMergePresent(current, value)! : value;
  }

  return base;
}

/**
 * `communications.sms.metering` says who pays for the school's SMS, and only the platform sets it
 * (#3346). A school ADMIN holds BACKUP_MANAGE, so an imported value must never reach the stored
 * settings: the destination keeps its own, whatever the file says. A non-object `communications`
 * or `communications.sms` (e.g. `null`) is dropped too: the merge would replace the stored object
 * with it, wiping the stored metering and every saved credential under it.
 */
function withoutPlatformOnlyPaths(settings: Record<string, unknown>): Record<string, unknown> {
  if (!('communications' in settings)) return settings;
  const { communications, ...rest } = settings;
  if (!isPlainObject(communications)) return rest;
  if (!('sms' in communications)) return settings;
  const { sms, ...otherMedia } = communications;
  if (!isPlainObject(sms)) return { ...rest, communications: otherMedia };
  const { metering: _dropped, ...smsKept } = sms;
  return { ...rest, communications: { ...otherMedia, sms: smsKept } };
}

/**
 * What an import does to the stored settings: secrets stripped, then a present-keys merge. A
 * messaging medium stored flat (pre-D6) but imported nested (or the reverse) is lifted to one shape
 * first, or the merge would keep both and strand the stored secret (the send then fails).
 */
export function mergeImportedSettings(
  existing: Record<string, unknown> | null,
  imported: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const incoming = imported ? withoutPlatformOnlyPaths(stripSecretPaths(imported)) : null;
  if (!existing || !incoming || !isPlainObject(incoming.communications)) {
    return deepMergePresent(existing, incoming);
  }
  const aligned = alignMediumShapes(existing.communications, incoming.communications);
  return deepMergePresent(
    { ...existing, communications: aligned.current },
    { ...incoming, communications: aligned.patch as Record<string, unknown> },
  );
}

export const schoolTab: TabSpec<School, SchoolRow> = {
  name: 'school',
  entity: School,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['name'],
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<School[]> {
    // The school *is* the tenant, so its own id is the tenant id.
    return m.find(School, { where: { id: tenantId } });
  },

  toRow(entity: School, _ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      name_bn: entity.name_bn,
      address: entity.address,
      phone: entity.phone,
      email: entity.email,
      registration_id: entity.registration_id,
      country_code: entity.country_code,
      // Credentials never leave the system in a backup file.
      settings: entity.settings ? stripSecretPaths(entity.settings) : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    _ctx: ImportContext,
  ): { row: SchoolRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'school', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      // The entity's varchar bounds, checked here rather than left to
      // Postgres. Without this, an over-long cell fails at `save` with a
      // 22001 that aborts the entire restore, instead of costing the user
      // one cell.
      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'school',
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

    // `fromCell`'s json branch returns whatever JSON.parse yields, so a
    // hand-edited cell containing `"hello"` or `[1,2]` would otherwise reach
    // the merge and be spread into the tenant's settings jsonb as
    // `{0:'h',1:'e',...}`.
    if (
      values.settings !== null &&
      values.settings !== undefined &&
      !isPlainObject(values.settings)
    ) {
      errors.push({
        tab: 'school',
        row: rowNo,
        column: 'settings',
        message: 'Column "settings": must be a JSON object, for example {"region":{}}.',
        severity: 'error',
        value: cells.settings ?? '',
      });
    }

    // Accept any case, store upper-case, so a lowercase stored value still round-trips.
    if (typeof values.country_code === 'string')
      values.country_code = values.country_code.toUpperCase();
    // An ISO 3166-1 alpha-2 code; anything else would store junk the region logic can't read.
    if (typeof values.country_code === 'string' && !/^[A-Z]{2}$/.test(values.country_code)) {
      errors.push({
        tab: 'school',
        row: rowNo,
        column: 'country_code',
        message: 'Column "country_code": must be two capital letters, for example BD.',
        severity: 'error',
        value: cells.country_code ?? '',
      });
    }

    if (errors.length > 0) return { errors };

    return {
      row: {
        id: values.id as string,
        name: values.name as string,
        name_bn: values.name_bn as string | null,
        address: values.address as string | null,
        phone: values.phone as string | null,
        email: values.email as string | null,
        registration_id: values.registration_id as string | null,
        country_code: values.country_code as string | null,
        settings: values.settings as Record<string, unknown> | null,
      },
    };
  },

  keyOf(x: SchoolRow | School): string {
    return x.name;
  },

  diffFields(row: SchoolRow, existing: School): string[] {
    const changed: string[] = [];
    // `name` is deliberately not compared: `upsert` never applies it (see
    // there), so reporting it as a pending change would show the admin a
    // diff that a restore would not actually make.
    for (const key of [
      'name_bn',
      'address',
      'phone',
      'email',
      'registration_id',
      'country_code',
    ] as const) {
      if (row[key] !== existing[key]) changed.push(key);
    }

    // The same merge upsert does, so the preview never reports a 'settings'
    // change that upsert would actually discard.
    const merged = mergeImportedSettings(existing.settings, row.settings);
    if (JSON.stringify(merged) !== JSON.stringify(existing.settings)) changed.push('settings');

    return changed;
  },

  async upsert(
    row: SchoolRow,
    existing: School | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<School> {
    // Always the destination tenant's own school, never the id in the file:
    // the workbook's id belongs to the *source* school and must not be able
    // to reach across tenants.
    const school = existing ?? (await m.findOneByOrFail(School, { id: tenantId }));

    // `name` is exported (see `columns` above) but never applied here — same
    // reasoning `excluded` already gives for `slug`: it is the destination
    // tenant's own identity. A same-tenant "undo a bad edit" restore would
    // arguably want it restored too, but this tab has no way to tell that
    // case apart from a cross-tenant restore into a *different* school
    // (SUPER_ADMIN provisioning, school-to-school migration), where silently
    // renaming the destination is exactly the `slug` mistake this comment
    // already warns against — so it is left alone in both cases.
    school.name_bn = row.name_bn;
    school.address = row.address;
    school.phone = row.phone;
    school.email = row.email;
    school.registration_id = row.registration_id;
    school.country_code = row.country_code;
    // A hand-edited workbook can carry a secret path (e.g.
    // communications.sms.mimsms.apiKey) the exporter never wrote — the merge
    // strips it so an import can never overwrite a stored credential.
    school.settings = mergeImportedSettings(school.settings, row.settings);

    return m.save(School, school);
  },

  remove(_entity: School, _m: EntityManager): Promise<void> {
    // A restore never deletes the school it is being restored into.
    return Promise.resolve();
  },
};
