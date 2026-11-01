import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  Permission,
  RoutineState,
  STUDY_PLAN_LIMITS,
  TeacherAssignmentType,
  hasTenantDataScope,
  roleHasPermission,
  UserRole,
} from '@biddaloy/shared';
import type { StudyPlanExamMarker, StudyPlanLesson } from '@biddaloy/shared';
import { StudyPlan } from './entities/study-plan.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { SyllabusTopic } from '../homework/entities/syllabus-topic.entity';
import { Exam } from '../exams/entities/exam.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  CreateStudyPlanDto,
  ListStudyPlansQueryDto,
  StudyPlanBaseDto,
  StudyPlanDetailDto,
  StudyPlanListDto,
  StudyPlanLessonDto,
} from './dto/study-plan.dto';

const NO_CONTEXT: RequestContext = { ip: null, userAgent: null };

/** Who is calling. `userId` is the JWT user id, not a teacher id. */
export interface StudyPlanCaller {
  userId: string;
  tenantId: string;
  role: string;
  context?: RequestContext;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

function outOfScope(message: string): ForbiddenException {
  return new ForbiddenException({ message, details: { code: 'STUDY_PLAN_OUT_OF_SCOPE' } });
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ message, details: { code } });
}

/**
 * [66.2.01/#2006] Study plans: one ordered lesson list per section x subject
 * (whole year or one term). Writes follow the D6/D28 owner scope; reads follow
 * D9. Every query below filters `tenant_id`, joins included.
 */
@Injectable()
export class StudyPlansService {
  constructor(
    @InjectRepository(StudyPlan) private readonly repo: Repository<StudyPlan>,
    private readonly teacherScope: TeacherScopeService,
    private readonly audit: AuditService,
  ) {}

  private get em(): EntityManager {
    return this.repo.manager;
  }

  // ---------------------------------------------------------------- owner scope

  /** The caller's live teacher row id in this tenant, or null (not a teacher). */
  private async callerTeacherId(caller: StudyPlanCaller): Promise<string | null> {
    const t = await this.em.getRepository(Teacher).findOne({
      where: { user_id: caller.userId, tenant_id: caller.tenantId, deleted_at: IsNull() },
      select: { id: true },
    });
    return t?.id ?? null;
  }

  /**
   * D6: override wins; else teachers on the year's PUBLISHED routine for this
   * section x subject (routine wins); else SUBJECT_TEACHER rows.
   * `overrideTeacherId` is the plan's `owner_override_teacher_id` (optional:
   * a plan that does not exist yet has none).
   */
  async ownerTeacherIds(
    tenantId: string,
    sectionId: string,
    subjectId: string,
    academicYearId: string,
    overrideTeacherId?: string | null,
  ): Promise<string[]> {
    if (overrideTeacherId) return [overrideTeacherId];

    const year = await this.em
      .getRepository(AcademicYear)
      .findOne({ where: { id: academicYearId, tenant_id: tenantId } });
    if (!year) return [];

    const routine: { teacher_id: string }[] = await this.em.query(
      `SELECT DISTINCT rst.teacher_id
         FROM routine_slot_teachers rst
         JOIN routine_slots rs ON rs.id = rst.routine_slot_id AND rs.tenant_id = $1
         JOIN routines r ON r.id = rs.routine_id AND r.tenant_id = $1
              AND r.deleted_at IS NULL AND r.state = $5 AND r.academic_year_id = $4
         JOIN teachers t ON t.id = rst.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
        WHERE rst.tenant_id = $1 AND rs.section_id = $2 AND rs.subject_id = $3
          AND (rs.valid_to IS NULL OR rs.valid_to >= $6)`,
      [tenantId, sectionId, subjectId, academicYearId, RoutineState.PUBLISHED, year.start_date],
    );
    if (routine.length) return routine.map((r) => r.teacher_id);

    const tcs: { teacher_id: string }[] = await this.em.query(
      `SELECT DISTINCT tcs.teacher_id
         FROM teacher_class_sections tcs
         JOIN teachers t ON t.id = tcs.teacher_id AND t.tenant_id = $1 AND t.deleted_at IS NULL
        WHERE tcs.tenant_id = $1 AND tcs.section_id = $2 AND tcs.subject_id = $3
          AND tcs.assignment_type = $4`,
      [tenantId, sectionId, subjectId, TeacherAssignmentType.SUBJECT_TEACHER],
    );
    return tcs.map((r) => r.teacher_id);
  }

  private async canWrite(
    caller: StudyPlanCaller,
    sectionId: string,
    subjectId: string,
    academicYearId: string,
    overrideTeacherId?: string | null,
  ): Promise<boolean> {
    if (
      hasTenantDataScope(caller.role) &&
      roleHasPermission(caller.role, Permission.SYLLABUS_MANAGE)
    ) {
      return true;
    }
    if (caller.role !== UserRole.TEACHER) return false;
    const me = await this.callerTeacherId(caller);
    if (!me) return false;
    const owners = await this.ownerTeacherIds(
      caller.tenantId,
      sectionId,
      subjectId,
      academicYearId,
      overrideTeacherId,
    );
    return owners.includes(me);
  }

  async assertCanWrite(
    caller: StudyPlanCaller,
    sectionId: string,
    subjectId: string,
    academicYearId: string,
    overrideTeacherId?: string | null,
  ): Promise<void> {
    if (!(await this.canWrite(caller, sectionId, subjectId, academicYearId, overrideTeacherId))) {
      throw outOfScope('You can only change the study plan of a subject you own.');
    }
  }

  /** D9: tenant-wide readers see all; a teacher sees plans they own or whose section they are class teacher of. */
  private async canRead(caller: StudyPlanCaller, plan: StudyPlan): Promise<boolean> {
    if (
      hasTenantDataScope(caller.role) &&
      roleHasPermission(caller.role, Permission.SYLLABUS_READ)
    ) {
      return true;
    }
    if (caller.role !== UserRole.TEACHER) return false;
    if (
      await this.canWrite(
        caller,
        plan.section_id,
        plan.subject_id,
        plan.academic_year_id,
        plan.owner_override_teacher_id,
      )
    ) {
      return true;
    }
    const { homeroom, coordinated } = await this.teacherScope.rolesInSection({
      userId: caller.userId,
      tenantId: caller.tenantId,
      sectionId: plan.section_id,
    });
    // [83.3.1] D4/D19 read: a class coordinator reads every plan of the section, a subject
    // coordinator only their subject's. `canWrite` above never looks at `coordinated`.
    return (
      homeroom !== null ||
      coordinated.allSubjects ||
      coordinated.subjectIds.includes(plan.subject_id)
    );
  }

  async assertCanRead(caller: StudyPlanCaller, plan: StudyPlan): Promise<void> {
    if (!(await this.canRead(caller, plan))) {
      throw outOfScope('You cannot view this study plan.');
    }
  }

  // ---------------------------------------------------------------- loading

  /** 404 for another tenant's or a soft-deleted plan. */
  private async loadPlan(id: string, tenantId: string): Promise<StudyPlan> {
    const plan = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!plan) throw new NotFoundException('Study plan not found.');
    return plan;
  }

  /** A plan whose section or class was soft-deleted is read-only: 409, not a 500. */
  private async requireSectionWithClass(tenantId: string, sectionId: string) {
    const section = await this.sectionWithClass(tenantId, sectionId);
    if (!section) {
      throw new ConflictException({
        message: 'The plan section or class no longer exists.',
        details: { code: 'STUDY_PLAN_SECTION_GONE' },
      });
    }
    return section;
  }

  private async sectionWithClass(tenantId: string, sectionId: string) {
    const row: {
      id: string;
      name: string;
      class_id: string;
      class_name: string;
      year_id: string;
    }[] = await this.em.query(
      `SELECT cs.id, cs.section_name AS name, c.id AS class_id, c.name AS class_name,
                c.academic_year_id AS year_id
           FROM class_sections cs
           JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
          WHERE cs.id = $2 AND cs.tenant_id = $1 AND cs.deleted_at IS NULL`,
      [tenantId, sectionId],
    );
    return row[0] ?? null;
  }

  /** Names for a set of plans: base fields every DTO carries. */
  private async baseDtos(plans: StudyPlan[], tenantId: string): Promise<StudyPlanBaseDto[]> {
    if (!plans.length) return [];
    const sectionIds = [...new Set(plans.map((p) => p.section_id))];
    const subjectIds = [...new Set(plans.map((p) => p.subject_id))];
    const termIds = [
      ...new Set(plans.map((p) => p.academic_term_id).filter((x): x is string => !!x)),
    ];

    const sections: { id: string; name: string; class_id: string; class_name: string }[] =
      await this.em.query(
        `SELECT cs.id, cs.section_name AS name, c.id AS class_id, c.name AS class_name
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
          WHERE cs.tenant_id = $1 AND cs.id = ANY($2::uuid[])`,
        [tenantId, sectionIds],
      );
    const subjects = await this.em
      .getRepository(Subject)
      .find({ where: { tenant_id: tenantId, id: In(subjectIds) }, withDeleted: true });
    const terms = termIds.length
      ? await this.em
          .getRepository(AcademicTerm)
          .find({ where: { tenant_id: tenantId, id: In(termIds) }, withDeleted: true })
      : [];
    const sMap = new Map(sections.map((s) => [s.id, s]));
    const subMap = new Map(subjects.map((s) => [s.id, s]));
    const tMap = new Map(terms.map((t) => [t.id, t]));

    return plans.map((p) => {
      const s = sMap.get(p.section_id)!;
      const sub = subMap.get(p.subject_id)!;
      const t = p.academic_term_id ? tMap.get(p.academic_term_id) : null;
      return {
        id: p.id,
        academic_year_id: p.academic_year_id,
        section: { id: s.id, name: s.name, class_id: s.class_id, class_name: s.class_name },
        subject: { id: sub.id, name_en: sub.name_en, name_bn: sub.name_bn, code: sub.code },
        term: t ? { id: t.id, name: t.name } : null,
        lesson_count: p.lessons.length,
      };
    });
  }

  private async detailDto(
    plan: StudyPlan,
    caller: StudyPlanCaller,
    extra: Partial<StudyPlanDetailDto> = {},
  ): Promise<StudyPlanDetailDto> {
    const tenantId = caller.tenantId;
    const [base] = await this.baseDtos([plan], tenantId);

    const ownerIds = await this.ownerTeacherIds(
      tenantId,
      plan.section_id,
      plan.subject_id,
      plan.academic_year_id,
      plan.owner_override_teacher_id,
    );
    const owners: { teacher_id: string; full_name: string }[] = ownerIds.length
      ? await this.em.query(
          `SELECT t.id AS teacher_id, u.full_name
             FROM teachers t JOIN users u ON u.id = t.user_id
            WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[]) ORDER BY u.full_name`,
          [tenantId, ownerIds],
        )
      : [];

    // D32: hide (in the response only) topic links and markers whose target is gone.
    const topicIds = [
      ...new Set(plan.lessons.map((l) => l.topic_id).filter((x): x is string => !!x)),
    ];
    const liveTopics = topicIds.length
      ? new Set(
          (
            await this.em.getRepository(SyllabusTopic).find({
              where: {
                tenant_id: tenantId,
                class_id: base.section.class_id,
                subject_id: plan.subject_id,
                id: In(topicIds),
              },
              select: { id: true },
            })
          ).map((t) => t.id),
        )
      : new Set<string>();
    const lessons = plan.lessons.map((l) => {
      if (l.topic_id && !liveTopics.has(l.topic_id)) {
        const { topic_id: _dropped, ...rest } = l;
        return rest;
      }
      return l;
    });

    const examIds = plan.exam_markers.map((m) => m.exam_id);
    const exams = examIds.length
      ? await this.em.getRepository(Exam).find({
          where: { tenant_id: tenantId, id: In(examIds) },
          select: { id: true, name: true },
        })
      : [];
    const examName = new Map(exams.map((e) => [e.id, e.name]));
    const lessonIds = new Set(plan.lessons.map((l) => l.id));
    const exam_markers = plan.exam_markers
      .filter((m) => examName.has(m.exam_id) && lessonIds.has(m.up_to_lesson_id))
      .map((m) => ({ ...m, exam_name: examName.get(m.exam_id)! }));

    return {
      ...base,
      owners,
      owner_override_teacher_id: plan.owner_override_teacher_id,
      can_edit: await this.canWrite(
        caller,
        plan.section_id,
        plan.subject_id,
        plan.academic_year_id,
        plan.owner_override_teacher_id,
      ),
      lessons,
      exam_markers,
      ...extra,
    };
  }

  async findOneForCaller(
    id: string,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const plan = await this.loadPlan(id, tenantId);
    await this.assertCanRead(caller, plan);
    return this.detailDto(plan, caller);
  }

  async findAll(
    query: ListStudyPlansQueryDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanListDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoin('class_sections', 'cs', 'cs.id = p.section_id AND cs.tenant_id = :tenantId', {
        tenantId,
      })
      .innerJoin('subjects', 's', 's.id = p.subject_id AND s.tenant_id = :tenantId', { tenantId })
      .where('p.tenant_id = :tenantId', { tenantId })
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'ASC');
    if (query.class_id) qb.andWhere('cs.class_id = :classId', { classId: query.class_id });
    if (query.section_id) qb.andWhere('p.section_id = :sectionId', { sectionId: query.section_id });
    if (query.subject_id) qb.andWhere('p.subject_id = :subjectId', { subjectId: query.subject_id });
    if (query.academic_term_id) {
      qb.andWhere('p.academic_term_id = :termId', { termId: query.academic_term_id });
    }
    if (query.q?.trim()) {
      qb.andWhere('(cs.section_name ILIKE :q OR s.name_en ILIKE :q OR s.name_bn ILIKE :q)', {
        q: `%${query.q.trim().replace(/[\\%_]/g, '\\$&')}%`,
      });
    }

    let rows: StudyPlan[];
    let total: number;
    if (hasTenantDataScope(caller.role)) {
      [rows, total] = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .getManyAndCount();
    } else {
      // ponytail: a teacher's visibility is per-plan (owner / homeroom), so filter
      // in memory then page; fine for one school's plan count. Move into SQL if a
      // tenant ever holds thousands of plans.
      const all = await qb.getMany();
      const visible: StudyPlan[] = [];
      for (const p of all) if (await this.canRead(caller, p)) visible.push(p);
      total = visible.length;
      rows = visible.slice((page - 1) * limit, page * limit);
    }
    return {
      data: await this.baseDtos(rows, tenantId),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** D14: the live plan whose term covers `date`, else the year's whole-year plan, else null. */
  async currentPlanFor(
    tenantId: string,
    sectionId: string,
    subjectId: string,
    date: string,
  ): Promise<StudyPlan | null> {
    const base = () =>
      this.repo
        .createQueryBuilder('p')
        .where(
          'p.tenant_id = :tenantId AND p.section_id = :sectionId AND p.subject_id = :subjectId',
          {
            tenantId,
            sectionId,
            subjectId,
          },
        );
    const termPlan = await base()
      .innerJoin(
        'academic_terms',
        'at',
        'at.id = p.academic_term_id AND at.tenant_id = :tenantId AND at.deleted_at IS NULL',
      )
      .andWhere('at.start_date <= :date AND at.end_date >= :date', { date })
      .getOne();
    if (termPlan) return termPlan;
    return base()
      .innerJoin(
        'academic_years',
        'ay',
        'ay.id = p.academic_year_id AND ay.tenant_id = :tenantId AND ay.deleted_at IS NULL',
      )
      .andWhere('p.academic_term_id IS NULL')
      .andWhere('ay.start_date <= :date AND ay.end_date >= :date', { date })
      .getOne();
  }

  // ---------------------------------------------------------------- validation

  /**
   * Trim, bound-check, assign missing ids, check unique ids and that every
   * `topic_id` is a topic of the plan's class x subject.
   */
  private async normalizeLessons(
    input: StudyPlanLessonDto[] | StudyPlanLesson[],
    tenantId: string,
    classId: string,
    subjectId: string,
  ): Promise<StudyPlanLesson[]> {
    const L = STUDY_PLAN_LIMITS;
    if (input.length > L.maxLessons) {
      throw badRequest(
        'STUDY_PLAN_LESSON_INVALID',
        `A plan holds at most ${L.maxLessons} lessons.`,
      );
    }
    const seen = new Set<string>();
    const lessons: StudyPlanLesson[] = input.map((raw, i) => {
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (title.length < 1 || title.length > L.titleMax) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: title must be 1-${L.titleMax} characters.`,
        );
      }
      if (
        !Number.isInteger(raw.periods) ||
        raw.periods < L.periodsMin ||
        raw.periods > L.periodsMax
      ) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: periods must be a whole number ${L.periodsMin}-${L.periodsMax}.`,
        );
      }
      if (raw.notes !== undefined && raw.notes !== null && raw.notes.length > L.notesMax) {
        throw badRequest(
          'STUDY_PLAN_LESSON_INVALID',
          `Lesson ${i + 1}: notes are at most ${L.notesMax} characters.`,
        );
      }
      const id = raw.id || randomUUID();
      if (seen.has(id)) {
        throw badRequest('STUDY_PLAN_LESSON_INVALID', `Lesson ${i + 1}: duplicate lesson id.`);
      }
      seen.add(id);
      const lesson: StudyPlanLesson = { id, title, periods: raw.periods };
      if (raw.topic_id) lesson.topic_id = raw.topic_id;
      if (raw.notes) lesson.notes = raw.notes;
      return lesson;
    });

    const topicIds = [...new Set(lessons.map((l) => l.topic_id).filter((x): x is string => !!x))];
    if (topicIds.length) {
      const found = await this.em.getRepository(SyllabusTopic).count({
        where: { tenant_id: tenantId, class_id: classId, subject_id: subjectId, id: In(topicIds) },
      });
      if (found !== topicIds.length) {
        throw badRequest(
          'STUDY_PLAN_TOPIC_MISMATCH',
          'A lesson links to a topic outside this class and subject.',
        );
      }
    }
    return lessons;
  }

  private async assertOffered(
    tenantId: string,
    classId: string,
    subjectId: string,
    yearId: string,
  ) {
    const offered = await this.em.getRepository(ClassSubject).count({
      where: {
        tenant_id: tenantId,
        class_id: classId,
        subject_id: subjectId,
        academic_year_id: yearId,
      },
    });
    if (!offered) {
      throw badRequest('STUDY_PLAN_SUBJECT_NOT_OFFERED', 'This class does not offer that subject.');
    }
  }

  // ---------------------------------------------------------------- writes

  private async auditWrite(
    action: AuditAction,
    planId: string,
    caller: StudyPlanCaller,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
    manager: EntityManager,
  ) {
    await this.audit.record(
      {
        action,
        entity_type: 'StudyPlan',
        entity_id: planId,
        tenant_id: caller.tenantId,
        performed_by_user_id: caller.userId,
        ip_address: (caller.context ?? NO_CONTEXT).ip,
        user_agent: (caller.context ?? NO_CONTEXT).userAgent,
        old_values: oldValues,
        new_values: newValues,
      },
      manager,
    );
  }

  /** Insert + audit; maps the unique-scope violation to 409 `STUDY_PLAN_EXISTS`. */
  private async insertPlan(
    caller: StudyPlanCaller,
    values: Pick<StudyPlan, 'section_id' | 'subject_id' | 'academic_year_id' | 'academic_term_id'> &
      Partial<Pick<StudyPlan, 'lessons' | 'exam_markers'>>,
  ): Promise<StudyPlan> {
    const tenantId = caller.tenantId;
    try {
      return await this.em.transaction(async (manager) => {
        const saved = await manager.getRepository(StudyPlan).save(
          manager.getRepository(StudyPlan).create({
            ...values,
            tenant_id: tenantId,
            lessons: values.lessons ?? [],
            exam_markers: values.exam_markers ?? [],
          }),
        );
        await this.auditWrite(
          AuditAction.CREATE,
          saved.id,
          caller,
          null,
          {
            section_id: saved.section_id,
            subject_id: saved.subject_id,
            academic_term_id: saved.academic_term_id,
            lessons: saved.lessons.length,
          },
          manager,
        );
        return saved;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.repo.findOne({
        where: {
          tenant_id: tenantId,
          section_id: values.section_id,
          subject_id: values.subject_id,
          academic_term_id: values.academic_term_id ?? IsNull(),
        },
        select: { id: true },
      });
      throw new ConflictException({
        message: 'A study plan already exists for this section, subject and term.',
        details: { code: 'STUDY_PLAN_EXISTS', existing_id: existing?.id ?? null },
      });
    }
  }

  async create(
    dto: CreateStudyPlanDto,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const section = await this.sectionWithClass(tenantId, dto.section_id);
    if (!section) throw new NotFoundException('Section not found.');
    const subject = await this.em
      .getRepository(Subject)
      .findOne({ where: { id: dto.subject_id, tenant_id: tenantId } });
    if (!subject) throw new NotFoundException('Subject not found.');

    // Authorise before the 400 checks so a non-owner learns nothing about the class setup.
    await this.assertCanWrite(caller, section.id, subject.id, section.year_id);

    await this.assertOffered(tenantId, section.class_id, subject.id, section.year_id);
    const termId = dto.academic_term_id ?? null;
    if (termId) {
      const term = await this.em
        .getRepository(AcademicTerm)
        .findOne({ where: { id: termId, tenant_id: tenantId, academic_year_id: section.year_id } });
      if (!term)
        throw badRequest(
          'STUDY_PLAN_TERM_MISMATCH',
          "That term is not in this class's academic year.",
        );
    }
    const lessons = dto.lessons?.length
      ? await this.normalizeLessons(dto.lessons, tenantId, section.class_id, subject.id)
      : [];

    const saved = await this.insertPlan(caller, {
      section_id: section.id,
      subject_id: subject.id,
      academic_year_id: section.year_id,
      academic_term_id: termId,
      lessons,
    });
    return this.detailDto(saved, caller);
  }

  async replaceLessons(
    id: string,
    lessons: StudyPlanLessonDto[] | StudyPlanLesson[],
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const plan = await this.loadPlan(id, tenantId);
    await this.assertCanWrite(
      caller,
      plan.section_id,
      plan.subject_id,
      plan.academic_year_id,
      plan.owner_override_teacher_id,
    );
    const section = await this.requireSectionWithClass(tenantId, plan.section_id);
    const next = await this.normalizeLessons(lessons, tenantId, section.class_id, plan.subject_id);

    const keep = new Set(next.map((l) => l.id));
    const dropped = plan.exam_markers.filter((m) => !keep.has(m.up_to_lesson_id));
    const markers = plan.exam_markers.filter((m) => keep.has(m.up_to_lesson_id));

    const saved = await this.em.transaction(async (manager) => {
      const repo = manager.getRepository(StudyPlan);
      await repo.update(
        { id: plan.id, tenant_id: tenantId },
        { lessons: next, exam_markers: markers },
      );
      await this.auditWrite(
        AuditAction.UPDATE,
        plan.id,
        caller,
        { lessons: plan.lessons.length },
        { lessons: next.length, dropped_markers: dropped.length },
        manager,
      );
      return repo.findOneByOrFail({ id: plan.id, tenant_id: tenantId });
    });
    return this.detailDto(saved, caller, { dropped_markers: dropped });
  }

  async setExamMarkers(
    id: string,
    markers: StudyPlanExamMarker[],
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const plan = await this.loadPlan(id, tenantId);
    await this.assertCanWrite(
      caller,
      plan.section_id,
      plan.subject_id,
      plan.academic_year_id,
      plan.owner_override_teacher_id,
    );
    const section = await this.requireSectionWithClass(tenantId, plan.section_id);

    const examIds = markers.map((m) => m.exam_id);
    if (new Set(examIds).size !== examIds.length) {
      throw badRequest('STUDY_PLAN_MARKER_INVALID', 'Each exam can have only one marker.');
    }
    const exams = examIds.length
      ? await this.em.getRepository(Exam).count({
          where: {
            tenant_id: tenantId,
            id: In(examIds),
            class_id: section.class_id,
            academic_year_id: plan.academic_year_id,
          },
        })
      : 0;
    if (exams !== examIds.length) {
      throw badRequest(
        'STUDY_PLAN_MARKER_INVALID',
        "An exam is not of this plan's class and year.",
      );
    }
    const lessonIds = new Set(plan.lessons.map((l) => l.id));
    if (markers.some((m) => !lessonIds.has(m.up_to_lesson_id))) {
      throw badRequest(
        'STUDY_PLAN_MARKER_INVALID',
        'A marker points at a lesson that is not in the plan.',
      );
    }
    const clean = markers.map((m) => ({ exam_id: m.exam_id, up_to_lesson_id: m.up_to_lesson_id }));

    const saved = await this.em.transaction(async (manager) => {
      const repo = manager.getRepository(StudyPlan);
      await repo.update({ id: plan.id, tenant_id: tenantId }, { exam_markers: clean });
      await this.auditWrite(
        AuditAction.UPDATE,
        plan.id,
        caller,
        { exam_markers: plan.exam_markers.length },
        { exam_markers: clean.length },
        manager,
      );
      return repo.findOneByOrFail({ id: plan.id, tenant_id: tenantId });
    });
    return this.detailDto(saved, caller);
  }

  /** D6: only ADMIN (tenant data scope + SYLLABUS_MANAGE) may reassign the owner. */
  async setOwnerOverride(
    id: string,
    teacherId: string | null,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const plan = await this.loadPlan(id, tenantId);
    if (!(
      hasTenantDataScope(caller.role) && roleHasPermission(caller.role, Permission.SYLLABUS_MANAGE)
    )) {
      throw outOfScope('Only an administrator can reassign a plan owner.');
    }
    if (teacherId) {
      const t = await this.em
        .getRepository(Teacher)
        .findOne({ where: { id: teacherId, tenant_id: tenantId }, select: { id: true } });
      if (!t) throw badRequest('STUDY_PLAN_OWNER_INVALID', 'Teacher not found.');
    }
    const saved = await this.em.transaction(async (manager) => {
      const repo = manager.getRepository(StudyPlan);
      await repo.update(
        { id: plan.id, tenant_id: tenantId },
        { owner_override_teacher_id: teacherId },
      );
      await this.auditWrite(
        AuditAction.UPDATE,
        plan.id,
        caller,
        { owner_override_teacher_id: plan.owner_override_teacher_id },
        { owner_override_teacher_id: teacherId },
        manager,
      );
      return repo.findOneByOrFail({ id: plan.id, tenant_id: tenantId });
    });
    return this.detailDto(saved, caller);
  }

  /** Soft delete. Deliveries stay: they belong to section x date x period. */
  async remove(id: string, tenantId: string, caller: StudyPlanCaller): Promise<void> {
    const plan = await this.loadPlan(id, tenantId);
    await this.assertCanWrite(
      caller,
      plan.section_id,
      plan.subject_id,
      plan.academic_year_id,
      plan.owner_override_teacher_id,
    );
    await this.em.transaction(async (manager) => {
      await manager.getRepository(StudyPlan).softDelete({ id: plan.id, tenant_id: tenantId });
      await this.auditWrite(
        AuditAction.DELETE,
        plan.id,
        caller,
        { section_id: plan.section_id, subject_id: plan.subject_id },
        null,
        manager,
      );
    });
  }

  /** D18: copy to another section of the same year; the caller must be able to write the target. */
  async copyToSection(
    id: string,
    targetSectionId: string,
    tenantId: string,
    caller: StudyPlanCaller,
  ): Promise<StudyPlanDetailDto> {
    const src = await this.loadPlan(id, tenantId);
    await this.assertCanRead(caller, src);
    const srcSection = await this.requireSectionWithClass(tenantId, src.section_id);
    const target = await this.sectionWithClass(tenantId, targetSectionId);
    if (!target) throw new NotFoundException('Section not found.');

    await this.assertCanWrite(caller, target.id, src.subject_id, target.year_id);

    if (target.year_id !== src.academic_year_id) {
      throw badRequest(
        'STUDY_PLAN_COPY_INVALID',
        'The target section is in a different academic year.',
      );
    }
    await this.assertOffered(tenantId, target.class_id, src.subject_id, target.year_id);

    // Topics and markers only mean something inside the same class.
    const sameClass = target.class_id === srcSection.class_id;
    const idMap = new Map<string, string>();
    const lessons = src.lessons.map((l) => {
      const nid = randomUUID();
      idMap.set(l.id, nid);
      const copy: StudyPlanLesson = { ...l, id: nid };
      if (!sameClass) delete copy.topic_id;
      return copy;
    });
    const exam_markers = sameClass
      ? src.exam_markers
          .filter((m) => idMap.has(m.up_to_lesson_id))
          .map((m) => ({ exam_id: m.exam_id, up_to_lesson_id: idMap.get(m.up_to_lesson_id)! }))
      : [];

    const saved = await this.insertPlan(caller, {
      section_id: target.id,
      subject_id: src.subject_id,
      academic_year_id: target.year_id,
      academic_term_id: src.academic_term_id,
      lessons,
      exam_markers,
    });
    return this.detailDto(saved, caller);
  }
}
