import { DailyRegisterWriteReason } from '@biddaloy/shared';
import { describe, expect, it, vi } from 'vitest';
import { AttendanceSummaryController } from './attendance-summary.controller';
import type { AttendanceAccessService } from './attendance-access.service';
import type { AttendanceSummaryService } from './attendance-summary.service';
import type { FamilyAccessService } from '../students/family-access.service';

describe('AttendanceSummaryController.getSectionRegisterMatrix', () => {
  it('adds the save gate to the matrix, asked as the month grid', async () => {
    const matrix = { dates: [], versions: {}, rows: [] };
    const summary = { getSectionRegisterMatrix: vi.fn().mockResolvedValue(matrix) };
    const dayRegisterWriteState = vi.fn().mockResolvedValue({
      can_write: false,
      write_reason: DailyRegisterWriteReason.CLASS_TEACHER_ONLY,
      first_period_today: false,
    });
    const access = { assertCanAccessSection: vi.fn(), dayRegisterWriteState };
    const controller = new AttendanceSummaryController(
      summary as unknown as AttendanceSummaryService,
      access as unknown as AttendanceAccessService,
      {} as FamilyAccessService,
    );

    const result = await controller.getSectionRegisterMatrix(
      'section-1',
      { month: '2026-01' },
      { id: 'tenant-1', role: 'TEACHER' },
      { sub: 'user-1' },
    );

    // The read must match PUT register-matrix: without monthGrid a first-period teacher
    // would be offered Edit and then refused (D31).
    expect(dayRegisterWriteState).toHaveBeenCalledWith(
      'TEACHER',
      'user-1',
      'section-1',
      '2026-01-01',
      'tenant-1',
      { monthGrid: true },
    );
    expect(result).toEqual({
      ...matrix,
      can_write: false,
      write_reason: DailyRegisterWriteReason.CLASS_TEACHER_ONLY,
    });
  });
});
