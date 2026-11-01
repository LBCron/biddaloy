import { describe, expect, it } from 'vitest';

import { ADMIT_CARD_SITTING_SLOTS, DocumentKind, isSerialKind } from '../enums/print';
import { FIELD_CATALOG } from './field-catalog';

describe('FIELD_CATALOG', () => {
  for (const kind of Object.values(DocumentKind)) {
    describe(kind, () => {
      const fields = FIELD_CATALOG[kind];

      it('has unique keys', () => {
        expect(new Set(fields.map((x) => x.key)).size).toBe(fields.length);
      });

      // ACR is confidential: it must have NO verify QR (the public verify page would expose the holder).
      it(
        kind === DocumentKind.ACR_ASSESSMENT
          ? 'has no verify QR'
          : 'has a print.verify_qr qr field',
        () => {
          const qr = fields.find((x) => x.key === 'print.verify_qr');
          if (kind === DocumentKind.ACR_ASSESSMENT) expect(qr).toBeUndefined();
          else expect(qr?.type).toBe('qr');
        },
      );

      it('has a serial number iff it is a serial kind', () => {
        expect(fields.some((x) => x.key === 'print.serial_no')).toBe(isSerialKind(kind));
      });

      it('only marks issue.* fields as issue-time, with a positive maxLength', () => {
        for (const x of fields) {
          expect(x.key.startsWith('issue.'), x.key).toBe(x.issueTime !== undefined);
          if (x.issueTime) expect(x.issueTime.maxLength, x.key).toBeGreaterThan(0);
        }
      });

      // D43: otherwise a field could never be written as {{key}}.
      it('has keys usable as placeholders', () => {
        for (const x of fields) expect(x.key, x.key).toMatch(/^[A-Za-z0-9_.]+$/);
      });

      it('gives every field a sample', () => {
        for (const x of fields) expect(x.sample, x.key).not.toBe('');
      });
    });
  }

  it('gives the admit card exactly 15 x 5 sitting fields, other kinds none', () => {
    const n = (k: DocumentKind) =>
      FIELD_CATALOG[k].filter((x) => x.key.startsWith('exam.sitting.')).length;
    expect(n(DocumentKind.EXAM_ADMIT_CARD)).toBe(ADMIT_CARD_SITTING_SLOTS * 5);
    expect(n(DocumentKind.TRANSFER_CERTIFICATE)).toBe(0);
  });

  it('puts FINAL_RESULT fields on result and merit certificates only', () => {
    for (const kind of Object.values(DocumentKind)) {
      const has = FIELD_CATALOG[kind].some((x) => x.key === 'final_result.gpa');
      expect(has, kind).toBe(
        kind === DocumentKind.RESULT_CERTIFICATE || kind === DocumentKind.MERIT_CERTIFICATE,
      );
    }
  });
});
