/**
 * [76.5.05] Step 2: pick the filled sheet. Cloned from the calendar import
 * dropzone (`FileUpload`, no new primitive); .xlsx/.csv, 5 MB, checked here so
 * a wrong pick fires no request. The page uploads.
 */
import { Card, FileUpload, type FileUploadItem } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'];

export interface ImportDropzoneProps {
  onFileChange: (file: File | undefined) => void;
  disabled?: boolean;
  error?: string | undefined;
}

export function ImportDropzone({ onFileChange, disabled = false, error }: ImportDropzoneProps) {
  const { t } = useTranslation('attendanceImport');
  const [items, setItems] = React.useState<FileUploadItem[]>([]);

  function reject(file: File, message: string) {
    setItems([{ id: crypto.randomUUID(), file, error: message }]);
    onFileChange(undefined);
  }

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      return reject(file, t('upload.fileWrongType'));
    }
    if (file.size > MAX_FILE_BYTES) return reject(file, t('upload.fileTooLarge'));
    setItems([{ id: crypto.randomUUID(), file }]);
    onFileChange(file);
  }

  const displayItems: FileUploadItem[] = error && items[0] ? [{ ...items[0], error }] : items;

  return (
    <Card className="p-4 md:p-5">
      <p className="mb-3 text-text-secondary">{t('upload.dropzone')}</p>
      <FileUpload
        items={displayItems}
        onFilesSelected={handleFilesSelected}
        onRemove={() => {
          setItems([]);
          onFileChange(undefined);
        }}
        accept=".xlsx,.csv"
        multiple={false}
        aria-label={t('upload.chooseFile')}
        chooseLabel={t('upload.chooseFile')}
        disabled={disabled}
      />
    </Card>
  );
}
