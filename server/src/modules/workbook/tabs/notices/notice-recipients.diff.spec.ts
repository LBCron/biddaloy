import { describe, expect, it } from 'vitest';
import { noticeRecipientsTab } from './notice-recipients.tab';

const NOTICE = '11111111-1111-4111-8111-111111111111';
const OTHER_NOTICE = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const GUARDIAN = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';

// Restore matches a row by `id` first, then `upsert` rewrites notice_id and the
// person ids. So a row that keeps its id but points at someone else must show as
// changed in the preview the admin approves (PR #3458 review, item 5).
const stored = {
  notice_id: NOTICE,
  kind: 'GUARDIAN',
  user_id: null,
  student_id: STUDENT,
  guardian_id: GUARDIAN,
  seen_at: null,
  acknowledged_at: null,
  link_opened_at: null,
  sms_wanted: true,
  sms_sent_at: null,
  pushed_at: null,
};
const row = { ...stored };
const diff = (r: object) => noticeRecipientsTab.diffFields(r as never, stored as never);

describe('notice_recipients diffFields: who the row points at', () => {
  it('an identical row is unchanged', () => {
    expect(diff(row)).toEqual([]);
  });

  it('only the guardian changed: reported as a guardian change', () => {
    expect(diff({ ...row, guardian_id: OTHER })).toEqual(['guardian']);
  });

  it('only the student changed: reported as a student change', () => {
    expect(diff({ ...row, student_id: OTHER })).toEqual(['student']);
  });

  it('only the notice changed: reported as a notice change', () => {
    expect(diff({ ...row, notice_id: OTHER_NOTICE })).toEqual(['notice']);
  });

  it('a user added where there was none: reported as a user change', () => {
    expect(diff({ ...row, user_id: OTHER })).toEqual(['user']);
  });
});
