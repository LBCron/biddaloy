/**
 * [47.4.2] One homeroom section at a glance (D6/D15): the attendance button
 * first, then six independent cards (one column on phone, three on desktop).
 * A section the caller is not a CLASS/ASSISTANT teacher of is a 404, same as
 * an id that does not exist.
 */
import { Permission } from '@biddaloy/shared';
import { Button, ErrorState, HelpHint, RoutePending } from '@biddaloy/ui/components';
import {
  myClassSectionsQueryOptions,
  useHasPermission,
  useMyClassSections,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ClipboardCheckIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import {
  AbsenteesCard,
  ArrivalNoticesCard,
  DuesCard,
  FlagsCard,
  HomeworkCard,
  NotesCard,
  ResultsCard,
  RosterCard,
  todayIso,
} from './-cards';

const searchSchema = z.object({
  then: z.enum(['arrival']).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/my-class/$sectionId')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myClassSectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('myClass', 'nav'),
    ]),
  pendingComponent: SectionPending,
  component: MyClassSectionPage,
});

function SectionPending() {
  const { t } = useTranslation('myClass');
  return <RoutePending variant="detail" label={t('loading')} />;
}

function MyClassSectionPage() {
  const { sectionId } = Route.useParams();
  const { then } = Route.useSearch();
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
  const query = useMyClassSections();
  const attendanceRef = React.useRef<HTMLAnchorElement>(null);
  const section = query.data?.find((s) => s.section_id === sectionId);
  // The card's list needs MANAGE; MY_CLASS_VIEW alone must not mount a card that can only fail.
  const canManageArrival = useHasPermission(Permission.ATTENDANCE_ARRIVAL_NOTICE_MANAGE);
  const resolvedId = section?.section_id;

  // First focus: the one thing a class teacher does here every morning.
  // Runs once per section, when it resolves (the button only exists then). Keyed on the id,
  // not the object: answering a request refetches the sections (the count changes), and
  // focus must stay where the teacher is working in the card.
  // `?then=arrival` (palette / alert link) lands on the arrival card instead.
  React.useEffect(() => {
    if (!resolvedId) return;
    if (then === 'arrival') document.getElementById('my-class-arrival')?.focus();
    else attendanceRef.current?.focus();
    // A count refetch keeps the id and `then`, so it never moves focus; a palette jump to
    // `?then=arrival` on the section already open does.
  }, [resolvedId, then]);

  if (query.isError && !section) {
    return (
      <PageContainer>
        <ErrorState
          message={t('sectionLoadError')}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }
  if (query.isPending) return <SectionPending />;
  if (!section) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw notFound();
  }

  return (
    <PageContainer>
      {/* Inline PageHeader markup: the primary is a router Link that must take
          focus on load, and PageAction has neither `to` nor a ref. */}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          {/* Same text as the crumb (`use-breadcrumbs.ts`): h1 = last crumb. */}
          <h1 className="text-h1">{`${section.class_name} – ${section.section_name}`}</h1>
          <p className="mt-0.5 truncate text-text-secondary">
            {t('subtitle', {
              role: t(`roles.${section.assignment_type}`),
              date: formatDate(new Date(), region),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex flex-1 items-center gap-1 md:flex-none">
            <Button asChild className="flex-1 md:flex-none">
              <Link
                ref={attendanceRef}
                to="/attendance/$sectionId"
                params={{ sectionId }}
                search={{ date: todayIso() }}
              >
                <ClipboardCheckIcon aria-hidden="true" />
                {t('takeAttendance')}
              </Link>
            </Button>
            <HelpHint helpId="academics.myClass.action.takeAttendance" />
          </span>
        </div>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-3">
        <AbsenteesCard sectionId={sectionId} />
        {canManageArrival && <ArrivalNoticesCard sectionId={sectionId} />}
        <FlagsCard sectionId={sectionId} />
        <DuesCard sectionId={sectionId} />
        <HomeworkCard sectionId={sectionId} />
        <ResultsCard sectionId={sectionId} classId={section.class_id} />
        <NotesCard sectionId={sectionId} classId={section.class_id} />
        <RosterCard sectionId={sectionId} />
      </div>
    </PageContainer>
  );
}
