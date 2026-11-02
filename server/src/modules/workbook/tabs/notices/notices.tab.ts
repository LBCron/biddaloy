import type { EntityManager } from 'typeorm';
import { NoticeSmsStatus, NoticeStatus } from '@biddaloy/shared';
import { Notice } from '../../../notices/entities/notice.entity';
import { NoticeAttachment } from '../../../notices/entities/notice-attachment.entity';
import { NoticeRecipient } from '../../../notices/entities/notice-recipient.entity';
import { formatDateTime, fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { optionalKeyOf } from '../../codec/tab-spec';
import { actorOrRestorer } from '../actor-keys';

/**
 * [53.6.02] The `notices` tab (D28). Everything about a notice is kept except
 * what must not survive a restore:
 *  - `public_token_hash` / `public_token_created_at`: the public link dies with
 *    a restore (re-share to get a new one). Hashes never enter a workbook.
 *  - `alert_id` / `sms_task_alert_id`: pointers to derived attention alerts.
 *    A restore leaves the alerts off, like the other derived rows (alerts are
 *    not backed up; the attention sweep raises them again).
 *  - `withdrawn_by_user_id`, `sms_requested_by_user_id`, `sms_decided_by_user_id`:
 *    who-did-it attribution only; the statuses and timestamps are kept.
 *
 * A notice has no business key, so the natural key is `(created_at, title)`:
 * stable across restores because `created_at` is restored as written.
 */
type Rec = Record<string, unknown>;

export const NOTICES = 'notices';
const NOTICE_BODY_MAX = 5000;
const NOTICE_TITLE_MAX = 140;

const label = (en: string, bn: string) => ({ en, bn });
export const ID_COLUMN: ColumnSpec = {
  key: 'id',
  type: 'uuid',
  required: true,
  label: label('ID', 'আইডি'),
};

const columns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'author',
    type: 'ref',
    ref: 'users',
    restorerOnNewRow: true,
    label: label('Author', 'লেখক'),
  },
  { key: 'title', type: 'string', required: true, label: label('Title', 'শিরোনাম') },
  { key: 'body', type: 'string', required: true, label: label('Body', 'বিবরণ') },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(NoticeStatus),
    label: label('Status', 'অবস্থা'),
  },
  { key: 'important', type: 'bool', required: true, label: label('Important', 'গুরুত্বপূর্ণ') },
  { key: 'pinned', type: 'bool', required: true, label: label('Pinned', 'পিন করা') },
  { key: 'is_public', type: 'bool', required: true, label: label('Public', 'সবার জন্য') },
  { key: 'expires_on', type: 'date', label: label('Expires on', 'মেয়াদ শেষ') },
  { key: 'published_at', type: 'datetime', label: label('Published at', 'প্রকাশের সময়') },
  { key: 'edited_at', type: 'datetime', label: label('Edited at', 'সম্পাদনার সময়') },
  { key: 'withdrawn_at', type: 'datetime', label: label('Withdrawn at', 'প্রত্যাহারের সময়') },
  {
    key: 'sms_status',
    type: 'enum',
    required: true,
    enumValues: Object.values(NoticeSmsStatus),
    label: label('SMS status', 'এসএমএস অবস্থা'),
  },
  {
    key: 'sms_requested_at',
    type: 'datetime',
    label: label('SMS requested at', 'এসএমএস অনুরোধের সময়'),
  },
  {
    key: 'sms_decided_at',
    type: 'datetime',
    label: label('SMS decided at', 'এসএমএস সিদ্ধান্তের সময়'),
  },
  { key: 'recipient_count', type: 'int', required: true, label: label('Recipients', 'প্রাপক') },
  { key: 'created_at', type: 'datetime', required: true, label: label('Created at', 'তৈরির সময়') },
];

const SCALARS = columns.filter((c) => c.key !== 'id' && c.key !== 'author');
const DATETIMES = SCALARS.filter((c) => c.type === 'datetime').map((c) => c.key);

export const rowError = (
  tab: string,
  rowNo: number,
  column: string | null,
  message: string,
  value?: string,
): RowError => ({ tab, row: rowNo, column, message, severity: 'error', value });

/** id -> natural key of one tab's rows in this school. */
export async function keysById(
  tab: { load(t: string, m: EntityManager): Promise<any[]>; keyOf(x: any): string },
  tenantId: string,
  m: EntityManager,
): Promise<Map<string, string>> {
  return new Map((await tab.load(tenantId, m)).map((p) => [p.id as string, tab.keyOf(p)]));
}

export const noticeKey = (createdAt: unknown, title: unknown) =>
  `${formatDateTime(createdAt)}|${String(title ?? '')}`;

const instant = (v: unknown): string =>
  v === null || v === undefined || v === '' ? '' : formatDateTime(v);

export const noticesTab: TabSpec<Notice, Rec> = {
  name: NOTICES,
  entity: Notice,
  excluded: [
    'author_user_id', // exported instead as the `author` ref column
    'withdrawn_by_user_id', // attribution only; status and timestamps are kept
    'sms_requested_by_user_id', // attribution only
    'sms_decided_by_user_id', // attribution only
    'public_token_hash', // D28: links do not survive a restore, hashes never leave the database
    'public_token_created_at', // D28: goes with the token hash
    'alert_id', // D28: derived attention alert, left off on restore
    'sms_task_alert_id', // D28: derived attention alert, left off on restore
    'updated_at', // set by the database on write
    'tenant_id', // implicit: every row is scoped to the workbook's own tenant
  ],
  dependsOn: ['users'],
  columns,
  naturalKey: ['created_at', 'title'],
  deleteByAbsence: true,

  load(tenantId: string, m: EntityManager): Promise<Notice[]> {
    return m.find(Notice, { where: { tenant_id: tenantId } });
  },

  toRow(entity: Notice, ctx: ExportContext): Rec {
    const e = entity as unknown as Rec;
    const out: Rec = {
      id: entity.id,
      // A departed author exports blank; restore keeps the stored one (or the restorer).
      author: optionalKeyOf(ctx, 'users', entity.author_user_id),
    };
    for (const c of SCALARS) out[c.key] = e[c.key];
    return out;
  },

  fromRow(cells: Record<string, string>, rowNo: number, ctx: ImportContext) {
    const errors: RowError[] = [];
    const v: Rec = {};
    for (const c of columns) {
      const r = fromCell(c, cells[c.key] ?? '', NOTICES, rowNo);
      if ('error' in r) errors.push(r.error);
      else v[c.key] = r.value;
    }
    if (errors.length > 0) return { errors };
    const bad = (column: string, message: string) =>
      errors.push(rowError(NOTICES, rowNo, column, message));
    if ((v.title as string).length > NOTICE_TITLE_MAX)
      bad('title', `Column "title": is longer than ${NOTICE_TITLE_MAX} characters.`);
    if ((v.body as string).length > NOTICE_BODY_MAX)
      bad('body', `Column "body": is longer than ${NOTICE_BODY_MAX} characters.`);
    // The DB CHECKs, so one bad row is reported instead of failing the whole import.
    if (v.status !== NoticeStatus.DRAFT && !v.published_at)
      bad('published_at', 'Column "published_at": is required unless the status is DRAFT.');
    if (v.status === NoticeStatus.WITHDRAWN && !v.withdrawn_at)
      bad('withdrawn_at', 'Column "withdrawn_at": is required when the status is WITHDRAWN.');
    if ((v.recipient_count as number) < 0)
      bad('recipient_count', 'Column "recipient_count": must not be negative.');
    const authorKey = (v.author as string | null) ?? '';
    const authorId = authorKey ? ctx.ref('users', authorKey) : null;
    if (authorKey && !authorId)
      errors.push(
        rowError(
          NOTICES,
          rowNo,
          'author',
          `Column "author": no user with the key "${authorKey}" was found.`,
          authorKey,
        ),
      );
    if (errors.length > 0) return { errors };
    return { row: { ...v, author_user_id: authorId } };
  },

  keyOf(x: Rec | Notice): string {
    return noticeKey(x.created_at, x.title);
  },

  diffFields(row: Rec, existing: Notice): string[] {
    const e = existing as unknown as Rec;
    const same = (key: string) =>
      DATETIMES.includes(key)
        ? instant(row[key]) === instant(e[key])
        : String(row[key] ?? '') === String(e[key] ?? '');
    const changed = SCALARS.map((c) => c.key).filter((k) => k !== 'created_at' && !same(k));
    if (row.author_user_id && row.author_user_id !== existing.author_user_id)
      changed.push('author');
    return changed;
  },

  async upsert(
    row: Rec,
    existing: Notice | null,
    tenantId: string,
    m: EntityManager,
    actorUserId?: string | null,
  ) {
    const n = existing ?? new Notice();
    const e = n as unknown as Rec;
    n.tenant_id = tenantId;
    n.author_user_id = actorOrRestorer(
      'Notice author',
      row.author_user_id as string | null,
      existing?.author_user_id,
      actorUserId,
    );
    for (const c of SCALARS) {
      if (c.key === 'created_at' && existing) continue; // never rewrite when the row already exists
      const val = row[c.key] ?? null;
      e[c.key] = c.type === 'datetime' && val !== null ? new Date(val as string) : val;
    }
    // The token hash and alert pointers are never touched: a restore over a live notice
    // keeps its link; a new row starts without one.
    return m.save(Notice, n);
  },

  async remove(entity: Notice, m: EntityManager): Promise<void> {
    // #3388: both child FKs are ON DELETE RESTRICT and this tab runs before
    // theirs, so the files and recipients go first (as NoticesService.remove
    // does). By notice id, not by the child tabs' rows: a recipient whose
    // person is not exportable is never loaded there, yet still holds the FK.
    const where = { tenant_id: entity.tenant_id, notice_id: entity.id };
    await m.delete(NoticeAttachment, where);
    await m.delete(NoticeRecipient, where);
    await m.remove(Notice, entity);
  },
};
