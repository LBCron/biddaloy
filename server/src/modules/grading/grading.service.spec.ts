import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { GradingService } from './grading.service';

import { GradingScale } from './entities/grading-scale.entity';

/**
 * `assertNoLiveDependents` reads TypeORM metadata and counts with a query builder. This fake
 * models one many-to-one child table: `liveChildren` rows point at the scale.
 */
function fakeManager(
  scaleRepo: any,
  bandRepo: any,
  liveChildren: { table: string; n: number }[] = [],
) {
  return {
    getRepository: vi.fn((entity: any) => (entity?.name === 'GradingBand' ? bandRepo : scaleRepo)),
    connection: {
      entityMetadatas: liveChildren.map((c) => ({
        name: c.table,
        tableName: c.table,
        target: c.table,
        manyToOneRelations: [
          {
            propertyName: 'grading_scale',
            inverseEntityMetadata: { target: GradingScale },
            joinColumns: [{ databaseName: 'grading_scale_id' }],
          },
        ],
        liveCount: c.n,
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
      getCount: async () => liveChildren.find((c) => c.table === target)?.n ?? 0,
    }),
  };
}

describe('GradingService', () => {
  let scaleRepo: any;
  let bandRepo: any;
  let academicYearRepo: any;
  let classRepo: any;
  let resultRepo: any;
  let dataSource: any;
  let auditService: any;
  let service: GradingService;

  const TENANT = 'tenant-1';
  const YEAR = 'year-1';

  beforeEach(() => {
    scaleRepo = {
      findOne: vi.fn(),
      find: vi.fn(async () => []),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => ({ id: 'scale-1', ...v })),
      update: vi.fn(async () => ({ affected: 1 })),
      softDelete: vi.fn(async () => ({ affected: 1 })),
    };
    bandRepo = {
      find: vi.fn(async () => []),
      create: vi.fn((v: any) => v),
      save: vi.fn(async (v: any) => v),
      softDelete: vi.fn(async () => ({ affected: 1 })),
    };
    academicYearRepo = { findOne: vi.fn(async () => ({ id: YEAR, tenant_id: TENANT })) };
    classRepo = { findOne: vi.fn(async () => ({ id: 'class-1', tenant_id: TENANT })) };
    resultRepo = { count: vi.fn(async () => 0) };
    auditService = { record: vi.fn() };
    dataSource = { transaction: vi.fn(async (cb: any) => cb(fakeManager(scaleRepo, bandRepo))) };

    service = new GradingService(
      scaleRepo,
      bandRepo,
      academicYearRepo,
      classRepo,
      resultRepo,
      dataSource,
      auditService,
    );
  });

  describe('create', () => {
    it('refuses a duplicate default scale for the same year', async () => {
      scaleRepo.findOne.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.create(TENANT, 'user-1', { academic_year_id: YEAR, name: 'Default' }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses an academic year outside the tenant', async () => {
      academicYearRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.create(TENANT, 'user-1', { academic_year_id: YEAR, name: 'Default' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates and audits a new scale', async () => {
      scaleRepo.findOne.mockResolvedValueOnce(null);
      const scale = await service.create(TENANT, 'user-1', {
        academic_year_id: YEAR,
        name: 'Default',
      });
      expect(scale.name).toBe('Default');
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove [68.2.12]', () => {
    beforeEach(() => {
      scaleRepo.findOne.mockResolvedValue({ id: 'scale-1', tenant_id: TENANT, name: 'Default' });
    });

    it('throws GRADING_SCALE_IN_USE when a live result references the scale', async () => {
      resultRepo.count.mockResolvedValueOnce(3);
      await expect(service.remove('scale-1', TENANT, 'user-1')).rejects.toMatchObject({
        response: { details: { code: 'GRADING_SCALE_IN_USE', count: 3 } },
      });
      expect(scaleRepo.softDelete).not.toHaveBeenCalled();
      expect(bandRepo.softDelete).not.toHaveBeenCalled();
    });

    it('refuses a scale a final result row uses [70.2.1] and deletes nothing', async () => {
      dataSource.transaction = vi.fn(async (cb: any) =>
        cb(fakeManager(scaleRepo, bandRepo, [{ table: 'final_result_rows', n: 2 }])),
      );
      await expect(service.remove('scale-1', TENANT, 'user-1')).rejects.toMatchObject({
        response: {
          message: 'Published or processed results use this grading scale. It cannot be deleted.',
          details: { code: 'GRADING_SCALE_IN_USE', dependents: { final_result_rows: 2 } },
        },
      });
      expect(scaleRepo.softDelete).not.toHaveBeenCalled();
      expect(bandRepo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes the scale and bands when no result references it', async () => {
      await service.remove('scale-1', TENANT, 'user-1');
      expect(scaleRepo.softDelete).toHaveBeenCalledWith({ id: 'scale-1', tenant_id: TENANT });
      expect(bandRepo.softDelete).toHaveBeenCalledWith({ scale_id: 'scale-1', tenant_id: TENANT });
    });
  });

  describe('copy', () => {
    function withScales(sourceId: string, targetId: string) {
      scaleRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where.id === sourceId) return { id: sourceId, name: 'Source' };
        if (where.id === targetId) return { id: targetId, name: 'Target' };
        return null;
      });
    }

    it('copies bands into an empty target', async () => {
      withScales('source', 'target');
      bandRepo.find.mockImplementation(async ({ where }: any) =>
        where.scale_id === 'source'
          ? [{ id: 'b1', percent_from: 0, percent_to: 100, grade: 'A', sequence: 1 }]
          : [],
      );
      const result = await service.copy('source', 'target', TENANT, 'user-1');
      expect(result).toHaveLength(1);
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('refuses to copy into a target that already has bands', async () => {
      withScales('source', 'target');
      bandRepo.find.mockImplementation(async ({ where }: any) =>
        where.scale_id === 'source'
          ? [{ id: 'b1', percent_from: 0, percent_to: 100, grade: 'A', sequence: 1 }]
          : [{ id: 'b2', percent_from: 0, percent_to: 100, grade: 'B', sequence: 1 }],
      );
      await expect(service.copy('source', 'target', TENANT, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      // Never partially applied — the write path isn't even reached.
      expect(bandRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to copy an empty source', async () => {
      withScales('source', 'target');
      bandRepo.find.mockResolvedValue([]);
      await expect(service.copy('source', 'target', TENANT, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
