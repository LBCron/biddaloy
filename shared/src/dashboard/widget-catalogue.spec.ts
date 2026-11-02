import { describe, expect, it } from 'vitest';

import { Permission, roleHasPermission } from '../enums/permissions';
import { UserRole } from '../enums';
import {
  DASHBOARD_LAYOUT_MAX_WIDGETS,
  DashboardWidgetKey,
  ROLE_DEFAULT_LAYOUTS,
  WIDGET_CATALOGUE,
} from './widget-catalogue';

const entries = Object.entries(WIDGET_CATALOGUE) as [
  DashboardWidgetKey,
  (typeof WIDGET_CATALOGUE)[DashboardWidgetKey],
][];

describe('dashboard widget catalogue [8.10.7.1.01]', () => {
  it('has 40 keys and the catalogue covers each exactly', () => {
    const keys = Object.values(DashboardWidgetKey);
    expect(keys).toHaveLength(40);
    expect(Object.keys(WIDGET_CATALOGUE).sort()).toEqual([...keys].sort());
  });

  it('every key is kebab-case', () => {
    for (const key of Object.values(DashboardWidgetKey)) {
      expect(key, key).toMatch(/^[a-z]+(-[a-z0-9]+)*$/);
    }
  });

  it('every entry has a size, no DASHBOARD_VIEW, and no portal/platform roles', () => {
    for (const [key, e] of entries) {
      expect(e.sizes.length, key).toBeGreaterThanOrEqual(1);
      expect(e.permissions, key).not.toContain(Permission.DASHBOARD_VIEW);
      for (const r of [UserRole.SUPER_ADMIN, UserRole.PARENT, UserRole.STUDENT]) {
        expect(e.roles, key).not.toContain(r);
      }
    }
  });

  it('never widens: every listed role holds DASHBOARD_VIEW and every listed permission', () => {
    for (const [key, e] of entries) {
      for (const role of e.roles) {
        expect(
          roleHasPermission(role, Permission.DASHBOARD_VIEW),
          `${key}: ${role} lacks DASHBOARD_VIEW`,
        ).toBe(true);
        for (const p of e.permissions) {
          expect(roleHasPermission(role, p), `${key}: ${role} lacks ${p}`).toBe(true);
        }
      }
    }
  });

  it('default layouts only hold widgets the role may see, with no repeats', () => {
    for (const role of Object.values(UserRole)) {
      const layout = ROLE_DEFAULT_LAYOUTS[role];
      expect(new Set(layout).size, `${role} repeats`).toBe(layout.length);
      for (const key of layout) {
        expect(WIDGET_CATALOGUE[key].roles, `${role} ${key}`).toContain(role);
      }
    }
  });

  it('every default layout fits the cap', () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_DEFAULT_LAYOUTS[role].length).toBeLessThanOrEqual(DASHBOARD_LAYOUT_MAX_WIDGETS);
    }
  });

  it('the cap fits every widget a role may save, not just its default layout', () => {
    for (const role of Object.values(UserRole)) {
      const allowed = entries.filter(([, e]) => e.roles.includes(role)).length;
      expect(allowed, `${role} could not save every widget`).toBeLessThanOrEqual(
        DASHBOARD_LAYOUT_MAX_WIDGETS,
      );
    }
  });

  it('needsEpic is set on exactly the five waiting widgets', () => {
    const actual = Object.fromEntries(
      entries.filter(([, e]) => e.needsEpic).map(([k, e]) => [k, e.needsEpic]),
    );
    expect(actual).toEqual({
      'approvals-pending': 1726,
      'print-queue': 1373,
      'setup-checklist': 1640,
      'syllabus-vs-plan': 1828,
      'my-lessons-to-mark': 1828,
    });
  });

  it('COMMITTEE sees aggregates only', () => {
    const allowed: Permission[] = [Permission.COMMITTEE_REPORT_READ, Permission.CALENDAR_READ];
    for (const [key, e] of entries) {
      if (!e.roles.includes(UserRole.COMMITTEE)) continue;
      for (const p of e.permissions) expect(allowed, `${key} ${p}`).toContain(p);
    }
  });

  it('portal and platform roles stay curated (empty layouts)', () => {
    expect(ROLE_DEFAULT_LAYOUTS[UserRole.PARENT]).toEqual([]);
    expect(ROLE_DEFAULT_LAYOUTS[UserRole.STUDENT]).toEqual([]);
    expect(ROLE_DEFAULT_LAYOUTS[UserRole.SUPER_ADMIN]).toEqual([]);
  });

  it('EXECUTIVE shows syllabus-progress right after mark-entry-progress', () => {
    const l = ROLE_DEFAULT_LAYOUTS[UserRole.EXECUTIVE];
    expect(l[l.indexOf('mark-entry-progress') + 1]).toBe('syllabus-progress');
  });
});
