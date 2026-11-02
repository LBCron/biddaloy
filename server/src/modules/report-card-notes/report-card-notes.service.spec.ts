import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportCardNotesService } from './report-card-notes.service';

/**
 * [70.3.1] Unit checks that need no database: the teacher scope gate (Rule 2) and the body
 * validation, which must fail before any query runs (so a bad save never opens a transaction).
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const SECTION = '00000000-0000-4000-8000-000000000003';
const STUDENT = '00000000-0000-4000-8000-000000000004';
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

function build(homeroom: 'CLASS_TEACHER' | null) {
  const transaction = vi.fn();
  const repo = { manager: { transaction } };
  const teacherScope = { rolesInSection: vi.fn().mockResolvedValue({ homeroom }) };
  const schools = { getResolvedSettings: vi.fn().mockResolvedValue({}) };
  const service = new ReportCardNotesService(
    repo as never,
    { record: vi.fn() } as never,
    teacherScope as never,
    schools as never,
  );
  return { service, transaction, teacherScope };
}

describe('ReportCardNotesService (unit)', () => {
  describe('assertHomeroom', () => {
    it('lets the section class teacher through', async () => {
      const { service, teacherScope } = build('CLASS_TEACHER');
      await expect(service.assertHomeroom(TENANT, USER, SECTION)).resolves.toBeUndefined();
      expect(teacherScope.rolesInSection).toHaveBeenCalledWith({
        userId: USER,
        tenantId: TENANT,
        sectionId: SECTION,
      });
    });

    it('404, never 403, for anyone who is not class teacher or assistant there', async () => {
      const { service } = build(null);
      await expect(service.assertHomeroom(TENANT, USER, SECTION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('save validation', () => {
    const save = (service: ReportCardNotesService, notes: any[]) =>
      service.save(TENANT, USER, { exam_id: SECTION }, SECTION, notes, CTX);

    it('refuses a conduct key the school does not have, without opening a transaction', async () => {
      const { service, transaction } = build('CLASS_TEACHER');
      await expect(
        save(service, [{ student_id: STUDENT, conduct: { nope: 'A' } }]),
      ).rejects.toThrow('Unknown conduct item.');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('refuses a grade outside A to D, and the message never echoes it', async () => {
      const { service } = build('CLASS_TEACHER');
      const error = await save(service, [
        { student_id: STUDENT, conduct: { discipline: 'ZZZ-secret' } },
      ]).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(error.getResponse())).not.toContain('ZZZ-secret');
    });

    it('refuses the same student twice', async () => {
      const { service, transaction } = build('CLASS_TEACHER');
      await expect(
        save(service, [
          { student_id: STUDENT, conduct: {} },
          { student_id: STUDENT, conduct: {} },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    });
  });
});
