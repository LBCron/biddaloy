/**
 * [23.9] The HR record tab — one collapsible section per HR topic. This
 * is the ONE file in the whole epic that wires the section list; every
 * later ticket (23.10, 23.11, ...) only ever edits the *body* of its own
 * section file, never this file again.
 *
 * The design system has no `Accordion` component (checked
 * `ui/src/components` — only `Dialog`/`Select`/`Tabs`-adjacent primitives
 * exist, no disclosure widget), and building one from scratch is out of
 * this ticket's territory (`ui/src/components/**` isn't in its `## Files`
 * list). Native `<details>`/`<summary>` gives the same collapsible-section
 * UX — keyboard-operable and screen-reader-exposed out of the box, no new
 * dependency — so that's what this renders instead. Worth a real
 * `Accordion` in the design system if a second caller ever wants one.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';

import { HrRecordAchievementSection } from './hr-record-achievement-section';
import { HrRecordAddressSection } from './hr-record-address-section';
import { HrRecordCardSection } from './hr-record-card-section';
import { HrRecordDocumentsSection } from './hr-record-documents-section';
import { HrRecordEducationSection } from './hr-record-education-section';
import { HrRecordExperienceSection } from './hr-record-experience-section';
import { HrRecordFamilySection } from './hr-record-family-section';
import { HrRecordJobSection } from './hr-record-job-section';
import { HrRecordLanguageSection } from './hr-record-language-section';
import { HrRecordPromotionSection } from './hr-record-promotion-section';
import { HrRecordTrainingSection } from './hr-record-training-section';

export interface HrRecordTabProps {
  userId: string;
}

interface Section {
  id: string;
  labelKey: string;
  /** Full i18n key; overrides `hrRecord.sections.<labelKey>`. */
  titleKey?: string;
  render: (userId: string) => React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'card',
    labelKey: 'card',
    titleKey: 'cardNo.label',
    render: (userId) => <HrRecordCardSection userId={userId} />,
  },
  { id: 'job', labelKey: 'job', render: (userId) => <HrRecordJobSection userId={userId} /> },
  {
    id: 'promotion',
    labelKey: 'promotion',
    render: (userId) => <HrRecordPromotionSection userId={userId} />,
  },
  {
    id: 'family',
    labelKey: 'family',
    render: (userId) => <HrRecordFamilySection userId={userId} />,
  },
  {
    id: 'address',
    labelKey: 'address',
    render: (userId) => <HrRecordAddressSection userId={userId} />,
  },
  {
    id: 'experience',
    labelKey: 'experience',
    render: (userId) => <HrRecordExperienceSection userId={userId} />,
  },
  {
    id: 'education',
    labelKey: 'education',
    render: (userId) => <HrRecordEducationSection userId={userId} />,
  },
  {
    id: 'training',
    labelKey: 'training',
    render: (userId) => <HrRecordTrainingSection userId={userId} />,
  },
  {
    id: 'achievement',
    labelKey: 'achievement',
    render: (userId) => <HrRecordAchievementSection userId={userId} />,
  },
  {
    id: 'language',
    labelKey: 'language',
    render: (userId) => <HrRecordLanguageSection userId={userId} />,
  },
  {
    id: 'documents',
    labelKey: 'documents',
    render: (userId) => <HrRecordDocumentsSection userId={userId} />,
  },
];

export function HrRecordTab({ userId }: HrRecordTabProps) {
  const { t } = useTranslation('staff');

  return (
    <div className="space-y-3">
      {SECTIONS.map((section) => (
        <details
          key={section.id}
          open={section.id === 'job' || section.id === 'promotion'}
          className="group/hr rounded-lg border border-border-subtle bg-surface shadow-e1"
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 md:min-h-12 md:px-5">
            <h2 className="text-h3">
              {t(section.titleKey ?? `hrRecord.sections.${section.labelKey}`)}
            </h2>
            <ChevronDownIcon
              className="size-4 shrink-0 text-text-secondary group-open/hr:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="border-t border-border-subtle p-4 md:p-5">{section.render(userId)}</div>
        </details>
      ))}
    </div>
  );
}
