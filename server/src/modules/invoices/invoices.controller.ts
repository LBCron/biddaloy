import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
  Header,
  Inject,
  ConflictException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { randomUUID } from 'node:crypto';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { ConfigService } from '@nestjs/config';
import { InvoicesService } from './invoices.service';
import { InvoiceShareService } from './invoice-share.service';
import { resolvePublicAppUrl } from './public-app-url.util';
import {
  CreateInvoiceDto,
  QueryInvoiceDto,
  SendInvoiceDto,
  StaffInvoiceDto,
  PrintFormatQueryDto,
  ShareLinkResponseDto,
} from './dto/invoices.dto';
// [16.8.2] The family-facing invoice shape is owned by the fees module's
// single family allow-list module, alongside every other PARENT/STUDENT
// mapper, so "what can a guardian see?" is answerable from one file.
import { toFamilyInvoice, FamilyInvoiceDto } from '../fees/dto/family.dto';
import { Invoice } from './entities/invoice.entity';
import { paginatedSchema } from '../../common/swagger/paginated-schema.util';
import {
  AuditAction,
  isGuardianRole,
  Permission,
  CommunicationMedium,
  countSmsSegments,
} from '@biddaloy/shared';
import { ExportFormat, JwtPayload, ReportRunKind } from '@biddaloy/shared';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { User } from '../users/entities/user.entity';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { Audited } from '../audit/decorators/audited.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { FamilyAccessService } from '../students/family-access.service';
import { StudentService, GuardianService } from '../students/students.service';
import {
  addressForMedium,
  resolveReminderAudience,
} from '../communications/reminder-recipients.util';
import { buildInvoiceReceiptMessage } from '../communications/invoice-template.util';
import { resolveFeeNotificationLocale } from '../communications/fee-notification-template.util';
import { CommunicationsService } from '../communications/communications.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../communications/credits/insufficient-sms-credit.constants';
import { SchoolsService } from '../schools/schools.service';
import { ReportExportService } from '../reports/export/report-export.service';
import { ReportRowSourceRegistry } from '../reports/export/report-row-sources';
import { WithExportFormat, exportFilters } from '../reports/export/dto/with-export-format';

// findOne (and create, which returns findOne's result) load the issued_by
// User relation in full — strip its password_hash before it reaches a
// response. The explicit `issued_by: UserResponseDto | null` return type
// matters, not just the runtime value: Swagger's schema generation reads
// the method's type, and a generic passthrough that stayed structurally
// typed as `T` (with `T.issued_by: User | null`) would let the full User
// entity — password_hash included — leak into the generated OpenAPI
// document as an orphaned schema even though no response returns it.
function toSafeInvoice<T extends { issued_by: User | null }>(
  invoice: T,
): Omit<T, 'issued_by'> & { issued_by: UserResponseDto | null } {
  return {
    ...invoice,
    issued_by: invoice.issued_by ? UserResponseDto.fromEntity(invoice.issued_by) : null,
  };
}

class ExportInvoicesQueryDto extends WithExportFormat(QueryInvoiceDto) {}

@ApiTags('invoices')
@ApiTenantAuth()
// [5.1 review] `findAll` and `findOne` both return a role-dependent union,
// which the swagger plugin cannot infer — see the note on `FeeController`
// and `paginatedSchema`. `findAll` leaves `issued_by` unloaded, so its staff
// rows are plain `Invoice`; `findOne` runs them through `toSafeInvoice`,
// whose narrowed `issued_by` is modelled by `StaffInvoiceDto`.
@ApiExtraModels(Invoice, StaffInvoiceDto, FamilyInvoiceDto)
@Controller('invoices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class InvoicesController implements OnModuleInit {
  constructor(
    @Inject(InvoicesService) private readonly invoicesService: InvoicesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    private readonly shareService: InvoiceShareService,
    private readonly config: ConfigService,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly communicationsService: CommunicationsService,
    private readonly smsCreditService: SmsCreditService,
    private readonly schoolsService: SchoolsService,
    private readonly reportExport: ReportExportService,
    private readonly rowSources: ReportRowSourceRegistry,
  ) {}

  /** [8.15.16] A queued export rebuilds this list by name. */
  onModuleInit(): void {
    this.rowSources.register('invoices-list', {
      header: () => this.invoicesService.exportHeader(),
      rows: (tenantId, _userId, query) =>
        this.invoicesService.iterateForExport(query as QueryInvoiceDto, tenantId),
    });
  }

  @Post()
  @RequirePermissions(Permission.INVOICE_CREATE)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @UseInterceptors(AuditInterceptor)
  @Audited(AuditAction.INVOICE_GENERATED, 'Invoice')
  async create(
    @Body() dto: CreateInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    // [16.5.1] `create()` no longer takes a free-form DTO — it builds the
    // invoice from an already-recorded payment's committed allocations.
    // `createFromPayment` tenant-checks `dto.payment_id` and opens the
    // transaction `create()` itself no longer owns.
    const invoice = await this.invoicesService.createFromPayment(dto.payment_id, tenant.id);
    return toSafeInvoice(invoice);
  }

  @Get()
  // [10.4] G9 — E, T tightened off: `/invoices` nav is hidden from them,
  // and student-detail uses `payments/invoices/student/:id` instead.
  @RequirePermissions(Permission.INVOICE_READ)
  @ApiOperation({
    summary:
      "List invoices. Staff see the tenant's invoices; a PARENT or STUDENT sees only their linked students', even if `student_id` names someone else.",
  })
  @ApiOkResponse({
    description:
      'A page of invoices: `Invoice` rows for staff, allow-listed `FamilyInvoiceDto` rows for a PARENT/STUDENT.',
    schema: paginatedSchema([
      { $ref: getSchemaPath(Invoice) },
      { $ref: getSchemaPath(FamilyInvoiceDto) },
    ]),
  })
  async findAll(
    @Query() query: QueryInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isGuardianRole(tenant.role)) {
      return this.invoicesService.findAll(query, tenant.id);
    }
    const linkedStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.invoicesService.findAll(query, tenant.id, linkedStudentIds);
    // [H1 fix] Same multi-student privacy gap as `findOne` above: a row
    // matched by `student_id` can still carry other siblings' data in its
    // `snapshot.students[]`. Filter each row down to just the students the
    // caller is already known (via `linkedStudentIds` above) to be linked
    // to, so an unlinked sibling's name/registration number/fee lines
    // never leave the server through the list endpoint either.
    const linked = new Set(linkedStudentIds);
    return {
      ...page,
      data: page.data.map(toFamilyInvoice).map((familyInvoice) => ({
        ...familyInvoice,
        snapshot: {
          ...familyInvoice.snapshot,
          students: familyInvoice.snapshot.students.filter((s) => linked.has(s.id)),
        },
      })),
    };
  }

  /** [8.15.11] Every invoice matching the list's filters as CSV/XLSX. Staff only: needs INVOICE_READ and REPORTS_EXPORT. */
  @Get('export')
  @RequirePermissions(Permission.REPORTS_EXPORT, Permission.INVOICE_READ)
  exportInvoices(
    @Query() query: ExportInvoicesQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reportExport.export({
      tenantId: tenant.id,
      userId: user.sub,
      kind: ReportRunKind.EXPORT,
      format: query.format ?? ExportFormat.CSV,
      sourceKey: 'invoices-list',
      params: exportFilters(query),
      header: this.invoicesService.exportHeader(),
      rows: this.invoicesService.iterateForExport(query, tenant.id),
      filename: 'invoices',
    });
  }

  @Get(':id')
  // [10.4] G9 — E, T tightened off; see findAll() above.
  @RequirePermissions(Permission.INVOICE_READ)
  @ApiOperation({
    summary:
      "Get one invoice. A PARENT or STUDENT must additionally be linked to the invoice's student.",
  })
  @ApiOkResponse({
    description:
      'A `StaffInvoiceDto` (the full invoice, with `issued_by` reduced to `UserResponseDto`) for staff; an allow-listed `FamilyInvoiceDto` for a PARENT/STUDENT.',
    schema: {
      oneOf: [{ $ref: getSchemaPath(StaffInvoiceDto) }, { $ref: getSchemaPath(FamilyInvoiceDto) }],
    },
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.invoicesService.findOne(id, tenant.id);
    // [664 fix] A [16.5.1] invoice can cover more than one student — a
    // sibling/multi-student checkout groups every covered child's lines
    // into one `snapshot.students[]`. Checking only `invoice.student_id`
    // (the primary/first student) let a guardian linked to just one sibling
    // see every other sibling's name/registration number/fee lines through
    // this endpoint. `assertLinkedToAny` checks the caller against the
    // *whole* student set and returns which of them are actually linked;
    // the family response is then filtered down to that subset so an
    // unlinked sibling's data never leaves the server.
    const allStudentIds = [
      invoice.student_id,
      ...(invoice.snapshot?.students?.map((s) => s.id) ?? []),
    ];
    const linkedStudentIds = await this.familyAccess.assertLinkedToAny(
      tenant.role,
      user.sub,
      allStudentIds,
      tenant.id,
    );
    if (!isGuardianRole(tenant.role)) {
      return toSafeInvoice(invoice);
    }
    const linked = new Set(linkedStudentIds);
    const familyInvoice = toFamilyInvoice(invoice);
    return {
      ...familyInvoice,
      snapshot: {
        ...familyInvoice.snapshot,
        students: familyInvoice.snapshot.students.filter((s) => linked.has(s.id)),
      },
    };
  }

  @Get(':id/print')
  // [10.4] G11 — E, T removed (no INVOICE_READ); printing an invoice you may
  // read is a read, so this requires INVOICE_READ, not INVOICE_PRINT.
  // INVOICE_PRINT stays the UI's staff print-button gate.
  @RequirePermissions(Permission.INVOICE_READ)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary:
      'Get a printable HTML rendering of the invoice, in a4 (default), pos58, or pos80 format. A PARENT or STUDENT must additionally be linked to its student, and only sees their own linked student(s) in the output.',
  })
  async print(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrintFormatQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Family callers only: resolve the invoice first so the linkage check
    // has a student to check against. `findOne` is tenant-scoped and 404s
    // before any family check runs, so an out-of-tenant id is never even
    // classified as "unlinked". Gated on the role because `assertLinked`
    // no-ops for staff, and `getPrintableHtml` re-fetches the invoice with
    // its own joins — staff should not pay for a check that cannot fail.
    let linkedStudentIds: string[] | undefined;
    if (isGuardianRole(tenant.role)) {
      const invoice = await this.invoicesService.findOne(id, tenant.id);
      // [664 fix] Same multi-student gap as `findOne` above — check the
      // caller against every student on the invoice, not just the primary
      // one.
      const allStudentIds = [
        invoice.student_id,
        ...(invoice.snapshot?.students?.map((s) => s.id) ?? []),
      ];
      // [665] The subset the caller is actually linked to — passed through
      // so `getPrintableHtml`/the templates filter `snapshot.students[]`
      // down to it, the same privacy boundary `findOne`'s JSON response
      // already enforces. A guardian linked to only one of two siblings on
      // a shared invoice must not see the other child's name/registration
      // number/fee lines in the printed HTML either.
      linkedStudentIds = await this.familyAccess.assertLinkedToAny(
        tenant.role,
        user.sub,
        allStudentIds,
        tenant.id,
      );
    }
    return this.invoicesService.getPrintableHtml(
      id,
      tenant.id,
      query.format ?? 'a4',
      linkedStudentIds,
    );
  }

  @Post(':id/share')
  // Staff only: sharing a receipt link outward is a step above merely
  // reading it in-app, so it needs `INVOICE_SEND` (#3033), not `INVOICE_READ`.
  @RequirePermissions(Permission.INVOICE_SEND)
  @ApiOperation({
    summary:
      'Mints a public share link for this invoice ({ url, token_id, expires_at }). See InvoiceShareService.createToken for why this always mints a new token rather than literally reusing an old one.',
  })
  @ApiCreatedResponse({ type: ShareLinkResponseDto })
  async createShareLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<ShareLinkResponseDto> {
    const { rawToken, tokenId, expiresAt } = await this.shareService.createToken(
      id,
      tenant.id,
      user.sub,
    );
    const baseUrl = resolvePublicAppUrl(this.config);
    return {
      url: `${baseUrl}/i/${rawToken}`,
      token_id: tokenId,
      expires_at: expiresAt.toISOString(),
    };
  }

  @Post(':id/share/regenerate')
  @RequirePermissions(Permission.INVOICE_SEND)
  @ApiOperation({
    summary:
      'Revokes every live share link of this invoice and mints a new one ({ url, token_id, expires_at }).',
  })
  @ApiCreatedResponse({ type: ShareLinkResponseDto })
  async regenerateShareLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<ShareLinkResponseDto> {
    const { rawToken, tokenId, expiresAt } = await this.shareService.regenerateToken(
      id,
      tenant.id,
      user.sub,
    );
    const baseUrl = resolvePublicAppUrl(this.config);
    return {
      url: `${baseUrl}/i/${rawToken}`,
      token_id: tokenId,
      expires_at: expiresAt.toISOString(),
    };
  }

  @Post(':id/send')
  @UseInterceptors(IdempotencyInterceptor)
  // [16.5.4] Same `INVOICE_SEND` gate as `createShareLink` above (#3033).
  @RequirePermissions(Permission.INVOICE_SEND)
  @ApiOperation({
    summary:
      'Sends the invoice receipt to a guardian over WhatsApp or SMS: mints a fresh share link ' +
      '(see InvoiceShareService.createToken) and enqueues the message via CommunicationsService. ' +
      'SMS is metered — insufficient credit 409s with details.code = INSUFFICIENT_SMS_CREDIT.',
  })
  async sendInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInvoiceDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const invoice = await this.invoicesService.findOne(id, tenant.id);

    const guardian = dto.guardian_id
      ? await this.resolveExplicitGuardian(invoice, dto.guardian_id, tenant.id)
      : await this.resolvePrimaryReminderGuardian(invoice.student_id, tenant.id);

    const address = addressForMedium(guardian, dto.medium);
    if (!address) {
      throw new BadRequestException({
        message: 'This guardian has no address on file for the chosen medium.',
        details: { medium: dto.medium },
      });
    }

    const { rawToken } = await this.shareService.createToken(id, tenant.id, user.sub);
    const baseUrl = resolvePublicAppUrl(this.config);
    const shareUrl = `${baseUrl}/i/${rawToken}`;

    const settings = await this.schoolsService.getResolvedSettings(tenant.id);
    const locale = resolveFeeNotificationLocale(settings.region?.locale);
    const message = buildInvoiceReceiptMessage(
      locale,
      invoice.invoice_number,
      Number(invoice.snapshot.totals.paid),
      shareUrl,
    );

    let smsCreditReservation: { batchId: string; segments: number } | undefined;
    if (dto.medium === CommunicationMedium.SMS) {
      const metered = await this.smsCreditService.isMetered(tenant.id);
      if (metered) {
        const segments = countSmsSegments(message).segments;
        // Key convention (#1317): reserve `batch:<batchId>`, pass the bare batchId.
        // Per-send id: a re-send must reserve (and be capped) on its own.
        const sendId = randomUUID();
        const batchId = `invoice-send:${id}:${guardian.id}:${sendId}`;
        const reservation = await this.smsCreditService.reserve(
          tenant.id,
          segments,
          `batch:${batchId}`,
          { type: 'batch', id: sendId },
        );
        if (!reservation.ok) {
          throw new ConflictException({
            message: 'Insufficient SMS credit to send this invoice.',
            details: {
              code: INSUFFICIENT_SMS_CREDIT,
              required: segments,
              available: reservation.available,
            },
          });
        }
        smsCreditReservation = { batchId, segments };
      }
    }

    return this.communicationsService.enqueue(
      {
        medium: dto.medium,
        recipient_address: address,
        recipient_name: guardian.full_name,
        message_body: message,
        guardian_id: guardian.id,
      },
      tenant.id,
      user.sub,
      smsCreditReservation,
    );
  }

  /** `dto.guardian_id`, validated against both the tenant
   * (`GuardianService.findOne` 404s on mismatch) and this invoice's
   * student(s) — otherwise a caller could message an unrelated guardian
   * elsewhere in the same school by supplying an arbitrary id. Mirrors
   * `SingleReminderService.resolveExplicitGuardians`. */
  private async resolveExplicitGuardian(invoice: Invoice, guardianId: string, tenantId: string) {
    const guardian = await this.guardianService.findOne(guardianId, tenantId);
    const student = await this.studentService.findOne(invoice.student_id, tenantId);
    const linkedIds = new Set((student.guardians ?? []).map((g) => g.id));
    if (!linkedIds.has(guardian.id)) {
      throw new BadRequestException("This guardian is not linked to the invoice's student.");
    }
    return guardian;
  }

  /** No explicit `guardian_id`: falls back to the student's primary
   * reminder guardian (`resolveReminderAudience`), same default the
   * automated fee/payment notifications use. */
  private async resolvePrimaryReminderGuardian(studentId: string, tenantId: string) {
    const student = await this.studentService.findOne(studentId, tenantId);
    const linked = student.guardians ?? [];
    if (linked.length === 0) {
      throw new BadRequestException('This student has no guardians on file');
    }
    const { guardians } = resolveReminderAudience(linked);
    if (guardians.length === 0) {
      throw new BadRequestException(
        'This student has no reachable guardian to send this invoice to.',
      );
    }
    return guardians[0];
  }

  @Get(':id/share')
  @RequirePermissions(Permission.INVOICE_SEND)
  @ApiOperation({ summary: "Lists this invoice's share tokens (never exposes token_hash)." })
  async listShareLinks(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string; role: string },
  ) {
    return this.shareService.listTokens(id, tenant.id);
  }

  @Delete(':id/share/:tokenId')
  @RequirePermissions(Permission.INVOICE_SEND)
  @ApiOperation({ summary: 'Revokes a share token — permanent, no un-revoke.' })
  async revokeShareLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    // `id` is validated as a UUID (route-shape/404 consistency with the
    // other :id routes) but `revokeToken` itself scopes strictly by
    // `tokenId` + `tenant.id` — a mismatched `id` here can't revoke a
    // token belonging to a different invoice, since `tokenId` alone
    // already uniquely identifies the row.
    await this.shareService.revokeToken(tokenId, tenant.id, user.sub);
  }
}
