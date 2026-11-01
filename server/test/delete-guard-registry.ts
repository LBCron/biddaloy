import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  EnrollmentStatus,
  ExamComponentKind,
  ExamKind,
  FeeType,
  MarkStatus,
  PeriodSlotKind,
  RoutineState,
  SeatOrderMode,
  SlotRecurrence,
} from '@biddaloy/shared';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Routine } from '../src/modules/routines/entities/routine.entity';
import { RoutineSlot } from '../src/modules/routines/entities/routine-slot.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { PeriodSlot } from '../src/modules/routines/entities/period-slot.entity';
import { SeatPlan } from '../src/modules/seat-plans/entities/seat-plan.entity';
import { SeatAllocation } from '../src/modules/seat-plans/entities/seat-allocation.entity';
import { AcrAssessment } from '../src/modules/acr/entities/acr-assessment.entity';
import { AcrFormVersion } from '../src/modules/acr/entities/acr-form-version.entity';
import { Survey } from '../src/modules/surveys/entities/survey.entity';
import { SurveyTarget } from '../src/modules/surveys/entities/survey-target.entity';
import { SurveyResponse } from '../src/modules/surveys/entities/survey-response.entity';
import { SEED_ADMIN_USER_ID } from './constants';
import type { AcademicYearService } from '../src/modules/academics/academic-year.service';
import type { ClassService, SectionService } from '../src/modules/classes/classes.service';
import type { SubjectService } from '../src/modules/academics/subjects.service';
import type { FeeStructureService } from '../src/modules/fees/fees.service';
import type { RoomsService } from '../src/modules/routines/rooms.service';
import type { GradingService } from '../src/modules/grading/grading.service';

/**
 * Delete-guard registry (#2655, D19'). Every many-to-one that points at one
 * of seven protected parents sits in exactly one of three lists. The spec
 * `delete-guard-registry.integration.spec.ts` fails when a relation is in none
 * of them (or a list names a relation that no longer exists).
 *
 * Key format: "Child.relationProperty -> Parent".
 *
 * Soft delete never fires `ON DELETE CASCADE`, so a CASCADE flag on the
 * relation is not a reason to skip a guard.
 *
 *   GUARDED     parent remove() answers 409 while a live child exists (proved).
 *   ALLOWED     remove() deals with the child itself; `reason` names the code.
 *   KNOWN_GAPS  no guard yet; each becomes a GitHub issue at wave close (D22).
 */

export interface Ctx {
  ds: DataSource;
  tenantId: string;
  svc: {
    academicYears: AcademicYearService;
    classes: ClassService;
    sections: SectionService;
    subjects: SubjectService;
    rooms: RoomsService;
    feeStructures: FeeStructureService;
    grading: GradingService;
  };
  /** Unique number per call, so names/codes never collide inside one school. */
  n(): number;
}

export type ParentKind =
  'AcademicYear' | 'Class' | 'ClassSection' | 'Subject' | 'Room' | 'GradingScale' | 'FeeStructure';

/** Saves one live child row; `release` soft-deletes it (or deletes it when the table has no soft delete). */
export interface MadeChild {
  release(): Promise<void>;
}

export interface Guarded {
  key: string;
  parent: ParentKind;
  softDeletable: boolean;
  makeChild(ctx: Ctx, parentId: string): Promise<MadeChild>;
}

export interface Allowed {
  key: string;
  reason: string;
}

export interface KnownGap {
  key: string;
  reason: string;
  followUp: number;
}

// ---- fixtures ---------------------------------------------------------------

const day = (n: number) => `${2000 + (n % 90)}-01-01`;

async function year(ctx: Ctx) {
  const n = ctx.n();
  return ctx.ds.getRepository(AcademicYear).save({
    name: `Y-${n}`,
    start_date: new Date(day(n)),
    end_date: new Date(`${2000 + (n % 90)}-12-31`),
    tenant_id: ctx.tenantId,
  });
}

async function klass(ctx: Ctx, academicYearId: string) {
  return ctx.ds
    .getRepository(Class)
    .save({ name: `C-${ctx.n()}`, academic_year_id: academicYearId, tenant_id: ctx.tenantId });
}

async function section(ctx: Ctx, classId: string) {
  return ctx.ds
    .getRepository(ClassSection)
    .save({ class_id: classId, section_name: `S-${ctx.n()}`, tenant_id: ctx.tenantId });
}

async function student(ctx: Ctx, sectionId: string) {
  const n = ctx.n();
  return ctx.ds.getRepository(Student).save({
    full_name: `Guard Student ${n}`,
    registration_number: `REG-GUARD-${n}`,
    roll_number: n,
    class_section_id: sectionId,
    tenant_id: ctx.tenantId,
  });
}

async function subject(ctx: Ctx) {
  const n = ctx.n();
  return ctx.ds
    .getRepository(Subject)
    .save({ name_en: `Subject ${n}`, code: `SUB-${n}`, tenant_id: ctx.tenantId });
}

/** A year, class, section and student that belong to no parent under test. */
async function host(ctx: Ctx) {
  const y = await year(ctx);
  const k = await klass(ctx, y.id);
  const s = await section(ctx, k.id);
  const st = await student(ctx, s.id);
  return { year: y, klass: k, section: s, student: st };
}

async function exam(ctx: Ctx, academicYearId: string, classId: string) {
  return ctx.ds.getRepository(Exam).save({
    tenant_id: ctx.tenantId,
    academic_year_id: academicYearId,
    class_id: classId,
    name: `Exam ${ctx.n()}`,
    kind: ExamKind.TERM,
  });
}

const softDelete = (ctx: Ctx, entity: new () => object, id: string) => async () => {
  await ctx.ds.getRepository(entity).softDelete({ id } as never);
};
const hardDelete = (ctx: Ctx, entity: new () => object, id: string) => async () => {
  await ctx.ds.getRepository(entity).delete({ id } as never);
};

// ---- parents ----------------------------------------------------------------

export const PARENTS: Record<
  ParentKind,
  {
    make(ctx: Ctx): Promise<string>;
    remove(ctx: Ctx, id: string): Promise<unknown>;
    /** True once the parent row is soft-deleted. */
    isGone(ctx: Ctx, id: string): Promise<boolean>;
  }
> = {
  AcademicYear: {
    make: async (ctx) => (await year(ctx)).id,
    remove: (ctx, id) => ctx.svc.academicYears.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, AcademicYear, id),
  },
  Class: {
    make: async (ctx) => (await klass(ctx, (await year(ctx)).id)).id,
    remove: (ctx, id) => ctx.svc.classes.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Class, id),
  },
  ClassSection: {
    make: async (ctx) => (await section(ctx, (await klass(ctx, (await year(ctx)).id)).id)).id,
    remove: async (ctx, id) => {
      const s = await ctx.ds.getRepository(ClassSection).findOneByOrFail({ id });
      return ctx.svc.sections.remove(s.class_id, id, ctx.tenantId);
    },
    isGone: async (ctx, id) => goneIn(ctx, ClassSection, id),
  },
  Subject: {
    make: async (ctx) => (await subject(ctx)).id,
    remove: (ctx, id) => ctx.svc.subjects.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Subject, id),
  },
  Room: {
    make: async (ctx) =>
      (await ctx.ds.getRepository(Room).save({ room_no: `R-${ctx.n()}`, tenant_id: ctx.tenantId }))
        .id,
    remove: (ctx, id) => ctx.svc.rooms.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, Room, id),
  },
  FeeStructure: {
    make: async (ctx) => {
      const h = await host(ctx);
      return (
        await ctx.ds.getRepository(FeeStructure).save({
          fee_type: FeeType.MONTHLY_TUITION,
          name: `Tuition ${ctx.n()}`,
          amount: 500,
          class_id: h.klass.id,
          academic_year_id: h.year.id,
          tenant_id: ctx.tenantId,
        })
      ).id;
    },
    remove: (ctx, id) => ctx.svc.feeStructures.remove(id, ctx.tenantId),
    isGone: async (ctx, id) => goneIn(ctx, FeeStructure, id),
  },
  GradingScale: {
    make: async (ctx) =>
      (
        await ctx.ds.getRepository(GradingScale).save({
          name: `Scale ${ctx.n()}`,
          academic_year_id: (await year(ctx)).id,
          tenant_id: ctx.tenantId,
        })
      ).id,
    remove: (ctx, id) => ctx.svc.grading.remove(id, ctx.tenantId, null),
    isGone: async (ctx, id) => goneIn(ctx, GradingScale, id),
  },
};

async function goneIn(ctx: Ctx, entity: new () => object, id: string): Promise<boolean> {
  const row = await ctx.ds
    .getRepository(entity)
    .findOne({ where: { id } as never, withDeleted: true });
  return !!row && (row as { deleted_at?: Date | null }).deleted_at != null;
}

// ---- GUARDED ----------------------------------------------------------------

export const GUARDED: Guarded[] = [
  {
    key: 'Class.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const c = await klass(ctx, yearId);
      return { release: softDelete(ctx, Class, c.id) };
    },
  },
  {
    key: 'FeeStructure.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const fs = await ctx.ds.getRepository(FeeStructure).save({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `Tuition ${ctx.n()}`,
        amount: 500,
        class_id: h.klass.id,
        academic_year_id: yearId,
        tenant_id: ctx.tenantId,
      });
      return { release: softDelete(ctx, FeeStructure, fs.id) };
    },
  },
  {
    key: 'Enrollment.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: false,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: h.klass.id,
        section_id: h.section.id,
        academic_year_id: yearId,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'Exam.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const e = await exam(ctx, yearId, h.klass.id);
      return { release: softDelete(ctx, Exam, e.id) };
    },
  },
  {
    key: 'StudentFee.academic_year -> AcademicYear',
    parent: 'AcademicYear',
    softDeletable: true,
    async makeChild(ctx, yearId) {
      const h = await host(ctx);
      const fs = await ctx.ds.getRepository(FeeStructure).save({
        fee_type: FeeType.MONTHLY_TUITION,
        name: `Tuition ${ctx.n()}`,
        amount: 500,
        class_id: h.klass.id,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
      });
      const bill = await ctx.ds.getRepository(StudentFee).save({
        student_id: h.student.id,
        academic_year_id: yearId,
        fee_structure_id: fs.id,
        period_start: new Date('2022-02-01'),
        total_amount: 500,
      });
      // The year guard counts bills withDeleted (payment history), so release hard-deletes.
      return { release: hardDelete(ctx, StudentFee, bill.id) };
    },
  },
  {
    key: 'ClassSection.class -> Class',
    parent: 'Class',
    softDeletable: true,
    async makeChild(ctx, classId) {
      const s = await section(ctx, classId);
      return { release: softDelete(ctx, ClassSection, s.id) };
    },
  },
  {
    key: 'Enrollment.class -> Class',
    parent: 'Class',
    softDeletable: false,
    async makeChild(ctx, classId) {
      const h = await host(ctx);
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: classId,
        section_id: null,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'Student.class_section -> ClassSection',
    parent: 'ClassSection',
    softDeletable: true,
    async makeChild(ctx, sectionId) {
      const s = await student(ctx, sectionId);
      return { release: softDelete(ctx, Student, s.id) };
    },
  },
  {
    key: 'Enrollment.section -> ClassSection',
    parent: 'ClassSection',
    softDeletable: false,
    async makeChild(ctx, sectionId) {
      const h = await host(ctx);
      const sec = await ctx.ds.getRepository(ClassSection).findOneByOrFail({ id: sectionId });
      const e = await ctx.ds.getRepository(Enrollment).save({
        student_id: h.student.id,
        class_id: sec.class_id,
        section_id: sectionId,
        academic_year_id: h.year.id,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.GRADUATED,
      });
      return { release: hardDelete(ctx, Enrollment, e.id) };
    },
  },
  {
    key: 'ExamComponent.subject -> Subject',
    parent: 'Subject',
    softDeletable: true,
    async makeChild(ctx, subjectId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const c = await ctx.ds.getRepository(ExamComponent).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: subjectId,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
      });
      return { release: softDelete(ctx, ExamComponent, c.id) };
    },
  },
  {
    key: 'Mark.subject -> Subject',
    parent: 'Subject',
    softDeletable: false,
    async makeChild(ctx, subjectId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const c = await ctx.ds.getRepository(ExamComponent).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: (await subject(ctx)).id, // other subject: only the mark may block
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        full_marks: '100',
        sequence: 1,
      });
      const m = await ctx.ds.getRepository(Mark).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        student_id: h.student.id,
        subject_id: subjectId,
        component_id: c.id,
        value: '80',
        status: MarkStatus.PRESENT,
      });
      return { release: hardDelete(ctx, Mark, m.id) };
    },
  },
  {
    key: 'RoutineSlot.room -> Room',
    parent: 'Room',
    softDeletable: false,
    async makeChild(ctx, roomId) {
      const h = await host(ctx);
      const subj = await subject(ctx);
      const shift = await ctx.ds.getRepository(Shift).save({
        tenant_id: ctx.tenantId,
        name: `Shift-${ctx.n()}`,
        day_starts_at: '08:00:00',
        day_ends_at: '14:00:00',
        sequence: 0,
      });
      const period = await ctx.ds.getRepository(PeriodSlot).save({
        tenant_id: ctx.tenantId,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      });
      const routine = await ctx.ds.getRepository(Routine).save({
        tenant_id: ctx.tenantId,
        academic_year_id: h.year.id,
        name: `Routine-${ctx.n()}`,
        state: RoutineState.DRAFT,
        published_at: null,
      });
      const slot = await ctx.ds.getRepository(RoutineSlot).save({
        tenant_id: ctx.tenantId,
        routine_id: routine.id,
        section_id: h.section.id,
        period_slot_id: period.id,
        weekday: 1,
        subject_id: subj.id,
        room_id: roomId,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
      });
      return { release: hardDelete(ctx, RoutineSlot, slot.id) };
    },
  },
  {
    key: 'SeatAllocation.room -> Room',
    parent: 'Room',
    softDeletable: false,
    async makeChild(ctx, roomId) {
      const h = await host(ctx);
      const subj = await subject(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const schedule = await ctx.ds.getRepository(ExamSchedule).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        subject_id: subj.id,
        date: '2026-03-01',
        starts_at: '10:00',
        ends_at: '12:00',
      });
      const plan = await ctx.ds.getRepository(SeatPlan).save({
        tenant_id: ctx.tenantId,
        name: `Plan ${ctx.n()}`,
        seat_order_mode: SeatOrderMode.SEQUENTIAL,
      });
      const a = await ctx.ds.getRepository(SeatAllocation).save({
        tenant_id: ctx.tenantId,
        seat_plan_id: plan.id,
        exam_schedule_id: schedule.id,
        student_id: h.student.id,
        room_id: roomId,
        seat_number: '1',
      });
      return { release: hardDelete(ctx, SeatAllocation, a.id) };
    },
  },
  {
    key: 'Result.grading_scale -> GradingScale',
    parent: 'GradingScale',
    softDeletable: true,
    async makeChild(ctx, scaleId) {
      const h = await host(ctx);
      const e = await exam(ctx, h.year.id, h.klass.id);
      const r = await ctx.ds.getRepository(Result).save({
        tenant_id: ctx.tenantId,
        exam_id: e.id,
        student_id: h.student.id,
        total_marks: '80',
        gpa: '4.00',
        grade: 'A',
        grading_scale_id: scaleId,
        grading_scale_revision: 1,
        rule_version: 'test',
        computed_at: new Date(),
      });
      return { release: softDelete(ctx, Result, r.id) };
    },
  },
  auto('AdmissionIntake.class_section -> ClassSection', 'ClassSection'),
  auto('Application.academic_year -> AcademicYear', 'AcademicYear'),
  auto('AttendanceDevice.section -> ClassSection', 'ClassSection'),
  auto('AttendanceSession.section -> ClassSection', 'ClassSection'),
  auto('AttendanceSession.subject -> Subject', 'Subject'),
  auto('ExamSchedule.subject -> Subject', 'Subject'),
  auto('ExamSchedule.room -> Room', 'Room'),
  auto('Exam.class -> Class', 'Class'),
  auto('MarkGrid.section -> ClassSection', 'ClassSection'),
  auto('MarkGrid.subject -> Subject', 'Subject'),
  auto('ResultSubject.subject -> Subject', 'Subject'),
  auto('Result.section -> ClassSection', 'ClassSection'),
  auto('FeeGeneration.academic_year -> AcademicYear', 'AcademicYear'),
  auto('FeeStructure.class -> Class', 'Class'),
  auto('FeeStructure.section -> ClassSection', 'ClassSection'),
  auto('FineRule.academic_year -> AcademicYear', 'AcademicYear'),
  auto('FineRule.fee_structure -> FeeStructure', 'FeeStructure'),
  auto('FineRule.class -> Class', 'Class'),
  auto('RecurringScheduleStructure.fee_structure -> FeeStructure', 'FeeStructure'),
  auto('RecurringSchedule.academic_year -> AcademicYear', 'AcademicYear'),
  auto('GradingScale.academic_year -> AcademicYear', 'AcademicYear'),
  auto('GradingScale.class -> Class', 'Class'),
  auto('HomeworkAssignment.section -> ClassSection', 'ClassSection'),
  auto('Homework.subject -> Subject', 'Subject'),
  auto('Homework.klass -> Class', 'Class'),
  auto('SyllabusTopic.klass -> Class', 'Class'),
  auto('SyllabusTopic.subject -> Subject', 'Subject'),
  auto('PromotionRun.source_class -> Class', 'Class'),
  auto('RoutineSlot.section -> ClassSection', 'ClassSection'),
  auto('RoutineSlot.subject -> Subject', 'Subject'),
  auto('Routine.academic_year -> AcademicYear', 'AcademicYear'),
  auto('StudentLifecycleEvent.academic_year -> AcademicYear', 'AcademicYear'),
  auto('LessonDelivery.section -> ClassSection', 'ClassSection'),
  auto('LessonDelivery.subject -> Subject', 'Subject'),
  auto('StudyPlan.academic_year -> AcademicYear', 'AcademicYear'),
  auto('StudyPlan.section -> ClassSection', 'ClassSection'),
  auto('StudyPlan.subject -> Subject', 'Subject'),
];

// ---- ALLOWED ----------------------------------------------------------------

export const ALLOWED: Allowed[] = [
  {
    key: 'StudentFee.fee_structure -> FeeStructure',
    reason:
      'FeeStructureService.remove soft-deletes by design (fees.service.ts), so billed history keeps its price tag.',
  },
  {
    key: 'GradingBand.scale -> GradingScale',
    reason:
      "GradingService.remove soft-deletes the scale's bands in the same transaction (grading.service.ts).",
  },
  {
    key: 'ClassSubject.subject -> Subject',
    reason:
      "SubjectService.remove soft-deletes the subject's ClassSubject rows in the same transaction (subjects.service.ts).",
  },
  {
    key: 'ClassSubject.class -> Class',
    reason:
      "ClassSubject rows are offering config: ClassService.remove deletes the students' choices and soft-deletes them in the same transaction (drop-class-subjects.ts).",
  },
  {
    key: 'ClassSubject.academic_year -> AcademicYear',
    reason:
      'ClassSubject rows are offering config: AcademicYearService.remove hides them (and the choices) in the same transaction (drop-class-subjects.ts).',
  },
  {
    key: 'TeacherClassSection.section -> ClassSection',
    reason:
      'Teacher assignments are config: SectionService.remove deletes them in the same transaction (classes.service.ts).',
  },
  {
    key: 'TeacherClassSection.subject -> Subject',
    reason:
      'Teacher assignments are config: SubjectService.remove deletes them in the same transaction (subjects.service.ts).',
  },
  {
    key: 'CoordinatorAssignment.class -> Class',
    reason:
      "[83.1.2] D15: a coordinator row is an assignment, not a record. A soft-deleted class keeps its rows, but every reader (TeacherScopeService's COORDINATOR_ROWS_FROM_SQL, coordinatorRecipients, CoordinatorsService.list, the workbook tab) skips a deleted class; a hard delete cascades.",
  },
  {
    key: 'CoordinatorAssignment.subject -> Subject',
    reason:
      "[83.1.2] D15: same as the class link: a soft-deleted subject's rows are skipped by every reader; a hard delete cascades.",
  },
  {
    key: 'AcademicTerm.academic_year -> AcademicYear',
    reason:
      'Terms are year config: AcademicYearService.remove soft-deletes them in the same transaction.',
  },
  {
    key: 'CalendarEventClass.class -> Class',
    reason:
      'Calendar class links are join rows: ClassService.remove deletes them in the same transaction, and soft-deletes an event left with no class (else it turns school-wide).',
  },
  {
    key: 'CalendarEvent.academic_year -> AcademicYear',
    reason:
      'Calendar events are year config: AcademicYearService.remove soft-deletes them in the same transaction.',
  },
  {
    key: 'StudentSubjectChoice.academic_year -> AcademicYear',
    reason:
      'Choices belong to the year offerings: AcademicYearService.remove deletes them with the offerings (drop-class-subjects.ts).',
  },
];

// ---- generated-fixture guards (#2675-#2680) ----------------------------------

const SCALARS: Record<string, unknown> = { boolean: false, jsonb: {}, json: {}, time: '09:00:00' };

/** Fills every required column from the TypeORM metadata so a child row needs no hand-made fixture. */
async function autoRow(
  ctx: Ctx,
  entityName: string,
  relProp: string | null,
  parentId: string | null,
  depth = 0,
) {
  const meta = ctx.ds.entityMetadatas.find((m) => m.name === entityName)!;
  if (depth > 6) throw new Error(`autoRow too deep at ${entityName}`);
  const row: Record<string, unknown> = {};
  for (const col of meta.columns) {
    const rel = col.relationMetadata;
    const isTarget = !!rel && rel.propertyName === relProp;
    if (!isTarget && (col.isGenerated || col.isCreateDate || col.isUpdateDate || col.isDeleteDate))
      continue;
    if (!isTarget && (col.isNullable || col.default !== undefined)) continue;
    if (rel) {
      const id = isTarget
        ? parentId
        : await autoCreate(ctx, rel.inverseEntityMetadata.name, depth + 1);
      row[rel.propertyName] = { id };
      continue;
    }
    if (col.isArray) row[col.propertyName] = [];
    else if (col.propertyName === 'tenant_id') row.tenant_id = ctx.tenantId;
    else if (col.enum?.length) row[col.propertyName] = col.enum[0];
    else if (String(col.type) in SCALARS)
      row[col.propertyName] = /end/.test(col.propertyName)
        ? '10:00:00'
        : SCALARS[col.type as string];
    else if (col.type === 'uuid') row[col.propertyName] = randomUUID();
    else if (['date'].includes(col.type as string)) row[col.propertyName] = '2020-01-01';
    else if (String(col.type).startsWith('timestamp')) row[col.propertyName] = new Date();
    else if (
      col.type === String ||
      ['varchar', 'text', 'character varying'].includes(col.type as string)
    )
      row[col.propertyName] = `g${ctx.n()}`;
    else row[col.propertyName] = 1;
  }
  // CHK_applications_applicant: a paper application needs a name instead of a user.
  if (entityName === 'Application')
    Object.assign(row, {
      source: 'PAPER',
      applicant_name: `g${ctx.n()}`,
      subject_student: { id: (await host(ctx)).student.id },
    });
  return { meta, row };
}

async function autoCreate(ctx: Ctx, entityName: string, depth: number): Promise<string> {
  const { meta, row } = await autoRow(ctx, entityName, null, null, depth);
  const saved = await ctx.ds.getRepository(meta.target).save(row as never);
  return (saved as unknown as { id: string }).id;
}

/** `releaseVia`: free the parent by soft-deleting the child's other parent (that relation) instead. */
function auto(key: string, parent: ParentKind, releaseVia?: string): Guarded {
  const [child, rest] = key.split('.');
  const prop = rest.split(' -> ')[0];
  return {
    key,
    parent,
    softDeletable: true,
    async makeChild(ctx, parentId) {
      const { meta, row } = await autoRow(ctx, child, prop, parentId);
      const saved = await ctx.ds.getRepository(meta.target).save(row as never);
      const pk = Object.fromEntries(
        meta.primaryColumns.map((c) => [
          c.propertyName,
          (saved as unknown as Record<string, unknown>)[c.propertyName],
        ]),
      );
      if (releaseVia) {
        const other = meta.findRelationWithPropertyPath(releaseVia)!.inverseEntityMetadata;
        const otherId = (row[releaseVia] as { id: string }).id;
        return { release: softDelete(ctx, other.target as new () => object, otherId) };
      }
      return {
        release: async () => void (await ctx.ds.getRepository(meta.target).delete(pk as never)),
      };
    },
  };
}

/**
 * [2703 M4] A child whose own other parent is soft-deleted is gone with it, so it
 * no longer blocks the protected parent (e.g. the structures of a deleted
 * schedule, the sittings of a deleted exam).
 */
export const ORPHANED: Guarded[] = [
  auto('RecurringScheduleStructure.fee_structure -> FeeStructure', 'FeeStructure', 'schedule'),
  auto('ExamSchedule.room -> Room', 'Room', 'exam'),
  auto('ExamSchedule.subject -> Subject', 'Subject', 'exam'),
];

/**
 * [2702] Bare FKs (real constraint, no relation decorator) that the parent's remove()
 * counts by hand. None of the three tables has deleted_at, so release is a hard delete.
 * Every uuid on these rows is a bare FK, so the fixtures build real referenced rows.
 */
async function teacher(ctx: Ctx) {
  // Raw insert bypasses TeacherStaffProfileSubscriber, hence the staff_profiles CTE.
  const [row] = await ctx.ds.query(
    `WITH sp AS (
       INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'EMP-GUARD', NOW(), NOW())
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = NOW()
       RETURNING id
     )
     INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
     SELECT gen_random_uuid(), $1::uuid, 'GUARD-TEACHER', '{}', $2::uuid, sp.id, NOW(), NOW() FROM sp
     RETURNING id`,
    [SEED_ADMIN_USER_ID, ctx.tenantId],
  );
  return row.id as string;
}
const survey = (ctx: Ctx) =>
  ctx.ds
    .getRepository(Survey)
    .save({ tenant_id: ctx.tenantId, title: `Survey ${ctx.n()}`, respondent: 'STUDENTS' });

export const BARE_GUARDED: Guarded[] = [
  {
    key: 'AcrAssessment.academic_year_id',
    parent: 'AcademicYear',
    softDeletable: false,
    makeChild: async (ctx, yearId) => {
      const form = await ctx.ds.getRepository(AcrFormVersion).save({
        tenant_id: ctx.tenantId,
        version: ctx.n(),
        created_by: SEED_ADMIN_USER_ID,
      });
      const a = await ctx.ds.getRepository(AcrAssessment).save({
        tenant_id: ctx.tenantId,
        user_id: SEED_ADMIN_USER_ID,
        academic_year_id: yearId,
        form_version_id: form.id,
        assessed_by: SEED_ADMIN_USER_ID,
      });
      return { release: hardDelete(ctx, AcrAssessment, a.id) };
    },
  },
  {
    key: 'SurveyTarget.subject_id',
    parent: 'Subject',
    softDeletable: false,
    makeChild: async (ctx, subjectId) => {
      const t = await ctx.ds.getRepository(SurveyTarget).save({
        tenant_id: ctx.tenantId,
        survey_id: (await survey(ctx)).id,
        teacher_id: await teacher(ctx),
        subject_id: subjectId,
      });
      return { release: hardDelete(ctx, SurveyTarget, t.id) };
    },
  },
  {
    key: 'SurveyResponse.subject_id',
    parent: 'Subject',
    softDeletable: false,
    makeChild: async (ctx, subjectId) => {
      const r = await ctx.ds.getRepository(SurveyResponse).save({
        tenant_id: ctx.tenantId,
        survey_id: (await survey(ctx)).id,
        respondent_user_id: SEED_ADMIN_USER_ID,
        teacher_id: await teacher(ctx),
        subject_id: subjectId,
      });
      return { release: hardDelete(ctx, SurveyResponse, r.id) };
    },
  },
];

// ---- KNOWN_GAPS (each becomes a GitHub issue at wave close, D22) -------------

export const KNOWN_GAPS: KnownGap[] = [];

/**
 * [2688] References the metadata scan cannot prove: plain uuid columns with no
 * relation or FK constraint, and ids inside JSON. A delete of the parent does
 * not see them. Each needs a reason; add a guard in the parent's remove() when
 * the child is live data.
 */
export const BARE_REFS: { key: string; reason: string }[] = [
  {
    key: 'PrintJobItem.subject_id',
    reason:
      "Polymorphic 'subject' (a person or record of any kind), not the Subject entity; no FK to protect.",
  },
  {
    key: 'Alert.subject_id',
    reason:
      "Polymorphic 'subject' (a person or record of any kind), not the Subject entity; no FK to protect.",
  },
  {
    key: 'AcrAssessment.academic_year_id',
    reason:
      'Real FK to academic_years with no relation decorator; AcademicYearService.remove counts it (#2702).',
  },
  {
    key: 'SurveyTarget.subject_id',
    reason:
      'Real FK to subjects with no relation decorator; SubjectService.remove counts it (#2702).',
  },
  {
    key: 'SurveyResponse.subject_id',
    reason:
      'Real FK to subjects with no relation decorator; SubjectService.remove counts it (#2702).',
  },
];
