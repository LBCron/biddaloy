/**
 * [33.4.1] The "Shift, version & group" settings section — a UI over
 * [33.1.1]'s `TenantSettings.organisation.{shifts,versions,groups}` and
 * [33.3.1]'s explicit rename instruction. Same "clone `AttendanceSection`'s
 * plumbing" starting point the plan calls for, but the actual editing
 * surface is three parallel list editors rather than a flat field form —
 * `react-hook-form`/`FormShell`'s per-field validation summary doesn't fit
 * "add/rename/remove a row in an array," so this component manages its
 * own local list state instead and reuses `SettingsSection` for the card
 * chrome every other settings section has.
 *
 * [D4] A value still in use by a class/section is rejected by the
 * server, not pre-checked here — the count can change between render and
 * save, so the server is the sole authority. Its refusal ("Cannot remove
 * "X" from shifts — ...") is parsed only to find the offending row; the row
 * shows a translated line, never the server text.
 *
 * [33.3.1] A rename is sent as an explicit `{ list, from, to }` instruction
 * alongside the normal `organisation` patch (same request) — never
 * inferred from a remove+add diff. Only one rename per list per save, same
 * limit the server enforces (`schools.service.ts`'s `applyOrganisationVocabularyGuard`).
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@biddaloy/ui/components';
import {
  useSchoolSettings,
  useUpdateSchoolSettings,
  type OrganisationSettings,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { CircleMinusIcon, PencilIcon, PlusIcon, Undo2Icon } from 'lucide-react';
import * as React from 'react';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

type ListName = 'shifts' | 'versions' | 'groups';
const LIST_NAMES: ListName[] = ['shifts', 'versions', 'groups'];

interface Entry {
  value: string;
  markedForRemoval: boolean;
}

interface Rename {
  from: string;
  to: string;
}

interface ListState {
  entries: Entry[];
  addValue: string;
  renamingValue: string | null;
  renameInput: string;
  rename: Rename | null;
  rowError: { value: string } | null;
}

function emptyListState(values: string[]): ListState {
  return {
    entries: values.map((value) => ({ value, markedForRemoval: false })),
    addValue: '',
    renamingValue: null,
    renameInput: '',
    rename: null,
    rowError: null,
  };
}

function toInitialState(
  organisation: OrganisationSettings | undefined,
): Record<ListName, ListState> {
  return {
    shifts: emptyListState(organisation?.shifts ?? []),
    versions: emptyListState(organisation?.versions ?? []),
    groups: emptyListState(organisation?.groups ?? []),
  };
}

function finalValues(state: ListState): string[] {
  return state.entries.filter((entry) => !entry.markedForRemoval).map((entry) => entry.value);
}

function isDirty(state: ListState, saved: string[]): boolean {
  const current = finalValues(state);
  return current.length !== saved.length || current.some((value, index) => value !== saved[index]);
}

/** Parses `schools.service.ts`'s own "Cannot remove ... N row(s) still
 * use it" refusal text back into which list/value it's about — the
 * server keeps this message stable for exactly this reason (see
 * `ui/src/api/errors.ts`'s own comment on `ApiErrorBody`). */
const REMOVE_REFUSAL_PATTERN = /^Cannot remove "(.+)" from (shifts|versions|groups) —/;

export interface OrganisationSectionProps {
  schoolId: string;
  organisation: OrganisationSettings | undefined;
}

export function OrganisationSection({ schoolId, organisation }: OrganisationSectionProps) {
  const { t } = useTranslation('settings');
  const [lists, setLists] = React.useState(() => toInitialState(organisation));
  const savedRef = React.useRef({
    shifts: organisation?.shifts ?? [],
    versions: organisation?.versions ?? [],
    groups: organisation?.groups ?? [],
  });
  const updateSettings = useUpdateSchoolSettings(schoolId);

  const dirty = LIST_NAMES.some((list) => isDirty(lists[list], savedRef.current[list]));
  useWarnUnsavedChanges(dirty);

  function updateList(list: ListName, updater: (state: ListState) => ListState) {
    // Editing a row makes any earlier save error stale.
    updateSettings.reset();
    setLists((prev) => ({ ...prev, [list]: updater(prev[list]) }));
  }

  function handleAdd(list: ListName) {
    updateList(list, (state) => {
      const value = state.addValue.trim();
      if (!value) return state;
      return {
        ...state,
        entries: [...state.entries, { value, markedForRemoval: false }],
        addValue: '',
      };
    });
  }

  function handleToggleRemove(list: ListName, value: string) {
    updateList(list, (state) => ({
      ...state,
      entries: state.entries.map((entry) =>
        entry.value === value ? { ...entry, markedForRemoval: !entry.markedForRemoval } : entry,
      ),
      rowError: state.rowError?.value === value ? null : state.rowError,
    }));
  }

  function handleStartRename(list: ListName, value: string) {
    updateList(list, (state) => ({ ...state, renamingValue: value, renameInput: value }));
  }

  function handleCancelRename(list: ListName) {
    updateList(list, (state) => ({ ...state, renamingValue: null, renameInput: '' }));
  }

  function handleConfirmRename(list: ListName) {
    updateList(list, (state) => {
      const from = state.renamingValue;
      const to = state.renameInput.trim();
      if (!from || !to || to === from) return { ...state, renamingValue: null, renameInput: '' };
      // [CodeRabbit, PR #916] Only one rename per list per save (the
      // server's own limit — `applyOrganisationVocabularyGuard` rejects a
      // second `{ list, from, to }` for the same list). A rename on a
      // *different* entry while one is already pending would otherwise
      // silently overwrite `state.rename`, dropping the first rename from
      // the PATCH — that entry then reads as a plain removal server-side
      // and gets rejected if still in use. Refused here (the "Rename"
      // button is also `disabled` on every other row while one is
      // pending — see `VocabularyList` below — so this is a defensive
      // second guard, not the only one). Re-renaming the *same* entry
      // again (chained: Morning → Prabhati → Shokal) collapses into the
      // original `from`, so the server still sees exactly one pair.
      if (state.rename && state.rename.to !== from) return state;
      const originalFrom = state.rename?.from ?? from;
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.value === from ? { ...entry, value: to } : entry,
        ),
        rename: { from: originalFrom, to },
        renamingValue: null,
        renameInput: '',
      };
    });
  }

  function handleSave() {
    setLists((prev) => {
      const cleared = LIST_NAMES.reduce(
        (acc, list) => ({ ...acc, [list]: { ...prev[list], rowError: null } }),
        {} as Record<ListName, ListState>,
      );
      return cleared;
    });

    const organisationPatch = {
      shifts: finalValues(lists.shifts),
      versions: finalValues(lists.versions),
      groups: finalValues(lists.groups),
    };
    const organisationRenames = LIST_NAMES.filter((list) => lists[list].rename !== null).map(
      (list) => ({ list, from: lists[list].rename!.from, to: lists[list].rename!.to }),
    );

    updateSettings.mutate(
      {
        version: 1,
        organisation: organisationPatch,
        ...(organisationRenames.length > 0 ? { organisationRenames } : {}),
      },
      {
        onSuccess: (settings) => {
          savedRef.current = {
            shifts: settings.organisation?.shifts ?? [],
            versions: settings.organisation?.versions ?? [],
            groups: settings.organisation?.groups ?? [],
          };
          setLists(toInitialState(settings.organisation));
        },
        onError: (error) => {
          const match = REMOVE_REFUSAL_PATTERN.exec(
            error instanceof Error ? error.message : String(error),
          );
          if (match && error instanceof ApiError) {
            const value = match[1]!;
            const list = match[2] as ListName;
            // Set directly: `updateList` would reset the mutation (and with it this error state).
            setLists((prev) => ({ ...prev, [list]: { ...prev[list], rowError: { value } } }));
          }
          // Any other failure shows through `updateSettings.isError` below.
        },
      },
    );
  }

  const refused = LIST_NAMES.some((list) => lists[list].rowError !== null);

  return (
    <>
      <SettingsSection
        id="organisation-section"
        title={t('organisation.legend')}
        helpId="administration.settings.section.organisation"
        description={t('organisation.description')}
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && !refused && (
              <SettingsMutationError error={updateSettings.error} />
            )}
          </>
        }
      >
        <TooltipProvider delayDuration={300}>
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            {LIST_NAMES.map((list) => (
              <VocabularyList
                key={list}
                list={list}
                state={lists[list]}
                onAddValueChange={(value) =>
                  updateList(list, (state) => ({ ...state, addValue: value }))
                }
                onAdd={() => handleAdd(list)}
                onToggleRemove={(value) => handleToggleRemove(list, value)}
                onStartRename={(value) => handleStartRename(list, value)}
                onCancelRename={() => handleCancelRename(list)}
                onRenameInputChange={(value) =>
                  updateList(list, (state) => ({ ...state, renameInput: value }))
                }
                onConfirmRename={() => handleConfirmRename(list)}
              />
            ))}
          </div>
        </TooltipProvider>
        {updateSettings.isError && refused && (
          <p role="alert" className="mt-3 text-destructive">
            {t('organisation.removeInUseSummary')}
          </p>
        )}
      </SettingsSection>
      <ConductItemsSection schoolId={schoolId} />
    </>
  );
}

/** [70.4.1] One conduct line on the report card. `key` is null until the first save. */
interface ConductRow {
  key: string | null;
  name_bn: string;
  name_en: string;
}

/** Same pattern and cap as the server's `ConductItemDto` / `CONDUCT_ITEMS_MAX`. */
const CONDUCT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,30}$/;
const CONDUCT_ITEMS_MAX = 12;

/** Key a new line is stored under: its English name as a lowercase slug. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const rowKey = (row: ConductRow) => row.key ?? slugify(row.name_en);

function toConductRows(items: { key: string; name_bn: string; name_en: string }[] | undefined) {
  return (items ?? []).map((item): ConductRow => ({ ...item }));
}

/**
 * [70.4.1] "Conduct and co-curricular lines" card: the lines a class teacher
 * grades A to D on the report card. Clone of the list editors above, but each
 * row has two names. A saved line keeps its key forever (renaming only changes
 * the names); a new line's key is its English name, shown read-only. Read from
 * the same settings query the page already loads, so no extra request.
 */
function ConductItemsSection({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation('settings');
  const settings = useSchoolSettings(schoolId);
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const saved = settings.data?.exams?.conductItems;
  const [rows, setRows] = React.useState<ConductRow[]>(() => toConductRows(saved));
  const [loadedFrom, setLoadedFrom] = React.useState(saved);
  const [showErrors, setShowErrors] = React.useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(toConductRows(saved));
  const wasDirty = JSON.stringify(rows) !== JSON.stringify(toConductRows(loadedFrom));

  // Settings can arrive after first render (or be refetched): adopt them, but
  // never over unsaved typing and never mid-save.
  if (saved !== loadedFrom && !updateSettings.isPending) {
    setLoadedFrom(saved);
    if (!wasDirty) setRows(toConductRows(saved));
  }
  useWarnUnsavedChanges(dirty);

  const keys = rows.map(rowKey);
  const rowProblem = (row: ConductRow, index: number): string | null => {
    if (!row.name_bn.trim() || !row.name_en.trim()) return t('conductItems.nameRequired');
    const key = keys[index]!;
    if (!CONDUCT_KEY_PATTERN.test(key) || keys.indexOf(key) !== index) {
      return t('conductItems.keyInvalid');
    }
    return null;
  };
  const listProblem =
    rows.length === 0
      ? t('conductItems.emptyList')
      : rows.length > CONDUCT_ITEMS_MAX
        ? t('conductItems.maxItems', { count: CONDUCT_ITEMS_MAX })
        : null;

  function edit(index: number, patch: Partial<ConductRow>) {
    updateSettings.reset();
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleSave() {
    setShowErrors(true);
    if (listProblem || rows.some((row, i) => rowProblem(row, i))) return;
    updateSettings.mutate(
      {
        version: 1,
        exams: {
          conductItems: rows.map((row, i) => ({
            key: keys[i]!,
            name_bn: row.name_bn.trim(),
            name_en: row.name_en.trim(),
          })),
        },
      },
      {
        onSuccess: (next) => {
          setShowErrors(false);
          // Show what the server stored (new lines now carry their key).
          setLoadedFrom(next.exams?.conductItems);
          setRows(toConductRows(next.exams?.conductItems));
        },
      },
    );
  }

  return (
    <SettingsSection
      id="conduct-items-section"
      title={t('conductItems.legend')}
      description={t('conductItems.description')}
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
      saving={updateSettings.isPending}
      footerStart={
        <>
          {updateSettings.isSuccess && <SettingsSaved />}
          {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
        </>
      }
    >
      <p className="mt-2 text-text-secondary">{t('help.conductItems')}</p>
      <ul className="mt-4 space-y-3" data-testid="conduct-items">
        {rows.map((row, index) => {
          const problem = showErrors ? rowProblem(row, index) : null;
          return (
            // Index key: rows have no stable id until saved and are only added or removed in place.
            <li key={index}>
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-2">
                  <Input
                    aria-label={t('conductItems.nameBn')}
                    placeholder={t('conductItems.nameBn')}
                    maxLength={60}
                    value={row.name_bn}
                    onChange={(event) => edit(index, { name_bn: event.target.value })}
                  />
                  <Input
                    aria-label={t('conductItems.nameEn')}
                    placeholder={t('conductItems.nameEn')}
                    maxLength={60}
                    value={row.name_en}
                    onChange={(event) => edit(index, { name_en: event.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('conductItems.remove')}: ${row.name_en || row.name_bn || index + 1}`}
                  onClick={() => {
                    updateSettings.reset();
                    setRows((prev) => prev.filter((_, i) => i !== index));
                  }}
                >
                  <CircleMinusIcon aria-hidden="true" className="text-destructive" />
                </Button>
              </div>
              <p className="mt-1 text-text-secondary">
                {t('conductItems.keyHint', { key: keys[index] || '-' })}
              </p>
              {problem && (
                <p role="alert" className="text-destructive">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {showErrors && listProblem && (
        <p role="alert" className="mt-2 text-destructive">
          {listProblem}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="mt-3 gap-2"
        disabled={rows.length >= CONDUCT_ITEMS_MAX}
        onClick={() => {
          updateSettings.reset();
          setRows((prev) => [...prev, { key: null, name_bn: '', name_en: '' }]);
        }}
      >
        <PlusIcon aria-hidden="true" />
        {t('conductItems.add')}
      </Button>
    </SettingsSection>
  );
}

interface VocabularyListProps {
  list: ListName;
  state: ListState;
  onAddValueChange: (value: string) => void;
  onAdd: () => void;
  onToggleRemove: (value: string) => void;
  onStartRename: (value: string) => void;
  onCancelRename: () => void;
  onRenameInputChange: (value: string) => void;
  onConfirmRename: () => void;
}

const LABEL_KEY: Record<ListName, string> = {
  shifts: 'organisation.shiftsLabel',
  versions: 'organisation.versionsLabel',
  groups: 'organisation.groupsLabel',
};

function VocabularyList({
  list,
  state,
  onAddValueChange,
  onAdd,
  onToggleRemove,
  onStartRename,
  onCancelRename,
  onRenameInputChange,
  onConfirmRename,
}: VocabularyListProps) {
  const { t } = useTranslation('settings');

  const iconButton = (
    label: string,
    value: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${label}: ${value}`}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <fieldset className="min-w-0" data-testid={`organisation-${list}`}>
      <legend className="text-h3">{t(LABEL_KEY[list])}</legend>

      {state.entries.length === 0 && (
        <p className="mt-2 text-text-secondary">{t('organisation.emptyList')}</p>
      )}

      <ul className="mt-2 divide-y divide-border-subtle border-y border-border-subtle">
        {state.entries.map((entry) => (
          <li key={entry.value}>
            {state.renamingValue === entry.value ? (
              <div className="flex items-center gap-2 py-1.5">
                <Input
                  aria-label={t('organisation.renamePlaceholder')}
                  className="min-w-0 flex-1"
                  value={state.renameInput}
                  onChange={(event) => onRenameInputChange(event.target.value)}
                  placeholder={t('organisation.renamePlaceholder')}
                />
                <Button type="button" variant="outline" size="sm" onClick={onConfirmRename}>
                  {t('organisation.renameConfirm')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onCancelRename}>
                  {t('organisation.renameCancel')}
                </Button>
              </div>
            ) : (
              <div className="flex h-11 items-center justify-between gap-2 md:h-9">
                <span
                  className={
                    entry.markedForRemoval
                      ? 'truncate text-text-secondary line-through'
                      : 'truncate'
                  }
                >
                  {entry.value}
                </span>
                <span className="flex shrink-0 items-center">
                  {iconButton(
                    t('organisation.renameAction'),
                    entry.value,
                    <PencilIcon aria-hidden="true" className="text-primary" />,
                    () => onStartRename(entry.value),
                    // [CodeRabbit, PR #916] Only one rename per list per
                    // save: disabled on every other row while one is
                    // pending, so the limit is visible, not a silent no-op.
                    // The pending rename's own row stays enabled, so a
                    // chained rename (Morning -> Prabhati -> Shokal) works.
                    state.rename !== null && state.rename.to !== entry.value,
                  )}
                  {entry.markedForRemoval
                    ? iconButton(
                        t('organisation.undoRemoveAction'),
                        entry.value,
                        <Undo2Icon aria-hidden="true" />,
                        () => onToggleRemove(entry.value),
                      )
                    : iconButton(
                        t('organisation.removeAction'),
                        entry.value,
                        <CircleMinusIcon aria-hidden="true" className="text-destructive" />,
                        () => onToggleRemove(entry.value),
                      )}
                </span>
              </div>
            )}
            {state.rowError?.value === entry.value && (
              <p role="alert" className="pb-1.5 text-destructive">
                {t('organisation.removeInUse', { value: entry.value })}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <Input
          aria-label={`${t(LABEL_KEY[list])}: ${t('organisation.addPlaceholder')}`}
          className="min-w-0 flex-1"
          value={state.addValue}
          onChange={(event) => onAddValueChange(event.target.value)}
          placeholder={t('organisation.addPlaceholder')}
        />
        <Button type="button" variant="outline" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {t('organisation.addAction')}
        </Button>
      </div>
    </fieldset>
  );
}
