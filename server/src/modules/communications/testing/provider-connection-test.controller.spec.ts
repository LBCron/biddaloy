import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditAction, CommunicationMedium, type JwtPayload } from '@biddaloy/shared';
import { ProviderConnectionTestController } from './provider-connection-test.controller';
import { ConnectionTestService } from './connection-test.service';
import { AuditService } from '../../audit/audit.service';
import { TestConnectionDto } from '../dto/test-connection.dto';

const SCHOOL_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const USER = { sub: 'user-1', jti: 'jti-1', memberships: [] } as unknown as JwtPayload;
const REQUEST = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as unknown as Request;

function fakeConnectionTestService() {
  return { test: vi.fn() };
}

function fakeAuditService() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

describe('ProviderConnectionTestController', () => {
  let connectionTest: ReturnType<typeof fakeConnectionTestService>;
  let auditService: ReturnType<typeof fakeAuditService>;
  let controller: ProviderConnectionTestController;

  beforeEach(() => {
    connectionTest = fakeConnectionTestService();
    auditService = fakeAuditService();
    controller = new ProviderConnectionTestController(
      connectionTest as unknown as ConnectionTestService,
      auditService as unknown as AuditService,
    );
  });

  function dto(): TestConnectionDto {
    const d = new TestConnectionDto();
    d.medium = CommunicationMedium.WHATSAPP;
    d.config = { accessToken: 'draft-token' };
    return d;
  }

  it('delegates to the service when an ADMIN tests their own school', async () => {
    connectionTest.test.mockResolvedValue({ success: true, message: 'ok' });

    const result = await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      undefined,
    );
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('delegates for a SUPER_ADMIN testing a school outside their own tenant', async () => {
    connectionTest.test.mockResolvedValue({ success: true, message: 'ok' });

    await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_B, role: 'SUPER_ADMIN' },
      USER,
      REQUEST,
    );

    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      undefined,
    );
  });

  it('rejects an ADMIN testing a different school, without calling the service at all', async () => {
    await expect(
      controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_B, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toThrow(ForbiddenException);
    expect(connectionTest.test).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('never echoes the submitted config back in the response', async () => {
    connectionTest.test.mockResolvedValue({ success: false, message: 'Authentication rejected.' });

    const result = await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(JSON.stringify(result)).not.toContain('draft-token');
  });

  it('writes a SETTINGS_TEST audit entry with actor/tenant/medium/outcome, never the config or a credential', async () => {
    connectionTest.test.mockResolvedValue({ success: false, message: 'Authentication rejected.' });

    await controller.testConnection(
      SCHOOL_A,
      dto(),
      { id: SCHOOL_A, role: 'ADMIN' },
      USER,
      REQUEST,
    );

    expect(auditService.record).toHaveBeenCalledTimes(1);
    const [entry] = auditService.record.mock.calls[0];
    expect(entry).toMatchObject({
      action: AuditAction.SETTINGS_TEST,
      entity_type: 'School',
      entity_id: SCHOOL_A,
      tenant_id: SCHOOL_A,
      performed_by_user_id: 'user-1',
      ip_address: '127.0.0.1',
      user_agent: 'vitest',
      new_values: { medium: CommunicationMedium.WHATSAPP, success: false, outcome: 'failed' },
    });
    expect(JSON.stringify(entry)).not.toContain('draft-token');
  });

  it('requires an Idempotency-Key when sendTo is set (Rule 25)', async () => {
    const d = dto();
    d.sendTo = '01712345678';
    await expect(
      controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(connectionTest.test).not.toHaveBeenCalled();
  });

  it('passes sendTo and the caller to the service, and audits only the log id', async () => {
    connectionTest.test.mockResolvedValue({
      success: true,
      message: 'ok',
      testMessage: { logId: 'log-9', status: 'SENT' },
    });
    const d = dto();
    d.sendTo = '01712345678';
    const keyed = { ...REQUEST, headers: { 'idempotency-key': 'k1' } } as unknown as Request;
    await controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, keyed);
    expect(connectionTest.test).toHaveBeenCalledWith(
      SCHOOL_A,
      CommunicationMedium.WHATSAPP,
      { accessToken: 'draft-token' },
      { sendTo: '01712345678', userId: 'user-1' },
    );
    const audit = JSON.stringify(auditService.record.mock.calls[0][0]);
    expect(audit).toContain('log-9');
    expect(audit).not.toContain('01712345678');
  });

  // PR #3325 review round 2, finding 3: the connection passed but the gateway rejected the message.
  it('audits a gateway-rejected test message as send_failed, not success', async () => {
    connectionTest.test.mockResolvedValue({
      success: true,
      message: 'ok',
      testMessage: { logId: 'log-10', status: 'FAILED' },
    });
    const d = dto();
    d.sendTo = '01712345678';
    const keyed = { ...REQUEST, headers: { 'idempotency-key': 'k3' } } as unknown as Request;
    await controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, keyed);
    expect(auditService.record.mock.calls[0][0].new_values).toMatchObject({
      success: true,
      outcome: 'send_failed',
      test_message_log_id: 'log-10',
    });
  });

  // PR #3325 review, finding 2: the credentials were already used (and a message may have gone out)
  // when test() throws, so the audit row is still written, with the status as the outcome.
  it('still writes the SETTINGS_TEST audit row when the test throws, and rethrows the original error', async () => {
    const credit = new ConflictException('Insufficient SMS credit to send this message.');
    connectionTest.test.mockRejectedValue(credit);
    const d = dto();
    d.sendTo = '01712345678';
    const keyed = { ...REQUEST, headers: { 'idempotency-key': 'k2' } } as unknown as Request;

    const err = await controller
      .testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, keyed)
      .catch((e) => e);

    expect(err).toBe(credit);
    expect(auditService.record).toHaveBeenCalledTimes(1);
    expect(auditService.record.mock.calls[0][0].new_values).toEqual({
      medium: CommunicationMedium.WHATSAPP,
      success: false,
      outcome: 'error:409',
      test_message: true,
    });
    expect(JSON.stringify(auditService.record.mock.calls[0][0])).not.toContain('01712345678');
  });

  it('a failing audit write never replaces the original error of a throwing test', async () => {
    const sendFailed = new InternalServerErrorException('The test message could not be recorded.');
    connectionTest.test.mockRejectedValue(sendFailed);
    auditService.record.mockRejectedValue(new Error('audit db down'));

    await expect(
      controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toBe(sendFailed);
  });

  // PR #3325 review round 3, finding 2: a 500 here would free the key, and the same-key retry
  // would send (and charge) a second time.
  it('returns the result of a real send even when its audit write fails', async () => {
    const sent = { success: true, message: 'ok', testMessage: { logId: 'log-11', status: 'SENT' } };
    connectionTest.test.mockResolvedValue(sent);
    auditService.record.mockRejectedValue(new Error('audit db down'));
    const d = dto();
    d.sendTo = '01712345678';
    const keyed = { ...REQUEST, headers: { 'idempotency-key': 'k4' } } as unknown as Request;

    await expect(
      controller.testConnection(SCHOOL_A, d, { id: SCHOOL_A, role: 'ADMIN' }, USER, keyed),
    ).resolves.toBe(sent);
  });

  it('still fails a plain connection test whose audit write fails (nothing was sent)', async () => {
    connectionTest.test.mockResolvedValue({ success: true, message: 'ok' });
    const auditDown = new Error('audit db down');
    auditService.record.mockRejectedValue(auditDown);

    await expect(
      controller.testConnection(SCHOOL_A, dto(), { id: SCHOOL_A, role: 'ADMIN' }, USER, REQUEST),
    ).rejects.toBe(auditDown);
  });

  it('is throttled at the test tier (3/min); the global tracker buckets per authenticated user', () => {
    // Tracker is `user:<sub>` (rate-limit-tracker.ts), not per tenant: a tenant key would come from
    // the unauthenticated URL and let a stranger lock a school out. The tenant-wide abuse cap is the
    // daily test-send cap in ConnectionTestService.
    const handler = ProviderConnectionTestController.prototype.testConnection;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
