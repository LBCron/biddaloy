/**
 * [30.5.1] Wires `CommandPalette` (30.4.1) into this app: owns the
 * `Ctrl/Cmd+K` listener, the `?` shortcuts-help listener, and the three
 * tabs' actual data — `usePaletteSearch` (30.2.1's `GET /search`) for
 * People, `STAFF_NAV_GROUPS` for Page, `ACTIONS` for Action — plus what
 * a selection in each tab navigates to. Replaces `GlobalSearchLauncher`
 * / the old single-list `GlobalSearch` (both retired by this ticket).
 *
 * Result targets — same "closest existing destination" reasoning the
 * old launcher used:
 * - student -> its own `/students/$studentId` page.
 * - guardian -> its own `/guardians/$guardianId` page.
 * - invoice -> its own `/invoices/$invoiceId` page.
 * - staff -> nowhere yet. No `/staff/:id` detail page exists (`/staff`
 *   is a list-only route in `nav-tree.ts`) — selecting one just closes
 *   the palette, same as "teacher" did in the old launcher.
 * - payment (receipt) -> also nowhere. The old launcher opened the
 *   paying student's own page here, but `GET /search`'s
 *   `SearchPaymentResult` (`search.dto.ts`) carries `student_name` for
 *   display only, not the student's `id` — there is no FK in the
 *   response to navigate with. A server-side gap, not something this
 *   ticket's territory (`server/`) can fix; selecting a payment result
 *   closes the palette without navigating, like staff.
 *
 * Action tab: an `ACTIONS` entry is listed (grouped by nav group) only when
 * the signed-in role holds its `permission`. If it declares a `context` the
 * current route does not supply (a `studentId`/`guardianId`/`invoiceId`/
 * `scaleId` route param), it is still listed but disabled, with the reason
 * shown; the permission alone still hides it. See
 * `action-registry.ts`'s own header comment for why the permission
 * check alone is not enough to gate a shortcut the sidebar wouldn't
 * already show.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  CommandPalette,
  type CommandPaletteTab,
  type GlobalSearchGroup,
  HelpHint,
  ShortcutsSheet,
  useHelp,
} from '@biddaloy/ui/components';
import {
  hasPermission,
  useActiveRole,
  useDebouncedValue,
  useEntityLabel,
  usePaletteSearch,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useNavigate, useParams } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import * as React from 'react';

import { ACTIONS, DEMO_SWITCH_ROLE_ACTION, type ActionContext } from '../action-registry';
import { useDemoMode } from '../features/demo/use-demo-mode';
import { useSignOutToLogin } from '../features/demo/use-sign-out-to-login';
import {
  matchesNavSearch,
  rankByMatch,
  STAFF_NAV_GROUPS,
  STAFF_TOP_NAV_ITEMS,
  type StaffNavItemDef,
  type StaffNavLabel,
} from '../nav-tree';

const SEARCH_DEBOUNCE_MS = 300;
const HELP_ACTION_ID = 'help.thisPage';

/** [31.3.1] Page-only mode for the portal and platform shells: their own pages, no People/Action tab, no `/search` call. */
export interface PaletteLauncherPage {
  id: string;
  label: string;
  to: string;
  synonyms?: readonly string[];
}

export function CommandPaletteLauncher({
  pages,
}: {
  /**
   * Page-only mode (portal / platform shells). The caller must pre-filter this
   * list by the user's role: it is shown as-is, with no permission check here.
   */
  pages?: readonly PaletteLauncherPage[];
} = {}) {
  const { t, i18n } = useTranslation('nav');
  const navigate = useNavigate();
  const activeRole = useActiveRole();
  const signOutToLogin = useSignOutToLogin();
  const { pageHref: helpHref } = useHelp();
  const demo = useDemoMode();
  const actions = React.useMemo(
    () => (demo.enabled ? [...ACTIONS, DEMO_SWITCH_ROLE_ACTION] : ACTIONS),
    [demo.enabled],
  );
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const peopleResults = usePaletteSearch(pages ? '' : debouncedQuery);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // [30.1.3]'s `nav-tree.ts` uses `useEntityLabel` for the same fixed,
  // known-at-build-time set of entity nouns `_staff.tsx` resolves its
  // own sidebar labels with — one hook call per entity at the
  // component's top level (rules-of-hooks forbids calling this inside
  // the `resolveNavLabel` loop below).
  const entityLabels: Record<string, string> = {
    student: useEntityLabel('student', { count: 2 }),
    guardian: useEntityLabel('guardian', { count: 2 }),
    staff: useEntityLabel('staff', { count: 2 }),
    class: useEntityLabel('class', { count: 2 }),
    academicYear: useEntityLabel('academicYear', { count: 2 }),
    invoice: useEntityLabel('invoice', { count: 2 }),
  };

  function resolveNavLabel(label: StaffNavLabel, namespace: 'items' | 'groups'): string {
    return 'entity' in label
      ? (entityLabels[label.entity] ?? label.entity)
      : t(`${namespace}.${label.key}`);
  }

  const params = useParams({ strict: false });
  const availableContexts = React.useMemo<Set<ActionContext>>(() => {
    const contexts = new Set<ActionContext>();
    if (params.studentId) contexts.add('student');
    if (params.guardianId) contexts.add('guardian');
    if (params.invoiceId) contexts.add('invoice');
    if (params.scaleId) contexts.add('gradingScale');
    if (params.examId) contexts.add('exam');
    return contexts;
  }, [params.studentId, params.guardianId, params.invoiceId, params.scaleId, params.examId]);

  // Global `Ctrl/Cmd+K` (opens the palette) and `?` (opens the
  // shortcuts sheet) — [8.9.9]/[30.4.1]'s "opens from anywhere" ACs.
  // Neither is scoped to a particular element, so both fire regardless
  // of what currently has focus.
  //
  // [8.14.3]: `_staff.tsx` mounts this component twice (desktop top bar,
  // mobile header row) — only one is ever visible at a given viewport
  // width, but both stay mounted, so the `offsetParent` guard below
  // (same reasoning as the old `GlobalSearchLauncher`) makes only the
  // currently-visible instance respond, rather than both firing on
  // every keypress.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (triggerRef.current?.offsetParent === null) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((isOpen) => !isOpen);
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      // [44.2.01] F1 opens this page's guide in a new tab (E8, D21); inert without one.
      // Plain F1 only: no modifier combos, and holding the key opens one tab, not one per repeat.
      if (event.key === 'F1') {
        if (
          isTypingTarget ||
          helpHref === null ||
          event.repeat ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.shiftKey
        ) {
          return;
        }
        event.preventDefault();
        window.open(helpHref, '_blank', 'noopener');
        return;
      }
      if (
        event.key === '?' &&
        !isTypingTarget &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setShortcutsOpen((isOpen) => !isOpen);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpHref]);

  // Closing always starts the next open on a blank query — same
  // reasoning as the old launcher.
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const peopleGroups: GlobalSearchGroup[] = [
    {
      id: 'students',
      label: t('commandPalette.groups.students'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.students.map((student) => {
        const description = [student.class_name, student.section_name].filter(Boolean).join(' – ');
        return {
          id: student.id,
          label: student.full_name,
          ...(description !== '' && { description }),
        };
      }),
    },
    {
      id: 'guardians',
      label: t('commandPalette.groups.guardians'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.guardians.map((guardian) => ({
        id: guardian.id,
        label: guardian.full_name,
        ...(guardian.phone !== null && { description: guardian.phone }),
      })),
    },
    {
      id: 'staff',
      label: t('commandPalette.groups.staff'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.staff.map((staffMember) => ({
        id: staffMember.id,
        label: staffMember.full_name,
        description: staffMember.employee_id,
      })),
    },
    {
      id: 'invoices',
      label: t('commandPalette.groups.invoices'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.invoices.map((invoice) => ({
        id: invoice.id,
        label: invoice.invoice_number,
        ...(invoice.student_name !== null && { description: invoice.student_name }),
      })),
    },
    {
      id: 'payments',
      label: t('commandPalette.groups.payments'),
      isLoading: peopleResults.isLoading,
      results: peopleResults.payments.map((payment) => ({
        id: payment.id,
        label: payment.transaction_reference ?? t('commandPalette.receiptFallbackLabel'),
        ...(payment.student_name !== null && { description: payment.student_name }),
      })),
    },
  ];

  // Page tab — [30.1.4]'s `STAFF_NAV_GROUPS`, one section per sidebar group
  // in sidebar order (pinned items first, Dashboard as a header-less leading
  // row), filtered by each item's declared permission and matched against the
  // query on the item's *currently rendered* locale label plus `synonyms`.
  // An empty query lists everything permitted (#1733 D2).
  const trimmedQuery = query.trim().toLowerCase();
  const pageGroups = React.useMemo<GlobalSearchGroup[]>(() => {
    if (pages) {
      // Portal / platform palettes have no Action tab, so the demo switch and this page's
      // help ride along as pages. `handleSelect` intercepts both ids before navigating.
      const locale = i18n.language.startsWith('bn') ? 'bn' : 'en';
      const helpLabel = ACTIONS.find((action) => action.id === HELP_ACTION_ID)?.label[locale];
      // The help row has no `to`: its URL would show as a long, unbreakable description.
      const listed: (Omit<PaletteLauncherPage, 'to'> & { to?: string })[] = [
        ...pages,
        ...(demo.enabled
          ? [
              {
                id: DEMO_SWITCH_ROLE_ACTION.id,
                label: DEMO_SWITCH_ROLE_ACTION.label[locale],
                to: '/login',
              },
            ]
          : []),
        ...(helpHref !== null && helpLabel ? [{ id: HELP_ACTION_ID, label: helpLabel }] : []),
      ];
      return [
        {
          id: 'pages',
          label: t('commandPalette.groups.pages'),
          results: rankByMatch(
            listed
              .filter((page) => matchesNavSearch(page.label, page.synonyms, trimmedQuery))
              .map((page) => ({
                id: page.id,
                label: page.label,
                ...(page.to !== undefined && { description: page.to }),
              })),
            trimmedQuery,
          ),
        },
      ];
    }
    const toRows = (items: readonly StaffNavItemDef[]) =>
      rankByMatch(
        items
          .filter(
            (item) => item.permission === undefined || hasPermission(activeRole, item.permission),
          )
          .map((item) => ({ item, label: resolveNavLabel(item.label, 'items') }))
          .filter(({ item, label }) => matchesNavSearch(label, item.synonyms, trimmedQuery))
          .map(({ item, label }) => ({ id: item.id, label, description: item.to })),
        trimmedQuery,
      );
    return [
      { id: 'dashboard', label: '', results: toRows([...STAFF_TOP_NAV_ITEMS]) },
      ...STAFF_NAV_GROUPS.map((group) => ({
        id: group.id,
        label: resolveNavLabel(group.label, 'groups'),
        results: toRows([...(group.pinnedItems ?? []), ...group.items]),
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, activeRole, i18n.language, pages, demo.enabled, helpHref]);

  // Action tab — `ACTIONS` (30.4.2), one section per nav group. Hidden when
  // the role lacks the permission; *disabled with a reason* (not hidden) when
  // the route lacks the action's context (#1733 D4).
  const contextNoun: Record<ActionContext, string> = {
    student: t('commandPalette.contextNouns.student'),
    guardian: t('commandPalette.contextNouns.guardian'),
    invoice: t('commandPalette.contextNouns.invoice'),
    gradingScale: t('commandPalette.contextNouns.gradingScale'),
    exam: t('commandPalette.contextNouns.exam'),
  };
  const needsContext = (ctx: readonly ActionContext[]) =>
    t('commandPalette.needsContext', {
      things: new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(
        ctx.map((c) => contextNoun[c]),
      ),
    });
  const actionGroups = React.useMemo<GlobalSearchGroup[]>(() => {
    const locale = i18n.language.startsWith('bn') ? 'bn' : 'en';
    const toActionRow = (action: (typeof ACTIONS)[number]) => {
      // `context: []` means "needs no entity" (ACR / incident actions), same as omitted.
      const ctx = action.context;
      return ctx?.length && !ctx.some((c) => availableContexts.has(c))
        ? {
            id: action.id,
            label: action.label[locale],
            disabled: true,
            description: needsContext(ctx),
          }
        : { id: action.id, label: action.label[locale] };
    };
    const topGroup: GlobalSearchGroup = {
      id: 'top',
      label: '',
      results: rankByMatch(
        actions
          .filter(
            (action) =>
              action.group === 'top' &&
              (action.permission === null || hasPermission(activeRole, action.permission)) &&
              (action.id !== HELP_ACTION_ID || helpHref !== null) &&
              (action.alsoRequires ?? []).every((p) => hasPermission(activeRole, p)) &&
              matchesNavSearch(action.label[locale], action.synonyms, trimmedQuery),
          )
          .map(toActionRow),
        trimmedQuery,
      ),
    };
    return [
      topGroup,
      ...STAFF_NAV_GROUPS.map((group) => ({
        id: group.id,
        label: resolveNavLabel(group.label, 'groups'),
        results: rankByMatch(
          actions
            .filter(
              (action) =>
                action.group === group.id &&
                (action.permission === null || hasPermission(activeRole, action.permission)) &&
                (action.alsoRequires ?? []).every((p) => hasPermission(activeRole, p)) &&
                matchesNavSearch(action.label[locale], action.synonyms, trimmedQuery),
            )
            .map(toActionRow),
          trimmedQuery,
        ),
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, activeRole, availableContexts, i18n.language, actions, helpHref]);

  const peopleTab: CommandPaletteTab = {
    id: 'people',
    label: t('commandPalette.tabs.people'),
    groups: peopleGroups,
    searchableHint: t('commandPalette.searchableHint'),
    noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
  };
  const pageTab: CommandPaletteTab = {
    id: 'page',
    label: t('commandPalette.tabs.page'),
    groups: pageGroups,
    searchableHint: t('commandPalette.pageSearchableHint'),
    noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
  };
  const actionTab: CommandPaletteTab = {
    id: 'action',
    label: t('commandPalette.tabs.action'),
    groups: actionGroups,
    searchableHint: t('commandPalette.actionSearchableHint'),
    noResultsText: (searchQuery) => t('commandPalette.noResults', { query: searchQuery }),
  };
  // No STUDENT_READ → no People tab at all (and `usePaletteSearch` makes no /search call).
  const tabs: readonly [CommandPaletteTab, ...CommandPaletteTab[]] = pages
    ? [pageTab]
    : hasPermission(activeRole, Permission.STUDENT_READ)
      ? [peopleTab, pageTab, actionTab]
      : [pageTab, actionTab];

  function handleSelect(tabId: (typeof tabs)[number]['id'], groupId: string, resultId: string) {
    if (tabId === 'people') {
      if (groupId === 'students') {
        void navigate({ to: '/students/$studentId', params: { studentId: resultId } });
      } else if (groupId === 'guardians') {
        void navigate({ to: '/guardians/$guardianId', params: { guardianId: resultId } });
      } else if (groupId === 'invoices') {
        void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: resultId } });
      }
      // 'staff' and 'payments' — no destination page/FK exists yet, see
      // this file's own header comment.
      return;
    }
    // Listed as a page (portal/platform) or an action (staff); either way it is a sign-out.
    if (resultId === DEMO_SWITCH_ROLE_ACTION.id) {
      void signOutToLogin();
      return;
    }
    // The portal page row: an external tab, never a navigate. The staff action opens via its `run`.
    if (tabId === 'page' && resultId === HELP_ACTION_ID) {
      if (helpHref !== null) window.open(helpHref, '_blank', 'noopener');
      return;
    }
    if (tabId === 'page') {
      const item = pageGroups.flatMap((g) => g.results).find((result) => result.id === resultId);
      if (item?.description) void navigate({ to: item.description });
      return;
    }
    if (tabId === 'action') {
      const action = actions.find((candidate) => candidate.id === resultId);
      action?.run({
        navigate: (opts) => void navigate({ to: opts.to }),
        params: {
          studentId: params.studentId,
          examId: params.examId,
          sectionId: params.sectionId,
          subjectId: params.subjectId,
        },
        helpHref,
      });
    }
  }

  return (
    <>
      {/* [8.14.2]: input-shaped launcher, same reasoning as the retired
       * `GlobalSearchLauncher` — see its former header comment for why
       * this collapses to an icon-only square below `md` instead of
       * hiding, and why it stays a single element with a fixed
       * `aria-label` rather than a hidden/shown pair. */}
      <span className="inline-flex items-center gap-1">
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          aria-label={t('commandPalette.buttonLabel')}
          className="inline-flex h-[var(--control-h,2rem)] w-[var(--control-h,2rem)] items-center justify-center gap-2 rounded-md border-input px-0 font-normal text-muted-foreground md:w-56 md:justify-start md:px-2"
        >
          <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden flex-1 truncate text-start md:inline">
            {t('commandPalette.launcherPlaceholder')}
          </span>
          <span className="hidden shrink-0 text-xs md:inline">
            {t('commandPalette.shortcutHint')}
          </span>
        </Button>
        {/* Desktop only: the phone header row holds exactly menu, search, bell, account (D12). */}
        <HelpHint helpId="start.findAnything.action.open" className="hidden md:inline-flex" />
      </span>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        tabs={tabs}
        onSelect={handleSelect}
        aria-label={t('commandPalette.ariaLabel')}
        title={t('commandPalette.title')}
        placeholder={
          tabs[0].id === 'people'
            ? t('commandPalette.placeholder')
            : t('commandPalette.placeholderNoPeople')
        }
        description={t('commandPalette.description')}
        footerHint={pages ? t('commandPalette.footerHintPageOnly') : t('commandPalette.footerHint')}
        recentLabel={t('commandPalette.groups.recent')}
        announceResults={(count) =>
          count === 1
            ? t('commandPalette.resultCount', { count })
            : t('commandPalette.resultCountPlural', { count })
        }
      />
      <ShortcutsSheet
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        showHelpShortcut={helpHref !== null}
      />
    </>
  );
}
