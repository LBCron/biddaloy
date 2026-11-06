import {
  CalendarAudience,
  CalendarEventType,
  PeriodSlotKind,
  PublicHolidaySource,
  DailyAttendanceSource,
  SchoolStatus,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { DEMO_CARDS, DEMO_SCHOOL_SLUGS } from '../../../modules/demo/demo-accounts';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { ApplyPresetDto } from '../../../modules/presets/dto/apply-preset.dto';
import {
  insertJoinRequest,
  SchoolInviteService,
} from '../../../modules/account-access/school-invite.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { School } from '../../../modules/schools/entities/school.entity';
import { User } from '../../../modules/users/entities/user.entity';
import { UserTenant } from '../../../modules/auth/entities/user-tenant.entity';
import { AcademicYear } from '../../../modules/academics/entities/academic-year.entity';
import { Class } from '../../../modules/academics/entities/class.entity';
import { ClassSection } from '../../../modules/academics/entities/class-section.entity';
import { Subject } from '../../../modules/academics/entities/subject.entity';
import { ClassSubject } from '../../../modules/academics/entities/class-subject.entity';
import { GradingScale } from '../../../modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../../../modules/grading/entities/grading-band.entity';
import { AcademicTerm } from '../../../modules/calendar/entities/academic-term.entity';
import { CalendarEvent } from '../../../modules/calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../../../modules/calendar/entities/calendar-event-class.entity';
import { PublicHolidaySet } from '../../../modules/calendar/entities/public-holiday-set.entity';
import { PublicHolidayEntry } from '../../../modules/calendar/entities/public-holiday-entry.entity';
import { Shift } from '../../../modules/routines/entities/shift.entity';
import { PeriodSlot } from '../../../modules/routines/entities/period-slot.entity';
import { Room } from '../../../modules/routines/entities/room.entity';
import { PrintTemplate } from '../../../modules/print/entities/print-template.entity';
import { PrintTemplateVersion } from '../../../modules/print/entities/print-template-version.entity';
import { PrintAsset } from '../../../modules/print/entities/print-asset.entity';
import { ExamTemplate } from '../../../modules/exams/entities/exam-template.entity';
import { ExamTemplateComponent } from '../../../modules/exams/entities/exam-template-component.entity';
import { BD_PUBLIC_HOLIDAYS_BY_YEAR } from '../../seed-data/public-holidays-bd';
import { CALENDAR_EVENTS } from '../../seed-data/demo-bn/texts';
import { SCHOOL_AREA } from '../../seed-data/demo-bn/places';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { academicYears, todayAt, type TenantKind } from '../dates';

/** What later slices read from `ctx.ids.get('org')` (use `orgIds(ctx)`). Years run oldest to newest. */
export interface OrgSection {
  id: string;
  name: string;
  group: string | null;
}
export interface OrgClass {
  id: string;
  name: string;
  numericGrade: number;
  sections: OrgSection[];
}
export interface OrgYear {
  id: string;
  name: string;
  start: string;
  end: string;
  isCurrent: boolean;
  classes: OrgClass[];
}
export interface OrgTenant {
  id: string;
  slug: string;
  kind: TenantKind;
  shiftId: string;
  years: OrgYear[];
  periodSlots: { id: string; sequence: number; kind: PeriodSlotKind }[];
  /** `sectionId` is set for a section's own room, null for a lab. */
  rooms: { id: string; roomNo: string; sectionId: string | null }[];
}
export interface OrgIds {
  adminUserId: string;
  tenants: OrgTenant[];
}

export const orgIds = (ctx: DemoSeedContext): OrgIds => ctx.ids.get('org') as OrgIds;

/**
 * Gives `userId` a second membership the real way (D41, Epic 68): file a JOIN_SCHOOL request,
 * then accept it as that user. The staff and students slices import this.
 */
export async function joinBranch(
  ctx: DemoSeedContext,
  userId: string,
  tenantId: string,
  role: UserRole,
): Promise<void> {
  const request = await ctx.ds.transaction((m) =>
    insertJoinRequest(m, { userId, tenantId, role, createdByUserId: userId }),
  );
  await ctx.app.get(SchoolInviteService).accept(userId, request.id, { ip: null, userAgent: null });
}

interface Branch {
  slug: (typeof DEMO_SCHOOL_SLUGS)[number];
  kind: TenantKind;
  nameEn: string;
  nameBn: string;
  stages: string[];
  /** [start, end] of the school day, minutes since midnight. */
  day: [number, number];
  periods: number;
  periodMinutes: number;
  /** Break after this period (0 = none). */
  breakAfter: number;
  labs: string[];
  sectionNames: string[] | null; // null = A / B
}

const SCHOOL_EN = 'Bangladesh Model School & College';
const SCHOOL_BN = 'বাংলাদেশ মডেল স্কুল অ্যান্ড কলেজ';
const BRANCHES: Branch[] = [
  {
    slug: 'bmsc-primary',
    kind: 'PRIMARY',
    nameEn: `${SCHOOL_EN} — Primary Branch`,
    nameBn: `${SCHOOL_BN} — প্রাথমিক শাখা`,
    stages: ['PRIMARY'],
    day: [8 * 60, 12 * 60 + 30],
    periods: 6,
    periodMinutes: 45,
    breakAfter: 0,
    labs: ['Activity Room'],
    sectionNames: null,
  },
  {
    slug: 'bmsc-high',
    kind: 'HIGH',
    nameEn: `${SCHOOL_EN} — Secondary Branch`,
    nameBn: `${SCHOOL_BN} — মাধ্যমিক শাখা`,
    stages: ['JUNIOR', 'SECONDARY'],
    day: [8 * 60, 14 * 60],
    periods: 8,
    periodMinutes: 40,
    breakAfter: 4,
    labs: ['Physics Lab', 'Chemistry Lab', 'Computer Lab'],
    sectionNames: null,
  },
  {
    slug: 'bmsc-college',
    kind: 'COLLEGE',
    nameEn: `${SCHOOL_EN} — College Branch`,
    nameBn: `${SCHOOL_BN} — কলেজ শাখা`,
    stages: ['HIGHER_SECONDARY'],
    day: [9 * 60, 13 * 60 + 30],
    periods: 6,
    periodMinutes: 45,
    breakAfter: 0,
    labs: ['Physics Lab', 'Chemistry Lab', 'Biology Lab', 'Computer Lab'],
    sectionNames: ['Science', 'Business Studies'], // D9: also the section's group
  },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const isFriday = (date: string) => new Date(date).getUTCDay() === 5;

/** First occurrence of month/day inside the year span (a Jul-Jun year puts Jan-Jun in the next calendar year). */
function inSpan(start: string, month: number, day: number): string {
  const startYear = Number(start.slice(0, 4));
  return iso(Number(start.slice(5, 7)) <= month ? startYear : startYear + 1, month, day);
}

/** Three equal four-month terms from the year's first month. */
function termsOf(start: string): { seq: number; name: string; start: string; end: string }[] {
  const names = ['প্রথম সাময়িক', 'দ্বিতীয় সাময়িক', 'তৃতীয় সাময়িক'];
  const startYear = Number(start.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const at = (offset: number) => {
    const m = startMonth + offset; // 1-based, may pass 12
    return [startYear + Math.floor((m - 1) / 12), ((m - 1) % 12) + 1] as const;
  };
  return names.map((name, i) => {
    const [sy, sm] = at(i * 4);
    const [ey, em] = at(i * 4 + 3);
    return {
      seq: i + 1,
      name,
      start: iso(sy, sm, 1),
      end: iso(ey, em, new Date(Date.UTC(ey, em, 0)).getUTCDate()),
    };
  });
}

type EventRule = {
  on: [month: number, day: number][];
  days?: number;
  top2?: boolean;
  all?: boolean;
};
/** When each `CALENDAR_EVENTS` entry happens (month/day only; the year comes from the academic year). */
const EVENT_RULES: Record<string, EventRule> = {
  'Victory Day': { on: [[12, 16]] },
  'Independence Day Programme': { on: [[3, 26]] },
  'International Mother Language Day': { on: [[2, 21]] },
  'Annual Sports Competition': { on: [[1, 28]] },
  'Annual Cultural Function': { on: [[11, 18]] },
  'Science Fair': { on: [[9, 14]], top2: true },
  'Parents Meeting': {
    on: [
      [4, 11],
      [8, 22],
      [12, 5],
    ],
  },
  'Prize Giving Ceremony': { on: [[12, 18]] },
  'Mid-term Examination': { on: [[6, 10]], days: 8, all: true },
  'Annual Examination': { on: [[11, 24]], days: 12, all: true },
  'Winter Break': { on: [[12, 20]], days: 10 },
  'Pohela Boishakh Celebration': { on: [[4, 14]] },
};
const EVENT_TYPE = {
  HOLIDAY: CalendarEventType.HOLIDAY,
  EVENT: CalendarEventType.EVENT,
  EXAM: CalendarEventType.EXAM,
} as const;

export const slice: DemoSlice = {
  name: 'org',
  covers: [
    School,
    User,
    UserTenant,
    AcademicYear,
    Class,
    ClassSection,
    Subject,
    ClassSubject,
    GradingScale,
    GradingBand,
    AcademicTerm,
    CalendarEvent,
    CalendarEventClass,
    PublicHolidaySet,
    PublicHolidayEntry,
    Shift,
    PeriodSlot,
    Room,
    ExamTemplate,
    ExamTemplateComponent,
    // The curriculum-preset apply writes the print templates (58.3.06 owes only jobs and profiles).
    PrintTemplate,
    PrintTemplateVersion,
    PrintAsset,
  ],
  run: async (ctx) => {
    // Content is deterministic for an anchor; ids from real services (schools, current year, ...) are not.
    const uuid = () => ctx.rng.string.uuid();
    const stamp = todayAt(ctx.anchor, 0);
    let rows = 0;

    // Every calendar year the data touches wants holiday data. A year past the table's end gets
    // none, with a warning: the nightly reset must keep running (22-demo-seed.md says when to extend).
    const spansByKind = new Map(
      BRANCHES.map((b) => [b.kind, academicYears(b.kind, ctx.years, ctx.anchor)] as const),
    );
    const calendarYears = new Set<number>();
    for (const spans of spansByKind.values()) {
      for (const s of spans) {
        calendarYears.add(Number(s.start.slice(0, 4)));
        calendarYears.add(Number(s.end.slice(0, 4)));
      }
    }
    const missing = [...calendarYears].filter((year) => !BD_PUBLIC_HOLIDAYS_BY_YEAR[year]);
    if (missing.length) {
      console.warn(
        `BD_PUBLIC_HOLIDAYS_BY_YEAR has no ${missing.join(', ')}: seeding those years with no public holidays. Add them to seed-data/public-holidays-bd.ts.`,
      );
    }

    // --- schools (D31) -------------------------------------------------------
    const schoolRepo = ctx.ds.getRepository(School);
    const schools = await schoolRepo.save(
      BRANCHES.map((b, i) =>
        schoolRepo.create({
          name: b.nameEn,
          name_bn: b.nameBn,
          slug: b.slug,
          registration_id: String(900001 + i), // fake EIIN
          address: SCHOOL_AREA.bn,
          email: `${b.slug}@bmsc.example`,
          country_code: 'BD',
          status: SchoolStatus.ACTIVE,
          trial_ends_at: null, // the trial job must never touch the demo
          onboarding: { finished_at: stamp.toISOString() },
          settings: {
            attendance: {
              // [76.2.8] D25: High is gate-driven, the first other branch is teacher-only, the rest ANY.
              ...(b.kind === 'HIGH' && { dailySource: DailyAttendanceSource.DEVICE }),
              ...(b.slug === 'bmsc-primary' && {
                dailySource: DailyAttendanceSource.CLASS_TEACHER,
              }),
              periodAttendance: { enabled: true },
              // [84.1.4] D43: SMS arrival notices on in the first branch only.
              arrivalNotice: { enabled: true, smsAllowed: i === 0 },
            },
          },
        }),
      ),
    );
    rows += schools.length;

    // --- the admin: a member of the home branch, joined to the other two (D41) -
    const card = DEMO_CARDS.find((c) => c.key === 'admin')!;
    const home = schools.find((s) => s.slug === card.branchSlug)!;
    const admin = await ctx.ds.getRepository(User).save({
      email: card.email,
      full_name: card.nameEn,
      password_hash: ctx.demoPasswordHash,
      status: UserStatus.ACTIVE,
      email_verified_at: stamp,
    });
    await ctx.ds
      .getRepository(UserTenant)
      .save({ user_id: admin.id, tenant_id: home.id, role: UserRole.ADMIN });
    for (const s of schools.filter((s) => s !== home)) {
      await joinBranch(ctx, admin.id, s.id, UserRole.ADMIN);
    }
    rows += 4;

    // --- global public-holiday sets for every calendar year the data touches --
    for (const year of [...calendarYears].sort()) {
      const entries = BD_PUBLIC_HOLIDAYS_BY_YEAR[year];
      if (!entries) continue;
      const set = await ctx.ds.getRepository(PublicHolidaySet).save({
        country: 'BD',
        year,
        source: PublicHolidaySource.MANUAL,
        published_at: stamp,
        fetched_at: stamp,
      });
      rows +=
        1 +
        (await insertChunked(
          ctx.ds.getRepository(PublicHolidayEntry),
          entries.map((e) => ({ set_id: set.id, ...e })),
        ));
    }

    // --- each branch ------------------------------------------------------------
    const org: OrgIds = { adminUserId: admin.id, tenants: [] };
    for (const b of BRANCHES) {
      const school = schools.find((s) => s.slug === b.slug)!;
      const spans = spansByKind.get(b.kind)!;
      const current = spans[spans.length - 1];

      // Current year, classes, subjects, grading scale and exam templates: the real service (D4).
      await ctx.app.get(PresetApplyService).apply(school.id, admin.id, {
        preset_id: 'bd/nctb',
        start_year: Number(current.start.slice(0, 4)),
        stages: b.stages,
        versions: ['bangla'],
      } as ApplyPresetDto);
      // The pack opens every year in January; College runs Jul-Jun (D32).
      const yearRepo = ctx.ds.getRepository(AcademicYear);
      const currentYear = (await yearRepo.findOneByOrFail({
        tenant_id: school.id,
        is_current: true,
      }))!;
      await ctx.ds.query(
        `UPDATE academic_years SET name = $1, start_date = $2, end_date = $3 WHERE id = $4`,
        [current.name, current.start, current.end, currentYear.id],
      );

      // Shift + period slots (a break where the branch has one).
      const [dayStart, dayEnd] = b.day;
      const shift = await ctx.ds.getRepository(Shift).save({
        tenant_id: school.id,
        name: 'Morning',
        day_starts_at: hhmm(dayStart),
        day_ends_at: hhmm(dayEnd),
        sequence: 1,
      });
      const slotRows: PeriodSlot[] = [];
      let at = dayStart;
      let seq = 0;
      for (let p = 1; p <= b.periods; p++) {
        slotRows.push(
          slot(school.id, shift.id, ++seq, PeriodSlotKind.CLASS, null, at, b.periodMinutes),
        );
        at += b.periodMinutes;
        if (p === b.breakAfter) {
          slotRows.push(
            slot(school.id, shift.id, ++seq, PeriodSlotKind.BREAK, 'Break', at, b.periodMinutes),
          );
          at += b.periodMinutes;
        }
      }
      const periodSlots = await ctx.ds.getRepository(PeriodSlot).save(slotRows);
      rows += 1 + periodSlots.length;

      // Vocabulary: apply resets shifts to none, so add Morning after it; classes point at the shift.
      const fresh = await schoolRepo.findOneByOrFail({ id: school.id });
      const organisation = (fresh.settings?.organisation ?? {}) as Record<string, unknown>;
      fresh.settings = {
        ...fresh.settings,
        organisation: { ...organisation, shifts: ['Morning'] },
      };
      await schoolRepo.save(fresh);
      ctx.app.get(TenantSettingsCache).invalidate(school.id);
      await ctx.ds
        .getRepository(Class)
        .update({ tenant_id: school.id }, { shift: 'Morning', shift_id: shift.id });

      // The current year's classes, then every older year cloned from them (D4: bulk insert).
      const currentClasses = await ctx.ds.getRepository(Class).find({
        where: { tenant_id: school.id, academic_year_id: currentYear.id },
        order: { numeric_grade: 'ASC' },
      });
      const currentSubjects = await ctx.ds
        .getRepository(ClassSubject)
        .find({ where: { tenant_id: school.id, academic_year_id: currentYear.id } });
      const scale = await ctx.ds
        .getRepository(GradingScale)
        .findOneBy({ tenant_id: school.id, academic_year_id: currentYear.id });
      const bands = scale
        ? await ctx.ds.getRepository(GradingBand).find({ where: { scale_id: scale.id } })
        : [];

      const years: Record<string, unknown>[] = [];
      const classes: Record<string, unknown>[] = [];
      const sections: Record<string, unknown>[] = [];
      const classSubjects: Record<string, unknown>[] = [];
      const scales: Record<string, unknown>[] = [];
      const bandRows: Record<string, unknown>[] = [];
      const terms: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];
      const eventClasses: Record<string, unknown>[] = [];
      const tenant: OrgTenant = {
        id: school.id,
        slug: b.slug,
        kind: b.kind,
        shiftId: shift.id,
        years: [],
        periodSlots: periodSlots.map((p) => ({ id: p.id, sequence: p.sequence, kind: p.kind })),
        rooms: [],
      };

      for (const span of spans) {
        const isCurrent = span === current;
        const yearId = isCurrent ? currentYear.id : uuid();
        if (!isCurrent) {
          years.push({
            id: yearId,
            name: span.name,
            start_date: span.start,
            end_date: span.end,
            is_current: false,
            tenant_id: school.id,
          });
        }
        const classIdOf = new Map<string, string>(); // current class id -> this year's class id
        const orgClasses: OrgClass[] = currentClasses.map((c) => {
          const id = isCurrent ? c.id : uuid();
          classIdOf.set(c.id, id);
          if (!isCurrent) {
            classes.push({
              id,
              name: c.name,
              numeric_grade: c.numeric_grade,
              shift: c.shift,
              version: c.version,
              shift_id: c.shift_id,
              academic_year_id: yearId,
              tenant_id: school.id,
            });
          }
          const names = b.sectionNames ?? ['A', 'B'];
          const orgSections = names.map((name) => {
            const section = { id: uuid(), name, group: b.sectionNames ? name : null };
            sections.push({
              id: section.id,
              class_id: id,
              section_name: name,
              group_name: section.group,
              tenant_id: school.id,
            });
            return section;
          });
          return { id, name: c.name, numericGrade: c.numeric_grade!, sections: orgSections };
        });
        if (!isCurrent) {
          for (const cs of currentSubjects) {
            classSubjects.push({
              class_id: classIdOf.get(cs.class_id),
              subject_id: cs.subject_id,
              academic_year_id: yearId,
              is_optional: cs.is_optional,
              is_graded_only: cs.is_graded_only,
              group_name: cs.group_name,
              choice_group: cs.choice_group,
              tenant_id: school.id,
            });
          }
          if (scale) {
            const scaleId = uuid();
            scales.push({
              id: scaleId,
              tenant_id: school.id,
              academic_year_id: yearId,
              class_id: null,
              name: scale.name,
              revision: 1,
            });
            for (const band of bands) {
              bandRows.push({
                tenant_id: school.id,
                scale_id: scaleId,
                percent_from: band.percent_from,
                percent_to: band.percent_to,
                grade: band.grade,
                gpa: band.gpa,
                is_fail: band.is_fail,
                sequence: band.sequence,
                comment: band.comment,
              });
            }
          }
        }

        for (const t of termsOf(span.start)) {
          terms.push({
            tenant_id: school.id,
            academic_year_id: yearId,
            seq: t.seq,
            name: t.name,
            start_date: t.start,
            end_date: t.end,
          });
        }

        for (const text of CALENDAR_EVENTS) {
          const rule = EVENT_RULES[text.en];
          if (!rule) continue;
          for (const [month, day] of rule.on) {
            let from = inSpan(span.start, month, day);
            if (text.kind !== 'HOLIDAY' && isFriday(from)) from = addDays(from, 1);
            // A working-day window must not cover a Friday (the weekly off): one row per Friday-free run.
            const working = text.kind !== 'HOLIDAY';
            const segments: [string, string][] = [];
            for (let i = 0; i < (rule.days ?? 1); i++) {
              const d = addDays(from, i);
              if (working && isFriday(d)) continue;
              const last = segments[segments.length - 1];
              if (last && addDays(last[1], 1) === d) last[1] = d;
              else segments.push([d, d]);
            }
            for (const [start, end] of segments) {
              const id = uuid();
              events.push({
                id,
                tenant_id: school.id,
                academic_year_id: yearId,
                type: EVENT_TYPE[text.kind],
                audience: CalendarAudience.ALL,
                name: text.bn,
                start_date: start,
                end_date: end,
                counts_as_working_day: working,
                published_at: stamp,
                external_refs: {},
                created_by_user_id: admin.id,
              });
              const linked = rule.all ? orgClasses : rule.top2 ? orgClasses.slice(-2) : [];
              for (const c of linked) {
                eventClasses.push({ event_id: id, class_id: c.id, tenant_id: school.id });
              }
            }
          }
        }

        tenant.years.push({
          id: yearId,
          name: span.name,
          start: span.start,
          end: span.end,
          isCurrent,
          classes: orgClasses,
        });
      }

      rows += await insertChunked(yearRepo, years as never);
      rows += await insertChunked(ctx.ds.getRepository(Class), classes as never);
      rows += await insertChunked(ctx.ds.getRepository(ClassSection), sections as never);
      rows += await insertChunked(ctx.ds.getRepository(ClassSubject), classSubjects as never);
      rows += await insertChunked(ctx.ds.getRepository(GradingScale), scales as never);
      rows += await insertChunked(ctx.ds.getRepository(GradingBand), bandRows as never);
      rows += await insertChunked(ctx.ds.getRepository(AcademicTerm), terms as never);
      rows += await insertChunked(ctx.ds.getRepository(CalendarEvent), events as never);
      rows += await insertChunked(ctx.ds.getRepository(CalendarEventClass), eventClasses as never);

      // Rooms: one per current section, plus the labs.
      const roomRows = [
        ...tenant.years[tenant.years.length - 1].classes.flatMap((c) =>
          c.sections.map((s) => ({ roomNo: `${c.name} ${s.name}`, capacity: 50, sectionId: s.id })),
        ),
        ...b.labs.map((lab) => ({ roomNo: lab, capacity: 30, sectionId: null })),
      ];
      const savedRooms = await ctx.ds.getRepository(Room).save(
        roomRows.map((r) => ({
          tenant_id: school.id,
          building: 'Academic Building',
          room_no: r.roomNo,
          capacity: r.capacity,
        })),
      );
      tenant.rooms = savedRooms.map((room, i) => ({
        id: room.id,
        roomNo: room.room_no,
        sectionId: roomRows[i].sectionId,
      }));
      rows += savedRooms.length;
      org.tenants.push(tenant);
    }

    ctx.ids.set('org', org);
    return rows;
  },
};

function slot(
  tenantId: string,
  shiftId: string,
  sequence: number,
  kind: PeriodSlotKind,
  name: string | null,
  startMin: number,
  minutes: number,
): PeriodSlot {
  return {
    tenant_id: tenantId,
    shift_id: shiftId,
    sequence,
    kind,
    name,
    starts_at: hhmm(startMin),
    ends_at: hhmm(startMin + minutes),
  } as PeriodSlot;
}
