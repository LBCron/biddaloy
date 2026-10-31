import type { APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createAcr,
  createClassSection,
  createExamTemplate,
  createGuardian,
  createOfferedSubject,
  createStudyPlan,
  createInvoice,
  createInvoiceShareToken,
  createReminderBatch,
  createStaffUser,
  createStudentWithDues,
  createSurvey,
  createTeacher,
  createTeacherForSection,
  currentAcademicYearId,
  findSchoolIdBySlug,
  findSeedSectionA,
  get,
  parentApiSession,
  post,
  seededFirstTermExamId,
  superAdminApiSession,
  type ApiSession,
} from '../api';
import { acrBody, surveyBody } from '../fixtures/evaluations';
import { test } from '../fixtures/test';

/**
 * [52.5.8] `count` distinct days on which a leave for `studentId` can be approved: school working
 * days as the calendar API reports them (so seeded public holidays and closures are never picked:
 * LEAVE_NO_WORKING_DAYS), minus every day an APPROVED leave of this student already covers (reruns
 * on one database pile those up: LEAVE_OVERLAP). Random, so parallel shards spread out.
 * `session` needs CALENDAR_READ and APPLICATION_MANAGE (the admin).
 *
 * Jan-Feb 2026 only: approving a leave writes that day's section register. A day after the newest
 * real register (a future day, or one after the seeded month, ATTENDANCE_SEED_MONTH = 2026-03)
 * would become the section's newest session and blank the My class streaks; Jan-Feb also holds no
 * seeded marks to overwrite. ponytail: about 20 working days per student per window (January
 * for staff specs, February for the portal), shared by every rerun on one database (CI starts
 * fresh); widen the window if local reruns run out.
 *
 * The call passes no class, so a closure for one class only still counts as working here while the
 * approve (which passes the class) skips it. The seed has no class-only closure; add `classId` if a
 * spec ever creates one.
 */
export async function freeLeaveDays(
  request: APIRequestContext,
  session: ApiSession,
  studentId: string,
  count = 1,
  // Staff specs take January, the portal journey February, so parallel specs filing for the same
  // seeded child never pick one day twice (an approved overlap is a 409 LEAVE_OVERLAP).
  window: { from: string; to: string } = { from: '2026-01-01', to: '2026-01-31' },
): Promise<string[]> {
  const { dates } = await get<{ dates: string[] }>(
    request,
    session,
    `/school-calendar/working-days?from=${window.from}&to=${window.to}`,
  );
  // ponytail: one page of 100 approved leaves; page through if a database ever holds more.
  const approved = await get<{ data: { start_date: string | null; end_date: string | null }[] }>(
    request,
    session,
    `/applications?view=all&type=STUDENT_LEAVE&status=APPROVED&student_id=${studentId}&limit=100`,
  );
  const free = dates.filter(
    (d) => !approved.data.some((a) => a.start_date! <= d && d <= a.end_date!),
  );
  const picked: string[] = [];
  while (picked.length < count && free.length > 0) {
    picked.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]!);
  }
  if (picked.length < count) throw new Error(`no ${count} free leave day(s) left for ${studentId}`);
  return picked;
}

/** Files a paper STUDENT_LEAVE (as the admin session) for `studentId` on a free day. */
export async function fileStudentLeave(
  request: APIRequestContext,
  session: ApiSession,
  studentId: string,
  day?: string,
): Promise<{ id: string; serial: string }> {
  day ??= (await freeLeaveDays(request, session, studentId))[0]!;
  return post<{ id: string; serial: string }>(request, session, '/applications', {
    type: 'STUDENT_LEAVE',
    subject_student_id: studentId,
    applicant_name: 'E2E অভিভাবক',
    payload: { reason_kind: 'SICK', start_date: day, end_date: day, details: 'E2E' },
  });
}

/** Makes sure the admin's inbox holds at least `count` rows the admin can decide; returns the first. */
export async function ensureDecidableApplications(
  request: APIRequestContext,
  session: ApiSession,
  count: number,
): Promise<string> {
  const decidable = async () =>
    (
      await get<{ data: { id: string; can: { decide: boolean } }[] }>(
        request,
        session,
        '/applications?view=inbox&limit=100',
      )
    ).data.filter((a) => a.can.decide);
  let rows = await decidable();
  if (rows.length < count) {
    const all = await get<{ data: { subject_student_id: string | null }[] }>(
      request,
      session,
      '/applications?view=all',
    );
    const studentId = all.data.find((a) => a.subject_student_id)?.subject_student_id;
    if (!studentId) throw new Error('no student application seeded (seed.applications.ts)');
    for (let i = rows.length; i < count; i += 1) {
      await fileStudentLeave(request, session, studentId);
    }
    rows = await decidable();
  }
  const first = rows[0];
  if (!first) throw new Error('admin has no decidable application');
  return first.id;
}
import manifest from '../route-manifest.json';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, SEED_TRIAL_SCHOOL } from '../seed-contract';

/** Shared manifest typing + param resolution for the responsive suites
 * (same resolution strategy as the a11y suite). */

export interface ManifestRoute {
  path: string;
  role: string;
  archetype: string;
  params?: Record<string, string>;
  overlays?: string[];
}

export const routes = (manifest as { routes: ManifestRoute[] }).routes;

// One admin login per worker process, not one per dynamic route resolved —
// every call in this file needs the same ADMIN session, and re-logging in
// for each of the manifest's several dynamic routes was pointless load on
// the auth endpoint.
let sharedSessionPromise: Promise<ApiSession> | null = null;

function sharedAdminSession(request: APIRequestContext): Promise<ApiSession> {
  sharedSessionPromise ??= adminApiSession(request);
  return sharedSessionPromise;
}

// [66.2] One plan per worker, not per viewport/theme run: each run would otherwise leave another
// subject on seeded Class 6 section A (portal syllabus, and the wizard lists only 100 subjects).
let studyPlanIdPromise: Promise<string> | null = null;
function sharedStudyPlanId(
  request: APIRequestContext,
  session: ApiSession,
  stamp: number,
): Promise<string> {
  studyPlanIdPromise ??= (async () => {
    const seed = await findSeedSectionA(request, session);
    const subject = await createOfferedSubject(request, session, seed, `Reflow Plan ${stamp}`);
    const plan = await createStudyPlan(request, session, {
      section_id: seed.sectionId,
      subject_id: subject.id,
      academic_term_id: null,
      lessons: [1, 2, 3].map((n) => ({ title: `Reflow Lesson ${n}`, periods: 1 })),
    });
    return plan.id;
  })();
  return studyPlanIdPromise;
}

export async function resolvePath(
  request: APIRequestContext,
  route: ManifestRoute,
): Promise<string> {
  if (route.path === '/portal/applications/new') {
    // [52.6.4] Without ?student= a parent with several children is sent back to
    // the list, so the sweep would scan the list, not the form.
    const parent = await parentApiSession(request);
    const mine = await get<{ data: { subject_student_id: string | null }[] }>(
      request,
      parent,
      '/applications?view=mine&limit=100',
    );
    const child = mine.data.find((a) => a.subject_student_id)?.subject_student_id;
    if (!child)
      throw new Error('no student application seeded for the parent (seed.applications.ts)');
    return `${route.path}?student=${child}`;
  }
  if (!route.path.includes('$')) return route.path;
  if (route.path.includes('$schoolId')) {
    // SUPER_ADMIN platform console (#535) — `GET /schools` is SUPER_ADMIN
    // only, so this can't ride the shared ADMIN session. Resolves the
    // seeded school (`SEED_TRIAL_SCHOOL`; its page carries the Seats card
    // and its "Grant seats" dialog) rather than
    // provisioning a fresh one per viewport/theme run. Read-only here.
    const superAdmin = await superAdminApiSession(request);
    const schoolId = await findSchoolIdBySlug(request, superAdmin, SEED_TRIAL_SCHOOL.slug);
    return route.path.replace('$schoolId', schoolId);
  }
  if (route.path.startsWith('/my-class/')) {
    // [47.4.4] The page is a 404 for any section the caller is not a class
    // teacher of, so a fresh admin-made section would not do: use the seeded
    // class teacher's own first section.
    const password = process.env[SEED_PASSWORD_ENV];
    if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
    const login = await request.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS.teacher, password },
    });
    if (!login.ok()) throw new Error(`teacher login failed: ${login.status()}`);
    const body = (await login.json()) as {
      access_token: string;
      memberships: { tenantId: string; role: string }[];
    };
    const tenantId = body.memberships.find((m) => m.role === 'TEACHER')?.tenantId;
    if (!tenantId) throw new Error('no TEACHER membership for seed teacher');
    const sections = await request.get('/api/v1/my-class/sections', {
      headers: { Authorization: `Bearer ${body.access_token}`, 'X-Tenant-ID': tenantId },
    });
    if (!sections.ok()) throw new Error(`GET /my-class/sections failed: ${sections.status()}`);
    const first = ((await sections.json()) as { section_id: string }[])[0];
    if (!first) throw new Error('seed teacher has no homeroom section');
    return route.path.replace('$sectionId', first.section_id);
  }
  const session: ApiSession = await sharedAdminSession(request);
  const stamp = Date.now();
  if (route.path === '/exams/$examId') {
    // [48.4.03] The Print tab overlay needs a real exam with a schedule and a published seat
    // plan: the demo school's seeded "First Term Exam" (`ensureSeatPlanDemoSeed`).
    return route.path.replace('$examId', await seededFirstTermExamId(request, session));
  }
  if (route.path.startsWith('/exams/templates/')) {
    // [35.5.3] Must precede the print-template branch below: an exam-template
    // detail needs an EXAM template id, not a print-template one.
    const template = await createExamTemplate(request, session, `Reflow Exam Template ${stamp}`);
    return route.path.replace('$templateId', template.id);
  }
  if (route.path.includes('$templateId')) {
    // [32.4.1] The full-screen template editor needs a real template to open.
    const template = await post<{ id: string }>(request, session, '/print-templates', {
      name: `Reflow Template ${stamp}`,
      suggestion_key: 'student-portrait-classic',
    });
    return route.path.replace('$templateId', template.id);
  }
  if (route.path.includes('$studentId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Student ${stamp}`);
    return route.path.replace('$studentId', studentId);
  }
  if (route.path.includes('$guardianId')) {
    const guardian = await createGuardian(request, session, `Reflow Guardian ${stamp}`);
    return route.path.replace('$guardianId', guardian.id);
  }
  if (route.path.includes('$assessmentId')) {
    // [28.3.7] `/staff/$userId/acr/$assessmentId` 404s without a real ACR: start
    // one (INCOMPLETE, on the latest form) for a fresh teacher. Admin is the
    // assessor, not the subject, so the subject-404 rule does not apply.
    const teacher = await createTeacher(request, session, `Reflow ACR ${stamp}`);
    const yearId = await currentAcademicYearId(request, session);
    const acr = await createAcr(request, session, acrBody(teacher.userId, yearId));
    return route.path.replace('$userId', teacher.userId).replace('$assessmentId', acr.id);
  }
  if (route.path.includes('$surveyId')) {
    // [28.4] `/staff/evaluations/surveys/$surveyId` 404s without a real survey:
    // a DRAFT whose target is a real (teacher, subject) assignment.
    const chain = await createClassSection(request, session);
    const teacher = await createTeacherForSection(
      request,
      session,
      `Reflow Survey Teacher ${stamp}`,
      chain,
    );
    const subject = await post<{ id: string }>(request, session, '/subjects', {
      code: `RF-${stamp.toString(36).toUpperCase()}`,
      name_en: 'Reflow Survey Subject',
    });
    await post(request, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
      teacher_id: teacher.teacherId,
      subject_id: subject.id,
    });
    const survey = await createSurvey(
      request,
      session,
      surveyBody(`Reflow survey ${stamp}`, teacher.teacherId, subject.id),
    );
    return route.path.replace('$surveyId', survey.id);
  }
  if (route.path.includes('$userId')) {
    const staffUser = await createStaffUser(request, session, `Reflow Staff ${stamp}`);
    return route.path.replace('$userId', staffUser.id);
  }
  if (route.path.includes('$batchId')) {
    const batch = await createReminderBatch(request, session, `Reflow Batch ${stamp}`);
    return route.path.replace('$batchId', batch.id);
  }
  if (route.path.includes('$invoiceId')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Invoicee ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    return route.path.replace('$invoiceId', invoice.id);
  }
  if (route.path.includes('$token')) {
    // [16.5.3] `/i/$token` — the unauthenticated public receipt route.
    const { studentId } = await createStudentWithDues(request, session, `Reflow Receipt ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    const token = await createInvoiceShareToken(request, session, invoice.id);
    return route.path.replace('$token', token);
  }
  if (route.path.includes('$academicYearId') || route.path.includes('$classId')) {
    const chain = await createClassSection(request, session);
    return route.path
      .replace('$academicYearId', chain.academicYearId)
      .replace('$classId', chain.classId);
  }
  if (route.path.includes('$sectionId')) {
    // [9.6] No mapped teacher for this section — the admin session used
    // throughout this file has `ATTENDANCE_READ`, so the register still
    // renders (just with an empty/unmarked roster), which is all the
    // responsive-layout check below needs.
    const chain = await createClassSection(request, session);
    const path = route.path.replace('$sectionId', chain.sectionId);
    // [21.8.1] `/routines/$sectionId` also needs `?classId=` — the route
    // has no other way to find the section's class (see `$sectionId.tsx`'s
    // own doc comment) and renders `noClassIdExplanation` without it. The
    // manifest itself can't carry query params, so it's added here instead.
    return path.startsWith('/routines/') ? `${path}?classId=${chain.classId}` : path;
  }
  if (route.path.startsWith('/admission/')) {
    // Public, unauthenticated intake form of the seeded school.
    return route.path.replace('$slug', 'default-school');
  }
  if (route.path.includes('$setId')) {
    // Platform holiday sets come from an external fetch; render one only if
    // the seed (or an earlier run) already left one behind.
    const superAdmin = await superAdminApiSession(request);
    const sets = await get<{ id: string }[]>(request, superAdmin, '/platform/holiday-sets');
    if (!sets[0]) test.skip(true, 'no holiday set seeded: needs the external public-holiday fetch');
    return route.path.replace('$setId', sets[0]!.id);
  }
  if (route.path.includes('$scaleId')) {
    const scales = await get<{ id: string }[]>(request, session, '/grading/scales');
    return route.path.replace('$scaleId', scales[0]!.id);
  }
  if (route.path.includes('$programId')) {
    const programs = await get<{ id: string }[]>(request, session, '/programs');
    return route.path.replace('$programId', programs[0]!.id);
  }
  if (route.path.includes('study-plans/$planId')) {
    // [66.2] Must precede the seat-plan branch below (also `$planId`). A plan lives in the CURRENT
    // academic year's class (a fresh `createClassSection` year is not current, and the plan page's
    // routine and term lookups need the real one): a fresh subject on the seeded Class 6 section A.
    return route.path.replace('$planId', await sharedStudyPlanId(request, session, stamp));
  }
  if (route.path.includes('$planId')) {
    const plans = await get<{ id: string }[]>(request, session, '/seat-plans');
    if (!plans[0]) test.skip(true, 'no seat plan seeded: building one needs a scheduled exam');
    return route.path.replace('$planId', plans[0]!.id);
  }
  if (route.path.includes('$runId')) {
    const runs = await get<{ id: string }[]>(request, session, '/promotions');
    if (!runs[0]) test.skip(true, 'no promotion run seeded: needs published exam results');
    return route.path.replace('$runId', runs[0]!.id);
  }
  if (route.path.includes('$examId')) {
    const chain = await createClassSection(request, session);
    const exam = await post<{ id: string }>(request, session, '/exams', {
      name: `Reflow Exam ${stamp}`,
      kind: 'TERM',
      academic_year_id: chain.academicYearId,
      class_id: chain.classId,
    });
    return route.path.replace('$examId', exam.id);
  }
  if (route.path.includes('$homeworkId')) {
    const chain = await createClassSection(request, session);
    const subject = await post<{ id: string }>(request, session, '/subjects', {
      code: `RH-${stamp.toString(36).toUpperCase()}`,
      name_en: 'Reflow Homework Subject',
    });
    const homework = await post<{ id: string }>(request, session, '/homework', {
      subject_id: subject.id,
      class_id: chain.classId,
      title: `Reflow Homework ${stamp}`,
      grading_mode: 'TICK',
    });
    return route.path.replace('$homeworkId', homework.id);
  }
  if (route.path.includes('$intakeId') || route.path.includes('$applicantId')) {
    const chain = await createClassSection(request, session);
    const intake = await post<{ id: string }>(request, session, '/admission-intakes', {
      title: `Reflow Intake ${stamp}`,
      class_section_id: chain.sectionId,
      seat_count: 10,
      open_date: '2020-01-01',
      close_date: '2099-12-31',
      required_document_types: [],
    });
    if (route.path.includes('$intakeId')) return route.path.replace('$intakeId', intake.id);
    const response = await request.post('/api/v1/public/admission/default-school/applicants', {
      multipart: {
        intake_id: intake.id,
        applicant_name: `Reflow Applicant ${stamp}`,
        date_of_birth: '2018-06-01',
        gender: 'MALE',
        guardian_name: `Reflow Guardian ${stamp}`,
        guardian_phone: `01${3 + (stamp % 7)}${stamp.toString().slice(-8)}`,
        captcha_token: 'no-captcha',
      },
    });
    if (!response.ok()) throw new Error(`applicant submit failed: ${response.status()}`);
    const listed = await get<{ id: string }[] | { data: { id: string }[] }>(
      request,
      session,
      `/admission/applicants?intakeId=${intake.id}`,
    );
    const applicant = (Array.isArray(listed) ? listed : listed.data)[0]!;
    return route.path.replace('$applicantId', applicant.id);
  }
  if (route.path.startsWith('/payments/')) {
    const { studentId } = await createStudentWithDues(request, session, `Reflow Payer ${stamp}`);
    const student = await get<{ full_name: string }>(request, session, `/students/${studentId}`);
    const dues = await get<{
      data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
    }>(request, session, `/fees/dues?search=${encodeURIComponent(student.full_name)}`);
    const due = dues.data.find((row) => row.student_id === studentId)!.dues[0]!;
    const result = await post<{ payment: { id: string } }>(request, session, '/payments/checkout', {
      idempotency_key: crypto.randomUUID(),
      lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
      payment_method: 'CASH',
    });
    return route.path.replace('$id', result.payment.id);
  }
  if (route.path.startsWith('/fees/schedules/')) {
    const chain = await createClassSection(request, session);
    const structure = await post<{ id: string }>(request, session, '/fee-structures', {
      fee_type: 'MONTHLY_TUITION',
      name: `Reflow Tuition ${stamp}`,
      amount: 500,
      class_id: chain.classId,
      academic_year_id: chain.academicYearId,
    });
    const schedule = await post<{ id: string }>(request, session, '/fees/schedules', {
      academic_year_id: chain.academicYearId,
      name: `Reflow Schedule ${stamp}`,
      audience: { class_id: chain.classId, enrollment_status: 'ACTIVE' },
      rule: { kind: 'MONTHLY', day_of_month: 5 },
      fee_structure_ids: [structure.id],
      starts_on: '2026-01-01',
    });
    return route.path.replace('$id', schedule.id);
  }
  if (route.path.includes('$applicationId')) {
    // [52.4.1] Staff: any application the admin can see. Portal: the seeded
    // parent's own (`view=mine`). Seeded by 52.2.7 / 52.3.6.
    const isPortal = route.path.startsWith('/portal/');
    let id: string | undefined;
    if (isPortal) {
      // [52.6.4] The withdraw overlay needs one the parent can still withdraw;
      // the newest row may already be decided or a paper entry.
      const parent = await parentApiSession(request);
      const mine = await get<{ data: { id: string; can?: { withdraw?: boolean } }[] }>(
        request,
        parent,
        '/applications?view=mine&limit=100',
      );
      id = (mine.data.find((a) => a.can?.withdraw) ?? mine.data[0])?.id;
    } else {
      // [52.5.8] The overlays (approve / reject / consider) need a row the admin can decide.
      id = await ensureDecidableApplications(request, session, 1);
    }
    // The seed always creates applications: none means the seed broke, so fail, never skip.
    if (!id) throw new Error('no application seeded (server/src/scripts/seed.applications.ts)');
    return route.path.replace('$applicationId', id);
  }
  if (route.path.includes('$reportId')) {
    // [8.15.29] Opens the first ready report; a school with none (the ready reports land in 8.15.32)
    // still gets a real screen to scan: the "this report is not available" state.
    const catalogue = await get<{ reports: { id: string }[] }[]>(
      request,
      session,
      '/reports/catalogue',
    );
    const id =
      catalogue.flatMap((folder) => folder.reports)[0]?.id ??
      '00000000-0000-4000-8000-000000000000';
    return route.path.replace('$reportId', id);
  }
  if (route.path.includes('$runId')) {
    // [8.15.47] The page a regular report email opens. A run is private to the person it was made
    // for and no run is seeded, so this opens the real "we cannot find this file" screen.
    return route.path.replace('$runId', '00000000-0000-4000-8000-000000000000');
  }
  throw new Error(`no resolver for ${route.path}`);
}
