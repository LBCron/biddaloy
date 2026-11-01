import { NoticeRecipientKind, UserRole } from '@biddaloy/shared';
import type { DemoSeedContext, DemoSlice } from '../context';
import { Notice } from '../../../modules/notices/entities/notice.entity';
import { NoticeAttachment } from '../../../modules/notices/entities/notice-attachment.entity';
import { NoticeRecipient } from '../../../modules/notices/entities/notice-recipient.entity';
import { NoticesService } from '../../../modules/notices/notices.service';
import { NoticeRecipientsService } from '../../../modules/notices/notice-recipients.service';
import { NoticeLinksService } from '../../../modules/notices/links/notice-links.service';
import { NoticeFilesService } from '../../../modules/notices/access/notice-files.service';
import { NoticeSmsService } from '../../../modules/notices/sms/notice-sms.service';
import { NoticeReaderService } from '../../../modules/notices/access/notice-reader.service';
import { orgIds } from './org';
import { staffByCardKey, teachersByTenant } from './staff';
import { studentIds } from './students';

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
/** A moment in Asia/Dhaka (UTC+6), the same helper shape the comms slice uses. */
const at = (date: string, hh: number) =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+06:00`);

// A tiny valid PDF and a 1x1 PNG, so the files pass the signature check (Rule 6).
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const file = (name: string, mimetype: string, buffer: Buffer) =>
  ({ originalname: name, mimetype, buffer, size: buffer.length }) as Express.Multer.File;

/**
 * [53.3.0x / #3374] The demo school's notice board: 12 notices (8 plus 4 SMS requests, [53.5.05]) over the term, written through the
 * real services (create, recipients, files, publish, withdraw, acknowledge) so every rule runs.
 * Only the clock-dependent columns are set by SQL afterwards: the services stamp "now", the demo
 * wants dates derived from the anchor.
 */
export const slice: DemoSlice = {
  name: 'notices',
  covers: [Notice, NoticeAttachment, NoticeRecipient],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const tenant = org.tenants.find((t) => t.kind === 'HIGH')!;
    const T = tenant.id;
    const notices = ctx.app.get(NoticesService);
    const recipients = ctx.app.get(NoticeRecipientsService);
    const files = ctx.app.get(NoticeFilesService);
    const reader = ctx.app.get(NoticeReaderService);
    const links = ctx.app.get(NoticeLinksService);
    const sms = ctx.app.get(NoticeSmsService);

    const { students, guardians, cards } = studentIds(ctx);
    const guardianById = new Map(guardians.map((g) => [g.id, g]));
    // The guardian card must see exactly 3 notices, so the card's family is kept out of every other one.
    const cardGuardian = guardians.find(
      (g) => g.userId === cards.guardianUserId && g.tenantId === T,
    );
    const inCardFamily = (s: (typeof students)[number]) =>
      !!cardGuardian && s.guardianIds.includes(cardGuardian.id);
    const cardKids = students.filter((s) => s.tenantId === T && inCardFamily(s));
    const pool = students.filter((s) => s.tenantId === T && !inCardFamily(s) && s.guardianIds[0]);
    const some = <X>(items: X[], n: number): X[] =>
      ctx.rng.helpers.arrayElements(items, Math.min(n, items.length));

    const admin = { userId: org.adminUserId, role: UserRole.ADMIN };
    const teacherUser = staffByCardKey(ctx).get('class-teacher-8a')?.userId;
    const staffUsers = [
      ...new Set([
        ...(teachersByTenant(ctx).get(T) ?? []).slice(0, 8).map((t) => t.userId),
        ...(teacherUser ? [teacherUser] : []),
      ]),
    ];

    const student = (s: { id: string }) => ({ kind: NoticeRecipientKind.STUDENT, studentId: s.id });
    const guardian = (s: { id: string; guardianIds: string[] }, gid = s.guardianIds[0]) => ({
      kind: NoticeRecipientKind.GUARDIAN,
      studentId: s.id,
      guardianId: gid,
    });
    const staff = (userId: string) => ({ kind: NoticeRecipientKind.STAFF, userId });
    const cardRefs = cardGuardian ? cardKids.map((s) => guardian(s, cardGuardian.id)) : [];

    async function draft(
      actor: { userId: string; role: UserRole },
      dto: {
        title: string;
        body: string;
        important?: boolean;
        pinned?: boolean;
        isPublic?: boolean;
      },
      refs: Parameters<typeof recipients.add>[3],
    ) {
      const n = await notices.create(T, actor, dto);
      await recipients.add(T, actor, n.id, refs);
      return n.id;
    }

    // ---- the 8 notices (date offsets are days before the anchor) ----------------------------
    const made: { id: string; days: number; hour: number }[] = [];
    const publish = async (actor: typeof admin, id: string, days: number, hour = 10) => {
      await notices.publish(T, actor, id, false);
      made.push({ id, days, hour });
    };

    // 1. pinned: school-wide event; the guardian card is a recipient (1 of 3).
    const sports = await draft(
      admin,
      {
        title: 'বার্ষিক ক্রীড়া প্রতিযোগিতা',
        body: 'আগামী সপ্তাহে বার্ষিক ক্রীড়া প্রতিযোগিতা অনুষ্ঠিত হবে। সকল শিক্ষার্থী নির্ধারিত পোশাকে সকাল ৯টায় মাঠে উপস্থিত থাকবে।',
        pinned: true,
      },
      [
        ...some(pool, 12).flatMap((s) => [student(s), guardian(s)]),
        ...cardRefs,
        ...staffUsers.slice(0, 4).map(staff),
      ],
    );
    await publish(admin, sports, 14);

    // 2. pinned, with a PNG (the routine picture); the card is a recipient (2 of 3).
    const routine = await draft(
      admin,
      {
        title: 'নতুন ক্লাস রুটিন',
        body: 'নতুন ক্লাস রুটিন ছবি আকারে দেওয়া হলো। আগামী রবিবার থেকে এটি চালু হবে।',
        pinned: true,
      },
      [...some(pool, 10).map(student), ...cardRefs, ...staffUsers.map(staff)],
    );
    await files.upload(T, admin, routine, [file('routine.png', 'image/png', PNG)]);
    await publish(admin, routine, 9);

    // 3. important: needs an acknowledgement; the card is a recipient and has not acknowledged.
    const closed = await draft(
      admin,
      {
        title: 'বন্যার কারণে স্কুল বন্ধ',
        body: 'ভারী বৃষ্টির কারণে আগামীকাল স্কুল বন্ধ থাকবে। পরবর্তী নির্দেশ না দেওয়া পর্যন্ত অনলাইনে হোমওয়ার্ক দেখুন।',
        important: true,
      },
      [
        ...some(pool, 10).map((s) => guardian(s)),
        ...cardRefs,
        ...staffUsers.slice(0, 3).map(staff),
      ],
    );
    await publish(admin, closed, 5);

    // 4. public, with a PDF; some recipients are guardians with no login (they get personal links).
    const noLogin = pool.filter((s) => !guardianById.get(s.guardianIds[0])?.userId);
    const login = pool.filter((s) => guardianById.get(s.guardianIds[0])?.userId);
    const admission = await draft(
      admin,
      {
        title: 'ভর্তি বিজ্ঞপ্তি',
        body: 'নতুন শিক্ষাবর্ষের ভর্তি চলছে। বিস্তারিত সংযুক্ত ফাইলে দেখুন।',
        isPublic: true,
      },
      [...some(noLogin, 6).map((s) => guardian(s)), ...some(login, 4).map((s) => guardian(s))],
    );
    await files.upload(T, admin, admission, [
      file('admission-circular.pdf', 'application/pdf', PDF),
    ]);
    await publish(admin, admission, 12, 9);
    const noLoginRows: { id: string }[] = await ctx.ds.query(
      `SELECT id FROM notice_recipients WHERE tenant_id = $1 AND notice_id = $2 AND user_id IS NULL`,
      [T, admission],
    );
    await links.createPersonalLinks(
      admission,
      noLoginRows.map((r) => r.id),
    );

    // 5. a class notice written by the demo teacher, to students and guardians of their own sections.
    if (teacherUser) {
      const teacher = { userId: teacherUser, role: UserRole.TEACHER };
      const scope = await recipients.sectionScope(T, teacher);
      const own: { id: string }[] = scope?.length
        ? await ctx.ds.query(
            `SELECT id FROM students WHERE tenant_id = $1 AND class_section_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [T, scope],
          )
        : [];
      const ownIds = new Set(own.map((o) => o.id));
      const mine = pool.filter((s) => ownIds.has(s.id));
      if (mine.length) {
        const homework = await draft(
          teacher,
          {
            title: 'আগামীকালের ক্লাস টেস্ট',
            body: 'আগামীকাল প্রথম ঘণ্টায় গণিতের ক্লাস টেস্ট হবে। সবাই প্রস্তুত হয়ে আসবে।',
          },
          some(mine, 10).flatMap((s) => [student(s), guardian(s)]),
        );
        await publish(teacher, homework, 3, 11);
      }
    }

    // 6. expired: published, then its expiry passed.
    const expired = await draft(
      admin,
      { title: 'বৃত্তি পরীক্ষার আবেদন', body: 'বৃত্তি পরীক্ষার আবেদনের শেষ তারিখ পার হয়ে গেছে।' },
      some(pool, 8).map((s) => guardian(s)),
    );
    await publish(admin, expired, 30);
    await ctx.ds.query(`UPDATE notices SET expires_on = $2::date WHERE id = $1`, [
      expired,
      addDays(ctx.anchor, -10),
    ]);

    // 7. withdrawn: published by mistake, then taken back.
    const wrong = await draft(
      admin,
      { title: 'ভুল তারিখের নোটিশ', body: 'এই নোটিশে ভুল তারিখ ছিল, তাই প্রত্যাহার করা হয়েছে।' },
      some(pool, 6).map((s) => guardian(s)),
    );
    await publish(admin, wrong, 20);
    await notices.withdraw(T, admin, wrong);

    // 8. draft: not yet sent.
    const next = await draft(
      admin,
      { title: 'অভিভাবক সমাবেশ', body: 'আগামী মাসে অভিভাবক সমাবেশ হবে। তারিখ পরে জানানো হবে।' },
      staffUsers.slice(0, 3).map(staff),
    );

    // ---- [53.5.05] SMS approval requests, one per state, all through the real services -----------
    // Each is published with the SMS request (the service raises the admin's task). Only guardian
    // rows of the generic pool are used, so the guardian card keeps seeing 3 notices.
    const smsNotice = async (title: string, days: number) => {
      const id = await draft(
        admin,
        { title, body: 'এই নোটিশের এসএমএস পাঠানোর অনুমোদন চাওয়া হয়েছে।' },
        some(pool, 6).map((s) => guardian(s)),
      );
      await notices.publish(T, admin, id, true);
      made.push({ id, days, hour: 10 });
      return id;
    };
    // PENDING: the demo admin sees the task in the attention bar.
    await smsNotice('এসএমএস অনুমোদনের অপেক্ষায়', 2);
    // APPROVED: the real approve writes the QUEUED logs; the sink outcome is set below.
    const smsApproved = await smsNotice('এসএমএস অনুমোদিত নোটিশ', 6);
    await sms.approve(T, smsApproved, org.adminUserId);
    // DECLINED by the admin.
    await sms.decline(T, await smsNotice('এসএমএস প্রত্যাখ্যাত নোটিশ', 8), org.adminUserId);
    // Expired and closed: the notice expired while the request waited. Approve answers 409 and
    // the service closes the dead request itself (declined by the system, no deciding user).
    const smsExpired = await smsNotice('মেয়াদোত্তীর্ণ এসএমএস অনুরোধ', 25);
    await ctx.ds.query(`UPDATE notices SET expires_on = $2::date WHERE id = $1`, [
      smsExpired,
      addDays(ctx.anchor, -5),
    ]);
    await sms.approve(T, smsExpired, org.adminUserId).catch(() => undefined);

    await notices.idle();

    // ---- dates from the anchor (the services stamped "now") ---------------------------------
    for (const m of made) {
      await ctx.ds.query(
        `UPDATE notices SET published_at = $2::timestamptz, created_at = $2::timestamptz - interval '1 hour',
                withdrawn_at = CASE WHEN withdrawn_at IS NULL THEN NULL ELSE $2::timestamptz + interval '2 days' END
          WHERE id = $1`,
        [m.id, at(addDays(ctx.anchor, -m.days), m.hour)],
      );
    }
    // SMS decisions land 3 hours after publish; the approved logs get a fixed SENT/FAILED mix
    // (dev sink, fake numbers only: nothing left the machine).
    await ctx.ds.query(
      `UPDATE notices SET sms_decided_at = published_at + interval '3 hours'
        WHERE tenant_id = $1 AND sms_status IN ('APPROVED', 'DECLINED')`,
      [T],
    );
    const logs: { id: string }[] = await ctx.ds.query(
      `SELECT l.id FROM notice_recipients r JOIN communication_logs l ON l.id = r.communication_log_id
        WHERE r.notice_id = $1 ORDER BY l.recipient_address, l.id`,
      [smsApproved],
    );
    for (const [i, l] of logs.entries())
      await ctx.ds.query(`UPDATE communication_logs SET status = $2 WHERE id = $1`, [
        l.id,
        i % 3 === 2 ? 'FAILED' : 'SENT',
      ]);
    await ctx.ds.query(`UPDATE notices SET created_at = $2::timestamptz WHERE id = $1`, [
      next,
      at(addDays(ctx.anchor, -1), 15),
    ]);

    // ---- reads: about 60% of the people with a login saw it; the card has not acknowledged ----
    // One draw per (notice, person), in a fixed order (titles and logins, never row ids, which are random).
    const people: { notice_id: string; user_id: string }[] = await ctx.ds.query(
      `SELECT DISTINCT n.title, COALESCE(u.email, u.phone) AS login, r.notice_id, r.user_id
         FROM notice_recipients r JOIN notices n ON n.id = r.notice_id
         JOIN users u ON u.id = r.user_id
        WHERE r.tenant_id = $1 AND n.status = 'PUBLISHED' AND r.user_id IS NOT NULL
        ORDER BY n.title, login`,
      [T],
    );
    const seen = people.filter(() => ctx.rng.number.float() < 0.6);
    await ctx.ds.query(
      `UPDATE notice_recipients r SET seen_at = n.published_at + make_interval(hours => u.h)
         FROM unnest($1::uuid[], $2::uuid[], $3::int[]) AS u(notice_id, user_id, h), notices n
        WHERE r.notice_id = u.notice_id AND r.user_id = u.user_id AND n.id = r.notice_id`,
      [
        seen.map((r) => r.notice_id),
        seen.map((r) => r.user_id),
        seen.map(() => ctx.rng.number.int({ min: 1, max: 40 })),
      ],
    );
    // Acknowledgements go through the real service; the guardian card stays unacknowledged.
    const closers: { user_id: string }[] = await ctx.ds.query(
      `SELECT DISTINCT COALESCE(u.email, u.phone) AS login, r.user_id
         FROM notice_recipients r JOIN users u ON u.id = r.user_id
        WHERE r.tenant_id = $1 AND r.notice_id = $2 AND r.user_id <> $3 ORDER BY login`,
      [T, closed, cards.guardianUserId],
    );
    for (const u of closers.filter(() => ctx.rng.number.float() < 0.6))
      await reader.acknowledge(T, u.user_id, closed);

    // The services stamped the real clock on the acknowledgement and the alert; the demo's dates come
    // from the anchor, so the same inputs give the same data.
    await ctx.ds.query(
      `UPDATE notice_recipients r SET seen_at = n.published_at + interval '2 hours',
              acknowledged_at = n.published_at + interval '3 hours'
         FROM notices n WHERE n.id = r.notice_id AND r.acknowledged_at IS NOT NULL`,
    );
    await ctx.ds.query(
      `UPDATE alerts a SET raised_at = n.published_at, last_evaluated_at = n.published_at
         FROM notices n WHERE a.subject_type = 'notice' AND a.subject_id = n.id`,
    );
    await ctx.ds.query(
      `UPDATE alert_recipients ar SET resolved_at = n.published_at + interval '3 hours'
         FROM alerts a JOIN notices n ON n.id = a.subject_id
        WHERE a.id = ar.alert_id AND a.subject_type = 'notice' AND ar.resolved_at IS NOT NULL`,
    );

    return (
      await ctx.ds.query(`SELECT count(*)::int AS n FROM notices WHERE tenant_id = $1`, [T])
    )[0].n;
  },
};
