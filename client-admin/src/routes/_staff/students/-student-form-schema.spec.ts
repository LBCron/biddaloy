import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCreatePayload,
  buildStudentFormSchema,
  buildUpdatePayload,
  defaultStudentFormValues,
} from './-student-form-schema';

const messages = {
  fullNameRequired: 'Full name is required.',
  classSectionRequired: 'Select a class and section.',
  rollNumberInvalid: 'Roll number must be a positive whole number.',
  fullNameBnTooLong: 'The Bangla name must be 200 characters or fewer.',
  bloodGroupInvalid: 'Choose a blood group from the list.',
  cardNoInvalid: 'Use letters, digits and hyphens only.',
};

describe('buildStudentFormSchema: roll_number', () => {
  const schema = buildStudentFormSchema(messages);
  const validBaseValues = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
  };

  it('rejects "0" — not a positive whole number', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '0' });
    expect(result.success).toBe(false);
  });

  it('accepts a positive whole number', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '7' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (optional)', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '' });
    expect(result.success).toBe(true);
  });
});

describe('buildStudentFormSchema: Bangla name and blood group (Epic 32)', () => {
  const schema = buildStudentFormSchema(messages);
  const valid = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
  };

  it('rejects a blood group that is not one of the 8', () => {
    expect(schema.safeParse({ ...valid, blood_group: 'C+' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, blood_group: 'a+' }).success).toBe(false); // case matters
  });

  it('accepts each real blood group and "Not set"', () => {
    for (const group of ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', '']) {
      expect(schema.safeParse({ ...valid, blood_group: group }).success).toBe(true);
    }
  });

  it('allows an empty Bangla name, but not one over 200 characters', () => {
    expect(schema.safeParse({ ...valid, full_name_bn: '' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, full_name_bn: 'ক'.repeat(200) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, full_name_bn: 'ক'.repeat(201) }).success).toBe(false);
  });

  it('create leaves them out when empty; update sends null to clear them', () => {
    const empty = { ...valid, full_name_bn: '', blood_group: '' as const };
    const create = buildCreatePayload(empty);
    expect('full_name_bn' in create).toBe(false);
    expect('blood_group' in create).toBe(false);
    const update = buildUpdatePayload(empty, { ...valid, full_name_bn: 'রহিম', blood_group: 'O+' });
    expect(update.full_name_bn).toBeNull();
    expect(update.blood_group).toBeNull();
  });

  it('sends both when set', () => {
    const set = { ...valid, full_name_bn: '  রহিম উদ্দিন ', blood_group: 'O+' as const };
    expect(buildCreatePayload(set)).toMatchObject({
      full_name_bn: 'রহিম উদ্দিন',
      blood_group: 'O+',
    });
    expect(buildUpdatePayload(set, valid)).toMatchObject({
      full_name_bn: 'রহিম উদ্দিন',
      blood_group: 'O+',
    });
  });
});

describe('buildCreatePayload: date_of_birth serialization', () => {
  // Bangladesh is UTC+6 — the app's only region — so `toISOString()`
  // (which converts to UTC first) is exactly the case this regression
  // test needs to force, regardless of the machine running it.
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Asia/Dhaka';
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('serializes the local calendar date, not the UTC-shifted one', () => {
    const values = {
      ...defaultStudentFormValues(),
      full_name: 'Rahim Uddin',
      class_section_id: 'section-1',
      date_of_birth: new Date(2024, 0, 15), // local midnight, 15 Jan 2024
    };

    const payload = buildCreatePayload(values);

    expect(payload.date_of_birth).toBe('2024-01-15');
  });
});

describe('buildCreatePayload vs buildUpdatePayload: clearing an optional field', () => {
  const clearedValues = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
    gender: '',
    home_address: '',
    date_of_birth: undefined,
  };

  it('create omits an empty optional field — nothing to clear on a student that does not exist yet', () => {
    const payload = buildCreatePayload(clearedValues);

    expect('gender' in payload).toBe(false);
    expect('home_address' in payload).toBe(false);
    expect('date_of_birth' in payload).toBe(false);
  });

  const populated = {
    ...clearedValues,
    gender: 'Male',
    home_address: 'Old street',
    date_of_birth: new Date(2024, 0, 15),
  };

  it('update sends an explicit null — an absent key in a PATCH means "leave unchanged", not "clear"', () => {
    const payload = buildUpdatePayload(clearedValues, populated);

    expect(payload.gender).toBeNull();
    expect(payload.home_address).toBeNull();
    expect(payload.date_of_birth).toBeNull();
  });
});

describe('buildUpdatePayload: only changed keys [2603]', () => {
  const base = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
    guardian_ids: ['g1', 'g2'],
  };

  it('returns {} for identical values', () => {
    expect(buildUpdatePayload(base, base)).toEqual({});
  });

  it('returns only the changed key and omits unchanged guardian_ids', () => {
    expect(buildUpdatePayload({ ...base, full_name: 'Karim' }, base)).toEqual({
      full_name: 'Karim',
    });
  });

  it('sends nothing when guardians are only reordered', () => {
    expect(buildUpdatePayload({ ...base, guardian_ids: ['g2', 'g1'] }, base)).toEqual({});
  });

  it('sends guardian_ids when one is added', () => {
    expect(buildUpdatePayload({ ...base, guardian_ids: ['g1', 'g2', 'g3'] }, base)).toEqual({
      guardian_ids: ['g1', 'g2', 'g3'],
    });
  });

  it('sends null for a field cleared on purpose', () => {
    expect(
      buildUpdatePayload({ ...base, home_address: '' }, { ...base, home_address: 'Old street' }),
    ).toEqual({ home_address: null });
  });
});

describe('[76.5.07] card_no', () => {
  const schema = buildStudentFormSchema(messages);
  const valid = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
  };

  it('accepts letters, digits and hyphens, and empty', () => {
    for (const card_no of ['AB-12', '0004567', '']) {
      expect(schema.safeParse({ ...valid, card_no }).success).toBe(true);
    }
  });

  it('rejects other characters and more than 64', () => {
    for (const card_no of ['AB 12', 'ab_12', 'a'.repeat(65)]) {
      expect(schema.safeParse({ ...valid, card_no }).success).toBe(false);
    }
  });

  it('empty becomes absent on create and null on update', () => {
    expect(buildCreatePayload(valid)).not.toHaveProperty('card_no');
    expect(buildUpdatePayload({ ...valid, card_no: '' }, { ...valid, card_no: 'A1' })).toEqual({
      card_no: null,
    });
    expect(buildCreatePayload({ ...valid, card_no: ' A1 ' })).toMatchObject({ card_no: 'A1' });
  });
});
