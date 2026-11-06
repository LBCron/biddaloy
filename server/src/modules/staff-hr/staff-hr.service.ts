import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { cardNoTaken } from '../../common/filters/known-errors';
import { AuditAction, StaffEmploymentStatus } from '@biddaloy/shared';
import { StaffHrRecord } from './entities/staff-hr-record.entity';
import { StaffDesignationHistory } from './entities/staff-designation-history.entity';
import { Designation } from './entities/designation.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
import { AuditService } from '../audit/audit.service';
import { CreateStaffHrRecordDto, UpdateStaffHrRecordDto } from './dto/staff-hr-record.dto';

/** True when `err` is a Postgres unique-violation (SQLSTATE 23505),
 * however it reached us — a raw driver error or TypeORM's
 * `QueryFailedError` wrapper, both of which surface the driver's `code`. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === '23505';
}

/**
 * Job-info CRUD plus the designation/employment-status history for one
 * staff member. 23.2.1.
 *
 * `promote()` is the one write that must be atomic (D7): it closes the
 * current open `StaffDesignationHistory` row (`end_date IS NULL`) and
 * inserts the new one in a single transaction — never an update-in-place
 * on the row being kept. Both the history write and the audit record share
 * that transaction's `EntityManager` (D11), so a failure on either side
 * rolls back the whole promotion.
 *
 * `designation_id` and `user_id` are caller-supplied, and a foreign key
 * only checks that the id exists *somewhere* — not that it belongs to the
 * caller's tenant. `create()` and `promote()` both verify the designation
 * is scoped to the caller's tenant and that the target user actually has a
 * `user_tenants` membership in that tenant before writing, so a tenant-A
 * admin can't attach a tenant-B designation or user.
 */
@Injectable()
export class StaffHrService {
  constructor(
    @InjectRepository(StaffHrRecord)
    private readonly hrRecordRepo: Repository<StaffHrRecord>,
    @InjectRepository(StaffDesignationHistory)
    private readonly historyRepo: Repository<StaffDesignationHistory>,
    @InjectRepository(Designation)
    private readonly designationRepo: Repository<Designation>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepo: Repository<StaffProfile>,
    @InjectRepository(UserTenant)
    private readonly userTenantRepo: Repository<UserTenant>,
    private readonly auditService: AuditService,
  ) {}

  /** `userId` narrows to one staff member's record — [23.9]'s HR-record
   * tab needs "does this user have a record yet" without paging the
   * tenant's whole HR-record list client-side, same reasoning as
   * `TeacherService`'s `user_id` filter. */
  async findAll(tenantId: string, userId?: string): Promise<StaffHrRecord[]> {
    return this.hrRecordRepo.find({
      where: { tenant_id: tenantId, ...(userId !== undefined ? { user_id: userId } : {}) },
    });
  }

  /** Every designation-history row for one user, newest first — [23.9]'s
   * promotion timeline. Tenant-scoped like every other read here. */
  async getDesignationHistory(
    userId: string,
    tenantId: string,
  ): Promise<StaffDesignationHistory[]> {
    return this.historyRepo.find({
      where: { user_id: userId, tenant_id: tenantId },
      order: { effective_date: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<StaffHrRecord> {
    const record = await this.hrRecordRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!record) throw new NotFoundException('Staff HR record not found');
    return record;
  }

  /** Throws unless `userId` has a real `user_tenants` membership in
   * `tenantId` — blocks attaching a HR record/promotion to a user who
   * isn't actually staff (or anything) in the caller's tenant. */
  private async assertUserInTenant(userId: string, tenantId: string): Promise<void> {
    const membership = await this.userTenantRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId },
    });
    if (!membership) {
      throw new ForbiddenException('User is not a member of this tenant');
    }
  }

  /** Throws unless `designationId` belongs to `tenantId` — blocks
   * attaching a designation that exists but is another tenant's. */
  private async assertDesignationInTenant(designationId: string, tenantId: string): Promise<void> {
    const designation = await this.designationRepo.findOne({
      where: { id: designationId, tenant_id: tenantId },
    });
    if (!designation) {
      throw new NotFoundException('Designation not found');
    }
  }

  async create(
    dto: CreateStaffHrRecordDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<StaffHrRecord> {
    await this.assertUserInTenant(dto.user_id, tenantId);

    let created: StaffHrRecord;
    try {
      created = await this.hrRecordRepo.save(
        this.hrRecordRepo.create({ ...dto, tenant_id: tenantId }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('A staff HR record already exists for this user');
      }
      throw err;
    }
    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'StaffHrRecord',
      entity_id: created.id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      new_values: { ...dto },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateStaffHrRecordDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<StaffHrRecord> {
    const existing = await this.findOne(id, tenantId);
    // [76.2.06] card_no lives on the linked staff_profiles row, not on the HR record.
    const { card_no: cardNo, ...hrFields } = dto;
    if (Object.keys(dto).length === 0) return existing;
    if (cardNo !== undefined) {
      const profile = await this.staffProfileRepo.findOne({
        where: { user_id: existing.user_id, tenant_id: tenantId },
      });
      if (!profile) throw new NotFoundException('Staff profile not found');
      try {
        await this.staffProfileRepo.update(
          { id: profile.id, tenant_id: tenantId },
          { card_no: cardNo?.trim() || null },
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw cardNoTaken();
        throw err;
      }
    }
    if (Object.keys(hrFields).length > 0) {
      await this.hrRecordRepo.update({ id, tenant_id: tenantId }, hrFields);
    }
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'StaffHrRecord',
      entity_id: id,
      tenant_id: tenantId,
      performed_by_user_id: actorUserId,
      old_values: { ...existing },
      // card_no changes are recorded as a key only, never the value (Rule 13).
      new_values: { ...hrFields, ...(cardNo !== undefined ? { card_no: '[redacted]' } : {}) },
    });
    return this.findOne(id, tenantId);
  }

  /** The open (current) designation history row for a user, or null. */
  async getCurrentDesignation(
    userId: string,
    tenantId: string,
  ): Promise<StaffDesignationHistory | null> {
    return this.historyRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId, end_date: IsNull() },
    });
  }

  /**
   * Promotes a staff member to `newDesignationId` effective `effectiveDate`.
   *
   * Close-then-insert, one transaction (D7): the current open row (if any)
   * gets `end_date` set to the day *before* `effectiveDate` — never the
   * same day, which would leave both rows "current" on the boundary date —
   * and a fresh row is inserted with `status: REGULAR` and no `end_date`.
   * The audit record is written with the same transactional
   * `EntityManager` so it commits or rolls back together with the history
   * rows (D11).
   */
  async promote(
    userId: string,
    tenantId: string,
    newDesignationId: string,
    effectiveDate: string,
    actorUserId: string,
    notes?: string,
  ): Promise<StaffDesignationHistory> {
    await this.assertUserInTenant(userId, tenantId);
    await this.assertDesignationInTenant(newDesignationId, tenantId);

    try {
      return await this.historyRepo.manager.transaction(async (manager) => {
        const historyRepo = manager.getRepository(StaffDesignationHistory);

        const current = await historyRepo.findOne({
          where: { user_id: userId, tenant_id: tenantId, end_date: IsNull() },
        });
        if (current) {
          if (new Date(effectiveDate).getTime() <= new Date(current.effective_date).getTime()) {
            throw new BadRequestException(
              "effective_date must be after the current designation's effective_date",
            );
          }
          const closedEndDate = new Date(effectiveDate);
          closedEndDate.setUTCDate(closedEndDate.getUTCDate() - 1);
          await historyRepo.update({ id: current.id }, { end_date: closedEndDate });
        }

        const created = await historyRepo.save(
          historyRepo.create({
            user_id: userId,
            tenant_id: tenantId,
            designation_id: newDesignationId,
            effective_date: new Date(effectiveDate),
            end_date: null,
            status: StaffEmploymentStatus.REGULAR,
            resigned_at: null,
            notes: notes ?? null,
          }),
        );

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'StaffDesignationHistory',
            entity_id: created.id,
            tenant_id: tenantId,
            performed_by_user_id: actorUserId,
            old_values: current ? { designation_id: current.designation_id } : null,
            new_values: { designation_id: newDesignationId, effective_date: effectiveDate },
          },
          manager,
        );

        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Another promotion for this user is already in progress or has already run',
        );
      }
      throw err;
    }
  }
}
