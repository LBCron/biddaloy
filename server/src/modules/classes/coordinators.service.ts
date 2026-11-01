import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { CoordinatorAssignment } from '../academics/entities/coordinator-assignment.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { Class } from '../academics/entities/class.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  AssignCoordinatorsDto,
  CoordinatorAssignmentDto,
  ListCoordinatorsQueryDto,
} from './dto/coordinators.dto';

/**
 * [83.2.2] One fixed sentence per failure, never the submitted ids or names (Rule 23).
 * Every miss — teacher, any class, the subject, the row — is the same 404 text, so the answer
 * does not say which id was wrong (or that it exists in another school).
 */
export const COORDINATOR_NOT_FOUND = 'Coordinator assignment not found';
export const COORDINATOR_DUPLICATE = 'This coordinator assignment already exists.';
export const COORDINATOR_NOT_CURRENT_YEAR =
  'Coordinators can be assigned only to classes of the current academic year.';

const UNIQUE_INDEX = 'UQ_coordinator_assignment';

/**
 * Admin CRUD of `coordinator_assignments` (Epic 83 D20, D21). Lives next to the tcs routes and
 * `TeacherScopeService`; it never reads or writes `teacher_class_sections` (D2).
 * Every query filters `tenant_id`.
 */
@Injectable()
export class CoordinatorsService {
  constructor(
    @InjectRepository(CoordinatorAssignment)
    private readonly repo: Repository<CoordinatorAssignment>,
    @InjectRepository(Teacher) private readonly teacherRepo: Repository<Teacher>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Creates one row per class, in one transaction: all or none. A duplicate of any class is a
   * 409 for the whole call (D11 unique, NULLS NOT DISTINCT).
   */
  async assign(
    tenantId: string,
    actorUserId: string | null,
    dto: AssignCoordinatorsDto,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<CoordinatorAssignmentDto[]> {
    const subjectId = dto.subjectId ?? null;
    const teacher = await this.teacherRepo.findOne({
      where: { id: dto.teacherId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!teacher) throw new NotFoundException(COORDINATOR_NOT_FOUND);

    const classIds = [...new Set(dto.classIds)];
    const classes = await this.classRepo.find({
      where: { id: In(classIds), tenant_id: tenantId, deleted_at: IsNull() },
      relations: { academic_year: true },
    });
    if (classes.length !== classIds.length) throw new NotFoundException(COORDINATOR_NOT_FOUND);
    // D3/D14: a coordinator covers the current year only; a past class would never be read.
    if (
      classes.some(
        (c) => !c.academic_year || !c.academic_year.is_current || c.academic_year.deleted_at,
      )
    ) {
      throw new UnprocessableEntityException(COORDINATOR_NOT_CURRENT_YEAR);
    }

    if (subjectId !== null) {
      const subject = await this.subjectRepo.findOne({
        where: { id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!subject) throw new NotFoundException(COORDINATOR_NOT_FOUND);
    }

    let ids: string[];
    try {
      ids = await this.repo.manager.transaction(async (manager) => {
        const rows = await manager.getRepository(CoordinatorAssignment).save(
          classIds.map((classId) => ({
            tenant_id: tenantId,
            teacher_id: teacher.id,
            class_id: classId,
            subject_id: subjectId,
            assigned_by_user_id: actorUserId,
          })),
        );
        for (const row of rows) {
          await this.auditService.record(
            {
              action: AuditAction.CREATE,
              entity_type: 'CoordinatorAssignment',
              entity_id: row.id,
              tenant_id: tenantId,
              performed_by_user_id: actorUserId,
              ip_address: context.ip,
              user_agent: context.userAgent,
              old_values: null,
              new_values: {
                teacher_id: row.teacher_id,
                class_id: row.class_id,
                subject_id: row.subject_id,
              },
            },
            manager,
          );
        }
        return rows.map((r) => r.id);
      });
    } catch (error) {
      if (isDuplicate(error)) throw new ConflictException(COORDINATOR_DUPLICATE);
      throw error;
    }
    return this.list(tenantId, {}, ids);
  }

  /** Rows of the tenant, by teacher and/or class; ordered class, then teacher, then subject. */
  async list(
    tenantId: string,
    query: ListCoordinatorsQueryDto,
    onlyIds?: string[],
  ): Promise<CoordinatorAssignmentDto[]> {
    const qb = this.repo
      .createQueryBuilder('ca')
      .innerJoin('teachers', 't', 't.id = ca.teacher_id AND t.tenant_id = :tenantId', {
        tenantId,
      })
      .innerJoin('users', 'u', 'u.id = t.user_id')
      .innerJoin('classes', 'c', 'c.id = ca.class_id AND c.tenant_id = :tenantId', { tenantId })
      .leftJoin('subjects', 's', 's.id = ca.subject_id AND s.tenant_id = :tenantId', { tenantId })
      .leftJoin('users', 'ab', 'ab.id = ca.assigned_by_user_id')
      .select('ca.id', 'id')
      .addSelect('ca.teacher_id', 'teacher_id')
      .addSelect('u.full_name', 'teacher_name')
      .addSelect('ca.class_id', 'class_id')
      .addSelect('c.name', 'class_name')
      .addSelect('ca.subject_id', 'subject_id')
      .addSelect('s.name_en', 'subject_name')
      .addSelect('ab.full_name', 'assigned_by_name')
      .addSelect('ca.created_at', 'created_at')
      .where('ca.tenant_id = :tenantId', { tenantId })
      .andWhere('t.deleted_at IS NULL')
      .andWhere('c.deleted_at IS NULL');
    if (query.teacherId) qb.andWhere('ca.teacher_id = :teacherId', { teacherId: query.teacherId });
    if (query.classId) qb.andWhere('ca.class_id = :classId', { classId: query.classId });
    if (onlyIds) qb.andWhere('ca.id IN (:...onlyIds)', { onlyIds });
    const rows = await qb
      .orderBy('c.numeric_grade', 'ASC', 'NULLS LAST')
      .addOrderBy('c.name', 'ASC')
      .addOrderBy('u.full_name', 'ASC')
      .addOrderBy('s.name_en', 'ASC', 'NULLS FIRST')
      .getRawMany<Omit<CoordinatorAssignmentDto, 'created_at'> & { created_at: Date }>();
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }

  /** Deletes the tenant's row; another tenant's id is the same 404 as a missing one. */
  async remove(
    tenantId: string,
    id: string,
    actorUserId: string | null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException(COORDINATOR_NOT_FOUND);
    await this.repo.manager.transaction(async (manager) => {
      await manager.getRepository(CoordinatorAssignment).delete({ id, tenant_id: tenantId });
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'CoordinatorAssignment',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: {
            teacher_id: row.teacher_id,
            class_id: row.class_id,
            subject_id: row.subject_id,
          },
          new_values: null,
        },
        manager,
      );
    });
  }
}

function isDuplicate(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const { code, constraint } = error.driverError as { code?: string; constraint?: string };
  return code === '23505' && constraint === UNIQUE_INDEX;
}
