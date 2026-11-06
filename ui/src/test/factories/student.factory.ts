import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { classSectionFactory } from './class-section.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { guardianFactory } from './guardian.factory';
import { schoolFactory } from './school.factory';
import { scriptedAddress, scriptedFullName, type Script } from './script';
import { userFactory } from './user.factory';

export type Student = components['schemas']['Student'];

// Default one guardian, built with `students: []` — see guardian.factory.ts's
// own comment on why the back-reference stays empty by default.
export function studentFactory(overrides: Partial<Student> = {}, script?: Script): Student {
  const classSection = overrides.class_section ?? classSectionFactory();
  const tenant = overrides.tenant ?? classSection.tenant ?? schoolFactory();
  const user = overrides.user === undefined ? userFactory({}, { script }) : overrides.user;
  return {
    id: faker.string.uuid(),
    user,
    user_id: user?.id ?? null,
    full_name: scriptedFullName(script),
    // Epic 32 columns; null until a photo / Bangla name / blood group is set.
    full_name_bn: null,
    photo_key: null,
    blood_group: null,
    registration_number: faker.string.numeric(8),
    roll_number: faker.number.int({ min: 1, max: 60 }),
    class_section: classSection,
    class_section_id: classSection.id,
    date_of_birth: faker.date
      .birthdate({ min: 5, max: 18, mode: 'age', refDate: FACTORY_REFERENCE_DATE })
      .toISOString(),
    gender: faker.helpers.arrayElement(['male', 'female']),
    home_address: scriptedAddress(script),
    preferred_communication: CommunicationMedium.SMS,
    guardians: [guardianFactory({ tenant }, script)],
    enrollment_status: EnrollmentStatus.ACTIVE,
    religion: null,
    birth_reg_no: null,
    card_no: null,
    health_notes: null,
    father_name: null,
    mother_name: null,
    tenant,
    tenant_id: tenant.id,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
