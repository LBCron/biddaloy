import * as React from 'react';

import { type BulkImportError } from '../hooks/use-bulk-upload-preview';
import { useRegionConfig, useTranslation } from '../i18n';
import { downloadCsv, renderDigits } from '../utils';

import { Button } from './button';
import { DataTable, type DataTableColumn } from './data-table';

const PAGE_SIZE = 10;

export interface BulkImportErrorTableProps {
  errors: BulkImportError[];
  /** `DataTable` needs a stable id per table on the page — override when
   * more than one `BulkImportErrorTable` renders at once. */
  tableId?: string;
  csvFileName?: string;
}

/**
 * The per-row error/warning report of any bulk-upload preview — row
 * number, optional tab, column, offending value, plain-language message,
 * severity — with a CSV export so the source file can be fixed offline.
 * Generalised from `client-admin`'s `[8.11.7]` student-import error table
 * (`client-admin/src/routes/_staff/students/-import/error-table.tsx`) to
 * the domain-agnostic `BulkImportError` shape shared by every bulk-upload
 * "validate" endpoint. Data is fully client-side (it arrived in the
 * upload response), so pagination just slices locally.
 */
export function BulkImportErrorTable({
  errors,
  tableId = 'bulk-import-errors',
  csvFileName = 'import-errors.csv',
}: BulkImportErrorTableProps) {
  const { t } = useTranslation('bulkImport');
  const regionConfig = useRegionConfig();
  const [page, setPage] = React.useState(1);

  const showTab = errors.some((error) => error.tab);
  // A server that sends only a code (the marks sheet) has no value to show; an "(empty)"
  // column beside "Above full marks" would mislead.
  const showValue = errors.some((error) => error.value);
  const rowIndex = React.useMemo(
    () => new Map(errors.map((error, index) => [error, index])),
    [errors],
  );

  const columns: DataTableColumn<BulkImportError>[] = [
    {
      id: 'row',
      header: t('errors.columnRow'),
      accessorFn: (error) => renderDigits(String(error.row), regionConfig.numerals),
    },
    ...(showTab
      ? [
          {
            id: 'tab',
            header: t('errors.columnTab'),
            accessorFn: (error: BulkImportError) => error.tab ?? '',
          } satisfies DataTableColumn<BulkImportError>,
        ]
      : []),
    {
      id: 'column',
      header: t('errors.columnColumn'),
      accessorFn: (error) => error.column ?? t('errors.wholeRow'),
    },
    ...(showValue
      ? [
          {
            id: 'value',
            header: t('errors.columnValue'),
            accessorFn: (error: BulkImportError) =>
              error.value ? error.value : t('errors.emptyValue'),
          } satisfies DataTableColumn<BulkImportError>,
        ]
      : []),
    {
      id: 'message',
      header: t('errors.columnMessage'),
      accessorFn: (error) => messageOf(error),
    },
    {
      id: 'severity',
      header: t('errors.columnSeverity'),
      accessorFn: (error) => t(`errors.severity.${error.severity}`),
    },
  ];

  function messageOf(error: BulkImportError): string {
    return error.code
      ? t(`errors.codes.${error.code}`, { defaultValue: error.message })
      : error.message;
  }

  function exportErrorsToCsv() {
    const header = [
      t('errors.columnRow'),
      ...(showTab ? [t('errors.columnTab')] : []),
      t('errors.columnColumn'),
      t('errors.columnValue'),
      t('errors.columnMessage'),
      t('errors.columnSeverity'),
    ];
    downloadCsv(csvFileName, [
      header,
      ...errors.map((error) => [
        error.row,
        ...(showTab ? [error.tab ?? ''] : []),
        error.column ?? '',
        error.value ?? '',
        messageOf(error),
        t(`errors.severity.${error.severity}`),
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('errors.title')}</h2>
        <Button type="button" variant="outline" size="sm" onClick={exportErrorsToCsv}>
          {t('errors.exportCsv')}
        </Button>
      </div>
      <DataTable
        tableId={tableId}
        caption={t('errors.caption')}
        columns={columns}
        data={errors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        // `getRowId` only receives the row, so the global index (needed
        // because two errors can share row+column) is baked into an id
        // map keyed by object identity rather than derived positionally.
        getRowId={(error) =>
          `${error.row}-${error.tab ?? ''}-${error.column ?? 'row'}-${rowIndex.get(error)}`
        }
        sorting={null}
        onSortingChange={() => {}}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={errors.length}
        onPageChange={setPage}
      />
    </div>
  );
}
