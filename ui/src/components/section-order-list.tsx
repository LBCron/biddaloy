/**
 * [40.3.03] The sections of one website page: name, on/off switch, ↑ ↓ and Edit. A `pinned` row
 * (hero first, footer last, D31) shows no ↑ ↓ and a row can never be moved past one. `onMove`
 * gets indexes into the full `sections` array. Texts are props, like `ChoiceCards`.
 */
import { Button } from './button';
import { ReorderButtons } from './reorder-buttons';
import { Switch } from './switch';

export interface SectionOrderItem {
  key: string;
  /** Already in the reader's language. */
  name: string;
  enabled: boolean;
  pinned?: boolean;
}

export interface SectionOrderListLabels {
  toggle: (name: string) => string;
  up: (name: string, position: number) => string;
  down: (name: string, position: number) => string;
  edit: (name: string) => string;
  /** Said once under a pinned row's name. */
  pinned: string;
}

export interface SectionOrderListProps {
  sections: SectionOrderItem[];
  onToggle: (key: string, enabled: boolean) => void;
  onMove: (from: number, to: number) => void;
  onEdit: (key: string) => void;
  labels: SectionOrderListLabels;
}

export function SectionOrderList({
  sections,
  onToggle,
  onMove,
  onEdit,
  labels,
}: SectionOrderListProps) {
  const movable = sections.flatMap((s, i) => (s.pinned ? [] : [i]));
  return (
    <ol className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-card">
      {sections.map((s) => {
        const slot = movable.indexOf(sections.indexOf(s));
        return (
          <li
            key={s.key}
            className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-body font-medium">{s.name}</p>
              {s.pinned ? <p className="text-sm text-text-secondary">{labels.pinned}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                aria-label={labels.toggle(s.name)}
                checked={s.enabled}
                onCheckedChange={(on) => onToggle(s.key, on)}
              />
              {s.pinned ? null : (
                <ReorderButtons
                  index={slot}
                  count={movable.length}
                  upLabel={labels.up(s.name, slot + 1)}
                  downLabel={labels.down(s.name, slot + 1)}
                  onMove={(from, to) => onMove(movable[from] ?? from, movable[to] ?? to)}
                />
              )}
              <Button type="button" variant="ghost" onClick={() => onEdit(s.key)}>
                {labels.edit(s.name)}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
