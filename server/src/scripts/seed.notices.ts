import type { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NoticeRecipientKind, NoticeStatus, UserRole } from '@biddaloy/shared';
import { Notice } from '../modules/notices/entities/notice.entity';
import { NoticesService } from '../modules/notices/notices.service';
import { NoticeRecipientsService } from '../modules/notices/notice-recipients.service';
import { DEMO_ACADEMIC_YEAR } from './seed.util';

/** The one notice the e2e seed publishes; `e2e/responsive/routes.ts` finds it by this title. */
export const E2E_NOTICE_TITLE = 'E2E seeded notice';

/** The guardian behind `parent@biddaloy.test` (see `ensureDemoStudents`). */
const PARENT_GUARDIAN_EMAIL = 'guardian1@biddaloy.test';

/**
 * [53.4 / #3382] One PUBLISHED notice for `parent@biddaloy.test`'s roll-1 child, written through
 * the real services so the rules run. It gives the route manifest's `$noticeId` entries (staff
 * detail, staff edit, portal detail) a real notice to open. Find-or-create by title: a re-run, or
 * a hand-withdrawn copy, is left alone. No attachment, no public link, no SMS, no real contact.
 */
export async function ensureNoticeSeed(
  app: INestApplicationContext,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  const ds = app.get(DataSource);
  const existing = await ds
    .getRepository(Notice)
    .findOne({ where: { tenant_id: tenantId, title: E2E_NOTICE_TITLE } });
  if (existing) return;
  const [student] = await ds.query(
    `SELECT id FROM students WHERE tenant_id = $1 AND registration_number = $2 AND deleted_at IS NULL`,
    [tenantId, `${DEMO_ACADEMIC_YEAR.name}-0001`],
  );
  const [guardian] = await ds.query(
    `SELECT id FROM guardians WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL`,
    [tenantId, PARENT_GUARDIAN_EMAIL],
  );
  if (!student || !guardian) {
    console.warn('Demo student/guardian not found - skipping notice seed.');
    return;
  }
  const actor = { userId: adminUserId, role: UserRole.ADMIN };
  const notices = app.get(NoticesService);
  const notice = await notices.create(tenantId, actor, {
    title: E2E_NOTICE_TITLE,
    body: 'This notice exists so the route sweeps have a real one to open.',
  });
  await app
    .get(NoticeRecipientsService)
    .add(tenantId, actor, notice.id, [
      { kind: NoticeRecipientKind.GUARDIAN, studentId: student.id, guardianId: guardian.id },
    ]);
  const published = await notices.publish(tenantId, actor, notice.id, false);
  if (published.status !== NoticeStatus.PUBLISHED) {
    throw new Error(`notice seed did not publish (status ${published.status})`);
  }
}
