import { describe, it, expect, vi, afterEach } from 'vitest';
import { ALERT_RULES, CommunicationStatus } from '@biddaloy/shared';
import { CommunicationsProcessor } from '../../communications/worker/communications.processor';
import { CommunicationProviderRegistryService } from '../../communications/providers/communication-provider.registry';
import {
  GuardianSmsFallbackService,
  fallbackReferenceKey,
  toldAboutStudent,
} from './guardian-sms-fallback.service';

const S1 = 'student-1';
const S2 = 'student-2';
const G = 'guardian-1';

vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: async () => ({ messageId: 'm' }) }),
}));

describe('toldAboutStudent', () => {
  it('matches the log student, or any student named in metadata.student_ids', () => {
    expect(toldAboutStudent([{ guardian_id: G, student_id: S1, metadata: null }], G, S1)).toBe(
      true,
    );
    // one absence log can name several children
    expect(
      toldAboutStudent(
        [{ guardian_id: G, student_id: null, metadata: { student_ids: [S1, S2] } }],
        G,
        S2,
      ),
    ).toBe(true);
  });

  it('does not match another student or another guardian', () => {
    expect(
      toldAboutStudent([{ guardian_id: G, student_id: S2, metadata: { student_ids: [] } }], G, S1),
    ).toBe(false);
    expect(
      toldAboutStudent([{ guardian_id: 'other', student_id: S1, metadata: null }], G, S1),
    ).toBe(false);
    expect(toldAboutStudent([], G, S1)).toBe(false);
  });
});

describe('fallbackReferenceKey', () => {
  it('is stable per alert and guardian (the idempotency key)', () => {
    expect(fallbackReferenceKey('a1', 'g1')).toBe('attention:a1:g1');
  });
});

describe('GuardianSmsFallbackService gates', () => {
  const build = (query = vi.fn().mockResolvedValue([])) => {
    const service = new GuardianSmsFallbackService(
      {
        query,
        getRepository: vi.fn(),
        // the per-tenant advisory lock is always granted here
        createQueryRunner: () => ({
          connect: vi.fn(),
          query: vi.fn().mockResolvedValue([{ ok: true }]),
          release: vi.fn(),
        }),
      } as any,
      { add: vi.fn() } as any,
      { isMetered: vi.fn(), reserve: vi.fn() } as any,
      { get: vi.fn() } as any,
    );
    return { service, query };
  };
  const school = (settings: object) => ({ id: 't1', name: 'S', name_bn: null, settings });
  const on = { guardianSmsFallback: true, quietHours: { start: '00:00', end: '00:00' } };

  it('does nothing (not even a query) when the school has not opted in', async () => {
    const { service, query } = build();
    expect(
      await service.runTenant(school({ communications: { sms: { provider: 'x' } } }), new Date()),
    ).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing without an SMS provider', async () => {
    const { service, query } = build();
    expect(await service.runTenant(school({ attention: on }), new Date())).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('does nothing inside quiet hours; the next sweep outside them sends', async () => {
    const { service, query } = build();
    const settings = {
      communications: { sms: { provider: 'x' } },
      attention: { ...on, quietHours: { start: '00:00', end: '23:59' } },
    };
    // 06:00 UTC is 12:00 in Dhaka: inside 00:00-23:59
    expect(await service.runTenant(school(settings), new Date('2026-10-10T06:00:00Z'))).toBe(0);
    expect(query).not.toHaveBeenCalled();
    // 17:59 UTC is 23:59 in Dhaka: outside -> the alert query runs
    await service.runTenant(school(settings), new Date('2026-10-10T17:59:00Z'));
    expect(query).toHaveBeenCalled();
  });

  it('one failing school never stops the others', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        school({ communications: { sms: { provider: 'x' } }, attention: on }),
        { ...school({}), id: 't2' },
      ])
      .mockRejectedValueOnce(new Error('db down'));
    const { service } = build(query);
    await expect(service.run(new Date())).resolves.toBeUndefined();
  });
});

describe('GuardianSmsFallbackService in MESSAGE_SINK=mailpit [58.1.02]', () => {
  afterEach(() => vi.unstubAllEnvs());

  // A school whose SMS provider is only a placeholder still gets its fallback delivered as a
  // SENT mailpit-sink row: the registry swaps every medium for MailpitSinkProvider.
  it('ends a fallback SMS as a SENT mailpit-sink row', async () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const ruleKey = ALERT_RULES.find(
      (r) => r.guardianSmsFallback && r.key !== 'child.absent_today',
    )!.key;
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a1', rule_key: ruleKey, params: {}, student_id: 's1' }])
      .mockResolvedValueOnce([
        {
          id: 'g1',
          user_id: null,
          phone: '01712345678',
          full_name: 'Guardian',
          notifications_enabled: true,
          is_primary_contact: true,
          student_id: 's1',
          has_push: false,
        },
      ])
      .mockResolvedValue([]);
    let saved: any;
    const logRepo = {
      create: (x: object) => x,
      save: vi.fn(async (x: object) => (saved = { id: 'log-1', ...x })),
    };
    const queue = { add: vi.fn() };
    const message = { title: 't', why: 'w', steps: [] as string[] };
    const service = new GuardianSmsFallbackService(
      {
        query,
        getRepository: () => logRepo,
        createQueryRunner: () => ({
          connect: vi.fn(),
          query: vi.fn().mockResolvedValue([{ ok: true }]),
          release: vi.fn(),
        }),
      } as any,
      queue as any,
      { isMetered: vi.fn().mockResolvedValue(false), reserve: vi.fn() } as any,
      { get: () => ({ messages: { bn: message, en: message } }) } as any,
    );

    const queued = await service.runTenant(
      {
        id: 't1',
        name: 'S',
        name_bn: null,
        settings: {
          communications: { sms: { provider: 'placeholder' } },
          attention: { guardianSmsFallback: true, quietHours: { start: '00:00', end: '00:00' } },
        },
      },
      new Date('2026-10-10T06:00:00Z'),
    );
    expect(queued).toBe(1);
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });

    // Hand the queued log to the real processor with the real (demo) registry.
    const txSave = vi.fn(async (l: object) => l);
    const processor = new CommunicationsProcessor(
      {
        findOneOrFail: async () => ({ ...saved }),
        findOne: async () => ({ ...saved }),
        save: async (l: object) => l,
        manager: { transaction: async (cb: any) => cb({ save: txSave, query: vi.fn() }) },
      } as any,
      { findOne: async () => null } as any,
      new CommunicationProviderRegistryService({} as any),
      { isActive: async () => true } as any,
      { settlePart: vi.fn(), isMetered: async () => false } as any,
      { sendToUser: async () => ({ accepted: 0, transient: 0, pruned: 0 }) } as any,
    );
    await processor.process({
      name: undefined,
      data: { logId: 'log-1' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as any);

    expect(txSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.SENT,
        provider_message_id: expect.stringMatching(/^mailpit-sink-/),
        metadata: expect.objectContaining({ raw: { provider: 'mailpit-sink' } }),
      }),
    );
  });
});
