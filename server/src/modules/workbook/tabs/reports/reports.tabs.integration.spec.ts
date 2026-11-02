import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ReportDefinition } from '../../../reports/entities/report-definition.entity';
import { ReportDefinitionVersion } from '../../../reports/entities/report-definition-version.entity';
import { ReportSchedule } from '../../../reports/entities/report-schedule.entity';
import { reportDefinitionsTab } from './report-definitions.tab';
import {
  reportDefinitionVersionsTab,
  type ReportDefinitionVersionRow,
} from './report-definition-versions.tab';
import { reportSchedulesTab, type ReportScheduleRow } from './report-schedules.tab';

/**
 * Against the real database: what a mock cannot prove for the report tabs, namely the
 * immutability trigger and the definition <-> version pointer. (The full export -> restore
 * into another school path is `test/workbook-roundtrip.integration.spec.ts`.)
 */
describe('report workbook tabs (integration)', () => {
  let ds: DataSource;
  let tenantId: string;
  let definition: ReportDefinition;
  let version1: ReportDefinitionVersion;

  beforeAll(async () => {
    ds = (await createTestModule(ALL_ENTITIES, [])).get(DataSource);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`RT ${randomUUID()}`, `rt-${randomUUID()}`],
    );
    tenantId = school.id;
    definition = await ds.getRepository(ReportDefinition).save(
      ds.getRepository(ReportDefinition).create({
        tenant_id: tenantId,
        key: 'student-list',
        name_en: 'Student list',
        name_bn: 'শিক্ষার্থীর তালিকা',
        status: 'PUBLISHED',
        visible_roles: ['ADMIN'],
      }),
    );
    version1 = await ds.getRepository(ReportDefinitionVersion).save(
      ds.getRepository(ReportDefinitionVersion).create({
        tenant_id: tenantId,
        definition_id: definition.id,
        version: 1,
        definition: { label: 'v1' } as never,
        schema_version: 1,
      }),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  const versionRow = (
    over: Partial<ReportDefinitionVersionRow> = {},
  ): ReportDefinitionVersionRow => ({
    id: randomUUID(),
    definition_id: definition.id,
    report_key: 'student-list',
    version: 1,
    definition: { label: 'v1' } as never,
    schema_version: 1,
    published_at: new Date(),
    is_current: false,
    ...over,
  });

  it('restoring a version whose content differs fails loudly and leaves the published one untouched', async () => {
    await expect(
      ds.transaction((m) =>
        reportDefinitionVersionsTab.upsert(
          versionRow({ definition: { label: 'CHANGED' } as never }),
          version1,
          tenantId,
          m,
        ),
      ),
    ).rejects.toThrow(/immutable/);

    const stored = await ds
      .getRepository(ReportDefinitionVersion)
      .findOneByOrFail({ id: version1.id });
    expect(stored.definition).toEqual({ label: 'v1' });
  });

  it('restoring identical content is a no-op on the version row (an UPDATE would hit the trigger)', async () => {
    await expect(
      ds.transaction((m) =>
        reportDefinitionVersionsTab.upsert(versionRow(), version1, tenantId, m),
      ),
    ).resolves.toMatchObject({ id: version1.id });
  });

  it('a definition with two versions and one schedule round-trips, and the current pointer survives', async () => {
    await ds.transaction(async (m) => {
      await reportDefinitionVersionsTab.upsert(
        versionRow({ version: 2, definition: { label: 'v2' } as never, is_current: true }),
        null,
        tenantId,
        m,
      );
      const schedule: ReportScheduleRow = {
        id: randomUUID(),
        definition_id: definition.id,
        report_key: 'student-list',
        frequency: 'WEEKLY',
        day_of_week: 1,
        day_of_month: null,
        local_time: '08:30',
        params: {},
        recipient_roles: ['ADMIN'],
        format: 'XLSX',
        active: true,
      };
      await reportSchedulesTab.upsert(schedule, null, tenantId, m);
    });

    const versions = await ds
      .getRepository(ReportDefinitionVersion)
      .find({ where: { definition_id: definition.id }, order: { version: 'ASC' } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    const reloaded = await ds
      .getRepository(ReportDefinition)
      .findOneByOrFail({ id: definition.id });
    expect(reloaded.current_version_id).toBe(versions[1]?.id);
    expect(await ds.getRepository(ReportSchedule).countBy({ definition_id: definition.id })).toBe(
      1,
    );
  });

  it('does not move the current pointer for a version that is not marked current', async () => {
    await ds
      .getRepository(ReportDefinition)
      .update({ id: definition.id }, { current_version_id: version1.id });
    await ds.transaction((m) =>
      reportDefinitionVersionsTab.upsert(
        versionRow({ version: 2, definition: { label: 'v2' } as never, is_current: false }),
        null,
        tenantId,
        m,
      ),
    );
    const reloaded = await ds
      .getRepository(ReportDefinition)
      .findOneByOrFail({ id: definition.id });
    expect(reloaded.current_version_id).toBe(version1.id);
  });

  it('loads only this school’s definitions', async () => {
    const [other] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`RT2 ${randomUUID()}`, `rt2-${randomUUID()}`],
    );
    const loaded = await ds.transaction((m) => reportDefinitionsTab.load(other.id, m));
    expect(loaded).toEqual([]);
  });
});
