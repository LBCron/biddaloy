import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  SiteCustomDomainStatus,
  SiteMediaSlot,
  SitePage,
  SiteSectionKey,
  SiteTheme,
  SITE_MEDIA_SLOT_PX,
} from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { THEMES, defaultConfigFor } from '@biddaloy/site-themes';
import type { DemoSeedContext, DemoSlice } from '../context';
import { SchoolSite } from '../../../modules/website/entities/school-site.entity';
import { SiteMedia } from '../../../modules/website/entities/site-media.entity';
import { StaffWebProfile } from '../../../modules/website/entities/staff-web-profile.entity';
import { SitePost } from '../../../modules/website/entities/site-post.entity';
import { SiteEnquiry } from '../../../modules/website/entities/site-enquiry.entity';
import { checkSlate } from '../../../modules/website/slate-render';
import { SiteConfigService, slugFor } from '../../../modules/website/site-config.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { tenantObjectKeyNamed } from '../../../modules/storage/storage-key';
import { SUBJECTS } from '../../seed-data/demo-bn/subjects-staffing';
import { orgIds } from './org';
import { teachersByTenant } from './staff';

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

/** A WebP gradient, so the demo site has real pictures without shipping binary files. */
const gradient = (w: number, h: number, from: string, to: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
        `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
    ),
  )
    .webp({ quality: 80 })
    .toBuffer();

const BIOS = [
  { bn: 'শিক্ষার্থীদের প্রশ্ন করতে উৎসাহ দেন।', en: 'Encourages students to ask questions.' },
  { bn: 'হাতে-কলমে শেখানোয় বিশ্বাসী।', en: 'Believes in learning by doing.' },
  { bn: 'প্রতিটি শিক্ষার্থীর দিকে আলাদা নজর দেন।', en: 'Gives every student personal attention.' },
];

/**
 * [40.1.08 / #3621] The demo school's public website: a published Basic site with real
 * pictures, texts in both languages and six teacher cards. Written through `SiteConfigService`
 * (draft, publish, switch on) so the same checks run as for a school's own edits. Only the
 * pictures' storage rows and the staging test host are set by SQL: their services land later
 * (#3622 `SiteMediaService`, #3613 custom domain).
 *
 * Also three blog posts (two published, one draft), three enquiries (one unseen) and the
 * public notice pinned on the site [#3638].
 */
export const slice: DemoSlice = {
  name: 'website',
  covers: [SchoolSite, SiteMedia, StaffWebProfile, SitePost, SiteEnquiry],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const tenant = org.tenants.find((t) => t.kind === 'HIGH')!;
    const T = tenant.id;
    const storage = ctx.app.get(StorageService);
    const site = ctx.app.get(SiteConfigService);

    // The row is made on first read (Basic theme, default texts); rename it to the school's short name.
    const created = await site.get(T);
    await ctx.ds.query(`UPDATE school_sites SET subdomain = $2 WHERE tenant_id = $1`, [
      T,
      tenant.slug,
    ]);

    const palette = THEMES[SiteTheme.BASIC].palettes[1];
    const store = async (
      slot: SiteMediaSlot,
      id: string,
      px: { w: number; h: number },
      from: string,
      to: string,
    ) => {
      const body = await gradient(px.w, px.h, from, to);
      const key = tenantObjectKeyNamed(
        T,
        slot === SiteMediaSlot.LOGO ? 'logo' : 'site-media',
        id,
        'webp',
      );
      await storage.put(key, body, 'image/webp');
      return { key, body, hash: createHash('sha256').update(body).digest('hex') };
    };

    // Two hero pictures: the palette's gradient, once each way round.
    const heroPx = SITE_MEDIA_SLOT_PX[SiteMediaSlot.HERO];
    const heroIds: string[] = [];
    let bytesUsed = 0;
    for (const [from, to] of [
      [palette.vars.primary, palette.vars.secondary],
      [palette.vars.secondary, palette.vars.primary],
    ]) {
      const id = ctx.rng.string.uuid();
      const f = await store(SiteMediaSlot.HERO, id, heroPx, from, to);
      await ctx.ds.getRepository(SiteMedia).insert({
        id,
        tenant_id: T,
        slot: SiteMediaSlot.HERO,
        storage_key: f.key,
        hash: f.hash,
        width: heroPx.w,
        height: heroPx.h,
        bytes: f.body.length,
      });
      heroIds.push(id);
      bytesUsed += f.body.length;
    }
    await ctx.ds.query(`UPDATE school_sites SET media_bytes_used = $2 WHERE tenant_id = $1`, [
      T,
      bytesUsed,
    ]);

    // The school's logo (what `media/logo` streams) lives on the school row, not in site_media.
    const logoPx = SITE_MEDIA_SLOT_PX[SiteMediaSlot.LOGO];
    const logo = await store(
      SiteMediaSlot.LOGO,
      ctx.rng.string.uuid(),
      logoPx,
      palette.vars.primary,
      palette.vars.accent,
    );
    await ctx.ds.query(`UPDATE schools SET logo_key = $2 WHERE id = $1`, [T, logo.key]);

    // The texts: Basic defaults, plus school-specific lines. Admission dates come from the school year.
    const year = tenant.years.find((y) => y.isCurrent) ?? tenant.years[0];
    const draft: SiteConfig = defaultConfigFor(SiteTheme.BASIC);
    draft.palette = palette.id;
    const section = (page: SitePage, key: SiteSectionKey) =>
      draft.pages.find((p) => p.page === page)!.sections.find((s) => s.key === key)!;
    const set = (key: SiteSectionKey, data: Record<string, unknown>) => {
      // The same section sits on its own page and on the home page: keep both in step.
      for (const p of draft.pages) {
        const s = p.sections.find((x) => x.key === key);
        if (s) Object.assign(s.data, data);
      }
    };
    set(SiteSectionKey.HERO, {
      kicker: { bn: 'শিক্ষা, শৃঙ্খলা, সৃজনশীলতা', en: 'Learning, discipline, creativity' },
      headline: {
        bn: 'বাংলাদেশ মডেল স্কুল অ্যান্ড কলেজে স্বাগতম',
        en: 'Welcome to Bangladesh Model School & College',
      },
      tagline: {
        bn: 'আমাদের লক্ষ্য প্রতিটি শিক্ষার্থীকে জ্ঞানে ও চরিত্রে গড়ে তোলা।',
        en: 'Our mission is to build every student in knowledge and in character.',
      },
      images: heroIds,
    });
    set(SiteSectionKey.ABOUT, {
      body: {
        bn: 'আমাদের লক্ষ্য: মানসম্মত শিক্ষা, নৈতিক মূল্যবোধ এবং প্রতিটি শিশুর সম্ভাবনার বিকাশ।',
        en: 'Our mission: quality education, moral values and room for every child to grow.',
      },
    });
    set(SiteSectionKey.ADMISSIONS, {
      body: {
        bn: `${year.name} শিক্ষাবর্ষের ভর্তি ফরম বিতরণ ${addDays(year.end, -60)} থেকে ${addDays(year.end, -30)} পর্যন্ত।`,
        en: `${year.name} admission forms are given out from ${addDays(year.end, -60)} to ${addDays(year.end, -30)}.`,
      },
    });
    draft.announcements.items = [
      {
        id: 'admission-open',
        text: {
          bn: 'ভর্তি চলছে। বিস্তারিত জানতে ভর্তি পাতা দেখুন।',
          en: 'Admission is open. See the admissions page.',
        },
        href: '/admissions',
        from: addDays(ctx.anchor, -1),
        enabled: true,
      },
    ];
    section(SitePage.HOME, SiteSectionKey.HERO); // throws if the theme ever drops the home hero

    await site.saveDraft(T, { config: draft as never, draft_revision: created.draft_revision });
    const saved = await site.get(T);
    await site.publish(T, saved.version, saved.draft_revision);
    await site.setEnabled(T, true);

    // Staging only: the always-on test host answers for this school (runbook Part 8c).
    const testHost = process.env.SITE_TEST_HOST?.trim().toLowerCase();
    if (testHost) {
      await ctx.ds.query(
        `UPDATE school_sites SET custom_domain = $2, custom_domain_status = $3 WHERE tenant_id = $1`,
        [T, testHost, SiteCustomDomainStatus.ACTIVE],
      );
    }

    // Six teacher cards, picked by position; the first three drawn are featured.
    const teachers = teachersByTenant(ctx).get(T) ?? [];
    const picked = ctx.rng.helpers
      .arrayElements(
        teachers.map((_, i) => i),
        Math.min(6, teachers.length),
      )
      .sort((a, b) => a - b);
    const names = new Map<string, string>(
      (
        await ctx.ds.query(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [
          picked.map((i) => teachers[i].userId),
        ])
      ).map((u: { id: string; full_name: string }) => [u.id, u.full_name]),
    );
    const profiles = picked.map((pos, order) => {
      const t = teachers[pos];
      const subjects = t.subjects.map((s) => SUBJECTS[s]?.en).filter(Boolean) as string[];
      return {
        tenant_id: T,
        user_id: t.userId,
        show_on_website: true,
        featured: order < 3,
        sort_order: order,
        subjects,
        bio: BIOS[order % BIOS.length],
        credentials: {
          bn: `${names.get(t.userId) ?? ''} — বি.এড`,
          en: `${names.get(t.userId) ?? ''} — B.Ed.`,
        },
      };
    });
    await ctx.ds.getRepository(StaffWebProfile).insert(profiles);

    // One inline blog picture (post-image slot), counted in the site's picture bytes.
    // Blog pictures have no fixed size (the slot is not in SITE_MEDIA_SLOT_PX).
    const imgPx = { w: 1200, h: 800 };
    const imgId = ctx.rng.string.uuid();
    const img = await store(
      SiteMediaSlot.POST_IMAGE,
      imgId,
      imgPx,
      palette.vars.accent,
      palette.vars.primary,
    );
    await ctx.ds.getRepository(SiteMedia).insert({
      id: imgId,
      tenant_id: T,
      slot: SiteMediaSlot.POST_IMAGE,
      storage_key: img.key,
      hash: img.hash,
      width: imgPx.w,
      height: imgPx.h,
      bytes: img.body.length,
    });
    await ctx.ds.query(
      `UPDATE school_sites SET media_bytes_used = media_bytes_used + $2 WHERE tenant_id = $1`,
      [T, img.body.length],
    );

    // Three blog posts: two published (days before the anchor, no literal dates), one draft.
    const t = (text: string, bold?: boolean) => ({ text, ...(bold ? { bold: true } : {}) });
    const para = (text: string) => ({ type: 'paragraph', children: [t(text)] });
    const rich = (title: string, intro: string) => [
      { type: 'heading-two', children: [t(title)] },
      para(intro),
      {
        type: 'bulleted-list',
        children: [
          { type: 'list-item', children: [t('Class 6 to 10')] },
          { type: 'list-item', children: [t('Morning shift')] },
        ],
      },
      {
        type: 'table',
        children: [
          {
            type: 'table-row',
            children: [
              { type: 'table-cell', children: [t('Day', true)] },
              { type: 'table-cell', children: [t('Time', true)] },
            ],
          },
          {
            type: 'table-row',
            children: [
              { type: 'table-cell', children: [t('Sunday')] },
              { type: 'table-cell', children: [t('9:00')] },
            ],
          },
        ],
      },
      { type: 'block-quote', children: [t('Education is the most powerful weapon.')] },
      { type: 'image', mediaId: imgId, alt: 'School picture', children: [t('')] },
    ];
    const posts = [
      {
        en: 'Annual sports day',
        bn: 'বার্ষিক ক্রীড়া প্রতিযোগিতা',
        ago: 10,
        body: rich('Annual sports day', 'Our sports day was a joyful event.'),
      },
      {
        en: 'Science fair winners',
        bn: 'বিজ্ঞান মেলার বিজয়ীরা',
        ago: 3,
        body: rich('Science fair winners', 'Congratulations to all participants.'),
      },
      {
        en: 'Admission tips for parents',
        bn: 'অভিভাবকদের জন্য ভর্তির পরামর্শ',
        ago: null,
        body: [para('Draft: what to bring on the first day.')],
      },
    ];
    for (const post of posts) {
      if (!checkSlate(post.body).ok) throw new Error('demo website post body fails checkSlate');
      await ctx.ds.getRepository(SitePost).insert({
        tenant_id: T,
        kind: 'POST',
        slug: slugFor(post.en, () => ctx.rng.string.uuid().slice(0, 4)),
        title: { bn: post.bn, en: post.en },
        cover_media_id: post.ago === null ? null : heroIds[0],
        body: post.body as never,
        published_at:
          post.ago === null ? null : new Date(`${addDays(ctx.anchor, -post.ago)}T06:00:00Z`),
      });
    }

    // Three contact-form messages; demo phone numbers only (01700-NNNNNN). Two read, one new.
    const enquiries = [
      { name: 'Rahim Uddin', message: 'When does admission open for class 6?', seen: true },
      { name: 'Nasrin Akter', message: 'Is there a transport facility from Mirpur?', seen: true },
      {
        name: 'Karim Hossain',
        message: 'Please share the fee structure for class 9.',
        seen: false,
      },
    ];
    for (const [i, e] of enquiries.entries()) {
      const at = new Date(`${addDays(ctx.anchor, -(i + 1))}T08:00:00Z`);
      await ctx.ds.getRepository(SiteEnquiry).insert({
        tenant_id: T,
        name: e.name,
        phone: `01700${String(100_000 + i * 111_111)}`,
        message: e.message,
        seen_at: e.seen ? at : null,
        created_at: at,
      });
    }

    // The public admission notice (made by the notices slice) is pinned on the website list.
    await ctx.ds.query(
      `UPDATE notices SET pinned_on_website = true WHERE tenant_id = $1 AND is_public = true`,
      [T],
    );

    return 1 + 2 + 1 + profiles.length + posts.length + enquiries.length;
  },
};
