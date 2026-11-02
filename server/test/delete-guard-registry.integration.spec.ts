import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../src/modules/audit/audit.service';
import { AcademicYearService } from '../src/modules/academics/academic-year.service';
import { ClassService, SectionService } from '../src/modules/classes/classes.service';
import { SubjectService } from '../src/modules/academics/subjects.service';
import { RoomsService } from '../src/modules/routines/rooms.service';
import { FeeStructureService } from '../src/modules/fees/fees.service';
import { GradingService } from '../src/modules/grading/grading.service';
import { ExamsService } from '../src/modules/exams/exams.service';
import { ExamTemplatesService } from '../src/modules/exams/exam-templates.service';
import { ResultsService } from '../src/modules/exams/results.service';
import { SchoolSettingsReader } from '../src/modules/schools/settings/school-settings-reader.service';
import { SchoolsService } from '../src/modules/schools/schools.service';
import {
  ALLOWED,
  BARE_REFS,
  BARE_GUARDED,
  Ctx,
  GUARDED,
  KNOWN_GAPS,
  ORPHANED,
  PARENTS,
} from './delete-guard-registry';

const PARENT_NAMES = [
  'AcademicYear',
  'Class',
  'ClassSection',
  'Subject',
  'Room',
  'GradingScale',
  'FeeStructure',
  'Exam',
];

/**
 * [2655] Delete-guard registry. Runs on the migrated DB, in its own school with
 * uniquely numbered names (nothing is dropped; the test DB is dropped per run).
 */
describe('delete-guard registry (integration)', () => {
  let module: TestingModule;
  let ds: DataSource;
  let ctx: Ctx;
  let seq = 0;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, [
      AcademicYearService,
      ClassService,
      SectionService,
      SubjectService,
      RoomsService,
      GradingService,
      FeeStructureService,
      ExamsService,
      AuditService,
      SchoolSettingsReader,
      { provide: SchoolsService, useValue: {} },
      // ExamsService.remove uses neither; stubbed so the module stays small.
      { provide: ExamTemplatesService, useValue: {} },
      { provide: ResultsService, useValue: {} },
    ]);
    ds = module.get(DataSource);
    const tenantId = randomUUID();
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      tenantId,
      'Guard Registry School',
      `guard-registry-${tenantId.slice(0, 8)}`,
    ]);
    ctx = {
      ds,
      tenantId,
      n: () => ++seq,
      svc: {
        academicYears: module.get(AcademicYearService),
        classes: module.get(ClassService),
        sections: module.get(SectionService),
        subjects: module.get(SubjectService),
        rooms: module.get(RoomsService),
        grading: module.get(GradingService),
        feeStructures: module.get(FeeStructureService),
        exams: module.get(ExamsService),
      },
    };
  }, 60000);

  afterAll(async () => {
    await module.close();
  });

  describe('coverage', () => {
    // Every many-to-one that points at a protected parent, as "Child.prop -> Parent".
    const relations = () =>
      ds.entityMetadatas.flatMap((meta) =>
        meta.manyToOneRelations
          .filter((r) => PARENT_NAMES.includes(r.inverseEntityMetadata.name))
          .map((r) => `${meta.name}.${r.propertyName} -> ${r.inverseEntityMetadata.name}`),
      );
    const listed = () => [
      ...GUARDED.map((e) => e.key),
      ...ALLOWED.map((e) => e.key),
      ...KNOWN_GAPS.map((e) => e.key),
    ];

    it('puts every relation to a protected parent in exactly one list', () => {
      const inList = listed();
      const missing = relations().filter((k) => !inList.includes(k));
      // Fix: add the key to GUARDED, ALLOWED or KNOWN_GAPS in server/test/delete-guard-registry.ts.
      expect(missing, 'add it to GUARDED, ALLOWED or KNOWN_GAPS').toEqual([]);

      const dupes = inList.filter((k, i) => inList.indexOf(k) !== i);
      expect(dupes, 'a relation is in more than one list').toEqual([]);
    });

    it('lists no relation that no longer exists (stale entry)', () => {
      const real = relations();
      expect(
        listed().filter((k) => !real.includes(k)),
        'stale registry entries',
      ).toEqual([]);
    });

    // [2688] A reference with no relation decorator never shows in manyToOneRelations.
    // 1) Any FK constraint in the migrated DB that points at a protected table must be a listed relation.
    it('lists every database FK that points at a protected table', async () => {
      const tables = PARENT_NAMES.map((n) => ds.getMetadata(n).tableName);
      const rows: { child: string; col: string }[] = await ds.query(
        `SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confrelid::regclass::text = ANY ($1)`,
        [tables],
      );
      const covered = new Set(
        ds.entityMetadatas.flatMap((meta) =>
          meta.manyToOneRelations
            .filter((r) =>
              listed().includes(
                `${meta.name}.${r.propertyName} -> ${r.inverseEntityMetadata.name}`,
              ),
            )
            .flatMap((r) => r.joinColumns.map((j) => `${meta.tableName}.${j.databaseName}`)),
        ),
      );
      for (const b of BARE_REFS) {
        const [entity, col] = b.key.split('.');
        covered.add(`${ds.getMetadata(entity).tableName}.${col}`);
      }
      const missing = rows
        .map((r) => `${r.child.replace(/"/g, '')}.${r.col}`)
        .filter((k) => !covered.has(k));
      expect(missing, 'FK to a protected table that is in no list').toEqual([]);
    });

    // 2) A plain uuid column named like a protected parent's id, with no relation, must be in BARE_REFS.
    it('lists every bare uuid column that references a protected parent', () => {
      const bareNames = [
        'academic_year_id',
        'class_id',
        'section_id',
        'subject_id',
        'room_id',
        'fee_structure_id',
      ];
      const bare = ds.entityMetadatas.flatMap((meta) =>
        meta.columns
          .filter((c) => !c.relationMetadata && bareNames.includes(c.propertyName))
          .map((c) => `${meta.name}.${c.propertyName}`),
      );
      const missing = bare.filter((k) => !BARE_REFS.some((b) => b.key === k));
      expect(missing, 'add it to BARE_REFS in delete-guard-registry.ts').toEqual([]);
      const stale = BARE_REFS.filter((b) => !bare.includes(b.key)).map((b) => b.key);
      expect(stale, 'stale BARE_REFS entries').toEqual([]);
    });

    // [2702] A bare FK to a protected parent is only safe when a guard proves it.
    it('guards every bare reference that has a real FK to a protected table', async () => {
      const tables = PARENT_NAMES.map((n) => ds.getMetadata(n).tableName);
      const rows: { child: string; col: string }[] = await ds.query(
        `SELECT c.conrelid::regclass::text AS child, a.attname AS col
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f' AND c.confrelid::regclass::text = ANY ($1)`,
        [tables],
      );
      const fks = new Set(rows.map((r) => `${r.child.replace(/"/g, '')}.${r.col}`));
      const unguarded = BARE_REFS.filter((b) => {
        const [entity, col] = b.key.split('.');
        return (
          fks.has(`${ds.getMetadata(entity).tableName}.${col}`) &&
          !BARE_GUARDED.some((g) => g.key === b.key)
        );
      }).map((b) => b.key);
      expect(
        unguarded,
        'bare FK to a protected parent with no guard: add it to BARE_GUARDED',
      ).toEqual([]);
    });

    it('gives every ALLOWED and KNOWN_GAPS entry a reason and every gap a follow-up', () => {
      for (const e of [...ALLOWED, ...KNOWN_GAPS])
        expect(e.reason.length, e.key).toBeGreaterThan(10);
      for (const e of KNOWN_GAPS) expect(e.followUp, e.key).toBeTruthy();
    });
  });

  describe('GUARDED: parent remove() is a 409 while a live child exists', () => {
    it.each([
      ...GUARDED.map((g) => [g.key, g] as const),
      ...BARE_GUARDED.map((g) => [`${g.key} (bare FK)`, g] as const),
      ...ORPHANED.map((g) => [`${g.key} (released by deleting its other parent)`, g] as const),
    ])('%s', async (_key, g) => {
      const parent = PARENTS[g.parent];
      const parentId = await parent.make(ctx);
      const child = await g.makeChild(ctx, parentId);

      const refusal = await parent.remove(ctx, parentId).then(
        () => null,
        (e: unknown) => e,
      );
      expect(refusal).toBeInstanceOf(ConflictException);
      if ('code' in g && g.code) {
        const body = (refusal as ConflictException).getResponse() as {
          details?: { code?: string };
        };
        expect(body.details?.code).toBe(g.code);
      }
      expect(await parent.isGone(ctx, parentId), 'parent must stay').toBe(false);

      // With the child gone (soft-deleted, or deleted where the table has no soft delete) the remove works.
      await child.release();
      await parent.remove(ctx, parentId);
      expect(await parent.isGone(ctx, parentId)).toBe(true);
    });
  });
});
