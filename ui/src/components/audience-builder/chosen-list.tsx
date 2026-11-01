import type { RowData } from '@tanstack/react-table';

import { useTranslation } from '../../i18n';
import { DataTable, type DataTableColumn } from '../data-table';

export interface ChosenListProps<TRow extends RowData> {
  rows: readonly TRow[];
  total: number;
  page: number;
  pageSize: number;
  rowKey: (row: TRow) => string;
  columns: DataTableColumn<TRow>[];
  onPageChange: (page: number) => void;
  onRemove: (rows: TRow[]) => void;
  max?: number | undefined;
  phone?: boolean;
}

/** The people picked so far: its own table, one remove action per row, and the running total. */
export function ChosenList<TRow extends RowData>({
  rows,
  total,
  page,
  pageSize,
  rowKey,
  columns,
  onPageChange,
  onRemove,
  max,
  phone = false,
}: ChosenListProps<TRow>) {
  const { t } = useTranslation('common');
  const removeLabel = t('audienceBuilder.remove', { defaultValue: 'Remove from chosen list' });
  const title = t('audienceBuilder.chosenTitle', { defaultValue: 'Chosen list' });
  return (
    <section aria-label={title}>
      <p className="mb-2 text-text-secondary" aria-live="polite">
        {t('audienceBuilder.chosenTotal', { defaultValue: 'Total {{total}}', total })}
        {max !== undefined &&
          ` · ${t('audienceBuilder.max', { defaultValue: 'Maximum {{max}}', max })}`}
      </p>
      <DataTable<TRow>
        tableId="audience-builder-chosen"
        caption={t('audienceBuilder.chosenCaption', { defaultValue: 'Chosen people' })}
        columns={columns}
        layout={phone ? 'cards' : 'table'}
        data={[...rows]}
        getRowId={rowKey}
        sorting={null}
        onSortingChange={() => {}}
        page={page}
        pageSize={pageSize}
        totalCount={total}
        onPageChange={onPageChange}
        rowActions={(row) => [
          { intent: 'remove', label: removeLabel, onClick: () => onRemove([row]) },
        ]}
        emptyState={{
          title: t('audienceBuilder.chosenEmptyTitle', { defaultValue: 'No one chosen yet' }),
          explanation: t('audienceBuilder.chosenEmptyExplanation', {
            defaultValue: 'Add people from the list.',
          }),
        }}
      />
    </section>
  );
}
