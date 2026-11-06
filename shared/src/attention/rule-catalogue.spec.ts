import { describe, expect, it } from 'vitest';

import { AlertCadence, AlertCategory, AlertSeverity } from '../enums/attention';
import { UserRole } from '../enums/index';
import {
  ALERT_RULE_KEYS,
  ALERT_RULES,
  alertRuleMeta,
  isAlertRuleKey,
  type AlertRuleKey,
} from './rule-catalogue';

const meta = (k: string) => ALERT_RULES.find((r) => r.key === k)!;

describe('alert rule catalogue', () => {
  it('has 63 unique, well-formed keys that match ALERT_RULE_KEYS in order', () => {
    expect(ALERT_RULES).toHaveLength(63);
    expect(new Set(ALERT_RULE_KEYS).size).toBe(63);
    expect(ALERT_RULES.map((r) => r.key)).toEqual([...ALERT_RULE_KEYS]);
    for (const k of ALERT_RULE_KEYS) expect(k).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it('registers the billing seat rules (49.4)', () => {
    for (const k of [
      'seats.expiring',
      'seats.exhausted',
      'account.idle',
      'platform.seats.expiring',
    ]) {
      expect(isAlertRuleKey(k), k).toBe(true);
    }
    expect(meta('platform.seats.expiring').roles).toEqual([UserRole.SUPER_ADMIN]);
  });

  it('does not contain incidents.open', () => {
    expect(isAlertRuleKey('incidents.open')).toBe(false);
  });

  it('critical and escalating rules cannot be disabled (D34)', () => {
    const escalating = [
      'trial.ending',
      'attendance.not_taken',
      'exams.marks_overdue',
      'exams.my_marks_due',
      'billing.renewal_due',
    ];
    for (const r of ALERT_RULES) {
      if (r.severity === AlertSeverity.CRITICAL || escalating.includes(r.key)) {
        expect(r.canDisable, r.key).toBe(false);
      }
    }
  });

  it('staff SMS fallback only on attendance.not_taken', () => {
    expect(ALERT_RULES.filter((r) => r.staffSmsFallback).map((r) => r.key)).toEqual([
      'attendance.not_taken',
    ]);
  });

  it('guardian SMS fallback only on child.absent_today and fees.overdue_family (D29, D42)', () => {
    expect(ALERT_RULES.filter((r) => r.guardianSmsFallback).map((r) => r.key)).toEqual([
      'child.absent_today',
      'fees.overdue_family',
    ]);
  });

  it('PLATFORM category <=> roles [SUPER_ADMIN]; nobody else lists SUPER_ADMIN', () => {
    for (const r of ALERT_RULES) {
      const platform = r.category === AlertCategory.PLATFORM;
      expect(r.roles.includes(UserRole.SUPER_ADMIN), r.key).toBe(platform);
      if (platform) expect(r.roles).toEqual([UserRole.SUPER_ADMIN]);
    }
  });

  it('every rule except manual.alert has a cadence; leave.my_request_decided is personal', () => {
    for (const r of ALERT_RULES) {
      if (r.key === 'manual.alert') expect(r.cadence).toEqual([]);
      else expect(r.cadence.length, r.key).toBeGreaterThan(0);
    }
    expect(meta('leave.my_request_decided').roles).toEqual([]);
    expect(meta('attendance.not_taken').cadence).toContain(AlertCadence.FAST);
  });

  it('ownerEpic is set on exactly the 13 later-epic rows', () => {
    expect(
      ALERT_RULES.filter((r) => r.ownerEpic)
        .map((r) => r.key)
        .sort(),
    ).toEqual(
      [
        'study_plan.unreported',
        'study_plan.behind',
        'admin.mfa_missing',
        'approvals.pending',
        'print.queue_pending',
        'billing.renewal_due',
        'students.at_risk',
        'committee.monthly_report_ready',
        'seats.expiring',
        'seats.exhausted',
        'account.idle',
        'platform.seats.expiring',
        'platform.bkash.refund_due',
      ].sort(),
    );
  });

  it('child.absent_today is not pushable or disableable; 3 fee rules also run ON_CHANGE (Epic 68)', () => {
    expect(meta('child.absent_today')).toMatchObject({
      pushable: false,
      canDisable: false,
      guardianSmsFallback: true,
    });
    for (const k of ['fees.unassigned_students', 'fees.due_soon', 'fees.overdue_family'])
      expect(meta(k).cadence).toContain(AlertCadence.ON_CHANGE);
  });

  it('both seat rules run ON_CHANGE: billing asks for a recheck, the scheduler drops it otherwise (Epic 49)', () => {
    for (const k of ['seats.expiring', 'seats.exhausted'] as const)
      expect(meta(k).cadence).toContain(AlertCadence.ON_CHANGE);
  });

  it('lookup returns the catalogue object; unknown key throws', () => {
    expect(alertRuleMeta('class.starting')).toBe(meta('class.starting'));
    expect(() => alertRuleMeta('nope' as AlertRuleKey)).toThrow();
    expect(isAlertRuleKey('nope')).toBe(false);
    expect(isAlertRuleKey('class.starting')).toBe(true);
  });
});
