import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationMedium, CommunicationStatus, FeeType } from '@biddaloy/shared';
import { Guardian } from '../students/entities/guardian.entity';
import {
  FeeNotificationsListener,
  resolveFeeNotificationChannel,
} from './fee-notifications.listener';

/**
 * Unit coverage for the push -> WhatsApp -> SMS fallback matrix (D13).
 *
 * Push itself is out of scope here — `CommunicationsProcessor.tryPushFirst`
 * (`worker/communications.processor.ts`) decides that at send time for
 * every `CommunicationTrigger.AUTOMATED` log — so "push ok" / "push
 * unavailable" are not branches this function takes; it only answers what
 * medium the log should fall back to if push doesn't deliver.
 *
 * Note on reachability: `addressForMedium` (`reminder-recipients.util.ts`)
 * resolves both WHATSAPP and SMS to the same `phone`/`alternate_phone`
 * field — there is no separate "is this number WhatsApp-registered" flag
 * on `Guardian`. So the tenant-level `whatsappAvailable` flag (mirroring
 * `smsAvailable`, both sourced from `settings.communications`) is what
 * actually gates WhatsApp — without it, a guardian with a phone always
 * resolved to WhatsApp first regardless of whether the tenant even had a
 * WhatsApp provider configured, and the SMS branch was unreachable.
 */

function guardian(overrides: Partial<Guardian>): Guardian {
  return {
    id: 'g1',
    full_name: 'Karim Uddin',
    phone: null,
    alternate_phone: null,
    email: null,
    ...overrides,
  } as Guardian;
}

describe('resolveFeeNotificationChannel', () => {
  it('picks WhatsApp when the guardian has a phone number and WhatsApp is available', () => {
    const result = resolveFeeNotificationChannel(guardian({ phone: '+8801700000000' }), true, true);
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801700000000' });
  });

  it('picks WhatsApp from the alternate phone when the primary phone is missing', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, alternate_phone: '+8801800000000' }),
      true,
      true,
    );
    expect(result).toEqual({ medium: CommunicationMedium.WHATSAPP, address: '+8801800000000' });
  });

  it('falls back to SMS when WhatsApp is unavailable but SMS is', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: '+8801700000000' }),
      true,
      false,
    );
    expect(result).toEqual({ medium: CommunicationMedium.SMS, address: '+8801700000000' });
  });

  it('skips (null) a guardian with a phone when neither WhatsApp nor SMS is available', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: '+8801700000000' }),
      false,
      false,
    );
    expect(result).toBeNull();
  });

  it('skips (null) an email-only guardian when SMS is enabled — no phone means no SMS address either', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, email: 'g@example.com' }),
      true,
      true,
    );
    expect(result).toBeNull();
  });

  it('skips (null) an email-only guardian when SMS is disabled', () => {
    const result = resolveFeeNotificationChannel(
      guardian({ phone: null, email: 'g@example.com' }),
      false,
      false,
    );
    expect(result).toBeNull();
  });

  it('skips (null) a guardian with no contact information at all', () => {
    const result = resolveFeeNotificationChannel(guardian({}), true, true);
    expect(result).toBeNull();
  });
});

/**
 * [38.2.4] FINE vs non-FINE bills get split into separate messages per
 * guardian. `loadBills` (the private DB-reading half) is stubbed directly
 * rather than mocking the query builder chain — these tests are only
 * about `handleFeesGenerated`'s grouping/splitting decision, not SQL.
 */
describe('FeeNotificationsListener.handleFeesGenerated — FINE splitting', () => {
  const tenantId = 't1';
  const feeGenerationId = 'fg1';
  const student = { id: 's1', guardians: [] as Guardian[] };
  const g1 = guardian({
    id: 'g1',
    phone: '+8801700000000',
    notifications_enabled: true,
    is_primary_contact: true,
  } as any);

  function makeListener(
    bills: unknown[],
    opts: { metered?: boolean; communications?: Record<string, unknown> } = {},
  ) {
    const logRepo = {
      find: vi.fn().mockResolvedValue([]),
      create: vi.fn((v: unknown) => v),
      save: vi.fn(async (v: unknown) => ({ id: 'log1', ...(v as object) })),
    };
    const dataSource = {
      getRepository: vi.fn().mockReturnValue({
        find: vi.fn().mockResolvedValue([{ ...student, guardians: [g1] }]),
      }),
    };
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const feeGenerationsService = {
      findOne: vi.fn().mockResolvedValue({ notify_families: true, due_date: '2026-10-10' }),
    };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({
        region: { locale: 'en-US' },
        communications: opts.communications ?? { sms: { provider: 'twilio' }, whatsapp: undefined },
      }),
    };
    const smsCreditService = {
      isMetered: vi.fn().mockResolvedValue(opts.metered ?? false),
      reserve: vi.fn().mockResolvedValue({ ok: true }),
    };

    const listener = new FeeNotificationsListener(
      logRepo as any,
      dataSource as any,
      queue as any,
      feeGenerationsService as any,
      schoolsService as any,
      smsCreditService as any,
    );
    vi.spyOn(listener as any, 'loadBills').mockResolvedValue(bills);
    return { listener, queue, logRepo, smsCreditService };
  }

  function billRow(overrides: Record<string, unknown>) {
    return {
      student_id: 's1',
      student_full_name: 'Karim',
      fee_structure_name: 'Monthly Fee',
      fee_type: FeeType.MONTHLY_TUITION,
      note: null,
      period_start: '2026-09-01',
      total_amount: '100',
      ...overrides,
    };
  }

  it('metered SMS: reserves under batch:<id> while the job carries the bare id (#1317)', async () => {
    const { listener, queue, smsCreditService } = makeListener([billRow({})], { metered: true });
    await listener.handleFeesGenerated({ tenantId, feeGenerationId });

    const bare = `fee-notify:${feeGenerationId}:sms`;
    expect(smsCreditService.reserve).toHaveBeenCalledWith(
      tenantId,
      expect.any(Number),
      `batch:${bare}`,
      { type: 'batch', id: feeGenerationId },
    );
    expect(queue.add).toHaveBeenCalledWith('send', {
      logId: 'log1',
      batchId: bare,
      segments: expect.any(Number),
    });
  });

  it('sends two messages (two logs) when one guardian has both a FINE and a non-FINE bill', async () => {
    const { listener, queue } = makeListener([
      billRow({}),
      billRow({ fee_structure_name: 'Absent Fine', fee_type: FeeType.FINE, note: 'note' }),
    ]);
    await listener.handleFeesGenerated({ tenantId, feeGenerationId });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('sends one message when the batch only has FINE bills', async () => {
    const { listener, queue } = makeListener([
      billRow({ fee_structure_name: 'Absent Fine', fee_type: FeeType.FINE, note: 'note' }),
    ]);
    await listener.handleFeesGenerated({ tenantId, feeGenerationId });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  // whatsappConfigured() reads both shapes: pre-D6 flat keys and the D6 per-company block.
  async function savedMediumFor(whatsapp: Record<string, unknown>) {
    const { listener, logRepo } = makeListener([billRow({})], {
      communications: { sms: { provider: 'greenweb' }, whatsapp },
    });
    await listener.handleFeesGenerated({ tenantId, feeGenerationId });
    return logRepo.save;
  }

  it('sends on WhatsApp when the school set it up in the flat (pre-D6) shape', async () => {
    const save = await savedMediumFor({ phoneNumberId: '123' });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ medium: CommunicationMedium.WHATSAPP }),
    );
  });

  it('sends on WhatsApp when the school set it up in the nested (D6) shape', async () => {
    const save = await savedMediumFor({
      provider: 'meta-cloud',
      'meta-cloud': { phoneNumberId: '123' },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ medium: CommunicationMedium.WHATSAPP }),
    );
  });

  it('falls back to logging SKIPPED_NO_SMS (no queue.add) when SMS is disabled and WhatsApp unavailable', async () => {
    const { listener, queue, logRepo } = makeListener([billRow({})]);
    (listener as any).schoolsService.getResolvedSettings = vi.fn().mockResolvedValue({
      region: { locale: 'en-US' },
      communications: {},
    });
    await listener.handleFeesGenerated({ tenantId, feeGenerationId });
    expect(queue.add).not.toHaveBeenCalled();
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CommunicationStatus.FAILED }),
    );
  });
});
