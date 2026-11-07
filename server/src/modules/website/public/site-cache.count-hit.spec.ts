import { describe, it, expect, vi } from 'vitest';
import { SiteCacheService } from './site-cache.service';

/** A redis whose INCR works but EXPIRE would fail: only an atomic call can survive it. */
function redisWith(eval_: (...a: unknown[]) => unknown) {
  return {
    eval: vi.fn(eval_),
    incr: vi.fn(),
    expire: vi.fn(async () => {
      throw new Error('expire failed');
    }),
  };
}

describe('SiteCacheService.countHit', () => {
  it('counts and sets the window in ONE atomic call, never INCR then EXPIRE', async () => {
    const redis = redisWith(async () => 3);
    const n = await new SiteCacheService(redis as never).countHit('k', 60);
    expect(n).toBe(3);
    expect(redis.eval).toHaveBeenCalledTimes(1);
    const args = redis.eval.mock.calls[0];
    expect(args[0]).toContain("redis.call('INCR'");
    expect(args[0]).toContain("redis.call('EXPIRE'");
    expect(args.slice(1)).toEqual([1, 'k', 60]);
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('heals a counter that lost its expiry (the script also sets one when TTL is missing)', async () => {
    const redis = redisWith(async () => 9);
    await new SiteCacheService(redis as never).countHit('k', 60);
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('TTL'");
  });

  it('Redis down: null (callers decide), never throws', async () => {
    const redis = redisWith(async () => {
      throw new Error('down');
    });
    expect(await new SiteCacheService(redis as never).countHit('k', 60)).toBeNull();
  });
});
