import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { NoticeStatus } from '@biddaloy/shared';
import { NoticesService } from '../modules/notices/notices.service';
import { NoticeRecipientsService } from '../modules/notices/notice-recipients.service';
import { E2E_NOTICE_TITLE, ensureNoticeSeed } from './seed.notices';

/** A fake app context: `existing` is the notice row a re-run would find, `found` the demo rows. */
function fakeApp(existing: boolean, found: boolean) {
  const create = vi.fn().mockResolvedValue({ id: 'n1' });
  const add = vi.fn().mockResolvedValue(undefined);
  const publish = vi.fn().mockResolvedValue({ status: NoticeStatus.PUBLISHED });
  const ds = {
    getRepository: () => ({ findOne: async () => (existing ? { id: 'old' } : null) }),
    query: async () => (found ? [{ id: 'row' }] : []),
  };
  const services = new Map<unknown, unknown>([
    [DataSource, ds],
    [NoticesService, { create, publish }],
    [NoticeRecipientsService, { add }],
  ]);
  const app = { get: (token: unknown) => services.get(token) } as never;
  return { app, create, add, publish };
}

describe('ensureNoticeSeed', () => {
  it('writes and publishes one notice for the demo guardian', async () => {
    const { app, create, add, publish } = fakeApp(false, true);
    await ensureNoticeSeed(app, 'tenant', 'admin');
    expect(create).toHaveBeenCalledWith('tenant', expect.anything(), {
      title: E2E_NOTICE_TITLE,
      body: expect.any(String),
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a re-run (the notice already exists)', async () => {
    const { app, create } = fakeApp(true, true);
    await ensureNoticeSeed(app, 'tenant', 'admin');
    expect(create).not.toHaveBeenCalled();
  });

  it('skips when the demo student or guardian is missing', async () => {
    const { app, create } = fakeApp(false, false);
    await ensureNoticeSeed(app, 'tenant', 'admin');
    expect(create).not.toHaveBeenCalled();
  });
});
