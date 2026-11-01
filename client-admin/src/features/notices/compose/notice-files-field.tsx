/**
 * [53.3.g2.01] Drop-or-pick files for a notice: at most 3, shown with type and size, removable.
 * Clone of `applications/-new/attachments-step.tsx`. New files wait in memory until the draft is
 * saved; files already uploaded are listed under them. The error sits under the field.
 */
import { NOTICE_LIMITS } from '@biddaloy/shared';
import { Button, FileUpload } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { XIcon } from 'lucide-react';
import * as React from 'react';

import type { NoticeFileDto } from './use-compose';

const MB = NOTICE_LIMITS.fileBytesMax / (1024 * 1024);
const HEIC = /\.hei[cf]$/i;

export interface NoticeFilesFieldProps {
  pending: File[];
  saved: NoticeFileDto[];
  onPendingChange: (files: File[]) => void;
  onRemoveSaved: (file: NoticeFileDto) => void;
  disabled?: boolean;
}

export function NoticeFilesField({
  pending,
  saved,
  onPendingChange,
  onRemoveSaved,
  disabled = false,
}: NoticeFilesFieldProps) {
  const { t } = useTranslation('noticeCompose');
  const [problems, setProblems] = React.useState<string[]>([]);
  const ids = React.useRef(new WeakMap<File, string>());
  const idOf = (file: File) => {
    let id = ids.current.get(file);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(file, id);
    }
    return id;
  };

  function add(picked: File[]) {
    const next = [...pending];
    const found: string[] = [];
    for (const file of picked) {
      if (HEIC.test(file.name) || /^image\/hei[cf]$/.test(file.type)) {
        found.push(t('files.heic', { name: file.name }));
      } else if (!(NOTICE_LIMITS.mimeTypes as readonly string[]).includes(file.type)) {
        found.push(t('files.wrongType', { name: file.name }));
      } else if (file.size > NOTICE_LIMITS.fileBytesMax) {
        found.push(t('files.tooLarge', { size: MB, name: file.name }));
      } else if (saved.length + next.length >= NOTICE_LIMITS.filesMax) {
        found.push(t('files.tooMany', { count: NOTICE_LIMITS.filesMax }));
        break;
      } else {
        next.push(file);
      }
    }
    setProblems(found);
    onPendingChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-secondary">
        {t('files.hint', { count: NOTICE_LIMITS.filesMax, size: MB })}
      </p>
      {saved.length > 0 && (
        <ul className="flex flex-col gap-2">
          {saved.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span className="truncate">{file.original_name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={t('files.remove', { name: file.original_name })}
                onClick={() => onRemoveSaved(file)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FileUpload
        aria-label={t('files.label')}
        accept={NOTICE_LIMITS.mimeTypes.join(',')}
        items={pending.map((file) => ({ id: idOf(file), file }))}
        onFilesSelected={add}
        onRemove={(file) => {
          setProblems([]);
          onPendingChange(pending.filter((f) => f !== file));
        }}
        disabled={disabled}
      />
      {problems.length > 0 && (
        <ul role="alert" className="text-caption text-destructive">
          {[...new Set(problems)].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
