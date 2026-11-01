import { TeacherDesignation } from '@biddaloy/shared';
import { http, HttpResponse } from 'msw';

import { classFactory, classSectionFactory, type Class, type ClassSection } from '../../factories';
import { apiErrorBody, paginate } from '../support';

/** [8.11.2] — `ClassSectionWithCount` (`hooks/classes.ts`) isn't a schema
 * type (see that file's own comment on why), so it's not worth a whole new
 * factory module for one extra field: `classSectionFactory` plus an
 * `enrolled_count` here is enough. */
function sectionWithCount(overrides: Partial<ClassSection> & { enrolled_count?: number } = {}) {
  const { enrolled_count = 0, ...sectionOverrides } = overrides;
  return { ...classSectionFactory(sectionOverrides), enrolled_count };
}

/** [8.11.2] — `ClassWithCounts` (`hooks/classes.ts`): `GET /classes`'s
 * per-class `section_count`/`student_count`, computed server-side so the
 * list page's Sections/Students columns don't each need their own
 * request. Only the *list* endpoint returns these — `getOne`/`create`/
 * `update` below stay plain `classFactory()`, matching
 * `ClassService.findOne`/`create`/`update` not computing them. */
function classWithCounts(
  overrides: Partial<Class> & { section_count?: number; student_count?: number } = {},
) {
  const { section_count = 0, student_count = 0, ...classOverrides } = overrides;
  return { ...classFactory(classOverrides), section_count, student_count };
}

/** [8.11.2] — `ClassTeacher` (`hooks/classes.ts`) fixture for the class
 * detail page's Teachers tab. Same "hand-typed, not schema-generated"
 * reasoning as `sectionWithCount` above. */
function classTeacherFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'teacher-1',
    employee_id: 'EMP-00001',
    full_name: 'Rahim Uddin',
    designations: [TeacherDesignation.CLASS_TEACHER],
    section_names: ['A'],
    ...overrides,
  };
}

const fixtures = [classWithCounts(), classWithCounts(), classWithCounts()];

const list = http.get('/api/v1/classes', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/classes', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const getOne = http.get('/api/v1/classes/:id', ({ params }) =>
  HttpResponse.json(classFactory({ id: params.id as string })),
);

const create = http.post('/api/v1/classes', () =>
  HttpResponse.json(classFactory(), { status: 201 }),
);

const update = http.patch('/api/v1/classes/:id', ({ params }) =>
  HttpResponse.json(classFactory({ id: params.id as string })),
);

const remove = http.delete('/api/v1/classes/:id', () => new HttpResponse(null, { status: 204 }));

/** Delete-blocked (409) variant — server names the enrolled-student count
 * in the message body, and the delete-blocked dialog reads it verbatim
 * rather than showing a generic failure toast (the AC's "explanation
 * why"). Mirrors `classes.service.ts`'s real `ConflictException` message
 * shape (Nest wraps a thrown string message as `{ statusCode, message }`). */
const removeBlocked = http.delete('/api/v1/classes/:id', ({ params }) =>
  HttpResponse.json(
    apiErrorBody(
      409,
      `Cannot delete class "${params.id as string}": 3 student(s) are still enrolled in it. Move or unenroll them first.`,
      `/api/v1/classes/${params.id as string}`,
    ),
    { status: 409 },
  ),
);

const sectionFixtures = [
  sectionWithCount({ enrolled_count: 12 }),
  sectionWithCount({ enrolled_count: 0 }),
];

const listSections = http.get('/api/v1/classes/:classId/sections', ({ params }) =>
  HttpResponse.json(
    sectionFixtures.map((section) => ({
      ...section,
      class: { ...section.class, id: params.classId as string },
      class_id: params.classId as string,
    })),
  ),
);

const createSection = http.post('/api/v1/classes/:classId/sections', ({ params }) =>
  HttpResponse.json(sectionWithCount({ class_id: params.classId as string }), { status: 201 }),
);

const updateSection = http.patch('/api/v1/classes/:classId/sections/:sectionId', ({ params }) =>
  HttpResponse.json(
    sectionWithCount({ id: params.sectionId as string, class_id: params.classId as string }),
  ),
);

const removeSection = http.delete(
  '/api/v1/classes/:classId/sections/:sectionId',
  () => new HttpResponse(null, { status: 204 }),
);

/** Delete-blocked (409) variant for a section — same reasoning as
 * `removeBlocked` above, mirroring `SectionService.remove`'s message. */
const removeSectionBlocked = http.delete(
  '/api/v1/classes/:classId/sections/:sectionId',
  ({ params }) =>
    HttpResponse.json(
      apiErrorBody(
        409,
        `Cannot delete section "${params.sectionId as string}": 2 active student(s) are enrolled in it. Reassign or remove them first.`,
        `/api/v1/classes/${params.classId as string}/sections/${params.sectionId as string}`,
      ),
      { status: 409 },
    ),
);

const teachers = http.get('/api/v1/classes/:classId/teachers', () =>
  HttpResponse.json([classTeacherFixture()]),
);

const teachersEmpty = http.get('/api/v1/classes/:classId/teachers', () => HttpResponse.json([]));

/** [33.4.1] `GET /classes/vocabulary` — empty by default, matching D5's
 * "a single-shift school sees nothing new" default: no test that doesn't
 * explicitly opt into a populated vocabulary should see the shift/
 * version/group selects or filter chips appear. */
const vocabulary = http.get('/api/v1/classes/vocabulary', () =>
  HttpResponse.json({ shifts: [], versions: [], groups: [] }),
);

const vocabularyPopulated = http.get('/api/v1/classes/vocabulary', () =>
  HttpResponse.json({
    shifts: ['Morning', 'Day'],
    versions: ['Bangla', 'English'],
    groups: ['Science', 'Commerce'],
  }),
);

export const classHandlers = {
  list,
  listEmpty,
  getOne,
  create,
  update,
  remove,
  removeBlocked,
  listSections,
  createSection,
  updateSection,
  removeSection,
  removeSectionBlocked,
  teachers,
  teachersEmpty,
  vocabulary,
  vocabularyPopulated,
};

// [83.3.3] No coordinator rows by default; specs that need rows override it.
const listCoordinators = http.get('/api/v1/coordinators', () => HttpResponse.json([]));
// [83.4.1] A teacher who coordinates nothing: My coordination's empty state.
const coordinationOverview = http.get('/api/v1/coordination/overview', () =>
  HttpResponse.json({ date: '2026-10-20', classes: [] }),
);

export const classDefaultHandlers = [
  listCoordinators,
  coordinationOverview,
  list,
  getOne,
  create,
  update,
  remove,
  listSections,
  createSection,
  updateSection,
  removeSection,
  teachers,
  vocabulary,
];
