import { describe, expect, it } from 'vitest';

import {
  AlertCadence,
  AlertCategory,
  AlertRecipientState,
  AlertSeverity,
  AlertSource,
  AlertStatus,
} from './attention';

describe('attention enums', () => {
  const cases: Array<[string, Record<string, string>, number]> = [
    ['AlertSeverity', AlertSeverity, 3],
    ['AlertSource', AlertSource, 3],
    ['AlertStatus', AlertStatus, 4],
    ['AlertRecipientState', AlertRecipientState, 4],
    ['AlertCadence', AlertCadence, 4],
    ['AlertCategory', AlertCategory, 17],
  ];

  it.each(cases)('%s has unique values and the exact member count', (_n, obj, count) => {
    const values = Object.values(obj);
    expect(values.length).toBe(count);
    expect(new Set(values).size).toBe(values.length);
  });

  it('pins the exact member lists', () => {
    expect(Object.values(AlertSeverity)).toEqual(['CRITICAL', 'WARNING', 'REMINDER']);
    expect(Object.values(AlertStatus)).toEqual(['ACTIVE', 'RESOLVED', 'EXPIRED', 'WITHDRAWN']);
    expect(Object.values(AlertRecipientState)).toEqual(['OPEN', 'HIDDEN', 'RESOLVED', 'EXPIRED']);
    expect(Object.values(AlertCadence)).toEqual(['FAST', 'HOURLY', 'DAILY', 'ON_CHANGE']);
  });
});
