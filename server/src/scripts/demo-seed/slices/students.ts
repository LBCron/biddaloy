import {
  EnrollmentStatus,
  PlacementAlgorithm,
  PromotionOutcome,
  PromotionRunStatus,
  StudentLifecycleEventType,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { Student } from '../../../modules/students/entities/student.entity';
import { Guardian } from '../../../modules/students/entities/guardian.entity';
import { Enrollment } from '../../../modules/students/entities/enrollment.entity';
import { StudentLifecycleEvent } from '../../../modules/students/entities/student-lifecycle-event.entity';
import { PromotionRun } from '../../../modules/promotions/entities/promotion-run.entity';
import { PromotionEntry } from '../../../modules/promotions/entities/promotion-entry.entity';
import { User } from '../../../modules/users/entities/user.entity';
import { UserTenant } from '../../../modules/auth/entities/user-tenant.entity';
import {
  NAME_POOLS,
  OTHER_GROUP_WEIGHTS,
  RELIGION_LABEL,
  RELIGION_WEIGHTS,
  type NameGroup,
  type NamePair,
} from '../../seed-data/demo-bn/names';
import { GUARDIAN_OCCUPATIONS } from '../../seed-data/demo-bn/occupations';
import { DHAKA_AREAS, ROAD_PATTERNS } from '../../seed-data/demo-bn/places';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { joinBranch, orgIds, type OrgIds } from './org';

/**
 * [58.2.03] Ten years of students (D3, D4, D33). Plan:
 *  1. Simulate the whole cohort in memory, deterministically (`ctx.rng`).
 *  2. Bulk-insert everything up to year `B = max(0, years - 3)`.
 *  3. The two latest year transitions go through the real `PromotionsService.commit` (D4);
 *     each year's new admissions are bulk-inserted right after its commit.
 *
 * Class 5 of the Primary branch has no promotion run: its leavers get a TC (TRANSFERRED_OUT) and
 * ~85% of them become a NEW Student row in High class 6 (the tenant boundary). The two rows are
 * linked only through the household's guardians, which exist as separate rows in each branch.
 */

const SIBLINGS = 0.17; // share of new students who join an existing one-child household
const RETAIN = 0.03;
const TRANSFER = 0.85; // of Primary's last class, into High
const START = 0.75; // D33: first history year is ~900 of the 1,200 today
const LOGIN_GUARDIANS = 0.05;
const LOGIN_STUDENTS = 3; // per branch, besides the 9-B card
const SECTION_CAP = 50;

type Gender = 'MALE' | 'FEMALE';
type Exit = 'GRADUATE' | 'TRANSFER' | 'LEFT';

/** One family. Its guardians are materialised per branch, when its first child appears there. */
interface Household {
  n: number;
  group: NameGroup;
  hasMother: boolean;
  joinY: number;
  surname: NamePair;
  father: NamePair;
  mother: NamePair;
  fatherPhone: string;
  motherPhone: string | null;
  email: string;
  address: NamePair;
  fatherJob: string;
  motherJob: string;
  userId?: string;
  guardians: Map<number, { father: string; mother: string | null }>;
}
/** A child. A Primary leaver and their High clone share one person. */
interface Person {
  hh: Household;
  gender: Gender;
  dob: string;
  blood: string;
  given: NamePair;
  birthRegNo: string;
}
interface Stay {
  y: number;
  c: number;
  s: number;
  enrId: string;
}
interface Stu {
  id: string;
  t: number;
  person: Person;
  joinY: number;
  stays: Stay[];
  exit?: Exit;
  reg: string;
  roll: number;
  userId?: string;
}

/** What later slices read from `ctx.ids.get('students')` (use `studentIds(ctx)`). */
export interface DemoStudent {
  id: string;
  tenantId: string;
  gender: Gender;
  regNo: string;
  status: EnrollmentStatus;
  userId: string | null;
  /** Oldest to newest, one per academic year attended. */
  stays: { yearId: string; classId: string; sectionId: string; enrollmentId: string }[];
  guardianIds: string[];
}
export interface StudentIds {
  students: DemoStudent[];
  /** Section id (sections belong to one academic year) -> students who sat in it that year. */
  bySection: Map<string, string[]>;
  guardians: { id: string; tenantId: string; userId: string | null }[];
  /** The login cards: the D13 guardian (children in Primary and High) and student 9-B. */
  cards: {
    guardianUserId: string;
    studentId: string;
    studentUserId: string;
    primaryChildId: string;
  };
}
export const studentIds = (ctx: DemoSeedContext): StudentIds =>
  ctx.ids.get('students') as StudentIds;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const bnDigits = (s: string) => s.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
const BLOOD = [
  ['O+', 36],
  ['A+', 27],
  ['B+', 22],
  ['AB+', 7],
  ['O-', 2],
  ['A-', 2],
  ['B-', 2],
  ['AB-', 2],
] as const;
const TC_TEXT = {
  TRANSFER: {
    reason: 'প্রাথমিক স্তর সম্পন্ন করে মাধ্যমিক শাখায় ভর্তি',
    destination: 'বাংলাদেশ মডেল স্কুল অ্যান্ড কলেজ — মাধ্যমিক শাখা',
  },
  LEFT: { reason: 'অভিভাবকের বদলির কারণে', destination: 'অন্য বিদ্যালয়' },
  GRADUATE: { reason: 'শিক্ষাবর্ষ সমাপ্ত, উত্তীর্ণ', destination: null },
} as const;

const lastStay = (s: Stu) => s.stays[s.stays.length - 1];

export const slice: DemoSlice = {
  name: 'students',
  covers: [Student, Guardian, Enrollment, PromotionRun, PromotionEntry, StudentLifecycleEvent],
  run: async (ctx) => {
    const org = orgIds(ctx);
    const Y = ctx.years;
    const B = Math.max(0, Y - 3); // bulk covers years 0..B; the rest is committed by the service
    const uuid = () => ctx.rng.string.uuid();
    const stamp = (date: string, hh = 10) => `${date}T${pad(hh)}:00:00+06:00`;
    const yearOf = (t: number, y: number) => org.tenants[t].years[y];
    const sectionId = (t: number, st: Stay) => yearOf(t, st.y).classes[st.c].sections[st.s].id;

    const { stus, d13 } = simulate(ctx, org);
    const students = stus.filter((s) => s.joinY <= B);
    let rows = 0;

    // ---- logins (D41, D43): users first, memberships after --------------------------------
    const guardianCard = DEMO_CARDS.find((c) => c.key === 'guardian')!;
    const studentCard = DEMO_CARDS.find((c) => c.key === 'student-9b')!;
    const current = stus.filter((s) => lastStay(s).y === Y - 1);
    const loginHouseholds = new Map<Household, number>(); // household -> branch it logs in to
    for (const s of current) {
      if (!loginHouseholds.has(s.person.hh) && ctx.rng.number.float() < LOGIN_GUARDIANS) {
        loginHouseholds.set(s.person.hh, s.t);
      }
    }
    loginHouseholds.set(d13.hh, d13.high.t);
    const loginStudents = new Set<Stu>([d13.high]);
    for (let t = 0; t < org.tenants.length; t++) {
      const here = current.filter((s) => s.t === t && s !== d13.high);
      for (let i = 0; i < Math.min(LOGIN_STUDENTS, here.length); i++) {
        loginStudents.add(ctx.rng.helpers.arrayElement(here));
      }
    }

    const users: Record<string, unknown>[] = [];
    const memberships: Record<string, unknown>[] = [];
    const now = stamp(ctx.anchor);
    for (const [hh, t] of loginHouseholds) {
      hh.userId = uuid();
      users.push({
        id: hh.userId,
        email: hh.email,
        phone: hh.fatherPhone,
        full_name: `${hh.father.en} ${hh.surname.en}`,
        password_hash: ctx.demoPasswordHash,
        status: UserStatus.ACTIVE,
        email_verified_at: now,
      });
      memberships.push({ user_id: hh.userId, tenant_id: org.tenants[t].id, role: UserRole.PARENT });
    }
    let studentLogin = 0;
    for (const s of loginStudents) {
      s.userId = uuid();
      users.push({
        id: s.userId,
        email: s === d13.high ? studentCard.email : `student${++studentLogin}@bmsc.example`,
        full_name: `${s.person.given.en} ${s.person.hh.surname.en}`,
        password_hash: ctx.demoPasswordHash,
        status: UserStatus.ACTIVE,
        email_verified_at: now,
      });
      memberships.push({
        user_id: s.userId,
        tenant_id: org.tenants[s.t].id,
        role: UserRole.STUDENT,
      });
    }
    rows += await insertChunked(ctx.ds.getRepository(User), users as never);
    rows += await insertChunked(ctx.ds.getRepository(UserTenant), memberships as never);
    // The D13 guardian's second branch goes through a real JOIN_SCHOOL request.
    await joinBranch(ctx, d13.hh.userId!, org.tenants[d13.primary.t].id, UserRole.PARENT);
    rows += 1;

    // ---- guardians: every household, in every branch one of its children attends ----------
    const guardianRows: Record<string, unknown>[] = [];
    const guardianIndex: StudentIds['guardians'] = [];
    for (const s of stus) {
      const hh = s.person.hh;
      if (hh.guardians.has(s.t)) continue;
      const tenantId = org.tenants[s.t].id;
      // Seeded exactly as #2282 enforces: a login's phone and email sit on every Guardian row.
      const userId =
        hh.userId && (loginHouseholds.get(hh) === s.t || hh === d13.hh) ? hh.userId : null;
      const father = { id: uuid(), mother: null as string | null };
      const g = (id: string, name: NamePair, rel: string, phone: string | null, job: string) => {
        const isFather = rel === 'Father';
        guardianRows.push({
          id,
          tenant_id: tenantId,
          user_id: isFather ? userId : null,
          full_name: `${name.en} ${hh.surname.en}`,
          relationship: rel,
          phone,
          email: isFather ? hh.email : null,
          alternate_phone: isFather ? hh.motherPhone : hh.fatherPhone,
          address: hh.address.bn,
          occupation: job,
          is_primary_contact: isFather,
        });
        guardianIndex.push({ id, tenantId, userId: isFather ? userId : null });
      };
      g(father.id, hh.father, 'Father', hh.fatherPhone, hh.fatherJob);
      if (hh.hasMother) {
        father.mother = uuid();
        g(father.mother, hh.mother, 'Mother', hh.motherPhone, hh.motherJob);
      }
      hh.guardians.set(s.t, { father: father.id, mother: father.mother });
    }
    rows += await insertChunked(ctx.ds.getRepository(Guardian), guardianRows as never);

    // ---- bulk history: students, enrollments, runs, TCs -------------------------------------
    const exitStatus = (s: Stu) =>
      s.exit === 'GRADUATE' ? EnrollmentStatus.GRADUATED : EnrollmentStatus.TRANSFERRED;
    /** Final status of an enrollment as of the bulk boundary: exits before B are closed, the rest ACTIVE. */
    const stayStatus = (s: Stu, st: Stay) =>
      s.exit && st === lastStay(s) && st.y < B ? exitStatus(s) : EnrollmentStatus.ACTIVE;

    const writeStudents = async (list: Stu[], rollBase: Map<string, number>) => {
      const studentRows: Record<string, unknown>[] = [];
      const enrollRows: Record<string, unknown>[] = [];
      const links: { student_id: string; guardian_id: string }[] = [];
      for (const s of list) {
        const inScope = s.stays.filter((st) => st.y <= (s.joinY <= B ? B : s.joinY));
        const last = inScope[inScope.length - 1];
        const sec = sectionId(s.t, last);
        s.roll = (rollBase.get(sec) ?? 0) + 1;
        rollBase.set(sec, s.roll);
        const { person } = s;
        const hh = person.hh;
        const g = hh.guardians.get(s.t)!;
        studentRows.push({
          id: s.id,
          tenant_id: org.tenants[s.t].id,
          user_id: s.userId ?? null,
          full_name: `${person.given.en} ${hh.surname.en}`,
          full_name_bn: `${person.given.bn} ${hh.surname.bn}`,
          blood_group: person.blood,
          registration_number: s.reg,
          roll_number: s.roll,
          class_section_id: sec,
          date_of_birth: person.dob,
          gender: person.gender,
          home_address: hh.address.bn,
          religion: RELIGION_LABEL[hh.group],
          birth_reg_no: person.birthRegNo,
          father_name: `${hh.father.en} ${hh.surname.en}`,
          mother_name: hh.hasMother ? `${hh.mother.en} ${hh.surname.en}` : null,
          enrollment_status: stayStatus(s, last),
        });
        links.push({ student_id: s.id, guardian_id: g.father });
        if (g.mother) links.push({ student_id: s.id, guardian_id: g.mother });
        for (const st of inScope) {
          const year = yearOf(s.t, st.y);
          enrollRows.push({
            id: st.enrId,
            tenant_id: org.tenants[s.t].id,
            student_id: s.id,
            class_id: year.classes[st.c].id,
            section_id: year.classes[st.c].sections[st.s].id,
            academic_year_id: year.id,
            enrollment_status: stayStatus(s, st),
            enrolled_at: stamp(year.start, 9),
          });
        }
      }
      rows += await insertChunked(ctx.ds.getRepository(Student), studentRows as never);
      rows += await insertChunked(ctx.ds.getRepository(Enrollment), enrollRows as never);
      for (let i = 0; i < links.length; i += 1000) {
        await ctx.ds
          .createQueryBuilder()
          .insert()
          .into('student_guardians', ['student_id', 'guardian_id'])
          .values(links.slice(i, i + 1000))
          .execute();
      }
      rows += links.length;
    };
    await writeStudents(students, new Map());

    const events: Record<string, unknown>[] = [];
    const exitEvent = (s: Stu, st: Stay, recordedBy: string) => {
      const year = yearOf(s.t, st.y);
      const text = TC_TEXT[s.exit!];
      events.push({
        tenant_id: org.tenants[s.t].id,
        student_id: s.id,
        enrollment_id: st.enrId,
        academic_year_id: year.id,
        event_type:
          s.exit === 'GRADUATE'
            ? StudentLifecycleEventType.GRADUATED
            : StudentLifecycleEventType.TRANSFERRED_OUT,
        occurred_on: addDays(year.end, -ctx.rng.number.int({ min: 1, max: 20 })),
        reason: text.reason,
        destination: text.destination,
        recorded_by_user_id: recordedBy,
      });
    };

    /** Members of (tenant, year, class), in the order they were seated. */
    const members = new Map<string, Stu[]>();
    for (const s of stus) {
      for (const st of s.stays) {
        const key = `${s.t}:${st.y}:${st.c}`;
        (members.get(key) ?? members.set(key, []).get(key)!).push(s);
      }
    }
    const stayAt = (s: Stu, y: number) => s.stays.find((st) => st.y === y);
    const outcomeOf = (s: Stu, y: number, c: number) => {
      const next = stayAt(s, y + 1);
      if (!next) return PromotionOutcome.GRADUATE;
      return next.c === c ? PromotionOutcome.RETAIN : PromotionOutcome.PROMOTE;
    };
    const hasRun = (t: number, c: number) =>
      !(org.tenants[t].kind === 'PRIMARY' && c === yearOf(t, 0).classes.length - 1);
    const adminId = org.adminUserId;

    /** One PromotionRun + entries per class for the transition y -> y+1. */
    const runRows = (t: number, y: number, committed: boolean) => {
      const runs: Record<string, unknown>[] = [];
      const entries: Record<string, unknown>[] = [];
      const tenantId = org.tenants[t].id;
      const [from, to] = [yearOf(t, y), yearOf(t, y + 1)];
      from.classes.forEach((cls, c) => {
        const cohort = members.get(`${t}:${y}:${c}`) ?? [];
        if (!hasRun(t, c) || cohort.length === 0) return;
        const runId = uuid();
        const graduating = c === from.classes.length - 1;
        runs.push({
          id: runId,
          tenant_id: tenantId,
          source_class_id: cls.id,
          source_academic_year_id: from.id,
          target_academic_year_id: to.id,
          target_class_id: graduating ? null : to.classes[c + 1].id,
          exam_ids: [],
          algorithm: PlacementAlgorithm.BLOCK,
          status: committed ? PromotionRunStatus.COMMITTED : PromotionRunStatus.DRAFT,
          refreshed_at: stamp(from.end),
          committed_at: committed ? stamp(from.end) : null,
          committed_by_user_id: committed ? adminId : null,
          created_by_user_id: adminId,
        });
        const rollOf = new Map<string, number>();
        cohort.forEach((s, rank) => {
          const out = outcomeOf(s, y, c);
          const next = stayAt(s, y + 1);
          const passed = out !== PromotionOutcome.RETAIN;
          const gpa = ctx.rng.number.float({ min: passed ? 2.5 : 1, max: passed ? 5 : 2.4 });
          const targetSection = next ? yearOf(t, y + 1).classes[next.c].sections[next.s].id : null;
          let roll: number | null = null;
          if (out === PromotionOutcome.PROMOTE) {
            roll = (rollOf.get(targetSection!) ?? 0) + 1;
            rollOf.set(targetSection!, roll);
          }
          const source = stayAt(s, y)!;
          entries.push({
            tenant_id: tenantId,
            run_id: runId,
            student_id: s.id,
            source_enrollment_id: source.enrId,
            source_section_id: cls.sections[source.s].id,
            merit_rank: rank + 1,
            mean_gpa: gpa.toFixed(2),
            total_marks_sum: (gpa * 160).toFixed(2),
            passed_all: passed,
            suggested_outcome: out,
            final_outcome: out,
            is_override: false,
            group_name: cls.sections[source.s].group,
            // The service fills the target columns itself when it commits a DRAFT run.
            target_class_id: committed && next ? to.classes[next.c].id : null,
            target_section_id: targetSection,
            new_roll_number: roll,
            target_enrollment_id: committed ? (next?.enrId ?? null) : null,
          });
        });
      });
      return { runs, entries };
    };

    for (let t = 0; t < org.tenants.length; t++) {
      for (let y = 0; y < B; y++) {
        const { runs, entries } = runRows(t, y, true);
        rows += await insertChunked(ctx.ds.getRepository(PromotionRun), runs as never);
        rows += await insertChunked(ctx.ds.getRepository(PromotionEntry), entries as never);
      }
    }
    // Graduations and TCs that closed a bulk year.
    for (const s of stus) if (s.exit && lastStay(s).y < B) exitEvent(s, lastStay(s), adminId);
    rows += await insertChunked(ctx.ds.getRepository(StudentLifecycleEvent), events as never);
    events.length = 0;

    // ---- the two latest transitions go through the real service (D4) ----------------------
    const promotions = ctx.app.get(PromotionsService);
    for (let y = B; y < Y - 1; y++) {
      for (let t = 0; t < org.tenants.length; t++) {
        const tenantId = org.tenants[t].id;
        const { runs, entries } = runRows(t, y, false);
        await insertChunked(ctx.ds.getRepository(PromotionRun), runs as never);
        await insertChunked(ctx.ds.getRepository(PromotionEntry), entries as never);
        for (const run of runs) {
          await promotions.commit(run.id as string, tenantId, adminId, UserRole.ADMIN, {
            headers: {},
          });
        }
        rows += runs.length + entries.length;
        const [from, to] = [yearOf(t, y), yearOf(t, y + 1)];
        // The service stamps "today"; these happened at the end of the source year. The spread
        // hashes student_id (from ctx.rng), never the database's own row id, so a re-run matches.
        await ctx.ds.query(
          `UPDATE student_lifecycle_events SET occurred_on = $3::date - (abs(hashtext(student_id::text)) % 20) - 1
             WHERE tenant_id = $1 AND academic_year_id = $2 AND event_type = 'GRADUATED'`,
          [tenantId, from.id, from.end],
        );
        await ctx.ds.query(
          `UPDATE promotion_runs SET committed_at = $2, refreshed_at = $2 WHERE id = ANY($1)`,
          [runs.map((r) => r.id), stamp(from.end)],
        );
        await ctx.ds.query(
          `UPDATE enrollments SET enrolled_at = $3 WHERE tenant_id = $1 AND academic_year_id = $2`,
          [tenantId, to.id, stamp(to.start, 9)],
        );
        // TCs: no service flow, the rows are closed directly.
        const leavers = stus.filter(
          (s) => s.t === t && s.exit && s.exit !== 'GRADUATE' && lastStay(s).y === y,
        );
        leavers.forEach((s) => exitEvent(s, lastStay(s), adminId));
        if (leavers.length) {
          await ctx.ds.query(
            `UPDATE enrollments SET enrollment_status = 'TRANSFERRED' WHERE id = ANY($1)`,
            [leavers.map((s) => stayAt(s, y)!.enrId)],
          );
          await ctx.ds.query(
            `UPDATE students SET enrollment_status = 'TRANSFERRED' WHERE id = ANY($1)`,
            [leavers.map((s) => s.id)],
          );
        }
        // The service created the next enrollments; pick up their ids for the following run.
        const made: { id: string; student_id: string }[] = await ctx.ds.query(
          `SELECT id, student_id FROM enrollments WHERE tenant_id = $1 AND academic_year_id = $2`,
          [tenantId, to.id],
        );
        const enrOf = new Map(made.map((e) => [e.student_id, e.id]));
        for (const s of stus) {
          const st = s.t === t && s.joinY <= y ? stayAt(s, y + 1) : undefined;
          if (st) st.enrId = enrOf.get(s.id) ?? st.enrId;
        }
      }
      rows += await insertChunked(ctx.ds.getRepository(StudentLifecycleEvent), events as never);
      events.length = 0;
      // New admissions of year y+1 (outside joiners and Primary -> High transfers): roll numbers continue.
      const fresh = stus.filter((s) => s.joinY === y + 1);
      const rollBase = new Map<string, number>();
      const max: { class_section_id: string; m: number }[] = await ctx.ds.query(
        `SELECT class_section_id, max(roll_number)::int AS m FROM students
           WHERE class_section_id = ANY($1) GROUP BY 1`,
        [fresh.map((s) => sectionId(s.t, stayAt(s, y + 1)!))],
      );
      max.forEach((r) => rollBase.set(r.class_section_id, r.m));
      await writeStudents(fresh, rollBase);
    }

    // ---- what later slices need ---------------------------------------------------------------
    const bySection = new Map<string, string[]>();
    const published: DemoStudent[] = stus.map((s) => {
      const hh = s.person.hh.guardians.get(s.t)!;
      for (const st of s.stays) {
        const key = sectionId(s.t, st);
        (bySection.get(key) ?? bySection.set(key, []).get(key)!).push(s.id);
      }
      return {
        id: s.id,
        tenantId: org.tenants[s.t].id,
        gender: s.person.gender,
        regNo: s.reg,
        status: s.exit ? exitStatus(s) : EnrollmentStatus.ACTIVE,
        userId: s.userId ?? null,
        stays: s.stays.map((st) => ({
          yearId: yearOf(s.t, st.y).id,
          classId: yearOf(s.t, st.y).classes[st.c].id,
          sectionId: sectionId(s.t, st),
          enrollmentId: st.enrId,
        })),
        guardianIds: [hh.father, ...(hh.mother ? [hh.mother] : [])],
      };
    });
    // [76.2.8] Gate cards: every student of one class per branch (Class 8, else the last class)
    // gets a 10-digit card number. One draw per card from ctx.rng; unique per tenant by retry.
    const issued = new Set<string>();
    for (const t of org.tenants) {
      const classes = t.years.find((y) => y.isCurrent)!.classes;
      const cls = classes.find((c) => c.name === 'Class 8') ?? classes[classes.length - 1];
      for (const sec of cls.sections)
        for (const id of bySection.get(sec.id) ?? []) {
          let card: string;
          do card = String(ctx.rng.number.int({ min: 1_000_000_000, max: 9_999_999_999 }));
          while (issued.has(card));
          issued.add(card);
          await ctx.ds.query(`UPDATE students SET card_no = $1 WHERE id = $2`, [card, id]);
        }
    }
    ctx.ids.set('students', {
      students: published,
      bySection,
      guardians: guardianIndex,
      cards: {
        guardianUserId: d13.hh.userId!,
        studentId: d13.high.id,
        studentUserId: d13.high.userId!,
        primaryChildId: d13.primary.id,
      },
    } satisfies StudentIds);
    return rows;
  },
};

/** The whole cohort, in memory. No ids from the database are needed. */
function simulate(ctx: DemoSeedContext, org: OrgIds) {
  const uuid = () => ctx.rng.string.uuid();
  const Y = ctx.years;
  const cap = Math.max(1, ctx.count(SECTION_CAP));
  const perSection = (y: number) =>
    Y === 1 ? cap : Math.max(1, Math.round(cap * (START + ((1 - START) * y) / (Y - 1))));
  const stus: Stu[] = [];
  const households: Household[] = [];
  const open: { hh: Household }[][] = org.tenants.map(() => []);
  const other = (g: Gender): Gender => (g === 'MALE' ? 'FEMALE' : 'MALE');
  const tOf = (kind: string) => org.tenants.findIndex((x) => x.kind === kind);

  const newHousehold = (y: number): Household => {
    const rel = ctx.weighted(
      Object.entries(RELIGION_WEIGHTS) as [keyof typeof RELIGION_WEIGHTS, number][],
    );
    const group: NameGroup =
      rel === 'ISLAM'
        ? 'MUSLIM'
        : rel === 'HINDUISM'
          ? 'HINDU'
          : ctx.weighted(Object.entries(OTHER_GROUP_WEIGHTS) as [NameGroup, number][]);
    const hh = {
      n: households.length + 1,
      group,
      hasMother: ctx.rng.number.float() < 0.6,
      joinY: y,
      guardians: new Map(),
    } as Household;
    households.push(hh);
    return hh;
  };
  const newPerson = (t: number, y: number, c: number, gender: Gender): Person => {
    let hh: Household | undefined;
    const pool = open[t].filter((o) => y - o.hh.joinY <= 5);
    if (pool.length && ctx.rng.number.float() < SIBLINGS) {
      hh = ctx.rng.helpers.arrayElement(pool).hh;
      open[t] = open[t].filter((o) => o.hh !== hh);
    } else {
      hh = newHousehold(y);
      open[t].push({ hh });
    }
    const grade = org.tenants[t].years[y].classes[c].numericGrade;
    const born = Number(org.tenants[t].years[y].start.slice(0, 4)) - 5 - grade;
    return {
      hh,
      gender,
      dob: `${born}-${pad(ctx.rng.number.int({ min: 1, max: 12 }))}-${pad(ctx.rng.number.int({ min: 1, max: 28 }))}`,
      blood: ctx.weighted(BLOOD),
      given: undefined as never, // set once the household (and so the religion) is final
      birthRegNo: '',
    };
  };
  const newStu = (t: number, y: number, person: Person): Stu => {
    const s: Stu = { id: uuid(), t, person, joinY: y, stays: [], reg: '', roll: 0 };
    stus.push(s);
    return s;
  };
  const stay = (s: Stu, y: number, c: number, sec: number) =>
    s.stays.push({ y, c, s: sec, enrId: uuid() });

  /** Fills (tenant, class, year) to its target size, balancing gender, then seats everybody. */
  const seat = (t: number, y: number, c: number, retained: Stu[], others: Stu[]): Stu[] => {
    const secs = org.tenants[t].years[y].classes[c].sections.length;
    const all = [...retained, ...others];
    const count = { MALE: 0, FEMALE: 0 };
    all.forEach((s) => count[s.person.gender]++);
    while (all.length < secs * perSection(y)) {
      const g: Gender = count.MALE <= count.FEMALE ? 'MALE' : 'FEMALE';
      count[g]++;
      const s = newStu(t, y, newPerson(t, y, c, g));
      others.push(s);
      all.push(s);
    }
    const size = new Array<number>(secs).fill(0);
    for (const r of retained) {
      const sec = lastStay(r).s; // the service matches the retained student's section by name
      size[sec]++;
      stay(r, y, c, sec);
    }
    for (const o of ctx.rng.helpers.shuffle(others)) {
      const sec = size.indexOf(Math.min(...size));
      size[sec]++;
      stay(o, y, c, sec);
    }
    return all;
  };
  const pickBalanced = (list: Stu[], n: number): Stu[] => {
    const q: Record<Gender, Stu[]> = { MALE: [], FEMALE: [] };
    for (const s of ctx.rng.helpers.shuffle(list)) q[s.person.gender].push(s);
    const out: Stu[] = [];
    let g: Gender = q.MALE.length >= q.FEMALE.length ? 'MALE' : 'FEMALE';
    while (out.length < n && (q.MALE.length || q.FEMALE.length)) {
      if (!q[g].length) g = other(g);
      out.push(q[g].pop()!);
      g = other(g);
    }
    return out;
  };

  // year 0
  let cur: Stu[][][] = org.tenants.map((tn, t) =>
    tn.years[0].classes.map((_, c) => seat(t, 0, c, [], [])),
  );
  // year y -> y + 1
  const high = tOf('HIGH');
  for (let y = 0; y < Y - 1; y++) {
    const retained = org.tenants.map((tn) => tn.years[y].classes.map(() => [] as Stu[]));
    const moved = org.tenants.map((tn) => tn.years[y].classes.map(() => [] as Stu[]));
    org.tenants.forEach((tn, t) => {
      const last = tn.years[y].classes.length - 1;
      cur[t].forEach((pool, c) => {
        if (c < last) {
          const keep = new Set(pickBalanced(pool, Math.round(RETAIN * pool.length)));
          for (const s of pool) (keep.has(s) ? retained[t][c] : moved[t][c + 1]).push(s);
        } else if (tn.kind === 'PRIMARY') {
          const go = new Set(pickBalanced(pool, Math.round(TRANSFER * pool.length)));
          for (const s of pool) {
            s.exit = go.has(s) ? 'TRANSFER' : 'LEFT';
            // The same child gets a new Student row in the next branch (the tenant boundary).
            if (go.has(s)) moved[high][0].push(newStu(high, y + 1, s.person));
          }
        } else {
          pool.forEach((s) => (s.exit = 'GRADUATE'));
        }
      });
    });
    cur = org.tenants.map((tn, t) =>
      tn.years[y + 1].classes.map((_, c) => seat(t, y + 1, c, retained[t][c], moved[t][c])),
    );
  }

  // The D13 household: one father, a child in Primary (class 3) and one in High (class 9-B).
  const find = (kind: string, grade: number, section?: string) => {
    const t = tOf(kind);
    const cls = org.tenants[t].years[Y - 1].classes.find((c) => c.numericGrade === grade)!;
    const idx = org.tenants[t].years[Y - 1].classes.indexOf(cls);
    const here = cur[t][idx].filter(
      (s) => !section || cls.sections[lastStay(s).s].name === section,
    );
    // Not a Primary leaver's High clone: that child's person (and household) is shared with Primary.
    const solo = here.filter((s) => stus.every((o) => o === s || o.person !== s.person));
    return (solo[0] ?? here[0])!;
  };
  const d13 = {
    hh: newHousehold(Y - 1),
    primary: find('PRIMARY', 3),
    high: find('HIGH', 9, 'B'),
  };
  d13.hh.group = 'MUSLIM';
  d13.hh.hasMother = true;
  d13.primary.person.hh = d13.hh;
  d13.high.person.hh = d13.hh;
  // Households the two re-parented children left behind would keep guardians with no child.
  const used = new Set(stus.map((x) => x.person.hh));
  households.splice(0, households.length, ...households.filter((h) => used.has(h)));

  // Names, phones and addresses, once every household is final.
  const nextPhone = ctx.nextPhone;
  const regSeq = new Map<string, number>();
  let birthSeq = 0;
  const pickName = (list: readonly NamePair[]) => ctx.rng.helpers.arrayElement(list);
  const guardianCard = DEMO_CARDS.find((c) => c.key === 'guardian')!;
  for (const hh of households) {
    const pool = NAME_POOLS[hh.group];
    hh.surname = pickName(pool.surnames);
    hh.father = pickName(pool.boys);
    hh.mother = pickName(pool.girls);
    hh.fatherPhone = nextPhone();
    hh.motherPhone = hh.hasMother ? nextPhone() : null;
    hh.email = hh === d13.hh ? guardianCard.email : `parent${hh.n}@bmsc.example`;
    const road = pickName(ROAD_PATTERNS);
    const area = pickName(DHAKA_AREAS);
    const house = () => ctx.rng.number.int({ min: 1, max: 60 });
    const fill = (text: string) => text.replace(/\{n\}/g, () => String(house()));
    hh.address = {
      en: `${fill(road.en)}, ${area.en}`,
      bn: `${bnDigits(fill(road.bn))}, ${area.bn}`,
    };
    const job = ctx.weighted(GUARDIAN_OCCUPATIONS.map((o) => [o.bn, o.weight] as const));
    hh.fatherJob = job;
    hh.motherJob = ctx.rng.number.float() < 0.7 ? 'গৃহিণী' : job;
  }
  const seenPerson = new Set<Person>();
  for (const s of stus) {
    const p = s.person;
    if (!seenPerson.has(p)) {
      seenPerson.add(p);
      const pool = NAME_POOLS[p.hh.group];
      p.given = pickName(p.gender === 'MALE' ? pool.boys : pool.girls);
      p.birthRegNo = `${p.dob.slice(0, 4)}${pad(++birthSeq, 13)}`;
    }
    const yearStart = org.tenants[s.t].years[s.joinY].start.slice(0, 4);
    const key = `${s.t}:${yearStart}`;
    const n = (regSeq.get(key) ?? 0) + 1;
    regSeq.set(key, n);
    s.reg = `REG-${yearStart}-${pad(n, 4)}`;
  }
  return { stus, households, d13 };
}
