import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { UserRole, UserStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { UserTenant } from '../../auth/entities/user-tenant.entity';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import { AdminNoticeService } from './admin-notice.service';

describe('AdminNoticeService (integration)', () => {
  let ds: DataSource;
  let svc: AdminNoticeService;
  const send = vi.fn().mockResolvedValue({
    success: true,
    providerMessageId: 'pm-1',
    provider: 'smtp',
    source: 'platform',
  });
  const registry = { resolve: () => ({ send }) };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      AdminNoticeService,
      { provide: CommunicationProviderRegistryService, useValue: registry },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(AdminNoticeService);
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const school = async (locale?: string): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Notice ${id.slice(0, 6)}`,
      slug: `notice-${id.slice(0, 8)}`,
      settings: locale ? { region: { locale } } : null,
    });
    return id;
  };
  const member = async (
    tenantId: string,
    role: UserRole,
    status: UserStatus,
    tag: string,
  ): Promise<string> => {
    const uid = randomUUID();
    await ds.getRepository(User).save({
      id: uid,
      email: `${tag}-${uid}@notice.test`,
      phone: null,
      password_hash: 'x',
      full_name: tag,
      status,
    });
    await ds.getRepository(UserTenant).save({ user_id: uid, tenant_id: tenantId, role });
    return `${tag}-${uid}@notice.test`;
  };

  it('emails only ACTIVE ADMINs of that school, in bn for a bn school, and logs each send', async () => {
    send.mockClear();
    const a = await school('bn');
    const b = await school();
    const admin = await member(a, UserRole.ADMIN, UserStatus.ACTIVE, 'admin');
    await member(a, UserRole.ADMIN, UserStatus.INACTIVE, 'inactive-admin');
    await member(a, UserRole.TEACHER, UserStatus.ACTIVE, 'teacher');
    await member(b, UserRole.ADMIN, UserStatus.ACTIVE, 'other-tenant-admin');

    await svc.notifyAdmins(a, 'welcome');

    expect(send).toHaveBeenCalledTimes(1);
    const [params, tenantId] = send.mock.calls[0];
    expect(params.to).toBe(admin);
    expect(tenantId).toBe(a);
    // The notice is the platform talking to the school's admins, so it may use the platform SMS
    // keys even when the school has no gateway of its own (#2233 would otherwise refuse it).
    expect(params.allowPlatformSms).toBe(true);
    expect(params.body).toContain('স্বাগতম'); // bn template
    const logs = await ds.query(
      `SELECT recipient_address, status, tenant_id, metadata FROM communication_logs WHERE tenant_id = $1`,
      [a],
    );
    expect(logs).toEqual([
      {
        recipient_address: admin,
        status: 'SENT',
        tenant_id: a,
        metadata: { kind: 'welcome', provider: 'smtp', source: 'platform' },
      },
    ]);
  });

  it('renders bn for bn-BD and for no stored region (the bn-BD default), en for en-BD (#3041)', async () => {
    send.mockClear();
    const bn = await school('bn-BD');
    const unset = await school();
    const en = await school('en-BD');
    await member(bn, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-bn');
    await member(unset, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-unset');
    await member(en, UserRole.ADMIN, UserStatus.ACTIVE, 'admin-en');

    await svc.notifyAdmins(bn, 'welcome');
    await svc.notifyAdmins(unset, 'welcome');
    await svc.notifyAdmins(en, 'welcome');

    expect(send.mock.calls[0][0].body).toContain('স্বাগতম');
    expect(send.mock.calls[1][0].body).toContain('স্বাগতম');
    expect(send.mock.calls[2][0].body).toContain('Welcome!');
  });
});
