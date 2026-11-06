/**
 * [76.5.06] The rows of one saved upload: before → after, outcome, and a
 * "changed later" badge when the record's current mark differs from what the
 * upload set (opens that record's own history). The row DTO carries section id,
 * roll and date only — no class or student name — so the register link is the
 * way to see who the row is.
 */
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { AttendanceImportDetail } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

import { RecordHistoryPanel } from '../-record-history-panel';

export type ImportRow = AttendanceImportDetail['rows'][number];
type Filter = 'all' | 'changed' | 'errors';

export interface ImportRowsTableProps {
  rows: readonly ImportRow[];
}

const FILTERS: Filter[] = ['all', 'changed', 'errors'];
const FILTER_KEY = {
  all: 'detail.filterAll',
  changed: 'detail.filterChanged',
  errors: 'detail.filterErrors',
} as const;
const OUTCOME_TONE = {
  NEW: 'success',
  CHANGED: 'info',
  UNCHANGED: 'neutral',
  ERROR: 'danger',
} as const;

export function ImportRowsTable({ rows }: ImportRowsTableProps) {
  const { t } = useTranslation('attendanceImport');
  const regionConfig = useTenantRegionConfig();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [historyRecordId, setHistoryRecordId] = React.useState<string | null>(null);

  const shown = rows.filter((row) =>
    filter === 'changed'
      ? row.outcome === 'CHANGED'
      : filter === 'errors'
        ? row.outcome === 'ERROR'
        : true,
  );
  const status = (value: ImportRow['after']) => t(value ? `status.${value}` : 'status.none');

  const columns: DataTableColumn<ImportRow>[] = [
    {
      id: 'date',
      header: t('review.columnDate'),
      accessorFn: (row) => formatDate(row.date, regionConfig),
      card: 'title',
    },
    {
      id: 'roll',
      header: t('review.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'change',
      header: t('review.columnChange'),
      accessorFn: (row) =>
        row.outcome === 'ERROR' ? '—' : `${status(row.before)} → ${status(row.after)}`,
    },
    {
      id: 'outcome',
      header: t('review.columnOutcome'),
      accessorFn: (row) => (
        <StatusBadge tone={OUTCOME_TONE[row.outcome]} label={t(`outcome.${row.outcome}`)} />
      ),
      card: 'badge',
    },
    {
      id: 'message',
      header: t('review.columnProblem'),
      accessorFn: (row) =>
        row.code ? t(`rowError.${row.code}`, { section: t('review.columnSection') }) : '—',
    },
    {
      id: 'current',
      header: t('detail.changedLater'),
      accessorFn: (row) => {
        const changedLater =
          row.outcome !== 'ERROR' && row.record_id !== null && row.current !== row.after;
        if (!changedLater) return row.outcome === 'ERROR' ? '—' : status(row.current);
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            title={t('detail.changedLaterHint')}
            onClick={() => setHistoryRecordId(row.record_id)}
          >
            <StatusBadge tone="warning" label={t('detail.changedLater')} />
            <span className="ml-2">{status(row.current)}</span>
          </Button>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t('review.columnOutcome')} className="flex flex-wrap gap-2">
        {FILTERS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? 'default' : 'outline'}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(FILTER_KEY[id])}
          </Button>
        ))}
      </div>
      <DataTable
        tableId="attendance-import-rows"
        caption={t('review.title')}
        columns={columns}
        data={shown}
        getRowId={(row) => `${shown.indexOf(row)}:${row.date}:${row.section_id}:${row.roll}`}
        sorting={null}
        onSortingChange={() => undefined}
        paginated={false}
        totalCount={shown.length}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('detail.openRegister'),
            to: `/attendance/${row.section_id}?date=${row.date}`,
            display: 'text',
          },
        ]}
        emptyState={{ title: t('detail.emptyFilter'), explanation: t('history.emptyExplanation') }}
      />
      <Dialog
        open={historyRecordId !== null}
        onOpenChange={(open) => !open && setHistoryRecordId(null)}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('detail.changedLater')}</DialogTitle>
            <DialogDescription>{t('detail.changedLaterHint')}</DialogDescription>
          </DialogHeader>
          <RecordHistoryPanel recordId={historyRecordId ?? undefined} studentName="" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
