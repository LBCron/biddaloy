import { describe, it, expect } from 'vitest';
import { resolveTenantSettings } from './tenant-settings-resolver';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_ATTENTION_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_FEES_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_REGION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_STUDY_PLANS_SETTINGS,
} from './tenant-settings-defaults';

describe('resolveTenantSettings', () => {
  it('region.timezone is always set (todayFor relies on it)', () => {
    expect(resolveTenantSettings(null).region.timezone).toBe('Asia/Dhaka');
    expect(resolveTenantSettings({}).region.timezone).toBe('Asia/Dhaka');
    expect(resolveTenantSettings({ region: { timezone: 42 } } as never).region.timezone).toBe(
      'Asia/Dhaka',
    );
    expect(
      resolveTenantSettings({ region: { timezone: 'Asia/Kolkata' } } as never).region.timezone,
    ).toBe('Asia/Kolkata');
  });

  it('resolves to full defaults for a null settings blob', () => {
    const resolved = resolveTenantSettings(null);

    expect(resolved.version).toBe(1);
    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.attendance).toEqual(DEFAULT_ATTENDANCE_SETTINGS);
    expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    expect(resolved.organisation).toEqual(DEFAULT_ORGANISATION_SETTINGS);
    expect(resolved.auth).toEqual(DEFAULT_AUTH_SETTINGS);
    expect(resolved.backup).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(resolved.fees).toEqual(DEFAULT_FEES_SETTINGS);
    expect(resolved.communications).toBeUndefined();
  });

  it('returns a stored preset, and undefined when none is stored (35.1.2)', () => {
    const preset = { id: 'bd-national', version: 1 };
    expect(resolveTenantSettings({ preset }).preset).toEqual(preset);
    expect(resolveTenantSettings({}).preset).toBeUndefined();
    expect('preset' in resolveTenantSettings(null)).toBe(false);
  });

  it('resolves to full defaults for an empty settings blob', () => {
    const resolved = resolveTenantSettings({});

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.attendance).toEqual(DEFAULT_ATTENDANCE_SETTINGS);
    expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    expect(resolved.organisation).toEqual(DEFAULT_ORGANISATION_SETTINGS);
    expect(resolved.auth).toEqual(DEFAULT_AUTH_SETTINGS);
  });

  // Regression: the resolver never returned a `routine` key at all —
  // `SchoolSettingsReader.routineSettings` reads `settings.routine!`, so
  // every routine slot save (constraint-check.ts's checkSlot) and greedy
  // fill crashed with `Cannot read properties of undefined` for every
  // tenant, on the very first save. Never caught by unit tests because
  // they stub `routineSettings: async () => ({})`.
  describe('routine (21.1.1)', () => {
    it('a stored partial override keeps unstored optional fields, not just the stored one', () => {
      const resolved = resolveTenantSettings({
        routine: { maxPeriodsPerTeacherPerDay: 4 },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        maxPeriodsPerTeacherPerDay: 4,
      });
    });

    // [1047]: `RoutineSettingsDto` rejects these on write, but a row can
    // still get here some other way (predates the schema, hand-edited,
    // restored from a backup) — every other settings section already
    // guards against this on read; `routine` didn't.
    it('drops a malformed cap instead of passing it through', () => {
      const resolved = resolveTenantSettings({
        routine: { maxPeriodsPerTeacherPerDay: 'abc', maxConsecutivePeriods: -1 },
      });

      expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    });

    it('keeps a valid cap', () => {
      const resolved = resolveTenantSettings({
        routine: { maxConsecutivePeriods: 3 },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        maxConsecutivePeriods: 3,
      });
    });

    it('drops a malformed subjectPeriodsPerWeek map entirely', () => {
      const resolved = resolveTenantSettings({
        routine: { subjectPeriodsPerWeek: 'not-a-map' },
      });

      expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    });

    it('keeps only the numeric entries of a partially malformed subjectPeriodsPerWeek map', () => {
      const resolved = resolveTenantSettings({
        routine: { subjectPeriodsPerWeek: { math: 5, science: 'lots' } },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        subjectPeriodsPerWeek: { math: 5 },
      });
    });

    // Each field's accepted range mirrors `RoutineSettingsDto`: the caps
    // and every map value are `@Min(1)` there, so a zero is malformed
    // data, not a school asking for a cap that permits nothing.
    it('drops a zero cap — a limit of no periods at all is never intended', () => {
      const resolved = resolveTenantSettings({
        routine: { maxPeriodsPerTeacherPerDay: 0, maxConsecutivePeriods: 0 },
      });

      expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    });

    it('drops a zero subjectPeriodsPerWeek target but keeps its positive siblings', () => {
      const resolved = resolveTenantSettings({
        routine: { subjectPeriodsPerWeek: { math: 0, science: 3 } },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        subjectPeriodsPerWeek: { science: 3 },
      });
    });

    it('keeps a zero defaultChangeoverMinutes — no changeover gap is a real setting', () => {
      const resolved = resolveTenantSettings({ routine: { defaultChangeoverMinutes: 0 } });

      expect(resolved.routine).toEqual({ defaultChangeoverMinutes: 0 });
    });
  });

  describe('organisation (33.2.1)', () => {
    it(
      'a stored shifts/versions/groups vocabulary overlays onto the empty default — ' +
        'without this, ClassService/SectionService write-validation would read `undefined`',
      () => {
        const resolved = resolveTenantSettings({
          organisation: { shifts: ['Morning', 'Day'], versions: ['Bangla'], groups: ['Science'] },
        });

        expect(resolved.organisation).toEqual({
          shifts: ['Morning', 'Day'],
          versions: ['Bangla'],
          groups: ['Science'],
        });
      },
    );
  });

  describe('backup.schedule (14.12.1/#615)', () => {
    it('stored {} resolves to the default WEEKLY', () => {
      expect(resolveTenantSettings({}).backup?.schedule).toBe('WEEKLY');
    });

    it('a stored OFF overrides the default', () => {
      expect(resolveTenantSettings({ backup: { schedule: 'OFF' } }).backup?.schedule).toBe('OFF');
    });

    it('a stored DAILY overrides the default', () => {
      expect(resolveTenantSettings({ backup: { schedule: 'DAILY' } }).backup?.schedule).toBe(
        'DAILY',
      );
    });

    it(
      'a same-typed but invalid stored value falls back to the default — `overlayOnDefaults` ' +
        'only type-checks, so this is the read-side guard for a row that bypassed ' +
        "BackupSettingsDto's @IsIn on write",
      () => {
        expect(resolveTenantSettings({ backup: { schedule: 'NONSENSE' } }).backup?.schedule).toBe(
          DEFAULT_BACKUP_SETTINGS.schedule,
        );
      },
    );
  });

  describe('dashboard (8.10.7)', () => {
    const D = {
      risk: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
      committeeAttendanceTargetPct: 90,
      digestTime: '07:30',
    };
    it('null settings resolve to defaults', () => {
      expect(resolveTenantSettings(null).dashboard).toEqual(D);
    });
    it('partial block overlays; the rest stay default', () => {
      expect(
        resolveTenantSettings({ dashboard: { risk: { absentStreakDays: 5 } } }).dashboard,
      ).toEqual({ ...D, risk: { ...D.risk, absentStreakDays: 5 } });
    });
    it('wrong kinds fall back per field', () => {
      expect(
        resolveTenantSettings({ dashboard: { risk: 'x', committeeAttendanceTargetPct: '90' } })
          .dashboard,
      ).toEqual(D);
    });
    it('out-of-bounds stored numbers fall back to the default, in-bounds ones are kept', () => {
      const out = resolveTenantSettings({
        dashboard: {
          risk: {
            absentStreakDays: 0,
            monthlyAttendancePct: 101,
            failedSubjects: 1.5,
            overdueDays: 90,
          },
          committeeAttendanceTargetPct: 101,
        },
      }).dashboard;
      expect(out).toEqual({ ...D, risk: { ...D.risk, overdueDays: 90 } });
    });
    it('malformed digestTime falls back, valid one is kept', () => {
      expect(
        resolveTenantSettings({ dashboard: { digestTime: 'soon' } }).dashboard?.digestTime,
      ).toBe('07:30');
      expect(
        resolveTenantSettings({ dashboard: { digestTime: '06:45' } }).dashboard?.digestTime,
      ).toBe('06:45');
    });
  });

  describe('studyPlans (66.1.04)', () => {
    it('nothing stored resolves to the defaults', () => {
      expect(resolveTenantSettings({}).studyPlans).toEqual(DEFAULT_STUDY_PLANS_SETTINGS);
    });

    it('bad fields fall back to default, good siblings survive, unknown keys drop', () => {
      const out = resolveTenantSettings({
        studyPlans: {
          statusDeadline: '7 am',
          reminderTime: '09:30',
          escalateAfterSchoolDays: -1,
          weeklyDigestTime: '16:45',
          guardianDigestSms: 'true',
          bogus: 1,
        },
      }).studyPlans;
      expect(out).toEqual({
        ...DEFAULT_STUDY_PLANS_SETTINGS,
        reminderTime: '09:30',
        weeklyDigestTime: '16:45',
      });
    });
  });

  describe('applications.smsOnDecision (52.2.6)', () => {
    it('is absent by default and passes a stored boolean through', () => {
      expect(resolveTenantSettings({})).not.toHaveProperty('applications');
      expect(resolveTenantSettings({ applications: { smsOnDecision: true } })).toMatchObject({
        applications: { smsOnDecision: true },
      });
    });

    it('drops a non-boolean value', () => {
      expect(resolveTenantSettings({ applications: { smsOnDecision: 'yes' } })).not.toHaveProperty(
        'applications',
      );
    });
  });

  describe('evaluations.incidentSmsEnabled (28.4.7)', () => {
    it('is absent by default, passes a stored boolean through, drops junk', () => {
      expect(resolveTenantSettings({})).not.toHaveProperty('evaluations');
      expect(resolveTenantSettings({ evaluations: { incidentSmsEnabled: true } })).toMatchObject({
        evaluations: { incidentSmsEnabled: true },
      });
      expect(
        resolveTenantSettings({ evaluations: { incidentSmsEnabled: 'yes' } }),
      ).not.toHaveProperty('evaluations');
    });
  });

  describe('attention (67.1.06 (#2049))', () => {
    it('is the full defaults when nothing is stored (never undefined)', () => {
      expect(resolveTenantSettings({}).attention).toEqual(DEFAULT_ATTENTION_SETTINGS);
      expect(resolveTenantSettings(null).attention).toEqual(DEFAULT_ATTENTION_SETTINGS);
      expect(resolveTenantSettings({ attention: 'junk' }).attention).toEqual(
        DEFAULT_ATTENTION_SETTINGS,
      );
    });

    it('keeps one stored field and defaults every other', () => {
      expect(resolveTenantSettings({ attention: { dailyAt: '06:30' } }).attention).toEqual({
        ...DEFAULT_ATTENTION_SETTINGS,
        dailyAt: '06:30',
      });
    });

    it('falls back to the default for malformed / out-of-range values, no NaN', () => {
      const a = resolveTenantSettings({
        attention: {
          dailyAt: 'nonsense',
          attendanceGraceMinutes: -5,
          classStartingLeadMinutes: 1.5,
          guardianSmsDailyCap: NaN,
          failedMessagesThreshold: 0,
          quietHours: { start: '21:00' },
          guardianSmsFallback: 'yes',
        },
      }).attention!;
      expect(a).toEqual(DEFAULT_ATTENTION_SETTINGS);
    });

    it('drops unknown rules and enabled:false on non-disableable rules (D34)', () => {
      const { rules } = resolveTenantSettings({
        attention: {
          rules: {
            'class.starting': { enabled: false },
            'system.backup_failed': { enabled: false },
            'nope.rule': { enabled: false },
          },
        },
      }).attention!;
      expect(rules).toEqual({ 'class.starting': { enabled: false } });
    });
  });

  describe('documents (48.1.03)', () => {
    it('is always present, defaulting withholdAdmitCardForDues to false', () => {
      expect(resolveTenantSettings({}).documents).toEqual({ withholdAdmitCardForDues: false });
    });

    it('keeps a valid stored prefix and boolean', () => {
      expect(
        resolveTenantSettings({
          documents: { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' },
        }).documents,
      ).toEqual({ withholdAdmitCardForDues: true, serialPrefix: 'DAHS' });
    });

    it('drops a malformed prefix and a non-boolean flag', () => {
      expect(
        resolveTenantSettings({
          documents: { withholdAdmitCardForDues: 'true', serialPrefix: 'bad prefix' },
        }).documents,
      ).toEqual({ withholdAdmitCardForDues: false });
    });
  });

  describe('fees.approvalMode (16.2.1)', () => {
    it('stored {} resolves to the default OTP', () => {
      expect(resolveTenantSettings({}).fees?.approvalMode).toBe('OTP');
    });

    it('a stored OTP_OR_PASSWORD overrides the default', () => {
      expect(
        resolveTenantSettings({ fees: { approvalMode: 'OTP_OR_PASSWORD' } }).fees?.approvalMode,
      ).toBe('OTP_OR_PASSWORD');
    });

    it(
      'a same-typed but invalid stored value falls back to the default — the read-side guard ' +
        "for a row that bypassed FeesSettingsDto's @IsIn on write",
      () => {
        expect(
          resolveTenantSettings({ fees: { approvalMode: 'NONSENSE' } }).fees?.approvalMode,
        ).toBe(DEFAULT_FEES_SETTINGS.approvalMode);
      },
    );

    it('notifyOnManualGenerationDefault/notifyOnScheduleDefault default false/true and can be overridden', () => {
      expect(resolveTenantSettings({}).fees?.notifyOnManualGenerationDefault).toBe(false);
      expect(resolveTenantSettings({}).fees?.notifyOnScheduleDefault).toBe(true);
      expect(
        resolveTenantSettings({ fees: { notifyOnManualGenerationDefault: true } }).fees
          ?.notifyOnManualGenerationDefault,
      ).toBe(true);
      expect(
        resolveTenantSettings({ fees: { notifyOnScheduleDefault: false } }).fees
          ?.notifyOnScheduleDefault,
      ).toBe(false);
    });
  });

  describe('fees.requireSecondApprover (78 D1)', () => {
    it('absent resolves to false', () => {
      expect(resolveTenantSettings({}).fees?.requireSecondApprover).toBe(false);
      expect(resolveTenantSettings({ fees: {} }).fees?.requireSecondApprover).toBe(false);
    });
    it('a stored true stays true', () => {
      expect(
        resolveTenantSettings({ fees: { requireSecondApprover: true } }).fees
          ?.requireSecondApprover,
      ).toBe(true);
    });
    it('a stored non-boolean falls back to false', () => {
      expect(
        resolveTenantSettings({ fees: { requireSecondApprover: 'yes' } }).fees
          ?.requireSecondApprover,
      ).toBe(false);
    });
  });

  it('a school unset returns the default otpLoginEnabled=true, and a stored false overrides it', () => {
    expect(resolveTenantSettings(null).auth?.otpLoginEnabled).toBe(true);
    expect(resolveTenantSettings({ auth: { otpLoginEnabled: false } }).auth?.otpLoginEnabled).toBe(
      false,
    );
  });

  it('resolves an old attendance blob with the new shift/period defaults', () => {
    const resolved = resolveTenantSettings({ attendance: { lateAfter: '09:00' } });

    expect(resolved.attendance?.shiftTimes).toEqual([]);
    expect(resolved.attendance?.periodAttendance).toEqual({ enabled: false });
  });

  it('resolves dailySource: default ANY, valid kept, unknown falls back (D1)', () => {
    expect(resolveTenantSettings(null).attendance?.dailySource).toBe('ANY');
    expect(
      resolveTenantSettings({ attendance: { dailySource: 'FIRST_PERIOD' } }).attendance
        ?.dailySource,
    ).toBe('FIRST_PERIOD');
    expect(
      resolveTenantSettings({ attendance: { dailySource: 'NOPE' } }).attendance?.dailySource,
    ).toBe('ANY');
  });

  it('dailySource fixup never mutates the shared default', () => {
    const snapshot = { ...DEFAULT_ATTENDANCE_SETTINGS };
    const resolved = resolveTenantSettings({ attendance: { dailySource: 'NOPE' } });
    expect(resolved.attendance).not.toBe(DEFAULT_ATTENDANCE_SETTINGS);
    expect(DEFAULT_ATTENDANCE_SETTINGS).toEqual(snapshot);
  });

  it('resolves staffSmsFallback as a strict boolean, default false (D29)', () => {
    expect(
      resolveTenantSettings({ attention: { staffSmsFallback: true } }).attention?.staffSmsFallback,
    ).toBe(true);
    expect(
      resolveTenantSettings({ attention: { staffSmsFallback: 'yes' } }).attention?.staffSmsFallback,
    ).toBe(false);
  });

  it('merges a partial attendance patch over defaults, keeping the rest', () => {
    const resolved = resolveTenantSettings({ attendance: { lateAfter: '09:00' } });

    expect(resolved.attendance).toEqual({ ...DEFAULT_ATTENDANCE_SETTINGS, lateAfter: '09:00' });
  });

  it('arrivalNotice: both switches off for empty settings, smsAllowed off for a partial patch', () => {
    expect(resolveTenantSettings({}).attendance?.arrivalNotice).toEqual({
      enabled: false,
      smsAllowed: false,
    });
    const partial = resolveTenantSettings({ attendance: { arrivalNotice: { enabled: true } } });
    expect(partial.attendance?.arrivalNotice).toEqual({ enabled: true, smsAllowed: false });
  });

  it('falls back to default region when only communications is configured', () => {
    const resolved = resolveTenantSettings({
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' } },
    });

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.communications).toEqual({
      whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' },
    });
  });

  it('keeps a stored region rather than falling back when one is present', () => {
    const customRegion = { ...DEFAULT_REGION_SETTINGS, locale: 'en-BD', timezone: 'Asia/Dhaka' };

    const resolved = resolveTenantSettings({ region: customRegion });

    expect(resolved.region).toEqual(customRegion);
    expect(resolved.communications).toBeUndefined();
  });

  it('always stamps the current schema version regardless of what was stored', () => {
    const resolved = resolveTenantSettings({ version: 999 });

    expect(resolved.version).toBe(1);
  });

  // The stored blob isn't re-validated on read — it can predate a schema
  // change, be hand-edited, or come back from a backup — so a section
  // being present doesn't make it complete. Callers rely on every region
  // field existing; resolving per-section rather than per-field would
  // hand them a region missing `currency`, `date`, and the rest.
  describe('partial and malformed stored regions', () => {
    it('fills in every field a partially-stored region omits', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD' } });

      expect(resolved.region).toEqual({ ...DEFAULT_REGION_SETTINGS, locale: 'en-BD' });
    });

    it('merges inside a nested group, not just at the top level', () => {
      const resolved = resolveTenantSettings({ region: { currency: { code: 'USD' } } });

      expect(resolved.region?.currency).toEqual({
        ...DEFAULT_REGION_SETTINGS.currency,
        code: 'USD',
      });
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('falls back per field on a wrong-typed value, keeping its siblings', () => {
      const resolved = resolveTenantSettings({
        region: { locale: 42, timezone: 'Asia/Dhaka' },
      });

      expect(resolved.region?.locale).toBe(DEFAULT_REGION_SETTINGS.locale);
      expect(resolved.region?.timezone).toBe('Asia/Dhaka');
    });

    it('falls back to the default group when a nested group is not an object', () => {
      const resolved = resolveTenantSettings({ region: { currency: null, date: 'nonsense' } });

      expect(resolved.region?.currency).toEqual(DEFAULT_REGION_SETTINGS.currency);
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('replaces an array wholesale rather than merging it element-wise', () => {
      const resolved = resolveTenantSettings({
        region: { address: { fields: ['street'], order: ['street'] } },
      });

      expect(resolved.region?.address).toEqual({ fields: ['street'], order: ['street'] });
    });

    it('drops a stored key the current schema no longer knows about', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD', legacyField: 'x' } });

      expect(resolved.region).not.toHaveProperty('legacyField');
    });

    it('falls back to defaults when region itself is not an object', () => {
      expect(resolveTenantSettings({ region: 'nonsense' }).region).toEqual(DEFAULT_REGION_SETTINGS);
      expect(resolveTenantSettings({ region: null }).region).toEqual(DEFAULT_REGION_SETTINGS);
    });

    it('omits communications when it is stored as something other than an object', () => {
      expect(resolveTenantSettings({ communications: 'nonsense' }).communications).toBeUndefined();
    });
  });
});
