import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  AttendanceImportHistoryRow,
  AttendanceImportRowCode,
  AttendanceImportRowOutcome,
  AttendanceStatus,
  EnrollmentStatus,
  Permission,
  roleHasPermission,
  UserRole,
} from '@biddaloy/shared';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { AttendanceImport } from '../entities/attendance-import.entity';
import { AttendanceAccessService } from '../attendance-access.service';
import { AttendanceService } from '../attendance.service';
import { resolveAttendancePolicy, daysBetween } from '../attendance-policy.util';
import { SchoolsService } from '../../schools/schools.service';
import { SchoolCalendarService } from '../../calendar/school-calendar.service';
import { ImportStagingService } from '../../bulk-import/import-staging.service';
import { sectionRosterStudentIds } from '../../enrollments/section-roster';
import { assertDemoRowLimit } from '../../demo/demo-row-limit';
import { localToday } from '../../../common/time';
import { AttendanceSessionState } from '@biddaloy/shared';
import { parseAttendanceSheet, ParsedSheetRow } from './attendance-sheet.parser';
import { buildAttendanceSheet, TemplateRow } from './attendance-sheet.builder';
import {
  AttendanceImportDetailDto,
  AttendanceImportListDto,
  AttendanceImportSummaryDto,
  CommitAttendanceImportResultDto,
  ImportCountsDto,
  ImportPreviewRowDto,
  ValidateAttendanceImportResultDto,
} from './dto/attendance-import.dto';

/** Who is calling; never client-supplied. */
export interface ImportCaller {
  tenantId: string;
  userId: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** What `validate` stages for `commit`: only the groups with something to write. */
interface StagedImport {
  fileName: string;
  groups: {
    date: string;
    sectionId: string;
    entries: { student_id: string; status: AttendanceStatus }[];
  }[];
  /** Every row, errors included, exactly as it goes into `attendance_imports.rows`. */
  history: AttendanceImportHistoryRow[];
  /** Per history row: the student it is about (for the record id), or null. */
  studentIds: (string | null)[];
}

const SIGNATURE_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DENIED_TEMPLATE = 'You cannot download a sheet for one of these sections';
const AUDIT_ZERO = 0;

function normName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function counts(rows: { outcome: AttendanceImportRowOutcome }[]): ImportCountsDto {
  const c = { new: 0, changed: 0, unchanged: 0, error: 0 };
  for (const r of rows) {
    if (r.outcome === 'NEW') c.new++;
    else if (r.outcome === 'CHANGED') c.changed++;
    else if (r.outcome === 'UNCHANGED') c.unchanged++;
    else c.error++;
  }
  return c;
}

@Injectable()
export class AttendanceImportService {
  private readonly logger = new Logger(AttendanceImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AttendanceImport) private readonly importRepo: Repository<AttendanceImport>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Class) private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear) private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(Student) private readonly studentRepo: Repository<Student>,
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(AttendanceRecord) private readonly recordRepo: Repository<AttendanceRecord>,
    private readonly access: AttendanceAccessService,
    private readonly attendance: AttendanceService,
    private readonly schools: SchoolsService,
    private readonly calendar: SchoolCalendarService,
    private readonly staging: ImportStagingService,
  ) {}

  // ---------------------------------------------------------------------
  // GET attendance/import/template
  // ---------------------------------------------------------------------

  async template(
    sectionIds: string[],
    date: string,
    caller: ImportCaller,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const { tenantId, userId, role } = caller;
    const unique = [...new Set(sectionIds)];
    const sections = await this.sectionRepo.find({
      where: { id: In(unique), tenant_id: tenantId, deleted_at: IsNull() },
      relations: { class: true },
    });
    // One fixed answer for a missing section and a section the caller may not write
    // (Rule 23): a probe learns nothing.
    if (sections.length !== unique.length) throw new ForbiddenException(DENIED_TEMPLATE);
    for (const s of sections) {
      const state = await this.access.dayRegisterWriteState(role, userId, s.id, date, tenantId);
      if (!state.can_write) throw new ForbiddenException(DENIED_TEMPLATE);
    }

    const settings = await this.schools.getResolvedSettings(tenantId);
    const lang = settings.region?.locale?.toLowerCase().startsWith('en') ? 'en' : 'bn';
    const rows: TemplateRow[] = [];
    // Keep the caller's section order.
    for (const id of unique) {
      const section = sections.find((s) => s.id === id)!;
      const students = await this.studentRepo.find({
        where: {
          tenant_id: tenantId,
          class_section_id: id,
          enrollment_status: EnrollmentStatus.ACTIVE,
          deleted_at: IsNull(),
        },
        order: { roll_number: 'ASC' },
      });
      for (const st of students) {
        rows.push({
          date,
          className: section.class.name,
          sectionName: section.section_name,
          roll: st.roll_number,
          name: st.full_name,
        });
      }
    }
    const buffer = await buildAttendanceSheet(rows, lang);
    const prefix = lang === 'bn' ? 'হাজিরা' : 'attendance';
    const fileName =
      sections.length === 1
        ? `${prefix}_${sections[0].class.name}_${sections[0].section_name}_${date}.xlsx`
        : `${prefix}_${date}.xlsx`;
    return { buffer, fileName };
  }

  // ---------------------------------------------------------------------
  // POST attendance/import/validate
  // ---------------------------------------------------------------------

  async validate(
    file: Express.Multer.File | undefined,
    caller: ImportCaller,
  ): Promise<ValidateAttendanceImportResultDto> {
    if (!file) throw new BadRequestException('No file uploaded');
    // Rule 6: the bytes decide, not the name. An .xlsx is a zip (PK..); the zip-bomb guard
    // then runs inside the parser. ponytail: file-signature.ts has no xlsx case; csv has no
    // signature, its only gate is the parser.
    const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx');
    if (isXlsx && !file.buffer.subarray(0, 4).equals(SIGNATURE_ZIP)) {
      throw new BadRequestException('The file content does not match its type');
    }
    const parsed = await parseAttendanceSheet(file.buffer, file.originalname);
    assertDemoRowLimit(parsed.length);

    const { rows, staged } = await this.resolveRows(parsed, caller, file.originalname);
    const c = counts(rows);
    const writable = c.new + c.changed;
    let stagingId: string | null = null;
    // Epic 81 D15: nothing to save, nothing staged.
    if (writable > 0) {
      stagingId = (await this.staging.stage(caller.tenantId, caller.userId, staged)).stagingId;
    }
    return {
      staging_id: stagingId,
      rows: rows.map((r) => r.preview),
      counts: c,
      overwrite_count: c.changed,
    };
  }

  /** One pass over the parsed rows: resolve, apply the D6/D34/D7 rules, diff against the register. */
  private async resolveRows(
    parsed: ParsedSheetRow[],
    caller: ImportCaller,
    fileName: string,
  ): Promise<{
    rows: { outcome: AttendanceImportRowOutcome; preview: ImportPreviewRowDto }[];
    staged: StagedImport;
  }> {
    const { tenantId, userId, role } = caller;
    const settings = await this.schools.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);

    const year = await this.yearRepo.findOne({
      where: { tenant_id: tenantId, is_current: true, deleted_at: IsNull() },
    });
    if (!year) throw new BadRequestException('No current academic year configured');
    const yearStart = String(year.start_date).slice(0, 10);
    const yearEnd = String(year.end_date).slice(0, 10);

    const classes = await this.classRepo.find({
      where: { tenant_id: tenantId, academic_year_id: year.id, deleted_at: IsNull() },
    });
    const sections = classes.length
      ? await this.sectionRepo.find({
          where: {
            tenant_id: tenantId,
            class_id: In(classes.map((c) => c.id)),
            deleted_at: IsNull(),
          },
        })
      : [];
    const classById = new Map(classes.map((c) => [c.id, c]));
    // class + section name -> section; a name two sections share is ambiguous = not found.
    const sectionByKey = new Map<string, ClassSection | null>();
    for (const s of sections) {
      const cls = classById.get(s.class_id);
      if (!cls) continue;
      const key = `${normName(cls.name)}::${normName(s.section_name)}`;
      sectionByKey.set(key, sectionByKey.has(key) ? null : s);
    }

    // Caches: one question per distinct (section, date) / (class, date).
    const writeOk = new Map<string, boolean>();
    const nonWorking = new Map<string, boolean>();
    const rosterByGroup = new Map<string, Map<number, Student[]>>();
    const sessionByGroup = new Map<
      string,
      { finalized: boolean; byStudent: Map<string, AttendanceStatus> }
    >();

    const out: { outcome: AttendanceImportRowOutcome; preview: ImportPreviewRowDto }[] = [];
    const history: AttendanceImportHistoryRow[] = [];
    const studentIds: (string | null)[] = [];
    const groups = new Map<string, StagedImport['groups'][number]>();

    for (const p of parsed) {
      const section =
        sectionByKey.get(`${normName(p.className)}::${normName(p.sectionName)}`) ?? null;
      const cls = section ? classById.get(section.class_id)! : null;
      let student: Student | null = null;
      let before: AttendanceStatus | null = null;
      let code: AttendanceImportRowCode | undefined;

      if (p.badStatus) code = 'BAD_STATUS';
      else if (p.duplicate) code = 'DUPLICATE_ROW';
      else if (!section) code = 'SECTION_NOT_FOUND';
      else if (p.date === null || p.date < yearStart || p.date > yearEnd) {
        code = 'DATE_OUTSIDE_YEAR';
      } else {
        const date = p.date;
        const gKey = `${section.id}|${date}`;
        if (!writeOk.has(gKey)) {
          const st = await this.access.dayRegisterWriteState(
            role,
            userId,
            section.id,
            date,
            tenantId,
          );
          writeOk.set(gKey, st.can_write);
        }
        const cKey = `${section.class_id}|${date}`;
        if (!nonWorking.has(cKey)) {
          nonWorking.set(
            cKey,
            await this.calendar.isNonWorkingDay({ tenantId, date, classId: section.class_id }),
          );
        }
        if (!writeOk.get(gKey)) code = 'NOT_ALLOWED_SECTION';
        else if (nonWorking.get(cKey)) code = 'NON_WORKING_DAY';
        else if (
          date > today &&
          (!policy.allowFutureDates || (p.status && p.status !== AttendanceStatus.LEAVE))
        ) {
          code = 'FUTURE_DATE';
        } else {
          if (!rosterByGroup.has(gKey)) {
            const ids = await sectionRosterStudentIds(
              this.dataSource.manager,
              tenantId,
              section.id,
              {
                onRollOn: date,
              },
            );
            const students = ids.length
              ? await this.studentRepo.find({ where: { tenant_id: tenantId, id: In(ids) } })
              : [];
            const byRoll = new Map<number, Student[]>();
            for (const s of students)
              byRoll.set(s.roll_number, [...(byRoll.get(s.roll_number) ?? []), s]);
            rosterByGroup.set(gKey, byRoll);
            const session = await this.sessionRepo.findOne({
              where: { tenant_id: tenantId, section_id: section.id, date, period_no: IsNull() },
            });
            const recs = session
              ? await this.recordRepo.find({
                  where: { tenant_id: tenantId, session_id: session.id },
                })
              : [];
            sessionByGroup.set(gKey, {
              finalized: session?.state === AttendanceSessionState.FINALIZED,
              byStudent: new Map(recs.map((r) => [r.student_id, r.status])),
            });
          }
          const sess = sessionByGroup.get(gKey)!;
          const match = p.roll === null ? [] : (rosterByGroup.get(gKey)!.get(p.roll) ?? []);
          // Two students on one roll cannot be told apart: treat as not found.
          student = match.length === 1 ? match[0] : null;
          if (!student) code = 'ROLL_NOT_IN_SECTION';
          else if (
            !hasCorrect &&
            (daysBetween(date, today) > policy.correctionWindowDays || sess.finalized)
          ) {
            code = 'NEEDS_CORRECT_PERMISSION';
          } else {
            before = sess.byStudent.get(student.id) ?? null;
          }
        }
      }

      let outcome: AttendanceImportRowOutcome;
      let after: AttendanceStatus | null = before;
      if (code) {
        outcome = 'ERROR';
        after = null;
      } else if (p.status === null) {
        outcome = 'UNCHANGED';
      } else {
        after = p.status;
        outcome = before === null ? 'NEW' : before === p.status ? 'UNCHANGED' : 'CHANGED';
        if (outcome !== 'UNCHANGED') {
          const gk = `${section!.id}|${p.date}`;
          const g = groups.get(gk) ?? { date: p.date!, sectionId: section!.id, entries: [] };
          g.entries.push({ student_id: student!.id, status: p.status });
          groups.set(gk, g);
        }
      }
      // A name that does not match is a warning: the row still saves (D6).
      if (!code && student && p.name && normName(p.name) !== normName(student.full_name)) {
        code = 'NAME_MISMATCH';
      }

      history.push({
        date: p.date ?? '',
        sectionId: section?.id ?? '',
        roll: p.roll ?? AUDIT_ZERO,
        before,
        after,
        outcome,
        recordId: null,
        ...(code ? { code } : {}),
      });
      studentIds.push(student?.id ?? null);
      out.push({
        outcome,
        preview: {
          row: p.rowNumber,
          date: p.date,
          section_id: section?.id ?? null,
          class_name: cls?.name ?? null,
          section_name: section?.section_name ?? null,
          roll: p.roll,
          before,
          after,
          outcome,
          ...(code ? { code } : {}),
        },
      });
    }

    return {
      rows: out,
      staged: { fileName, groups: [...groups.values()], history, studentIds },
    };
  }

  // ---------------------------------------------------------------------
  // POST attendance/import/commit
  // ---------------------------------------------------------------------

  async commit(
    stagingId: string,
    supersedesImportId: string | undefined,
    caller: ImportCaller,
  ): Promise<CommitAttendanceImportResultDto> {
    const { tenantId, userId, role } = caller;
    const staged = await this.staging.consume<StagedImport>(tenantId, userId, stagingId);
    if (!staged) {
      throw new NotFoundException(
        'No staged upload found for this id. It may have expired or already been saved.',
      );
    }
    if (supersedesImportId) {
      const prior = await this.importRepo.findOne({
        where: { id: supersedesImportId, tenant_id: tenantId },
      });
      if (!prior) throw new NotFoundException('Upload not found');
    }

    const importId = randomUUID();
    try {
      await this.dataSource.transaction(async (manager) => {
        const recordIds = new Map<string, string>(); // `${sectionId}|${date}|${studentId}`
        for (const g of staged.groups) {
          const reg = await this.attendance.writeImportDay(manager, {
            sectionId: g.sectionId,
            date: g.date,
            tenantId,
            role,
            userId,
            importId,
            ip: caller.ip ?? null,
            userAgent: caller.userAgent ?? null,
            entries: g.entries,
          });
          for (const s of reg.students) {
            if (s.record_id) recordIds.set(`${g.sectionId}|${g.date}|${s.student_id}`, s.record_id);
          }
        }
        const rows = staged.history.map((h, i) => {
          const sid = staged.studentIds[i];
          const recordId = sid ? (recordIds.get(`${h.sectionId}|${h.date}|${sid}`) ?? null) : null;
          return { ...h, recordId };
        });
        const c = counts(rows);
        await manager.getRepository(AttendanceImport).insert({
          id: importId,
          tenant_id: tenantId,
          uploaded_by_user_id: userId,
          file_name: staged.fileName.slice(0, 255),
          rows,
          count_new: c.new,
          count_changed: c.changed,
          count_unchanged: c.unchanged,
          count_error: c.error,
          supersedes_import_id: supersedesImportId ?? null,
        });
      });
    } catch (err) {
      // Rule 23: one fixed sentence; the cause stays in the log.
      this.logger.error(
        `Attendance import commit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ConflictException({
        message: 'The sheet could not be saved. Nothing was changed. Upload it again.',
        details: { code: 'ATTENDANCE_IMPORT_FAILED' },
      });
    }
    return { import_id: importId };
  }

  // ---------------------------------------------------------------------
  // GET attendance/imports, GET attendance/imports/:id
  // ---------------------------------------------------------------------

  private summary(e: AttendanceImport): AttendanceImportSummaryDto {
    return {
      id: e.id,
      uploaded_by_user_id: e.uploaded_by_user_id,
      file_name: e.file_name,
      counts: {
        new: e.count_new,
        changed: e.count_changed,
        unchanged: e.count_unchanged,
        error: e.count_error,
      },
      supersedes_import_id: e.supersedes_import_id,
      created_at: e.created_at.toISOString(),
    };
  }

  /** D11: a teacher sees their own uploads; every other role that reaches here sees all. */
  private scope(caller: ImportCaller) {
    return {
      tenant_id: caller.tenantId,
      ...(caller.role === UserRole.TEACHER ? { uploaded_by_user_id: caller.userId } : {}),
    };
  }

  async list(page: number, limit: number, caller: ImportCaller): Promise<AttendanceImportListDto> {
    const [items, total] = await this.importRepo.findAndCount({
      where: this.scope(caller),
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        uploaded_by_user_id: true,
        file_name: true,
        count_new: true,
        count_changed: true,
        count_unchanged: true,
        count_error: true,
        supersedes_import_id: true,
        created_at: true,
      },
    });
    return { items: items.map((i) => this.summary(i)), total, page, limit };
  }

  async detail(id: string, caller: ImportCaller): Promise<AttendanceImportDetailDto> {
    // Same 404 for "not yours" and "not there".
    const e = await this.importRepo.findOne({ where: { id, ...this.scope(caller) } });
    if (!e) throw new NotFoundException('Upload not found');
    const recordIds = e.rows.map((r) => r.recordId).filter((r): r is string => !!r);
    const recs = recordIds.length
      ? await this.recordRepo.find({
          where: { tenant_id: caller.tenantId, id: In(recordIds) },
          select: { id: true, status: true },
        })
      : [];
    const current = new Map(recs.map((r) => [r.id, r.status]));
    return {
      ...this.summary(e),
      rows: e.rows.map((r) => ({
        date: r.date,
        section_id: r.sectionId,
        roll: r.roll,
        before: r.before,
        after: r.after,
        outcome: r.outcome,
        record_id: r.recordId,
        ...(r.code ? { code: r.code } : {}),
        current: r.recordId ? (current.get(r.recordId) ?? null) : null,
      })),
    };
  }
}
