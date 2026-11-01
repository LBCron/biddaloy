import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import {
  clearPresetSettings,
  mergeApplySettings,
  mergeTenantSettings,
  toPlainSettingsPatch,
} from './tenant-settings-merge.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';
import { DEFAULT_REGION_SETTINGS } from './tenant-settings-defaults';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('./testing/messaging-stubs.fixture'),
);

function toPatch(plain: Record<string, unknown>): Record<string, unknown> {
  return toPlainSettingsPatch(plainToInstance(TenantSettingsDto, plain));
}

describe('mergeTenantSettings', () => {
  it('stores routine on PATCH and leaves fees alone (#1811)', () => {
    const existing = { version: 1, fees: { approvalMode: 'OTP' } };
    const merged = mergeTenantSettings(
      existing,
      toPatch({ version: 1, routine: { defaultChangeoverMinutes: 10 } }),
    );
    expect(merged.routine).toEqual({ defaultChangeoverMinutes: 10 });
    expect(merged.fees).toEqual(existing.fees);
  });

  it('replaces routine wholesale; a cleared cap (null) sticks; omitted patch keeps it (#1811)', () => {
    const existing = {
      version: 1,
      routine: {
        defaultChangeoverMinutes: 5,
        maxConsecutivePeriods: 3,
        subjectPeriodsPerWeek: { s1: 4 },
      },
    };
    expect(
      mergeTenantSettings(
        existing,
        toPatch({ version: 1, routine: { defaultChangeoverMinutes: 7 } }),
      ).routine,
    ).toEqual({ defaultChangeoverMinutes: 7 });
    expect(
      mergeTenantSettings(
        existing,
        toPatch({
          version: 1,
          routine: { defaultChangeoverMinutes: 5, maxPeriodsPerTeacherPerDay: null },
        }),
      ).routine,
    ).toEqual({ defaultChangeoverMinutes: 5, maxPeriodsPerTeacherPerDay: null });
    expect(mergeTenantSettings(existing, toPatch({ version: 1 })).routine).toEqual(
      existing.routine,
    );
  });

  it('stores dashboard wholesale, leaves fees alone, and keeps it when omitted (8.10.7)', () => {
    const existing = {
      version: 1,
      fees: { approvalMode: 'OTP' },
      dashboard: { risk: { overdueDays: 30 } },
    };
    const merged = mergeTenantSettings(
      existing,
      toPatch({ version: 1, dashboard: { digestTime: '08:00' } }),
    );
    expect(merged.dashboard).toEqual({ digestTime: '08:00' });
    expect(merged.fees).toEqual(existing.fees);
    expect(mergeTenantSettings(existing, toPatch({ version: 1 })).dashboard).toEqual(
      existing.dashboard,
    );
  });

  it('shallow-merges studyPlans per field and keeps it when omitted (66.1.04)', () => {
    const existing = { version: 1, studyPlans: { statusDeadline: '17:30' } };
    const merged = mergeTenantSettings(
      existing,
      toPatch({ version: 1, studyPlans: { guardianDigestSms: true } }),
    );
    expect(merged.studyPlans).toEqual({ statusDeadline: '17:30', guardianDigestSms: true });
    expect(mergeTenantSettings(existing, toPatch({ version: 1 })).studyPlans).toEqual(
      existing.studyPlans,
    );
  });

  it('shallow-merges attendance: omitted keys survive, sent keys replace', () => {
    const MORNING = '0b6f8a52-3c1e-4d7a-9f20-5e8c1a2b3c4d';
    const DAY = '7d2e9c41-8a5b-4f3e-b1c6-2a9d8e7f6b5a';
    const existing = {
      version: 1,
      attendance: {
        lateAfter: '09:00',
        absentAfter: '10:00',
        shiftTimes: [{ shiftId: MORNING, lateAfter: '08:15', absentAfter: '10:00' }],
        periodAttendance: { enabled: true },
      },
    };

    const kept = mergeTenantSettings(
      existing,
      toPatch({ version: 1, attendance: { lateAfter: '09:30', absentAfter: '10:30' } }),
    );
    expect(kept.attendance).toEqual({
      lateAfter: '09:30',
      absentAfter: '10:30',
      shiftTimes: [{ shiftId: MORNING, lateAfter: '08:15', absentAfter: '10:00' }],
      periodAttendance: { enabled: true },
    });

    const replaced = mergeTenantSettings(
      existing,
      toPatch({
        version: 1,
        attendance: { shiftTimes: [{ shiftId: DAY, lateAfter: '09:15', absentAfter: '11:00' }] },
      }),
    );
    expect((replaced.attendance as Record<string, unknown>).shiftTimes).toEqual([
      { shiftId: DAY, lateAfter: '09:15', absentAfter: '11:00' },
    ]);
  });

  it('ignores a non-object stored attendance instead of spreading it', () => {
    const patch = toPatch({ version: 1, attendance: { lateAfter: '09:30', absentAfter: '10:30' } });

    for (const stored of ['garbage', [1, 2]]) {
      const merged = mergeTenantSettings({ version: 1, attendance: stored }, patch);
      expect(merged.attendance).toEqual({ lateAfter: '09:30', absentAfter: '10:30' });
    }
  });

  it('starts from an empty object when nothing was stored yet', () => {
    const patch = toPatch({ version: 1, region: DEFAULT_REGION_SETTINGS });

    const merged = mergeTenantSettings(null, patch);

    expect(merged.version).toBe(1);
    expect(merged.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(merged.communications).toBeUndefined();
  });

  it('replaces region wholesale but leaves communications untouched', () => {
    const existing = {
      version: 1,
      region: DEFAULT_REGION_SETTINGS,
      communications: { sms: { provider: 'alpha', alpha: { apiKey: 'enc:old' } } },
    };
    const patch = toPatch({ version: 1, region: { ...DEFAULT_REGION_SETTINGS, locale: 'en-BD' } });

    const merged = mergeTenantSettings(existing, patch);

    expect((merged.region as { locale: string }).locale).toBe('en-BD');
    expect(merged.communications).toEqual(existing.communications);
  });

  it('merges communications one medium at a time, preserving siblings', () => {
    const existing = {
      version: 1,
      communications: {
        sms: { provider: 'alpha', alpha: { apiKey: 'enc:old-sms' } },
      },
    };
    const patch = toPatch({
      version: 1,
      communications: {
        whatsapp: { phoneNumberId: '999', accessToken: 'enc:new-wa' },
      },
    });

    const merged = mergeTenantSettings(existing, patch);
    const communications = merged.communications as Record<string, unknown>;

    expect(communications.sms).toEqual(existing.communications.sms);
    expect(communications.whatsapp).toEqual({ phoneNumberId: '999', accessToken: 'enc:new-wa' });
  });

  it('leaves region untouched when the patch omits it', () => {
    const existing = { version: 1, region: DEFAULT_REGION_SETTINGS };
    const patch = toPatch({ version: 1 });

    const merged = mergeTenantSettings(existing, patch);

    expect(merged.region).toEqual(DEFAULT_REGION_SETTINGS);
  });

  it('replaces backup wholesale when present, and leaves it untouched when the patch omits it (#615)', () => {
    const existing = { version: 1, backup: { schedule: 'WEEKLY' } };

    const untouched = mergeTenantSettings(existing, toPatch({ version: 1 }));
    expect(untouched.backup).toEqual({ schedule: 'WEEKLY' });

    const patch = toPatch({ version: 1, backup: { schedule: 'DAILY' } });
    const merged = mergeTenantSettings(existing, patch);
    expect(merged.backup).toEqual({ schedule: 'DAILY' });
  });

  it('replaces fees wholesale when present, and leaves it untouched when the patch omits it (16.2.1)', () => {
    const existing = {
      version: 1,
      fees: {
        approvalMode: 'OTP',
        notifyOnManualGenerationDefault: false,
        notifyOnScheduleDefault: true,
      },
    };

    const untouched = mergeTenantSettings(existing, toPatch({ version: 1 }));
    expect(untouched.fees).toEqual(existing.fees);

    const patch = toPatch({
      version: 1,
      fees: {
        approvalMode: 'OTP_OR_PASSWORD',
        notifyOnManualGenerationDefault: true,
        notifyOnScheduleDefault: false,
      },
    });
    const merged = mergeTenantSettings(existing, patch);
    expect(merged.fees).toEqual({
      approvalMode: 'OTP_OR_PASSWORD',
      notifyOnManualGenerationDefault: true,
      notifyOnScheduleDefault: false,
    });
  });

  it('ignores a patched preset and keeps the stored one (35.1.2)', () => {
    const preset = { id: 'bd-national', version: 1 };
    const withPreset = { version: 1, preset };
    // A PATCH carrying `preset` must not overwrite it.
    expect(mergeTenantSettings(withPreset, { version: 1, preset: { id: 'x' } }).preset).toEqual(
      preset,
    );
    // An unrelated patch leaves it alone.
    expect(mergeTenantSettings(withPreset, { version: 1, region: {} }).preset).toEqual(preset);
    // A PATCH can't create one either.
    expect(mergeTenantSettings({ version: 1 }, { version: 1, preset }).preset).toBeUndefined();
  });

  it('stores evaluations on PATCH and preserves it when the patch omits it (28.4.7)', () => {
    const existing = { version: 1, evaluations: { incidentSmsEnabled: true } };

    expect(mergeTenantSettings(existing, toPatch({ version: 1 })).evaluations).toEqual({
      incidentSmsEnabled: true,
    });
    expect(
      mergeTenantSettings(
        { version: 1 },
        toPatch({ version: 1, evaluations: { incidentSmsEnabled: true } }),
      ).evaluations,
    ).toEqual({ incidentSmsEnabled: true });
  });

  it('replaces applications wholesale on PATCH and preserves it when omitted (52.2.6)', () => {
    const existing = { version: 1, applications: { smsOnDecision: true } };

    expect(mergeTenantSettings(existing, toPatch({ version: 1 })).applications).toEqual({
      smsOnDecision: true,
    });
    expect(
      mergeTenantSettings(existing, toPatch({ version: 1, applications: { smsOnDecision: false } }))
        .applications,
    ).toEqual({ smsOnDecision: false });
  });

  it('stores documents on PATCH and leaves fees untouched (48.1.03)', () => {
    const fees = { approvalMode: 'OTP' };
    const merged = mergeTenantSettings(
      { version: 1, fees },
      toPatch({ version: 1, documents: { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' } }),
    );
    expect(merged.documents).toEqual({ withholdAdmitCardForDues: true, serialPrefix: 'DAHS' });
    expect(merged.fees).toEqual(fees);
  });

  it('shallow-merges documents: a partial PATCH keeps the other key, null clears serialPrefix (48.1.03)', () => {
    const stored = {
      version: 1,
      documents: { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' },
    };
    expect(
      mergeTenantSettings(stored, toPatch({ version: 1, documents: { serialPrefix: 'ABC' } }))
        .documents,
    ).toEqual({ withholdAdmitCardForDues: true, serialPrefix: 'ABC' });
    expect(
      mergeTenantSettings(stored, toPatch({ version: 1, documents: { serialPrefix: null } }))
        .documents,
    ).toEqual({ withholdAdmitCardForDues: true, serialPrefix: null });
  });

  it('leaves documents untouched when the patch omits it (48.1.03)', () => {
    const documents = { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' };
    expect(
      mergeTenantSettings({ version: 1, documents }, toPatch({ version: 1 })).documents,
    ).toEqual(documents);
  });

  // [1811] A typed object, so a new DTO section without an entry is a compile
  // error, and one without a merge branch fails the `it` below. Excluded:
  // `organisationRenames` is a write instruction, not stored; `preset` is
  // never PATCHed (Epic 35 D37) and is not on the DTO at all.
  const EVERY_SECTION: Record<
    Exclude<keyof TenantSettingsDto, 'version' | 'organisationRenames'>,
    { marker: string }
  > = {
    region: { marker: 'region' },
    communications: { marker: 'communications' },
    attendance: { marker: 'attendance' },
    routine: { marker: 'routine' },
    organisation: { marker: 'organisation' },
    auth: { marker: 'auth' },
    backup: { marker: 'backup' },
    fees: { marker: 'fees' },
    evaluations: { marker: 'evaluations' },
    applications: { marker: 'applications' },
    homework: { marker: 'homework' },
    documents: { marker: 'documents' },
    studyPlans: { marker: 'studyPlans' },
    attention: { marker: 'attention' },
    dashboard: { marker: 'dashboard' },
  };

  it('every DTO section survives a merge (#1811 guard)', () => {
    const merged = mergeTenantSettings({}, { version: 1, ...EVERY_SECTION });
    for (const [key, value] of Object.entries(EVERY_SECTION)) {
      expect(merged[key], key).toMatchObject(value);
    }
  });

  it('replaces organisation wholesale when present, and leaves it untouched when the patch omits it (33.1.1)', () => {
    const existing = {
      version: 1,
      organisation: { shifts: ['Morning'], versions: [], groups: [] },
    };

    const untouched = mergeTenantSettings(existing, toPatch({ version: 1 }));
    expect(untouched.organisation).toEqual(existing.organisation);

    const patch = toPatch({
      version: 1,
      organisation: { shifts: [], versions: ['Bangla'], groups: ['A'] },
    });
    const merged = mergeTenantSettings(existing, patch);
    expect(merged.organisation).toEqual({ shifts: [], versions: ['Bangla'], groups: ['A'] });
  });

  describe('field-level merge within a medium — #8.7.9 PATCH contract', () => {
    it('omitting a secret field from the patch leaves the stored value unchanged', () => {
      const existing = {
        version: 1,
        communications: {
          whatsapp: { phoneNumberId: '111', accessToken: 'enc:old-token' },
        },
      };
      // Patch touches only phoneNumberId — accessToken is genuinely
      // absent from the payload, not merely undefined-in-JS.
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '222' } },
      });

      const merged = mergeTenantSettings(existing, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp.phoneNumberId).toBe('222');
      expect(whatsapp.accessToken).toBe('enc:old-token');
    });

    // #3331: null removes the key (a cleared secret and a never-set one read the same).
    it('an explicit null removes a secret field rather than leaving it unchanged', () => {
      const existing = {
        version: 1,
        communications: {
          whatsapp: { phoneNumberId: '111', accessToken: 'enc:old-token' },
        },
      };
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '111', accessToken: null } },
      });

      const merged = mergeTenantSettings(existing, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp).toEqual({ phoneNumberId: '111' });
    });

    // #3331: clearing a saved optional field (senderId) must actually remove it; omission keeps it.
    it('an explicit null removes a saved optional field; an omitted one is kept', () => {
      const existing = {
        version: 1,
        communications: {
          sms: {
            provider: 'beta',
            beta: { token: 'enc:t', senderId: 'OLD', apiUrl: 'https://x.example' },
          },
        },
      };
      const patch = toPatch({
        version: 1,
        communications: { sms: { provider: 'beta', beta: { senderId: null } } },
      });

      const merged = mergeTenantSettings(existing, patch);
      expect((merged.communications as Record<string, unknown>).sms).toEqual({
        provider: 'beta',
        beta: { token: 'enc:t', apiUrl: 'https://x.example' },
      });
    });

    it('merges two levels deep — sms.beta.token omitted preserves it while senderId updates', () => {
      const existing = {
        version: 1,
        communications: {
          sms: {
            provider: 'beta',
            beta: { token: 'enc:old-key', senderId: 'OLD' },
          },
        },
      };
      const patch = toPatch({
        version: 1,
        communications: {
          sms: { provider: 'beta', beta: { senderId: 'NEW' } },
        },
      });

      const merged = mergeTenantSettings(existing, patch);
      const beta = (
        (merged.communications as Record<string, unknown>).sms as Record<string, unknown>
      ).beta as Record<string, unknown>;

      expect(beta.senderId).toBe('NEW');
      expect(beta.token).toBe('enc:old-key');
    });

    it('a fresh field value on a never-configured medium still requires an unset field to be genuinely absent from the patch', () => {
      // No `existing` at all — proves the merge doesn't crash reaching
      // into a medium that was never configured before.
      const patch = toPatch({
        version: 1,
        communications: { whatsapp: { phoneNumberId: '111' } },
      });

      const merged = mergeTenantSettings(null, patch);
      const whatsapp = (merged.communications as Record<string, unknown>).whatsapp as Record<
        string,
        unknown
      >;

      expect(whatsapp.phoneNumberId).toBe('111');
      expect('accessToken' in whatsapp).toBe(false);
    });
  });
});

describe('mergeTenantSettings attention [67.1.06]', () => {
  it('merges one field and one rule without losing the others', () => {
    const merged = mergeTenantSettings(
      { attention: { dailyAt: '06:30', rules: { 'class.starting': { enabled: false } } } },
      toPatch({
        version: 1,
        attention: { rules: { 'homework.due_today': { enabled: false } } },
      }),
    );
    expect(merged.attention).toEqual({
      dailyAt: '06:30',
      rules: { 'class.starting': { enabled: false }, 'homework.due_today': { enabled: false } },
    });
  });

  it('leaves attention untouched when the patch has none', () => {
    const stored = { attention: { dailyAt: '06:30', rules: {} } };
    expect(mergeTenantSettings(stored, toPatch({ version: 1 })).attention).toEqual(
      stored.attention,
    );
  });
});

describe('mergeApplySettings / clearPresetSettings', () => {
  const preset = {
    id: 'p',
    version: '1',
    appliedAt: '2026-01-01T00:00:00.000Z',
    appliedByUserId: 'u',
  };
  const organisation = { shifts: [], versions: ['BN'], groups: ['SCIENCE'] };

  it('sets organisation, region and preset, keeping other blocks', () => {
    const out = mergeApplySettings(
      { version: 1, fees: { x: 1 } },
      { organisation, region: DEFAULT_REGION_SETTINGS, preset },
    );
    expect(out).toMatchObject({
      organisation,
      region: DEFAULT_REGION_SETTINGS,
      preset,
      fees: { x: 1 },
    });
  });

  it('clear removes preset, resets organisation, keeps the rest', () => {
    const out = clearPresetSettings({ version: 1, organisation, preset, fees: { x: 1 } });
    expect(out.preset).toBeUndefined();
    expect(out.organisation).toEqual({ shifts: [], versions: [], groups: [] });
    expect(out.fees).toEqual({ x: 1 });
  });
});

describe('mergeTenantSettings weeklyOffHistory (TIME-02)', () => {
  const NOW = new Date('2026-10-10T19:00:00Z'); // 2026-10-11 in Asia/Dhaka
  const attendance = (weeklyOffDays: number[], extra: Record<string, unknown> = {}) =>
    ({ version: 1, attendance: { weeklyOffDays, ...extra } }) as Record<string, unknown>;

  it('changing weeklyOffDays appends {until: today, days: old}', () => {
    const m = mergeTenantSettings(
      attendance([6, 5]),
      { version: 1, attendance: { weeklyOffDays: [5] } },
      NOW,
    );
    expect((m.attendance as any).weeklyOffHistory).toEqual([{ until: '2026-10-11', days: [5, 6] }]);
    expect((m.attendance as any).weeklyOffDays).toEqual([5]);
  });

  it('same days in a different order appends nothing', () => {
    const m = mergeTenantSettings(
      attendance([5, 6]),
      { version: 1, attendance: { weeklyOffDays: [6, 5] } },
      NOW,
    );
    expect((m.attendance as any).weeklyOffHistory).toBeUndefined();
  });

  it('a second change on the same day appends nothing more', () => {
    const first = mergeTenantSettings(
      attendance([5, 6]),
      { version: 1, attendance: { weeklyOffDays: [5] } },
      NOW,
    );
    const second = mergeTenantSettings(
      first,
      { version: 1, attendance: { weeklyOffDays: [0] } },
      NOW,
    );
    expect((second.attendance as any).weeklyOffHistory).toEqual([
      { until: '2026-10-11', days: [5, 6] },
    ]);
  });

  it('a patch carrying weeklyOffHistory cannot overwrite the stored list', () => {
    const stored = attendance([5], { weeklyOffHistory: [{ until: '2026-01-01', days: [6] }] });
    const m = mergeTenantSettings(
      stored,
      { version: 1, attendance: { lateAfter: '09:00', weeklyOffHistory: [] } },
      NOW,
    );
    expect((m.attendance as any).weeklyOffHistory).toEqual([{ until: '2026-01-01', days: [6] }]);
  });

  it('no stored attendance: old days come from the default [5]', () => {
    const m = mergeTenantSettings(
      { version: 1 },
      { version: 1, attendance: { weeklyOffDays: [6] } },
      NOW,
    );
    expect((m.attendance as any).weeklyOffHistory).toEqual([{ until: '2026-10-11', days: [5] }]);
  });

  it('uses the stored region timezone for today', () => {
    const stored = {
      version: 1,
      region: { timezone: 'Pacific/Honolulu' },
      attendance: { weeklyOffDays: [5] },
    };
    const m = mergeTenantSettings(stored, { version: 1, attendance: { weeklyOffDays: [6] } }, NOW);
    expect((m.attendance as any).weeklyOffHistory).toEqual([{ until: '2026-10-10', days: [5] }]);
  });
});

describe('mergeTenantSettings - flat/nested alignment (D6 + D31)', () => {
  const merge = (stored: unknown, patch: unknown) =>
    (mergeTenantSettings({ version: 1, communications: stored } as any, {
      version: 1,
      communications: patch,
    }).communications ?? {}) as any;

  it('flat stored + nested patch that omits the secret keeps the stored secret, nested, no flat keys', () => {
    const out = merge(
      { whatsapp: { phoneNumberId: '1', accessToken: 'enc:old' } },
      { whatsapp: { solo: { phoneNumberId: '2' } } },
    );

    expect(out.whatsapp).toEqual({ solo: { phoneNumberId: '2', accessToken: 'enc:old' } });
  });

  it('nested stored + flat patch gives nested with the patch values', () => {
    const out = merge(
      { whatsapp: { solo: { phoneNumberId: '1', accessToken: 'enc:old' } } },
      { whatsapp: { phoneNumberId: '2', accessToken: 'enc:new' } },
    );

    expect(out.whatsapp).toEqual({ solo: { phoneNumberId: '2', accessToken: 'enc:new' } });
  });

  it('flat + flat stays flat', () => {
    const out = merge(
      { whatsapp: { phoneNumberId: '1', accessToken: 'enc:old' } },
      { whatsapp: { phoneNumberId: '2' } },
    );

    expect(out.whatsapp).toEqual({ phoneNumberId: '2', accessToken: 'enc:old' });
  });

  it('a multi-provider medium is never lifted', () => {
    const out = merge(
      { sms: { provider: 'alpha', alpha: { apiKey: 'enc:a', senderId: 's' } } },
      { sms: { provider: 'beta', beta: { token: 'enc:b' } } },
    );

    expect(out.sms).toEqual({
      provider: 'beta',
      alpha: { apiKey: 'enc:a', senderId: 's' },
      beta: { token: 'enc:b' },
    });
  });

  it('does not mutate its inputs', () => {
    const stored = { whatsapp: { phoneNumberId: '1', accessToken: 'enc:old' } };
    const patch = { whatsapp: { solo: { phoneNumberId: '2' } } };
    merge(stored, patch);

    expect(stored).toEqual({ whatsapp: { phoneNumberId: '1', accessToken: 'enc:old' } });
    expect(patch).toEqual({ whatsapp: { solo: { phoneNumberId: '2' } } });
  });
});
