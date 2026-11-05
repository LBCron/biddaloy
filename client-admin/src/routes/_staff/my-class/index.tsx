/**
 * [47.4.2] "Which of my homeroom sections?" — `GET /my-class/sections`
 * (current-year CLASS_TEACHER / ASSISTANT_CLASS_TEACHER rows, D12/D26).
 *
 * - 0 sections: empty state (D14).
 * - 1 section: redirect straight to its page, or to the attendance register
 *   when the palette sent `?then=attendance` (D13), or the remarks grid for `?then=notes`.
 * - 2+: one link card per section (role as plain text).
 *
 * The redirect lives in the loader so the picker never flashes.
 */
import {
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { myClassSectionsQueryOptions, useMyClassSections } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { BookUserIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

const searchSchema = z.object({
  then: z.enum(['attendance', 'arrival', 'notes']).optional().catch(undefined),
});

// Local getters — `toISOString()` is UTC and would link to yesterday's
// register for a teacher in Asia/Dhaka before 06:00 (same note as
// `attendance/index.tsx`).
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const Route = createFileRoute('/_staff/my-class/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ then: search.then }),
  loader: async ({ context: { queryClient }, deps }) => {
    const [sections] = await Promise.all([
      queryClient.ensureQueryData(myClassSectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('myClass', 'nav'),
    ]);
    const only = sections?.length === 1 ? sections[0] : undefined;
    if (only) {
      if (deps.then === 'attendance') {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: '/attendance/$sectionId',
          params: { sectionId: only.section_id },
          search: { date: todayIso() },
        });
      }
      if (deps.then === 'notes') {
        // [70.5.5] The `my-class.notes` palette action lands on the remarks grid itself.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw redirect({
          to: '/my-class/$sectionId/notes',
          params: { sectionId: only.section_id },
        });
      }
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        to: '/my-class/$sectionId',
        params: { sectionId: only.section_id },
        search: deps.then === 'arrival' ? { then: 'arrival' } : {},
      });
    }
  },
  pendingComponent: MyClassPending,
  component: MyClassPickerPage,
});

function MyClassPending() {
  const { t } = useTranslation('myClass');
  return <RoutePending variant="list" label={t('loading')} />;
}

const GRID = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3';

function MyClassPickerPage() {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
  const query = useMyClassSections();
  const sections = query.data ?? [];
  // The palette's "→ arrival" path picks a section here, then lands on the card.
  const { then } = Route.useSearch();

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <div aria-busy="true" className={GRID}>
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        message={t('loadError')}
        retryLabel={t('retry')}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (sections.length === 0) {
    body = (
      <EmptyState
        icon={<BookUserIcon aria-hidden="true" />}
        title={t('emptyTitle')}
        explanation={t('empty')}
      />
    );
  } else {
    body = (
      <section aria-labelledby="mc-sections">
        <h2 id="mc-sections" className="sr-only">
          {t('sectionsHeading')}
        </h2>
        <ul className={GRID}>
          {sections.map((section) => (
            <li key={section.section_id} className="min-w-0">
              <Link
                to={then === 'notes' ? '/my-class/$sectionId/notes' : '/my-class/$sectionId'}
                params={{ sectionId: section.section_id }}
                search={then === 'arrival' ? { then } : {}}
                className="flex min-h-16 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 no-underline shadow-e1 hover:bg-muted md:p-5"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
                >
                  <BookUserIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-h3">
                    {`${section.class_name} – ${section.section_name}`}
                  </span>
                  <span className="mt-0.5 block text-text-secondary">
                    {t(`roles.${section.assignment_type}`)}
                  </span>
                </span>
                {section.arrival_request_count > 0 && (
                  <StatusBadge
                    tone="warning"
                    label={t('arrivalCount', {
                      n: formatNumber(section.arrival_request_count, region),
                    })}
                  />
                )}
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-text-secondary"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('pickerSubtitle')} />
      {body}
    </PageContainer>
  );
}
