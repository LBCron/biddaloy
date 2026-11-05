/**
 * [70.5.x] The remark + conduct grid of `/my-class/$sectionId/notes`. Controlled: the route owns
 * the drafts and the save. One row per student (md and up), one card per student on a phone with
 * the conduct grades in a 2x2 grid. DOM order is row by row, so Tab walks remark, then each grade.
 */
import { ConductGrade, type ConductItem } from '@biddaloy/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import type { ReportCardNotesRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export const REMARK_MAX = 300;

export interface NoteDraft {
  remark: string;
  /** conduct item key -> grade; a missing key is "not graded". */
  conduct: Record<string, ConductGrade>;
}

const GRADES = Object.values(ConductGrade);
const NONE = '__none';

export interface NotesGridProps {
  rows: ReportCardNotesRow[];
  items: ConductItem[];
  drafts: Record<string, NoteDraft>;
  onChange: (studentId: string, next: NoteDraft) => void;
  disabled?: boolean;
}

export function NotesGrid({ rows, items, drafts, onChange, disabled = false }: NotesGridProps) {
  const { t, i18n } = useTranslation('myClass');
  const bn = i18n.language.startsWith('bn');
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const draft = drafts[row.student_id] ?? { remark: '', conduct: {} };
        const name = bn ? (row.full_name_bn ?? row.full_name) : row.full_name;
        return (
          <li
            key={row.student_id}
            className="grid gap-3 rounded-lg border border-border-subtle bg-card p-3 md:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)_minmax(0,20rem)] md:items-start"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="text-text-secondary">{`${t('notes.roll')} ${row.roll_number}`}</p>
            </div>
            <div>
              <Textarea
                rows={2}
                value={draft.remark}
                maxLength={REMARK_MAX}
                disabled={disabled}
                aria-label={`${t('notes.remarkLabel')} — ${name}`}
                placeholder={t('notes.remarkPlaceholder')}
                onChange={(e) => onChange(row.student_id, { ...draft, remark: e.target.value })}
              />
              <p className="mt-1 text-end text-text-secondary tabular-nums">
                {t('notes.charCount', { count: draft.remark.length, max: REMARK_MAX })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item) => {
                const itemName = bn ? item.name_bn : item.name_en;
                const grade = draft.conduct[item.key];
                return (
                  <div key={item.key} className="min-w-0">
                    <span aria-hidden="true" className="block truncate text-text-secondary">
                      {itemName}
                    </span>
                    <Select
                      value={grade ?? NONE}
                      disabled={disabled}
                      onValueChange={(v) => {
                        const rest = Object.fromEntries(
                          Object.entries(draft.conduct).filter(([k]) => k !== item.key),
                        );
                        onChange(row.student_id, {
                          ...draft,
                          conduct: v === NONE ? rest : { ...rest, [item.key]: v as ConductGrade },
                        });
                      }}
                    >
                      <SelectTrigger aria-label={`${itemName} — ${name}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {GRADES.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
