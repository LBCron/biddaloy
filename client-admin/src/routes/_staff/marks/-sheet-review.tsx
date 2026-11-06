/**
 * [81.3.2] What the teacher reads after dropping a filled sheet: a one-line summary, the
 * marks that will change (old → new), and, when the sheet has problems, the error table.
 * Nothing is saved until the host's Save button runs the commit.
 */
import { Card, DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import type {
  BulkImportError,
  MarksSheetChange,
  MarksSheetPreviewSummary,
  PreviewResult,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

const PAGE_SIZE = 10;

/**
 * The server sends a code, never prose; the screen turns it into a sentence. The error table
 * itself is drawn by `BulkUploadPreview` from `result.errors`, so the page translates them on
 * the way in and this review only owns the summary and the change table.
 */
export function translateSheetErrors(
  errors: BulkImportError[],
  t: (key: string) => string,
): BulkImportError[] {
  return errors.map((e) => ({
    row: e.row,
    column: e.column,
    severity: e.severity,
    message: t(`errors.${e.code ?? ''}`),
  }));
}

export function SheetReview({ result }: { result: PreviewResult<MarksSheetPreviewSummary> }) {
  const { t } = useTranslation('marksImport');
  const { t: te } = useTranslation('exams');
  const { numerals } = useRegionConfig();
  const { summary, changes } = result.summary;
  const [page, setPage] = React.useState(1);

  const empty = t('change.empty');
  // A mark with no number is "absent" or "exempt": say so instead of "empty".
  const show = (value: string | null, status: string | null): string =>
    status === 'ABSENT'
      ? te('marksGrid.absentShort')
      : status === 'EXEMPT'
        ? te('marksGrid.exemptShort')
        : value === null
          ? empty
          : renderDigits(value, numerals);

  const columns: DataTableColumn<MarksSheetChange>[] = [
    {
      id: 'student',
      header: te('marksGrid.columnStudent'),
      accessorFn: (c) => `${renderDigits(String(c.roll), numerals)} · ${c.student_name}`,
    },
    {
      id: 'change',
      header: t('summary.title'),
      accessorFn: (c) =>
        `${c.component_name}: ${t('change.oldToNew', {
          old: show(c.old, c.old_status),
          new: show(c.new, c.new_status),
        })}`,
    },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="sheet-review">
      <Card padded role="region" aria-labelledby="sheet-review-heading">
        <h2 id="sheet-review-heading" className="text-h2">
          {t('summary.title')}
        </h2>
        <p className="mt-3 flex flex-wrap items-center gap-2" role="status">
          <StatusBadge tone="success" label={t('summary.new', { count: summary.new })} />
          <StatusBadge tone="info" label={t('summary.changed', { count: summary.changed })} />
          <StatusBadge
            tone="neutral"
            label={t('summary.unchanged', { count: summary.unchanged })}
          />
          {summary.absent > 0 && (
            <StatusBadge tone="neutral" label={t('summary.absent', { count: summary.absent })} />
          )}
          {summary.exempt > 0 && (
            <StatusBadge tone="neutral" label={t('summary.exempt', { count: summary.exempt })} />
          )}
          {summary.errors > 0 && (
            <StatusBadge tone="danger" label={t('summary.errors', { count: summary.errors })} />
          )}
        </p>
      </Card>
      {changes.length > 0 && (
        <DataTable
          tableId="marks-sheet-changes"
          caption={t('summary.title')}
          columns={columns}
          data={changes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          getRowId={(c) => `${c.row}-${c.component_id}`}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={changes.length}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
