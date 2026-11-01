/**
 * [8.15.41] The designer: one screen, no steps. Controls on the left, the answer on the right, and
 * the answer changes with every click.
 *
 * ```
 *  ┌ controls ───────────────────────┐ ┌ preview (first 50 rows) ───────────────┐
 *  │ বিষয়  [ছাত্রছাত্রী v]             │ │ Class   | Boys | Girls | Total          │
 *  │ দেখাবেন | ভাগ করবেন | গুনবেন       │ │ Class 6 |   40 |    38 |    78          │
 *  │ শুধু যাদের…                       │ │ …                                      │
 *  │ কেমন দেখাবে (suggested)          │ │ (the old result stays until the next   │
 *  │ আরও v  (colour rules)           │ │  one arrives)                          │
 *  └─────────────────────────────────┘ └────────────────────────────────────────┘
 *  Phone: the preview on top; the controls open from a bottom sheet.
 * ```
 *
 * Keyboard: Tab goes tray to tray and field to field, Enter adds the focused field, Alt+↑ / Alt+↓
 * moves a picked field inside its tray, Ctrl+S saves. Leaving with unsaved changes asks first.
 * Failures are said in plain words beside the control that caused them (`placeError`), never as a
 * code. The report's words come from `reportDesigner.json` and the building blocks' own labels
 * (`useDesignerLabels`).
 */
import { UserRole, type ReportDefinitionJson, type ReportLayoutType } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FieldPicker,
  FilterBuilder,
  FilterSheet,
  FormatRulesEditor,
  HelpHint,
  LayoutSwitcher,
  ReportChart,
  ReportCrosstab,
  ReportGrouped,
  ReportTable,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useDesignerLabels,
  useHelp,
  type EnumLabel,
} from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  useActiveRole,
  useCreateReportDefinition,
  usePublishReportDefinition,
  useUpdateReportDefinition,
  type ReportMeta,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { useQuery } from '@tanstack/react-query';
import { useBlocker, useRouter } from '@tanstack/react-router';
import { SaveIcon, SlidersHorizontalIcon } from 'lucide-react';
import * as React from 'react';

import { SaveDialog, VISIBLE_ROLES, type SaveMode, type SaveValues } from './save-dialog';
import {
  areaInfo,
  buildDefinition,
  layoutOf,
  movePick,
  placeError,
  previewParams,
  suggestionFor,
  useDraftState,
  usePreviewResult,
  type DesignerDraft,
  type ErrorZone,
  type PlacedError,
} from './use-designer-state';

/** The draft was saved; only switching it on failed. `inner` is what the server said. */
class PublishFailed extends Error {
  constructor(readonly inner: unknown) {
    super('PUBLISH_FAILED');
  }
}

export interface DesignerScreenProps {
  meta: ReportMeta;
  /** What the screen opens with: a question starter, a blank page, or a report being edited. */
  initial: DesignerDraft;
  /** Set when editing a report that already exists. */
  report?: { id: string; name: string; folder: string | null; roles: readonly string[] };
}

/** True below 768 px: the controls move into a bottom sheet. jsdom has no `matchMedia`, so it is false there. */
function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = React.useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  React.useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const list = matchMedia(query);
    const onChange = () => setPhone(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** A value from a list in the viewer's words; a value nobody wrote words for reads as plain lower case. */
function useEnumLabel(): EnumLabel {
  // The words of the other namespace are named by `ns`; the screen's own are `reportDesigner`.
  const { t } = useTranslation('reportDesigner');
  return React.useCallback<EnumLabel>(
    (field, value) => {
      if (field === 'gender' && ['MALE', 'FEMALE', 'OTHER'].includes(value)) {
        const word = t(`studentCount.gender.${value}`, { ns: 'reports' });
        return { label_en: word, label_bn: word };
      }
      if (field === 'method') {
        const word = t(`filters.method.${value}`, { ns: 'reports', defaultValue: '' });
        if (word) return { label_en: word, label_bn: word };
      }
      const plain = value.toLowerCase().replaceAll('_', ' ');
      const word = plain.charAt(0).toUpperCase() + plain.slice(1);
      return { label_en: word, label_bn: word };
    },
    [t],
  );
}

export function DesignerScreen(props: DesignerScreenProps) {
  // `useRegionConfig()` has no ambient provider above the route tree (see the runner).
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <Designer {...props} />
    </RegionConfigProvider>
  );
}

function Designer({ meta, initial, report }: DesignerScreenProps) {
  const { t } = useTranslation('reportDesigner');
  const { locale } = useLocale();
  const router = useRouter();
  const labels = useDesignerLabels();
  const { resolve } = useHelp();
  const enumLabel = useEnumLabel();
  const role = useActiveRole();
  const phone = useIsPhone();

  const { draft, setDraft, dirty, markSaved } = useDraftState(initial);
  const info = React.useMemo(() => areaInfo(meta, draft.area), [meta, draft.area]);
  const definition = React.useMemo(() => buildDefinition(draft, info), [draft, info]);
  const suggestion = suggestionFor(draft, info);
  const layout = layoutOf(draft, info);

  // The preview asks this year's question for a year question with no starting answer.
  const years = useQuery(academicYearsQueryOptions({ limit: 100 }));
  const currentYear = years.data?.data.find((y) => y.is_current)?.name;
  const params = React.useMemo(
    () => previewParams(draft.parameters, currentYear),
    [draft.parameters, currentYear],
  );
  const preview = usePreviewResult(definition, params);

  // ---- saving -------------------------------------------------------------------------------
  // A refused report is explained until the person changes something; then the sentence goes away.
  React.useEffect(() => setSaveError(null), [draft]);
  const create = useCreateReportDefinition();
  const update = useUpdateReportDefinition();
  const publish = usePublishReportDefinition();
  const [reportId, setReportId] = React.useState(report?.id ?? null);
  // Made once, so a retry after a lost reply is the same report (and the same Idempotency-Key).
  const [reportKey] = React.useState(() => `custom-${crypto.randomUUID().slice(0, 8)}`);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveError, setSaveError] = React.useState<unknown>(null);
  const inFlight = React.useRef(false);
  // Set just before the screen leaves on purpose (a save that moves to the saved report).
  const leaving = React.useRef(false);

  const blocker = useBlocker({
    shouldBlockFn: () => !leaving.current && dirty,
    withResolver: true,
  });

  const names = (key: string) => {
    const field = info.fields.find((f) => f.key === key);
    return field ? (locale === 'bn' ? field.label_bn : field.label_en) : key;
  };
  const defaultName = () => {
    const split = draft.picks.split.map(names);
    const count = draft.picks.count.map(names);
    if (split.length > 0 && count.length > 0) {
      return t('save.defaultName', { split: split.join(', '), count: count.join(', ') });
    }
    return [...count, ...draft.picks.show.map(names)].join(', ');
  };
  const saveInitial: SaveValues = {
    name: report?.name ?? defaultName(),
    folder: report?.folder ?? '',
    // A new report starts with admin and the creator's own role ticked.
    roles: VISIBLE_ROLES.filter((r) =>
      report ? report.roles.includes(r) : r === UserRole.ADMIN || r === role,
    ),
  };

  async function save(mode: SaveMode, values: SaveValues) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaveError(null);
    try {
      const built = buildDefinition(draft, info);
      if (!built) throw new Error('NOTHING_TO_SAVE');
      // A new report gets the one name in both languages. A saved report changes only the name in
      // the language being used, so the other language's name is never overwritten.
      const both = reportId === null;
      const nameFields = both
        ? { name_en: values.name, name_bn: values.name }
        : locale === 'bn'
          ? { name_bn: values.name }
          : { name_en: values.name };
      const body: ReportDefinitionJson = {
        ...built,
        page: {
          ...built.page,
          ...(both || locale !== 'bn' ? { title_en: values.name } : {}),
          ...(both || locale === 'bn' ? { title_bn: values.name } : {}),
          orientation: layout === 'CROSSTAB' ? 'landscape' : 'portrait',
        },
      };
      const fields = {
        ...nameFields,
        ...(values.folder ? { folder: values.folder } : {}),
        visible_roles: values.roles,
        definition: body,
      };
      let id = reportId;
      const created = id === null;
      if (id === null) {
        id = (
          await create.mutateAsync({
            key: reportKey,
            name_en: values.name,
            name_bn: values.name,
            ...fields,
          })
        ).id;
        setReportId(id);
      } else {
        await update.mutateAsync({ id, ...fields });
      }
      if (mode === 'publish') {
        try {
          await publish.mutateAsync(id);
        } catch (error) {
          // The draft is kept; only switching it on failed. Saying so stops a second report being made.
          setSaveError(new PublishFailed(error));
          throw error;
        }
      }
      markSaved(draft);
      setSaveOpen(false);
      const savedId = id;
      toast.success(t(mode === 'publish' ? 'save.published' : 'save.saved'), {
        action: {
          label: t('save.open'),
          onClick: () => router.history.push(`/reports/${savedId}`),
        },
      });
      if (created) {
        // The address now names the saved report, so a reload or a copied link opens it.
        leaving.current = true;
        await router.navigate({
          to: '/reports/$reportId/edit',
          params: { reportId: savedId },
          replace: true,
        });
      }
    } catch (error) {
      setSaveError(error);
      // A refused report is explained beside the control that caused it, not in a box.
      if (placeError(error instanceof PublishFailed ? error.inner : error, draft, info)) {
        setSaveOpen(false);
      }
      throw error;
    } finally {
      inFlight.current = false;
    }
  }

  // Ctrl+S: a saved report saves its draft at once; a new one asks for its name first.
  const saveShortcut = React.useRef<() => void>(() => {});
  saveShortcut.current = () => {
    if (reportId !== null && definition) {
      void save('draft', saveInitial).catch(() => {});
    } else {
      setSaveOpen(true);
    }
  };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveShortcut.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- keyboard: Alt+↑ / Alt+↓ moves a picked field inside its tray ------------------------------
  const controlsRef = React.useRef<HTMLDivElement>(null);
  const refocus = React.useRef<{ tray: string; key: string } | null>(null);
  function onControlsKeyDown(event: React.KeyboardEvent) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-tray][data-field-key]');
    const tray = chip?.dataset.tray as 'show' | 'split' | 'count' | undefined;
    const key = chip?.dataset.fieldKey;
    if (!tray || !key) return;
    event.preventDefault();
    refocus.current = { tray, key };
    setDraft((d) => ({
      ...d,
      picks: movePick(d.picks, tray, key, event.key === 'ArrowUp' ? -1 : 1),
    }));
  }
  React.useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    controlsRef.current
      ?.querySelector<HTMLElement>(
        `[data-tray="${target.tray}"][data-field-key="${target.key}"] button`,
      )
      ?.focus();
  }, [draft.picks]);

  // ---- errors, beside the control -------------------------------------------------------------
  const saveCause = saveError instanceof PublishFailed ? saveError.inner : saveError;
  const placed = placeError(saveCause ?? preview.error, draft, info);
  const generalFailure =
    (saveCause ?? preview.error) !== null && !placed
      ? saveCause instanceof ApiError && saveCause.statusCode === 409
        ? t('errors.keyClash')
        : t('errors.generic')
      : null;
  const errorText = (error: PlacedError): string => {
    const field = error.fieldKey ? names(error.fieldKey) : '';
    switch (error.code) {
      case 'NOT_GROUPABLE':
        return t('errors.NOT_GROUPABLE', { field });
      case 'NOTHING_TO_SHOW':
        return t('errors.NOTHING_TO_SHOW');
      case 'NOT_FILTERABLE':
        return t('errors.NOT_FILTERABLE');
      case 'BAD_OP':
        return t('errors.BAD_OP');
      case 'BAD_VALUE':
        return t('errors.BAD_VALUE');
      case 'MISSING_PARAM':
        return t('errors.MISSING_PARAM');
      case 'UNKNOWN_PARAM':
        return t('errors.UNKNOWN_PARAM');
      case 'NOT_SORTABLE':
        return t('errors.NOT_SORTABLE');
      case 'UNKNOWN_FIELD':
      case 'UNKNOWN_MEASURE':
      case 'UNKNOWN_AREA':
        return t('errors.UNKNOWN_FIELD');
      default:
        return t('errors.generic');
    }
  };
  const zoneError = (zone: ErrorZone, id: string) =>
    placed?.zone === zone && (
      <p id={id} role="alert" className="text-sm text-destructive">
        {errorText(placed)}
      </p>
    );

  // ---- the controls -----------------------------------------------------------------------------
  const moreDetails = (
    <details className="rounded-lg border border-border bg-surface p-3">
      <summary className="min-h-11 cursor-pointer text-h3 text-text-primary md:min-h-8">
        {t('more.title')}
      </summary>
      <div className="pt-3">
        <FormatRulesEditor
          rules={draft.format}
          fields={info.fields}
          onChange={(format) => setDraft((d) => ({ ...d, format }))}
          labels={labels.format}
          enumLabel={enumLabel}
        />
      </div>
    </details>
  );
  const areas = meta.areas.map((a) => a.key);
  const controls = (
    // The keydown only reads Alt+arrows bubbling up from a picked field's own button.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div ref={controlsRef} onKeyDown={onControlsKeyDown} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span id="designer-area-label" className="text-label font-medium text-text-primary">
          {t('area.label')}
        </span>
        <Select
          value={draft.area}
          onValueChange={(area) =>
            // A different subject has different fields: start the trays and conditions again.
            setDraft((d) => ({
              ...d,
              area,
              picks: { show: [], split: [], count: [] },
              filters: [],
              parameters: [],
              format: [],
              layout: null,
            }))
          }
        >
          <SelectTrigger aria-labelledby="designer-area-label" className="w-full md:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {areas.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`area.names.${key}`, { defaultValue: key })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section aria-label={labels.picker.title} className="flex flex-col gap-2">
        <FieldPicker
          fields={info.fields}
          value={draft.picks}
          onChange={(picks) => setDraft((d) => ({ ...d, picks }))}
          labels={labels.picker}
          helpId="reports.hub.section.designTrays"
        />
        <p className="text-caption text-text-secondary">{t('keyboard.hint')}</p>
        {zoneError('picks', 'designer-picks-error')}
      </section>

      <section className="flex flex-col gap-2">
        <FilterBuilder
          fields={info.fields}
          filters={draft.filters}
          parameters={draft.parameters}
          onChange={({ filters, parameters }) => setDraft((d) => ({ ...d, filters, parameters }))}
          labels={labels.filter}
          enumLabel={enumLabel}
          helpId="reports.hub.section.designFilters"
        />
        {zoneError('filter', 'designer-filter-error')}
      </section>

      <section className="flex flex-col gap-2">
        <LayoutSwitcher
          value={layout}
          suggestion={suggestion}
          onChange={(next: ReportLayoutType) =>
            setDraft((d) => ({ ...d, layout: next === suggestion.layout ? null : next }))
          }
          labels={labels.layout}
          helpId="reports.hub.section.designLayout"
        />
        {zoneError('layout', 'designer-layout-error')}
      </section>

      {resolve('reports.hub.section.designMore') ? (
        // The row wrapper exists only when the (?) renders, so a screen without help keeps its DOM.
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">{moreDetails}</div>
          <HelpHint helpId="reports.hub.section.designMore" />
        </div>
      ) : (
        moreDetails
      )}
    </div>
  );

  // ---- the preview ----------------------------------------------------------------------------
  const result = preview.result;
  const preview_ = (
    <section
      aria-label={t('preview.title')}
      aria-busy={preview.pending}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h2">{t('preview.title')}</h2>
        <p role="status" className="text-caption text-text-secondary">
          {preview.pending ? t('preview.updating') : ''}
        </p>
      </div>
      {generalFailure !== null && (
        <p role="alert" className="text-sm text-destructive">
          {generalFailure}
        </p>
      )}
      {definition === null ? (
        <EmptyState title={t('preview.empty.title')} explanation={t('preview.empty.explanation')} />
      ) : result === null ? (
        <p className="text-text-secondary">{preview.pending ? t('preview.updating') : ''}</p>
      ) : (
        // The previous result stays here, a little faded, until the next one arrives.
        <div className={preview.pending ? 'opacity-60 transition-opacity' : undefined}>
          {result.truncated && <p className="mb-2 text-text-secondary">{t('preview.firstRows')}</p>}
          <PreviewView result={result} definition={definition} caption={t('preview.title')} />
        </div>
      )}
    </section>
  );

  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title={report ? t('title.edit') : t('title.new')}
          subtitle={t('subtitle')}
          actions={[
            {
              id: 'save',
              label: t('save.button'),
              icon: <SaveIcon aria-hidden className="size-4" />,
              priority: 'primary',
              disabled: definition === null,
              onClick: () => setSaveOpen(true),
            },
          ]}
        />

        {phone ? (
          <>
            {preview_}
            <div className="sticky bottom-0 -mx-4 border-t border-border-subtle bg-surface p-3">
              <Button type="button" className="h-11 w-full" onClick={() => setSheetOpen(true)}>
                <SlidersHorizontalIcon aria-hidden="true" />
                {t('controls.open')}
              </Button>
            </div>
            <FilterSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              title={t('controls.title')}
              {...(result ? { resultCount: result.rows.length } : {})}
              onClearAll={() =>
                setDraft((d) => ({
                  ...d,
                  picks: { show: [], split: [], count: [] },
                  filters: [],
                  parameters: [],
                  layout: null,
                }))
              }
            >
              {controls}
            </FilterSheet>
          </>
        ) : (
          <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
            {controls}
            <div className="md:sticky md:top-4">{preview_}</div>
          </div>
        )}
      </div>

      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        initial={saveInitial}
        onSubmit={save}
        error={
          saveError !== null && !placed
            ? saveError instanceof PublishFailed
              ? t('save.publishError')
              : saveCause instanceof ApiError && saveCause.statusCode === 409
                ? t('errors.keyClash')
                : t('save.error')
            : null
        }
      />

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title={t('leave.title')}
        description={t('leave.description')}
        cancelLabel={t('leave.stay')}
        confirmLabel={t('leave.leave')}
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
      />
    </PageContainer>
  );
}

/** The renderer the layout asks for, the same four the runner uses. */
function PreviewView({
  result,
  definition,
  caption,
}: {
  result: NonNullable<ReturnType<typeof usePreviewResult>['result']>;
  definition: ReportDefinitionJson;
  caption: string;
}) {
  const layout = definition.layout;
  const format = useFormatting(definition);
  switch (layout.type) {
    case 'GROUPED':
      return <ReportGrouped result={result} layout={layout} caption={caption} />;
    case 'CROSSTAB':
      return (
        <ReportCrosstab
          result={result}
          layout={layout}
          caption={caption}
          {...(format ? { format } : {})}
        />
      );
    case 'CHART':
      return <ReportChart result={result} layout={layout} caption={caption} />;
    default:
      return (
        <ReportTable
          result={result}
          caption={caption}
          tableId="report-designer"
          {...(format ? { format } : {})}
        />
      );
  }
}

/** The colour rules and each colour's word (for a screen reader), or nothing when there are none. */
function useFormatting(definition: ReportDefinitionJson) {
  const labels = useDesignerLabels();
  return definition.format.length > 0
    ? { rules: definition.format, toneLabels: labels.format.tones }
    : undefined;
}
