import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { MarkGridState } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from './all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
} from '@test/constants';
import { MarkGrid } from '../src/modules/exams/entities/mark-grid.entity';
import { lockGrid } from '../src/modules/exams/mark-grid.service';
import { lockExam } from '../src/modules/exams/exam-lock';

/**
 * [pr-fix #945] `lockGrid` against real Postgres — the unit specs mock the
 * query builder, so only this proves the ON CONFLICT insert and the
 * FOR UPDATE re-read actually serialize two writers on one grid.
 */
describe('lockGrid / lockExam (integration)', () => {
  let dataSource: DataSource;
  let key: { tenantId: string; examId: string; sectionId: string; subjectId: string };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
  }, 60000);

  beforeEach(async () => {
    const [subject] = await dataSource.query(
      `INSERT INTO "subjects" (id, tenant_id, name_en, code) VALUES (gen_random_uuid(), $1, 'Lock Subject', 'LCK') RETURNING id`,
      [SEED_TENANT_ID],
    );
    const [exam] = await dataSource.query(
      `INSERT INTO "exams" (id, tenant_id, academic_year_id, class_id, name, kind) VALUES (gen_random_uuid(), $1, $2, $3, 'Lock Exam', 'TERM') RETURNING id`,
      [SEED_TENANT_ID, SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID],
    );
    key = {
      tenantId: SEED_TENANT_ID,
      examId: exam.id,
      sectionId: SEED_SECTION_1_ID,
      subjectId: subject.id,
    };
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function gridRows() {
    return dataSource.query(
      `SELECT state FROM "mark_grids" WHERE exam_id = $1 AND section_id = $2 AND subject_id = $3`,
      [key.examId, key.sectionId, key.subjectId],
    );
  }

  it('creates a never-touched grid as DRAFT exactly once', async () => {
    const first = await dataSource.transaction((m) => lockGrid(m, key));
    const second = await dataSource.transaction((m) => lockGrid(m, key));

    expect(first.state).toBe(MarkGridState.DRAFT);
    expect(second.id).toBe(first.id);
    expect(await gridRows()).toHaveLength(1);
  });

  it('makes a second writer wait for the first to commit, then see its SUBMITTED state', async () => {
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((r) => (releaseFirst = r));
    let firstLocked!: () => void;
    const firstHasLock = new Promise<void>((r) => (firstLocked = r));

    // Writer 1 = a submit: takes the lock, holds it, flips to SUBMITTED.
    const submit = dataSource.transaction(async (m) => {
      const grid = await lockGrid(m, key);
      firstLocked();
      await firstHolds;
      await m.getRepository(MarkGrid).update({ id: grid.id }, { state: MarkGridState.SUBMITTED });
    });
    await firstHasLock;

    // Writer 2 = an autosave's SUBMITTED check, started mid-submit.
    let secondDone = false;
    const autosaveCheck = dataSource
      .transaction((m) => lockGrid(m, key))
      .then((g) => {
        secondDone = true;
        return g.state;
      });

    await new Promise((r) => setTimeout(r, 300));
    // Blocked on the row lock — the old unlocked check would already have
    // read DRAFT here and gone on to write marks onto a submitted grid.
    expect(secondDone).toBe(false);

    releaseFirst();
    await submit;
    expect(await autosaveCheck).toBe(MarkGridState.SUBMITTED);
  });

  it('lets two mark writers share the exam lock, but makes a publish wait for both', async () => {
    let releaseWriters!: () => void;
    const writersHold = new Promise<void>((r) => (releaseWriters = r));
    let sharedCount = 0;
    let bothShared!: () => void;
    const bothHaveShare = new Promise<void>((r) => (bothShared = r));

    // Two autosaves on different grids: FOR SHARE must not block each other.
    const writer = () =>
      dataSource.transaction(async (m) => {
        await lockExam(m, key.examId, key.tenantId, 'pessimistic_read');
        sharedCount += 1;
        if (sharedCount === 2) bothShared();
        await writersHold;
      });
    const writers = Promise.all([writer(), writer()]);
    await bothHaveShare;

    // A publish (FOR UPDATE) arriving mid-write must queue behind them —
    // this is what stops marks changing after publication.
    let publishLocked = false;
    const publish = dataSource.transaction(async (m) => {
      await lockExam(m, key.examId, key.tenantId);
      publishLocked = true;
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(publishLocked).toBe(false);

    releaseWriters();
    await writers;
    await publish;
    expect(publishLocked).toBe(true);
  });
});
