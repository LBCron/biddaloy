import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { SiteCacheService } from './site-cache.service';

describe('SiteCacheService (real Redis)', () => {
  let redis: Redis;
  let service: SiteCacheService;
  // Unique per run so two copies of the suite sharing one Redis never touch each other's keys.
  const tenant = `it-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    service = new SiteCacheService(redis);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // invalidate() leaves content keys to the version bump, so tests clear their own.
    await redis.del(
      service.contentKey(tenant, 1, 'manifest'),
      service.contentKey(tenant, 2, 'manifest'),
      service.contentKey(tenant, 1, 'page:home'),
      service.feedKey(tenant, 'notices'),
    );
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('hits within a version and misses on the next one', async () => {
    const load = vi.fn().mockResolvedValue({ a: 1 });
    await service.getOrLoad(tenant, 1, 'manifest', load);
    await service.getOrLoad(tenant, 1, 'manifest', load);
    expect(load).toHaveBeenCalledTimes(1);
    await service.getOrLoad(tenant, 2, 'manifest', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps feeds apart from content and gives them a 60 s ttl', async () => {
    await service.getOrLoadFeed(tenant, 'notices', async () => [1]);
    expect(await redis.ttl(service.feedKey(tenant, 'notices'))).toBeLessThanOrEqual(60);
    expect(await redis.exists(service.contentKey(tenant, 0, 'notices'))).toBe(0);
  });

  it('invalidate drops the feeds of one tenant only and leaves content keys to the version', async () => {
    const other = `it-${randomUUID().slice(0, 8)}`;
    const scan = vi.spyOn(redis, 'scan');
    await service.getOrLoad(tenant, 1, 'manifest', async () => 'x');
    await service.getOrLoadFeed(tenant, 'notices', async () => [1]);
    await service.getOrLoadFeed(other, 'notices', async () => [2]);
    await service.invalidate(tenant);
    expect(await redis.exists(service.feedKey(tenant, 'notices'))).toBe(0);
    expect(await redis.exists(service.feedKey(other, 'notices'))).toBe(1);
    // Unreachable after a publish (the next read asks for version 2), so no delete is needed.
    expect(await redis.exists(service.contentKey(tenant, 1, 'manifest'))).toBe(1);
    // Never walks the shared keyspace.
    expect(scan).not.toHaveBeenCalled();
    await redis.del(service.feedKey(other, 'notices'));
  });

  it('Redis down: the loader still runs and nothing throws', async () => {
    const down = () => Promise.reject(new Error('redis down'));
    vi.spyOn(redis, 'get').mockImplementation(down as never);
    vi.spyOn(redis, 'set').mockImplementation(down as never);
    vi.spyOn(redis, 'del').mockImplementation(down as never);
    const load = vi.fn().mockResolvedValue('page');
    await expect(service.getOrLoad(tenant, 1, 'page:home', load)).resolves.toBe('page');
    expect(load).toHaveBeenCalledTimes(1);
    await expect(service.invalidate(tenant)).resolves.toBeUndefined();
  });
});
