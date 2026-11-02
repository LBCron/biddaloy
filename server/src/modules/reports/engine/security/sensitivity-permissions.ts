import { FieldSensitivity, Permission, UserRole, roleHasPermission } from '@biddaloy/shared';

/**
 * [8.15.19] Which role may see a field of each sensitivity (Epic 8.15 D5). The check uses the
 * permission the matching screen already needs, so a report never shows what the screen would hide.
 * PUBLIC fields need nothing. SENSITIVE (religion, health, disability) is ADMIN only.
 */
export function roleMaySee(role: string, sensitivity: FieldSensitivity): boolean {
  switch (sensitivity) {
    case FieldSensitivity.PUBLIC:
      return true;
    case FieldSensitivity.PERSONAL:
      return roleHasPermission(role, Permission.STUDENT_READ);
    case FieldSensitivity.CONTACT:
      return roleHasPermission(role, Permission.GUARDIAN_READ);
    case FieldSensitivity.FINANCIAL:
      return (
        roleHasPermission(role, Permission.PAYMENT_READ) ||
        roleHasPermission(role, Permission.REPORT_COLLECTIONS_READ)
      );
    case FieldSensitivity.SENSITIVE:
      return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
    default:
      return false;
  }
}
