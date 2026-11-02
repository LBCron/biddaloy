/**
 * [8.15.41] The designer's state, as plain data, and the three jobs done with it:
 *
 * ```
 *  trays (show / split / count) + "only those who…" + layout choice + colour rules      = DesignerDraft
 *        │ buildDefinition()                          ▲ draftFromDefinition() / draftFromPlan()
 *        ▼                                            │
 *  ReportDefinitionJson ── usePreviewResult() ──► POST /reports/run (inline, 50 rows, debounced 400 ms)
 *        │ saved by the screen                       │ failure: placeError() puts the words beside the control
 * ```
 *
 * No words live here (the screen reads them from `reportDesigner.json`) and nothing calls the
 * network except the preview hook. A trays pick is the registry's own key, so a field the registry
 * does not know is dropped on the way in (`draftFromPlan`), never sent.
 */
import {
  REPORT_DEFINITION_SCHEMA_VERSION,
  type ReportDefinitionJson,
  type ReportFilter,
  type ReportFormatRule,
  type ReportLayoutType,
  type ReportParameter,
} from '@biddaloy/shared';
import {
  EMPTY_PICKS,
  buildLayout,
  fieldsFromMeta,
  suggestLayout,
  type DesignerField,
  type FieldPickerValue,
  type LayoutSuggestion,
} from '@biddaloy/ui/components';
import { usePreviewReport, type ReportMeta, type ReportRunResponse } from '@biddaloy/ui/hooks';
import * as React from 'react';

import type { StarterPlan } from './question-starters';

/** How long the screen waits after the last click before it asks for a new preview. */
export const PREVIEW_DELAY_MS = 400;
/** The preview shows this many rows: enough to judge the layout, quick to come back. */
export const PREVIEW_ROWS = 50;

type Bucket = 'day' | 'week' | 'month' | 'year';
type DefinitionExtras = Pick<ReportDefinitionJson, 'drill' | 'calculated' | 'page'>;

export interface DesignerDraft {
  /** The subject (`STUDENTS`, `FEES`…): what the fields and counts below come from. */
  area: string;
  picks: FieldPickerValue;
  filters: ReportFilter[];
  parameters: ReportParameter[];
  /** `null`: follow the suggestion. */
  layout: ReportLayoutType | null;
  format: ReportFormatRule[];
  /** How a date split is grouped. */
  bucket: Bucket;
  /** What a loaded report carries that the designer does not edit (links to other reports, page setup). */
  extras: DefinitionExtras | null;
}

export const BLANK_DRAFT: DesignerDraft = {
  area: 'STUDENTS',
  picks: EMPTY_PICKS,
  filters: [],
  parameters: [],
  layout: null,
  format: [],
  bucket: 'month',
  extras: null,
};

/** The fields and counts of one subject, and the way each count adds up, from `GET /reports/meta`. */
export interface AreaInfo {
  key: string;
  fields: DesignerField[];
  /** A count's engine function (`SUM`, `COUNT_DISTINCT`…), by key. */
  fns: ReadonlyMap<string, string>;
}

export function areaInfo(meta: ReportMeta | undefined, areaKey: string): AreaInfo {
  const area = meta?.areas.find((a) => a.key === areaKey);
  return {
    key: areaKey,
    fields: area ? fieldsFromMeta(area) : [],
    fns: new Map((area?.measures ?? []).map((m) => [m.key, m.fn])),
  };
}

const isDate = (info: AreaInfo, key: string) =>
  info.fields.find((f) => f.key === key)?.type === 'DATE';

/** The suggestion for what is picked (`suggestLayout` of the building blocks). */
export function suggestionFor(draft: DesignerDraft, info: AreaInfo): LayoutSuggestion {
  return suggestLayout({
    splitBy: draft.picks.split.map((key) => ({ key, isDate: isDate(info, key) })),
    counts: draft.picks.count,
  });
}

export function layoutOf(draft: DesignerDraft, info: AreaInfo): ReportLayoutType {
  return draft.layout ?? suggestionFor(draft, info).layout;
}

/** A table of counts lists classes in school order (Six before Ten) by also splitting on `class_order`. */
function needsClassOrder(draft: DesignerDraft, info: AreaInfo): boolean {
  return (
    layoutOf(draft, info) === 'CROSSTAB' &&
    draft.picks.split.includes('class') &&
    info.fields.some((f) => f.key === 'class_order')
  );
}

/** The report's dimensions, in the order `dataset.dimensions` has them; error paths index into this. */
export function dimensionKeys(draft: DesignerDraft, info: AreaInfo): string[] {
  const keys = [
    ...draft.picks.split,
    ...draft.picks.show.filter((key) => !draft.picks.split.includes(key)),
  ];
  return needsClassOrder(draft, info) && !keys.includes('class_order')
    ? ['class_order', ...keys]
    : keys;
}

/** The definition for the draft, or `null` while nothing is picked (there is nothing to preview). */
export function buildDefinition(draft: DesignerDraft, info: AreaInfo): ReportDefinitionJson | null {
  const dims = dimensionKeys(draft, info);
  if (dims.length === 0 && draft.picks.count.length === 0) return null;
  const picks = {
    splitBy: draft.picks.split.map((key) => ({ key, isDate: isDate(info, key) })),
    counts: draft.picks.count,
  };
  return {
    schema: REPORT_DEFINITION_SCHEMA_VERSION,
    subjectArea: draft.area as ReportDefinitionJson['subjectArea'],
    parameters: draft.parameters,
    dataset: {
      dimensions: dims.map((field) => ({
        field,
        ...(isDate(info, field) ? { bucket: draft.bucket } : {}),
      })),
      measures: draft.picks.count.map((field) => ({
        field,
        fn: (info.fns.get(field) ??
          'SUM') as ReportDefinitionJson['dataset']['measures'][number]['fn'],
      })),
      filters: draft.filters,
      sort: needsClassOrder(draft, info) ? [{ field: 'class_order', dir: 'asc' }] : [],
    },
    layout: buildLayout(layoutOf(draft, info), picks),
    page: draft.extras?.page ?? { title_en: '', title_bn: '', orientation: 'portrait' },
    drill: draft.extras?.drill ?? [],
    calculated: draft.extras?.calculated ?? [],
    format: draft.format,
  };
}

/** What a saved report looks like in the designer. A layout that is not the suggestion becomes the person's own choice. */
export function draftFromDefinition(def: ReportDefinitionJson, info: AreaInfo): DesignerDraft {
  const layout = def.layout;
  const dims = def.dataset.dimensions.map((d) => d.field);
  const split =
    layout.type === 'GROUPED'
      ? (layout.group_by ?? [])
      : layout.type === 'CROSSTAB'
        ? [...(layout.rows ?? []), ...(layout.columns ?? [])]
        : layout.type === 'CHART' && layout.chart
          ? [layout.chart.x]
          : [];
  const draft: DesignerDraft = {
    area: def.subjectArea,
    picks: {
      split: split.filter((key) => dims.includes(key)),
      // `class_order` is the designer's own helper for a table of counts: it is put back when saving.
      show: dims.filter((key) => !split.includes(key) && key !== 'class_order'),
      count: def.dataset.measures.map((m) => m.field),
    },
    filters: def.dataset.filters,
    parameters: def.parameters,
    layout: null,
    format: def.format,
    bucket: def.dataset.dimensions.find((d) => d.bucket)?.bucket ?? 'month',
    extras: { drill: def.drill, calculated: def.calculated, page: def.page },
  };
  return suggestionFor(draft, info).layout === layout.type
    ? draft
    : { ...draft, layout: layout.type };
}

/** What a question starter picks, keeping only what this school's registry offers. */
export function draftFromPlan(plan: StarterPlan, info: AreaInfo): DesignerDraft {
  const known = new Set(info.fields.map((f) => f.key));
  const keep = (keys: string[]) => keys.filter((key) => known.has(key));
  return {
    ...BLANK_DRAFT,
    area: plan.area,
    picks: {
      show: keep(plan.picks.show),
      split: keep(plan.picks.split),
      count: keep(plan.picks.count),
    },
    filters: plan.filters.filter((f) => known.has(f.field)),
    layout: plan.layout ?? null,
    bucket: plan.bucket ?? 'month',
  };
}

/** Moves one pick up or down inside its tray; the screen's Alt+↑ / Alt+↓. */
export function movePick(
  picks: FieldPickerValue,
  tray: keyof FieldPickerValue,
  key: string,
  by: -1 | 1,
): FieldPickerValue {
  const list = [...picks[tray]];
  const from = list.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= list.length) return picks;
  [list[from], list[to]] = [list[to]!, list[from]!];
  return { ...picks, [tray]: list };
}

/** Has the draft changed since it was opened or last saved? */
export function useDraftState(initial: DesignerDraft) {
  const [draft, setDraft] = React.useState(initial);
  const [saved, setSaved] = React.useState(() => JSON.stringify(initial));
  const dirty = JSON.stringify(draft) !== saved;
  const markSaved = React.useCallback(
    (value: DesignerDraft) => setSaved(JSON.stringify(value)),
    [],
  );
  return { draft, setDraft, dirty, markSaved };
}

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

/** The answers a preview runs with: each question's starting answer, and this year for a year question. */
export function previewParams(
  parameters: readonly ReportParameter[],
  currentYear: string | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const p of parameters) {
    if (p.default !== undefined && p.default !== null) params[p.key] = p.default;
    else if (p.type === 'ACADEMIC_YEAR' && currentYear) params[p.key] = currentYear;
  }
  return params;
}

export interface PreviewState {
  /** The last result that came back: kept on screen while the next one loads. */
  result: ReportRunResponse | null;
  error: unknown;
  /** A request is waiting for the delay or for the server. */
  pending: boolean;
}

/**
 * The live preview: waits `PREVIEW_DELAY_MS` after the last change, asks for `PREVIEW_ROWS` rows, and
 * keeps the previous result in `result` until a newer one arrives. A reply that is no longer the
 * latest question's is ignored, so a slow answer never overwrites a newer one.
 */
export function usePreviewResult(
  definition: ReportDefinitionJson | null,
  params: Record<string, unknown>,
  delay: number = PREVIEW_DELAY_MS,
): PreviewState {
  const { mutateAsync } = usePreviewReport();
  const run = React.useRef(mutateAsync);
  run.current = mutateAsync;
  const [state, setState] = React.useState<PreviewState>({
    result: null,
    error: null,
    pending: false,
  });
  const latest = React.useRef(0);
  const key = JSON.stringify([definition, params]);

  React.useEffect(() => {
    const mine = ++latest.current;
    if (!definition) {
      setState({ result: null, error: null, pending: false });
      return;
    }
    setState((previous) => ({ ...previous, pending: true }));
    const timer = setTimeout(() => {
      run
        .current({
          definition: { ...definition, dataset: { ...definition.dataset, limit: PREVIEW_ROWS } },
          params,
        })
        .then(
          (result) => {
            if (mine === latest.current) setState({ result, error: null, pending: false });
          },
          (error: unknown) => {
            if (mine === latest.current) setState((p) => ({ ...p, error, pending: false }));
          },
        );
    }, delay);
    return () => {
      clearTimeout(timer);
      // A newer change (or leaving the screen) makes this question's answer stale.
      latest.current += 1;
    };
    // `key` is the value of `definition` and `params`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, delay]);

  return state;
}

// ---------------------------------------------------------------------------
// Errors in plain words, beside the control that caused them
// ---------------------------------------------------------------------------

export type ErrorZone = 'picks' | 'filter' | 'layout' | 'general';

export interface PlacedError {
  zone: ErrorZone;
  /** The server's code (`NOT_GROUPABLE`…). The screen turns it into a sentence; it is never shown. */
  code: string;
  /** The field the error is about, when the path names one. */
  fieldKey?: string;
  /** Which condition, for `zone: 'filter'`. */
  index?: number;
}

/** What the server sent for a refused definition: `details.code` and `details.path` (`compiler.errors.ts`). */
export function placeError(
  error: unknown,
  draft: DesignerDraft,
  info: AreaInfo,
): PlacedError | null {
  const details = (error as { details?: { code?: unknown; path?: unknown } } | null)?.details;
  if (typeof details?.code !== 'string') return null;
  const code = details.code;
  const path = typeof details.path === 'string' ? details.path : '';
  const at = /\[(\d+)\]/.exec(path)?.[1];
  const index = at === undefined ? undefined : Number(at);

  if (path.startsWith('dataset.dimensions') && index !== undefined) {
    return { zone: 'picks', code, ...withKey(dimensionKeys(draft, info)[index]) };
  }
  if (path.startsWith('dataset.measures') && index !== undefined) {
    return { zone: 'picks', code, ...withKey(draft.picks.count[index]) };
  }
  if (path.startsWith('dataset.filters') && index !== undefined)
    return { zone: 'filter', code, index };
  if (path.startsWith('parameters')) return { zone: 'filter', code };
  if (path.startsWith('layout')) return { zone: 'layout', code };
  if (code === 'NOTHING_TO_SHOW') return { zone: 'picks', code };
  return { zone: 'general', code };
}

const withKey = (fieldKey: string | undefined) => (fieldKey === undefined ? {} : { fieldKey });
