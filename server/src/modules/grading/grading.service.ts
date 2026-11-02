import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { GradingScale } from './entities/grading-scale.entity';
import { GradingBand } from './entities/grading-band.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { Result } from '../exams/entities/result.entity';
import { AuditService } from '../audit/audit.service';
import { CreateGradingScaleDto, UpdateGradingScaleDto } from './dto/grading.dto';
import { RequestContext } from '../../common/request-context.util';
import { assertNoLiveDependents } from '../../common/utils/live-dependents';

/**
 * [20.2.1] `GradingScale` CRUD (name/existence only — band writes go
 * through `RecomputeService`, gated by approval since they can change
 * results) and the copy-bands operation. Tenant-scoping cloned from
 * `classes.service.ts`'s `ClassService`.
 */
@Injectable()
export class GradingService {
  constructor(
    @InjectRepository(GradingScale)
    private readonly scaleRepo: Repository<GradingScale>,
    @InjectRepository(GradingBand)
    private readonly bandRepo: Repository<GradingBand>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(Result)
    private readonly resultRepo: Repository<Result>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  private async assertYearAndClassInTenant(
    tenantId: string,
    academicYearId: string,
    classId: string | null | undefined,
  ): Promise<void> {
    const year = await this.academicYearRepo.findOne({
      where: { id: academicYearId, tenant_id: tenantId },
    });
    if (!year) throw new BadRequestException('Academic year not found in this tenant');
    if (classId) {
      const cls = await this.classRepo.findOne({
        where: {
          id: classId,
          tenant_id: tenantId,
          academic_year_id: academicYearId,
          deleted_at: IsNull(),
        },
      });
      if (!cls) throw new BadRequestException('Class not found in this academic year');
    }
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: CreateGradingScaleDto,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<GradingScale> {
    await this.assertYearAndClassInTenant(tenantId, dto.academic_year_id, dto.class_id);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GradingScale);
      // [D1] Only one default (class_id: null) scale per (tenant, year) —
      // enforced by a partial unique index at the DB, checked here first
      // so a duplicate 400s with a field error instead of a raw 23505.
      const existing = await repo.findOne({
        where: {
          tenant_id: tenantId,
          academic_year_id: dto.academic_year_id,
          class_id: dto.class_id ?? IsNull(),
        },
      });
      if (existing) {
        throw new ConflictException(
          dto.class_id
            ? 'A grading scale already overrides this class for this academic year'
            : 'A default grading scale already exists for this academic year',
        );
      }

      const entity = repo.create({
        tenant_id: tenantId,
        academic_year_id: dto.academic_year_id,
        class_id: dto.class_id ?? null,
        name: dto.name,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'GradingScale',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: {
            academic_year_id: saved.academic_year_id,
            class_id: saved.class_id,
            name: saved.name,
          },
        },
        manager,
      );

      return saved;
    });
  }

  async findAll(tenantId: string, academicYearId?: string): Promise<GradingScale[]> {
    const where: Record<string, unknown> = { tenant_id: tenantId, deleted_at: IsNull() };
    if (academicYearId) where.academic_year_id = academicYearId;
    return this.scaleRepo.find({ where, order: { created_at: 'DESC' } });
  }

  async findOne(id: string, tenantId: string): Promise<GradingScale> {
    const scale = await this.scaleRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!scale) throw new NotFoundException('Grading scale not found');
    return scale;
  }

  async findBands(scaleId: string, tenantId: string): Promise<GradingBand[]> {
    return this.bandRepo.find({
      where: { scale_id: scaleId, tenant_id: tenantId, deleted_at: IsNull() },
      order: { sequence: 'ASC' },
    });
  }

  async update(
    id: string,
    tenantId: string,
    userId: string | null,
    dto: UpdateGradingScaleDto,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<GradingScale> {
    const existing = await this.findOne(id, tenantId);
    if (dto.name === undefined) return existing;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GradingScale);
      await repo.update({ id, tenant_id: tenantId }, { name: dto.name });
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'GradingScale',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: { name: dto.name },
        },
        manager,
      );
    });

    return this.findOne(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    // [68.2.12] A scale a live result points at cannot go: report cards lose
    // their legend and a reprocess would silently grade with another scale.
    const count = await this.resultRepo.count({
      where: { grading_scale_id: id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (count > 0) {
      throw new ConflictException({
        message: 'Published or processed results use this grading scale. It cannot be deleted.',
        details: { code: 'GRADING_SCALE_IN_USE', count },
      });
    }

    await this.dataSource.transaction(async (manager) => {
      // [70.2.1] A final result row pins the scale too (NO ACTION FK). Results are counted
      // above (with their count) and the scale's own bands go with it.
      await assertNoLiveDependents(manager, GradingScale, id, {
        code: 'GRADING_SCALE_IN_USE',
        message: 'Published or processed results use this grading scale. It cannot be deleted.',
        exclude: ['GradingBand.scale', 'Result.grading_scale'],
      });
      const repo = manager.getRepository(GradingScale);
      await repo.softDelete({ id, tenant_id: tenantId });
      await manager.getRepository(GradingBand).softDelete({ scale_id: id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'GradingScale',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: null,
        },
        manager,
      );
    });
  }

  /**
   * Copies `sourceId`'s bands onto `targetId` wholesale. Refused if the
   * target already has any band — never partially applied (all-or-nothing
   * inside one transaction), and never silently overwrites an existing
   * set the way the recompute flow does deliberately (that one is
   * approval-gated; this one is a convenience for an empty new scale and
   * isn't).
   */
  async copy(
    sourceId: string,
    targetId: string,
    tenantId: string,
    userId: string | null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<GradingBand[]> {
    const source = await this.findOne(sourceId, tenantId);
    const target = await this.findOne(targetId, tenantId);
    const sourceBands = await this.findBands(source.id, tenantId);
    const targetBands = await this.findBands(target.id, tenantId);

    if (targetBands.length > 0) {
      throw new ConflictException(
        'Target scale already has bands — copy refused to avoid overwriting them',
      );
    }
    if (sourceBands.length === 0) {
      throw new BadRequestException('Source scale has no bands to copy');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GradingBand);
      const created = repo.create(
        sourceBands.map((band) => ({
          tenant_id: tenantId,
          scale_id: target.id,
          percent_from: band.percent_from,
          percent_to: band.percent_to,
          grade: band.grade,
          gpa: band.gpa,
          is_fail: band.is_fail,
          sequence: band.sequence,
          comment: band.comment,
        })),
      );
      const saved = await repo.save(created);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'GradingScale',
          entity_id: target.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { copied_from_scale_id: source.id, band_count: saved.length },
        },
        manager,
      );

      return saved;
    });
  }
}
