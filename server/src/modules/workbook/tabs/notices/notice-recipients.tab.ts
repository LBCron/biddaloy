import type { EntityManager } from 'typeorm';
import { Logger } from '@nestjs/common';
import { NoticeRecipientKind } from '@biddaloy/shared';
import { NoticeRecipient } from '../../../notices/entities/notice-recipient.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';
import { guardiansTab } from '../people/guardians.tab';
import { studentsTab } from '../people/students.tab';
import { usersTab } from '../people/users.tab';
import { ID_COLUMN, NOTICES, instant, keysById, noticesTab, rowError } from './notices.tab';

/**
 * [53.6.02] `notice_recipients`: one row per person a notice went to, with the
 * seen / acknowledged / link-opened / SMS / push timestamps kept.
 *
 * Left out: `link_token_hash` (D28/D40: personal links do not survive a restore, even
 * into the same school; the notices tab clears them; hashes never enter a workbook) and
 * `communication_log_id` (communication logs are not backed up, so the pointer would dangle).
 *
 * A recipient whose person is no longer exportable (staff who left, soft-deleted
 * student or guardian) is left out of the export instead of failing the whole backup,
 * with a logged count; its notice stays. If a restore deletes that notice, the
 * notices tab deletes these hidden rows with it.
 */
type Rec = Record<string, unknown>;
const TAB = 'notice_recipients';
const logger = new Logger('NoticeRecipientsTab');
const STAMP = '__keys';

const REFS = [
  ['user', 'user_id', 'users', 'User', 'ব্যবহারকারী'],
  ['student', 'student_id', 'students', 'Student', 'শিক্ষার্থী'],
  ['guardian', 'guardian_id', 'guardians', 'Guardian', 'অভিভাবক'],
] as const;
const DATETIME_KEYS = ['seen_at', 'acknowledged_at', 'link_opened_at', 'sms_sent_at', 'pushed_at'];

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
    key: 'kind',
    type: 'enum',
    required: true,
    enumValues: Object.values(NoticeRecipientKind),
    label: { en: 'Kind', bn: 'ধরন' },
  },
  ...REFS.map(([key, , ref, en, bn]) => ({
    key,
    type: 'ref' as const,
    ref,
    label: { en, bn },
  })),
  { key: 'seen_at', type: 'datetime', label: { en: 'Seen at', bn: 'দেখার সময়' } },
  {
    key: 'acknowledged_at',
    type: 'datetime',
    label: { en: 'Acknowledged at', bn: 'স্বীকারের সময়' },
  },
  {
    key: 'link_opened_at',
    type: 'datetime',
    label: { en: 'Link opened at', bn: 'লিংক খোলার সময়' },
  },
  {
    key: 'sms_wanted',
    type: 'bool',
    required: true,
    label: { en: 'SMS wanted', bn: 'এসএমএস চাই' },
  },
  { key: 'sms_sent_at', type: 'datetime', label: { en: 'SMS sent at', bn: 'এসএমএস পাঠানোর সময়' } },
  { key: 'pushed_at', type: 'datetime', label: { en: 'Pushed at', bn: 'পুশের সময়' } },
];
const SCALAR_KEYS = [...DATETIME_KEYS, 'kind', 'sms_wanted'];

const keyText = (
  notice: unknown,
  kind: unknown,
  user: unknown,
  student: unknown,
  guardian: unknown,
) => [notice, kind, user, student, guardian].map((p) => String(p ?? '')).join('|');

export const noticeRecipientsTab: TabSpec<NoticeRecipient, Rec> = {
  name: TAB,
  entity: NoticeRecipient,
  excluded: [
    'notice_id', // exported instead as the `notice` ref column
    'user_id', // exported instead as the `user` ref column
    'student_id', // exported instead as the `student` ref column
    'guardian_id', // exported instead as the `guardian` ref column
    'link_token_hash', // D28: links do not survive a restore, hashes never leave the database
    'communication_log_id', // communication logs are not in the backup, the pointer would dangle
    'created_at', // set by the database on insert
    'tenant_id', // implicit: every row is scoped to the workbook's own tenant
  ],
  dependsOn: [NOTICES, 'users', 'students', 'guardians'],
  columns,
  naturalKey: ['notice', 'kind', 'user', 'student', 'guardian'],
  deleteByAbsence: true,

  async load(tenantId: string, m: EntityManager): Promise<NoticeRecipient[]> {
    const [notices, users, students, guardians] = await Promise.all([
      keysById(noticesTab, tenantId, m),
      keysById(usersTab, tenantId, m),
      keysById(studentsTab, tenantId, m),
      keysById(guardiansTab, tenantId, m),
    ]);
    const maps = { user: users, student: students, guardian: guardians } as const;
    const rows = await m.find(NoticeRecipient, { where: { tenant_id: tenantId } });
    const kept: NoticeRecipient[] = [];
    const skipped: Record<string, number> = {};
    for (const r of rows) {
      const notice = notices.get(r.notice_id);
      if (notice === undefined) continue;
      const keys: Rec = { notice };
      let ok = true;
      for (const [key, fk] of REFS) {
        const id = r[fk];
        if (id === null) {
          keys[key] = '';
        } else if (maps[key].has(id)) {
          keys[key] = maps[key].get(id);
        } else {
          ok = false;
          skipped[key] = (skipped[key] ?? 0) + 1;
        }
      }
      if (!ok) continue;
      (r as unknown as Rec)[STAMP] = keys;
      kept.push(r);
    }
    // Counts only (no person ids, Rule 13). `load` also runs on validate and restore.
    if (Object.keys(skipped).length > 0)
      logger.warn(
        `Tenant ${tenantId}: recipients left out, person not exportable: ${JSON.stringify(skipped)}`,
      );
    return kept;
  },

  toRow(entity: NoticeRecipient, ctx: ExportContext): Rec {
    const e = entity as unknown as Rec;
    const out: Rec = {
      id: entity.id,
      notice: ctx.keyOf(NOTICES, entity.notice_id),
      kind: entity.kind,
    };
    for (const [key, fk, tab] of REFS) {
      out[key] = entity[fk] ? ctx.keyOf(tab, entity[fk]) : null;
    }
    for (const k of [...DATETIME_KEYS, 'sms_wanted']) out[k] = e[k];
    return out;
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
    const out: Rec = { ...v };
    const resolve = (column: string, refTab: string, key: string): string | null => {
      const id = ctx.ref(refTab, key);
      if (!id)
        errors.push(
          rowError(
            TAB,
            rowNo,
            column,
            // Rule 23: column and tab are constants; the key goes in `value` only.
            `Column "${column}": no such ${refTab} row was found.`,
            key,
          ),
        );
      return id ?? null;
    };
    out.notice_id = resolve('notice', NOTICES, v.notice as string);
    for (const [key, fk, tab] of REFS) {
      const cell = (v[key] as string | null) ?? '';
      out[fk] = cell ? resolve(key, tab, cell) : null;
      out[`${key}_key`] = cell;
    }
    out.notice_key = v.notice;
    // The DB CHECK CHK_notice_recipients_target: which person each kind needs.
    const has = (k: string) => !!v[k];
    const kind = v.kind as NoticeRecipientKind;
    const targetOk =
      (kind === NoticeRecipientKind.STAFF && has('user')) ||
      (kind === NoticeRecipientKind.STUDENT && has('student')) ||
      (kind === NoticeRecipientKind.GUARDIAN && has('guardian') && has('student'));
    if (!targetOk)
      errors.push(
        rowError(TAB, rowNo, 'kind', 'Column "kind": the matching person columns are not filled.'),
      );
    if (errors.length > 0) return { errors };
    return { row: out };
  },

  keyOf(x: Rec | NoticeRecipient): string {
    if (x instanceof NoticeRecipient) {
      const k = ((x as unknown as Rec)[STAMP] ?? {}) as Rec;
      return keyText(k.notice, x.kind, k.user, k.student, k.guardian);
    }
    return keyText(x.notice_key, x.kind, x.user_key, x.student_key, x.guardian_key);
  },

  diffFields(row: Rec, existing: NoticeRecipient): string[] {
    const e = existing as unknown as Rec;
    const changed = SCALAR_KEYS.filter((k) =>
      DATETIME_KEYS.includes(k) ? instant(row[k]) !== instant(e[k]) : row[k] !== e[k],
    );
    return changed;
  },

  async upsert(row: Rec, existing: NoticeRecipient | null, tenantId: string, m: EntityManager) {
    const r = existing ?? new NoticeRecipient();
    const e = r as unknown as Rec;
    r.tenant_id = tenantId;
    r.notice_id = row.notice_id as string;
    r.kind = row.kind as NoticeRecipientKind;
    r.user_id = row.user_id as string | null;
    r.student_id = row.student_id as string | null;
    r.guardian_id = row.guardian_id as string | null;
    r.sms_wanted = row.sms_wanted as boolean;
    for (const k of DATETIME_KEYS) {
      const val = row[k] ?? null;
      e[k] = val === null ? null : new Date(val as string);
    }
    // link_token_hash is already cleared by the notices tab (D40), which runs
    // first; communication_log_id is untouched (not in the backup).
    return m.save(NoticeRecipient, r);
  },

  async remove(entity: NoticeRecipient, m: EntityManager): Promise<void> {
    await m.remove(NoticeRecipient, entity);
  },
};
