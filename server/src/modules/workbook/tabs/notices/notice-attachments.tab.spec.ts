/** notice_attachments `fromRow`: a `sort` outside smallint is a row error, not a failed save. */
import { describe, expect, it } from 'vitest';

import type { ImportContext } from '../../codec/tab-spec';
import { noticeAttachmentsTab } from './index';

const A = '11111111-1111-4111-8111-111111111111';
const ctx: ImportContext = { tenantId: A, ref: () => 'nid', warn: () => undefined };
const row = (sort: string) => ({
  id: '33333333-3333-4333-8333-333333333333',
  notice: 'n',
  storage_key: `tenants/${A}/notice-files/22222222-2222-4222-8222-222222222222.pdf`,
  mime_type: 'application/pdf',
  size_bytes: '10',
  original_name: 'x.pdf',
  sort,
});
const errorColumns = (sort: string) => {
  const res = noticeAttachmentsTab.fromRow(row(sort), 2, ctx);
  return 'errors' in res ? res.errors.map((e) => e.column) : [];
};
const sortOf = (sort: string) => {
  const res = noticeAttachmentsTab.fromRow(row(sort), 2, ctx);
  return 'row' in res ? res.row.sort : undefined;
};

describe('noticeAttachmentsTab.fromRow sort', () => {
  // The column is smallint: 99999 used to reach the save and fail the whole restore.
  it('rejects a sort above 32767 on the sort column', () => {
    expect(errorColumns('99999')).toEqual(['sort']);
    expect(errorColumns('32768')).toEqual(['sort']);
  });

  it('rejects a sort below -32768 on the sort column', () => {
    expect(errorColumns('-32769')).toEqual(['sort']);
  });

  it('accepts the smallint edges and zero', () => {
    expect(sortOf('-32768')).toBe(-32768);
    expect(sortOf('0')).toBe(0);
    expect(sortOf('32767')).toBe(32767);
  });
});
