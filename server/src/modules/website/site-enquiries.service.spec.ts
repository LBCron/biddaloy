import { describe, it, expect, vi } from 'vitest';
import { SiteSectionKey } from '@biddaloy/shared';
import type { SiteConfig } from '@biddaloy/shared';
import { SiteEnquiriesService, officeSmsOn } from './site-enquiries.service';

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
  const make = (enqueue = vi.fn().mockResolvedValue({})) => {
    const insert = vi.fn().mockResolvedValue({});
    const svc = new SiteEnquiriesService({ insert } as never, { enqueue } as never);
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
});
