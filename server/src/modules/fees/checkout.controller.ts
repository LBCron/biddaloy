import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ApprovalGuard, ApprovalContext } from '../auth/guards/approval.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireApproval } from '../auth/decorators/require-approval.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../students/family-access.service';
import { CheckoutCartService } from './checkout-cart.service';
import { CheckoutService } from './checkout.service';
import { PaymentReversalService } from './payment-reversal.service';
import {
  CartResultDto,
  CheckoutDto,
  CheckoutResultDto,
  QueryCheckoutCartDto,
} from './dto/checkout.dto';
import { Payment } from './entities/payment.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { ApprovalScope, JwtPayload, Permission, isGuardianRole } from '@biddaloy/shared';

/** `POST /payments/:id/reverse` (16.6.1) body — just the audit-trail
 * reason, everything else about the reversal is derived server-side from
 * the payment itself. Declared inline rather than in `dto/checkout.dto.ts`
 * — this ticket's file territory doesn't include that file. */
class ReversePaymentDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

/**
 * `GET /payments/cart` (16.4.1) — the read side the Record Payment modal is
 * built on: every open bill for one or more students, wallet balance, and
 * an oldest-first allocation suggestion for a given amount.
 *
 * Gated on `FEE_READ`, not `PAYMENT_RECORD` — the same split
 * `payments/student/:studentId` already makes (`fees.controller.ts`):
 * `PAYMENT_RECORD` is the staff-only *write*, but a PARENT/STUDENT must be
 * able to load this same read-only view for their own child before a
 * payment is ever recorded. 16.4.2 appends the POST that actually records
 * one, gated on `PAYMENT_RECORD` as usual.
 */
@ApiTags('fees')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, ApprovalGuard)
export class CheckoutController {
  constructor(
    @Inject(CheckoutCartService) private readonly checkoutCartService: CheckoutCartService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(TeacherScopeService) private readonly teacherScope: TeacherScopeService,
    @Inject(CheckoutService) private readonly checkoutService: CheckoutService,
    @Inject(PaymentReversalService)
    private readonly paymentReversalService: PaymentReversalService,
  ) {}

  @Get('payments/cart')
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({
    summary:
      "Open bills, wallet balance and (with `amount`) a suggested allocation for one or more students. Staff may request any of their tenant's students; a PARENT/STUDENT must be linked to every student_id requested.",
  })
  @ApiOkResponse({ type: CartResultDto })
  async getCart(
    @Query() query: QueryCheckoutCartDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (isGuardianRole(tenant.role)) {
      const linkedIds = await this.familyAccess.getLinkedStudentIds(
        tenant.role,
        user.sub,
        tenant.id,
      );
      const linked = new Set(linkedIds);
      const hasUnlinkedStudent = query.student_ids.some((id) => !linked.has(id));
      if (hasUnlinkedStudent) {
        throw new ForbiddenException(
          "You do not have access to one or more of these students' information",
        );
      }
    }

    // [75.6-d] TEACHER: any student outside current-year assigned sections is a 404 (D13).
    // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
    const scoped = await this.teacherScope.scopedStudentIds({
      role: tenant.role,
      userId: user.sub,
      tenantId: tenant.id,
    });
    if (scoped) {
      const visible = new Set(scoped);
      if (query.student_ids.some((id) => !visible.has(id))) {
        throw new NotFoundException('Student not found');
      }
    }

    return this.checkoutCartService.getCart(query.student_ids, tenant.id, query.amount);
  }

  @Post('payments/checkout')
  @RequirePermissions(Permission.PAYMENT_RECORD)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Record a payment across one or more students' bills — wallet credit, one-off discounts (behind the fees.discount approval), tendered cash and change, all in one idempotent, locked transaction. A repeat with an already-used idempotency_key returns 200 with the original payment instead of 201.",
  })
  @ApiCreatedResponse({ description: 'Payment recorded.', type: CheckoutResultDto })
  @ApiOkResponse({
    description: 'Idempotent replay: an already-recorded payment for this idempotency_key.',
    type: CheckoutResultDto,
  })
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const meta = { replayed: false };
    const result = await this.checkoutService.checkout(
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
      meta,
    );
    if (meta.replayed) {
      response.status(HttpStatus.OK);
    }
    return result;
  }

  @Post('payments/:id/reverse')
  @RequirePermissions(Permission.PAYMENT_REVERSE)
  @RequireApproval(ApprovalScope.PAYMENTS_REVERSE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reverse a recorded payment in full (16.6.1): unwinds any wallet credit it added or spent, restores the bills it paid toward, cancels its invoice via a credit note, and marks the original payment as reversed. Requires a fresh payments.reverse approval token.',
  })
  @ApiOkResponse({ description: 'Payment reversed.', type: Payment })
  async reversePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePaymentDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<Payment> {
    // Stamped onto the request by `ApprovalGuard` after it consumes the
    // `X-Approval-Token` for `ApprovalScope.PAYMENTS_REVERSE` — guaranteed
    // present here since `@RequireApproval` makes the guard mandatory for
    // this route. Guarded explicitly (rather than trusting the cast alone)
    // so a future guard-ordering regression fails with a clear 500 message
    // instead of a bare `undefined.approverId` TypeError.
    const approval = (request as unknown as { approval?: ApprovalContext }).approval;
    if (!approval) {
      throw new InternalServerErrorException(
        'ApprovalGuard did not run before reversePayment — @RequireApproval guard misconfigured',
      );
    }
    return this.paymentReversalService.reverse(
      id,
      tenant.id,
      user.sub,
      approval.approverId,
      dto.reason,
    );
  }
}
