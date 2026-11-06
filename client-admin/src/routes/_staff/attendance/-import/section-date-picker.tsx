/**
 * [76.5.05] Step 1 of the attendance sheet import: pick up to 10 sections the
 * user may write, pick a date, download the pre-filled sheet.
 */
import { Button, Card, Checkbox, DatePicker } from '@biddaloy/ui/components';
import { useMySections } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, tenantTodayIso, toIsoDate } from '@biddaloy/ui/utils';
import { DownloadIcon } from 'lucide-react';

export const MAX_SHEET_SECTIONS = 10;

export interface SectionDatePickerProps {
  sectionIds: string[];
  onSectionIdsChange: (ids: string[]) => void;
  date: string;
  onDateChange: (date: string) => void;
  onDownload: () => void;
  downloading: boolean;
  error?: string | undefined;
}

export function SectionDatePicker({
  sectionIds,
  onSectionIdsChange,
  date,
  onDateChange,
  onDownload,
  downloading,
  error,
}: SectionDatePickerProps) {
  const { t } = useTranslation('attendanceImport');
  const regionConfig = useTenantRegionConfig();
  const sections = useMySections();

  function toggle(id: string, on: boolean) {
    onSectionIdsChange(on ? [...sectionIds, id] : sectionIds.filter((s) => s !== id));
  }
  const atLimit = sectionIds.length >= MAX_SHEET_SECTIONS;

  return (
    <Card className="space-y-4 p-4 md:p-5">
      <p className="text-text-secondary">{t('pick.description')}</p>
      <p className="text-text-secondary">{t('download.hint')}</p>

      <fieldset className="space-y-1">
        <legend className="text-label">{t('pick.sections')}</legend>
        <p className="text-caption text-text-secondary">
          {t('pick.sectionsLimit', { max: MAX_SHEET_SECTIONS })}
        </p>
        {(sections.data ?? []).map((section) => {
          const checked = sectionIds.includes(section.section_id);
          const id = `sheet-section-${section.section_id}`;
          return (
            <div key={section.section_id} className="flex min-h-11 items-center gap-3 md:min-h-8">
              <Checkbox
                id={id}
                checked={checked}
                disabled={!checked && atLimit}
                onCheckedChange={(value) => toggle(section.section_id, value === true)}
              />
              <label htmlFor={id}>
                {section.class_name} – {section.section_name}
              </label>
            </div>
          );
        })}
      </fieldset>

      <div className="space-y-1">
        <span className="text-label">{t('pick.date')}</span>
        <div>
          <DatePicker
            config={regionConfig}
            aria-label={t('pick.date')}
            clearable={false}
            value={parseDate(date)}
            max={parseDate(tenantTodayIso(regionConfig))}
            onValueChange={(value) => value && onDateChange(toIsoDate(value))}
          />
        </div>
      </div>

      {sectionIds.length === 0 && <p className="text-text-secondary">{t('pick.noSection')}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="button" disabled={sectionIds.length === 0 || downloading} onClick={onDownload}>
        <DownloadIcon aria-hidden="true" />
        {downloading ? t('download.downloading') : t('download.button')}
      </Button>
    </Card>
  );
}
