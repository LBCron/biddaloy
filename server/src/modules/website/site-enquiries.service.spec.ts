import { describe, it, expect, vi } from 'vitest';
import { SiteSectionKey } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import {
  ENQUIRY_SMS_HOURLY_CAP,
  SiteEnquiriesService,
  officeSmsOn,
} from './site-enquiries.service';

const config = (data: Record<string, unknown>) =>
  ({
    pages: [
      {
        page: 'contact',
        enabled: true,
        sections: [{ key: SiteSectionKey.CONTACT, enabled: true, data }],
      },
    ],
  }) as unknown as SiteConfig;

const dto = { name: 'Rahim', phone: '01712345678', message: 'Hi', captcha_token: 't' };

describe('officeSmsOn', () => {
  it('is off unless the contact section says exactly true', () => {
    expect(officeSmsOn(config({}))).toBe(false);
    expect(officeSmsOn(config({ enquirySmsToOffice: 'true' }))).toBe(false);
    expect(officeSmsOn(config({ enquirySmsToOffice: true }))).toBe(true);
  });
});

describe('SiteEnquiriesService.createPublic', () => {
  let hits = 1;
  const countHit = vi.fn(async () => hits);
  const make = (enqueue = vi.fn().mockResolvedValue({})) => {
    hits = 1;
    const insert = vi.fn().mockResolvedValue({});
    const svc = new SiteEnquiriesService(
      { insert } as never,
      { enqueue } as never,
      { countHit } as never,
    );
    return { svc, insert, enqueue };
  };
  const office = (smsOn: boolean, phone: string | null = '01811111111') => ({
    smsOn,
    phone,
    schoolName: 'Green Valley',
  });

  it('stores the enquiry under the given tenant and sends no SMS when the switch is off', async () => {
    const { svc, insert, enqueue } = make();
    await svc.createPublic('tenant-a', dto, office(false));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-a', name: 'Rahim' }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sends exactly one SMS to the school phone when the switch is on', async () => {
    const { svc, enqueue } = make();
    await svc.createPublic('tenant-a', dto, office(true));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toMatchObject({ recipient_address: '01811111111' });
  });

  it('sends no SMS when the school has no phone, and a failed SMS never loses the enquiry', async () => {
    const none = make();
    await none.svc.createPublic('tenant-a', dto, office(true, null));
    expect(none.enqueue).not.toHaveBeenCalled();

    const failing = make(vi.fn().mockRejectedValue(new Error('provider down')));
    await expect(failing.svc.createPublic('tenant-a', dto, office(true))).resolves.toBeUndefined();
    expect(failing.insert).toHaveBeenCalled();
  });

  it('past the hourly cap the enquiry is stored but no SMS is sent; Redis down skips it too', async () => {
    const over = make();
    hits = ENQUIRY_SMS_HOURLY_CAP; // exactly at the cap still sends
    await over.svc.createPublic('tenant-a', dto, office(true));
    expect(over.enqueue).toHaveBeenCalledTimes(1);
    hits = ENQUIRY_SMS_HOURLY_CAP + 1;
    await over.svc.createPublic('tenant-a', dto, office(true));
    expect(over.enqueue).toHaveBeenCalledTimes(1);
    expect(over.insert).toHaveBeenCalledTimes(2);

    const down = make();
    countHit.mockResolvedValueOnce(null as never);
    await down.svc.createPublic('tenant-a', dto, office(true));
    expect(down.enqueue).not.toHaveBeenCalled();
    expect(down.insert).toHaveBeenCalled();
  });
});
