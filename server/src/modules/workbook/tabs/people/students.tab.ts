import type { EntityManager } from 'typeorm';
import { IsNull } from 'typeorm';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { BLOOD_GROUPS } from '../../../students/dto/students.dto';
import { Student } from '../../../students/entities/student.entity';
import { Guardian } from '../../../students/entities/guardian.entity';
import { Enrollment } from '../../../students/entities/enrollment.entity';
import { studentsWithOpenMoney } from '../../../students/open-money';
import { ClassSection } from '../../../academics/entities/class-section.entity';
import {
  lockSeatUsage,
  seatLimitError,
  assertSeatsAvailable,
  type SeatUsage,
} from '../../../schools/trial/seat-limit.service';
import { fromCell, formatDateOnly } from '../../codec/cell-format';
import { optionalKeyOf } from '../../codec/tab-spec';
import { memberKeysById } from './users.tab';
import { ownStorageKey } from '../../codec/storage-key-scope';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `students` tab: every enrolled student, plus which guardians they are
 * linked to.
 *
 * `entity: Student`, table `students`. `class` and `academic_year` are
 * **not** columns on the entity — they are derived from
 * `class_section.class_id` and `class_section.class.academic_year_id`
 * (same pattern `teacher-assignments.tab.ts` uses), so `load` must eagerly
 * join `class_section`, `class_section.class`, `class_section.class.academic_year`.
 * They are resolved for validation only and never cross-checked against
 * `section` — the section key already embeds pipe-joined class/year
 * fragments, so a textual cross-check would be fragile.
 *
 * `guardian_phones` is a misnamed column: despite the name, a cell entry is
 * whatever `guardiansTab.keyOf` produced for that guardian — a phone number,
 * or (when phone is absent) an email, or (when both are absent) a
 * `full_name|relationship` pair. The `;` list delimiter never collides with
 * the `|` used inside a fallback guardian key. The column key is kept as-is
 * because it is the contract this ticket specifies.
 *
 * `registration_number` carries a GLOBAL unique constraint in the database
 * (`UQ_82946fdb5652b83cacb81e9083e`), not tenant-scoped despite the entity's
 * `@Index(['tenant_id', 'registration_number'])` decorator — that composite
 * unique index was never migrated (see `upsert` below). Because the key is
 * genuinely globally unique, `keyOf` needs no fallback chain, unlike
 * `guardians`.
 *
 * `Student.guardians` has `cascade: ['insert']` on the entity. Assigning
 * `.guardians` and calling `m.save` risks TypeORM inserting a duplicate
 * `Guardian` row on every restore. `upsert` below never touches
 * `student.guardians` directly — it reconciles the `student_guardians` join
 * table explicitly via `m.relation(Student, 'guardians').of(student).addAndRemove(...)`.
 */
export interface StudentRow {
  id: string;
  registration_number: string;
  full_name: string;
  full_name_bn: string | null;
  blood_group: string | null;
  photo_key: string | null;
  roll_number: number;
  class_section_id: string;
  date_of_birth: string | null;
  gender: string | null;
  home_address: string | null;
  religion: string | null;
  birth_reg_no: string | null;
  card_no: string | null;
  health_notes: string | null;
  father_name: string | null;
  mother_name: string | null;
  preferred_communication: CommunicationMedium;
  enrollment_status: EnrollmentStatus;
  guardian_ids: string[];
  user_id: string | null;
  // Referenced tabs' own natural-key text, kept beside the resolved ids so
  // `keyOf` builds the same string for a row as for an entity.
  class_key: string;
  academic_year_key: string;
  section_key: string;
  guardian_keys: string[];
  user_key: string | null;
}

const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: { en: 'ID', bn: 'আইডি' } },
  {
    key: 'registration_number',
    type: 'string',
    required: true,
    label: { en: 'Registration number', bn: 'রেজিস্ট্রেশন নম্বর' },
  },
  {
    key: 'full_name',
    type: 'string',
    required: true,
    label: { en: 'Full name', bn: 'পূর্ণ নাম' },
  },
  {
    // The column is NOT NULL on the entity.
    key: 'roll_number',
    type: 'int',
    required: true,
    label: { en: 'Roll number', bn: 'রোল নম্বর' },
  },
  {
    key: 'class',
    type: 'ref',
    ref: 'classes',
    required: true,
    label: { en: 'Class', bn: 'শ্রেণী' },
  },
  {
    key: 'academic_year',
    type: 'ref',
    ref: 'academic_years',
    required: true,
    label: { en: 'Academic year', bn: 'শিক্ষাবর্ষ' },
  },
  {
    key: 'section',
    type: 'ref',
    ref: 'sections',
    required: true,
    label: { en: 'Section', bn: 'শাখা' },
  },
  {
    key: 'full_name_bn',
    type: 'string',
    label: { en: 'Full name (Bangla)', bn: 'পূর্ণ নাম (বাংলা)' },
  },
  {
    key: 'blood_group',
    type: 'enum',
    enumValues: BLOOD_GROUPS,
    label: { en: 'Blood group', bn: 'রক্তের গ্রুপ' },
  },
  {
    // Metadata only, like staff_documents' storage_key: the object it names
    // in StorageService is not carried by the workbook.
    key: 'photo_key',
    type: 'string',
    label: { en: 'Photo key', bn: 'ছবির কী' },
  },
  {
    key: 'date_of_birth',
    type: 'date',
    label: { en: 'Date of birth', bn: 'জন্ম তারিখ' },
  },
  {
    // A plain varchar(10), not an enum: no `Gender` enum exists in `shared/`.
    key: 'gender',
    type: 'string',
    label: { en: 'Gender', bn: 'লিঙ্গ' },
  },
  {
    key: 'home_address',
    type: 'string',
    label: { en: 'Home address', bn: 'বাসার ঠিকানা' },
  },
  {
    key: 'religion',
    type: 'string',
    label: { en: 'Religion', bn: 'ধর্ম' },
  },
  {
    key: 'birth_reg_no',
    type: 'string',
    label: { en: 'Birth registration no.', bn: 'জন্মনিবন্ধন নম্বর' },
  },
  {
    key: 'card_no',
    type: 'string',
    label: { en: 'Card number', bn: 'কার্ড নম্বর' },
  },
  {
    key: 'health_notes',
    type: 'string',
    label: { en: 'Health notes', bn: 'স্বাস্থ্য সংক্রান্ত তথ্য' },
  },
  {
    key: 'father_name',
    type: 'string',
    label: { en: "Father's name", bn: 'পিতার নাম' },
  },
  {
    key: 'mother_name',
    type: 'string',
    label: { en: "Mother's name", bn: 'মাতার নাম' },
  },
  {
    // Not `required`: an empty cell defaults to the entity's own default
    // (`SMS`), handled explicitly in `fromRow` below.
    key: 'preferred_communication',
    type: 'enum',
    enumValues: Object.values(CommunicationMedium),
    label: { en: 'Preferred communication', bn: 'পছন্দের যোগাযোগ মাধ্যম' },
  },
  {
    // Not `required`; an empty cell defaults to `ACTIVE`.
    key: 'enrollment_status',
    type: 'enum',
    enumValues: Object.values(EnrollmentStatus),
    label: { en: 'Enrollment status', bn: 'ভর্তির অবস্থা' },
  },
  {
    // Misnamed: carries `guardiansTab.keyOf` output, which may be a phone,
    // an email, or a `full_name|relationship` pair. See the file docblock.
    key: 'guardian_phones',
    type: 'ref-list',
    ref: 'guardians',
    label: { en: 'Guardian phones', bn: 'অভিভাবকের ফোন' },
  },
  {
    // The portal login is optional, so this is not `required`.
    key: 'user',
    type: 'ref',
    ref: 'users',
    label: { en: 'User', bn: 'ব্যবহারকারী' },
  },
];

/**
 * `Student` columns deliberately left out of the workbook. The completeness
 * gate (`registry.completeness.spec.ts`) fails if a new `Student` column
 * appears in neither `columns` nor here.
 *
 * `guardians` gets no entry here: it is a relation (the `@JoinTable` lives
 * on `Student`), not a scalar column, so the completeness gate rejects
 * listing it. `class`/`academic_year` also get no entry — they are not
 * entity columns at all, they are derived (see the file doc comment above).
 */
const excluded: readonly string[] = [
  'user_id', // exported instead as the `user` ref column, keyed by the referenced tab's natural key
  'class_section_id', // exported instead as the `section` ref column, keyed by the referenced tab's natural key
];

const MAX_LENGTHS: Record<string, number> = {
  registration_number: 50,
  card_no: 64,
  full_name: 100,
  full_name_bn: 200,
  photo_key: 255,
  gender: 10,
};

/** A student as `load()` returns it: `user_key` is '' when the login's owner has left. */
type LoadedStudent = Student & { user_key?: string };

/**
 * The login a row leaves on the student. A blank cell keeps the stored login when
 * its owner has left (the export could not name them) and clears it otherwise.
 */
function keptUserId(row: StudentRow, existing: Student | null | undefined): string | null {
  if (row.user_id) return row.user_id;
  const departed = existing?.user_id && (existing as LoadedStudent).user_key === '';
  return departed ? existing.user_id : null;
}

export const studentsTab: TabSpec<Student, StudentRow> = {
  name: 'students',
  entity: Student,
  excluded,
  // Every `ref` target above must be listed here, or `assertRegistryValid`
  // throws at boot (`registry.ts`). `classes`/`academic_years` are needed
  // even though they are not entity columns, because the `class` and
  // `academic_year` columns still resolve against those tabs.
  dependsOn: ['sections', 'guardians', 'users', 'classes', 'academic_years'],
  columns,
  naturalKey: ['registration_number'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<Student[]> {
    // `class`/`academic_year` are derived from the section, not stored, so
    // `toRow` needs this full eager chain or it produces empty key
    // fragments. Default `find` excludes soft-deleted rows.
    const students = (await m.find(Student, {
      where: { tenant_id: tenantId },
      relations: [
        'user',
        'class_section',
        'class_section.class',
        'class_section.class.academic_year',
        'guardians',
      ],
    })) as LoadedStudent[];
    // '' = the login belongs to a member who has left (the export wrote a blank cell).
    const members = await memberKeysById(
      tenantId,
      students.flatMap((s) => (s.user_id ? [s.user_id] : [])),
      m,
    );
    for (const s of students) if (s.user_id) s.user_key = members.get(s.user_id) ?? '';
    return students;
  },

  toRow(entity: Student, ctx: ExportContext): Record<string, unknown> {
    const guardianKeys = (entity.guardians ?? [])
      .map((g) => ctx.keyOf('guardians', g.id))
      // Sorted so the exported cell is stable regardless of the order
      // Postgres returns join rows in — without this the same data would
      // export as a different cell on different runs.
      .sort();

    return {
      id: entity.id,
      registration_number: entity.registration_number,
      full_name: entity.full_name,
      full_name_bn: entity.full_name_bn,
      blood_group: entity.blood_group,
      photo_key: entity.photo_key,
      roll_number: entity.roll_number,
      section: ctx.keyOf('sections', entity.class_section_id),
      class: ctx.keyOf('classes', entity.class_section?.class_id ?? ''),
      academic_year: ctx.keyOf(
        'academic_years',
        entity.class_section?.class?.academic_year_id ?? '',
      ),
      date_of_birth: entity.date_of_birth,
      gender: entity.gender,
      home_address: entity.home_address,
      religion: entity.religion,
      birth_reg_no: entity.birth_reg_no,
      card_no: entity.card_no,
      health_notes: entity.health_notes,
      father_name: entity.father_name,
      mother_name: entity.mother_name,
      preferred_communication: entity.preferred_communication,
      enrollment_status: entity.enrollment_status,
      guardian_phones: guardianKeys,
      user: entity.user_id ? optionalKeyOf(ctx, 'users', entity.user_id) : null,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: StudentRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const values: Record<string, unknown> = {};

    for (const column of columns) {
      const raw = cells[column.key] ?? '';
      const result = fromCell(column, raw, 'students', rowNo);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }

      const limit = MAX_LENGTHS[column.key];
      if (limit !== undefined && typeof result.value === 'string' && result.value.length > limit) {
        errors.push({
          tab: 'students',
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

    const sectionKey = values.section as string;
    const sectionId = sectionKey ? ctx.ref('sections', sectionKey) : undefined;
    if (sectionKey && !sectionId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'section',
        message: `Column "section": no section with the key "${sectionKey}" was found.`,
        severity: 'error',
        value: sectionKey,
      });
    }

    // `class`/`academic_year` are advisory only — resolved for validation
    // (so a wrong value is caught as a `RowError`), but `section` is the
    // authoritative parent and no further cross-check against it is done
    // here (`teacher-assignments.tab.ts` makes the same call).
    const classKey = values.class as string;
    const classId = classKey ? ctx.ref('classes', classKey) : undefined;
    if (classKey && !classId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'class',
        message: `Column "class": no class named "${classKey}" was found.`,
        severity: 'error',
        value: classKey,
      });
    }

    const academicYearKey = values.academic_year as string;
    const academicYearId = academicYearKey ? ctx.ref('academic_years', academicYearKey) : undefined;
    if (academicYearKey && !academicYearId) {
      errors.push({
        tab: 'students',
        row: rowNo,
        column: 'academic_year',
        message: `Column "academic_year": no academic year named "${academicYearKey}" was found.`,
        severity: 'error',
        value: academicYearKey,
      });
    }

    const userKey = (values.user as string | null) ?? '';
    let userId: string | null = null;
    if (userKey) {
      const resolved = ctx.ref('users', userKey);
      if (!resolved) {
        errors.push({
          tab: 'students',
          row: rowNo,
          column: 'user',
          message: `Column "user": no user with the key "${userKey}" was found.`,
          severity: 'error',
          value: userKey,
        });
      } else {
        userId = resolved;
      }
    }

    const guardianKeys = (values.guardian_phones as string[]) ?? [];
    const guardianIdSet = new Set<string>();
    for (const key of guardianKeys) {
      const resolved = ctx.ref('guardians', key);
      if (!resolved) {
        errors.push({
          tab: 'students',
          row: rowNo,
          column: 'guardian_phones',
          message: `Column "guardian_phones": no guardian with the key "${key}" was found.`,
          severity: 'error',
          value: key,
        });
      } else {
        // De-duplicate: a cell listing the same guardian twice must not
        // produce two join rows.
        guardianIdSet.add(resolved);
      }
    }

    // A photo key outside this school's prefix must not survive a restore (see
    // storage-key-scope.ts): the student photo route streams by the stored key.
    // It must also sit in the `student-photo/` folder student-photo.service.ts uploads to.
    let photoKey = (values.photo_key as string | null) ?? null;
    let photoWarning: RowError | undefined;
    if (photoKey) {
      const owned = ownStorageKey(
        photoKey,
        ctx.tenantId,
        'students',
        rowNo,
        'photo_key',
        'student-photo',
      );
      if ('error' in owned) errors.push(owned.error);
      else {
        photoKey = owned.key;
        if (owned.warning) {
          photoWarning = {
            ...owned.warning,
            message:
              'This photo came from another school. Its file was not copied; upload it again.',
          };
        }
      }
    }

    if (errors.length > 0) return { errors };
    if (photoWarning) ctx.warn(photoWarning);

    return {
      row: {
        id: values.id as string,
        registration_number: values.registration_number as string,
        full_name: values.full_name as string,
        full_name_bn: (values.full_name_bn as string | null) ?? null,
        blood_group: (values.blood_group as string | null) ?? null,
        photo_key: photoKey,
        roll_number: values.roll_number as number,
        class_section_id: sectionId as string,
        date_of_birth: (values.date_of_birth as string | null) ?? null,
        gender: (values.gender as string | null) ?? null,
        home_address: (values.home_address as string | null) ?? null,
        religion: (values.religion as string | null) ?? null,
        birth_reg_no: (values.birth_reg_no as string | null) ?? null,
        card_no: (values.card_no as string | null) ?? null,
        health_notes: (values.health_notes as string | null) ?? null,
        father_name: (values.father_name as string | null) ?? null,
        mother_name: (values.mother_name as string | null) ?? null,
        preferred_communication:
          (values.preferred_communication as CommunicationMedium | null) ?? CommunicationMedium.SMS,
        enrollment_status:
          (values.enrollment_status as EnrollmentStatus | null) ?? EnrollmentStatus.ACTIVE,
        guardian_ids: Array.from(guardianIdSet),
        user_id: userId,
        class_key: classKey,
        academic_year_key: academicYearKey,
        section_key: sectionKey,
        guardian_keys: guardianKeys,
        user_key: userKey || null,
      },
    };
  },

  // `registration_number` is a real column on both a row and an entity,
  // unique per tenant (since #728) — every row this diffs against comes
  // from the same tenant's own workbook, so no fallback chain is needed
  // here the way `guardians.tab.ts` needs one.
  keyOf(x: StudentRow | Student): string {
    return x.registration_number.trim();
  },

  diffFields(row: StudentRow, existing: Student): string[] {
    const changed: string[] = [];
    const fields = [
      'registration_number',
      'full_name',
      'full_name_bn',
      'blood_group',
      'photo_key',
      'roll_number',
      'gender',
      'home_address',
      'religion',
      'birth_reg_no',
      'card_no',
      'health_notes',
      'father_name',
      'mother_name',
      'preferred_communication',
      'enrollment_status',
    ] as const;
    for (const key of fields) {
      if (row[key] !== existing[key]) changed.push(key);
    }
    if (keptUserId(row, existing) !== existing.user_id) changed.push('user_id');
    if (row.class_section_id !== existing.class_section_id) changed.push('section');
    if (row.date_of_birth !== formatNullableDateOnly(existing.date_of_birth))
      changed.push('date_of_birth');

    const rowGuardianKey = [...row.guardian_ids].sort().join(';');
    const existingGuardianKey = (existing.guardians ?? [])
      .map((g) => g.id)
      .sort()
      .join(';');
    if (rowGuardianKey !== existingGuardianKey) changed.push('guardian_phones');

    return changed;
  },

  async upsert(
    row: StudentRow,
    existing: Student | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<Student> {
    // `registration_number` is unique PER TENANT (`IDX_students_tenant_id_
    // registration_number`, since #728) — two different tenants legitimately
    // compute the same value (each school's own first-ever student in a
    // year is `REG-<year>-0001`; see `StudentService.create`), so the
    // lookup below is scoped to `tenantId`. `withDeleted: true` is still
    // required, or a soft-deleted student blocking the same registration
    // number *within this tenant* would surface as a bare `23505` instead
    // of being revived.
    let student = existing;
    if (!student) {
      student = await m.findOne(Student, {
        where: { registration_number: row.registration_number, tenant_id: tenantId },
        withDeleted: true,
      });
      // Not from `load()`, so name the login's owner here (else a departed login reads as current).
      if (student?.user_id) {
        const members = await memberKeysById(tenantId, [student.user_id], m);
        (student as LoadedStudent).user_key = members.get(student.user_id) ?? '';
      }
    }

    // A blank cell keeps a departed member's login and clears a current one (D12).
    const userId = keptUserId(row, student);

    // `students (tenant_id, user_id)` is unique per school among LIVE rows
    // (D11, partial on `deleted_at`), so look the holder up in THIS tenant
    // only, live row first — same as `Guardian.user_id` (`guardians.tab.ts`).
    // Reviving a soft-deleted twin beside a live one would hit 23505 and
    // abort the restore. The same user may hold a student row in another school.
    // A soft-deleted match (by registration number) is checked too: it may
    // carry this user while a live twin already does.
    if (userId && (!student || student.user_id !== userId || student.deleted_at !== null)) {
      const where = { user_id: userId, tenant_id: tenantId };
      const live = await m.findOne(Student, { where });
      if (live && student && live.id !== student.id) {
        throw new Error(
          `Student with user "${row.user_key ?? userId}" already belongs to a different ` +
            `student record and cannot be reassigned by a restore.`,
        );
      }
      student ??= live ?? (await m.findOne(Student, { where, withDeleted: true }));
    }

    // [13.2.3] A row takes a NEW seat when it ends up ACTIVE and the student was not already an
    // active, live one (brand new, revived from soft delete, or re-activated). Checked on the
    // restore transaction `m` — which sees this restore's earlier rows — so the running total is
    // the post-restore total and a throw rolls the whole tab back (no partial write).
    // ponytail: counts before `deleteByAbsence` removals run, so a restore that swaps students at
    // a full school can be refused conservatively; exact net count needs the processor (outside
    // this lane).
    const takesNewSeat =
      row.enrollment_status === EnrollmentStatus.ACTIVE &&
      (!student ||
        student.deleted_at !== null ||
        student.enrollment_status !== EnrollmentStatus.ACTIVE);
    if (takesNewSeat) await takeSeat(m, tenantId);

    if (student) {
      student.deleted_at = null;
    } else {
      student = new Student();
    }

    student.tenant_id = tenantId;
    student.registration_number = row.registration_number;
    student.full_name = row.full_name;
    student.full_name_bn = row.full_name_bn;
    student.blood_group = row.blood_group;
    student.photo_key = row.photo_key;
    // `roll_number` is unique per `class_section_id`
    // (`IDX_ca01941430b7d99b013e6c6948`, migrations/1784175065078-InitialSchema.ts:61).
    // This tab deliberately does NOT pre-check it: the restore executor (14.10.2)
    // maps a `23505` on that index to a per-row error. Do not add a lookup here.
    student.roll_number = row.roll_number;
    student.class_section_id = row.class_section_id;
    student.date_of_birth = row.date_of_birth ? new Date(row.date_of_birth) : null;
    student.gender = row.gender;
    student.home_address = row.home_address;
    student.religion = row.religion;
    student.birth_reg_no = row.birth_reg_no;
    student.card_no = row.card_no;
    student.health_notes = row.health_notes;
    student.father_name = row.father_name;
    student.mother_name = row.mother_name;
    student.preferred_communication = row.preferred_communication;
    student.enrollment_status = row.enrollment_status;
    student.user_id = userId;
    // A loaded `user` relation would win over a null FK on save, so drop it too.
    if (userId === null) student.user = null;
    // `guardians` is deliberately never assigned here (C7): `Student.guardians`
    // has `cascade: ['insert']`, and assigning it before `m.save` risks
    // TypeORM inserting a duplicate `Guardian` row. The join table is
    // reconciled explicitly below instead.

    const saved = await m.save(Student, student);

    const currentLinks = await m
      .createQueryBuilder()
      .relation(Student, 'guardians')
      .of(saved)
      .loadMany<Guardian>();
    const currentIds = new Set(currentLinks.map((g) => g.id));
    const desiredIds = new Set(row.guardian_ids);

    const toAdd = row.guardian_ids.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

    if (toAdd.length > 0 || toRemove.length > 0) {
      await m
        .createQueryBuilder()
        .relation(Student, 'guardians')
        .of(saved)
        .addAndRemove(toAdd, toRemove);
    }

    // [#1020] Keep `Enrollment` in sync with the restored `Student` row —
    // same reasoning as `StudentService.update()`: exam cohort resolution
    // reads `Enrollment`, not `Student.class_section_id`. The section is
    // the authoritative parent (see the class docstring above), so its own
    // `class_id`/`academic_year_id` are read off it rather than
    // re-resolving `row.class_key`/`row.academic_year_key`. Runs on the
    // same `m` the rest of `upsert` used, so it shares the restore
    // executor's transaction.
    // Only an ACTIVE student should be in an ACTIVE Enrollment — a restored
    // row for a GRADUATED/TRANSFERRED/INACTIVE student must not be synced
    // into (or create) an ACTIVE Enrollment, or they'd reappear in exam
    // cohorts.
    const section =
      saved.class_section_id && saved.enrollment_status === EnrollmentStatus.ACTIVE
        ? await m.findOne(ClassSection, {
            where: { id: saved.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
            relations: ['class'],
          })
        : null;
    if (section) {
      // Keyed on the section's own academic year, not "whichever ACTIVE
      // row is newest" — a restore that changes a student's year must
      // update that year's enrollment, not repoint an unrelated one.
      const currentEnrollment = await m.findOne(Enrollment, {
        where: {
          student_id: saved.id,
          tenant_id: tenantId,
          academic_year_id: section.class.academic_year_id,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      if (currentEnrollment) {
        await m.update(
          Enrollment,
          { id: currentEnrollment.id },
          { class_id: section.class_id, section_id: section.id },
        );
      } else {
        await m.save(
          Enrollment,
          m.create(Enrollment, {
            student_id: saved.id,
            class_id: section.class_id,
            section_id: section.id,
            academic_year_id: section.class.academic_year_id,
            tenant_id: tenantId,
          }),
        );
      }
    }

    return saved;
  },

  async remove(entity: Student, m: EntityManager): Promise<void> {
    // Soft delete: link rows are left intact so a revive restores them.
    await m.softRemove(Student, entity);
  },

  // Same money refusal as StudentService.remove (STUDENT_HAS_OPEN_MONEY).
  async checkRemove(absent: Student[], tenantId: string, m: EntityManager): Promise<string[]> {
    const owing = await studentsWithOpenMoney(
      m,
      tenantId,
      absent.map((s) => s.id),
    );
    const taka = (n: number) =>
      `৳${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return owing.map((s) => {
      const money = [
        s.open_dues > 0 ? `open dues of ${taka(s.open_dues)}` : null,
        s.wallet_balance !== 0 ? `wallet money of ${taka(s.wallet_balance)}` : null,
      ]
        .filter(Boolean)
        .join(' and ');
      return `Student "${s.full_name}" (${s.registration_number}) is not in this file, so the restore would delete them, but they still have ${money}. Add the student back to the file, or clear the money in the app first.`;
    });
  },
};

/**
 * Running seat total per restore transaction: lock + count once on the first new seat, then count
 * up in memory (the School lock is held until commit, so nobody else can add). Outside a real
 * transaction there is no such lock, so every call re-checks.
 */
const seatTotals = new WeakMap<EntityManager, SeatUsage>();

async function takeSeat(m: EntityManager, tenantId: string): Promise<void> {
  if (!m.queryRunner?.isTransactionActive) return assertSeatsAvailable(m, tenantId, 1);
  let total = seatTotals.get(m);
  if (!total) {
    total = await lockSeatUsage(m, tenantId);
    seatTotals.set(m, total);
  }
  if (total.limit !== null && total.used + 1 > total.limit) {
    throw seatLimitError(total.used, total.limit, 1);
  }
  total.used += 1;
}

/** `date_of_birth` is nullable;`formatDateOnly` itself rejects null. */
function formatNullableDateOnly(value: Date | string | null): string | null {
  return value === null || value === undefined ? null : formatDateOnly(value);
}
