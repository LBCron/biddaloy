/**
 * Milestones tab — [34.4.1]. Clone of `-band-editor.tsx`'s inline-editable
 * list shape, adapted to an ordered list with ↑/↓ (mouse) and `Alt+↑/↓`
 * (keyboard, D9) reorder controls instead of a table. Remove asks first,
 * showing the `{{count}} achievements` the removal would also delete
 * (D23) — the count comes back on `GET /programs/:id`'s
 * `achievement_count` field.
 */
import { Button, ConfirmDialog, Input, RowActions, Textarea } from '@biddaloy/ui/components';
import {
  useAddMilestone,
  useRemoveMilestone,
  useReorderMilestones,
  useUpdateMilestone,
  type ProgramMilestone,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { LabelledField } from './-labelled-field';

const ICON_BUTTON = 'size-11 text-text-secondary md:size-8';

export interface MilestoneEditorProps {
  programId: string;
  milestones: ProgramMilestone[];
  /** [D5] Add/edit/remove/reorder require `PROGRAM_MANAGE` — a
   * `PROGRAM_RECORD`-only viewer (e.g. a teacher) sees the list read-only. */
  canManage: boolean;
}

export function MilestoneEditor({ programId, milestones, canManage }: MilestoneEditorProps) {
  const { t } = useTranslation('programs');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const addMilestone = useAddMilestone(programId);
  const updateMilestone = useUpdateMilestone(programId);
  const removeMilestone = useRemoveMilestone(programId);
  const reorderMilestones = useReorderMilestones(programId);

  const [addName, setAddName] = React.useState('');
  const [addDescription, setAddDescription] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [pendingRemoveId, setPendingRemoveId] = React.useState<string | null>(null);

  const ordered = [...milestones].sort((a, b) => a.sequence - b.sequence);

  // One alert covers all three: a new attempt makes an earlier failure stale.
  function clearFailures() {
    addMilestone.reset();
    updateMilestone.reset();
    reorderMilestones.reset();
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const moved = next.splice(index, 1)[0];
    if (!moved) return;
    next.splice(target, 0, moved);
    clearFailures();
    reorderMilestones.mutate(next.map((m) => m.id));
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, 1);
    }
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!addName.trim()) return;
    clearFailures();
    addMilestone.mutate(
      { name: addName.trim(), description: addDescription.trim() ? addDescription.trim() : null },
      {
        onSuccess: () => {
          setAddName('');
          setAddDescription('');
        },
      },
    );
  }

  function startEdit(milestone: ProgramMilestone) {
    setEditingId(milestone.id);
    setEditName(milestone.name);
    setEditDescription(milestone.description ?? '');
  }

  function handleEditSave(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId || !editName.trim()) return;
    clearFailures();
    updateMilestone.mutate(
      {
        milestoneId: editingId,
        input: {
          name: editName.trim(),
          description: editDescription.trim() ? editDescription.trim() : null,
        },
      },
      { onSuccess: () => setEditingId(null) },
    );
  }

  const pendingRemove = ordered.find((m) => m.id === pendingRemoveId);

  const mutationFailed =
    addMilestone.isError || updateMilestone.isError || reorderMilestones.isError;

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
      {ordered.length === 0 && (
        <p className="px-4 py-6 text-center text-text-secondary">{t('milestones.emptyHint')}</p>
      )}

      <ol className="divide-y divide-border-subtle" aria-label={t('detail.tabs.milestones')}>
        {ordered.map((milestone, index) => (
          <li
            key={milestone.id}
            className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-3"
          >
            {canManage && editingId === milestone.id ? (
              <form onSubmit={handleEditSave} className="flex min-w-0 flex-1 flex-col gap-3">
                <LabelledField
                  id={`milestone-name-${milestone.id}`}
                  label={t('formDialog.nameLabel')}
                  required
                >
                  <Input
                    id={`milestone-name-${milestone.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </LabelledField>
                <LabelledField
                  id={`milestone-desc-${milestone.id}`}
                  label={t('formDialog.descriptionLabel')}
                >
                  <Textarea
                    id={`milestone-desc-${milestone.id}`}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </LabelledField>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={updateMilestone.isPending}
                    onClick={() => {
                      updateMilestone.reset();
                      setEditingId(null);
                    }}
                  >
                    {tCommon('actions.cancel')}
                  </Button>
                  <Button type="submit" loading={updateMilestone.isPending}>
                    {tCommon('actions.save')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <span className="w-6 shrink-0 text-text-secondary tabular-nums">
                  {formatNumber(index + 1, regionConfig)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{milestone.name}</p>
                  {milestone.description && (
                    <p className="text-text-secondary">{milestone.description}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      aria-label={t('milestones.moveUp')}
                      className={ICON_BUTTON}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      iconOnly
                      aria-label={t('milestones.moveDown')}
                      className={ICON_BUTTON}
                      disabled={index === ordered.length - 1}
                      onClick={() => move(index, 1)}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <RowActions
                      actions={[
                        {
                          intent: 'edit',
                          label: t('milestones.edit'),
                          onClick: () => startEdit(milestone),
                        },
                        {
                          intent: 'delete',
                          label: t('milestones.remove'),
                          onClick: () => {
                            removeMilestone.reset();
                            setPendingRemoveId(milestone.id);
                          },
                        },
                      ]}
                    />
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ol>

      {mutationFailed && (
        <p role="alert" className="border-t border-border-subtle px-4 py-3 text-destructive">
          {t('milestones.errorMessage')}
        </p>
      )}

      <ConfirmDialog
        open={canManage && !!pendingRemove}
        onOpenChange={(o) => !o && !removeMilestone.isPending && setPendingRemoveId(null)}
        tone="danger"
        title={t('milestones.removeTitle')}
        helpId="people.programs.action.removeMilestone"
        description={
          removeMilestone.isError
            ? t('milestones.errorMessage')
            : t('milestones.removeConfirm', {
                count: pendingRemove?.achievement_count ?? 0,
                n: formatNumber(pendingRemove?.achievement_count ?? 0, regionConfig),
              })
        }
        confirmLabel={t('milestones.remove')}
        busy={removeMilestone.isPending}
        onConfirm={() => {
          if (!pendingRemove) return;
          removeMilestone.mutate(pendingRemove.id, {
            onSuccess: () => setPendingRemoveId(null),
          });
        }}
      />

      {canManage && (
        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-4 border-t border-border-subtle p-4 md:p-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField id="milestone-add-name" label={t('milestones.nameLabel')}>
              <Input
                id="milestone-add-name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
              />
            </LabelledField>
            <LabelledField id="milestone-add-desc" label={t('formDialog.descriptionLabel')}>
              <Textarea
                id="milestone-add-desc"
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
              />
            </LabelledField>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline" loading={addMilestone.isPending}>
              <PlusIcon aria-hidden />
              {t('milestones.add')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
