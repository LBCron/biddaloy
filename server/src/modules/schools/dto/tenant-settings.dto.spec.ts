import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { TenantSettingsDto, TENANT_SETTINGS_SCHEMA_VERSION } from './tenant-settings.dto';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_ATTENTION_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  DEFAULT_FEES_SETTINGS,
  DEFAULT_REGION_SETTINGS,
} from '../settings/tenant-settings-defaults';

vi.mock(
  '../../communications/providers/messaging-providers',
  () => import('../settings/testing/messaging-stubs.fixture'),
);

const commError = (errors: ValidationError[], medium: string) =>
  errors.find((e) => e.property === 'communications')?.children?.find((e) => e.property === medium);
const msg = (e?: ValidationError) => Object.values(e?.constraints ?? {}).join(' ');
const ALPHA = { apiKey: 'k', senderId: 's' };

// Matches the global pipe in server/src/validation-pipe.ts (buildValidationPipeOptions()),
// which SchoolsController's @Body() dto: TenantSettingsDto actually runs
// through in production — this proves the same rejection behaviour
// directly against the schema, without needing to boot a controller.
const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

function toDto(plain: Record<string, unknown>): TenantSettingsDto {
  return plainToInstance(TenantSettingsDto, plain);
}

describe('TenantSettingsDto', () => {
  it('accepts a fully-specified settings blob', async () => {
    const dto = toDto({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      region: DEFAULT_REGION_SETTINGS,
      communications: {
        whatsapp: { solo: { phoneNumberId: '123', accessToken: 'token' } },
      },
    });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors).toEqual([]);
  });

  it('requires version', async () => {
    const dto = toDto({ region: DEFAULT_REGION_SETTINGS });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'version')).toBe(true);
  });

  it('rejects a version other than the current schema version', async () => {
    const dto = toDto({ version: 2, region: DEFAULT_REGION_SETTINGS });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'version')).toBe(true);
  });

  describe('fees.requireSecondApprover (78 D1)', () => {
    const fees = (requireSecondApprover: unknown) => ({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      fees: { ...DEFAULT_FEES_SETTINGS, requireSecondApprover },
    });

    it('accepts a boolean', async () => {
      expect(await validate(toDto(fees(true)), VALIDATION_OPTIONS)).toEqual([]);
    });

    it('rejects the string "true"', async () => {
      const errors = await validate(toDto(fees('true')), VALIDATION_OPTIONS);
      const feesErrors = errors.find((e) => e.property === 'fees')?.children ?? [];
      expect(feesErrors.some((e) => e.property === 'requireSecondApprover')).toBe(true);
    });
  });

  it('rejects an unknown top-level key instead of silently persisting it', async () => {
    const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, branding: { logoUrl: 'x' } });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors.some((e) => e.property === 'branding')).toBe(true);
  });

  it('rejects an unknown nested key with the fixed sentence', async () => {
    const dto = toDto({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      communications: { whatsapp: { solo: { phoneNumberId: '1', extra: 'EVIL-123' } } },
    });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(msg(commError(errors, 'whatsapp'))).toBe(
      'communications.whatsapp has a field this company does not use.',
    );
  });

  it('rejects an incomplete nested section (region without currency)', async () => {
    const { currency: _currency, ...regionWithoutCurrency } = DEFAULT_REGION_SETTINGS;
    const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, region: regionWithoutCurrency });

    const errors = await validate(dto, VALIDATION_OPTIONS);

    const regionErrors = errors.find((e) => e.property === 'region');
    expect(regionErrors?.children?.some((e) => e.property === 'currency')).toBe(true);
  });

  // `null` is not a shape TenantSettings permits anywhere: a section is
  // present and well-formed, or omitted. class-validator's own
  // `@IsOptional()` treats `null` as "skip everything", which would have
  // let these persist — hence `@OptionalSetting()`.
  describe('null handling', () => {
    it('rejects null for an optional nested section', async () => {
      const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, communications: null });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.some((e) => e.property === 'communications')).toBe(true);
    });

    // #3331: null clears a saved optional field (the merge removes it); a required one cannot be cleared.
    it('accepts null for an optional field and rejects it for a required one', async () => {
      const optional = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'alpha', alpha: { ...ALPHA, apiUrl: null } } },
      });
      expect(await validate(optional, VALIDATION_OPTIONS)).toEqual([]);

      const required = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'alpha', alpha: { ...ALPHA, senderId: null } } },
      });
      const errors = await validate(required, VALIDATION_OPTIONS);
      expect(msg(commError(errors, 'sms'))).toContain(
        'senderId is required and cannot be cleared.',
      );
    });

    it('still accepts an omitted optional field', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'alpha', alpha: ALPHA } },
      });

      expect(await validate(dto, VALIDATION_OPTIONS)).toEqual([]);
    });
  });

  // The selected company must be configured, or the resolver finds nothing at send time.
  describe('sms provider/config coherence', () => {
    it('rejects a provider whose config block is missing', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'beta' } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(msg(commError(errors, 'sms'))).toBe(
        'communications.sms must include the settings of the chosen company.',
      );
    });

    it('rejects a config that names one company and configures the other', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'alpha', beta: { token: 't' } } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(commError(errors, 'sms')).toBeDefined();
    });

    it('rejects an unknown provider without echoing it', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'EVIL-123' } },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(msg(commError(errors, 'sms'))).toBe(
        'communications.sms names a company that is not available for this channel.',
      );
    });

    it('accepts both companies configured - switching between them is legitimate', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: {
          sms: { provider: 'beta', alpha: ALPHA, beta: { token: 't2' } },
        },
      });

      expect(await validate(dto, VALIDATION_OPTIONS)).toEqual([]);
    });
  });

  // These fields travel as regex *source* strings and get compiled with
  // `new RegExp()` by consumers. An uncompilable one saved once breaks
  // validation for the whole tenant at read time, in every consumer.
  describe('regex-source fields', () => {
    it('rejects a phone pattern that cannot compile', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          phone: { ...DEFAULT_REGION_SETTINGS.phone, pattern: '^(01[3-9]' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const phoneError = errors
        .find((e) => e.property === 'region')
        ?.children?.find((e) => e.property === 'phone');
      expect(phoneError?.children?.some((e) => e.property === 'pattern')).toBe(true);
    });

    it('rejects an identifier pattern that cannot compile', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          identifiers: { national: '[unterminated', student: '' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const identifiersError = errors
        .find((e) => e.property === 'region')
        ?.children?.find((e) => e.property === 'identifiers');
      expect(identifiersError?.children?.some((e) => e.property === 'national')).toBe(true);
    });

    it('accepts the shipped defaults, which are themselves regex sources', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: DEFAULT_REGION_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors).toEqual([]);
    });
  });

  describe('secret fields - #8.7.9 PATCH contract (omit leaves unchanged, null clears)', () => {
    const wa = (solo: Record<string, unknown>) =>
      toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, communications: { whatsapp: { solo } } });

    it('accepts a medium with its secret field omitted entirely', async () => {
      expect(await validate(wa({ phoneNumberId: '123' }), VALIDATION_OPTIONS)).toEqual([]);
    });

    it('accepts an explicit null on a secret field', async () => {
      const dto = wa({ phoneNumberId: '123', accessToken: null });
      expect(await validate(dto, VALIDATION_OPTIONS)).toEqual([]);
    });

    it('still rejects a non-string, non-null value on a secret field', async () => {
      const errors = await validate(
        wa({ phoneNumberId: '1', accessToken: 42 }),
        VALIDATION_OPTIONS,
      );
      expect(msg(commError(errors, 'whatsapp'))).toContain('accessToken must be text.');
    });

    it('rejects an empty string on a secret field with the D31 sentence', async () => {
      // '' is what a controlled input produces when a user clears a populated password field.
      const errors = await validate(
        wa({ phoneNumberId: '1', accessToken: '' }),
        VALIDATION_OPTIONS,
      );
      expect(msg(commError(errors, 'whatsapp'))).toContain(
        'accessToken must not be empty: leave it out to keep the saved value, or send null to clear it.',
      );
    });

    it('still requires a non-secret field even when the secret is omitted', async () => {
      const errors = await validate(wa({}), VALIDATION_OPTIONS);
      expect(msg(commError(errors, 'whatsapp'))).toContain(
        'missing the required field phoneNumberId',
      );
    });

    it('accepts the old flat shape for a sole-provider medium', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { whatsapp: { phoneNumberId: '1', accessToken: 'x' } },
      });
      expect(await validate(dto, VALIDATION_OPTIONS)).toEqual([]);
    });
  });

  // [17.2.3] `region.country` (D11) and `region.calendar.termLabel`.
  describe('region — country and calendar', () => {
    it('accepts the default region, which already carries country + calendar.termLabel', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: DEFAULT_REGION_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'region')).toBeUndefined();
    });

    // Chosen behaviour, documented here rather than left ambiguous: a
    // lowercase code is rejected outright, not silently upper-cased. See
    // the comment on `RegionSettingsDto.country` for why one decorator
    // (`@IsISO31661Alpha2`) alone would not be enough.
    it('rejects a lowercase country code instead of normalising it', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: { ...DEFAULT_REGION_SETTINGS, country: 'bd' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      expect(regionError?.children?.some((e) => e.property === 'country')).toBe(true);
    });

    it('rejects a country code that is not a real ISO 3166-1 alpha-2 code', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: { ...DEFAULT_REGION_SETTINGS, country: 'ZZ' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      expect(regionError?.children?.some((e) => e.property === 'country')).toBe(true);
    });

    it('rejects a calendar.termLabel outside the TermLabel enum', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          calendar: { termLabel: 'QUARTER' },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const regionError = errors.find((e) => e.property === 'region');
      const calendarError = regionError?.children?.find((e) => e.property === 'calendar');
      expect(calendarError?.children?.some((e) => e.property === 'termLabel')).toBe(true);
    });

    it('still accepts region with calendar omitted — it is optional', async () => {
      const { calendar: _calendar, ...regionWithoutCalendar } = DEFAULT_REGION_SETTINGS;
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: regionWithoutCalendar,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'region')).toBeUndefined();
    });
  });

  describe('attendance', () => {
    it('accepts a full valid attendance section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: DEFAULT_ATTENDANCE_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'attendance')).toBeUndefined();
    });

    describe('shiftTimes / periodAttendance', () => {
      const SHIFT = '6b1f3c1e-5d2a-4c8e-9a47-1f2e3d4c5b6a';
      const entry = { shiftId: SHIFT, lateAfter: '12:15', absentAfter: '14:00' };
      const run = async (patch: Record<string, unknown>) => {
        const dto = toDto({
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, ...patch },
        });
        const errors = await validate(dto, VALIDATION_OPTIONS);
        return errors.find((e) => e.property === 'attendance');
      };

      it('accepts a valid entry and the period switch', async () => {
        expect(
          await run({ shiftTimes: [entry], periodAttendance: { enabled: true } }),
        ).toBeUndefined();
      });
      it('rejects a bad time', async () => {
        expect(await run({ shiftTimes: [{ ...entry, lateAfter: '25:00' }] })).toBeDefined();
      });
      it('rejects a non-uuid shiftId', async () => {
        expect(await run({ shiftTimes: [{ ...entry, shiftId: 'nope' }] })).toBeDefined();
      });
      it('rejects a duplicate shiftId', async () => {
        expect(await run({ shiftTimes: [entry, entry] })).toBeDefined();
      });
      it('rejects 21 entries', async () => {
        const many = Array.from({ length: 21 }, (_, i) => ({
          ...entry,
          shiftId: `6b1f3c1e-5d2a-4c8e-9a47-1f2e3d4c5b${String(i).padStart(2, '0')}`,
        }));
        expect(await run({ shiftTimes: many })).toBeDefined();
      });
    });

    describe('specialTimings', () => {
      const SHIFT = '6b1f3c1e-5d2a-4c8e-9a47-1f2e3d4c5b6a';
      const OTHER = '7c2f4d2f-6e3b-4d9f-8b58-2a3f4e5d6c7b';
      const t = {
        name: 'Ramadan',
        from: '2027-02-08',
        to: '2027-03-09',
        shiftId: null,
        lateAfter: '08:45',
        absentAfter: '09:30',
        periods: [{ sequence: 1, startsAt: '08:30', endsAt: '09:05' }],
      };
      const run = async (specialTimings: unknown[]) => {
        const errors = await validate(
          toDto({
            version: TENANT_SETTINGS_SCHEMA_VERSION,
            attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, specialTimings },
          }),
          VALIDATION_OPTIONS,
        );
        return errors.find((e) => e.property === 'attendance');
      };

      it('accepts a valid list', async () => {
        expect(await run([t])).toBeUndefined();
      });
      // A period grid may start at 0 (PeriodSlotItemDto allows it), so its first period
      // must be overridable; a negative sequence is still refused.
      it('accepts sequence 0 and rejects -1', async () => {
        const at = (sequence: number) => [
          { ...t, periods: [{ sequence, startsAt: '08:30', endsAt: '09:05' }] },
        ];
        expect(await run(at(0))).toBeUndefined();
        expect(await run(at(-1))).toBeDefined();
      });
      it('rejects from > to', async () => {
        expect(await run([{ ...t, from: '2027-03-10' }])).toBeDefined();
      });
      it('rejects startsAt >= endsAt', async () => {
        expect(
          await run([{ ...t, periods: [{ sequence: 1, startsAt: '09:05', endsAt: '09:05' }] }]),
        ).toBeDefined();
      });
      it('rejects two overlapping all-shift entries', async () => {
        expect(await run([t, { ...t, from: '2027-03-09', to: '2027-03-20' }])).toBeDefined();
      });
      it('rejects a duplicate sequence', async () => {
        const p = { sequence: 1, startsAt: '08:30', endsAt: '09:05' };
        expect(await run([{ ...t, periods: [p, p] }])).toBeDefined();
      });
      it('accepts overlapping entries for different shifts', async () => {
        expect(
          await run([
            { ...t, shiftId: SHIFT },
            { ...t, shiftId: OTHER },
          ]),
        ).toBeUndefined();
      });
      // The two boundaries a later `<` -> `<=` slip would break.
      it('accepts adjacent entries (one ends the day before the next starts)', async () => {
        expect(await run([t, { ...t, from: '2027-03-10', to: '2027-03-20' }])).toBeUndefined();
      });
      it('accepts a one-day entry (from == to)', async () => {
        expect(await run([{ ...t, from: '2027-02-08', to: '2027-02-08' }])).toBeUndefined();
      });
      it('rejects an empty name', async () => {
        expect(await run([{ ...t, name: '' }])).toBeDefined();
      });
      // A throw inside a constraint becomes a 500; malformed input must be a 400.
      it('rejects malformed elements with a validation error, not a throw', async () => {
        expect(await run([null])).toBeDefined();
        expect(await run([{ ...t, periods: 'x' }])).toBeDefined();
        expect(await run([{ ...t, periods: {} }])).toBeDefined();
        expect(await run([{ ...t, periods: [null] }])).toBeDefined();
      });
    });

    it('rejects a weeklyOffDays entry outside 0-6', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, weeklyOffDays: [7] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(attendanceError?.children?.some((e) => e.property === 'weeklyOffDays')).toBe(true);
    });

    it('rejects a lateAfter value outside HH:mm', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, lateAfter: '25:00' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(attendanceError?.children?.some((e) => e.property === 'lateAfter')).toBe(true);
    });

    it('rejects a lowAttendanceThresholdPercent above 100', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, lowAttendanceThresholdPercent: 101 },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const attendanceError = errors.find((e) => e.property === 'attendance');
      expect(
        attendanceError?.children?.some((e) => e.property === 'lowAttendanceThresholdPercent'),
      ).toBe(true);
    });
  });

  describe('auth', () => {
    it('accepts a valid auth section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        auth: DEFAULT_AUTH_SETTINGS,
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'auth')).toBeUndefined();
    });

    it('rejects a non-boolean otpLoginEnabled', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        auth: { otpLoginEnabled: 'yes' },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const authError = errors.find((e) => e.property === 'auth');
      expect(authError?.children?.some((e) => e.property === 'otpLoginEnabled')).toBe(true);
    });
  });

  // [15.6/#508 D5] `sms.metering` — absent ⇒ OFF (unmetered, today's
  // behaviour). Only #545 (this schema); #546/#547 wire up the metering
  // itself.
  describe('sms.metering', () => {
    const sms = (extra: Record<string, unknown>) =>
      toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        communications: { sms: { provider: 'alpha', alpha: ALPHA, ...extra } },
      });

    it('accepts an sms section with no metering key at all', async () => {
      expect(await validate(sms({}), VALIDATION_OPTIONS)).toEqual([]);
    });

    it('accepts metering: OFF and metering: PLATFORM', async () => {
      for (const metering of ['OFF', 'PLATFORM']) {
        expect(await validate(sms({ metering }), VALIDATION_OPTIONS)).toEqual([]);
      }
    });

    it('rejects a metering value outside OFF/PLATFORM, and null', async () => {
      for (const metering of ['BOGUS', null]) {
        const errors = await validate(sms({ metering }), VALIDATION_OPTIONS);
        expect(msg(commError(errors, 'sms'))).toBe(
          'communications.sms metering must be OFF or PLATFORM.',
        );
      }
    });
  });

  // [16.2.1] `settings.fees` — who may approve, and how, is data.
  describe('fees', () => {
    it('accepts a valid fees section', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'OTP_OR_PASSWORD',
          notifyOnManualGenerationDefault: true,
          notifyOnScheduleDefault: false,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'fees')).toBeUndefined();
    });

    it('rejects an invalid approvalMode', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'BOGUS',
          notifyOnManualGenerationDefault: false,
          notifyOnScheduleDefault: true,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const feesError = errors.find((e) => e.property === 'fees');
      expect(feesError?.children?.some((e) => e.property === 'approvalMode')).toBe(true);
    });

    it('rejects a non-boolean notifyOnManualGenerationDefault/notifyOnScheduleDefault', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        fees: {
          approvalMode: 'OTP',
          notifyOnManualGenerationDefault: 'yes',
          notifyOnScheduleDefault: 'no',
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const feesError = errors.find((e) => e.property === 'fees');
      expect(
        feesError?.children?.some((e) => e.property === 'notifyOnManualGenerationDefault'),
      ).toBe(true);
      expect(feesError?.children?.some((e) => e.property === 'notifyOnScheduleDefault')).toBe(true);
    });

    describe('lateFees', () => {
      function feesWithLateFees(lateFees: unknown): Record<string, unknown> {
        return {
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          fees: {
            approvalMode: 'OTP',
            notifyOnManualGenerationDefault: false,
            notifyOnScheduleDefault: false,
            lateFees,
          },
        };
      }

      it('accepts a valid lateFees map', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        expect(errors.find((e) => e.property === 'fees')).toBeUndefined();
      });

      it('[CodeRabbit review, PR #801] rejects a fractional grace_days', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 1.5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });

      it('rejects grace_days outside 0-60', async () => {
        const dto = toDto(
          feesWithLateFees({
            MONTHLY_TUITION: { enabled: true, grace_days: 61, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });

      it('rejects an unknown fee type key', async () => {
        const dto = toDto(
          feesWithLateFees({
            NOT_A_REAL_FEE_TYPE: { enabled: true, grace_days: 5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });

      it('[Epic 38 D10] rejects a FINE key in lateFees — a fine never gets a late fee', async () => {
        const dto = toDto(
          feesWithLateFees({
            FINE: { enabled: true, grace_days: 5, kind: 'FLAT', value: 100 },
          }),
        );

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'lateFees')).toBe(true);
      });
    });

    describe('fineDueDays', () => {
      function feesWithFineDueDays(fineDueDays: unknown): Record<string, unknown> {
        return {
          version: TENANT_SETTINGS_SCHEMA_VERSION,
          fees: {
            approvalMode: 'OTP',
            notifyOnManualGenerationDefault: false,
            notifyOnScheduleDefault: false,
            fineDueDays,
          },
        };
      }

      it('[Epic 38 D10] rejects fineDueDays: 0', async () => {
        const dto = toDto(feesWithFineDueDays(0));

        const errors = await validate(dto, VALIDATION_OPTIONS);

        const feesError = errors.find((e) => e.property === 'fees');
        expect(feesError?.children?.some((e) => e.property === 'fineDueDays')).toBe(true);
      });

      it('[Epic 38 D10] accepts a valid fineDueDays', async () => {
        const dto = toDto(feesWithFineDueDays(14));

        const errors = await validate(dto, VALIDATION_OPTIONS);

        expect(errors.find((e) => e.property === 'fees')).toBeUndefined();
      });

      it('[Epic 38 D10] default resolves to 7 when omitted', () => {
        expect(DEFAULT_FEES_SETTINGS.fineDueDays).toBe(7);
      });
    });
  });

  describe('documents (48.1.03)', () => {
    const errorsFor = async (documents: unknown) => {
      const errors = await validate(
        toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, documents }),
        VALIDATION_OPTIONS,
      );
      return errors.find((e) => e.property === 'documents');
    };

    it('accepts a valid serialPrefix and flag', async () => {
      expect(
        await errorsFor({ serialPrefix: 'DAHS', withholdAdmitCardForDues: true }),
      ).toBeUndefined();
    });

    it('rejects a malformed serialPrefix', async () => {
      for (const serialPrefix of ['da', 'A', 'DAHS-1']) {
        expect(await errorsFor({ serialPrefix })).toBeDefined();
      }
    });

    it('rejects a non-boolean withholdAdmitCardForDues', async () => {
      expect(await errorsFor({ withholdAdmitCardForDues: 'yes' })).toBeDefined();
    });
  });

  describe('studyPlans [66.1.04]', () => {
    const withPlans = (studyPlans: unknown) =>
      toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, studyPlans });
    const planErr = async (studyPlans: unknown) =>
      (await validate(withPlans(studyPlans), VALIDATION_OPTIONS)).find(
        (e) => e.property === 'studyPlans',
      );

    it('accepts a full block and each field alone', async () => {
      const full = {
        statusDeadline: '17:30',
        reminderTime: '08:15',
        escalateAfterSchoolDays: 3,
        weeklyDigestTime: '16:00',
        guardianDigestSms: true,
      };
      expect(await planErr(full)).toBeUndefined();
      for (const [k, v] of Object.entries(full)) {
        expect(await planErr({ [k]: v })).toBeUndefined();
      }
    });

    it('rejects bad HH:mm on each time field', async () => {
      for (const field of ['statusDeadline', 'reminderTime', 'weeklyDigestTime']) {
        for (const bad of ['25:00', '6pm']) {
          expect(await planErr({ [field]: bad })).toBeDefined();
        }
      }
    });

    it('rejects escalateAfterSchoolDays outside 1..10 or non-integer', async () => {
      for (const bad of [0, 11, 1.5]) {
        expect(await planErr({ escalateAfterSchoolDays: bad })).toBeDefined();
      }
    });

    it('rejects a non-boolean guardianDigestSms and unknown keys', async () => {
      expect(await planErr({ guardianDigestSms: 'yes' })).toBeDefined();
      expect(await planErr({ bogus: 1 })).toBeDefined();
    });

    it('rejects an explicit null on each field', async () => {
      for (const field of [
        'statusDeadline',
        'reminderTime',
        'escalateAfterSchoolDays',
        'weeklyDigestTime',
        'guardianDigestSms',
      ]) {
        expect(await planErr({ [field]: null })).toBeDefined();
      }
    });
  });

  describe('evaluations', () => {
    const withEvaluations = (evaluations: unknown) =>
      toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, evaluations });

    it('[28.2.1] accepts incidentSmsEnabled true/false and an omitted value', async () => {
      for (const evaluations of [{ incidentSmsEnabled: true }, { incidentSmsEnabled: false }, {}]) {
        const errors = await validate(withEvaluations(evaluations), VALIDATION_OPTIONS);
        expect(errors.find((e) => e.property === 'evaluations')).toBeUndefined();
      }
    });

    it('[28.2.1] rejects a non-boolean incidentSmsEnabled', async () => {
      const errors = await validate(
        withEvaluations({ incidentSmsEnabled: 'yes' }),
        VALIDATION_OPTIONS,
      );
      const err = errors.find((e) => e.property === 'evaluations');
      expect(err?.children?.some((e) => e.property === 'incidentSmsEnabled')).toBe(true);
    });
  });

  describe('applications', () => {
    const withApplications = (applications: unknown) =>
      toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, applications });

    it('[52.2.6] accepts smsOnDecision true/false and an omitted value', async () => {
      for (const applications of [{ smsOnDecision: true }, { smsOnDecision: false }, {}]) {
        const errors = await validate(withApplications(applications), VALIDATION_OPTIONS);
        expect(errors.find((e) => e.property === 'applications')).toBeUndefined();
      }
    });

    it('[52.2.6] rejects a non-boolean smsOnDecision', async () => {
      const errors = await validate(withApplications({ smsOnDecision: 'yes' }), VALIDATION_OPTIONS);
      const err = errors.find((e) => e.property === 'applications');
      expect(err?.children?.some((e) => e.property === 'smsOnDecision')).toBe(true);
    });
  });

  describe('homework [TIME-11]', () => {
    const withHomework = (homework: unknown) =>
      toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, homework });

    it('accepts the two booleans and an empty block', async () => {
      for (const homework of [{ notifyOnAssign: true, notifyDefaulters: false }, {}]) {
        const errors = await validate(withHomework(homework), VALIDATION_OPTIONS);
        expect(errors.find((e) => e.property === 'homework')).toBeUndefined();
      }
    });

    it('rejects a string value and an unknown key', async () => {
      for (const homework of [{ notifyOnAssign: 'yes' }, { notifyEveryone: true }]) {
        const errors = await validate(withHomework(homework), VALIDATION_OPTIONS);
        expect(errors.some((e) => e.property === 'homework')).toBe(true);
      }
    });
  });

  // `organisation.{shifts,versions,groups}` (33.1.1) — a tenant's own
  // vocabulary for shift/version/group. Same validation on all three lists.
  it('rejects a body containing preset (35.1.2, D37)', async () => {
    const dto = toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, preset: { id: 'x' } });
    const errors = await validate(dto, VALIDATION_OPTIONS);
    expect(errors.some((e) => e.property === 'preset')).toBe(true);
  });

  describe('organisation', () => {
    it('accepts a fully-specified organisation block', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: ['Morning', 'Day'], versions: ['Bangla'], groups: ['A', 'B'] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'organisation')).toBeUndefined();
    });

    it('rejects an empty-string entry', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: [''], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'shifts')).toBe(true);
    });

    it('rejects an entry over 50 characters', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: ['x'.repeat(51)], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'shifts')).toBe(true);
    });

    it('accepts an entry at exactly 50 characters', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: ['x'.repeat(50)], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'organisation')).toBeUndefined();
    });

    it('rejects a case-insensitive duplicate', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: ['Morning', 'morning'], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'shifts')).toBe(true);
    });

    it('rejects more than 20 entries', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: {
          shifts: Array.from({ length: 21 }, (_, i) => `Shift ${i}`),
          versions: [],
          groups: [],
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'shifts')).toBe(true);
    });

    it('rejects a non-trimmed entry', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: [' Morning '], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'shifts')).toBe(true);
    });

    it('accepts empty lists (the default)', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: [], versions: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'organisation')).toBeUndefined();
    });

    it('rejects an incomplete organisation block (missing versions)', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        organisation: { shifts: [], groups: [] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const orgError = errors.find((e) => e.property === 'organisation');
      expect(orgError?.children?.some((e) => e.property === 'versions')).toBe(true);
    });
  });

  describe('routine', () => {
    it('accepts a fully-specified routine block', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: {
          defaultChangeoverMinutes: 5,
          maxPeriodsPerTeacherPerDay: 6,
          maxConsecutivePeriods: 3,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'routine')).toBeUndefined();
    });

    it('accepts a routine block with the caps left unset', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: { defaultChangeoverMinutes: 5 },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'routine')).toBeUndefined();
    });

    it('accepts a routine block with the caps explicitly null', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: {
          defaultChangeoverMinutes: 5,
          maxPeriodsPerTeacherPerDay: null,
          maxConsecutivePeriods: null,
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'routine')).toBeUndefined();
    });

    it('rejects a negative changeover', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: { defaultChangeoverMinutes: -1 },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const routineError = errors.find((e) => e.property === 'routine');
      expect(routineError?.children?.some((e) => e.property === 'defaultChangeoverMinutes')).toBe(
        true,
      );
    });

    it('rejects a zero or negative maxPeriodsPerTeacherPerDay', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: { defaultChangeoverMinutes: 5, maxPeriodsPerTeacherPerDay: 0 },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const routineError = errors.find((e) => e.property === 'routine');
      expect(routineError?.children?.some((e) => e.property === 'maxPeriodsPerTeacherPerDay')).toBe(
        true,
      );
    });

    it('accepts a subjectPeriodsPerWeek map', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: {
          defaultChangeoverMinutes: 5,
          subjectPeriodsPerWeek: { 'subject-math': 6, 'subject-english': 5 },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      expect(errors.find((e) => e.property === 'routine')).toBeUndefined();
    });

    it('rejects a non-positive subjectPeriodsPerWeek value', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: {
          defaultChangeoverMinutes: 5,
          subjectPeriodsPerWeek: { 'subject-math': 0 },
        },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const routineError = errors.find((e) => e.property === 'routine');
      expect(routineError?.children?.some((e) => e.property === 'subjectPeriodsPerWeek')).toBe(
        true,
      );
    });

    it('rejects a subjectPeriodsPerWeek that is an array, not a map', async () => {
      const dto = toDto({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        routine: { defaultChangeoverMinutes: 5, subjectPeriodsPerWeek: [1, 2, 3] },
      });

      const errors = await validate(dto, VALIDATION_OPTIONS);

      const routineError = errors.find((e) => e.property === 'routine');
      expect(routineError?.children?.some((e) => e.property === 'subjectPeriodsPerWeek')).toBe(
        true,
      );
    });
  });

  describe('attention [67.1.06]', () => {
    const attErr = async (attention: unknown) =>
      (
        await validate(
          toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, attention }),
          VALIDATION_OPTIONS,
        )
      ).find((e) => e.property === 'attention');

    it('accepts {} and the full defaults object', async () => {
      expect(await attErr({})).toBeUndefined();
      expect(await attErr({ ...DEFAULT_ATTENTION_SETTINGS })).toBeUndefined();
    });

    it('rejects bad time, partial quietHours, out-of-range minutes', async () => {
      expect(await attErr({ dailyAt: '7:00' })).toBeDefined();
      expect(await attErr({ quietHours: { start: '21:00' } })).toBeDefined();
      expect(await attErr({ attendanceGraceMinutes: 121 })).toBeDefined();
    });

    it('rejects switching off a non-disableable rule (D34)', async () => {
      expect(await attErr({ rules: { 'attendance.not_taken': { enabled: false } } })).toBeDefined();
      expect(await attErr({ rules: { 'system.backup_failed': { enabled: false } } })).toBeDefined();
    });
  });

  describe('dashboard [8.10.7]', () => {
    const dashErr = async (dashboard: unknown) =>
      (
        await validate(
          toDto({ version: TENANT_SETTINGS_SCHEMA_VERSION, dashboard }),
          VALIDATION_OPTIONS,
        )
      ).find((e) => e.property === 'dashboard');

    it('accepts a full block, {}, a lone digestTime, a lone risk field', async () => {
      expect(
        await dashErr({
          risk: {
            absentStreakDays: 4,
            monthlyAttendancePct: 80,
            failedSubjects: 1,
            overdueDays: 45,
          },
          committeeAttendanceTargetPct: 92,
          digestTime: '07:15',
        }),
      ).toBeUndefined();
      expect(await dashErr({})).toBeUndefined();
      expect(await dashErr({ digestTime: '00:00' })).toBeUndefined();
      expect(await dashErr({ risk: { overdueDays: 365 } })).toBeUndefined();
    });

    it.each([
      ['absentStreakDays 0', { risk: { absentStreakDays: 0 } }],
      ['monthlyAttendancePct 101', { risk: { monthlyAttendancePct: 101 } }],
      ['failedSubjects 1.5', { risk: { failedSubjects: 1.5 } }],
      ['target -1', { committeeAttendanceTargetPct: -1 }],
      ['digestTime 7:30', { digestTime: '7:30' }],
      ['digestTime 24:00', { digestTime: '24:00' }],
      ['digestTime 07:30:00', { digestTime: '07:30:00' }],
      ['unknown risk field', { risk: { colour: 1 } }],
    ])('rejects %s', async (_n, block) => {
      expect(await dashErr(block)).toBeDefined();
    });
  });
});
