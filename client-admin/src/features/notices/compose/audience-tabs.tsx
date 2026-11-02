/**
 * [53.3.g2.01] The basic audience tabs, in order: guardians, all teachers/staff, students, by
 * name. The whole tab list lives in this one file so 53.5.02 can add the advanced tabs here.
 * A teacher sees only the student and guardian tabs (their reads are scoped, Rule 2).
 */
import { AudienceTab, AudienceTarget, UserRole } from '@biddaloy/shared';
import {
  Combobox,
  Input,
  MultiCombobox,
  type AudienceBuilderTab,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useAllClasses, useClassSections } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import type {
  AudiencePersonDto,
  AudienceQueryDto,
  NoticeRecipientDto,
  RecipientRefDto,
} from './use-compose';

export type TabKey = 'guardians' | 'staff' | 'students' | 'named';

export interface AudienceFilterState {
  classId: string | null;
  sectionId: string | null;
  roles: string[];
  kind: 'STAFF' | 'STUDENTS';
  q: string;
}
export const INITIAL_FILTERS: AudienceFilterState = {
  classId: null,
  sectionId: null,
  roles: [],
  kind: 'STAFF',
  q: '',
};

/** One row shape for both the matches and the Chosen list. */
export interface AudienceRow {
  key: string;
  name: string;
  detail: string;
  reach: 'app' | 'sms' | 'none';
  /** A match: what to send to `POST /recipients`. */
  ref?: RecipientRefDto;
  /** A chosen row: what to send to `DELETE /recipients`. */
  recipientId?: string;
}

const STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
];

export function tabKeys(isTeacher: boolean): TabKey[] {
  return isTeacher ? ['guardians', 'students'] : ['guardians', 'staff', 'students', 'named'];
}

const reachOf = (hasLogin: boolean, hasPhone: boolean): AudienceRow['reach'] =>
  hasLogin ? 'app' : hasPhone ? 'sms' : 'none';

/** Guardians and students list nobody until a class is picked: the server needs one (400). */
export const needsClass = (tab: TabKey, f: AudienceFilterState) =>
  (tab === 'guardians' || tab === 'students') && !f.classId;

export function personRow(p: AudiencePersonDto): AudienceRow {
  return {
    // Every id: guardians come one row per (guardian, child), so a mother and a father of one
    // child (no login) share the student id, and one guardian of two children shares a user id.
    key: `${p.kind}:${p.guardianId ?? ''}:${p.studentId ?? ''}:${p.userId ?? ''}`,
    name: p.name,
    detail: p.detail,
    reach: reachOf(p.hasLogin, p.hasPhone),
    ref: {
      kind: p.kind,
      userId: p.userId,
      studentId: p.studentId,
      guardianId: p.guardianId,
    },
  };
}

export function recipientRow(r: NoticeRecipientDto): AudienceRow {
  return {
    key: r.id,
    name: r.name,
    detail: r.forStudent ?? '',
    // Same rule as the server's `unreachable`: no login and no phone.
    reach: r.hasLogin ? 'app' : r.unreachable ? 'none' : 'sms',
    recipientId: r.id,
  };
}

export function audienceQuery(
  tab: TabKey,
  f: AudienceFilterState,
  page: number,
  limit: number,
): AudienceQueryDto {
  const base = { page, limit };
  const scope = {
    ...(f.classId ? { classIds: [f.classId] } : {}),
    ...(f.sectionId ? { sectionIds: [f.sectionId] } : {}),
  };
  const section = f.sectionId ? AudienceTab.SECTION : AudienceTab.CLASS;
  switch (tab) {
    case 'guardians':
      return { ...base, target: AudienceTarget.GUARDIANS, tab: section, ...scope };
    case 'students':
      return { ...base, target: AudienceTarget.STUDENTS, tab: section, ...scope };
    case 'staff':
      return {
        ...base,
        target: AudienceTarget.STAFF,
        tab: AudienceTab.ROLE,
        ...(f.roles.length ? { roles: f.roles as AudienceQueryDto['roles'] & string[] } : {}),
      };
    case 'named':
      return {
        ...base,
        target: f.kind === 'STAFF' ? AudienceTarget.STAFF : AudienceTarget.STUDENTS,
        tab: f.kind === 'STAFF' ? AudienceTab.NAMED_STAFF : AudienceTab.NAMED_STUDENT,
        ...(f.q.trim() ? { q: f.q.trim() } : {}),
      };
  }
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <span className="text-caption text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function ClassFilters({
  f,
  set,
}: {
  f: AudienceFilterState;
  set: (next: Partial<AudienceFilterState>) => void;
}) {
  const { t } = useTranslation('noticeCompose');
  const classes = useAllClasses();
  const sections = useClassSections(f.classId ?? undefined);
  return (
    <>
      <FilterField label={t('audience.filters.class')}>
        <Combobox
          aria-label={t('audience.filters.class')}
          options={(classes.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={f.classId}
          onValueChange={(classId) => set({ classId, sectionId: null })}
        />
      </FilterField>
      {f.classId && (
        <FilterField label={t('audience.filters.section')}>
          <Combobox
            aria-label={t('audience.filters.section')}
            options={(sections.data ?? []).map((s) => ({ value: s.id, label: s.section_name }))}
            value={f.sectionId}
            onValueChange={(sectionId) => set({ sectionId })}
          />
        </FilterField>
      )}
    </>
  );
}

export function useAudienceTabs(
  isTeacher: boolean,
  f: AudienceFilterState,
  set: (next: Partial<AudienceFilterState>) => void,
): AudienceBuilderTab[] {
  const { t } = useTranslation('noticeCompose');
  const filters: Record<TabKey, React.ReactNode> = {
    guardians: <ClassFilters f={f} set={set} />,
    students: <ClassFilters f={f} set={set} />,
    staff: (
      <FilterField label={t('audience.filters.roles')}>
        <MultiCombobox
          aria-label={t('audience.filters.roles')}
          options={STAFF_ROLES.map((r) => ({ value: r, label: t(`audience.roles.${r}`) }))}
          value={f.roles}
          onValueChange={(roles) => set({ roles })}
        />
      </FilterField>
    ),
    named: (
      <>
        <FilterField label={t('audience.filters.kind')}>
          <Combobox
            aria-label={t('audience.filters.kind')}
            options={[
              { value: 'STAFF', label: t('audience.filters.kindStaff') },
              { value: 'STUDENTS', label: t('audience.filters.kindStudents') },
            ]}
            value={f.kind}
            onValueChange={(kind) => set({ kind: kind === 'STUDENTS' ? 'STUDENTS' : 'STAFF' })}
          />
        </FilterField>
        <FilterField label={t('audience.filters.name')}>
          <Input
            aria-label={t('audience.filters.name')}
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
          />
        </FilterField>
      </>
    ),
  };
  return tabKeys(isTeacher).map((key) => ({
    key,
    label: t(`audience.tabs.${key}`),
    filters: filters[key],
  }));
}

export function useAudienceColumns(): DataTableColumn<AudienceRow>[] {
  const { t } = useTranslation('noticeCompose');
  return [
    { id: 'name', header: t('audience.columns.name'), card: 'title', accessorFn: (r) => r.name },
    {
      id: 'detail',
      header: t('audience.columns.detail'),
      card: 'subtitle',
      accessorFn: (r) => r.detail,
    },
    {
      id: 'contact',
      header: t('audience.columns.contact'),
      accessorFn: (r) => t(`audience.reach.${r.reach}`),
    },
  ];
}
