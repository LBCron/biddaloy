import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type BulkImportError } from '../hooks/use-bulk-upload-preview';
import { renderWithProviders } from '../test/render-with-providers';

import { BulkImportErrorTable } from './bulk-import-error-table';

function error(overrides: Partial<BulkImportError> = {}): BulkImportError {
  return {
    row: 2,
    column: 'name',
    message: 'Name is required',
    severity: 'error',
    ...overrides,
  };
}

async function renderTable(
  errors: BulkImportError[],
  props: { tableId?: string; csvFileName?: string } = {},
) {
  const result = renderWithProviders(<BulkImportErrorTable errors={errors} {...props} />, {
    locale: 'en',
  });
  await result.localeReady;
  return result;
}

describe('BulkImportErrorTable', () => {
  it('renders a row per error with column/value/message/severity', async () => {
    await renderTable([error({ value: 'John', message: 'Name is required', severity: 'error' })]);

    // First render in the file — the `bulkImport` i18n namespace loads
    // lazily behind `I18nProvider`'s Suspense boundary, so the initial
    // paint can still be the fallback. `findByText` waits it out; every
    // later assertion in this file hits an already-loaded namespace.
    expect(await screen.findByText('Rows with problems')).toBeTruthy();
    expect(screen.getByText('name')).toBeTruthy();
    expect(screen.getByText('John')).toBeTruthy();
    expect(screen.getByText('Name is required')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('shows the translated sentence for a code, and the message when there is none', async () => {
    await renderTable([
      error({ code: 'SUBJECT_NOT_FOUND', message: 'English server text', value: 'Maths' }),
      error({ row: 3, message: 'Plain message' }),
    ]);

    expect(screen.getByText('No subject with this name.')).toBeTruthy();
    expect(screen.queryByText('English server text')).toBeNull();
    expect(screen.getByText('Plain message')).toBeTruthy();
  });

  it('falls back to "Whole row" and "(empty)" when column/value are missing', async () => {
    // Another row carries a value, so the Value column is shown and this row falls back.
    await renderTable([error({ column: null }), error({ row: 3, value: 'John' })]);

    expect(screen.getByText('Whole row')).toBeTruthy();
    expect(screen.getByText('(empty)')).toBeTruthy();
  });

  it('treats an empty-string value the same as a missing one', async () => {
    await renderTable([error({ value: '' }), error({ row: 3, value: 'John' })]);

    expect(screen.getByText('(empty)')).toBeTruthy();
  });

  it('hides the Value column when no error carries a value (code-only servers)', async () => {
    await renderTable([error({ code: 'ABOVE_FULL_MARKS' })]);

    expect(await screen.findByText('Rows with problems')).toBeTruthy();
    expect(screen.queryByText('Value in your file')).toBeNull();
    expect(screen.queryByText('(empty)')).toBeNull();
  });

  it('only shows the tab column when at least one error has a tab', async () => {
    const { rerender } = await renderTable([error()]);
    expect(screen.queryByText('Sheet')).not.toBeTruthy();

    rerender(<BulkImportErrorTable errors={[error({ tab: 'Students' })]} />);
    expect(screen.getByText('Sheet')).toBeTruthy();
    expect(screen.getByText('Students')).toBeTruthy();
  });

  it('paginates beyond the first 10 errors', async () => {
    const errors = Array.from({ length: 11 }, (_, index) =>
      error({ row: index + 1, message: `Error ${index}` }),
    );
    await renderTable(errors);

    expect(screen.getByText('Error 0')).toBeTruthy();
    expect(screen.queryByText('Error 10')).not.toBeTruthy();
  });

  it('exports errors as a downloaded CSV when clicking export', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      const { user } = await renderTable([error({ value: 'John' })], { csvFileName: 'errors.csv' });

      await user.click(screen.getByRole('button', { name: 'Download problem rows (CSV)' }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      clickSpy.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });
});
