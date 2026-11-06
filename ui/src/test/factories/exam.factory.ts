import { ExamKind, ExamStatus } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { academicYearFactory } from './academic-year.factory';
import { classFactory } from './class.factory';
import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { schoolFactory } from './school.factory';

export type Exam = components['schemas']['Exam'];

export function examFactory(overrides: Partial<Exam> = {}): Exam {
  const academicYear = overrides.academic_year ?? academicYearFactory();
  const tenant = overrides.tenant ?? academicYear.tenant ?? schoolFactory();
  const klass = overrides.class ?? classFactory({ academic_year: academicYear, tenant });
  return {
    id: faker.string.uuid(),
    tenant,
    tenant_id: tenant.id,
    academic_year: academicYear,
    academic_year_id: academicYear.id,
    class: klass,
    class_id: klass.id,
    academic_term: null,
    academic_term_id: null,
    name: `${faker.helpers.arrayElement(['Half Yearly', 'Annual', 'Model Test'])} ${academicYear.name.slice(0, 4)}`,
    kind: ExamKind.TERM,
    status: ExamStatus.DRAFT,
    published_at: null,
    mark_entry_deadline: null,
    website_published_at: null,
    website_show_names: true,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
