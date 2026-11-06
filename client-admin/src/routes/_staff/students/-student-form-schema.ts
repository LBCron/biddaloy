/**
 * `z.infer` here is deliberately checked against the generated
 * `CreateStudentInput`/`UpdateStudentInput` types (`components['schemas']`
 * in `@biddaloy/ui/hooks`, generated from `server/openapi.json`) via
 * `buildCreatePayload`/`buildUpdatePayload`'s own return-type annotations
 * below — per this ticket's own AC ("Zod schemas derive from the generated
 * API types"). A field renamed or removed server-side breaks these
 * functions at compile time rather than silently drifting, the same
 * "generated types are the source of truth" guarantee `check:api-types`
 * enforces for the rest of the app.
 *
 * No `email`/`phone` fields here even though `CreateStudentDto`/
 * `UpdateStudentDto` both declare them: `Student` (`server/src/modules/
 * students/entities/student.entity.ts`) has no matching columns, and
 * `StudentService.create`/`update` never read `dto.email`/`dto.phone` —
 * contact info lives on `Guardian` instead (`students.ts`'s own hook
 * comment already documents this for `phone`). Building inputs for fields
 * the server silently drops would be a real data-loss bug, not a
 * simplification.
 *
 * All remaining fields stay plain strings end to end (same "parse once on
 * submit" reasoning `EmailSection.tsx`/`zod-helpers.ts` already use) —
 * `roll_number` as a numeric string, `date_of_birth`/`classId` handled by
 * their own widgets' native value types (`Date | undefined`, `string`).
 */
import { CARD_NO_PATTERN } from '@biddaloy/ui/components';
import type { CreateStudentInput, Student, UpdateStudentInput } from '@biddaloy/ui/hooks';
import { z } from 'zod';

export const PREFERRED_COMMUNICATION_VALUES = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'PHONE_CALL',
  'MESSENGER',
] as const;

/** Mirrors the server's list (`CreateStudentDto.blood_group`); `buildCreatePayload`'s
 * return type is checked against the generated union, so a change server-side breaks here. */
export const BLOOD_GROUP_VALUES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUP_VALUES)[number];

export interface StudentFormMessages {
  fullNameRequired: string;
  classSectionRequired: string;
  rollNumberInvalid: string;
  fullNameBnTooLong: string;
  bloodGroupInvalid: string;
  cardNoInvalid: string;
}

/** Every field name this schema can produce a `ZodIssue` for — the
 * allowlist `parseValidationFieldErrors` needs to map a server-side
 * `ValidationPipe` message back onto the right input. Kept next to the
 * schema itself so the two can't drift apart. */
export const STUDENT_FORM_SERVER_FIELDS = [
  'full_name',
  'full_name_bn',
  'blood_group',
  'class_section_id',
  'roll_number',
  'card_no',
  'date_of_birth',
  'gender',
  'home_address',
  'preferred_communication',
] as const;

export const GENDER_VALUES = ['MALE', 'FEMALE', 'OTHER'] as const;

export function buildStudentFormSchema(messages: StudentFormMessages) {
  return z.object({
    full_name: z.string().trim().min(1, messages.fullNameRequired),
    // Optional: an empty box means "no Bangla name". Printed on ID cards (Epic 32, D41).
    full_name_bn: z.string().trim().max(200, messages.fullNameBnTooLong),
    // '' = "Not set". Anything else must be one of the 8 real groups.
    blood_group: z.union([z.enum(BLOOD_GROUP_VALUES), z.literal('')], {
      message: messages.bloodGroupInvalid,
    }),
    classId: z.string(),
    class_section_id: z.string().min(1, messages.classSectionRequired),
    // `[1-9]\d*` — not `\d+` — since `"0"` isn't a positive whole number,
    // the rule both locale messages already state.
    roll_number: z
      .string()
      .trim()
      .refine((value) => value === '' || /^[1-9]\d*$/.test(value), {
        message: messages.rollNumberInvalid,
      }),
    date_of_birth: z.date().optional(),
    // [76.5.07] Optional attendance card; empty means "no card" (absent on create, null on update).
    card_no: z.string().trim().regex(CARD_NO_PATTERN, messages.cardNoInvalid).or(z.literal('')),
    gender: z.string().trim(),
    home_address: z.string().trim(),
    preferred_communication: z.enum(PREFERRED_COMMUNICATION_VALUES),
    guardian_ids: z.array(z.string()),
  });
}

export type StudentFormSchema = ReturnType<typeof buildStudentFormSchema>;
export type StudentFormValues = z.infer<StudentFormSchema>;

export function defaultStudentFormValues(): StudentFormValues {
  return {
    full_name: '',
    full_name_bn: '',
    blood_group: '',
    classId: '',
    class_section_id: '',
    roll_number: '',
    card_no: '',
    date_of_birth: undefined,
    gender: '',
    home_address: '',
    preferred_communication: 'SMS',
    guardian_ids: [],
  };
}

/** Edit mode's prefill — the inverse of `buildUpdatePayload`, run once to
 * seed `useForm`'s `defaultValues`. `date_of_birth` round-trips through a
 * `Date` (the widget's own value type), not the ISO string the API
 * returns it as. */
export function studentToFormValues(student: Student): StudentFormValues {
  return {
    full_name: student.full_name,
    full_name_bn: student.full_name_bn ?? '',
    // The API types it as a plain string; anything that isn't a known group shows as "Not set".
    blood_group: (BLOOD_GROUP_VALUES as readonly string[]).includes(student.blood_group ?? '')
      ? (student.blood_group as BloodGroup)
      : '',
    classId: student.class_section.class_id,
    class_section_id: student.class_section_id,
    roll_number: String(student.roll_number),
    card_no: student.card_no ?? '',
    date_of_birth: student.date_of_birth ? new Date(student.date_of_birth) : undefined,
    gender: student.gender ?? '',
    home_address: student.home_address ?? '',
    preferred_communication: student.preferred_communication,
    guardian_ids: student.guardians.map((guardian) => guardian.id),
  };
}

function toOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** `date.toISOString().slice(0, 10)` converts to UTC first — `DatePicker`
 * hands back a local-midnight `Date`, so in any timezone ahead of UTC
 * (Bangladesh, this app's only region, is UTC+6) that conversion rolls
 * the date back a day: local midnight Jan 15 is 18:00 UTC Jan 14. Reading
 * the local year/month/day components instead serializes the calendar
 * date the user actually picked. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The fields create and update share identically — `roll_number` isn't
 * nullable on `Student` (unlike `date_of_birth`/`gender`/`home_address`),
 * so there's no "clear it" case for it either mode: an empty value just
 * means "let the server pick the next roll number" on create, or "leave
 * it as-is" on update. */
function toBasePayload(values: StudentFormValues) {
  const rollNumber = values.roll_number.trim() === '' ? undefined : Number(values.roll_number);
  return {
    full_name: values.full_name.trim(),
    class_section_id: values.class_section_id,
    // `exactOptionalPropertyTypes` — an optional field must be *omitted*,
    // not set to `undefined`, so each one is conditionally spread rather
    // than assigned directly (same pattern `EmailSection.tsx`'s
    // `buildConfig` already uses for its own optional `password`).
    ...(rollNumber !== undefined ? { roll_number: rollNumber } : {}),
    preferred_communication: values.preferred_communication,
    guardian_ids: values.guardian_ids,
  };
}

/** On create, an empty optional field is simply absent — there's nothing
 * to "clear" on a student that doesn't exist yet, and `CreateStudentDto`'s
 * fields aren't nullable (only `UpdateStudentDto`'s are — see that DTO's
 * own comment on why). */
export function buildCreatePayload(values: StudentFormValues): CreateStudentInput {
  const gender = toOptional(values.gender);
  const homeAddress = toOptional(values.home_address);
  const nameBn = toOptional(values.full_name_bn);
  const cardNo = toOptional(values.card_no ?? '');
  return {
    ...toBasePayload(values),
    ...(nameBn !== undefined ? { full_name_bn: nameBn } : {}),
    ...(values.blood_group !== '' ? { blood_group: values.blood_group } : {}),
    ...(values.date_of_birth ? { date_of_birth: toLocalDateString(values.date_of_birth) } : {}),
    ...(cardNo !== undefined ? { card_no: cardNo } : {}),
    ...(gender !== undefined ? { gender } : {}),
    ...(homeAddress !== undefined ? { home_address: homeAddress } : {}),
  };
}

/** On update, an empty field means the user cleared a previously-set
 * value — sent as an explicit `null`, not omitted. A PATCH's absent key
 * means "leave unchanged"; omitting it here (as `buildCreatePayload` does
 * for "nothing to clear yet") would silently leave the old value in place
 * instead of clearing it, which is what "Save" with a blanked-out field
 * has to mean. */
function buildFullUpdatePayload(values: StudentFormValues): UpdateStudentInput {
  return {
    ...toBasePayload(values),
    full_name_bn: toOptional(values.full_name_bn) ?? null,
    blood_group: values.blood_group === '' ? null : values.blood_group,
    date_of_birth: values.date_of_birth ? toLocalDateString(values.date_of_birth) : null,
    gender: toOptional(values.gender) ?? null,
    home_address: toOptional(values.home_address) ?? null,
    card_no: toOptional(values.card_no ?? '') ?? null,
  };
}

/** [2603] Only the keys that differ from `initialValues` are sent, so a stale form cannot
 * overwrite another editor's address, or unlink a guardian it never touched. Once the guardian
 * list itself is edited the whole set goes out (the server has no add/remove delta yet, #2699),
 * so a concurrent guardian add can still be dropped. A cleared field still
 * differs from its initial string, so it goes out as an explicit `null`. `guardian_ids` is
 * compared as a set: reordering alone sends nothing. */
export function buildUpdatePayload(
  values: StudentFormValues,
  initialValues: StudentFormValues,
): UpdateStudentInput {
  const next = buildFullUpdatePayload(values) as Record<string, unknown>;
  const prev = buildFullUpdatePayload(initialValues) as Record<string, unknown>;
  const same = (key: string) =>
    key === 'guardian_ids'
      ? JSON.stringify([...(next[key] as string[])].sort()) ===
        JSON.stringify([...(prev[key] as string[])].sort())
      : next[key] === prev[key];
  return Object.fromEntries(
    Object.keys(next)
      .filter((k) => !same(k))
      .map((k) => [k, next[k]]),
  );
}
