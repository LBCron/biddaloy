import type { EntityManager } from 'typeorm';
import { NoticeAttachment } from '../../../notices/entities/notice-attachment.entity';
import { fromCell } from '../../codec/cell-format';
import { ownStorageKey } from '../../codec/storage-key-scope';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { ID_COLUMN, NOTICES, noticesTab, rowError } from './notices.tab';

/**
 * [53.6.02] `notice_attachments`: file metadata only, the same as
 * `application_attachments`. The file bytes stay in the school's storage folder
 * (`tenants/<school>/notice-files/`), which a restore into the same school finds
 * untouched. A key from another school is re-homed with a warning (never kept),
 * so a restored row can never stream a different school's file.
 */
type Rec = Record<string, unknown>;
const TAB = 'notice_attachments';
const MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // the DB CHECK CHK_notice_attachments_size

const columns: readonly ColumnSpec[] = [
  ID_COLUMN,
  {
    key: 'notice',
    type: 'ref',
    ref: NOTICES,
    required: true,
    label: { en: 'Notice', bn: 'নোটিশ' },
  },
  {
    key: 'storage_key',
    type: 'string',
    required: true,
    label: { en: 'Storage key', bn: 'সংরক্ষণ কী' },
  },
  {
    key: 'mime_type',
    type: 'string',
    required: true,
    label: { en: 'File type', bn: 'ফাইলের ধরন' },
  },
  {
    key: 'size_bytes',
    type: 'int',
    required: true,
    label: { en: 'Size (bytes)', bn: 'আকার (বাইট)' },
  },
  {
    key: 'original_name',
    type: 'string',
    required: true,
    label: { en: 'File name', bn: 'ফাইলের নাম' },
  },
  { key: 'sort', type: 'int', required: true, label: { en: 'Order', bn: 'ক্রম' } },
];
const SCALAR_KEYS = ['mime_type', 'size_bytes', 'original_name', 'sort'] as const;

export const noticeAttachmentsTab: TabSpec<NoticeAttachment, Rec> = {
  name: TAB,
  entity: NoticeAttachment,
  excluded: [
    'notice_id', // exported instead as the `notice` ref column
    'created_at', // set by the database on insert
    'tenant_id', // implicit: every row is scoped to the workbook's own tenant
  ],
  dependsOn: [NOTICES],
  columns,
  naturalKey: ['storage_key'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<NoticeAttachment[]> {
    // Only attachments of notices that are in this school's export.
    const notices = new Set((await noticesTab.load(tenantId, m)).map((n) => n.id));
    const rows = await m.find(NoticeAttachment, { where: { tenant_id: tenantId } });
    return rows.filter((r) => notices.has(r.notice_id));
  },

  toRow(entity: NoticeAttachment, ctx: ExportContext): Rec {
    return {
      id: entity.id,
      notice: ctx.keyOf(NOTICES, entity.notice_id),
      storage_key: entity.storage_key,
      mime_type: entity.mime_type,
      size_bytes: entity.size_bytes,
      original_name: entity.original_name,
      sort: entity.sort,
    };
  },

  fromRow(cells: Record<string, string>, rowNo: number, ctx: ImportContext) {
    const errors: RowError[] = [];
    const v: Rec = {};
    for (const c of columns) {
      const r = fromCell(c, cells[c.key] ?? '', TAB, rowNo);
      if ('error' in r) errors.push(r.error);
      else v[c.key] = r.value;
    }
    if (errors.length > 0) return { errors };
    const bad = (column: string, message: string) =>
      errors.push(rowError(TAB, rowNo, column, message));
    // D10: the stored type is what the file is served as, so an edited sheet must not relabel it.
    if (!MIMES.includes(v.mime_type as string))
      bad('mime_type', `Column "mime_type": must be one of ${MIMES.join(', ')}.`);
    const size = v.size_bytes as number;
    if (size < 1 || size > MAX_BYTES)
      bad('size_bytes', `Column "size_bytes": must be between 1 and ${MAX_BYTES}.`);
    if ((v.original_name as string).length > 255)
      bad('original_name', 'Column "original_name": is longer than 255 characters.');
    // smallint column: out of range would fail the save and stop the whole restore.
    const sort = v.sort as number;
    if (sort < -32768 || sort > 32767)
      bad('sort', 'Column "sort": must be between -32768 and 32767.');
    const owned = ownStorageKey(
      v.storage_key as string,
      ctx.tenantId,
      TAB,
      rowNo,
      'storage_key',
      'notice-files',
    );
    if ('error' in owned) errors.push(owned.error);
    else if (owned.key.length > 500) bad('storage_key', 'Column "storage_key": is too long.');
    const noticeId = ctx.ref(NOTICES, v.notice as string);
    if (!noticeId)
      errors.push(
        rowError(
          TAB,
          rowNo,
          'notice',
          'Column "notice": no such notice was found.',
          v.notice as string,
        ),
      );
    if (errors.length > 0 || 'error' in owned) return { errors };
    if (owned.warning) ctx.warn(owned.warning);
    return { row: { ...v, notice_id: noticeId, storage_key: owned.key } };
  },

  keyOf(x: Rec | NoticeAttachment): string {
    return x.storage_key as string;
  },

  diffFields(row: Rec, existing: NoticeAttachment): string[] {
    const e = existing as unknown as Rec;
    const changed: string[] = SCALAR_KEYS.filter((k) => row[k] !== e[k]);
    if (row.notice_id !== existing.notice_id) changed.push('notice');
    return changed;
  },

  async upsert(row: Rec, existing: NoticeAttachment | null, tenantId: string, m: EntityManager) {
    const a = existing ?? new NoticeAttachment();
    a.tenant_id = tenantId;
    a.notice_id = row.notice_id as string;
    a.storage_key = row.storage_key as string;
    a.mime_type = row.mime_type as string;
    a.size_bytes = row.size_bytes as number;
    a.original_name = row.original_name as string;
    a.sort = row.sort as number;
    return m.save(NoticeAttachment, a);
  },

  async remove(entity: NoticeAttachment, m: EntityManager): Promise<void> {
    await m.remove(NoticeAttachment, entity);
  },
};
