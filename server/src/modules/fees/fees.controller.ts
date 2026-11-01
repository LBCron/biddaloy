import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  ParseUUIDPipe,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FeeStructureService, PaymentService } from './fees.service';
import { PaymentsQueryService } from './payments-query.service';
import { FeeGenerationService } from './fee-generation.service';
import { FeeDuesService } from './fee-dues.service';
import { FeesDailyScheduler } from './fees-daily.scheduler';
import { FamilyAccessService } from '../students/family-access.service';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import {
  CreateFeeStructureDto,
  UpdateFeeStructureDto,
  QueryFeeStructureDto,
  QueryPaymentDto,
  GenerateFeesPreviewDto,
  GenerateFeesDto,
  GenerateFeesPreviewResultDto,
  GenerateFeesResultDto,
  QueryFeeDuesDto,
  QueryFlaggedDuesDto,
  StaffStudentDueDto,
  PaymentDetailDto,
} from './dto/fees.dto';
// [16.8.2] Every family-facing (PARENT/STUDENT) shape on this controller
// comes from the one allow-list module — see `dto/family.dto.ts`.
import {
  toFamilyPayment,
  toFamilyStudentFee,
  toFamilyStudentDue,
  toFamilyFeeStructure,
  FamilyFeeStructureDto,
  FamilyPaymentDto,
  FamilyStudentDueDto,
} from './dto/family.dto';
import { FeeStructure } from './entities/fee-structure.entity';
import { Payment } from './entities/payment.entity';
import { Permission, UserRole, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';
import { requestContext } from '../../common/request-context.util';
import { paginatedSchema } from '../../common/swagger/paginated-schema.util';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/** The paginated envelope plus `GET /fees/dues`'s section-wide money total. */
function withTotalDueSum(base: SchemaObject): SchemaObject {
  return {
    ...base,
    required: [...(base.required ?? []), 'total_due_sum'],
    properties: {
      ...base.properties,
      total_due_sum: {
        type: 'number',
        description: 'Sum of total_due over every matched student, all pages.',
      },
    },
  };
}

// [5.1 review] Several routes below return a *role-dependent union* — the
// staff shape for staff, an allow-listed family DTO for a PARENT/STUDENT.
// Nest's swagger plugin infers response schemas from a method's return type
// and cannot express a union, so those routes generated as an untyped body
// (`Record<string, never>` in the client's `schema.d.ts`) or, worse, as the
// family-only shape that staff callers never receive. Each such route
// declares its contract explicitly with `@ApiOkResponse` + `oneOf`, following
// the `@ApiExtraModels`/`getSchemaPath` precedent in `EnrollmentController`.
@ApiTags('fees')
@ApiTenantAuth()
@ApiExtraModels(
  FeeStructure,
  FamilyFeeStructureDto,
  Payment,
  FamilyPaymentDto,
  StaffStudentDueDto,
  FamilyStudentDueDto,
)
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FeeController {
  constructor(
    @Inject(FeeStructureService) private readonly feeStructureService: FeeStructureService,
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(PaymentsQueryService) private readonly paymentsQueryService: PaymentsQueryService,
    @Inject(FeeGenerationService) private readonly feeGenerationService: FeeGenerationService,
    @Inject(FeeDuesService) private readonly feeDuesService: FeeDuesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(TeacherScopeService) private readonly teacherScope: TeacherScopeService,
    @Inject(FeesDailyScheduler) private readonly feesDailyScheduler: FeesDailyScheduler,
  ) {}

  // --- Fee Dues endpoints ---

  @Get('fees/dues')
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "List outstanding dues. Tenant-wide staff see the whole tenant (subject to the query filters); a TEACHER sees only students in their current-year assigned sections; a PARENT or STUDENT sees only their linked students' dues, whatever filters they send.",
  })
  @ApiOkResponse({
    description:
      'A page of per-student due summaries: `StaffStudentDueDto` rows for staff, `FamilyStudentDueDto` rows (no `reminder_threshold_date`) for a PARENT/STUDENT.',
    schema: withTotalDueSum(
      paginatedSchema([
        { $ref: getSchemaPath(StaffStudentDueDto) },
        { $ref: getSchemaPath(FamilyStudentDueDto) },
      ]),
    ),
  })
  async getDues(
    @Query() query: QueryFeeDuesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Family callers are narrowed to their linked students *before* the
    // query runs — `class_id`/`section_id` in the query string can only
    // narrow that set further, never widen it. `getFlaggedDues` below is
    // staff-only and returns guardian contacts, but a TEACHER there is
    // narrowed to the same assigned sections.
    if (!isGuardianRole(tenant.role)) {
      // [75.6-d] TEACHER: only current-year assigned sections (`null` = unrestricted staff).
      // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
      const scoped = await this.teacherScope.scopedStudentIds({
        role: tenant.role,
        userId: user.sub,
        tenantId: tenant.id,
      });
      return this.feeDuesService.getDues(query, tenant.id, scoped ?? undefined);
    }
    const restrictToStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.feeDuesService.getDues(query, tenant.id, restrictToStudentIds);
    // Each `dues[]` row is a `DueEntry`, which carries the internal
    // `reminder_threshold_date`. Shaped through the same allow-list DTO the
    // rest of the family surface uses.
    return { ...page, data: page.data.map(toFamilyStudentDue) };
  }

  @Get('fees/dues/flagged')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.EXECUTIVE,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
  )
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: 'List dues flagged for follow-up (e.g. overdue past a threshold).' })
  async getFlaggedDues(
    @Query() query: QueryFlaggedDuesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
    const scoped = await this.teacherScope.scopedStudentIds({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
    return this.feeDuesService.getFlaggedDues(query, tenant.id, scoped ?? undefined);
  }

  // --- Fee Generation endpoints [16.3.1] ---

  @Post('fees/generate/preview')
  @RequirePermissions(Permission.FEE_GENERATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Read-only dry run of a fee-generation request: reports inactive students, existing ' +
      'duplicate bills, and how many bills would actually be created. Writes nothing.',
  })
  previewGenerateFees(
    @Body() dto: GenerateFeesPreviewDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<GenerateFeesPreviewResultDto> {
    return this.feeGenerationService.preview(dto, tenant.id);
  }

  @Post('fees/generate')
  @RequirePermissions(Permission.FEE_GENERATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Generate exactly the picked students x fee structures x period as StudentFee bills, ' +
      'applying the chosen duplicate strategy. REMOVE_OLDER over a paid bill and ' +
      'CREATE_ANYWAY both require a fresh X-Approval-Token for scope "fees.duplicate_override" ' +
      '— missing/invalid returns 403 APPROVAL_REQUIRED and writes nothing.',
  })
  generateFees(
    @Body() dto: GenerateFeesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<GenerateFeesResultDto> {
    return this.feeGenerationService.generate(
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  // [16.7.2] Manual trigger for ops/testing — runs today's fees-daily sweep
  // (due schedules + late fees) for the caller's own tenant only.
  @Post('fees/schedules/run-now')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @RequirePermissions(Permission.SCHEDULE_MANAGE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Enqueue today's fees-daily sweep (due recurring schedules + late fees) for the " +
      "caller's own tenant. Same idempotency as the nightly cron: already-run periods are " +
      'a no-op.',
  })
  async runSchedulesNow(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<{ accepted: true }> {
    await this.feesDailyScheduler.runNow(tenant.id);
    return { accepted: true };
  }

  // --- Fee Structure endpoints ---

  @Post('fee-structures')
  @RequirePermissions(Permission.FEE_STRUCTURE_CREATE)
  createFeeStructure(
    @Body() dto: CreateFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.create(dto, tenant.id);
  }

  @Get('fee-structures')
  // [10.4] G8, FEE_READ, not FEE_STRUCTURE_READ — object-scoped read, see
  // permissions.ts. FEE_STRUCTURE_READ stays the management-page gate.
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "The school's fee catalog. Tenant-scoped but not student-scoped — it is the published price list, so no object-level check applies. [5.1] opened it to PARENT/STUDENT so the portal can explain what a due is for.",
  })
  @ApiOkResponse({
    description:
      'A page of fee structures: full `FeeStructure` rows for staff, reduced `FamilyFeeStructureDto` rows for a PARENT/STUDENT.',
    schema: paginatedSchema([
      { $ref: getSchemaPath(FeeStructure) },
      { $ref: getSchemaPath(FamilyFeeStructureDto) },
    ]),
  })
  async findAllFeeStructures(
    @Query() query: QueryFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const page = await this.feeStructureService.findAll(query, tenant.id);
    if (!isGuardianRole(tenant.role)) {
      return page;
    }
    return { ...page, data: page.data.map(toFamilyFeeStructure) };
  }

  @Get('fee-structures/:id')
  // [10.4] G8, FEE_READ, not FEE_STRUCTURE_READ — object-scoped read, see
  // permissions.ts.
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "Get one fee structure. Family callers get a reduced shape without the `selected_students` roster — that relation carries other families' children in full.",
  })
  @ApiOkResponse({
    description:
      'The full `FeeStructure` for staff; a `FamilyFeeStructureDto` without `selected_students` for a PARENT/STUDENT.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(FeeStructure) },
        { $ref: getSchemaPath(FamilyFeeStructureDto) },
      ],
    },
  })
  async findOneFeeStructure(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    const structure = await this.feeStructureService.findOne(id, tenant.id);
    // `findOne` eager-loads `selected_students.student` for the staff edit
    // dialog's student picker. Returning it raw to a PARENT/STUDENT would
    // expose unrelated children's full_name, date_of_birth, gender,
    // home_address, registration_number and user_id.
    return isGuardianRole(tenant.role) ? toFamilyFeeStructure(structure) : structure;
  }

  @Patch('fee-structures/:id')
  @RequirePermissions(Permission.FEE_STRUCTURE_UPDATE)
  updateFeeStructure(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeeStructureDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.feeStructureService.update(id, dto, tenant.id, user.sub, requestContext(request));
  }

  @Delete('fee-structures/:id')
  @RequirePermissions(Permission.FEE_STRUCTURE_DELETE)
  removeFeeStructure(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.feeStructureService.remove(id, tenant.id);
  }

  // --- Payment endpoints ---
  //
  // [16.4.2] `POST /payments` and `POST /payments/record-with-allocation`
  // are removed here — both are superseded by `POST /payments/checkout`
  // (`CheckoutController`/`CheckoutService`), which is the one write path
  // for recording a payment from here on.

  @Get('payments')
  @RequirePermissions(Permission.PAYMENT_READ)
  @ApiOperation({
    summary:
      'Search/filter payments (receipts) — transaction reference or student name/registration number, plus student, payment method, receiving staff, date range, and reversal filters.',
  })
  findAll(@Query() query: QueryPaymentDto, @CurrentTenant() tenant: { id: string; role: string }) {
    return this.paymentsQueryService.findAll(query, tenant.id);
  }

  @Get('payments/:id')
  @RequirePermissions(Permission.PAYMENT_READ)
  @ApiOperation({
    summary:
      'One payment with its allocations (enriched with fee_name/period_start), invoice, and receiving/approving staff.',
  })
  @ApiOkResponse({ type: PaymentDetailDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.paymentsQueryService.findOne(id, tenant.id);
  }

  @Get('payments/student/:studentId')
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "A student's payment history. A PARENT or STUDENT must additionally be linked to this student, and gets a reduced payment shape without staff-only fields.",
  })
  @ApiOkResponse({
    description:
      'Raw `Payment` rows for staff; reduced `FamilyPaymentDto` rows for a PARENT/STUDENT.',
    schema: {
      type: 'array',
      items: {
        oneOf: [{ $ref: getSchemaPath(Payment) }, { $ref: getSchemaPath(FamilyPaymentDto) }],
      },
    },
  })
  async findPaymentsByStudent(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const payments = await this.paymentService.findByStudent(studentId, tenant.id);
    return isGuardianRole(tenant.role) ? payments.map(toFamilyPayment) : payments;
  }

  @Get('payments/guardian/:guardianId')
  // #1379 F8: OFFICE_STAFF holds FEE_READ but deliberately not PAYMENT_READ (D16).
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER)
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: "Get every payment recorded for a guardian's linked students." })
  async findPaymentsByGuardian(
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const who = { role: tenant.role, userId: user.sub, tenantId: tenant.id };
    // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
    const scope = await this.teacherScope.assertCanSeeGuardian({ ...who, guardianId });
    const payments = await this.paymentService.findByGuardian(guardianId, tenant.id);
    // A sibling in another section is dropped for a TEACHER; `null` = unrestricted.
    // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
    const scoped = await this.teacherScope.scopedStudentIds({ ...who, scope });
    if (!scoped) return payments;
    const visible = new Set(scoped);
    return payments.filter((p) => visible.has(p.student_id));
  }

  @Get('payments/invoices/student/:studentId')
  // [10.4] G10, FEE_READ — same reasoning as `payments/student/:studentId`:
  // per-student history rides on the relationship, not the ledger permission.
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "Get a student's fee/payment/balance summary. A PARENT or STUDENT must additionally be linked to this student.",
  })
  async getInvoiceSummary(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
    const summary = await this.paymentService.getInvoiceSummary(studentId, tenant.id);
    if (!isGuardianRole(tenant.role)) {
      return summary;
    }
    return {
      ...summary,
      // Allow-listed via FamilyStudentFeeDto — see its docstring for what
      // is withheld and why.
      fee_breakdown: summary.fee_breakdown.map(toFamilyStudentFee),
      payments: summary.payments.map(toFamilyPayment),
    };
  }
}
