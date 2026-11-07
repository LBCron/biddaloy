import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditAction } from '@biddaloy/shared';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [8.10.7.3.18] `AuditService.findRecentForDashboard` against real Postgres.
 * `audit_logs` is append-only (a trigger blocks DELETE), so every test gets its
 * own school instead of wiping the table.
 */
describe('AuditService.findRecentForDashboard (integration)', () => {
  let service: AuditService;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const USER_ID = '00000000-0000-4000-8000-00000187810a';
  const REMOVED_USER_ID = '00000000-0000-4000-8000-00000187810b';
  const CALLER_ID = '00000000-0000-4000-8000-00000187810c';
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService]);
    service = module.get(AuditService);
    auditLogRepo = module.get(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    const userRepo = dataSource.getRepository(User);
    await userRepo.save([
      userRepo.create({
        id: USER_ID,
        email: 'audit-dash-active@example.com',
        password_hash: 'x',
        full_name: 'Rahim Uddin',
      }),
      userRepo.create({
        id: REMOVED_USER_ID,
        email: 'audit-dash-removed@example.com',
        password_hash: 'x',
        full_name: 'Kamrul Hasan',
      }),
    ]);
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  async function newSchool(): Promise<string> {
    n += 1;
    const id = `00000000-0000-4000-8000-0000018781${String(n).padStart(2, '0')}`;
    const repo = dataSource.getRepository(School);
    await repo.save(repo.create({ id, name: `Audit Dash ${n}`, slug: `audit-dash-${n}` }));
    return id;
  }

  /** `minutesAgo` makes the order deterministic. */
  async function addRow(
    tenantId: string | null,
    minutesAgo: number,
    over: Partial<AuditLog> = {},
  ): Promise<AuditLog> {
    return auditLogRepo.save(
      auditLogRepo.create({
        tenant_id: tenantId,
        action: AuditAction.UPDATE,
        entity_type: 'Unlabelled',
        entity_id: null,
        performed_by_user_id: USER_ID,
        created_at: new Date(Date.now() - minutesAgo * 60_000),
        ...over,
      }),
    );
  }

  it('returns the 8 newest of 10 rows, newest first', async () => {
    const t = await newSchool();
    const rows: AuditLog[] = [];
    for (let i = 10; i >= 1; i--) rows.push(await addRow(t, i)); // oldest first
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    // rows[9] is 1 minute old (newest); the two oldest (rows[0], rows[1]) drop off.
    expect(res.items.map((r) => r.id)).toEqual(
      rows
        .slice(2)
        .reverse()
        .map((r) => r.id),
    );
    expect(res.items).toHaveLength(8);
  });

  it('counts only keys whose values really differ; nested equality is unchanged; CREATE is null', async () => {
    const t = await newSchool();
    const upd = await addRow(t, 3, {
      old_values: { a: 1, b: 'x', c: { k: [1, 2] }, d: true, e: null },
      new_values: { a: 2, b: 'x', c: { k: [1, 2] }, d: false, e: null },
    });
    const created = await addRow(t, 2, {
      action: AuditAction.CREATE,
      old_values: null,
      new_values: { a: 1 },
    });
    const login = await addRow(t, 1, { action: AuditAction.LOGIN });
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    const byId = new Map(res.items.map((i) => [i.id, i]));
    expect(byId.get(upd.id)?.changed_field_count).toBe(2);
    expect(byId.get(created.id)?.changed_field_count).toBeNull();
    expect(byId.get(login.id)?.changed_field_count).toBeNull();
  });

  it('a key present on only one side counts as changed (same rule as the audit page)', async () => {
    const t = await newSchool();
    const upd = await addRow(t, 1, { old_values: { a: 1 }, new_values: { a: 1, b: 2 } });
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    expect(res.items.find((i) => i.id === upd.id)?.changed_field_count).toBe(1);
  });

  it('entity_label equals what the audit list resolves; deleted performer has a null name', async () => {
    const t = await newSchool();
    const ys = dataSource.getRepository(AcademicYear);
    const year = await ys.save(
      ys.create({
        name: `Y-${t.slice(-2)}`,
        start_date: new Date('2030-01-01'),
        end_date: new Date('2030-12-31'),
        tenant_id: t,
      }),
    );
    const cr = dataSource.getRepository(Class);
    const klass = await cr.save(
      cr.create({ name: `C-${t.slice(-2)}`, academic_year_id: year.id, tenant_id: t }),
    );
    const sr = dataSource.getRepository(ClassSection);
    const section = await sr.save(
      sr.create({ class_id: klass.id, section_name: 'A', tenant_id: t }),
    );
    const stu = dataSource.getRepository(Student);
    const student = await stu.save(
      stu.create({
        full_name: 'Sadia Islam',
        registration_number: `REG-${t.slice(-2)}`,
        roll_number: 1,
        class_section_id: section.id,
        tenant_id: t,
      }),
    );
    const a = await addRow(t, 2, { entity_type: 'Student', entity_id: student.id });
    // Performer row is gone: user soft-deleted would still be named (audit page rule),
    // so use a hard null id, which is what ON DELETE SET NULL leaves behind.
    const b = await addRow(t, 1, { performed_by_user_id: null });

    const res = await service.findRecentForDashboard(t, CALLER_ID);
    const list = await service.findAll({ page: 1, limit: 8 } as QueryAuditLogDto, t, CALLER_ID);

    const item = res.items.find((i) => i.id === a.id);
    expect(item?.entity_label).toBe('Sadia Islam');
    expect(item?.entity_label).toBe(list.entityLabels.get(`Student:${student.id}`));
    expect(item?.performed_by_name).toBe('Rahim Uddin');
    expect(res.items.find((i) => i.id === b.id)?.performed_by_name).toBeNull();
    expect(res.items.find((i) => i.id === b.id)?.entity_label).toBeNull();
  });

  it('still names a soft-deleted performer (same as the audit list)', async () => {
    const t = await newSchool();
    const row = await addRow(t, 1, { performed_by_user_id: REMOVED_USER_ID });
    await dataSource.getRepository(User).softDelete(REMOVED_USER_ID);
    try {
      const res = await service.findRecentForDashboard(t, CALLER_ID);
      expect(res.items.find((i) => i.id === row.id)?.performed_by_name).toBe('Kamrul Hasan');
    } finally {
      await dataSource.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [REMOVED_USER_ID]);
    }
  });

  it('reconciles: ids equal findAll({page:1, limit:8}) ids', async () => {
    const t = await newSchool();
    for (let i = 12; i >= 1; i--) await addRow(t, i);
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    const list = await service.findAll({ page: 1, limit: 8 } as QueryAuditLogDto, t, CALLER_ID);
    expect(res.items.map((i) => i.id)).toEqual(list.data.map((r) => r.id));
  });

  it('rows sharing one created_at come back id DESC from the widget and the list (#3427)', async () => {
    const t = await newSchool();
    // Same instant for all six, so only the id tie-break can order them. With no tie-break
    // the widget (limit 8) and the list (limit 100) could return them in different orders.
    const at = new Date(Date.now() - 60_000);
    const rows: AuditLog[] = [];
    for (let i = 0; i < 6; i += 1) rows.push(await addRow(t, 0, { created_at: at }));
    // Lowercase UUID text sorts the same as Postgres sorts uuid.
    const expected = rows
      .map((r) => r.id)
      .sort()
      .reverse();
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    const list = await service.findAll({ page: 1, limit: 100 } as QueryAuditLogDto, t, CALLER_ID);
    expect(res.items.map((i) => i.id)).toEqual(expected);
    expect(list.data.map((r) => r.id)).toEqual(expected);
  });

  it('never leaks another tenant’s or platform (tenant_id null) rows', async () => {
    const mine = await newSchool();
    const other = await newSchool();
    const own = await addRow(mine, 5);
    const foreign = await addRow(other, 1);
    const platform = await addRow(null, 1);
    const res = await service.findRecentForDashboard(mine, CALLER_ID);
    const ids = res.items.map((i) => i.id);
    expect(ids).toEqual([own.id]);
    expect(ids).not.toContain(foreign.id);
    expect(ids).not.toContain(platform.id);
  });

  it('ships no raw JSON, ip or user agent, and no tenant id', async () => {
    const t = await newSchool();
    await addRow(t, 1, {
      old_values: { secret: 'a' },
      new_values: { secret: 'b' },
      ip_address: '10.0.0.1',
      user_agent: 'UA',
    });
    const res = await service.findRecentForDashboard(t, CALLER_ID);
    expect(Object.keys(res.items[0]).sort()).toEqual([
      'action',
      'changed_field_count',
      'created_at',
      'entity_label',
      'entity_type',
      'id',
      'performed_by_name',
    ]);
    expect(typeof res.items[0].created_at).toBe('string');
  });
});
