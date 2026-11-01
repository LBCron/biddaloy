/**
 * Controlled audience picker (Epic 53, D7/D16): tabs, a filtered page of matching people, and the
 * chosen list. It never fetches and knows nothing about notices — the parent owns every query and
 * the server's "add matching" call. Selection (across match pages) is the one thing kept here.
 */
import type { RowData } from '@tanstack/react-table';
import * as React from 'react';

import { useTranslation } from '../../i18n';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../primitives/tabs';
import { PAGE_SIZE_OPTIONS } from '../../utils/page-size';
import { Button } from '../button';
import { DataTable, type DataTableColumn } from '../data-table';
import { ErrorState } from '../error-state';
import { FilterSheet } from '../filter-sheet';

import { ChosenList } from './chosen-list';

export interface AudienceBuilderTab {
  key: string;
  label: string;
  filters: React.ReactNode;
}

export interface AudienceBuilderProps<TRow extends RowData> {
  tabs: readonly AudienceBuilderTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Clears the active tab's filters (the phone filter sheet's "clear all"). */
  onClearFilters?: () => void;
  matches: {
    rows: readonly TRow[];
    total: number;
    page: number;
    pageSize: number;
    loading?: boolean;
    error?: string | undefined;
  };
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onRetry: () => void;
  rowKey: (row: TRow) => string;
  columns: DataTableColumn<TRow>[];
  onAddSelected: (rows: TRow[]) => void;
  /** The parent calls the server's "add matching" (D16); nothing is enumerated here. */
  onAddAll: () => void;
  chosen: { rows: readonly TRow[]; total: number; page: number; pageSize?: number };
  onChosenPage: (page: number) => void;
  onRemove: (rows: TRow[]) => void;
  max?: number;
  /** Force the layout; default follows the viewport (phone below 768px). */
  layout?: 'auto' | 'phone' | 'desktop';
}

const PHONE_QUERY = '(max-width: 767px)';

function useIsPhone(layout: 'auto' | 'phone' | 'desktop') {
  const [phone, setPhone] = React.useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return layout === 'auto' ? phone : layout === 'phone';
}

export function AudienceBuilder<TRow extends RowData>({
  tabs,
  activeTab,
  onTabChange,
  onClearFilters,
  matches,
  onPageChange,
  onPageSizeChange,
  onRetry,
  rowKey,
  columns,
  onAddSelected,
  onAddAll,
  chosen,
  onChosenPage,
  onRemove,
  max,
  layout = 'auto',
}: AudienceBuilderProps<TRow>) {
  const { t } = useTranslation('common');
  const phone = useIsPhone(layout);
  const [selected, setSelected] = React.useState<ReadonlyMap<string, TRow>>(new Map());
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [showChosen, setShowChosen] = React.useState(false);
  const focusRef = React.useRef<HTMLDivElement>(null);
  const tab = tabs.find((x) => x.key === activeTab);

  const onSelectedIdsChange = (ids: ReadonlySet<string>) =>
    setSelected((prev) => {
      const next = new Map<string, TRow>();
      for (const id of ids) {
        const row = prev.get(id) ?? matches.rows.find((r) => rowKey(r) === id);
        if (row !== undefined) next.set(id, row);
      }
      return next;
    });

  const afterAdd = () => {
    setSelected(new Map());
    focusRef.current?.focus();
  };
  const full = max !== undefined && chosen.total >= max;

  const chosenList = (
    <ChosenList<TRow>
      rows={chosen.rows}
      total={chosen.total}
      page={chosen.page}
      pageSize={chosen.pageSize ?? 25}
      rowKey={rowKey}
      columns={columns}
      onPageChange={onChosenPage}
      onRemove={onRemove}
      max={max}
      phone={phone}
    />
  );

  const matchesPane = (
    <div ref={focusRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={selected.size === 0 || full}
          onClick={() => {
            onAddSelected([...selected.values()]);
            afterAdd();
          }}
        >
          {t('audienceBuilder.addSelected', { defaultValue: 'Add to chosen list' })}
          {selected.size > 0 && ` (${selected.size})`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={matches.total === 0 || matches.loading || full}
          onClick={() => {
            onAddAll();
            afterAdd();
          }}
        >
          {t('audienceBuilder.addAll', { defaultValue: 'Select all' })}
        </Button>
        {max !== undefined && (
          <span className="text-text-secondary">
            {t('audienceBuilder.max', { defaultValue: 'Maximum {{max}}', max })}
          </span>
        )}
      </div>
      {matches.error ? (
        <ErrorState
          message={matches.error}
          onRetry={onRetry}
          retryLabel={t('actions.retry', { defaultValue: 'Retry' })}
        />
      ) : (
        <DataTable<TRow>
          tableId="audience-builder-matches"
          caption={t('audienceBuilder.matchesTitle', { defaultValue: 'Matching people' })}
          columns={columns}
          data={[...matches.rows]}
          getRowId={rowKey}
          sorting={null}
          onSortingChange={() => {}}
          page={matches.page}
          pageSize={matches.pageSize}
          totalCount={matches.total}
          onPageChange={onPageChange}
          {...(onPageSizeChange ? { onPageSizeChange, pageSizeOptions: PAGE_SIZE_OPTIONS } : {})}
          selectedIds={new Set(selected.keys())}
          onSelectedIdsChange={onSelectedIdsChange}
          loading={matches.loading ?? false}
          layout={phone ? 'cards' : 'table'}
          emptyState={{
            kind: 'no-results',
            title: t('audienceBuilder.emptyTitle', { defaultValue: 'No one matches this filter' }),
            explanation: t('audienceBuilder.emptyExplanation', {
              defaultValue: 'Change the filter to see people.',
            }),
          }}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList variant="line">
          {tabs.map((x) => (
            <TabsTrigger key={x.key} value={x.key}>
              {x.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={activeTab} className="mt-4 flex flex-col gap-4">
          {phone ? (
            <>
              <Button type="button" variant="outline" onClick={() => setSheetOpen(true)}>
                {t('audienceBuilder.filters', { defaultValue: 'Filters' })}
              </Button>
              <FilterSheet
                open={sheetOpen}
                onOpenChange={setSheetOpen}
                {...(matches.loading ? {} : { resultCount: matches.total })}
                onClearAll={() => onClearFilters?.()}
              >
                {tab?.filters}
              </FilterSheet>
              {showChosen ? chosenList : matchesPane}
              <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface p-3">
                <Button
                  type="button"
                  className="w-full"
                  aria-pressed={showChosen}
                  onClick={() => setShowChosen((v) => !v)}
                >
                  {showChosen
                    ? t('audienceBuilder.backToMatches', { defaultValue: 'Back to the list' })
                    : t('audienceBuilder.chosenBar', {
                        defaultValue: 'Chosen ({{count}})',
                        count: chosen.total,
                      })}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">{tab?.filters}</div>
              {matchesPane}
              {chosenList}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
