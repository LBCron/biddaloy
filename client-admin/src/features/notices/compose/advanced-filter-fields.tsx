/**
 * [53.5.02] Filter fields of the four advanced audience tabs: failed last exam, fee due, low
 * attendance, shift/version/group. Each one picks students or their guardians (`target`).
 * The query they build lives in `audienceQuery` (audience-tabs.tsx).
 */
import { Combobox, Input } from '@biddaloy/ui/components';
import { useExams } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import * as React from 'react';

import type { AudienceFilterState } from './audience-tabs';

type Set = (next: Partial<AudienceFilterState>) => void;

export interface Vocab {
  shifts: string[];
  versions: string[];
  groups: string[];
}

export const EMPTY_VOCAB: Vocab = { shifts: [], versions: [], groups: [] };
export const DEFAULT_BELOW_PERCENT = '75';

/** Whole number 1..100 (the server's own bounds for `belowPercent`), Bangla digits too; else null. */
export const parsePercent = (v: string): number | null => {
  const d = toLatinDigits(v);
  return /^\d{1,3}$/.test(d) && +d >= 1 && +d <= 100 ? +d : null;
};
export const validPercent = (v: string) => parsePercent(v) !== null;

/** The org tab is worth showing only when at least one of its fields would. */
export const hasOrgChoices = (v: Vocab | undefined) =>
  !!v && [v.shifts, v.versions, v.groups].some((l) => l.length >= 2);

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <span className="text-caption text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function TargetField({ f, set }: { f: AudienceFilterState; set: Set }) {
  const { t } = useTranslation('noticeCompose');
  return (
    <FilterField label={t('audience.filters.target')}>
      <Combobox
        aria-label={t('audience.filters.target')}
        options={[
          { value: 'STUDENTS', label: t('audience.filters.targetStudents') },
          { value: 'GUARDIANS', label: t('audience.filters.targetGuardians') },
        ]}
        value={f.target}
        onValueChange={(target) =>
          set({ target: target === 'GUARDIANS' ? 'GUARDIANS' : 'STUDENTS' })
        }
      />
    </FilterField>
  );
}

function ExamFailedFields({ f, set }: { f: AudienceFilterState; set: Set }) {
  const { t } = useTranslation('noticeCompose');
  // The list API has no status filter, so the page is filtered here; `partial` tells the admin
  // when older exams did not fit in the page.
  const exams = useExams({ limit: 100 });
  const partial = (exams.data?.total ?? 0) > (exams.data?.data.length ?? 0);
  // Published exams only, newest first.
  const options = (exams.data?.data ?? [])
    .filter((e) => e.status === 'PUBLISHED')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((e) => ({ value: e.id, label: e.class?.name ? `${e.name} · ${e.class.name}` : e.name }));
  return (
    <>
      <TargetField f={f} set={set} />
      <FilterField label={t('audience.filters.exam')}>
        <Combobox
          aria-label={t('audience.filters.exam')}
          options={options}
          value={f.examId}
          onValueChange={(examId) => set({ examId })}
        />
        {exams.isPending && (
          <span role="status" className="text-caption text-text-secondary">
            {t('audience.examsLoading')}
          </span>
        )}
        {exams.isError && (
          <span role="alert" className="text-danger text-caption">
            {t('audience.examsError')}
          </span>
        )}
        {partial && (
          <span role="status" className="text-caption text-text-secondary">
            {t('audience.examsPartial')}
          </span>
        )}
      </FilterField>
    </>
  );
}

function FeeDueFields({ f, set }: { f: AudienceFilterState; set: Set }) {
  const { t } = useTranslation('noticeCompose');
  return (
    <>
      <TargetField f={f} set={set} />
      <p className="self-end text-caption text-text-secondary">{t('help.feeDue')}</p>
    </>
  );
}

function LowAttendanceFields({ f, set }: { f: AudienceFilterState; set: Set }) {
  const { t } = useTranslation('noticeCompose');
  const bad = !validPercent(f.belowPercent);
  return (
    <>
      <TargetField f={f} set={set} />
      <FilterField label={t('audience.filters.belowPercent')}>
        <Input
          aria-label={t('audience.filters.belowPercent')}
          inputMode="numeric"
          value={f.belowPercent}
          aria-invalid={bad}
          onChange={(e) => set({ belowPercent: e.target.value })}
        />
        {bad && (
          <span role="alert" className="text-danger text-caption">
            {t('errors.percent')}
          </span>
        )}
      </FilterField>
    </>
  );
}

function OrgField({
  field,
  options,
  f,
  set,
}: {
  field: 'shift' | 'version' | 'group';
  options: string[];
  f: AudienceFilterState;
  set: Set;
}) {
  const { t } = useTranslation('noticeCompose');
  // The Epic 33 rule: a field shows only when the school has two or more values to choose from.
  if (options.length < 2) return null;
  return (
    <FilterField label={t(`audience.filters.${field}`)}>
      <Combobox
        aria-label={t(`audience.filters.${field}`)}
        options={options.map((o) => ({ value: o, label: o }))}
        value={f[field]}
        onValueChange={(v) => set({ [field]: v })}
      />
    </FilterField>
  );
}

export function advancedFilters(f: AudienceFilterState, set: Set, vocab: Vocab) {
  return {
    examFailed: <ExamFailedFields f={f} set={set} />,
    feeDue: <FeeDueFields f={f} set={set} />,
    lowAttendance: <LowAttendanceFields f={f} set={set} />,
    orgGroup: (
      <>
        <TargetField f={f} set={set} />
        <OrgField field="shift" options={vocab.shifts} f={f} set={set} />
        <OrgField field="version" options={vocab.versions} f={f} set={set} />
        <OrgField field="group" options={vocab.groups} f={f} set={set} />
      </>
    ),
  };
}
