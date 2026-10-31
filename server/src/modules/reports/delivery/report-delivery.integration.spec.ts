import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExportFormat,
  ReportDefinitionStatus,
  ReportLayoutType,
  ReportRunKind,
  ReportRunStatus,
  ReportScheduleFrequency,
  ReportSubjectArea,
  UserRole,
  type ReportDefinitionJson,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../audit/audit.service';
import { TeacherScopeService } from '../../classes/teacher-scope.service';
import { CommunicationsService } from '../../communications/communications.service';
import { PushService } from '../../push/push.service';
import { SchoolsService } from '../../schools/schools.service';
import { TENANT_STATUS_REDIS, TenantStatusService } from '../../schools/tenant-status.service';
import { StorageService } from '../../storage/storage.service';
import { ReportCompiler } from '../engine/compiler/report-compiler';
import { ReportRegistry } from '../engine/registry/registry';
import { DEFINITION_SOURCE, DefinitionRowSource } from '../engine/runner/definition-row-source';
import { ReportResultCache } from '../engine/runner/report-result.cache';
import { ReportRunnerService } from '../engine/runner/report-runner.service';
import { RoleScopePolicy } from '../engine/security/role-scope.policy';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import { ReportRun } from '../entities/report-run.entity';
import { ReportSchedule } from '../entities/report-schedule.entity';
import { ReportSnapshot } from '../entities/report-snapshot.entity';
import { ReportExportCleanupProcessor } from '../export/report-export-cleanup.processor';
import { ReportExportProcessor } from '../export/report-export.processor';
import { REPORT_EXPORT_CLEANUP_QUEUE, REPORT_EXPORT_QUEUE } from '../export/report-export.queue';
import { ReportRowSourceRegistry } from '../export/report-row-sources';
import { ReportRunLogService } from '../export/report-run-log.service';
import { ReportScheduleProcessor } from './report-schedule.processor';
import {
  REPORT_SCHEDULE_QUEUE,
  ReportSchedulesService,
  SCHEDULER_PREFIX,
  cronFor,
} from './report-schedules.service';
import { ReportSnapshotsService } from './report-snapshots.service';

/**
 * [8.15.44] Scheduled email links and kept copies, against the real database with in-memory stand-ins
 * for storage, the queue, push and the email queue. Business rules proved here: a link goes only to a
 * person whose role may download that report; every person gets a file built for THEIR role (an
 * accountant's copy has no religion column) and only they own it; the email carries no row data; a
 * schedule whose report is archived, or whose creator lost the right to design, switches itself off;
 * another school's job does nothing; and a kept copy survives the daily export cleanup.
 */
describe('report delivery (integration)', () => {
  let ds: DataSource;
  let schedules: ReportSchedulesService;
  let processor: ReportScheduleProcessor;
  let snapshots: ReportSnapshotsService;
  let cleanup: ReportExportCleanupProcessor;
  let sources: ReportRowSourceRegistry;
  let runLog: ReportRunLogService;
  let defSource: DefinitionRowSource;
  let fx: ReportAreaFixture;

  let tenantId: string;
  let creator: string;
  let adminUser: string;
  let accountantUser: string;
  let definition: ReportDefinition;
  let version: ReportDefinitionVersion;

  const suffix = randomUUID().slice(0, 8);
  const stored = new Map<string, Buffer>();
  const storage = {
    putStream: vi.fn(async (key: string, body: Readable) => {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c as Buffer));
      stored.set(key, Buffer.concat(chunks));
    }),
    getForTenant: vi.fn(async (key: string, tenant: string) => {
      if (!key.startsWith(`tenants/${tenant}/`) || !stored.has(key)) throw new Error('missing');
      return { body: Readable.from([stored.get(key) as Buffer]), contentType: 'text/csv' };
    }),
    deleteForTenant: vi.fn(async (key: string) => {
      stored.delete(key);
    }),
  };
  const fakeQueue = {
    add: vi.fn().mockResolvedValue({}),
    upsertJobScheduler: vi.fn().mockResolvedValue({}),
    removeJobScheduler: vi.fn().mockResolvedValue(true),
    getJobSchedulers: vi.fn().mockResolvedValue([]),
  };
  const communications = { enqueue: vi.fn().mockResolvedValue({}) };
  const tenantStatus = {
    isActive: vi.fn().mockResolvedValue(true),
    isRestoring: vi.fn().mockResolvedValue(false),
  };
  const schools = {
    getResolvedSettings: vi.fn().mockResolvedValue({ region: { timezone: 'Asia/Dhaka' } }),
    todayFor: vi.fn().mockResolvedValue('2026-10-31'),
  };

  const definitionJson = (): ReportDefinitionJson => ({
    schema: 1,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [],
    // `religion` is SENSITIVE: ADMIN only (D5).
    dataset: {
      dimensions: [{ field: 'name' }, { field: 'religion' }],
      measures: [],
      filters: [],
      sort: [{ field: 'name', dir: 'asc' }],
    },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: 'T', title_bn: 'T', orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  });

  const person = async (
    role: UserRole,
    opts: { tenant?: string; status?: string; email?: string | null } = {},
  ): Promise<string> => {
    const [u] = await ds.query(
      `INSERT INTO users (email, full_name, password_hash, status) VALUES ($1, $2, 'x', $3) RETURNING id`,
      [
        opts.email === undefined ? `${role}-${randomUUID()}@example.test` : opts.email,
        `${role} Person`,
        opts.status ?? 'ACTIVE',
      ],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
      [u.id, opts.tenant ?? tenantId, role],
    );
    return u.id as string;
  };

  const createSchedule = (over: Record<string, unknown> = {}) =>
    schedules.create({ tenantId, userId: creator }, definition.id, {
      frequency: ReportScheduleFrequency.DAILY,
      local_time: '08:30',
      recipient_roles: [UserRole.ADMIN, UserRole.ACCOUNTANT],
      format: ExportFormat.CSV,
      ...over,
    } as never);

  const runsOf = (userId: string) =>
    ds.getRepository(ReportRun).find({ where: { tenant_id: tenantId, run_by: userId } });
  const csvOf = (run: ReportRun) =>
    (stored.get(run.storage_key as string) as Buffer).toString('utf8');
  const header = (run: ReportRun) => csvOf(run).split('\r\n')[0].split(',');
  const sentTo = () => communications.enqueue.mock.calls.map((c) => c[0] as Record<string, string>);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AuditService,
      ReportRunLogService,
      ReportRowSourceRegistry,
      ReportRegistry,
      RoleScopePolicy,
      ReportCompiler,
      ReportResultCache,
      ReportRunnerService,
      DefinitionRowSource,
      ReportExportProcessor,
      ReportExportCleanupProcessor,
      ReportSchedulesService,
      ReportSnapshotsService,
      ReportScheduleProcessor,
      { provide: TeacherScopeService, useValue: { sectionScope: async () => null } },
      { provide: TENANT_STATUS_REDIS, useValue: { get: async () => null, set: async () => 'OK' } },
      { provide: StorageService, useValue: storage },
      { provide: PushService, useValue: { sendToUser: vi.fn().mockResolvedValue({}) } },
      { provide: CommunicationsService, useValue: communications },
      { provide: TenantStatusService, useValue: tenantStatus },
      { provide: SchoolsService, useValue: schools },
      {
        provide: ConfigService,
        useValue: {
          get: (k: string) => (k === 'APP_BASE_URL' ? 'https://app.example.test' : undefined),
        },
      },
      { provide: getQueueToken(REPORT_SCHEDULE_QUEUE), useValue: fakeQueue },
      { provide: getQueueToken(REPORT_EXPORT_QUEUE), useValue: fakeQueue },
      { provide: getQueueToken(REPORT_EXPORT_CLEANUP_QUEUE), useValue: fakeQueue },
    ]);
    ds = module.get(DataSource);
    schedules = module.get(ReportSchedulesService);
    processor = module.get(ReportScheduleProcessor);
    snapshots = module.get(ReportSnapshotsService);
    cleanup = module.get(ReportExportCleanupProcessor);
    sources = module.get(ReportRowSourceRegistry);
    runLog = module.get(ReportRunLogService);
    defSource = module.get(DefinitionRowSource);
    defSource.onModuleInit();
    fx = new ReportAreaFixture(ds);
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    stored.clear();
    vi.clearAllMocks();
    schools.getResolvedSettings.mockResolvedValue({ region: { timezone: 'Asia/Dhaka' } });
    schools.todayFor.mockResolvedValue('2026-10-31');
    tenantStatus.isActive.mockResolvedValue(true);
    tenantStatus.isRestoring.mockResolvedValue(false);
    fakeQueue.upsertJobScheduler.mockResolvedValue({});
    fakeQueue.getJobSchedulers.mockResolvedValue([]);

    tenantId = await fx.school();
    const year = await fx.year(tenantId);
    const six = await fx.klass(tenantId, year, 'Six', 6);
    await fx.student(tenantId, year, six, { name: 'Rahim Uddin', religion: 'ISLAM' });
    await fx.student(tenantId, year, six, { name: 'Sumon Das', religion: 'HINDUISM' });

    creator = await person(UserRole.ADMIN);
    adminUser = creator;
    accountantUser = await person(UserRole.ACCOUNTANT);
    definition = await ds.getRepository(ReportDefinition).save(
      ds.getRepository(ReportDefinition).create({
        tenant_id: tenantId,
        key: `students-${suffix}`,
        name_en: 'Student list',
        name_bn: 'ছাত্রের তালিকা',
        status: ReportDefinitionStatus.PUBLISHED,
        visible_roles: [],
        draft: definitionJson(),
        created_by: creator,
      }),
    );
    version = await ds.getRepository(ReportDefinitionVersion).save(
      ds.getRepository(ReportDefinitionVersion).create({
        tenant_id: tenantId,
        definition_id: definition.id,
        version: 1,
        definition: definitionJson(),
        schema_version: 1,
        published_by: creator,
      }),
    );
    await ds
      .getRepository(ReportDefinition)
      .update({ id: definition.id }, { current_version_id: version.id });
    definition.current_version_id = version.id;
  }, 60_000);

  afterAll(async () => {
    await ds.destroy();
  });

  describe('cron and checks', () => {
    it('builds the pattern from checked fields, at most once a day', () => {
      const base = { day_of_week: null, day_of_month: null, local_time: '08:30' };
      expect(cronFor({ ...base, frequency: ReportScheduleFrequency.DAILY })).toBe('30 8 * * *');
      expect(cronFor({ ...base, frequency: ReportScheduleFrequency.WEEKLY, day_of_week: 0 })).toBe(
        '30 8 * * 0',
      );
      expect(
        cronFor({ ...base, frequency: ReportScheduleFrequency.MONTHLY, day_of_month: 5 }),
      ).toBe('30 8 5 * *');
    });

    it("registers one job per schedule in the school's own timezone", async () => {
      const schedule = await createSchedule();
      expect(fakeQueue.upsertJobScheduler).toHaveBeenCalledWith(
        `${SCHEDULER_PREFIX}${schedule.id}`,
        { pattern: '30 8 * * *', tz: 'Asia/Dhaka' },
        expect.objectContaining({ data: { scheduleId: schedule.id, tenantId } }),
      );
    });

    it('refuses a weekly schedule with no day, and a monthly one with no date', async () => {
      await expect(createSchedule({ frequency: ReportScheduleFrequency.WEEKLY })).rejects.toThrow(
        /day of the week/,
      );
      await expect(createSchedule({ frequency: ReportScheduleFrequency.MONTHLY })).rejects.toThrow(
        /day of the month/,
      );
    });

    it("refuses another school's report with a 404 and a report that is not published with a 409", async () => {
      const other = await fx.school();
      await expect(
        schedules.create({ tenantId: other, userId: creator }, definition.id, {
          frequency: ReportScheduleFrequency.DAILY,
          local_time: '08:30',
          recipient_roles: [UserRole.ADMIN],
          format: ExportFormat.CSV,
        } as never),
      ).rejects.toMatchObject({ status: 404 });
      await ds
        .getRepository(ReportDefinition)
        .update({ id: definition.id }, { status: ReportDefinitionStatus.ARCHIVED });
      await expect(createSchedule()).rejects.toMatchObject({ status: 409 });
    });

    it('fails closed when Redis cannot take the job: no schedule is left behind', async () => {
      fakeQueue.upsertJobScheduler.mockRejectedValueOnce(new Error('redis down'));
      await expect(createSchedule()).rejects.toMatchObject({ status: 503 });
      expect(await ds.getRepository(ReportSchedule).count({ where: { tenant_id: tenantId } })).toBe(
        0,
      );
    });

    it('at boot removes a job whose schedule is gone and keeps the live one', async () => {
      const live = await createSchedule();
      fakeQueue.getJobSchedulers.mockResolvedValue([
        { key: `${SCHEDULER_PREFIX}${live.id}` },
        { key: `${SCHEDULER_PREFIX}${randomUUID()}` },
        { key: 'something-else' },
      ]);
      await schedules.reconcile();
      expect(fakeQueue.removeJobScheduler).toHaveBeenCalledTimes(1);
      expect(fakeQueue.removeJobScheduler).not.toHaveBeenCalledWith(
        `${SCHEDULER_PREFIX}${live.id}`,
      );
    });
  });

  describe('a schedule fires', () => {
    it('emails each eligible person a link to a run that is theirs, with no row data in the email', async () => {
      const suspended = await person(UserRole.ACCOUNTANT, { status: 'SUSPENDED' });
      const noEmail = await person(UserRole.ACCOUNTANT, { email: null });
      const otherSchool = await fx.school();
      const elsewhere = await person(UserRole.ACCOUNTANT, { tenant: otherSchool });
      const schedule = await createSchedule({
        // A teacher and a committee member may open reports but may not take files out: no link for them.
        recipient_roles: [
          UserRole.ADMIN,
          UserRole.ACCOUNTANT,
          UserRole.TEACHER,
          UserRole.COMMITTEE,
        ],
      });

      const outcome = await processor.fire(schedule.id, tenantId);

      expect(outcome).toEqual({
        status: 'SENT',
        sent: 2,
        failed: 0,
        skippedRoles: [UserRole.TEACHER, UserRole.COMMITTEE],
      });
      expect(sentTo()).toHaveLength(2);
      for (const userId of [adminUser, accountantUser]) {
        const [run] = await runsOf(userId);
        expect(run.kind).toBe(ReportRunKind.SCHEDULED);
        expect(run.status).toBe(ReportRunStatus.DONE);
        // The link names the run of the person it was sent to, never somebody else's.
        const mail = sentTo().find((m) => m.message_body.includes(`/reports/runs/${run.id}`));
        expect(mail).toBeDefined();
        expect(mail?.message_body).toContain('https://app.example.test/reports/runs/');
      }
      for (const mail of sentTo()) {
        expect(mail.medium).toBe('EMAIL');
        expect(mail).not.toHaveProperty('attachments');
        // No row data: not a student name, not a religion value.
        expect(mail.message_body + mail.subject).not.toMatch(/Rahim|Sumon|ISLAM|HINDU/i);
        expect(mail.subject).toContain('Student list');
        // The words are the glossary's (D21): "your report is ready", never schedule, snapshot or cron.
        expect(mail.message_body).toContain('আপনার রিপোর্ট প্রস্তুত');
        expect(mail.message_body).toContain('Your report is ready');
        expect(mail.message_body + mail.subject).not.toMatch(/schedul|snapshot|cron|নিয়মিত/i);
      }
      // Nobody outside the allowed set got a run or a mail.
      for (const userId of [suspended, noEmail, elsewhere]) {
        expect(await ds.getRepository(ReportRun).count({ where: { run_by: userId } })).toBe(0);
      }
      const saved = await ds.getRepository(ReportSchedule).findOneByOrFail({ id: schedule.id });
      expect(saved.last_run_id).not.toBeNull();
    });

    it("builds each person's file for their own role: the accountant's copy has no religion column", async () => {
      const schedule = await createSchedule();
      await processor.fire(schedule.id, tenantId);

      const [adminRun] = await runsOf(adminUser);
      const [accountantRun] = await runsOf(accountantUser);
      expect(header(adminRun)).toHaveLength(2);
      expect(header(accountantRun)).toHaveLength(1);
      expect(csvOf(adminRun)).toContain('ISLAM');
      expect(csvOf(accountantRun)).not.toMatch(/ISLAM|HINDU/);
    });

    it('sends nothing to a role that may not see the report (visible_roles)', async () => {
      await ds
        .getRepository(ReportDefinition)
        .update({ id: definition.id }, { visible_roles: [UserRole.ADMIN] });
      const schedule = await createSchedule();
      const outcome = await processor.fire(schedule.id, tenantId);

      expect(outcome).toMatchObject({
        status: 'SENT',
        sent: 1,
        skippedRoles: [UserRole.ACCOUNTANT],
      });
      expect(await runsOf(accountantUser)).toHaveLength(0);
      expect(sentTo()).toHaveLength(1);
    });

    it('sends no email for a person whose file failed', async () => {
      const schedule = await createSchedule({ recipient_roles: [UserRole.ADMIN] });
      sources.register(DEFINITION_SOURCE, {
        header: () => ['x'],
        rows: async function* () {
          throw new Error('database went away');
        },
      });
      try {
        const outcome = await processor.fire(schedule.id, tenantId);
        expect(outcome).toMatchObject({ status: 'SENT', sent: 0, failed: 1 });
        expect(sentTo()).toHaveLength(0);
        const [run] = await runsOf(adminUser);
        expect(run.status).toBe(ReportRunStatus.FAILED);
      } finally {
        defSource.onModuleInit();
      }
    });

    it('an archived report skips and switches the schedule off, removing its job', async () => {
      const schedule = await createSchedule();
      await ds
        .getRepository(ReportDefinition)
        .update({ id: definition.id }, { status: ReportDefinitionStatus.ARCHIVED });

      expect(await processor.fire(schedule.id, tenantId)).toMatchObject({ status: 'DISABLED' });
      expect(sentTo()).toHaveLength(0);
      expect(await runsOf(adminUser)).toHaveLength(0);
      const saved = await ds.getRepository(ReportSchedule).findOneByOrFail({ id: schedule.id });
      expect(saved.active).toBe(false);
      expect(fakeQueue.removeJobScheduler).toHaveBeenCalledWith(
        `${SCHEDULER_PREFIX}${schedule.id}`,
      );
    });

    it('a creator who lost the right to design reports ends the schedule (never wider rights)', async () => {
      const schedule = await createSchedule();
      // The creator is moved from ADMIN to TEACHER: they can no longer design reports.
      await ds.query(
        `UPDATE user_tenants SET role = 'TEACHER' WHERE user_id = $1 AND tenant_id = $2`,
        [creator, tenantId],
      );
      expect(await processor.fire(schedule.id, tenantId)).toMatchObject({ status: 'DISABLED' });
      expect(sentTo()).toHaveLength(0);
      expect(
        (await ds.getRepository(ReportSchedule).findOneByOrFail({ id: schedule.id })).active,
      ).toBe(false);
    });

    it('a suspended creator ends the schedule too', async () => {
      const schedule = await createSchedule();
      await ds.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [creator]);
      expect(await processor.fire(schedule.id, tenantId)).toMatchObject({ status: 'DISABLED' });
      expect(sentTo()).toHaveLength(0);
    });

    it("another school's job does nothing: the schedule is looked up with the job's tenant", async () => {
      const schedule = await createSchedule();
      const other = await fx.school();
      expect(await processor.fire(schedule.id, other)).toMatchObject({ status: 'GONE' });
      expect(sentTo()).toHaveLength(0);
      expect(
        (await ds.getRepository(ReportSchedule).findOneByOrFail({ id: schedule.id })).active,
      ).toBe(true);
    });

    it('does nothing while the school is suspended or being restored, and keeps the schedule', async () => {
      const schedule = await createSchedule();
      tenantStatus.isRestoring.mockResolvedValue(true);
      expect(await processor.fire(schedule.id, tenantId)).toMatchObject({ status: 'SKIPPED' });
      tenantStatus.isRestoring.mockResolvedValue(false);
      tenantStatus.isActive.mockResolvedValue(false);
      expect(await processor.fire(schedule.id, tenantId)).toMatchObject({ status: 'SKIPPED' });
      expect(sentTo()).toHaveLength(0);
      expect(
        (await ds.getRepository(ReportSchedule).findOneByOrFail({ id: schedule.id })).active,
      ).toBe(true);
    });
  });

  describe('snapshots', () => {
    const sourceRun = async (userId: string, role: UserRole = UserRole.ADMIN) => {
      const schedule = await createSchedule({ recipient_roles: [role] });
      await processor.fire(schedule.id, tenantId);
      const [run] = await runsOf(userId);
      return run;
    };
    const viewer = (userId: string, role: UserRole) => ({ tenantId, userId, role });
    const bytes = async (file: { getStream(): NodeJS.ReadableStream }) => {
      const chunks: Buffer[] = [];
      for await (const c of file.getStream()) chunks.push(Buffer.from(c as Buffer));
      return Buffer.concat(chunks).toString('utf8');
    };

    it('copies the file under its own key and survives the export cleanup, never expiring', async () => {
      const run = await sourceRun(adminUser);
      const snap = await snapshots.freeze(viewer(adminUser, UserRole.ADMIN), run.id, {
        as_of: '2026-10-30',
        label: 'Month end',
      });
      const row = await ds.getRepository(ReportSnapshot).findOneByOrFail({ id: snap.id });
      expect(row.storage_key).toBe(`tenants/${tenantId}/report-snapshots/${snap.id}.csv`);
      expect(row.storage_key).not.toBe(run.storage_key);
      expect(row).toMatchObject({ as_of: '2026-10-30', label: 'Month end', created_by: adminUser });

      // A day and more later the export file is deleted; the kept copy is not.
      const removed = await cleanup.cleanExpired(new Date(Date.now() + 25 * 3_600_000));
      expect(removed).toBeGreaterThanOrEqual(1);
      const after = await ds.getRepository(ReportRun).findOneByOrFail({ id: run.id });
      expect(after.storage_key).toBeNull();
      expect(stored.has(row.storage_key)).toBe(true);

      const file = await snapshots.download(viewer(adminUser, UserRole.ADMIN), snap.id);
      expect(await bytes(file)).toContain('Rahim Uddin');
    });

    it('re-runs a run that has no file, for the caller own role', async () => {
      const screenRun = await runLog.start({
        tenantId,
        userId: accountantUser,
        kind: ReportRunKind.RUN,
        definitionVersionId: version.id,
        params: {},
      });
      const snap = await snapshots.freeze(
        viewer(accountantUser, UserRole.ACCOUNTANT),
        screenRun.id,
        {},
      );
      const row = await ds.getRepository(ReportSnapshot).findOneByOrFail({ id: snap.id });
      expect(row.as_of).toBe('2026-10-31'); // the school's today
      // The accountant's copy never carries the ADMIN-only column.
      expect(stored.get(row.storage_key)?.toString('utf8')).not.toMatch(/ISLAM|HINDU/);
    });

    it('lets only the maker or an ADMIN read a copy, and checks the report again on every download', async () => {
      const run = await sourceRun(accountantUser, UserRole.ACCOUNTANT);
      const snap = await snapshots.freeze(viewer(accountantUser, UserRole.ACCOUNTANT), run.id, {});

      // The maker and an ADMIN can read it.
      await snapshots.download(viewer(accountantUser, UserRole.ACCOUNTANT), snap.id);
      await snapshots.download(viewer(adminUser, UserRole.ADMIN), snap.id);
      // A different accountant cannot; neither can a role that may not take files out.
      const colleague = await person(UserRole.ACCOUNTANT);
      await expect(
        snapshots.download(viewer(colleague, UserRole.ACCOUNTANT), snap.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        snapshots.download(viewer(colleague, UserRole.TEACHER), snap.id),
      ).rejects.toMatchObject({ status: 404 });
      // Another school never finds it.
      const other = await fx.school();
      await expect(
        snapshots.download({ tenantId: other, userId: adminUser, role: UserRole.ADMIN }, snap.id),
      ).rejects.toMatchObject({ status: 404 });

      // The list shows only what the caller could download.
      expect(
        (await snapshots.list(viewer(accountantUser, UserRole.ACCOUNTANT), {})).items,
      ).toHaveLength(1);
      expect((await snapshots.list(viewer(colleague, UserRole.ACCOUNTANT), {})).items).toHaveLength(
        0,
      );
      expect((await snapshots.list(viewer(colleague, UserRole.TEACHER), {})).items).toHaveLength(0);

      // The report is later limited to ADMIN: the maker loses the copy at once, ADMIN keeps it.
      await ds
        .getRepository(ReportDefinition)
        .update({ id: definition.id }, { visible_roles: [UserRole.ADMIN] });
      await expect(
        snapshots.download(viewer(accountantUser, UserRole.ACCOUNTANT), snap.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await snapshots.list(viewer(accountantUser, UserRole.ACCOUNTANT), {})).items,
      ).toHaveLength(0);
      await snapshots.download(viewer(adminUser, UserRole.ADMIN), snap.id);
    });

    it('refuses what it cannot keep: another person run, a run of no report, a future date, a role that may not export', async () => {
      const run = await sourceRun(adminUser);
      await expect(
        snapshots.freeze(viewer(accountantUser, UserRole.ACCOUNTANT), run.id, {}),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        snapshots.freeze(viewer(adminUser, UserRole.ADMIN), randomUUID(), {}),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        snapshots.freeze(viewer(adminUser, UserRole.TEACHER), run.id, {}),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        snapshots.freeze(viewer(adminUser, UserRole.ADMIN), run.id, { as_of: '2026-11-01' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        snapshots.freeze(viewer(adminUser, UserRole.ADMIN), run.id, { as_of: '2026-02-30' }),
      ).rejects.toMatchObject({ status: 400 });
      const coded = await runLog.start({
        tenantId,
        userId: adminUser,
        kind: ReportRunKind.EXPORT,
        sourceKey: 'students-list',
      });
      await expect(
        snapshots.freeze(viewer(adminUser, UserRole.ADMIN), coded.id, {}),
      ).rejects.toMatchObject({ status: 422 });
      expect(await ds.getRepository(ReportSnapshot).count({ where: { tenant_id: tenantId } })).toBe(
        0,
      );
    });
  });
});
