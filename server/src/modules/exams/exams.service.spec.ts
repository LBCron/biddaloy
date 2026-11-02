import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ExamsService } from './exams.service';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { AuditService } from '../audit/audit.service';
import { ExamTemplatesService } from './exam-templates.service';
import { ExamKind, ExamStatus } from '@biddaloy/shared';
import { Result } from './entities/result.entity';
import { ResultsService } from './results.service';

/**
 * Unit tests for 19.3.1's `ExamsService` — exam CRUD, and the "class/year
 * can't change once marks exist" rule (issue rule #1). Tenant isolation is
 * covered by `findOne`'s `tenant_id` filter (same pattern proven by
 * `classes.service.spec.ts`).
 */

const TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';

function createRepoStub() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'new-id', ...v })),
    update: vi.fn(async () => undefined),
    findOne: vi.fn(async () => null),
    findAndCount: vi.fn(async () => [[], 0]),
    softDelete: vi.fn(async () => undefined),
  };
  // `assertNoLiveDependents` reads metadata + counts with a query builder. `repo.liveChildren`
  // lists many-to-one child tables that point at the exam, each with its live row count.
  repo.liveChildren = [] as { table: string; n: number }[];
  repo.manager = {
    transaction: vi.fn(async (cb: any) =>
      cb({
        getRepository: (e: any) => (e === Exam ? repo : repo.manager.getRepository(e)),
        connection: {
          entityMetadatas: repo.liveChildren.map((c: { table: string }) => ({
            name: c.table,
            tableName: c.table,
            target: c.table,
            manyToOneRelations: [
              {
                propertyName: 'exam',
                inverseEntityMetadata: { target: Exam },
                joinColumns: [{ databaseName: 'exam_id' }],
              },
            ],
          })),
        },
        createQueryBuilder: (target: string) => ({
          where() {
            return this;
          },
          leftJoin() {
            return this;
          },
          andWhere() {
            return this;
          },
          getCount: async () =>
            repo.liveChildren.find((c: { table: string }) => c.table === target)?.n ?? 0,
        }),
      }),
    ),
    getRepository: vi.fn((e: any) =>
      e === Result ? repo.resultRepo : { findOne: vi.fn(async () => null) },
    ),
  };
  repo.resultRepo = { count: vi.fn(async () => 0) };
  return repo;
}

async function buildService() {
  const examRepo = createRepoStub();
  const markRepo = { count: vi.fn(async () => 0) };
  // Default: the referenced class exists for the tenant and belongs to
  // academic year 'y1' — matches every existing test's fixture data, so
  // only the IDOR-guard-specific tests below need to override this.
  const classRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({
      id: where.id,
      tenant_id: where.tenant_id,
      academic_year_id: 'y1',
    })),
  };
  const yearRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const termRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const auditService = { record: vi.fn(async () => undefined) };
  const templatesService = { componentsFor: vi.fn(async () => []) };
  const resultsService = { recomputeProcessedExam: vi.fn(async () => 0) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ExamsService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(Mark), useValue: markRepo },
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
      { provide: getRepositoryToken(AcademicTerm), useValue: termRepo },
      { provide: AuditService, useValue: auditService },
      { provide: ExamTemplatesService, useValue: templatesService },
      { provide: ResultsService, useValue: resultsService },
    ],
  }).compile();

  return {
    service: moduleRef.get(ExamsService),
    examRepo,
    markRepo,
    classRepo,
    yearRepo,
    termRepo,
    auditService,
    templatesService,
    resultsService,
  };
}

describe('ExamsService CRUD', () => {
  it('creates an exam scoped to the tenant', async () => {
    const { service, examRepo } = await buildService();

    const exam = await service.create(
      { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
      TENANT_ID,
    );

    expect(exam).toMatchObject({ name: 'Term 1', tenant_id: TENANT_ID });
    expect(examRepo.save).toHaveBeenCalled();
  });

  it('finds an exam by id, scoped to tenant', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({ id: 'e1', tenant_id: TENANT_ID, name: 'Term 1' }));

    const exam = await service.findOne('e1', TENANT_ID);
    expect(exam).toMatchObject({ id: 'e1' });
  });

  it('lists exams filtered by tenant, year and class', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findAndCount = vi.fn(async () => [[{ id: 'e1' }], 1]);

    const result = await service.findAll(
      { academic_year_id: 'y1', class_id: 'c1' } as any,
      TENANT_ID,
    );

    expect(result).toMatchObject({ data: [{ id: 'e1' }], total: 1 });
    expect(examRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          academic_year_id: 'y1',
          class_id: 'c1',
        }),
        // The analysis screen reads `exam.class.name` straight off the list.
        relations: { class: true },
      }),
    );
  });

  it('updates a non-class/year field without checking marks', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
      name: 'Old',
    }));

    await service.update('e1', { name: 'New' } as any, TENANT_ID);

    expect(markRepo.count).not.toHaveBeenCalled();
    expect(examRepo.update).toHaveBeenCalledWith(
      { id: 'e1', tenant_id: TENANT_ID },
      { name: 'New' },
    );
  });

  it('create stores mark_entry_deadline; omitted means null', async () => {
    const { service } = await buildService();
    const base = { name: 'T', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' };

    const withDeadline = await service.create(
      { ...base, mark_entry_deadline: '2026-10-11' } as any,
      TENANT_ID,
    );
    const without = await service.create(base as any, TENANT_ID);

    expect(withDeadline.mark_entry_deadline).toBe('2026-10-11');
    expect(without.mark_entry_deadline).toBeNull();
  });

  it('update with mark_entry_deadline null clears it; an absent key leaves it alone', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
      mark_entry_deadline: '2026-10-11',
    }));

    await service.update('e1', { mark_entry_deadline: null } as any, TENANT_ID);
    expect(examRepo.update).toHaveBeenLastCalledWith(
      { id: 'e1', tenant_id: TENANT_ID },
      { mark_entry_deadline: null },
    );

    await service.update('e1', { name: 'Renamed' } as any, TENANT_ID);
    expect(examRepo.update).toHaveBeenLastCalledWith(
      { id: 'e1', tenant_id: TENANT_ID },
      { name: 'Renamed' },
    );
  });

  it('deletes (soft) an exam', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({ id: 'e1', tenant_id: TENANT_ID, name: 'Term 1' }));

    await service.remove('e1', TENANT_ID);

    expect(examRepo.softDelete).toHaveBeenCalledWith({ id: 'e1', tenant_id: TENANT_ID });
  });

  it("a request for another tenant's exam returns not-found, never another tenant's row", async () => {
    const { service, examRepo } = await buildService();
    // Repo stub simulates the tenant_id filter: querying as OTHER_TENANT_ID
    // never matches a row that belongs to TENANT_ID.
    examRepo.findOne = vi.fn(async () => null);

    await expect(service.findOne('e1', OTHER_TENANT_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('ExamsService class/year change guard (issue rule #1)', () => {
  it('allows changing class when no marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 0);

    await expect(service.update('e1', { class_id: 'c2' } as any, TENANT_ID)).resolves.toBeDefined();
    expect(markRepo.count).toHaveBeenCalledWith({ where: { exam_id: 'e1', tenant_id: TENANT_ID } });
  });

  it('rejects changing class once marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 3);

    await expect(service.update('e1', { class_id: 'c2' } as any, TENANT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(examRepo.update).not.toHaveBeenCalled();
  });

  it('rejects changing academic_year_id once marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 1);

    await expect(
      service.update('e1', { academic_year_id: 'y2' } as any, TENANT_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('does not reject when class/year are sent but unchanged', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 5);

    await expect(
      service.update('e1', { class_id: 'c1', academic_year_id: 'y1' } as any, TENANT_ID),
    ).resolves.toBeDefined();
  });
});

describe('ExamsService.create with template_id', () => {
  const base = {
    name: 'Term 1',
    kind: ExamKind.TERM,
    academic_year_id: 'y1',
    class_id: 'c1',
    template_id: 't1',
  } as any;

  it('unknown template -> 404 before any write', async () => {
    const { service, examRepo } = await buildService();
    await expect(service.create(base, TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(examRepo.save).not.toHaveBeenCalled();
  });

  it('class without numeric_grade -> 400 before any write', async () => {
    const { service, examRepo } = await buildService();
    examRepo.manager.getRepository = vi.fn(() => ({ findOne: vi.fn(async () => ({ id: 't1' })) }));
    await expect(service.create(base, TENANT_ID)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(base, TENANT_ID)).rejects.toMatchObject({
      response: { details: { code: 'CLASS_HAS_NO_GRADE' } },
    });
    expect(examRepo.save).not.toHaveBeenCalled();
  });

  it('without template_id the template service is never consulted', async () => {
    const { service, templatesService } = await buildService();
    const exam = await service.create({ ...base, template_id: undefined }, TENANT_ID);
    expect(exam.components_created).toBe(0);
    expect(templatesService.componentsFor).not.toHaveBeenCalled();
  });
});

describe('ExamsService tenant-reference guard (IDOR)', () => {
  it('unknown class: fixed message without the id (#3000)', async () => {
    const { service, classRepo } = await buildService();
    classRepo.findOne = vi.fn(async () => null);
    const err: any = await service
      .create(
        {
          name: 'Term 1',
          kind: ExamKind.TERM,
          academic_year_id: 'y1',
          class_id: 'secret-class-id',
        } as any,
        TENANT_ID,
      )
      .catch((e) => e);
    expect(err.message).toMatch(/^Class not found for this tenant\.$/);
    expect(err.message).not.toContain('secret-class-id');
  });

  it("rejects a class_id that doesn't belong to the tenant", async () => {
    const { service, classRepo } = await buildService();
    classRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        {
          name: 'Term 1',
          kind: ExamKind.TERM,
          academic_year_id: 'y1',
          class_id: 'other-tenant-class',
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a class whose academic_year_id does not match the given year', async () => {
    const { service, classRepo } = await buildService();
    classRepo.findOne = vi.fn(async ({ where }: any) => ({
      id: where.id,
      tenant_id: where.tenant_id,
      academic_year_id: 'y-different',
    }));

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an academic_year_id that doesn't belong to the tenant", async () => {
    const { service, yearRepo } = await buildService();
    yearRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an academic_term_id that doesn't belong to the tenant/year", async () => {
    const { service, termRepo } = await buildService();
    termRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        {
          name: 'Term 1',
          kind: ExamKind.TERM,
          academic_year_id: 'y1',
          class_id: 'c1',
          academic_term_id: 'other-tenant-term',
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-validates references on update when class_id/academic_year_id/academic_term_id is present', async () => {
    const { service, examRepo, classRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    classRepo.findOne = vi.fn(async () => null);

    await expect(
      service.update('e1', { class_id: 'other-tenant-class' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ExamsService duplicate-name mapping', () => {
  it('maps a unique-constraint violation on create to 409, not a raw 500', async () => {
    const { service, examRepo } = await buildService();
    examRepo.save = vi.fn(async () => {
      throw new QueryFailedError(
        'insert',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
    });

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('the create 409 carries EXAM_NAME_TAKEN and never echoes the submitted name', async () => {
    const { service, examRepo } = await buildService();
    examRepo.save = vi.fn(async () => {
      throw new QueryFailedError(
        'insert',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
    });
    const err: any = await service
      .create(
        { name: 'Secret Name', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      )
      .catch((e) => e);
    expect(err.response.details.code).toBe('EXAM_NAME_TAKEN');
    expect(JSON.stringify(err.response)).not.toContain('Secret Name');
  });
});

describe('ExamsService published guard (ACAD-05)', () => {
  const exam = (status: ExamStatus) => ({
    id: 'e1',
    tenant_id: TENANT_ID,
    class_id: 'c1',
    academic_year_id: 'y1',
    academic_term_id: 't1',
    name: 'Term 1',
    kind: ExamKind.TERM,
    status,
  });

  it('remove with live results is a 409 EXAM_HAS_RESULTS and deletes nothing', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PUBLISHED));
    examRepo.resultRepo.count = vi.fn(async () => 3);
    await expect(service.remove('e1', TENANT_ID)).rejects.toMatchObject({
      response: { details: { code: 'EXAM_HAS_RESULTS' } },
    });
    expect(examRepo.softDelete).not.toHaveBeenCalled();
  });

  it('remove with a final-result weight row is a 409 EXAM_IN_USE and deletes nothing [70.2.1]', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PUBLISHED));
    // No live results of its own, but a final result pins it with one share row.
    examRepo.liveChildren.push({ table: 'final_result_weights', n: 1 });
    await expect(service.remove('e1', TENANT_ID)).rejects.toMatchObject({
      response: {
        message: 'This exam is still used by other records. Remove or reassign them first.',
        details: { code: 'EXAM_IN_USE', dependents: { final_result_weights: 1 } },
      },
    });
    expect(examRepo.softDelete).not.toHaveBeenCalled();
  });

  it('a PUBLISHED exam can still be renamed', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PUBLISHED));
    await service.update('e1', { name: 'Renamed' } as any, TENANT_ID);
    expect(examRepo.update).toHaveBeenCalled();
  });

  it('a PUBLISHED exam kind change is a 409 EXAM_PUBLISHED', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PUBLISHED));
    await expect(
      service.update('e1', { kind: ExamKind.MONTHLY } as any, TENANT_ID),
    ).rejects.toMatchObject({ response: { details: { code: 'EXAM_PUBLISHED' } } });
    expect(examRepo.update).not.toHaveBeenCalled();
  });

  it('a PUBLISHED exam with no Mark rows still cannot move class or year (409 EXAM_PUBLISHED)', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PUBLISHED));
    await expect(service.update('e1', { class_id: 'c2' } as any, TENANT_ID)).rejects.toMatchObject({
      response: { details: { code: 'EXAM_PUBLISHED' } },
    });
    await expect(
      service.update('e1', { academic_year_id: 'y2' } as any, TENANT_ID),
    ).rejects.toMatchObject({ response: { details: { code: 'EXAM_PUBLISHED' } } });
    expect(examRepo.update).not.toHaveBeenCalled();
  });

  it('a PROCESSED exam term change recomputes in the transaction', async () => {
    const { service, examRepo, resultsService } = await buildService();
    examRepo.findOne = vi.fn(async () => exam(ExamStatus.PROCESSED));
    await service.update('e1', { academic_term_id: 't2' } as any, TENANT_ID, 'u1');
    expect(resultsService.recomputeProcessedExam).toHaveBeenCalledTimes(1);
  });
});
