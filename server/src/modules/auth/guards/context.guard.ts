import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload, JwtMembership, UserRole, SchoolStatus } from '@biddaloy/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from '../decorators/allow-when-suspended-for-billing.decorator';
import { ALLOW_WHEN_READ_ONLY_KEY } from '../decorators/allow-when-read-only.decorator';
import {
  BILLING_SUSPENSION_REASONS,
  TenantStatusService,
  tenantRestoringException,
} from '../../schools/tenant-status.service';

/**
 * Priority ordering for role fallback when a user has multiple roles
 * within the same tenant. The highest-priority role is chosen.
 */
const ROLE_PRIORITY: Record<string, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 90,
  ACCOUNTANT: 80,
  EXECUTIVE: 75,
  TEACHER: 70,
  EXAM_CONTROLLER: 68,
  OFFICE_STAFF: 66,
  COMMITTEE: 64,
  PARENT: 60,
  STUDENT: 50,
};

/**
 * True only when the JWT holds a SUPER_ADMIN membership on the one
 * designated platform tenant (resolved by `TenantStatusService.platformTenantId()`)
 * — never "any membership anywhere with role SUPER_ADMIN".
 *
 * That distinction is the whole fix for a real privilege escalation: a
 * tenant ADMIN used to be able to mint a tenant-LOCAL SUPER_ADMIN user via
 * `POST /users` (#731 — `UserService.create` now refuses that role). Rows
 * minted before that fix can still exist, so this pin stays load-bearing:
 * without it, such a locally-minted SUPER_ADMIN's JWT would satisfy the old
 * "any membership" check and grant them access to every OTHER school's
 * tenant via `X-Tenant-ID`.
 *
 * `platformTenantId` unresolved (undefined) means no membership qualifies —
 * fails closed. See `TenantStatusService.platformTenantId()` for how that id is obtained:
 * an explicit `PLATFORM_TENANT_ID` always wins; in production, unset means
 * this stays undefined forever; outside production it's discovered from the
 * database instead.
 */
function isPlatformSuperAdmin(
  memberships: JwtMembership[],
  platformTenantId: string | undefined,
): boolean {
  if (!platformTenantId) return false;
  return memberships.some(
    (m: JwtMembership) => m.tenantId === platformTenantId && m.role === UserRole.SUPER_ADMIN,
  );
}

/**
 * Computes the current active role. If the user has a single membership
 * in the tenant, that role is used. If multiple, the highest-priority role
 * wins unless the client explicitly sends X-Role.
 */
function resolveRole(
  memberships: JwtMembership[],
  tenantId: string,
  explicitRole: string | undefined,
  platformTenantId: string | undefined,
): string | null {
  const tenantMemberships = memberships.filter((m: JwtMembership) => m.tenantId === tenantId);
  const platformAuthority = isPlatformSuperAdmin(memberships, platformTenantId);

  if (tenantMemberships.length === 0) {
    // [14.13.3] A genuine platform SUPER_ADMIN's authority is platform-wide,
    // not per-tenant, so they never have a membership row for a tenant they
    // just provisioned or are managing. Without this, provisioning a
    // brand-new school and immediately trying to act on it (e.g.
    // restore-from-workbook right after create) 401s here before ever
    // reaching the suspension check below. Any explicit X-Role other than
    // SUPER_ADMIN itself is refused — a SUPER_ADMIN cannot borrow a
    // tenant-local role (ADMIN, TEACHER, ...) they don't actually hold.
    if (platformAuthority && (!explicitRole || explicitRole === UserRole.SUPER_ADMIN)) {
      return UserRole.SUPER_ADMIN;
    }
    return null;
  }

  // If client explicitly requested a role, validate it exists
  if (explicitRole) {
    const match = tenantMemberships.find((m: JwtMembership) => m.role === explicitRole);
    if (match) return match.role;
    // The client always sends X-Role: SUPER_ADMIN (see ui/src/api/client.ts).
    // A genuine platform SUPER_ADMIN who ALSO happens to hold an unrelated
    // membership in THIS tenant (e.g. invited as ADMIN before being promoted
    // to platform SUPER_ADMIN) must still get SUPER_ADMIN here instead of
    // falling through to "User is not a member of the requested tenant" — the tenant-membership
    // fallback below only fires when there is NO membership at all.
    if (explicitRole === UserRole.SUPER_ADMIN && platformAuthority) {
      return UserRole.SUPER_ADMIN;
    }
    return null; // explicit role not found in this tenant
  }

  // Priority fallback: pick the highest-priority role
  return tenantMemberships.reduce((best: JwtMembership, current: JwtMembership) => {
    const currentPriority = ROLE_PRIORITY[current.role] ?? 0;
    const bestPriority = ROLE_PRIORITY[best.role] ?? 0;
    return currentPriority > bestPriority ? current : best;
  }).role;
}

/**
 * Extracts the `X-Tenant-ID` header and validates it against the user's
 * JWT memberships. Attaches the active context to `req.currentTenant`.
 *
 * If the user has multiple roles in the same tenant, the highest-priority
 * role is selected unless `X-Role` is explicitly provided.
 *
 * A membership-less platform SUPER_ADMIN (see `isPlatformSuperAdmin` above)
 * is the one exception to "the tenant ID must be in the user's memberships":
 * they may act on ANY existing, non-suspended tenant. Refused (401/404) if
 * that tenant id doesn't resolve to a real school — see the tenant
 * resolution block below, which runs for every SUPER_ADMIN request except
 * one targeting their own platform tenant.
 *
 * Throws 401 if:
 * - X-Tenant-ID is missing
 * - The tenant ID is not in the user's memberships (and they hold no
 *   platform SUPER_ADMIN authority either)
 * - The explicit X-Role is not found in the tenant's memberships
 * - A platform SUPER_ADMIN targets a tenant id that doesn't resolve to an
 *   existing school
 *
 * Throws 403 if the resolved tenant is SUSPENDED — including for a platform
 * SUPER_ADMIN acting on a tenant other than their own: platform authority is
 * not an override of a school's suspended status, only of the "must hold a
 * membership" requirement.
 */
@Injectable()
export class ContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    const tenantId = request.headers['x-tenant-id'];
    if (!tenantId) {
      throw new UnauthorizedException('X-Tenant-ID header is required');
    }

    const platformTenantId = await this.tenantStatus.platformTenantId();
    const explicitRole = request.headers['x-role'] as string | undefined;
    const activeRole = resolveRole(user.memberships, tenantId, explicitRole, platformTenantId);

    if (!activeRole) {
      throw new UnauthorizedException('User is not a member of the requested tenant');
    }

    // A SUPER_ADMIN acting on their OWN platform tenant (the /schools
    // console — list/manage schools — is a platform route, not a
    // tenant-scoped one) is never subject to the suspension check: that
    // tenant is the platform's own home and must always be reachable.
    const isOwnPlatformTenant =
      activeRole === UserRole.SUPER_ADMIN && tenantId === platformTenantId;

    if (!isOwnPlatformTenant) {
      // Every other request — including a platform SUPER_ADMIN acting on
      // SOME OTHER tenant via their platform authority, who has no
      // membership row to fall back on — resolves the tenant explicitly so
      // a nonexistent/malformed id gives a clean 401 instead of reaching a
      // downstream `findOneOrFail` and 500ing, and so a SUSPENDED school
      // stays blocked rather than becoming writable by accident.
      const status = await this.tenantStatus.getStatus(tenantId);
      if (status === null) {
        throw new UnauthorizedException('The requested tenant does not exist');
      }
      if (status !== SchoolStatus.ACTIVE) {
        const reason = await this.tenantStatus.getStatusReason(tenantId);
        // D16: an ended trial may still export. Only a route marked
        // @AllowWhenSuspendedForBilling, only SUSPENDED + TRIAL_EXPIRED; PermissionsGuard
        // still checks the permission. The final yes comes from an uncached DB read
        // (`isSuspendedForBilling`), so a stale cached reason cannot keep export open (#2399).
        const trialExportAllowed =
          status === SchoolStatus.SUSPENDED &&
          BILLING_SUSPENSION_REASONS.includes(reason ?? '') &&
          this.reflector.get<boolean>(
            ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY,
            context.getHandler(),
          ) === true &&
          (await this.tenantStatus.isSuspendedForBilling(tenantId));
        if (!trialExportAllowed) {
          throw new ForbiddenException({
            message: 'This school has been suspended',
            details: {
              code: 'TENANT_SUSPENDED',
              ...(reason && BILLING_SUSPENSION_REASONS.includes(reason) ? { reason } : {}),
            },
          });
        }
      }
    }

    // Seat grace (Epic 49 D9): an ACTIVE school over its seats can read but not write until the
    // daily job suspends it. Platform tenant exempt. Handlers marked @AllowWhenSuspendedForBilling
    // stay open; the billing routes must carry that mark (billing lane) for a school to pay.
    // One message for every write (Rule 23); `until` is the school's own date, not an echo of input.
    if (!isOwnPlatformTenant && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // @AllowWhenReadOnly: a user's own writes (alerts seen, step-up, push, preferences).
      const allowed =
        this.reflector.get<boolean>(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, context.getHandler()) ===
          true ||
        this.reflector.get<boolean>(ALLOW_WHEN_READ_ONLY_KEY, context.getHandler()) === true;
      if (!allowed) {
        const until = await this.tenantStatus.getReadOnlyUntil(tenantId);
        if (until) {
          throw new ForbiddenException({
            message: 'This school is read-only',
            details: { code: 'TENANT_READ_ONLY', until: until.toISOString() },
          });
        }
      }
    }

    // A restore is replacing this school's data: refuse writes (not reads) so nothing saved
    // mid-restore is wiped by it or missed by its snapshot (#2210). Outside the platform-tenant
    // exemption above: a platform SUPER_ADMIN holds BACKUP_MANAGE and can start a restore of
    // their own tenant too.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (await this.tenantStatus.isRestoring(tenantId))
    ) {
      throw tenantRestoringException();
    }

    // Attach active context to request for downstream use
    request.currentTenant = {
      id: tenantId,
      role: activeRole,
    };

    request.currentUser = user;
    // Lets platform-only routes (`PlatformSuperAdminGuard`) tell a genuine
    // platform SUPER_ADMIN from a legacy tenant-local one: both resolve to
    // `currentTenant.role === 'SUPER_ADMIN'`.
    request.isPlatformSuperAdmin = isPlatformSuperAdmin(user.memberships, platformTenantId);

    return true;
  }
}

/**
 * Restricts endpoint access based on the active role from ContextGuard.
 * Throws 403 if the active role is not in the allowed set.
 *
 * Usage:
 * @UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard)
 * @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified, allow access (role-agnostic endpoint)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const currentTenant = request.currentTenant;

    if (!currentTenant) {
      throw new UnauthorizedException('No active tenant context');
    }

    // SUPER_ADMIN bypasses all role checks
    if (currentTenant.role === 'SUPER_ADMIN') {
      return true;
    }

    const hasRole = requiredRoles.includes(currentTenant.role);
    if (!hasRole) {
      throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
