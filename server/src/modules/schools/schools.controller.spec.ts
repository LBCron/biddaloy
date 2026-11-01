import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import type { JwtPayload } from '@biddaloy/shared';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { PlatformSuperAdminGuard } from '../auth/guards/platform-super-admin.guard';
import { TenantSettingsDto } from './dto/tenant-settings.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeService() {
  return {
    findAll: vi.fn(),
    getMaskedSettings: vi.fn(),
    updateSettings: vi.fn(),
    getStats: vi.fn(),
    updateStatus: vi.fn(),
  };
}

describe('SchoolsController', () => {
  let service: ReturnType<typeof fakeService>;
  let controller: SchoolsController;

  beforeEach(() => {
    service = fakeService();
    controller = new SchoolsController(service as unknown as SchoolsService);
  });

  describe('findAll', () => {
    it('delegates to the service', async () => {
      const school = {
        id: SCHOOL_A,
        name: 'A School',
        slug: 'a-school',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
      };
      service.findAll.mockResolvedValue([school]);

      const result = await controller.findAll({});

      expect(service.findAll).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([school]);
    });
  });

  describe('getStats', () => {
    it('delegates to the service', async () => {
      const stats = {
        active_users: 4,
        students: 30,
        communications_queued: 2,
        communications_failed_7d: 1,
        last_activity_at: new Date('2026-09-01T00:00:00Z'),
      };
      service.getStats.mockResolvedValue(stats);

      const result = await controller.getStats(SCHOOL_A);

      expect(service.getStats).toHaveBeenCalledWith(SCHOOL_A);
      expect(result).toEqual(stats);
    });
  });

  describe('getSettings', () => {
    it('delegates to the service when an ADMIN reads their own school', async () => {
      service.getMaskedSettings.mockResolvedValue({ version: 1 });

      const result = await controller.getSettings(SCHOOL_A, { id: SCHOOL_A, role: 'ADMIN' });

      expect(service.getMaskedSettings).toHaveBeenCalledWith(SCHOOL_A);
      expect(result).toEqual({ version: 1 });
    });

    it('delegates to the service when a SUPER_ADMIN reads a school outside their own tenant', async () => {
      service.getMaskedSettings.mockResolvedValue({ version: 1 });

      await controller.getSettings(SCHOOL_A, { id: SCHOOL_B, role: 'SUPER_ADMIN' });

      expect(service.getMaskedSettings).toHaveBeenCalledWith(SCHOOL_A);
    });

    it('rejects an ADMIN reading a different school, without calling the service at all', async () => {
      await expect(
        controller.getSettings(SCHOOL_A, { id: SCHOOL_B, role: 'ADMIN' }),
      ).rejects.toThrow(ForbiddenException);
      expect(service.getMaskedSettings).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    function patch(): TenantSettingsDto {
      return plainToInstance(TenantSettingsDto, { version: 1 });
    }

    it('updates and returns the masked settings the service already produced, without a second read', async () => {
      service.updateSettings.mockResolvedValue({ version: 1, masked: true });

      const result = await controller.updateSettings(
        SCHOOL_A,
        patch(),
        { id: SCHOOL_A, role: 'ADMIN' },
        USER,
        REQUEST,
      );

      expect(service.updateSettings).toHaveBeenCalledWith(
        SCHOOL_A,
        expect.any(TenantSettingsDto),
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
        false,
      );
      // updateSettings already returns the masked shape — no follow-up
      // getMaskedSettings call, which would be a redundant query and a
      // window for the response to reflect someone else's write.
      expect(service.getMaskedSettings).not.toHaveBeenCalled();
      expect(result).toEqual({ version: 1, masked: true });
    });

    it('delegates for a SUPER_ADMIN writing a school outside their own tenant', async () => {
      service.updateSettings.mockResolvedValue({ version: 1 });

      await controller.updateSettings(
        SCHOOL_A,
        patch(),
        { id: SCHOOL_B, role: 'SUPER_ADMIN' },
        USER,
        { ...REQUEST, isPlatformSuperAdmin: true },
      );

      expect(service.updateSettings).toHaveBeenCalledWith(
        SCHOOL_A,
        expect.any(TenantSettingsDto),
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
        true,
      );
    });

    it('does not treat a legacy tenant-local SUPER_ADMIN as the platform (#3346)', async () => {
      service.updateSettings.mockResolvedValue({ version: 1 });

      await controller.updateSettings(
        SCHOOL_A,
        patch(),
        { id: SCHOOL_A, role: 'SUPER_ADMIN' },
        USER,
        { ...REQUEST, isPlatformSuperAdmin: false },
      );

      expect(service.updateSettings).toHaveBeenCalledWith(
        SCHOOL_A,
        expect.any(TenantSettingsDto),
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
        false,
      );
    });

    it('rejects an ADMIN writing a different school, without touching the service', async () => {
      await expect(
        controller.updateSettings(
          SCHOOL_A,
          patch(),
          { id: SCHOOL_B, role: 'ADMIN' },
          USER,
          REQUEST,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(service.updateSettings).not.toHaveBeenCalled();
      expect(service.getMaskedSettings).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('delegates to the service with actor and request context', async () => {
      const response = {
        id: SCHOOL_A,
        status: 'SUSPENDED' as const,
        status_reason: 'Non-payment for 60 days',
        status_changed_at: new Date('2026-09-07T00:00:00Z'),
      };
      service.updateStatus.mockResolvedValue(response);

      const result = await controller.updateStatus(
        SCHOOL_A,
        { status: 'SUSPENDED', reason: 'Non-payment for 60 days' },
        USER,
        REQUEST,
      );

      expect(service.updateStatus).toHaveBeenCalledWith(
        SCHOOL_A,
        { status: 'SUSPENDED', reason: 'Non-payment for 60 days' },
        'user-1',
        { ip: '127.0.0.1', userAgent: 'vitest' },
      );
      expect(result).toEqual(response);
    });
  });

  describe('platform-only routes', () => {
    it.each(['findAll', 'getStats', 'updateStatus'] as const)(
      '%s is platform-only: SUPER_ADMIN role plus PlatformSuperAdminGuard',
      (name) => {
        const handler = SchoolsController.prototype[name];
        expect(Reflect.getMetadata('roles', handler)).toEqual(['SUPER_ADMIN']);
        expect(Reflect.getMetadata('__guards__', handler)).toContain(PlatformSuperAdminGuard);
      },
    );
  });
});
