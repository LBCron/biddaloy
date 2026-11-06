import { describe, it, expect } from 'vitest';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import {
  DEFAULT_ATTENTION_SETTINGS,
  DEFAULT_DOCUMENTS_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_STUDY_PLANS_SETTINGS,
  DEFAULT_TENANT_SETTINGS,
} from './tenant-settings-defaults';

describe('DEFAULT_ORGANISATION_SETTINGS', () => {
  it('defaults every list to empty — a school opts in, nothing is invented', () => {
    expect(DEFAULT_ORGANISATION_SETTINGS).toEqual({
      shifts: [],
      versions: [],
      groups: [],
    });
  });
});

describe('DEFAULT_ROUTINE_SETTINGS', () => {
  it('defaults to a 5-minute changeover with no caps set', () => {
    expect(DEFAULT_ROUTINE_SETTINGS).toEqual({
      defaultChangeoverMinutes: 5,
    });
  });
});

describe('DEFAULT_DOCUMENTS_SETTINGS', () => {
  it('never withholds the admit card by default, and is part of DEFAULT_TENANT_SETTINGS (48.1.03)', () => {
    expect(DEFAULT_DOCUMENTS_SETTINGS).toEqual({ withholdAdmitCardForDues: false });
    expect(DEFAULT_TENANT_SETTINGS.documents).toBe(DEFAULT_DOCUMENTS_SETTINGS);
  });
});

describe('DEFAULT_STUDY_PLANS_SETTINGS', () => {
  it('matches D25/D26', () => {
    expect(DEFAULT_STUDY_PLANS_SETTINGS).toEqual({
      statusDeadline: '18:00',
      reminderTime: '08:00',
      escalateAfterSchoolDays: 2,
      weeklyDigestTime: '17:00',
      guardianDigestSms: false,
    });
    expect(DEFAULT_TENANT_SETTINGS.studyPlans).toBe(DEFAULT_STUDY_PLANS_SETTINGS);
  });

  it('dashboard defaults match D7/D23/D31 (8.10.7)', () => {
    expect(DEFAULT_TENANT_SETTINGS.dashboard).toEqual({
      risk: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
      committeeAttendanceTargetPct: 90,
      digestTime: '07:30',
    });
  });
});

describe('DEFAULT_TENANT_SETTINGS', () => {
  it('has no default preset (absent until applied)', () => {
    expect(DEFAULT_TENANT_SETTINGS.preset).toBeUndefined();
  });

  it('includes the organisation defaults', () => {
    expect(DEFAULT_TENANT_SETTINGS.organisation).toBe(DEFAULT_ORGANISATION_SETTINGS);
  });

  it('includes the routine defaults', () => {
    expect(DEFAULT_TENANT_SETTINGS.routine).toBe(DEFAULT_ROUTINE_SETTINGS);
  });

  it('[67.1.06] includes the attention defaults (D3, D10, D23, D29, D34)', () => {
    expect(DEFAULT_TENANT_SETTINGS.attention).toBe(DEFAULT_ATTENTION_SETTINGS);
    expect(DEFAULT_ATTENTION_SETTINGS).toEqual({
      rules: {},
      attendanceGraceMinutes: 15,
      classStartingLeadMinutes: 10,
      dailyAt: '07:00',
      eveningAt: '17:00',
      quietHours: { start: '21:00', end: '07:00' },
      guardianSmsFallback: false,
      staffSmsFallback: false,
      guardianSmsDailyCap: 2,
      smsCreditLowThreshold: 200,
      failedMessagesThreshold: 10,
      escalateAttendanceToHeads: true,
    });
  });

  it('carries the current schema version', () => {
    expect(DEFAULT_TENANT_SETTINGS.version).toBe(TENANT_SETTINGS_SCHEMA_VERSION);
  });
});
