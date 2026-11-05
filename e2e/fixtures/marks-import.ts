import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';

import { createClassSection, post, type ApiSession } from '../api';
import type { UploadFile } from '../pages/staff-import-page';

/** [81.3.5] One exam, one section, one subject, one manual 100-mark component, `n` students. */
export interface MarksImportScene {
  examId: string;
  examName: string;
  sectionId: string;
  subjectId: string;
  students: { id: string; full_name: string }[];
  gridPath: string;
}

export async function marksImportScene(
  request: APIRequestContext,
  session: ApiSession,
  studentCount = 6,
): Promise<MarksImportScene> {
  const chain = await createClassSection(request, session);
  // Random part: parallel workers can start in the same millisecond.
  const suffix =
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `MI-${suffix}`,
    name_en: 'E2E Import Subject',
    name_bn: 'ই২ই ইমপোর্ট বিষয়',
  });
  const examName = `E2E Marks Import ${suffix}`;
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: examName,
    kind: ExamKind.TERM,
    academic_year_id: chain.academicYearId,
    class_id: chain.classId,
  });
  await post(request, session, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });
  const students: MarksImportScene['students'] = [];
  for (let i = 1; i <= studentCount; i += 1) {
    students.push(
      await post<{ id: string; full_name: string }>(request, session, '/students', {
        full_name: `Marks Import Student ${i}`,
        class_section_id: chain.sectionId,
      }),
    );
  }
  return {
    examId: exam.id,
    examName,
    sectionId: chain.sectionId,
    subjectId: subject.id,
    students,
    gridPath: `/marks/${exam.id}/${chain.sectionId}/${subject.id}`,
  };
}

/**
 * Downloads the real sheet through the API and writes `marks` (a number, or 'A' for absent)
 * into the Written column of each named student's row. Stands in for the teacher's Excel step.
 */
export async function filledMarksSheet(
  request: APIRequestContext,
  session: ApiSession,
  scene: MarksImportScene,
  marks: Record<string, number | string>,
): Promise<UploadFile> {
  const res = await request.get(
    `/api/v1/exams/${scene.examId}/marks/sheet?section_id=${scene.sectionId}&subject_id=${scene.subjectId}`,
    { headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId } },
  );
  if (!res.ok()) throw new Error(`GET sheet failed: ${res.status()} ${await res.text()}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as never);
  const ws = wb.worksheets[0];
  let col = 0;
  ws.getRow(1).eachCell((cell, c) => {
    if (String(cell.value).startsWith('Written /')) col = c;
  });
  if (!col) throw new Error('Written column not found in the sheet');
  ws.eachRow((row, r) => {
    const value = marks[String(row.getCell(2).value)];
    if (r > 1 && value !== undefined) ws.getCell(r, col).value = value;
  });
  return {
    name: 'marks.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  };
}
