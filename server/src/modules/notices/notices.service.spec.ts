import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { publishPlan } from './notices.service';
import { loadOwnedNotice } from './notice-recipients.service';

describe('publishPlan (important x public x requestSms)', () => {
  // Each row says which services publish calls. SMS is never sent here: the plan only ever says
  // "raise an approval task", there is no "send" in it.
  const plan = (important: boolean, isPublic: boolean, requestSms: boolean) =>
    publishPlan({ important, isPublic, requestSms });

  it('nothing on: no alert, no link, no SMS task', () => {
    expect(plan(false, false, false)).toEqual({ alert: false, publicLink: false, smsTask: false });
  });
  it('important only: alert', () => {
    expect(plan(true, false, false)).toEqual({ alert: true, publicLink: false, smsTask: false });
  });
  it('public only: link', () => {
    expect(plan(false, true, false)).toEqual({ alert: false, publicLink: true, smsTask: false });
  });
  it('requestSms only: approval task', () => {
    expect(plan(false, false, true)).toEqual({ alert: false, publicLink: false, smsTask: true });
  });
  it('important + public: alert and link', () => {
    expect(plan(true, true, false)).toEqual({ alert: true, publicLink: true, smsTask: false });
  });
  it('important + requestSms: alert and approval task', () => {
    expect(plan(true, false, true)).toEqual({ alert: true, publicLink: false, smsTask: true });
  });
  it('public + requestSms: link and approval task', () => {
    expect(plan(false, true, true)).toEqual({ alert: false, publicLink: true, smsTask: true });
  });
  it('all three: alert, link and approval task', () => {
    expect(plan(true, true, true)).toEqual({ alert: true, publicLink: true, smsTask: true });
  });
});

describe('loadOwnedNotice ownership (D20)', () => {
  const notice = { id: 'n1', tenant_id: 't1', author_user_id: 'author' };
  const em = (row: unknown) =>
    ({
      getRepository: () => ({
        createQueryBuilder: () => ({
          where: () => ({ getOne: async () => row, setLock: () => ({ getOne: async () => row }) }),
        }),
      }),
    }) as never;

  it('the author gets their own notice', async () => {
    await expect(
      loadOwnedNotice(em(notice), 't1', { userId: 'author', role: UserRole.TEACHER }, 'n1'),
    ).resolves.toBe(notice);
  });

  it("a teacher cannot see another's notice: 404, not 403", async () => {
    await expect(
      loadOwnedNotice(em(notice), 't1', { userId: 'other', role: UserRole.TEACHER }, 'n1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a NOTICE_MANAGE holder (ADMIN) gets any notice of the tenant', async () => {
    await expect(
      loadOwnedNotice(em(notice), 't1', { userId: 'other', role: UserRole.ADMIN }, 'n1'),
    ).resolves.toBe(notice);
  });

  it('a missing notice (or one of another tenant) is a 404 even for an ADMIN', async () => {
    await expect(
      loadOwnedNotice(em(null), 't1', { userId: 'other', role: UserRole.ADMIN }, 'n1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
