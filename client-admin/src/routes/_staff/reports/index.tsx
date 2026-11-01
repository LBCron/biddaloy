/**
 * [8.15.29] `/reports` — the Reports hub: every report a person may open, in one place.
 *
 * ```
 *  All reports
 *  Open a report and the answer is on screen at once.
 *  Find a report [______________]
 *
 *  Favourites
 *  [★ Student count (BANBEIS)  ]
 *  Ready reports                       <- reports the school defined (GET /reports/catalogue)
 *  [☆ Dues by class            ]
 *  Fees and money                      <- coded reports, linked, never copied (D1, P5)
 *  [☆ Fee collection report    ]
 * ```
 *
 * Two kinds of card share the hub. A defined report opens `/reports/$reportId`. A coded report (a
 * ledger or a document that stays as code) links to its own screen, see `-coded-reports.ts`. A coded
 * card shows only to a role that may open its page (`STAFF_ROUTE_PERMISSIONS`). Each card says what
 * the report shows in one plain line, never a field name (D21). Search matches the Bangla and the
 * English name and line. Favourites live in this browser only (`localStorage`, wrapped in try/catch:
 * a blocked store just means no favourites, never an error).
 *
 * Words come from `reports.json` `hub.*` (the 8.15 glossary).
 */
import { Permission, roleHasPermission } from '@biddaloy/shared';
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  Label,
  RoutePending,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  reportCatalogueQueryOptions,
  useActiveRole,
  useHasPermission,
  useReportCatalogue,
  type ReportCatalogueEntry,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon, StarIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import {
  CODED_FOLDERS,
  visibleCodedReports,
  type Bilingual,
  type CodedReport,
} from './-coded-reports';

export const Route = createFileRoute('/_staff/reports/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(reportCatalogueQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('reports', 'reportDesigner', 'common', 'nav'),
    ]),
  pendingComponent: ReportsHubPending,
  component: ReportsHubPage,
});

function ReportsHubPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

/** One card on the hub, whichever kind of report it stands for. */
interface HubCard {
  /** `defined:<uuid>` or `coded:<id>`; what the favourites list keeps. */
  id: string;
  name: string;
  description: string;
  /** What search looks through: both languages, lower case. */
  haystack: string;
  open: { kind: 'defined'; reportId: string } | { kind: 'coded'; report: CodedReport };
}

const FAVOURITES_KEY = 'reports.favourites';

function readFavourites(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavourites(ids: string[]) {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(ids));
  } catch {
    // A blocked store: the star still works for this visit, it is just not remembered.
  }
}

const pick = (text: Bilingual, locale: string) => (locale === 'bn' ? text.bn : text.en);

function ReportCard({
  card,
  favourite,
  onToggleFavourite,
}: {
  card: HubCard;
  favourite: boolean;
  onToggleFavourite: () => void;
}) {
  const { t } = useTranslation('reports');
  return (
    <li className="relative flex min-w-0 flex-col gap-1 rounded-lg border border-border-subtle bg-surface p-4 hover:bg-muted md:p-5">
      <div className="flex items-start justify-between gap-2">
        {card.open.kind === 'defined' ? (
          <Link
            to="/reports/$reportId"
            params={{ reportId: card.open.reportId }}
            className="min-w-0 font-medium text-text-primary after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {card.name}
          </Link>
        ) : (
          <Link
            to={card.open.report.to}
            className="min-w-0 font-medium text-text-primary after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {card.name}
          </Link>
        )}
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="icon"
          className="relative z-10 -me-2 -mt-2 size-11 shrink-0 md:size-8"
          aria-pressed={favourite}
          aria-label={t(favourite ? 'hub.favourite.remove' : 'hub.favourite.add', {
            name: card.name,
          })}
          onClick={onToggleFavourite}
        >
          <StarIcon aria-hidden="true" className={favourite ? 'fill-current' : undefined} />
        </Button>
      </div>
      <p className="text-text-secondary">{card.description}</p>
    </li>
  );
}

function CardGrid({
  title,
  cards,
  favourites,
  onToggle,
}: {
  title: string;
  cards: HubCard[];
  favourites: string[];
  onToggle: (id: string) => void;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-h2">
        {title}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ReportCard
            key={card.id}
            card={card}
            favourite={favourites.includes(card.id)}
            onToggleFavourite={() => onToggle(card.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function ReportsHubPage() {
  const { t } = useTranslation('reports');
  const { t: tDesigner } = useTranslation('reportDesigner');
  const { locale } = useLocale();
  const role = useActiveRole();
  const canDesign = useHasPermission(Permission.REPORTS_DESIGN);
  const catalogue = useReportCatalogue();
  const [search, setSearch] = React.useState('');
  const [favourites, setFavourites] = React.useState<string[]>(readFavourites);

  const toggleFavourite = (id: string) => {
    const next = favourites.includes(id) ? favourites.filter((f) => f !== id) : [...favourites, id];
    setFavourites(next);
    writeFavourites(next);
  };

  const definedLine = t('hub.definedDescription');
  const defined = (entry: ReportCatalogueEntry): HubCard => ({
    id: `defined:${entry.id}`,
    name: (locale === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en,
    description: definedLine,
    haystack: `${entry.name_en} ${entry.name_bn} ${entry.key}`.toLowerCase(),
    open: { kind: 'defined', reportId: entry.id },
  });
  const coded = (report: CodedReport): HubCard => ({
    id: `coded:${report.id}`,
    name: pick(report.name, locale),
    description: pick(report.description, locale),
    haystack:
      `${report.name.en} ${report.name.bn} ${report.description.en} ${report.description.bn}`.toLowerCase(),
    open: { kind: 'coded', report },
  });

  // Defined folders first (the unnamed one leads, as the server orders them), then the coded ones.
  const sections: { id: string; title: string; cards: HubCard[] }[] = [];
  for (const folder of catalogue.data ?? []) {
    sections.push({
      id: `defined:${folder.folder ?? ''}`,
      title: folder.folder ?? t('hub.folders.ready'),
      cards: folder.reports.map(defined),
    });
  }
  const visibleCoded = visibleCodedReports((permission) => roleHasPermission(role, permission));
  for (const [folderId, title] of Object.entries(CODED_FOLDERS)) {
    const cards = visibleCoded.filter((r) => r.folder === folderId).map(coded);
    if (cards.length > 0)
      sections.push({ id: `coded:${folderId}`, title: pick(title, locale), cards });
  }

  const query = search.trim().toLowerCase();
  const matching = sections
    .map((section) => ({
      ...section,
      cards: section.cards.filter((card) => query === '' || card.haystack.includes(query)),
    }))
    .filter((section) => section.cards.length > 0);
  // A favourite is pinned to the top and leaves its folder, so no report shows twice.
  const favouriteCards = matching.flatMap((s) => s.cards).filter((c) => favourites.includes(c.id));
  const folders = matching
    .map((s) => ({ ...s, cards: s.cards.filter((c) => !favourites.includes(c.id)) }))
    .filter((s) => s.cards.length > 0);
  const nothingAtAll = sections.every((s) => s.cards.length === 0);

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader
          title={t('hub.title')}
          subtitle={t('hub.subtitle')}
          actions={[
            {
              id: 'new-report',
              label: tDesigner('title.new'),
              icon: <PlusIcon aria-hidden className="size-4" />,
              priority: 'primary',
              helpId: 'reports.hub.action.newReport',
              // Only a person who may design reports (admin) is offered it; the route says the same.
              allowed: canDesign,
              to: '/reports/new',
            },
          ]}
        />

        {catalogue.isError && (
          <ErrorState
            message={t('hub.loadError')}
            retryLabel={t('hub.retry')}
            onRetry={() => void catalogue.refetch()}
          />
        )}

        {!nothingAtAll && (
          <div className="flex w-full flex-col gap-1.5 md:w-96">
            <Label htmlFor="reports-search" helpId="reports.hub.field.search">
              {t('hub.searchLabel')}
            </Label>
            <Input
              id="reports-search"
              type="search"
              className="w-full"
              value={search}
              placeholder={t('hub.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}

        {catalogue.isPending && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!catalogue.isPending && nothingAtAll && !catalogue.isError && (
          <div className="flex flex-col items-center gap-3">
            <EmptyState title={t('hub.empty.title')} explanation={t('hub.empty.explanation')} />
            {canDesign && (
              <Button asChild>
                <Link to="/reports/new">{t('hub.empty.create')}</Link>
              </Button>
            )}
          </div>
        )}

        {!nothingAtAll && matching.length === 0 && (
          <EmptyState
            kind="no-results"
            title={t('hub.noMatch.title')}
            explanation={t('hub.noMatch.explanation')}
            action={{ label: t('hub.clearSearch'), onClick: () => setSearch('') }}
          />
        )}

        {favouriteCards.length > 0 && (
          <CardGrid
            title={t('hub.folders.favourites')}
            cards={favouriteCards}
            favourites={favourites}
            onToggle={toggleFavourite}
          />
        )}
        {folders.map((section) => (
          <CardGrid
            key={section.id}
            title={section.title}
            cards={section.cards}
            favourites={favourites}
            onToggle={toggleFavourite}
          />
        ))}
      </div>
    </PageContainer>
  );
}
