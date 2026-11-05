import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  ExamStatus,
  ImportFileErrorCode,
  MarkGridState,
  MarkStatus,
  MarksSheetFileErrorCode,
  MarksSheetRowErrorCode,
} from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { School } from '../schools/entities/school.entity';
import { ImportStagingService } from '../bulk-import/import-staging.service';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { ImportFileError } from '../../common/errors/import-file.error';
import { marksGridSubmitted, marksSheetExpired } from '../../common/filters/known-errors';
import { toPaisa } from '../../common/constants/money';
import { RequestContext } from '../../common/request-context.util';
import { GridQueryDto } from './dto/marks.dto';
import {
  CommitMarksSheetDto,
  MarksSheetChangeDto,
  MarksSheetCommitResultDto,
  MarksSheetErrorDto,
  MarksSheetValidateResultDto,
} from './dto/marks-sheet.dto';
import { GridResponse, MarkGridService } from './mark-grid.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { MarksService } from './marks.service';
import { buildMarksSheet } from './marks-sheet.builder';
import { MarksSheetFileError, ParsedMarksSheet, parseMarksSheet } from './marks-sheet.parser';

/** Multer's cap and the service's own check (the csv path has no other byte bound). */
export const MARKS_SHEET_MAX_BYTES = 5 * 1024 * 1024;

interface StagedCell {
  student_id: string;
  component_id: string;
  value: string | null;
  status: MarkStatus;
}

/** What `validate` stages for `commit` to consume once. */
interface StagedMarksSheet {
  examId: string;
  sectionId: string;
  subjectId: string;
  cells: StagedCell[];
}

const fmt = (v: string) => (toPaisa(v) / 100).toFixed(2);

@Injectable()
export class MarksImportService {
  constructor(
    @InjectRepository(Exam) private readonly examRepo: Repository<Exam>,
    @InjectRepository(ClassSection) private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Subject) private readonly subjectRepo: Repository<Subject>,
    private readonly gridService: MarkGridService,
    private readonly marksService: MarksService,
    private readonly authz: MarksAuthorizationService,
    @Inject(ImportStagingService) private readonly staging: ImportStagingService,
  ) {}

  /** The pre-filled sheet. `getGrid` is the read gate (404 outside tenant or teacher scope). */
  async buildSheet(
    examId: string,
    q: GridQueryDto,
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const grid = await this.gridService.getGrid(
      examId,
      q.section_id,
      q.subject_id,
      tenantId,
      role,
      userId,
    );
    const [exam, section, subject, school] = await Promise.all([
      this.examRepo.findOne({ where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() } }),
      this.sectionRepo.findOne({
        where: { id: q.section_id, tenant_id: tenantId, deleted_at: IsNull() },
        relations: { class: true },
      }),
      this.subjectRepo.findOne({
        where: { id: q.subject_id, tenant_id: tenantId, deleted_at: IsNull() },
      }),
      this.examRepo.manager.findOne(School, {
        where: { id: tenantId },
        select: { id: true, settings: true },
      }),
    ]);
    if (!exam || !section || !subject) throw new NotFoundException('Marks grid not found');
    const lang = resolveTemplateLocale(school?.settings?.region?.locale);
    return buildMarksSheet(grid, {
      examName: exam.name,
      // Class + section: "A" alone is ambiguous across classes.
      sectionName: `${section.class.name}-${section.section_name}`,
      subjectName: lang === 'bn' ? (subject.name_bn ?? subject.name_en) : subject.name_en,
      lang,
    });
  }

  private async loadWritableGrid(
    examId: string,
    q: GridQueryDto,
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<GridResponse> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    await this.authz.assertCanWrite({
      role,
      userId,
      tenantId,
      sectionId: q.section_id,
      subjectId: q.subject_id,
    });
    if (exam.status === ExamStatus.PUBLISHED) {
      throw new ConflictException(
        'This exam is already published — its marks can no longer be edited.',
      );
    }
    const grid = await this.gridService.getGrid(
      examId,
      q.section_id,
      q.subject_id,
      tenantId,
      role,
      userId,
    );
    if (grid.state === MarkGridState.SUBMITTED) throw marksGridSubmitted();
    return grid;
  }

  /** The seam a later source (Epic 93) feeds with an already-parsed sheet. */
  async validate(
    examId: string,
    q: GridQueryDto,
    parsed: ParsedMarksSheet,
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<MarksSheetValidateResultDto> {
    const grid = await this.loadWritableGrid(examId, q, tenantId, role, userId);
    return this.classifyAndStage(grid, parsed, tenantId, userId);
  }

  async validateFile(
    examId: string,
    q: GridQueryDto,
    file: Express.Multer.File | undefined,
    tenantId: string,
    role: string,
    userId: string,
  ): Promise<MarksSheetValidateResultDto> {
    // Gates run before any parsing.
    const grid = await this.loadWritableGrid(examId, q, tenantId, role, userId);
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > MARKS_SHEET_MAX_BYTES || file.buffer.length > MARKS_SHEET_MAX_BYTES) {
      throw new ImportFileError(ImportFileErrorCode.TOO_LARGE, 'File is too large (max 5 MB)');
    }
    const parsed = await parseMarksSheet(file.buffer, file.originalname);
    return this.classifyAndStage(grid, parsed, tenantId, userId);
  }

  private async classifyAndStage(
    grid: GridResponse,
    parsed: ParsedMarksSheet,
    tenantId: string,
    userId: string,
  ): Promise<MarksSheetValidateResultDto> {
    if (parsed.components.length === 0) {
      throw new MarksSheetFileError(
        MarksSheetFileErrorCode.WRONG_SHEET,
        'This is not a marks sheet — download the sheet from the marks page and fill that one',
      );
    }
    if (parsed.sheetId !== `${grid.exam_id}:${grid.section_id}:${grid.subject_id}`) {
      throw new MarksSheetFileError(
        MarksSheetFileErrorCode.WRONG_SHEET,
        'This sheet belongs to another exam, section or subject — download the sheet from this marks page',
      );
    }

    const errors: MarksSheetErrorDto[] = [];
    const changes: MarksSheetChangeDto[] = [];
    const cells: StagedCell[] = [];
    const summary = {
      rows: parsed.rows.length,
      new: 0,
      changed: 0,
      unchanged: 0,
      absent: 0,
      exempt: 0,
      errors: 0,
    };

    // Columns: only MANUAL components that exist in the grid are used.
    const used: Array<{ sheetName: string; comp: GridResponse['components'][number] }> = [];
    for (const col of parsed.components) {
      const comp = grid.components.find((c) => c.name === col.name);
      if (!comp) {
        errors.push({
          row: 1,
          roll: null,
          component_name: null,
          code: MarksSheetRowErrorCode.UNKNOWN_COMPONENT,
        });
      } else if (comp.source === 'DERIVED') {
        errors.push({
          row: 1,
          roll: null,
          component_name: comp.name,
          code: MarksSheetRowErrorCode.DERIVED_COMPONENT,
        });
      } else {
        used.push({ sheetName: col.name, comp });
      }
    }

    // Every row of a repeated key errors, the first occurrence too.
    const dupKeys = new Set(
      parsed.rows
        .filter((r) => r.error === MarksSheetRowErrorCode.DUPLICATE_ROW)
        .map((r) => r.studentKey),
    );
    const studentById = new Map(grid.students.map((s) => [s.id, s]));
    const cellByKey = new Map(grid.cells.map((c) => [`${c.student_id}|${c.component_id}`, c]));

    for (const row of parsed.rows) {
      const student = studentById.get(row.studentKey);
      if (dupKeys.has(row.studentKey)) {
        errors.push({
          row: row.rowNumber,
          roll: student?.roll_number ?? null,
          component_name: null,
          code: MarksSheetRowErrorCode.DUPLICATE_ROW,
        });
        continue;
      }
      if (!student) {
        errors.push({
          row: row.rowNumber,
          roll: null,
          component_name: null,
          code: MarksSheetRowErrorCode.NOT_IN_SECTION,
        });
        continue;
      }
      for (const { sheetName, comp } of used) {
        const entry = row.entries[sheetName];
        if (!entry || entry.kind === 'blank') continue; // D3: blank = unchanged
        const cellError = (code: MarksSheetRowErrorCode) =>
          errors.push({
            row: row.rowNumber,
            roll: student.roll_number,
            component_name: comp.name,
            code,
          });
        if (entry.kind === 'invalid') {
          cellError(MarksSheetRowErrorCode.INVALID_VALUE);
          continue;
        }
        let target: { status: MarkStatus; value: string | null };
        if (entry.kind === 'value') {
          if (toPaisa(entry.value) > toPaisa(comp.full_marks)) {
            cellError(MarksSheetRowErrorCode.ABOVE_FULL_MARKS);
            continue;
          }
          target = { status: MarkStatus.PRESENT, value: fmt(entry.value) };
        } else {
          target = {
            status: entry.kind === 'absent' ? MarkStatus.ABSENT : MarkStatus.EXEMPT,
            value: null,
          };
        }
        const current = cellByKey.get(`${student.id}|${comp.id}`);
        const sameValue =
          current &&
          (current.value === null || target.value === null
            ? current.value === target.value
            : toPaisa(current.value) === toPaisa(target.value));
        if (current && current.status === target.status && sameValue) {
          summary.unchanged++;
          continue;
        }
        const isNew = !current || (current.status === MarkStatus.PRESENT && current.value === null);
        if (isNew) summary.new++;
        else summary.changed++;
        if (target.status === MarkStatus.ABSENT) summary.absent++;
        if (target.status === MarkStatus.EXEMPT) summary.exempt++;
        changes.push({
          row: row.rowNumber,
          student_id: student.id,
          roll: student.roll_number,
          student_name: student.full_name,
          component_id: comp.id,
          component_name: comp.name,
          old: current?.value ?? null,
          old_status: (current?.status as MarkStatus | undefined) ?? null,
          new: target.value,
          new_status: target.status,
        });
        cells.push({ student_id: student.id, component_id: comp.id, ...target });
      }
    }
    summary.errors = errors.length;

    if (cells.length === 0) {
      return { staging_id: null, expires_at: null, summary, changes, errors };
    }
    const { stagingId, expiresAt } = await this.staging.stage<StagedMarksSheet>(tenantId, userId, {
      examId: grid.exam_id,
      sectionId: grid.section_id,
      subjectId: grid.subject_id,
      cells,
    });
    return { staging_id: stagingId, expires_at: expiresAt, summary, changes, errors };
  }

  async commit(
    examId: string,
    dto: CommitMarksSheetDto,
    tenantId: string,
    role: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<MarksSheetCommitResultDto> {
    const staged = await this.staging.consume<StagedMarksSheet>(tenantId, userId, dto.staging_id);
    if (
      !staged ||
      staged.examId !== examId ||
      staged.sectionId !== dto.section_id ||
      staged.subjectId !== dto.subject_id
    ) {
      throw marksSheetExpired();
    }
    // ponytail: stage is consumed before the write; if upsertBatch then 409s (grid submitted /
    // results processed meanwhile) the user re-uploads. Peek-then-consume would reopen the
    // double-commit race.
    const { cells } = await this.marksService.upsertBatch(
      examId,
      { section_id: staged.sectionId, subject_id: staged.subjectId, cells: staged.cells },
      tenantId,
      role,
      userId,
      ctx,
      'SHEET',
    );
    return { saved: cells.length };
  }
}
