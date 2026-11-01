import { instanceToPlain } from 'class-transformer';
import type { OrganisationSettings, PresetSettings, RegionSettings } from '@biddaloy/shared';
import { CommunicationMedium } from '@biddaloy/shared';
import { soleDescriptorFor, settingsKeyFor, toNestedMedium } from './messaging-descriptors';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_REGION_SETTINGS,
} from './tenant-settings-defaults';
import { localDate } from '../../attendance/attendance-policy.util';

/** `instanceToPlain(dto, { exposeUnsetFields: false })` — a class instance
 * whose properties the caller never set stay absent from the result
 * rather than appearing as explicit `undefined`s. `mergeTenantSettings`
 * (and encryption, which needs to run against the same plain shape
 * *before* merging — see `SchoolsService.updateSettings`) both depend on
 * that: spreading an object with explicit `undefined` values over
 * `currentCommunications` would blank out every medium the patch didn't
 * touch instead of leaving them alone. An explicit `null` (how a caller
 * clears a secret — #8.7.9) is a real, present key and survives this the
 * same way any other value does; only genuinely *unset* properties are
 * dropped. */
export function toPlainSettingsPatch(dto: TenantSettingsDto): Record<string, unknown> {
  return instanceToPlain(dto, { exposeUnsetFields: false });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges `patch` into `existing` key by key, recursively, so a key the
 * patch never sent is left exactly as it was stored — the general form
 * of "omitting a secret leaves it unchanged" (#8.7.9's PATCH contract):
 * that's true for every field at every depth here, not something special
 * about secret fields specifically. An explicit `null` removes the key
 * (#3331: how a form clears a saved optional field or a secret; the
 * validator only lets `null` through at field depth, never for a required
 * text field). Every other non-object value (a fresh plaintext secret about
 * to be encrypted, an already-encrypted string carried over untouched, a
 * number, ...) replaces the existing value outright.
 */
function deepMergeOmittingUnset(existing: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;

  const base = isPlainObject(existing) ? existing : {};
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = deepMergeOmittingUnset(base[key], value);
  }
  return merged;
}

/**
 * D6 + D31: when exactly one side of a sole-provider medium is nested, lift the
 * flat side so the deep merge keeps stored secrets. Flat + flat stays flat. Also used by the
 * workbook import (`school.tab.ts`).
 * ponytail: drops with the D6 compat-removal follow-up.
 */
export function alignMediumShapes(current: unknown, patch: unknown) {
  if (!isPlainObject(current) || !isPlainObject(patch)) return { current, patch };
  const cur = { ...current };
  const pat = { ...patch };
  for (const medium of Object.values(CommunicationMedium)) {
    const key = settingsKeyFor(medium);
    const sole = soleDescriptorFor(medium);
    if (!sole || !isPlainObject(cur[key]) || !isPlainObject(pat[key])) continue;
    const curNested = Object.hasOwn(cur[key], sole.name);
    const patNested = Object.hasOwn(pat[key], sole.name);
    if (curNested === patNested) continue;
    if (curNested) pat[key] = toNestedMedium(pat[key], medium);
    else cur[key] = toNestedMedium(cur[key], medium);
  }
  return { current: cur, patch: pat };
}

/**
 * Merges an already-plain settings patch (see `toPlainSettingsPatch`) into
 * the existing stored jsonb blob.
 *
 * `region` is one dashboard section and is replaced wholesale when
 * present — the form that produces it always submits every field.
 *
 * `routine`, `fees`, `evaluations` and `dashboard` are replaced wholesale when
 * present (the forms always send the whole block).
 *
 * `attendance` and `documents` are shallow-merged: keys the patch omits (e.g. `shiftTimes`,
 * `periodAttendance`, which the older attendance form never sends) survive;
 * keys the patch sends replace the stored value whole.
 *
 * `routine` is replaced wholesale when present (a cleared cap sent as `null` sticks).
 *
 * `studyPlans` is shallow-merged like `attendance`: omitted fields survive.
 *
 * `communications` merges recursively (`deepMergeOmittingUnset`): saving
 * the WhatsApp section doesn't clobber an already-configured SMS section
 * sitting next to it (#8.7.13 saves per-section, not one page-wide
 * submit), *and*, one level further in, omitting a medium's secret field
 * from the patch leaves that medium's other fields (and the secret
 * itself) untouched — the write half of #8.7.9's "omitting a secret key
 * in a PATCH leaves it unchanged; sending `null` clears it."
 *
 * Takes a plain object rather than the `TenantSettingsDto` instance
 * itself so `SchoolsService.updateSettings` can run encryption
 * (`encryptSecretFields`, #8.7.8) against the patch's own plain
 * representation *before* merging — encrypting the full merged object
 * instead would re-encrypt already-encrypted fields carried over
 * unchanged from `existing`.
 */
export function mergeTenantSettings(
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
  now: Date = new Date(),
): Record<string, unknown> {
  const current = existing ?? {};

  const merged: Record<string, unknown> = {
    ...current,
    version: patch.version,
  };

  if (patch.region !== undefined) {
    merged.region = patch.region;
  }

  // [1811] Missing branch: a `routine` PATCH returned 200 and stored nothing.
  if (patch.routine !== undefined) merged.routine = patch.routine;

  if (patch.attendance !== undefined) {
    const stored = isPlainObject(merged.attendance) ? merged.attendance : {};
    // [TIME-02] The history is server-owned: never trust a client copy.
    const { weeklyOffHistory: _ignored, ...attendancePatch } = patch.attendance as Record<
      string,
      unknown
    >;
    const attendance: Record<string, unknown> = { ...stored, ...attendancePatch };
    const prev =
      (stored.weeklyOffDays as number[] | undefined) ?? DEFAULT_ATTENDANCE_SETTINGS.weeklyOffDays;
    const next = attendancePatch.weeklyOffDays as number[] | undefined;
    const sameSet = (a: number[], b: number[]) =>
      new Set(a).size === new Set(b).size && a.every((d) => b.includes(d));
    if (next && !sameSet(next, prev)) {
      const tz =
        (merged.region as { timezone?: string } | undefined)?.timezone ??
        DEFAULT_REGION_SETTINGS.timezone;
      const today = localDate(now, tz);
      const hist =
        (stored.weeklyOffHistory as Array<{ until: string; days: number[] }> | undefined) ?? [];
      if (!hist.some((e) => e.until === today)) {
        attendance.weeklyOffHistory = [...hist, { until: today, days: [...prev].sort() }].sort(
          (a, b) => a.until.localeCompare(b.until),
        );
      }
    }
    merged.attendance = attendance;
  }

  // [33.1.1] Wholesale replace, like `backup`/`fees` — not
  // `deepMergeOmittingUnset` like `communications`. Each field is a plain
  // string array; a deep merge can't express "remove this shift", only add/
  // overwrite, so a rename or deletion sent by #891 would never take. A full
  // replace on `organisation` (or per-list, if #891 needs finer control) is
  // the only shape where sending a shorter list actually shortens it.
  if (patch.organisation !== undefined) {
    merged.organisation = patch.organisation;
  }

  // [35.1.2] `preset` is deliberately NOT merged (D37): a PATCH can never set
  // or clear it. Apply/reset (W2) write it via a direct `settings` merge on
  // the manager. It survives here only through the `...current` spread above.

  if (patch.auth !== undefined) {
    merged.auth = patch.auth;
  }

  if (patch.communications !== undefined) {
    const aligned = alignMediumShapes(current.communications, patch.communications);
    merged.communications = deepMergeOmittingUnset(aligned.current, aligned.patch);
  }

  if (patch.backup !== undefined) {
    merged.backup = patch.backup;
  }

  if (patch.fees !== undefined) {
    merged.fees = patch.fees;
  }

  // [28.4.7] Wholesale replace, like `fees`; the DTO validates the one boolean.
  if (patch.evaluations !== undefined) {
    merged.evaluations = patch.evaluations;
  }

  // [52.2.6] Wholesale replace, like `evaluations`; the DTO validates the one boolean.
  if (patch.applications !== undefined) {
    merged.applications = patch.applications;
  }

  // [TIME-11] Shallow per switch: a PATCH of one flag keeps the other.
  if (patch.homework !== undefined) {
    merged.homework = {
      ...(isPlainObject(merged.homework) ? merged.homework : {}),
      ...(patch.homework as Record<string, unknown>),
    };
  }

  // [48.1.03] Shallow-merged like `attendance`: both fields are optional, so a
  // partial PATCH must not reset `withholdAdmitCardForDues`. `serialPrefix: null` clears it.
  if (patch.documents !== undefined) {
    merged.documents = {
      ...(isPlainObject(merged.documents) ? merged.documents : {}),
      ...(patch.documents as Record<string, unknown>),
    };
  }

  // [66.1.04] Shallow per field, like `attendance`: the settings page may save one
  // field at a time, and an omitted field keeps its stored value.
  if (patch.studyPlans !== undefined) {
    merged.studyPlans = {
      ...(isPlainObject(merged.studyPlans) ? merged.studyPlans : {}),
      ...(patch.studyPlans as Record<string, unknown>),
    };
  }

  // [8.10.7] Wholesale replace, like `fees`/`evaluations`. Missing fields fall back to defaults on read.
  if (patch.dashboard !== undefined) {
    merged.dashboard = patch.dashboard;
  }

  // [67.1.06] Shallow merge so a PATCH may send one field; `rules` merged one level deeper
  // so switching one rule off keeps the others.
  if (patch.attention !== undefined) {
    const prev = isPlainObject(current.attention) ? current.attention : {};
    const next = patch.attention as Record<string, unknown>;
    merged.attention = {
      ...prev,
      ...next,
      rules: {
        ...(isPlainObject(prev.rules) ? prev.rules : {}),
        ...(isPlainObject(next.rules) ? next.rules : {}),
      },
    };
  }

  return merged;
}

/** [35.2.2] Preset apply: the only writer allowed to set `preset` (D37 bars PATCH). */
export function mergeApplySettings(
  stored: Record<string, unknown> | null,
  patch: { organisation: OrganisationSettings; region: RegionSettings; preset: PresetSettings },
): Record<string, unknown> {
  return {
    ...(stored ?? {}),
    organisation: patch.organisation,
    region: patch.region,
    preset: patch.preset,
  };
}

/** [35.2.2] Preset reset: drops `preset`, restores the empty organisation vocabulary. */
export function clearPresetSettings(
  stored: Record<string, unknown> | null,
): Record<string, unknown> {
  const { preset: _preset, ...rest } = stored ?? {};
  return { ...rest, organisation: { ...DEFAULT_ORGANISATION_SETTINGS } };
}
