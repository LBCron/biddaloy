import { describe, expect, it } from 'vitest';
import { School } from '../../../schools/entities/school.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import {
  deepMergePresent,
  mergeImportedSettings,
  schoolTab,
  stripSecretPaths,
  type SchoolRow,
} from './school.tab';
import { schoolTabs } from './index';

const SCHOOL_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const SECRET = 'super-secret-sms-key';

const exportCtx: ExportContext = { keyOf: () => '' };
const importCtx: ImportContext = {
  tenantId: SCHOOL_ID,
  ref: () => undefined,
  warn: () => undefined,
};

function makeSchool(overrides: Partial<School> = {}): School {
  return Object.assign(new School(), {
    id: SCHOOL_ID,
    name: 'Dhaka Model High School',
    slug: 'dhaka-model',
    address: '12 Green Road, Dhaka',
    phone: '01712345678',
    email: 'office@dhaka-model.test',
    name_bn: 'ঢাকা মডেল উচ্চ বিদ্যালয়',
    registration_id: 'EIIN-108234',
    country_code: 'BD',
    logo_key: 'schools/dhaka-model/logo.png',
    settings: null,
    status: 'ACTIVE',
    status_reason: null,
    status_changed_at: null,
    ...overrides,
  } satisfies Partial<School>);
}

/**
 * The real pipeline, both directions: `toRow` then `toCell` on the way out
 * (what writeWorkbook does), then `cellText` on the way back in (what
 * readWorkbook's readSheet does). Including the read side is what makes these
 * round-trip tests honest about what a restore actually sees.
 */
function toCells(school: School): Record<string, string> {
  const row = schoolTab.toRow(school, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of schoolTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('schoolTab shape', () => {
  it('is registered through the school barrel', () => {
    expect(schoolTabs).toEqual([schoolTab]);
  });

  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([schoolTab])).not.toThrow();
  });

  it('is a single-row tab that a restore never deletes', () => {
    expect(schoolTab.name).toBe('school');
    expect(schoolTab.dependsOn).toEqual([]);
    expect(schoolTab.naturalKey).toEqual(['name']);
    expect(schoolTab.deleteByAbsence).toBe(false);
  });

  it('keys a school by its name', () => {
    expect(schoolTab.keyOf(makeSchool())).toBe('Dhaka Model High School');
  });
});

describe('round trip', () => {
  it('returns equivalent values through toRow then fromRow', () => {
    const school = makeSchool({ settings: { region: { timezone: 'Asia/Dhaka' } } });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: SCHOOL_ID,
        name: 'Dhaka Model High School',
        name_bn: 'ঢাকা মডেল উচ্চ বিদ্যালয়',
        address: '12 Green Road, Dhaka',
        phone: '01712345678',
        email: 'office@dhaka-model.test',
        registration_id: 'EIIN-108234',
        country_code: 'BD',
        settings: { region: { timezone: 'Asia/Dhaka' } },
      } satisfies SchoolRow,
    });
  });

  it('round-trips a school whose optional fields are all empty', () => {
    const school = makeSchool({
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      registration_id: null,
      country_code: null,
      settings: null,
    });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: SCHOOL_ID,
        name: 'Dhaka Model High School',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        country_code: null,
        settings: null,
      } satisfies SchoolRow,
    });
  });

  it('upper-cases a lowercase country_code', () => {
    const cells = { ...toCells(makeSchool()), country_code: 'bd' };
    const result = schoolTab.fromRow(cells, 2, importCtx);
    expect(result).toHaveProperty('row.country_code', 'BD');
  });

  it('rejects a country_code that is not two capital letters', () => {
    const cells = { ...toCells(makeSchool()), country_code: 'bangladesh' };
    const result = schoolTab.fromRow(cells, 2, importCtx);
    expect(result).toHaveProperty('errors');
  });

  // A school must not be able to raise its own limits or reopen setup by editing a file.
  it('exposes no seat_limit, trial_ends_at or onboarding column', () => {
    const keys = schoolTab.columns.map((c) => c.key);
    for (const forbidden of ['seat_limit', 'trial_ends_at', 'onboarding']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  // Business-critical for a Bangla-first product: a school name containing
  // Bengali numerals must survive a backup unchanged. The generic cell
  // normaliser maps ৫ to 5, which is right for a phone number and wrong for
  // a name, so the mapping happens per column type in fromCell instead.
  it('preserves Bengali digits in prose columns', () => {
    const school = makeSchool({
      name: '৫ নম্বর সরকারি প্রাথমিক বিদ্যালয়',
      address: '১২ গ্রিন রোড, ঢাকা',
    });

    const result = schoolTab.fromRow(toCells(school), 2, importCtx);

    expect(result).toMatchObject({
      row: {
        name: '৫ নম্বর সরকারি প্রাথমিক বিদ্যালয়',
        address: '১২ গ্রিন রোড, ঢাকা',
      },
    });
  });

  it('rejects a settings cell that is not a JSON object', () => {
    for (const bad of ['"hello"', '[1,2]', '5', 'true']) {
      const cells = { ...toCells(makeSchool()), settings: bad };
      const result = schoolTab.fromRow(cells, 2, importCtx);

      expect('errors' in result, `expected ${bad} to be rejected`).toBe(true);
      if (!('errors' in result)) continue;
      expect(result.errors[0].column).toBe('settings');
    }
  });

  it('rejects a value longer than the column allows rather than failing at save', () => {
    const cells = { ...toCells(makeSchool()), phone: '01712345678 / 01812345678' };

    const result = schoolTab.fromRow(cells, 2, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('phone');
    expect(result.errors[0].message).toContain('20 characters');
  });

  it('collects an error naming the column when a required cell is empty', () => {
    const cells = toCells(makeSchool());
    cells.name = '';

    const result = schoolTab.fromRow(cells, 4, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].column).toBe('name');
    expect(result.errors[0].row).toBe(4);
    expect(result.errors[0].tab).toBe('school');
  });
});

describe('secret handling on export', () => {
  // The real `@Secret()` path in TenantSettingsDto is nested under the
  // provider: communications.sms.mimsms.apiKey (the ticket's "sms.apiKey" is
  // shorthand). Driving off getSecretPaths means this keeps working when the
  // schema gains another credential.
  const withSecret = {
    region: { timezone: 'Asia/Dhaka' },
    communications: {
      sms: { provider: 'mimsms', mimsms: { apiKey: SECRET, senderId: 'BIDDALOY' } },
    },
  };

  it('does not put a secret value in the exported JSON', () => {
    const cells = toCells(makeSchool({ settings: withSecret }));

    expect(cells.settings).not.toContain(SECRET);
    // The non-secret siblings must survive.
    expect(cells.settings).toContain('BIDDALOY');
    expect(cells.settings).toContain('Asia/Dhaka');
  });

  it('removes the secret key rather than masking it', () => {
    // A [REDACTED] marker would merge back over the destination's real
    // credential on import and break its SMS integration.
    const stripped = stripSecretPaths(withSecret);

    expect(stripped).toEqual({
      region: { timezone: 'Asia/Dhaka' },
      communications: { sms: { provider: 'mimsms', mimsms: { senderId: 'BIDDALOY' } } },
    });
    expect(JSON.stringify(stripped)).not.toContain('REDACTED');
  });

  it('strips every provider credential, not just the sms one', () => {
    const stripped = stripSecretPaths({
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: SECRET },
        email: { host: 'smtp.test', password: SECRET },
        messenger: { pageId: '456', accessToken: SECRET },
      },
    });

    expect(JSON.stringify(stripped)).not.toContain(SECRET);
    expect(stripped).toEqual({
      communications: {
        whatsapp: { phoneNumberId: '123' },
        email: { host: 'smtp.test' },
        messenger: { pageId: '456' },
      },
    });
  });

  it('leaves the source object untouched', () => {
    stripSecretPaths(withSecret);

    expect(withSecret.communications.sms.mimsms.apiKey).toBe(SECRET);
  });
});

// Epic 97 D6: a backup may hold the old flat settings or the per-provider blob. Both export, read back
// and keep every non-secret field; neither ever carries a secret out.
describe('messaging settings round trip (flat and D6 blobs)', () => {
  const roundTrip = (settings: Record<string, unknown>) =>
    (schoolTab.fromRow(toCells(makeSchool({ settings })), 2, importCtx) as { row: SchoolRow }).row
      .settings;

  it('an old flat WhatsApp / email blob keeps its non-secret fields and drops the secrets', () => {
    const out = roundTrip({
      communications: {
        whatsapp: { phoneNumberId: '123', accessToken: SECRET },
        email: { host: 'smtp.test', user: 'u', password: SECRET, from: 'a@b.test' },
      },
    });

    expect(out).toEqual({
      communications: {
        whatsapp: { phoneNumberId: '123' },
        email: { host: 'smtp.test', user: 'u', from: 'a@b.test' },
      },
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('a D6 blob keeps provider, metering and non-secret fields and drops every secret', () => {
    const out = roundTrip({
      communications: {
        sms: {
          provider: 'onecodesoft',
          onecodesoft: { apiKey: SECRET, senderId: 'BMSC', apiUrl: 'https://sms.test/api' },
          metering: 'PLATFORM',
        },
        whatsapp: {
          provider: 'meta-cloud',
          'meta-cloud': { phoneNumberId: '123', accessToken: SECRET },
        },
        email: { provider: 'smtp', smtp: { host: 'smtp.test', password: SECRET } },
        messenger: { provider: 'meta-page', 'meta-page': { pageId: '456', accessToken: SECRET } },
      },
    });

    expect(out).toEqual({
      communications: {
        sms: {
          provider: 'onecodesoft',
          onecodesoft: { senderId: 'BMSC', apiUrl: 'https://sms.test/api' },
          metering: 'PLATFORM',
        },
        whatsapp: { provider: 'meta-cloud', 'meta-cloud': { phoneNumberId: '123' } },
        email: { provider: 'smtp', smtp: { host: 'smtp.test' } },
        messenger: { provider: 'meta-page', 'meta-page': { pageId: '456' } },
      },
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});

describe('deepMergePresent', () => {
  // Business-critical: an imported settings object never carries secrets
  // (export strips them), so a merge that only overwrites present keys is
  // what keeps the destination's stored credentials alive.
  it('keeps an existing secret that the incoming object does not mention', () => {
    const existing = {
      communications: { sms: { mimsms: { apiKey: SECRET, senderId: 'OLD' } } },
    };
    const incoming = {
      communications: { sms: { mimsms: { senderId: 'NEW' } } },
    };

    expect(deepMergePresent(existing, incoming)).toEqual({
      communications: { sms: { mimsms: { apiKey: SECRET, senderId: 'NEW' } } },
    });
  });

  it('returns the existing settings unchanged when nothing is imported', () => {
    const existing = { communications: { sms: { mimsms: { apiKey: SECRET } } } };

    expect(deepMergePresent(existing, null)).toEqual(existing);
  });

  it('builds from scratch when there are no existing settings', () => {
    expect(deepMergePresent(null, { region: { timezone: 'Asia/Dhaka' } })).toEqual({
      region: { timezone: 'Asia/Dhaka' },
    });
  });

  it('replaces a non-object value rather than merging into it', () => {
    expect(deepMergePresent({ a: 'old' }, { a: 'new' })).toEqual({ a: 'new' });
  });
});

describe('diffFields', () => {
  it('names only the profile fields that actually changed', () => {
    const existing = makeSchool();
    const row = schoolTab.fromRow(toCells(existing), 2, importCtx);
    if ('errors' in row) throw new Error('fixture should parse');

    expect(schoolTab.diffFields(row.row, existing)).toEqual([]);

    expect(schoolTab.diffFields({ ...row.row, phone: '01999999999' }, existing)).toEqual(['phone']);
  });

  // Regression: `name` must never appear here — `upsert` never applies it
  // (see the tab's own comment), so reporting it would show the admin a
  // pending change that a restore would not actually make.
  it('never reports a name change, even when the row carries a different name', () => {
    const existing = makeSchool();
    const row = schoolTab.fromRow(toCells(existing), 2, importCtx);
    if ('errors' in row) throw new Error('fixture should parse');

    expect(
      schoolTab.diffFields({ ...row.row, name: 'A Completely Different Name' }, existing),
    ).toEqual([]);
  });

  // Must mirror upsert's stripSecretPaths: otherwise the preview shown before
  // a restore would report a 'settings' change that upsert then discards.
  it('does not report a settings change from an imported secret alone', () => {
    const existing = makeSchool({
      settings: { communications: { sms: { mimsms: { apiKey: SECRET, senderId: 'OLD' } } } },
    });
    const row: SchoolRow = {
      id: existing.id,
      name: existing.name,
      name_bn: existing.name_bn,
      address: existing.address,
      phone: existing.phone,
      email: existing.email,
      registration_id: existing.registration_id,
      country_code: existing.country_code,
      settings: { communications: { sms: { mimsms: { apiKey: 'attacker-supplied' } } } },
    };

    expect(schoolTab.diffFields(row, existing)).toEqual([]);
  });
});

// Review round 2, item 1: a school stored flat (pre-D6) WhatsApp credentials, and the workbook
// carries the nested D6 blob. Without lifting the stored side first, the merge keeps both shapes:
// the resolver reads the nested block, never finds the stored token, and every send is REJECTED.
describe('upsert: flat-stored messaging settings + a nested import', () => {
  const manager = {
    save: async (_entity: unknown, school: School) => school,
  } as unknown as Parameters<typeof schoolTab.upsert>[3];

  const nestedImport = (existing: School): SchoolRow => ({
    ...(schoolTab.fromRow(toCells(existing), 2, importCtx) as { row: SchoolRow }).row,
    settings: {
      communications: {
        whatsapp: { provider: 'meta-cloud', 'meta-cloud': { phoneNumberId: 'NEW' } },
      },
    },
  });

  it('lifts the stored flat block so the stored token sits next to the imported fields', async () => {
    const existing = makeSchool({
      settings: { communications: { whatsapp: { phoneNumberId: 'OLD', accessToken: SECRET } } },
    });

    const saved = await schoolTab.upsert(nestedImport(existing), existing, SCHOOL_ID, manager);

    expect(saved.settings).toEqual({
      communications: {
        whatsapp: {
          provider: 'meta-cloud',
          'meta-cloud': { phoneNumberId: 'NEW', accessToken: SECRET },
        },
      },
    });
  });

  it('the diff preview reports the same change upsert makes', () => {
    const existing = makeSchool({
      settings: { communications: { whatsapp: { phoneNumberId: 'OLD', accessToken: SECRET } } },
    });

    expect(schoolTab.diffFields(nestedImport(existing), existing)).toEqual(['settings']);
  });
});

// #3346: a school ADMIN can restore a workbook (BACKUP_MANAGE), so an imported file must never move
// the school on or off the platform SMS account. The destination keeps its own value.
describe('sms.metering is never imported', () => {
  const file = (metering: string) => ({
    communications: { sms: { metering, provider: 'greenweb' } },
  });

  it('drops a PLATFORM value from the file when the school has none', () => {
    const merged = mergeImportedSettings({ communications: { sms: {} } }, file('PLATFORM'));
    expect(merged).toEqual({ communications: { sms: { provider: 'greenweb' } } });
  });

  it('keeps the stored PLATFORM value when the file says OFF', () => {
    const merged = mergeImportedSettings(
      { communications: { sms: { metering: 'PLATFORM' } } },
      file('OFF'),
    );
    expect(merged).toEqual({
      communications: { sms: { metering: 'PLATFORM', provider: 'greenweb' } },
    });
  });

  it('works when the school has no settings yet', () => {
    expect(mergeImportedSettings(null, file('PLATFORM'))).toEqual({
      communications: { sms: { provider: 'greenweb' } },
    });
  });
  const stored = () => ({
    communications: {
      sms: { metering: 'PLATFORM', provider: 'greenweb', greenweb: { apiKey: 'enc:key' } },
      email: { provider: 'smtp' },
    },
  });

  it('a null communications.sms cannot wipe the stored metering or credentials', () => {
    const merged = mergeImportedSettings(stored(), {
      communications: { sms: null, email: { provider: 'ses' } },
    });
    expect(merged).toEqual({
      communications: {
        sms: { metering: 'PLATFORM', provider: 'greenweb', greenweb: { apiKey: 'enc:key' } },
        email: { provider: 'ses' },
      },
    });
  });

  it('a null communications cannot wipe the stored block', () => {
    const merged = mergeImportedSettings(stored(), { communications: null, region: 'BD' });
    expect(merged).toEqual({ ...stored(), region: 'BD' });
  });

  it('a non-object communications.sms (a string) is dropped the same way', () => {
    expect(mergeImportedSettings(stored(), { communications: { sms: 'OFF' } })).toEqual(stored());
  });
});
