import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { InvoiceNotificationsListener } from './invoice-notifications.listener';
import { Payment } from '../fees/entities/payment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Student } from '../students/entities/student.entity';

function guardian(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    full_name: 'Karim Uddin',
    phone: '+8801700000000',
    alternate_phone: null,
    email: null,
    is_primary_contact: true,
    notifications_enabled: true,
    ...overrides,
  };
}

function makeListener(
  overrides: {
    paymentRepo?: any;
    invoiceRepo?: any;
    studentRepo?: any;
    logRepo?: any;
    queue?: any;
    schoolsService?: any;
    smsCreditService?: any;
    shareService?: any;
    config?: any;
  } = {},
) {
  const paymentRepo = overrides.paymentRepo ?? { findOne: vi.fn() };
  const invoiceRepo = overrides.invoiceRepo ?? { findOne: vi.fn() };
  const studentRepo = overrides.studentRepo ?? { find: vi.fn().mockResolvedValue([]) };

  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === Payment) return paymentRepo;
      if (entity === Invoice) return invoiceRepo;
      if (entity === Student) return studentRepo;
      throw new Error('unexpected repository requested');
    },
  };

  const logRepo = overrides.logRepo ?? {
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn((v) => v),
    save: vi.fn(async (v) => ({ id: 'log-1', ...v })),
  };
  const queue = overrides.queue ?? { add: vi.fn().mockResolvedValue(undefined) };
  const schoolsService = overrides.schoolsService ?? {
    getResolvedSettings: vi.fn().mockResolvedValue({
      region: { locale: 'en-US' },
      communications: { sms: { provider: 'greenweb' }, whatsapp: { phoneNumberId: '123' } },
    }),
  };
  const smsCreditService = overrides.smsCreditService ?? {
    isMetered: vi.fn().mockResolvedValue(false),
    reserve: vi.fn().mockResolvedValue({ ok: true }),
  };
  const shareService = overrides.shareService ?? {
    createToken: vi.fn().mockResolvedValue({ rawToken: 'raw-token', tokenId: 'tok-1' }),
  };
  const config = overrides.config ?? { get: vi.fn().mockReturnValue(undefined) };

  const listener = new InvoiceNotificationsListener(
    logRepo as any,
    dataSource as any,
    queue as any,
    schoolsService as any,
    smsCreditService as any,
    shareService as any,
    config as any,
  );

  return {
    listener,
    paymentRepo,
    invoiceRepo,
    studentRepo,
    logRepo,
    queue,
    schoolsService,
    smsCreditService,
    shareService,
  };
}

describe('InvoiceNotificationsListener.handlePaymentRecorded', () => {
  const paymentId = 'pay-1';
  const tenantId = 'tenant-1';

  const payment = {
    id: paymentId,
    tenant_id: tenantId,
    invoice_id: 'inv-1',
    received_by_user_id: 'user-1',
  };
  const invoice = {
    id: 'inv-1',
    invoice_number: 'INV-2026-000317',
    issued_by_user_id: 'user-2',
    snapshot: { totals: { paid: 5000 } },
  };

  it('does nothing when the payment has no linked invoice', async () => {
    const { listener, paymentRepo, logRepo } = makeListener({
      paymentRepo: { findOne: vi.fn().mockResolvedValue({ ...payment, invoice_id: null }) },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(paymentRepo.findOne).toHaveBeenCalled();
    expect(logRepo.save).not.toHaveBeenCalled();
  });

  it('sends one WhatsApp-fallback notification to the resolved guardian and enqueues it', async () => {
    const { listener, invoiceRepo, paymentRepo, studentRepo, logRepo, queue, shareService } =
      makeListener({
        paymentRepo: { findOne: vi.fn().mockResolvedValue(payment) },
        invoiceRepo: { findOne: vi.fn().mockResolvedValue(invoice) },
        studentRepo: {
          find: vi.fn().mockResolvedValue([{ id: 's1', guardians: [guardian()] }]),
        },
      });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(invoiceRepo.findOne).toHaveBeenCalled();
    expect(studentRepo.find).toHaveBeenCalled();
    expect(shareService.createToken).toHaveBeenCalledWith('inv-1', tenantId, 'user-1');
    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        medium: CommunicationMedium.WHATSAPP,
        status: CommunicationStatus.QUEUED,
        guardian_id: 'g1',
        reference_key: `payment-notify:${paymentId}:g1`,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('send', { logId: 'log-1' });
  });

  it('D6 nested WhatsApp settings still count as available', async () => {
    const { listener, logRepo } = makeListener({
      schoolsService: {
        getResolvedSettings: vi.fn().mockResolvedValue({
          region: { locale: 'en-US' },
          communications: {
            sms: { provider: 'greenweb' },
            whatsapp: { provider: 'meta-cloud', 'meta-cloud': { phoneNumberId: '123' } },
          },
        }),
      },
      paymentRepo: { findOne: vi.fn().mockResolvedValue(payment) },
      invoiceRepo: { findOne: vi.fn().mockResolvedValue(invoice) },
      studentRepo: { find: vi.fn().mockResolvedValue([{ id: 's1', guardians: [guardian()] }]) },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ medium: CommunicationMedium.WHATSAPP }),
    );
  });

  it('metered SMS: reserves under batch:<id> while the job carries the bare id (#1317)', async () => {
    const smsCreditService = {
      isMetered: vi.fn().mockResolvedValue(true),
      reserve: vi.fn().mockResolvedValue({ ok: true }),
    };
    const { listener, queue } = makeListener({
      smsCreditService,
      schoolsService: {
        getResolvedSettings: vi.fn().mockResolvedValue({
          region: { locale: 'en-US' },
          communications: { sms: { provider: 'greenweb' } },
        }),
      },
      paymentRepo: { findOne: vi.fn().mockResolvedValue(payment) },
      invoiceRepo: { findOne: vi.fn().mockResolvedValue(invoice) },
      studentRepo: { find: vi.fn().mockResolvedValue([{ id: 's1', guardians: [guardian()] }]) },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    const bare = `payment-notify:${paymentId}:g1`;
    expect(smsCreditService.reserve).toHaveBeenCalledWith(
      tenantId,
      expect.any(Number),
      `batch:${bare}`,
      expect.anything(),
    );
    expect(queue.add).toHaveBeenCalledWith('send', {
      logId: 'log-1',
      batchId: bare,
      segments: expect.any(Number),
    });
  });

  it('is idempotent: a replayed event with an already-logged reference_key sends nothing again', async () => {
    const { listener, logRepo, queue } = makeListener({
      paymentRepo: { findOne: vi.fn().mockResolvedValue(payment) },
      invoiceRepo: { findOne: vi.fn().mockResolvedValue(invoice) },
      studentRepo: {
        find: vi.fn().mockResolvedValue([{ id: 's1', guardians: [guardian()] }]),
      },
      logRepo: {
        find: vi.fn().mockResolvedValue([
          {
            id: 'existing-log',
            reference_key: `payment-notify:${paymentId}:g1`,
            status: CommunicationStatus.QUEUED,
            metadata: null,
          },
        ]),
        create: vi.fn((v) => v),
        save: vi.fn(),
      },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(logRepo.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('falls back to the SMS credit reservation and logs SKIPPED_NO_SMS when the tenant has no channel available', async () => {
    const { listener, logRepo, queue } = makeListener({
      paymentRepo: { findOne: vi.fn().mockResolvedValue(payment) },
      invoiceRepo: { findOne: vi.fn().mockResolvedValue(invoice) },
      studentRepo: {
        find: vi.fn().mockResolvedValue([{ id: 's1', guardians: [guardian()] }]),
      },
      schoolsService: {
        getResolvedSettings: vi.fn().mockResolvedValue({
          region: { locale: 'en-US' },
          communications: {},
        }),
      },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(logRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ reason: 'SKIPPED_NO_SMS' }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips without minting a share token when there is no actor user to attribute it to', async () => {
    const { listener, shareService, logRepo } = makeListener({
      paymentRepo: {
        findOne: vi.fn().mockResolvedValue({ ...payment, received_by_user_id: null }),
      },
      invoiceRepo: {
        findOne: vi.fn().mockResolvedValue({ ...invoice, issued_by_user_id: null }),
      },
    });

    await listener.handlePaymentRecorded({
      payment_id: paymentId,
      tenant_id: tenantId,
      student_ids: ['s1'],
    });

    expect(shareService.createToken).not.toHaveBeenCalled();
    expect(logRepo.save).not.toHaveBeenCalled();
  });
});
