/**
 * [76.5.05] Step 3: every row of the sheet, errors first, then changed, then
 * new; unchanged rows sit in a collapsed block. Problem sentences come from
 * `attendanceImport:rowError.*`, never the server's text.
 */
import { DataTable, StatusBadge, type StatusTone } from '@biddaloy/ui/components';
import type { AttendanceSheetValidateResult } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

export type PreviewRow = AttendanceSheetValidateResult['rows'][number];

const OUTCOME_TONE: Record<PreviewRow['outcome'], StatusTone> = {
  ERROR: 'danger',
  CHANGED: 'info',
  NEW: 'success',
  UNCHANGED: 'neutral',
};
const ORDER: Record<PreviewRow['outcome'], number> = { ERROR: 0, CHANGED: 1, NEW: 2, UNCHANGED: 3 };

/** Errors, changed, new, unchanged; file order within each group. */
export function sortPreviewRows(rows: PreviewRow[]): PreviewRow[] {
  return [...rows].sort(
    (a, b) => (ORDER[a.outcome] ?? 0) - (ORDER[b.outcome] ?? 0) || a.row - b.row,
  );
}

export function ImportPreviewTable({ rows }: { rows: PreviewRow[] }) {
  const { t } = useTranslation('attendanceImport');
  const regionConfig = useTenantRegionConfig();

  const status = (value: PreviewRow['before']) => (value ? t(`status.${value}`) : t('status.none'));

  const columns = [
    {
      id: 'date',
      header: t('review.columnDate'),
      accessorFn: (r: PreviewRow) => (r.date ? formatDate(r.date, regionConfig) : '—'),
    },
    {
      id: 'class',
      header: t('review.columnClass'),
      accessorFn: (r: PreviewRow) => r.class_name ?? '—',
    },
    {
      id: 'section',
      header: t('review.columnSection'),
      accessorFn: (r: PreviewRow) => r.section_name ?? '—',
    },
    {
      id: 'roll',
      header: t('review.columnRoll'),
      accessorFn: (r: PreviewRow) => (r.roll === null ? '—' : formatNumber(r.roll, regionConfig)),
    },
    {
      id: 'change',
      header: t('review.columnChange'),
      accessorFn: (r: PreviewRow) =>
        r.outcome === 'ERROR' ? '—' : `${status(r.before)} → ${status(r.after)}`,
    },
    {
      id: 'outcome',
      header: t('review.columnOutcome'),
      accessorFn: (r: PreviewRow) => (
        <StatusBadge tone={OUTCOME_TONE[r.outcome]} label={t(`outcome.${r.outcome}`)} />
      ),
    },
    {
      id: 'message',
      header: t('review.columnProblem'),
      accessorFn: (r: PreviewRow) =>
        r.code
          ? t(`rowError.${r.code}`, {
              section: r.section_name ?? '',
              defaultValue: t('upload.failed'),
            })
          : '—',
    },
  ];

  const sorted = sortPreviewRows(rows);
  const active = sorted.filter((r) => r.outcome !== 'UNCHANGED');
  const unchanged = sorted.filter((r) => r.outcome === 'UNCHANGED');

  const table = (id: string, data: PreviewRow[]) => (
    <DataTable<PreviewRow>
      tableId={id}
      caption={t('review.caption')}
      data={data}
      getRowId={(r) => String(r.row)}
      totalCount={data.length}
      paginated={false}
      sorting={null}
      onSortingChange={() => {}}
      columns={columns}
    />
  );

  return (
    <div className="space-y-4">
      {active.length > 0 && table('attendance-import-preview', active)}
      {unchanged.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer md:min-h-8">
            {t('review.summaryUnchanged', { count: unchanged.length })}
          </summary>
          {table('attendance-import-unchanged', unchanged)}
        </details>
      )}
    </div>
  );
}
