import { TeacherAssignmentType, TeacherDesignation, UserRole, UserStatus } from '@biddaloy/shared';
import { DEMO_CARDS } from '../../../modules/demo/demo-accounts';
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { User } from '../../../modules/users/entities/user.entity';
import { Teacher } from '../../../modules/academics/entities/teacher.entity';
import { TeacherClassSection } from '../../../modules/academics/entities/teacher-class-section.entity';
import { CoordinatorAssignment } from '../../../modules/academics/entities/coordinator-assignment.entity';
import { StaffProfile } from '../../../modules/staff-profiles/entities/staff-profile.entity';
import { StaffHrRecord } from '../../../modules/staff-hr/entities/staff-hr-record.entity';
import { Designation } from '../../../modules/staff-hr/entities/designation.entity';
import { StaffDesignationHistory } from '../../../modules/staff-hr/entities/staff-designation-history.entity';
import { StaffFamilyMember } from '../../../modules/staff-hr/entities/staff-family-member.entity';
import { StaffAddress } from '../../../modules/staff-hr/entities/staff-address.entity';
import { StaffExperience } from '../../../modules/staff-hr/entities/staff-experience.entity';
import { StaffEducation } from '../../../modules/staff-hr/entities/staff-education.entity';
import { StaffTraining } from '../../../modules/staff-hr/entities/staff-training.entity';
import { StaffAchievement } from '../../../modules/staff-hr/entities/staff-achievement.entity';
import { StaffLanguage } from '../../../modules/staff-hr/entities/staff-language.entity';
import { StaffDocument } from '../../../modules/staff-hr/entities/staff-document.entity';
import {
  NAME_POOLS,
  OTHER_GROUP_WEIGHTS,
  RELIGION_LABEL,
  RELIGION_WEIGHTS,
  type NameGroup,
  type NamePair,
} from '../../seed-data/demo-bn/names';
import { DHAKA_AREAS, ROAD_PATTERNS } from '../../seed-data/demo-bn/places';
import { SUBJECTS, TEACHER_ROSTER } from '../../seed-data/demo-bn/subjects-staffing';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { joinBranch, orgIds, type OrgTenant } from './org';

/** What the routine / attendance / exam slices read. Teachers of a branch, in roster order. */
export interface StaffTeacher {
  teacherId: string;
  userId: string;
  staffProfileId: string;
  /** Roster slot (`H-01`); the shared ICT teacher keeps `H-18` in College too. */
  slot: string;
  subjects: readonly string[];
}
/** `tenantId -> teachers` (leavers are not in it). */
export const teachersByTenant = (ctx: DemoSeedContext) =>
  ctx.ids.get('teachersByTenant') as Map<string, StaffTeacher[]>;
/** `DEMO_CARDS` key -> the seeded login (admin is the org slice's). */
export const staffByCardKey = (ctx: DemoSeedContext) =>
  ctx.ids.get('staffByCardKey') as Map<string, { userId: string; tenantId: string }>;

type Kind = OrgTenant['kind'];
type Role =
  'TEACHER' | 'EXECUTIVE' | 'ACCOUNTANT' | 'OFFICE_STAFF' | 'EXAM_CONTROLLER' | 'COMMITTEE';

interface Person {
  userId: string;
  tenantId: string;
  role: Role;
  name: NamePair;
  religion: string;
  joined: string;
  /** Set for the one leaver per branch. */
  left?: string;
  /** A few teachers move from Assistant to Senior Teacher. */
  promotedOn?: string;
}

const DESIGNATIONS = {
  TEACHER: ['Assistant Teacher', 'সহকারী শিক্ষক', true],
  SENIOR: ['Senior Teacher', 'জ্যেষ্ঠ শিক্ষক', true],
  EXECUTIVE: ['Principal', 'অধ্যক্ষ', false],
  ACCOUNTANT: ['Accountant', 'হিসাবরক্ষক', false],
  OFFICE_STAFF: ['Office Assistant', 'অফিস সহকারী', false],
  EXAM_CONTROLLER: ['Exam Controller', 'পরীক্ষা নিয়ন্ত্রক', false],
} as const;

const DEGREES = ['B.Sc.', 'B.A. (Honours)', 'B.Com (Honours)', 'M.A.', 'M.Sc.', 'M.Com'];
const SCHOOL_DAY = 86_400_000;

export const slice: DemoSlice = {
  name: 'staff',
  covers: [
    Teacher,
    TeacherClassSection,
    CoordinatorAssignment,
    StaffProfile,
    StaffHrRecord,
    Designation,
    StaffDesignationHistory,
    StaffFamilyMember,
    StaffAddress,
    StaffExperience,
    StaffEducation,
    StaffTraining,
    StaffAchievement,
    StaffLanguage,
    StaffDocument,
  ],
  run: async (ctx) => {
    const org = orgIds(ctx);
    const users = ctx.app.get(UserService);
    const teachers = ctx.app.get(TeacherService);
    const { rng } = ctx;
    const ago = (days: number) =>
      new Date(Date.parse(ctx.anchor) - days * SCHOOL_DAY).toISOString().slice(0, 10);
    const span = ctx.years * 365;
    const veteran = () => ago(span + rng.number.int({ min: 30, max: 3000 }));
    const newcomer = () => ago(rng.number.int({ min: 30, max: Math.max(31, span - 30) }));

    const person = (): { name: NamePair; religion: string; group: NameGroup; boy: boolean } => {
      const bucket = ctx.weighted(Object.entries(RELIGION_WEIGHTS));
      const group: NameGroup =
        bucket === 'ISLAM'
          ? 'MUSLIM'
          : bucket === 'HINDUISM'
            ? 'HINDU'
            : (ctx.weighted(Object.entries(OTHER_GROUP_WEIGHTS)) as NameGroup);
      const pool = NAME_POOLS[group];
      const boy = rng.datatype.boolean(0.6);
      const given = ctx.pick(boy ? pool.boys : pool.girls);
      const sur = ctx.pick(pool.surnames);
      return {
        name: { en: `${given.en} ${sur.en}`, bn: `${given.bn} ${sur.bn}` },
        religion: RELIGION_LABEL[group],
        group,
        boy,
      };
    };

    const people: Person[] = [];
    const teacherRows = new Map<string, StaffTeacher[]>(); // by tenant
    const byCard = new Map<string, { userId: string; tenantId: string }>();
    const allUserIds: string[] = [];
    const tenantOf = new Map(org.tenants.map((t) => [t.kind, t] as const));

    const makeUser = async (tenant: OrgTenant, role: Role, email: string, nm: NamePair) => {
      const { user } = await users.create(
        {
          email,
          full_name: nm.en,
          role: role as UserRole,
          phone: ctx.nextPhone(),
        },
        tenant.id,
      );
      allUserIds.push(user.id);
      return user.id;
    };
    const makeTeacher = (
      tenant: OrgTenant,
      userId: string,
      subjects: readonly string[],
      joined: string,
    ) =>
      teachers.create(
        {
          user_id: userId,
          designations: [TeacherDesignation.SUBJECT_TEACHER],
          subject_specialization: subjects.map((s) => SUBJECTS[s].en).join(', ') || 'General',
          joining_date: joined,
        },
        tenant.id,
      );

    // --- per branch: teachers, leaver, principal, accountant, office, exam controller, committee
    let sharedIct: { userId: string; nm: NamePair; religion: string; joined: string } | null = null;
    for (const tenant of org.tenants) {
      const roster = TEACHER_ROSTER[tenant.kind];
      const own = roster.filter((r) => !r.alsoTeachesIn);
      const list: StaffTeacher[] = [];
      teacherRows.set(tenant.id, list);

      for (const [i, r] of roster.entries()) {
        const p = person();
        const isCard = tenant.kind === 'HIGH' && i === 0;
        const email = isCard
          ? DEMO_CARDS.find((c) => c.key === 'class-teacher-8a')!.email
          : r.alsoTeachesIn
            ? 'ict@bmsc.example'
            : `${r.slot.toLowerCase()}@bmsc.example`;
        // The last two of each branch's own staff "joined" inside the window (D33).
        const joined = own.slice(-2).includes(r) ? newcomer() : veteran();
        const userId = await makeUser(tenant, 'TEACHER', email, p.name);
        const t = await makeTeacher(tenant, userId, r.subjects, joined);
        list.push({
          teacherId: t.id,
          userId,
          staffProfileId: t.staff_profile_id,
          slot: r.slot,
          subjects: r.subjects,
        });
        const pr: Person = {
          userId,
          tenantId: tenant.id,
          role: 'TEACHER',
          name: p.name,
          religion: p.religion,
          joined,
        };
        if (!own.slice(-2).includes(r) && rng.datatype.boolean(0.3)) pr.promotedOn = ago(span / 2);
        people.push(pr);
        if (isCard) byCard.set('class-teacher-8a', { userId, tenantId: tenant.id });
        if (r.alsoTeachesIn) sharedIct = { userId, nm: p.name, religion: p.religion, joined };
      }

      // The branch's one leaver: a teacher whose membership is ended the real way.
      {
        const p = person();
        const joined = veteran();
        const userId = await makeUser(
          tenant,
          'TEACHER',
          `${tenant.kind.toLowerCase()}-retired@bmsc.example`,
          p.name,
        );
        await makeTeacher(tenant, userId, ['MATH'], joined);
        const left = ago(rng.number.int({ min: 30, max: Math.max(31, Math.floor(span / 2)) }));
        people.push({
          userId,
          tenantId: tenant.id,
          role: 'TEACHER',
          name: p.name,
          religion: p.religion,
          joined,
          left,
        });
        await users.remove(userId, tenant.id, org.adminUserId);
      }

      const roles: [Role, string, string][] = [
        ['EXECUTIVE', 'principal', 'principal'],
        ['ACCOUNTANT', 'accountant', 'accountant'],
        ['OFFICE_STAFF', 'office-staff', 'office'],
        ['EXAM_CONTROLLER', 'exam-controller', 'exams'],
      ];
      for (const [role, key, local] of roles) {
        const p = person();
        const card = tenant.kind === 'HIGH' ? DEMO_CARDS.find((c) => c.key === key) : undefined;
        const email = card?.email ?? `${tenant.kind.toLowerCase()}-${local}@bmsc.example`;
        const userId = await makeUser(tenant, role, email, p.name);
        people.push({
          userId,
          tenantId: tenant.id,
          role,
          name: p.name,
          religion: p.religion,
          joined: veteran(),
        });
        if (card) byCard.set(key, { userId, tenantId: tenant.id });
      }
      if (tenant.kind === 'HIGH') {
        for (let i = 0; i < 3; i++) {
          const p = person();
          const card = i === 0 ? DEMO_CARDS.find((c) => c.key === 'committee') : undefined;
          const userId = await makeUser(
            tenant,
            'COMMITTEE',
            card?.email ?? `committee${i + 1}@bmsc.example`,
            p.name,
          );
          people.push({
            userId,
            tenantId: tenant.id,
            role: 'COMMITTEE',
            name: p.name,
            religion: p.religion,
            joined: veteran(),
          });
          if (card) byCard.set('committee', { userId, tenantId: tenant.id });
        }
      }
    }

    // --- the shared ICT teacher (D10): a second membership the real way, then a College teacher row
    const college = tenantOf.get('COLLEGE')!;
    if (sharedIct) {
      const s = sharedIct as { userId: string; nm: NamePair; religion: string; joined: string };
      await joinBranch(ctx, s.userId, college.id, UserRole.TEACHER);
      const t = await makeTeacher(college, s.userId, ['ICT'], s.joined);
      teacherRows.get(college.id)!.push({
        teacherId: t.id,
        userId: s.userId,
        staffProfileId: t.staff_profile_id,
        slot: 'H-18',
        subjects: ['ICT'],
      });
      people.push({
        userId: s.userId,
        tenantId: college.id,
        role: 'TEACHER',
        name: s.nm,
        religion: s.religion,
        joined: s.joined,
      });
    }

    // --- one demo password, verified, active (D43)
    await ctx.ds
      .getRepository(User)
      .createQueryBuilder()
      .update()
      .set({
        password_hash: ctx.demoPasswordHash,
        status: UserStatus.ACTIVE,
        email_verified_at: new Date(`${ctx.anchor}T00:00:00+06:00`),
      })
      .whereInIds(allUserIds)
      .execute();

    // --- HR detail, one bulk insert per table
    const designationIds = new Map<string, string>(); // `${tenantId}|${key}`
    const designations = org.tenants.flatMap((t) =>
      Object.entries(DESIGNATIONS).map(([key, [en, bn, teaching]]) => {
        const id = ctx.rng.string.uuid();
        designationIds.set(`${t.id}|${key}`, id);
        return { id, tenant_id: t.id, title_en: en, title_bn: bn, is_teaching: teaching };
      }),
    );
    const hr: Record<string, unknown>[] = [];
    const hist: Record<string, unknown>[] = [];
    const family: Record<string, unknown>[] = [];
    const address: Record<string, unknown>[] = [];
    const experience: Record<string, unknown>[] = [];
    const education: Record<string, unknown>[] = [];
    const training: Record<string, unknown>[] = [];
    const achievements: Record<string, unknown>[] = [];
    const languages: Record<string, unknown>[] = [];
    const documents: Record<string, unknown>[] = [];

    for (const [n, p] of people.entries()) {
      const base = { tenant_id: p.tenantId, staff_user_id: p.userId };
      hr.push({
        tenant_id: p.tenantId,
        user_id: p.userId,
        index_no: `IDX-${3000 + n}`,
        salary_code: `SC-${ctx.pick([9, 10, 11, 12, 14])}`,
        mpo_date: p.joined as never,
        salary_scale: `Scale-${ctx.pick([9, 10, 11, 12, 14])}`,
        department:
          p.role === 'TEACHER'
            ? 'Academic'
            : p.role === 'ACCOUNTANT'
              ? 'Accounts'
              : 'Administration',
        blood_group: ctx.pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'B-', 'O-']),
        name_bn: p.name.bn,
        religion: p.religion,
      });
      if (p.role === 'COMMITTEE') continue; // not employees: no designation, profile or documents (D16)

      const key = p.role === 'TEACHER' ? 'TEACHER' : p.role;
      const d = (k: string) => designationIds.get(`${p.tenantId}|${k}`)!;
      const row = (designation: string, from: string, to: string | null, status = 'REGULAR') => ({
        tenant_id: p.tenantId,
        user_id: p.userId,
        designation_id: d(designation),
        effective_date: from as never,
        end_date: to as never,
        status: status as never,
        resigned_at:
          status === 'RESIGNED' && to ? (new Date(`${to}T00:00:00+06:00`) as never) : null,
        notes: null,
      });
      if (p.left) hist.push(row(key, p.joined, p.left, 'RESIGNED'));
      else if (p.promotedOn) {
        hist.push(row('TEACHER', p.joined, p.promotedOn), row('SENIOR', p.promotedOn, null));
      } else hist.push(row(key, p.joined, null));

      for (const [relation, occ] of [
        ['Spouse', 'Homemaker'],
        ['Father', 'Retired'],
      ] as const) {
        const pool =
          NAME_POOLS[
            (Object.keys(RELIGION_LABEL) as NameGroup[]).find(
              (g) => RELIGION_LABEL[g] === p.religion,
            ) ?? 'MUSLIM'
          ];
        const nm = ctx.pick(relation === 'Spouse' ? pool.girls : pool.boys);
        family.push({
          ...base,
          relation,
          name: `${nm.en} ${p.name.en.split(' ').pop()}`,
          occupation: occ,
          contact: null,
        });
      }
      for (const type of ['PRESENT', 'PERMANENT']) {
        const area = ctx.pick(DHAKA_AREAS);
        address.push({
          ...base,
          type,
          village_street: ctx
            .pick(ROAD_PATTERNS)
            .en.replace(/\{n\}/g, () => String(rng.number.int({ min: 1, max: 60 }))),
          post_office: area.en,
          upazila: area.en,
          district: 'Dhaka',
        });
      }
      experience.push({
        ...base,
        institution: 'City Model School',
        designation: p.role === 'TEACHER' ? 'Assistant Teacher' : 'Staff',
        from_date: ago(span + 2500) as never,
        to_date: ago(span + 1200) as never,
        description: 'Earlier service before joining this school.',
      });
      const degree = ctx.pick(DEGREES);
      education.push({
        ...base,
        degree,
        institution: 'National University',
        board_university: 'National University',
        result: ctx.pick(['First Class', 'Second Class', 'CGPA 3.50']),
        passing_year: String(Number(ctx.anchor.slice(0, 4)) - rng.number.int({ min: 8, max: 25 })),
      });
      training.push({
        ...base,
        title: 'Teachers Training Course',
        institution: 'BITAC',
        from_date: ago(span + 600) as never,
        to_date: ago(span + 590) as never,
        certificate_no: `CERT-${4000 + n}`,
      });
      if (n % 4 === 0) {
        achievements.push({
          ...base,
          title: 'Best Employee of the Year',
          description: 'Recognised by the school management committee.',
          date: ago(rng.number.int({ min: 60, max: span })) as never,
          issued_by: 'School Management Committee',
        });
      }
      languages.push(
        { ...base, language_name: 'Bengali', proficiency: 'Native' },
        { ...base, language_name: 'English', proficiency: 'Fluent' },
      );
      // No file blob (D-note): the key is a placeholder no storage object backs.
      documents.push({
        ...base,
        document_type: 'OTHER' as never,
        storage_key: `demo/appointment-letter-${n}.pdf`,
        original_filename: 'appointment-letter.pdf',
        content_type: 'application/pdf',
        uploaded_by_user_id: org.adminUserId,
      });
    }

    // --- class teachers for the current and previous year (47.0): one per section
    const tcs: Record<string, unknown>[] = [];
    for (const tenant of org.tenants) {
      const list = teacherRows
        .get(tenant.id)!
        .filter((t) => !(tenant.kind === 'COLLEGE' && t.slot === 'H-18'));
      const card = byCard.get('class-teacher-8a');
      const pool = list.filter((t) => t.userId !== card?.userId);
      let k = 0;
      for (const year of tenant.years.slice(-2)) {
        k = 0;
        for (const cls of year.classes) {
          for (const sec of cls.sections) {
            const is8a = tenant.kind === 'HIGH' && cls.name === 'Class 8' && sec.name === 'A';
            const t = is8a ? list.find((x) => x.userId === card!.userId)! : pool[k++ % pool.length];
            tcs.push({
              teacher_id: t.teacherId,
              section_id: sec.id,
              tenant_id: tenant.id,
              subject_id: null,
              assignment_type: TeacherAssignmentType.CLASS_TEACHER,
            });
          }
        }
      }
    }

    // --- coordinators (83.1.3, Epic 83 D36), main (HIGH) branch, current year only.
    // The class-teacher-8a card's teacher coordinates three consecutive classes; a Mathematics
    // teacher of the same branch coordinates Mathematics in two consecutive classes. Classes are
    // picked by position (numeric grade order), never by name; the start is drawn with ctx.rng.
    const coordinators: Record<string, unknown>[] = [];
    const high = org.tenants.find((t) => t.kind === 'HIGH');
    const card8a = byCard.get('class-teacher-8a');
    const current = high?.years.find((y) => y.isCurrent);
    if (high && card8a && current) {
      const classes = [...current.classes].sort((a, b) => a.numericGrade - b.numericGrade);
      const list = teacherRows.get(high.id) ?? [];
      const cardTeacher = list.find((t) => t.userId === card8a.userId);
      const mathsTeachers = list.filter(
        (t) => t.subjects.includes('MATH') && t.userId !== card8a.userId,
      );
      const [maths] = await ctx.ds.query(
        `SELECT id FROM subjects WHERE tenant_id = $1 AND name_en = $2 AND deleted_at IS NULL`,
        [high.id, SUBJECTS.MATH.en],
      );
      const run = (n: number) => {
        const start = rng.number.int({ min: 0, max: Math.max(0, classes.length - n) });
        return classes.slice(start, start + n);
      };
      if (cardTeacher && classes.length >= 3) {
        for (const cls of run(3)) {
          coordinators.push({
            id: rng.string.uuid(),
            tenant_id: high.id,
            teacher_id: cardTeacher.teacherId,
            class_id: cls.id,
            subject_id: null,
            assigned_by_user_id: org.adminUserId,
          });
        }
      }
      if (maths && mathsTeachers.length && classes.length >= 2) {
        const teacher = ctx.pick(mathsTeachers);
        for (const cls of run(2)) {
          coordinators.push({
            id: rng.string.uuid(),
            tenant_id: high.id,
            teacher_id: teacher.teacherId,
            class_id: cls.id,
            subject_id: maths.id,
            assigned_by_user_id: org.adminUserId,
          });
        }
      }
    }

    let rows = 0;
    const ins = async (entity: Function, data: Record<string, unknown>[]) => {
      rows += await insertChunked(ctx.ds.getRepository(entity as never), data as never);
    };
    await ins(Designation, designations);
    await ins(StaffHrRecord, hr);
    await ins(StaffDesignationHistory, hist);
    await ins(StaffFamilyMember, family);
    await ins(StaffAddress, address);
    await ins(StaffExperience, experience);
    await ins(StaffEducation, education);
    await ins(StaffTraining, training);
    await ins(StaffAchievement, achievements);
    await ins(StaffLanguage, languages);
    await ins(StaffDocument, documents);
    await ins(TeacherClassSection, tcs);
    await ins(CoordinatorAssignment, coordinators);

    ctx.ids.set('teachersByTenant', teacherRows);
    ctx.ids.set('staffByCardKey', byCard);
    return rows + allUserIds.length + people.length;
  },
};
