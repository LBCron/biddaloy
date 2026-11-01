import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditAction,
  ReportDefinitionStatus,
  ReportLayoutType,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { ReportRegistry } from '../engine/registry/registry';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import type { CreateReportDefinitionDto } from './dto/report-definition.dto';
import { ReportDefinitionsService, type DefinitionViewer } from './report-definitions.service';

/**
 * [8.15.23] The life of a report against the real database: drafts, immutable versions, copies and
 * the role-filtered catalogue.
 */
describe('ReportDefinitionsService (integration)', () => {
  let ds: DataSource;
  let service: ReportDefinitionsService;
  let tenantId: string;
  let admin: DefinitionViewer;

  const studentsReport = (field = 'name'): ReportDefinitionJson => ({
    schema: 1,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [],
    dataset: { dimensions: [{ field }], measures: [], filters: [], sort: [] },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });

  const dto = (
    key: string,
    over: Partial<CreateReportDefinitionDto> = {},
  ): CreateReportDefinitionDto => ({
    key,
    name_en: `Report ${key}`,
    name_bn: `রিপোর্ট ${key}`,
    definition: studentsReport(),
    ...over,
  });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AuditService,
      ReportRegistry,
      ReportDefinitionsService,
    ]);
    ds = module.get(DataSource);
    service = module.get(ReportDefinitionsService);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    const [school] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Defs ${Math.random()}`, `defs-${Math.random()}`],
    );
    tenantId = school.id;
    admin = { tenantId, userId: SEED_ADMIN_USER_ID, role: UserRole.ADMIN };
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('publishing twice makes versions 1 and 2, and version 1 never changes', async () => {
    const draft = await service.createDraft(admin, dto('dues'));
    const v1 = await service.publish(admin, draft.id);
    await service.updateDraft(admin, draft.id, { definition: studentsReport('class') });
    const v2 = await service.publish(admin, draft.id);

    expect([v1.version, v2.version]).toEqual([1, 2]);
    const stored = await ds.getRepository(ReportDefinitionVersion).findOneByOrFail({ id: v1.id });
    expect(stored.definition.dataset.dimensions).toEqual([{ field: 'name' }]);
    const current = await ds.getRepository(ReportDefinition).findOneByOrFail({ id: draft.id });
    expect(current.current_version_id).toBe(v2.id);
    expect(current.status).toBe(ReportDefinitionStatus.PUBLISHED);
  });

  it('a published version cannot be edited, even with SQL', async () => {
    const draft = await service.createDraft(admin, dto('frozen'));
    const v1 = await service.publish(admin, draft.id);
    await expect(
      ds.query(`UPDATE report_definition_versions SET version = 9 WHERE id = $1`, [v1.id]),
    ).rejects.toThrow(/immutable/);
  });

  it('two people publishing at once get two different version numbers', async () => {
    const draft = await service.createDraft(admin, dto('race'));
    const [a, b] = await Promise.all([
      service.publish(admin, draft.id),
      service.publish(admin, draft.id),
    ]);
    expect([a.version, b.version].sort()).toEqual([1, 2]);
  });

  it('a field that does not exist is refused with UNKNOWN_FIELD, naming the place and not the value', async () => {
    const error = await service
      .createDraft(admin, dto('bad', { definition: studentsReport("evil'; DROP TABLE students") }))
      .catch((e) => e);
    expect(error.getResponse()).toMatchObject({
      details: { code: 'UNKNOWN_FIELD', path: 'dataset.dimensions[0]' },
    });
    expect(JSON.stringify(error.getResponse())).not.toContain('DROP');
    expect(await ds.getRepository(ReportDefinition).countBy({ tenant_id: tenantId })).toBe(0);
  });

  it('a draft that asks a question the report never defines is refused when saved', async () => {
    const bad = studentsReport();
    bad.dataset.filters = [{ field: 'class', op: 'EQ' as never, value: { param: 'ghost' } }];
    await expect(
      service.createDraft(admin, dto('ghost', { definition: bad })),
    ).rejects.toMatchObject({
      response: { details: { code: 'UNKNOWN_PARAM' } },
    });
  });

  it('a draft with a question is saved without an answer (answers come when it runs)', async () => {
    const ok = studentsReport();
    ok.parameters = [{ key: 'cls', type: 'CLASS', label_en: 'C', label_bn: 'C', required: true }];
    ok.dataset.filters = [{ field: 'class', op: 'EQ' as never, value: { param: 'cls' } }];
    await expect(service.createDraft(admin, dto('asks', { definition: ok }))).resolves.toBeTruthy();
  });

  it('refuses a second report with the same key in one school, allows it in another', async () => {
    await service.createDraft(admin, dto('same'));
    await expect(service.createDraft(admin, dto('same'))).rejects.toThrow('already exists');
    const [other] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('O', $1) RETURNING id`,
      [`o-${Math.random()}`],
    );
    await expect(
      service.createDraft({ ...admin, tenantId: other.id }, dto('same')),
    ).resolves.toBeTruthy();
  });

  it('cannot publish without a draft, or touch another school’s report', async () => {
    const [other] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('O', $1) RETURNING id`,
      [`o-${Math.random()}`],
    );
    const mine = await service.createDraft(admin, dto('mine'));
    await expect(service.publish({ ...admin, tenantId: other.id }, mine.id)).rejects.toThrow(
      'Report not found',
    );
    await expect(service.get(other.id, mine.id)).rejects.toThrow('Report not found');
    await ds.getRepository(ReportDefinition).update({ id: mine.id }, { draft: null });
    await expect(service.publish(admin, mine.id)).rejects.toThrow('no draft');
  });

  it('a copy is a new draft that keeps the lineage and takes a free key', async () => {
    const original = await service.createDraft(admin, dto('base'));
    await ds
      .getRepository(ReportDefinition)
      .update({ id: original.id }, { system_template_key: 'student-list' });
    await service.publish(admin, original.id);

    const first = await service.clone(admin, original.id);
    const second = await service.clone(admin, original.id);
    expect([first.key, second.key]).toEqual(['base-copy', 'base-copy-2']);
    expect(first).toMatchObject({
      status: ReportDefinitionStatus.DRAFT,
      system_template_key: 'student-list',
      current_version_id: null,
      name_bn: 'রিপোর্ট base (কপি)',
    });
    expect(first.draft).toEqual(original.draft);
  });

  it('the catalogue shows a teacher only what is open to them, and groups by folder', async () => {
    const make = async (key: string, folder: string | null, roles: string[]) => {
      const d = await service.createDraft(
        admin,
        dto(key, { folder: folder ?? undefined, visible_roles: roles }),
      );
      await service.publish(admin, d.id);
    };
    await make('admins-only', 'Finance', [UserRole.ADMIN]);
    await make('for-teachers', 'Classes', [UserRole.TEACHER, UserRole.ADMIN]);
    await make('for-everyone', null, []);
    await service.createDraft(admin, dto('unpublished')); // a draft is in no catalogue

    const teacher = await service.catalogue({ ...admin, role: UserRole.TEACHER });
    expect(teacher.map((f) => [f.folder, f.reports.map((r) => r.key)])).toEqual([
      [null, ['for-everyone']],
      ['Classes', ['for-teachers']],
    ]);

    // The school's ready-made reports are listed too; this test is about the three it made.
    const everything = await service.catalogue(admin);
    const own = everything.flatMap((f) => f.reports.filter((r) => !r.system_template_key));
    expect(own.map((r) => r.key).sort()).toEqual(['admins-only', 'for-everyone', 'for-teachers']);
  });

  describe('presentation (how a report looks, for any role that may run it)', () => {
    const asteacher = (): DefinitionViewer => ({ ...admin, role: UserRole.TEACHER });

    /** A report whose dataset, calculated fields and layout all differ from its draft later on. */
    const publishWithSecrets = async (key: string, roles: string[] = []) => {
      const secret = studentsReport();
      secret.parameters = [
        { key: 'year', type: 'ACADEMIC_YEAR', label_en: 'Year', label_bn: 'বছর', required: false },
      ] as ReportDefinitionJson['parameters'];
      secret.dataset.filters = [
        { field: 'name', op: 'EQ', value: 'internal-filter-value' },
      ] as never;
      secret.calculated = [
        { key: 'calc', label_en: 'C', label_bn: 'C', expression: 'internal_expression' },
      ];
      const d = await service.createDraft(
        admin,
        dto(key, { visible_roles: roles, definition: secret }),
      );
      const v = await service.publish(admin, d.id);
      return { d, v };
    };

    it('a role that may run the report gets the presentation and NO dataset', async () => {
      const { d, v } = await publishWithSecrets('shown');
      const res = await service.presentation(asteacher(), d.id);

      expect(Object.keys(res).sort()).toEqual([
        'drill',
        'format',
        'layout',
        'page',
        'parameters',
        'schema',
        'subjectArea',
        'version_id',
      ]);
      expect(res.version_id).toBe(v.id);
      expect(res.parameters).toHaveLength(1);
      expect(res.layout.type).toBe(ReportLayoutType.TABLE);
      // The report's internals stay with the designer.
      const text = JSON.stringify(res);
      expect(text).not.toContain('internal-filter-value');
      expect(text).not.toContain('internal_expression');
      expect(text).not.toContain('dataset');
    });

    it('answers from the published version, never from a newer draft', async () => {
      const { d } = await publishWithSecrets('frozen-look');
      const changed = studentsReport();
      changed.layout = { type: ReportLayoutType.GROUPED, group_by: ['name'] };
      changed.page = { title_en: 'Draft title', title_bn: 'Draft title', orientation: 'landscape' };
      await service.updateDraft(admin, d.id, { definition: changed });

      const res = await service.presentation(asteacher(), d.id);
      expect(res.layout.type).toBe(ReportLayoutType.TABLE);
      expect(res.page.title_en).toBe('T');
      expect(res.parameters).toHaveLength(1);
    });

    it('a role the report was not made for gets 404, the same as an unknown id', async () => {
      const { d } = await publishWithSecrets('admins-only-look', [UserRole.ADMIN]);
      await expect(service.presentation(asteacher(), d.id)).rejects.toThrow('Report not found');
      // The designer roles see every published report.
      await expect(service.presentation(admin, d.id)).resolves.toBeDefined();
    });

    it('another school gets 404', async () => {
      const { d } = await publishWithSecrets('other-school-look');
      const [other] = await ds.query(
        `INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`,
        [`Defs other ${Math.random()}`, `defs-other-${Math.random()}`],
      );
      const stranger = { ...admin, tenantId: other.id };
      await expect(service.presentation(stranger, d.id)).rejects.toThrow('Report not found');
    });

    it('a draft that was never published gets 404', async () => {
      const d = await service.createDraft(admin, dto('draft-only-look'));
      await expect(service.presentation(asteacher(), d.id)).rejects.toThrow('Report not found');
      await expect(service.presentation(admin, d.id)).rejects.toThrow('Report not found');
    });

    it('an archived report gets 404', async () => {
      const { d } = await publishWithSecrets('archived-look');
      await service.archive(admin, d.id);
      await expect(service.presentation(asteacher(), d.id)).rejects.toThrow('Report not found');
    });
  });

  it('a school with no ready-made reports gets them on first look, once', async () => {
    const first = await service.catalogue(admin);
    const keys = first.flatMap((f) => f.reports.map((r) => r.system_template_key));
    expect(keys).toContain('student-list');
    const again = await service.catalogue(admin);
    expect(again.flatMap((f) => f.reports).length).toBe(first.flatMap((f) => f.reports).length);
  });

  it('an archived report leaves the catalogue and cannot be edited or published', async () => {
    const d = await service.createDraft(admin, dto('old'));
    await service.publish(admin, d.id);
    await service.archive(admin, d.id);
    const keys = (await service.catalogue(admin)).flatMap((f) => f.reports.map((r) => r.key));
    expect(keys).not.toContain('old');
    await expect(service.updateDraft(admin, d.id, { name_en: 'x' })).rejects.toThrow('archived');
    await expect(service.publish(admin, d.id)).rejects.toThrow('archived');
  });

  it('every change leaves an audit entry that names what happened, not the report body', async () => {
    const d = await service.createDraft(admin, dto('audited'));
    await service.updateDraft(admin, d.id, { name_en: 'Renamed' });
    await service.publish(admin, d.id);
    await service.archive(admin, d.id);

    const logs = await ds.getRepository(AuditLog).find({
      where: { entity_id: d.id, entity_type: 'ReportDefinition' },
      order: { created_at: 'ASC' },
    });
    expect(
      logs.map((l) => [l.action, (l.new_values as Record<string, unknown>).change ?? 'create']),
    ).toEqual([
      [AuditAction.CREATE, 'create'],
      [AuditAction.UPDATE, 'draft'],
      [AuditAction.UPDATE, 'published'],
      [AuditAction.UPDATE, 'archived'],
    ]);
    expect(JSON.stringify(logs.map((l) => l.new_values))).not.toContain('dimensions');
  });
});
