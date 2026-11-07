import { describe, expect, it, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';

/** [40.2.05] The `website` checklist item: listed only on a yes, done only when the site is on. */
function build(onboarding: Record<string, unknown> | null, site: { enabled: boolean } | null) {
  const manager = {
    count: vi.fn().mockResolvedValue(0),
    findOne: vi.fn().mockResolvedValue(site),
    createQueryBuilder: () => ({
      select: () => ({
        where: () => ({ getRawOne: () => Promise.resolve({ n: '0' }) }),
      }),
    }),
  };
  const dataSource = {
    manager,
    getRepository: () => ({
      findOne: () => Promise.resolve({ id: 't1', name: 'S', onboarding, trial_ends_at: null }),
    }),
  };
  const schools = { getResolvedSettings: () => Promise.resolve({ communications: {} }) };
  const config = { get: () => null };
  const service = new OnboardingService(
    dataSource as never,
    schools as never,
    {} as never,
    config as never,
  );
  return { service, manager };
}

const websiteItem = (s: { items: { id: string; done: boolean }[] }) =>
  s.items.find((i) => i.id === 'website');

describe('OnboardingService website item', () => {
  it('is absent when the school never answered, and the site table is not read', async () => {
    const { service, manager } = build(null, null);
    expect(websiteItem(await service.getStatus('t1', 'u1'))).toBeUndefined();
    expect(manager.findOne).not.toHaveBeenCalled();
  });

  it('is absent after a no', async () => {
    const { service } = build({ wants_website: false }, { enabled: true });
    expect(websiteItem(await service.getStatus('t1', 'u1'))).toBeUndefined();
  });

  it('is listed and not done after a yes with no site row', async () => {
    const { service } = build({ wants_website: true }, null);
    expect(websiteItem(await service.getStatus('t1', 'u1'))).toEqual({
      id: 'website',
      done: false,
    });
  });

  it('is not done while the site is off, done once it is on', async () => {
    const off = build({ wants_website: true }, { enabled: false });
    expect(websiteItem(await off.service.getStatus('t1', 'u1'))?.done).toBe(false);
    const on = build({ wants_website: true }, { enabled: true });
    expect(websiteItem(await on.service.getStatus('t1', 'u1'))?.done).toBe(true);
  });
});
