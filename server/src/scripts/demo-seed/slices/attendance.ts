import { randomBytes, randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';
import {
  AttendanceDeviceKind,
  AttendanceDeviceStatus,
  AttendanceEventDirection,
  AttendanceSessionState,
  AttendanceSource,
  ArrivalNoticeChannel,
  ArrivalNoticeLock,
  ArrivalNoticeMode,
  ArrivalNoticeStatus,
  AttendanceStatus,
  type AttendanceImportHistoryRow,
  LeaveStatus,
  LeaveType,
} from '@biddaloy/shared';
import { hashDeviceKey } from '../../../modules/attendance/devices/device.service';
import { ArrivalNoticeSubscription } from '../../../modules/attendance/entities/arrival-notice-subscription.entity';
import { AttendanceSession } from '../../../modules/attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../../modules/attendance/entities/attendance-record.entity';
import { AttendanceDevice } from '../../../modules/attendance/entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../../../modules/attendance/entities/attendance-device-event.entity';
import { StaffAttendanceSession } from '../../../modules/staff-attendance/entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from '../../../modules/staff-attendance/entities/staff-attendance-record.entity';
import { LeavePolicy } from '../../../modules/leave/entities/leave-policy.entity';
import { AttendanceImport } from '../../../modules/attendance/entities/attendance-import.entity';
import { LeaveRecord } from '../../../modules/leave/entities/leave-record.entity';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { schoolDays, todayAt } from '../dates';
import { orgIds } from './org';
import { studentIds } from './students';
import { staffByCardKey, teachersByTenant } from './staff';

const CHUNK = 5000; // 8-11 columns a row stays under Postgres' 65535 parameters
const BASE = 0.935; // ~92% overall once monsoon, Eid and the chronic pair are in (D36)
const LATE_SHARE = 0.03;
const PERIODS_TODAY = 3; // today's finalized sections have their first 3 periods marked (D15)
const FINALIZED_SHARE = 0.7;
/** D9 defaults, same as `seed.util.ts` (not exported there). */
const POLICIES: [LeaveType, number][] = [
  [LeaveType.CASUAL, 10],
  [LeaveType.SICK, 14],
  [LeaveType.EARNED, 15],
  [LeaveType.MATERNITY, 112],
  [LeaveType.PATERNITY, 7],
];
const REASONS = ['জরুরি পারিবারিক কাজ', 'অসুস্থতার কারণে', 'ব্যক্তিগত কাজ'];

/**
 * [76.2.8] D11: the uploaded sheet's days, from this year's school days before "today" (`past`).
 * The `need` days ending 3 back when the year has room; early in the year, the latest ones it has
 * (fewer rows). ponytail: before the year's first school day there is nothing, so no sheet (the
 * import page only takes the current year); a last-year sheet needs last year's rolls.
 */
export function importDays(past: string[], need: number): string[] {
  return past.length >= need + 2
    ? past.slice(past.length - 2 - need, past.length - 2)
    : past.slice(-need);
}

const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const range = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
/** mulberry32: a fast seeded stream. It is seeded from `ctx.rng`, so a run is still deterministic. */
const stream = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const udtCache = new Map<string, Record<string, string>>();
/**
 * One `INSERT ... SELECT FROM unnest(...)` per chunk: about 5x faster than the query builder, which
 * the multi-million-row history needs (D38). Column types come from `information_schema`, so enums
 * need no names here; jsonb goes through text. Columns left out of `columns` take their defaults.
 */
export async function unnestInsert(
  ds: DataSource,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): Promise<number> {
  let udt = udtCache.get(table);
  if (!udt) {
    const found: { column_name: string; udt_name: string }[] = await ds.query(
      `SELECT column_name, udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    udt = Object.fromEntries(found.map((c) => [c.column_name, c.udt_name]));
    udtCache.set(table, udt);
  }
  for (const c of columns) {
    // Array columns would be flattened by unnest; an unknown name would cast to "undefined"[].
    if (!udt[c] || udt[c].startsWith('_'))
      throw new Error(`unnestInsert: ${table}.${c} unsupported`);
  }
  const json = columns.map((c) => udt![c] === 'jsonb');
  const sql =
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) SELECT ` +
    columns.map((_, i) => (json[i] ? `c${i}::jsonb` : `c${i}`)).join(', ') +
    ' FROM unnest(' +
    columns.map((c, i) => `$${i + 1}::"${json[i] ? 'text' : udt![c]}"[]`).join(', ') +
    `) AS u(${columns.map((_, i) => `c${i}`).join(', ')})`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await ds.query(
      sql,
      columns.map((c, k) =>
        part.map((r) => {
          const v = r[c] ?? null;
          if (v instanceof Date) return v.toISOString();
          return json[k] && v !== null ? JSON.stringify(v) : v;
        }),
      ),
    );
  }
  return rows.length;
}
const SESSION_COLS = [
  'id',
  'tenant_id',
  'section_id',
  'date',
  'period_no',
  'subject_id',
  'state',
  'marked_by_user_id',
  'marked_at',
  'finalized_at',
];
const RECORD_COLS = [
  'tenant_id',
  'session_id',
  'student_id',
  'date',
  'status',
  'minutes_late',
  'recorded_by_user_id',
  'recorded_at',
];

interface PeriodSlot {
  periodNo: number;
  subjectId: string;
  userId: string | null;
}

/**
 * Bulk-load trick: the plain secondary indexes of the two big tables are dropped for the load and rebuilt
 * from their own definitions afterwards. Keys, foreign keys and UNIQUE indexes (`UQ_att_session`,
 * `IDX_attendance_records_session_student`) stay, so a duplicate row fails at its insert. A killed run
 * leaves the dropped indexes missing: the seed only targets a fresh DB, so drop it and re-run.
 */
async function withoutIndexes<T>(
  ds: DataSource,
  tables: string[],
  load: () => Promise<T>,
): Promise<T> {
  const defs: { indexname: string; indexdef: string; dropdef: string }[] = await ds.query(
    `SELECT i.indexname, i.indexdef, format('DROP INDEX public.%I', i.indexname) AS dropdef
       FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.tablename = ANY($1)
        AND i.indexdef NOT LIKE 'CREATE UNIQUE INDEX%'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = i.indexname)`,
    [tables],
  );
  const dropped: typeof defs = [];
  // Every dropped index is rebuilt in its own try, so one failure does not leave the rest missing.
  const rebuild = async (): Promise<unknown[]> => {
    const errors: unknown[] = [];
    for (const d of dropped) {
      try {
        await ds.query(d.indexdef);
      } catch (e) {
        errors.push(e);
        console.error(`attendance: rebuilding ${d.indexname} failed: ${(e as Error).message}`);
      }
    }
    return errors;
  };
  let result: T;
  try {
    for (const d of defs) {
      await ds.query(d.dropdef); // the name is quoted by format('%I')
      dropped.push(d);
    }
    result = await load();
  } catch (e) {
    await rebuild(); // the load error is the one that surfaces; rebuild errors are only logged
    throw e;
  }
  const errors = await rebuild();
  if (errors.length) throw errors[0];
  return result;
}

/**
 * Non-working days from each branch's published calendar: `tenantOff` (tenant id -> dates) for the
 * whole branch, `classOff` (class id -> dates) for events limited to some classes. The learning slice
 * uses the same days, so a lesson is never "taught" on a day with no attendance.
 */
export async function calendarOffDays(
  ds: DataSource,
  tenantIds: string[],
): Promise<{ tenantOff: Map<string, Set<string>>; classOff: Map<string, Set<string>> }> {
  const tenantOff = new Map<string, Set<string>>();
  const classOff = new Map<string, Set<string>>();
  const events: { tenant_id: string; s: string; e: string; classes: string[] }[] = await ds.query(
    `SELECT e.tenant_id, e.start_date::text AS s, e.end_date::text AS e,
              array(SELECT ec.class_id FROM calendar_event_classes ec WHERE ec.event_id = e.id) AS classes
         FROM calendar_events e
        WHERE e.tenant_id = ANY($1) AND e.deleted_at IS NULL AND e.published_at IS NOT NULL
          AND e.counts_as_working_day = false`,
    [tenantIds],
  );
  for (const ev of events) {
    const into = (map: Map<string, Set<string>>, key: string) =>
      map.get(key) ?? map.set(key, new Set()).get(key)!;
    for (const d of range(ev.s, ev.e)) {
      if (!ev.classes.length) into(tenantOff, ev.tenant_id).add(d);
      for (const c of ev.classes) into(classOff, c).add(d);
    }
  }
  return { tenantOff, classOff };
}

const load = async (ctx: DemoSeedContext) => {
  const org = orgIds(ctx);
  const st = studentIds(ctx);
  const rnd = stream(ctx.rng.number.int({ min: 1, max: 2 ** 31 - 1 }));
  const q = <T>(sql: string, args: unknown[] = []): Promise<T[]> => ctx.ds.query(sql, args);
  const tenantIds = org.tenants.map((t) => t.id);
  const yesterday = addDays(ctx.anchor, -1);
  let rows = 0;

  // --- calendar: holidays per tenant / per class, and the Eid windows (D36) ----------------
  const { tenantOff, classOff } = await calendarOffDays(ctx.ds, tenantIds);
  const eid = new Set<string>();
  const eids = await q<{ s: string; e: string }>(
    `SELECT e.date::text AS s, e.end_date::text AS e FROM public_holiday_entries e
         JOIN public_holiday_sets h ON h.id = e.set_id
        WHERE h.country = 'BD' AND e.name LIKE 'Eid-ul-%'`,
  );
  for (const h of eids) for (const d of range(addDays(h.s, -3), addDays(h.e, 3))) eid.add(d);

  // --- who marks what: class teachers and the routine's period slots -----------------------
  const classTeacher = new Map<string, string>();
  for (const r of await q<{ section_id: string; user_id: string }>(
    `SELECT DISTINCT ON (tcs.section_id) tcs.section_id, t.user_id
         FROM teacher_class_sections tcs JOIN teachers t ON t.id = tcs.teacher_id
        WHERE tcs.tenant_id = ANY($1) AND tcs.assignment_type = 'CLASS_TEACHER'
        ORDER BY tcs.section_id, t.id`,
    [tenantIds],
  ))
    classTeacher.set(r.section_id, r.user_id);
  // section -> weekday -> periods (every slot is WEEKLY, so the grid repeats all year)
  const grid = new Map<string, Map<number, PeriodSlot[]>>();
  for (const r of await q<{
    section_id: string;
    weekday: number;
    period_no: number;
    subject_id: string;
    user_id: string | null;
  }>(
    `SELECT rs.section_id, rs.weekday, ps.sequence AS period_no, rs.subject_id,
              (SELECT t.user_id FROM routine_slot_teachers rst JOIN teachers t ON t.id = rst.teacher_id
                WHERE rst.routine_slot_id = rs.id ORDER BY t.id LIMIT 1) AS user_id
         FROM routine_slots rs JOIN period_slots ps ON ps.id = rs.period_slot_id
        WHERE rs.tenant_id = ANY($1) AND ps.kind = 'CLASS'
        ORDER BY ps.sequence`,
    [tenantIds],
  )) {
    const byDay = grid.get(r.section_id) ?? grid.set(r.section_id, new Map()).get(r.section_id)!;
    const list = byDay.get(r.weekday) ?? byDay.set(r.weekday, []).get(r.weekday)!;
    list.push({ periodNo: r.period_no, subjectId: r.subject_id, userId: r.user_id });
  }

  // --- devices: one per branch. The key is random per run and never printed or stored
  // (only its hash is), so no visitor can post scans; a gate reader is set up again by rotating it.
  // The fingerprint skips token columns, so a fresh key per run keeps the seed deterministic.
  const deviceOf = new Map<string, string>();
  const devices = org.tenants.map((t) => {
    const key = `bd_dev_${randomBytes(18).toString('hex')}`;
    const id = randomUUID();
    deviceOf.set(t.id, id);
    return {
      id,
      tenant_id: t.id,
      name: 'Main Gate Reader',
      kind: AttendanceDeviceKind.FACE,
      token_hash: hashDeviceKey(key),
      token_last4: key.slice(-4),
      roster_access: true,
      status: AttendanceDeviceStatus.ACTIVE,
      last_seen_at: todayAt(ctx.anchor, 8, 0),
      created_by_user_id: org.adminUserId,
    };
  });
  rows += await insertChunked(ctx.ds.getRepository(AttendanceDevice), devices as never);

  // --- today (D15): which sections are finalized, which one is a draft ---------------------
  const high = org.tenants.find((t) => t.kind === 'HIGH')!;
  const todayMode = new Map<string, 'FINALIZED' | 'DRAFT'>();
  const current: { id: string }[] = [];
  for (const t of org.tenants) {
    const year = t.years.find((y) => y.isCurrent)!;
    for (const c of year.classes)
      for (const s of c.sections) {
        if (!st.bySection.get(s.id)?.length) continue;
        // High Class 8-A is the demo class teacher's section: its register is the draft.
        const draft = t.id === high.id && c.name === 'Class 8' && s.name === 'A';
        if (draft) todayMode.set(s.id, 'DRAFT');
        else current.push({ id: s.id });
      }
  }
  // Deterministic shuffle, then the first 70% (of all sections) are finalized.
  for (let i = current.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [current[i], current[j]] = [current[j], current[i]];
  }
  const total = current.length + todayMode.size;
  for (const s of current.slice(0, Math.round(total * FINALIZED_SHARE)))
    todayMode.set(s.id, 'FINALIZED');

  // --- student attendance --------------------------------------------------------------
  let sBuf: Record<string, unknown>[] = [];
  let rBuf: Record<string, unknown>[] = [];
  // Rows with a device, an explicit id or a non-default source (today at High): the slow path.
  const rSlow: Record<string, unknown>[] = [];
  const flush = async () => {
    rows += await unnestInsert(ctx.ds, 'attendance_sessions', SESSION_COLS, sBuf);
    rows += await unnestInsert(ctx.ds, 'attendance_records', RECORD_COLS, rBuf);
    sBuf = [];
    rBuf = [];
  };
  const todayEvents: Record<string, unknown>[] = [];

  // [76.2.8] D5: three scanned-but-absent students in the High draft (teacher marked them ABSENT).
  let mismatchLeft = 3;
  // [76.2.8] D11: one uploaded sheet in the first non-High branch, 3 school days back; its records
  // are written below with source IMPORT. Target = that branch's first section with students.
  const importTenant = org.tenants.find((t) => t.id !== high.id)!;
  const importSection = importTenant.years
    .find((y) => y.isCurrent)!
    .classes.flatMap((c) => c.sections)
    .find((sec) => (st.bySection.get(sec.id)?.length ?? 0) > 0)!;
  const IMPORT_ROWS = 40;
  const imported: { date: string; id: string; status: AttendanceStatus; i: number }[] = [];
  let importDates = new Set<string>();

  for (const t of org.tenants) {
    for (const [yi, year] of t.years.entries()) {
      const withPeriods = yi >= t.years.length - 2; // current and previous year (D3)
      const to = year.end < ctx.anchor ? year.end : ctx.anchor;
      if (year.start > to) continue;
      for (const cls of year.classes) {
        const off = [...(tenantOff.get(t.id) ?? []), ...(classOff.get(cls.id) ?? [])];
        const days = schoolDays(year.start, to, [5], off);
        for (const sec of cls.sections) {
          const kids = st.bySection.get(sec.id);
          if (!kids?.length) continue;
          // Two chronic absentees in a real-sized section, one in a small one: a defaulter list is never empty.
          const chronic = new Set<number>();
          while (chronic.size < (kids.length >= 10 ? 2 : 1))
            chronic.add(Math.floor(rnd() * kids.length));
          const rate = kids.map(() => BASE + (rnd() - 0.5) * 0.06);
          // A chronic absentee misses 3 days in every 10 (70%): always under 75%, in runs of 3.
          const phase = kids.map(() => Math.floor(rnd() * 10));
          const marker = classTeacher.get(sec.id) ?? org.adminUserId;
          const isImportSec = sec.id === importSection.id && year.isCurrent;
          if (isImportSec) {
            importDates = new Set(
              importDays(
                days.filter((d) => d < ctx.anchor),
                Math.ceil((IMPORT_ROWS - 1) / kids.length),
              ),
            );
          }
          for (const [k, date] of days.entries()) {
            const isToday = date === ctx.anchor;
            const mode = isToday ? todayMode.get(sec.id) : 'FINALIZED';
            if (!mode) continue; // today, not started: "attendance pending"
            const month = Number(date.slice(5, 7));
            const drop = (month >= 6 && month <= 8 ? 0.05 : 0) + (eid.has(date) ? 0.05 : 0);
            const dayState =
              mode === 'DRAFT' ? AttendanceSessionState.DRAFT : AttendanceSessionState.FINALIZED;
            const deviceFilled = isToday && mode === 'DRAFT' && t.id === high.id;
            const sessionId = randomUUID();
            const markedAt = todayAt(date, 13);
            sBuf.push({
              id: sessionId,
              tenant_id: t.id,
              section_id: sec.id,
              date,
              period_no: null,
              state: dayState,
              marked_by_user_id: marker,
              marked_at: markedAt,
              finalized_at: dayState === AttendanceSessionState.FINALIZED ? markedAt : null,
            });
            const status: AttendanceStatus[] = [];
            const late: (number | null)[] = [];
            kids.forEach((studentId, i) => {
              const r = rnd();
              let s: AttendanceStatus;
              const present = chronic.has(i) ? (k + phase[i]) % 10 >= 3 : r < rate[i] - drop;
              if (present)
                s = rnd() < LATE_SHARE ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
              else
                s =
                  !chronic.has(i) && rnd() < 0.15
                    ? AttendanceStatus.LEAVE
                    : AttendanceStatus.ABSENT;
              // A scanned student the teacher then marked absent (D5): the mismatch badge counts it.
              const mismatch = deviceFilled && mismatchLeft > 0 && s === AttendanceStatus.PRESENT;
              if (mismatch) {
                s = AttendanceStatus.ABSENT;
                mismatchLeft--;
              }
              status.push(s);
              const minutes = s === AttendanceStatus.LATE ? 5 + Math.floor(rnd() * 26) : null;
              late.push(minutes);
              const isImport =
                isImportSec && importDates.has(date) && imported.length < IMPORT_ROWS - 1;
              const id = (isToday && t.id === high.id) || isImport ? randomUUID() : undefined;
              if (isImport) imported.push({ date, id: id!, status: s, i });
              // Only a student who came in scanned at the gate; in the device-filled draft the rest
              // are the teacher's marks, with no check-in time.
              const scannedAt =
                id &&
                isToday &&
                (mismatch || (s !== AttendanceStatus.ABSENT && s !== AttendanceStatus.LEAVE))
                  ? todayAt(date, 7, Math.floor(rnd() * 50))
                  : null;
              const byDevice = deviceFilled && !!scannedAt && !mismatch;
              const row = {
                ...(id && { id }),
                tenant_id: t.id,
                session_id: sessionId,
                student_id: studentId,
                date,
                status: s,
                minutes_late: minutes,
                recorded_by_user_id: byDevice ? null : marker,
                recorded_at: markedAt, // not the DB clock: two runs must match
              };
              if (id) {
                rSlow.push({
                  ...row,
                  source: byDevice
                    ? AttendanceSource.DEVICE
                    : isImport
                      ? AttendanceSource.IMPORT
                      : AttendanceSource.TEACHER,
                  device_id: scannedAt ? deviceOf.get(t.id) : null,
                  check_in_at: scannedAt,
                });
              } else rBuf.push(row);
              if (scannedAt) {
                todayEvents.push({
                  tenant_id: t.id,
                  device_id: deviceOf.get(t.id),
                  device_event_id: `${date}-${todayEvents.length}`,
                  student_id: studentId,
                  occurred_at: scannedAt,
                  direction: AttendanceEventDirection.IN,
                  // A teacher's mark wins over a device scan (rule 1 on the record entity).
                  outcome: deviceFilled ? 'accepted' : 'skipped_teacher_marked',
                  record_id: id,
                });
              }
            });
            // Period registers: a student absent for the day is absent in every period.
            if (withPeriods && mode === 'FINALIZED') {
              const slots = grid.get(sec.id)?.get(new Date(`${date}T00:00:00Z`).getUTCDay()) ?? [];
              for (const p of slots) {
                if (isToday && p.periodNo > PERIODS_TODAY) continue;
                const pid = randomUUID();
                const at = todayAt(date, 8 + p.periodNo);
                const by = p.userId ?? marker;
                sBuf.push({
                  id: pid,
                  tenant_id: t.id,
                  section_id: sec.id,
                  date,
                  period_no: p.periodNo,
                  subject_id: p.subjectId,
                  state: AttendanceSessionState.FINALIZED,
                  marked_by_user_id: by,
                  marked_at: at,
                  finalized_at: at,
                });
                kids.forEach((studentId, i) => {
                  // Lateness belongs to the first period only.
                  const s =
                    status[i] === AttendanceStatus.LATE && p.periodNo !== slots[0].periodNo
                      ? AttendanceStatus.PRESENT
                      : status[i];
                  rBuf.push({
                    tenant_id: t.id,
                    session_id: pid,
                    student_id: studentId,
                    date,
                    status: s,
                    minutes_late: s === AttendanceStatus.LATE ? late[i] : null,
                    recorded_by_user_id: by,
                    recorded_at: at,
                  });
                });
              }
            }
            if (rBuf.length >= CHUNK) await flush();
          }
        }
      }
    }
  }
  await flush();
  // The sessions of the slow rows were flushed above, so the foreign keys hold.
  rows += await insertChunked(ctx.ds.getRepository(AttendanceRecord), rSlow as never, CHUNK / 2);
  rows += await insertChunked(
    ctx.ds.getRepository(AttendanceDeviceEvent),
    todayEvents as never,
    CHUNK / 2,
  );

  // --- [76.2.8] the upload history row: 1 section, 40 rows, 2 CHANGED, 1 ERROR, the rest NEW ----
  // Real rolls (they are reassigned on promotion, so never the roster index).
  const importKids = st.bySection.get(importSection.id) ?? [];
  const rollOf = new Map(
    (
      await q<{ id: string; roll_number: number }>(
        `SELECT id, roll_number FROM students WHERE id = ANY($1::uuid[])`,
        [importKids],
      )
    ).map((r) => [r.id, r.roll_number]),
  );
  const sheetRows: AttendanceImportHistoryRow[] = imported.map((r, n) => {
    const changed = n < 2;
    return {
      date: r.date,
      sectionId: importSection.id,
      roll: rollOf.get(importKids[r.i])!,
      before: changed
        ? r.status === AttendanceStatus.ABSENT
          ? AttendanceStatus.PRESENT
          : AttendanceStatus.ABSENT
        : null,
      after: r.status,
      outcome: changed ? 'CHANGED' : 'NEW',
      recordId: r.id,
    };
  });
  if (sheetRows.length) {
    // ponytail: the error row is a roll no section has; one is enough to show the red state.
    sheetRows.splice(2, 0, {
      date: sheetRows[0].date,
      sectionId: importSection.id,
      roll: Math.max(0, ...rollOf.values()) + 1, // a roll nobody in the section has
      before: null,
      after: null,
      outcome: 'ERROR',
      recordId: null,
      code: 'ROLL_NOT_IN_SECTION',
    });
    const importDay = sheetRows[sheetRows.length - 1].date;
    await ctx.ds.getRepository(AttendanceImport).insert({
      tenant_id: importTenant.id,
      // The admin, not the class teacher: these past days are FINALIZED, and only a holder of
      // ATTENDANCE_CORRECT could really upload over them (validate refuses TEACHER every row).
      uploaded_by_user_id: org.adminUserId,
      file_name: 'class-attendance.xlsx',
      rows: sheetRows,
      count_new: sheetRows.filter((r) => r.outcome === 'NEW').length,
      count_changed: sheetRows.filter((r) => r.outcome === 'CHANGED').length,
      count_unchanged: 0,
      count_error: sheetRows.filter((r) => r.outcome === 'ERROR').length,
      created_at: todayAt(addDays(importDay, 1), 11),
    });
    rows += 1;
  }

  // --- leave policies and the approved / rejected ledger -------------------------------
  await ctx.ds
    .getRepository(LeavePolicy)
    .createQueryBuilder()
    .insert()
    .values(
      tenantIds.flatMap((tenant_id) =>
        POLICIES.map(([leave_type, annual_quota_days]) => ({
          tenant_id,
          leave_type,
          annual_quota_days,
        })),
      ),
    )
    .orIgnore()
    .execute();
  rows += tenantIds.length * POLICIES.length;

  const joined = new Map<string, string>(
    (
      await q<{ id: string; j: string | null }>(
        `SELECT id, joining_date::text AS j FROM staff_profiles WHERE tenant_id = ANY($1)`,
        [tenantIds],
      )
    ).map((r) => [r.id, r.j ?? '0000-01-01']),
  );
  const leaveDays = new Set<string>(); // `${staffProfileId}|${date}`
  const leaves: Record<string, unknown>[] = [];
  const teachers = teachersByTenant(ctx);
  for (const t of org.tenants) {
    const off = tenantOff.get(t.id) ?? new Set<string>();
    for (const year of t.years) {
      const to = year.end < yesterday ? year.end : yesterday;
      if (year.start > to) continue;
      const days = schoolDays(year.start, to, [5], off);
      for (const teacher of teachers.get(t.id) ?? []) {
        const since = joined.get(teacher.staffProfileId)!;
        const usable = days.filter((d) => d >= since);
        let next = 0; // the next free day index: leaves never overlap
        for (let n = 0; n < 6 && next < usable.length; n++) {
          const length = 1 + Math.floor(rnd() * 3);
          const left = usable.length - next - length;
          if (left < 0) break;
          const i = next + Math.floor(rnd() * Math.max(1, left / (6 - n)));
          const span = usable.slice(i, i + length);
          next = i + length + 1;
          const approved = rnd() < 0.8;
          const r = rnd();
          leaves.push({
            tenant_id: t.id,
            staff_profile_id: teacher.staffProfileId,
            leave_type: r < 0.5 ? LeaveType.CASUAL : r < 0.8 ? LeaveType.SICK : LeaveType.EARNED,
            start_date: span[0],
            end_date: span[span.length - 1],
            days: span.length,
            status: approved ? LeaveStatus.APPROVED : LeaveStatus.REJECTED,
            reason: ctx.pick(REASONS),
            approved_by: org.adminUserId,
            decided_at: todayAt(addDays(span[0], -2), 10),
          });
          if (approved) for (const d of span) leaveDays.add(`${teacher.staffProfileId}|${d}`);
        }
      }
    }
  }
  // Today: the teacher the routine's substitution covers is on approved leave.
  const rt = ctx.ids.get('routineToday') as
    { tenantId: string; date: string; coveredUserId: string } | undefined;
  if (rt) {
    const [p] = await q<{ id: string }>(
      `SELECT id FROM staff_profiles WHERE tenant_id = $1 AND user_id = $2`,
      [rt.tenantId, rt.coveredUserId],
    );
    leaves.push({
      tenant_id: rt.tenantId,
      staff_profile_id: p.id,
      leave_type: LeaveType.SICK,
      start_date: rt.date,
      end_date: rt.date,
      days: 1,
      status: LeaveStatus.APPROVED,
      reason: REASONS[1],
      approved_by: org.adminUserId,
      decided_at: todayAt(addDays(rt.date, -1), 10),
    });
    leaveDays.add(`${p.id}|${rt.date}`);
  }
  rows += await insertChunked(ctx.ds.getRepository(LeaveRecord), leaves as never, CHUNK / 2);

  // --- staff attendance: every school day for every year (~97% present) -----------------
  const staff = await q<{ id: string; tenant_id: string }>(
    `SELECT sp.id, sp.tenant_id FROM staff_profiles sp
        WHERE sp.tenant_id = ANY($1) AND EXISTS (
          SELECT 1 FROM user_tenants ut WHERE ut.user_id = sp.user_id
             AND ut.tenant_id = sp.tenant_id AND ut.deleted_at IS NULL)`,
    [tenantIds],
  );
  const staffSessions: Record<string, unknown>[] = [];
  const staffRecords: Record<string, unknown>[] = [];
  const staffSessionRepo = ctx.ds.getRepository(StaffAttendanceSession);
  const staffRecordRepo = ctx.ds.getRepository(StaffAttendanceRecord);
  const flushStaff = async () => {
    rows += await insertChunked(staffSessionRepo, staffSessions.splice(0) as never, CHUNK);
    rows += await insertChunked(staffRecordRepo, staffRecords.splice(0) as never, CHUNK);
  };
  for (const t of org.tenants) {
    const mine = staff.filter((s) => s.tenant_id === t.id);
    const days = schoolDays(t.years[0].start, ctx.anchor, [5], tenantOff.get(t.id) ?? []);
    for (const date of days) {
      const id = randomUUID();
      staffSessions.push({ id, tenant_id: t.id, date });
      for (const s of mine) {
        if ((joined.get(s.id) ?? '') > date) continue;
        const r = rnd();
        staffRecords.push({
          tenant_id: t.id,
          session_id: id,
          staff_profile_id: s.id,
          status: leaveDays.has(`${s.id}|${date}`)
            ? AttendanceStatus.LEAVE
            : r < 0.97
              ? r < 0.02
                ? AttendanceStatus.LATE
                : AttendanceStatus.PRESENT
              : AttendanceStatus.ABSENT,
        });
      }
      if (staffRecords.length >= CHUNK) await flushStaff();
    }
  }
  await flushStaff();

  // --- [84.2.5] arrival-notice subscriptions (D43): 15 rows over the 3 branches ------------
  const cardTeacher = staffByCardKey(ctx).get('class-teacher-8a')!;
  const homeroom8a = (
    await q<{ section_id: string }>(
      `SELECT tcs.section_id FROM teacher_class_sections tcs JOIN teachers t ON t.id = tcs.teacher_id
        WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'CLASS_TEACHER' AND t.user_id = $2`,
      [cardTeacher.tenantId, cardTeacher.userId],
    )
  ).map((r) => r.section_id);
  const principalOf = new Map(
    (
      await q<{ tenant_id: string; user_id: string }>(
        `SELECT DISTINCT ON (tenant_id) tenant_id, user_id FROM user_tenants
          WHERE tenant_id = ANY($1) AND role = 'EXECUTIVE' AND deleted_at IS NULL
          ORDER BY tenant_id, user_id`,
        [tenantIds],
      )
    ).map((r) => [r.tenant_id, r.user_id]),
  );
  const byStudent = new Map(st.students.map((s) => [s.id, s]));
  const used = new Set<string>();
  /** A student of a current-year section with a guardian, never twice: from the card teacher's
   * homeroom when `homeroom`, else from any other section (the homeroom stays free for the
   * REQUESTED rows). Null when none is left, as at a small scale. */
  const pickChild = (tenantId: string, homeroom: boolean) => {
    const t = org.tenants.find((x) => x.id === tenantId)!;
    const pool = t.years
      .filter((y) => y.isCurrent)
      .flatMap((y) => y.classes.flatMap((c) => c.sections.map((s) => s.id)))
      .filter((id) => homeroom8a.includes(id) === homeroom)
      .flatMap((sectionId) =>
        (st.bySection.get(sectionId) ?? [])
          .filter((id) => !used.has(id) && byStudent.get(id)?.guardianIds.length)
          .map((studentId) => ({ studentId, sectionId })),
      );
    // A fixed stride, not `ctx.pick`: drawing from the shared `ctx.rng` here would shift every
    // later slice's random stream (the fees slice's paid-share check dropped below 50%).
    if (!pool.length) return null;
    const c = pool[(used.size * 37) % pool.length];
    used.add(c.studentId);
    return { ...c, guardianId: byStudent.get(c.studentId)!.guardianIds[0] };
  };
  const [b0, b1, b2] = org.tenants; // b0 is the only `smsAllowed` branch (org slice), so it holds the 5 SMS rows
  const A = ArrivalNoticeStatus;
  const M = ArrivalNoticeMode;
  const L = ArrivalNoticeLock;
  // [status, mode, lock, consumed, branch]
  const plan: [ArrivalNoticeStatus, ArrivalNoticeMode, ArrivalNoticeLock, boolean, string][] = [
    [A.ACTIVE, M.RECURRING, L.NONE, false, b0.id],
    [A.ACTIVE, M.RECURRING, L.NONE, false, b1.id],
    [A.ACTIVE, M.RECURRING, L.NONE, false, b2.id],
    [A.ACTIVE, M.RECURRING, L.NONE, false, b0.id],
    [A.ACTIVE, M.RECURRING, L.NONE, false, b1.id],
    [A.ACTIVE, M.RECURRING, L.NONE, false, b2.id],
    [A.ACTIVE, M.ONCE, L.NONE, false, b0.id],
    [A.ACTIVE, M.ONCE, L.NONE, false, b1.id],
    [A.OFF, M.ONCE, L.NONE, true, b2.id],
    [A.OFF, M.ONCE, L.NONE, true, b0.id],
    [A.REQUESTED, M.RECURRING, L.NONE, false, high.id],
    [A.REQUESTED, M.RECURRING, L.NONE, false, high.id],
    [A.ACTIVE, M.RECURRING, L.ALWAYS, false, b0.id],
    [A.OFF, M.RECURRING, L.NEVER, false, b1.id],
    [A.OFF, M.RECURRING, L.NONE, false, b2.id],
  ];
  const subs = plan.flatMap(([status, mode, lock, consumed, tenantId], i) => {
    // The two REQUESTED rows sit in the card teacher's own section, so its badge reads 2.
    const requested = status === A.REQUESTED;
    const c = pickChild(tenantId, requested);
    if (!c) return [];
    return {
      tenant_id: tenantId,
      student_id: c.studentId,
      guardian_id: c.guardianId,
      status,
      mode,
      channel: tenantId === b0.id ? ArrivalNoticeChannel.SMS : ArrivalNoticeChannel.PUSH,
      lock,
      // A guardian's own request has no staff setter yet.
      set_by_user_id: requested ? null : (classTeacher.get(c.sectionId) ?? org.adminUserId),
      locked_by_user_id: lock === L.NONE ? null : (principalOf.get(tenantId) ?? org.adminUserId),
      consumed_at: consumed ? todayAt(addDays(ctx.anchor, -(1 + (i % 3))), 8, 20 + i) : null,
      // A staff OFF on a free row is a decline; a lock or a spent ONCE is not (CHECK: declined => OFF).
      declined_at:
        status === A.OFF && lock === L.NONE && !consumed
          ? todayAt(addDays(ctx.anchor, -(1 + (i % 3))), 9, 10 + i)
          : null,
      set_at: requested ? null : todayAt(addDays(ctx.anchor, -(1 + (i % 3))), 9, 10 + i),
      locked_at: lock === L.NONE ? null : todayAt(addDays(ctx.anchor, -(1 + (i % 3))), 9, 30 + i),
    };
  });
  if (subs.length)
    rows += await unnestInsert(ctx.ds, 'arrival_notice_subscriptions', Object.keys(subs[0]), subs);
  return rows;
};

export const slice: DemoSlice = {
  name: 'attendance',
  covers: [
    AttendanceSession,
    AttendanceRecord,
    AttendanceDevice,
    AttendanceDeviceEvent,
    StaffAttendanceSession,
    StaffAttendanceRecord,
    LeavePolicy,
    LeaveRecord,
    ArrivalNoticeSubscription,
    AttendanceImport,
  ],
  run: (ctx: DemoSeedContext) =>
    withoutIndexes(ctx.ds, ['attendance_sessions', 'attendance_records'], () => load(ctx)),
};
