/**
 * [8.11.10]'s acceptance criteria against the real route tree — same
 * reasoning `invoices/index.test.tsx`'s header comment gives for that
 * page: the route, its `validateSearch`, its loader and the `_staff`
 * layout's nav all participate, so a regression in any of them shows up
 * here rather than in a component test that mocked them away.
 */
import { AUDIT_ENTITY_TYPES } from '@biddaloy/shared';
import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  auditEntryFactory,
  auditLogHandlers,
  cleanupTestState,
  errorHandler,
  mixedActionFixtures,
  renderWithRouter,
  server,
  type AuditEntry,
} from '@biddaloy/ui/test';
import { formatDateTime } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';
import { pickDate } from '../../../test/pick-date';

/** Entries render on the school's clock in its region format. */
const at = (iso: string) => formatDateTime(iso, REGION_BD_EN);

/** `DataTable` names its scroll container with the table `caption`, so
 * this is the page's own `list.caption` string, not its `<h1>`. */
const TABLE_REGION = 'Audit trail, newest first';

function renderAuditLogs(options: { initialEntries?: string[]; role?: string } = {}) {
  return renderWithRouter(routeTree, {
    initialEntries: options.initialEntries ?? ['/audit-logs'],
    tenantId: 'tenant-1',
    role: options.role ?? 'ADMIN',
    locale: 'en',
  });
}

interface PaginatedAuditEntries {
  data: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Captures the query string of the next `GET /api/v1/audit-logs`. */
function captureParams(
  // One row by default: an empty page swaps the table for the EmptyState,
  // and most callers want the table region on screen.
  body: PaginatedAuditEntries = {
    data: [auditEntryFactory()],
    total: 1,
    page: 1,
    limit: 25,
    totalPages: 1,
  },
) {
  const seen: { params: URLSearchParams | null } = { params: null };
  server.use(
    http.get('/api/v1/audit-logs', ({ request }) => {
      seen.params = new URL(request.url).searchParams;
      return HttpResponse.json(body);
    }),
  );
  return seen;
}

describe('/audit-logs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders each row in plain language — when, who, action, what, summary', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    // The UPDATE row's summary is derived from the diff, not from the
    // action name alone.
    expect(await screen.findByText('3 details changed.')).toBeTruthy();
    // Four of the five fixtures were performed by her; the fifth is
    // system-triggered.
    expect(screen.getAllByText('Fatema Begum')).toHaveLength(4);
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText('A new fee structure was added.')).toBeTruthy();
    expect(screen.getByText('This invoice was deleted.')).toBeTruthy();
    expect(screen.getByText('Signed in to the school.')).toBeTruthy();
    expect(screen.getByText('Records were imported from a file.')).toBeTruthy();
  });

  it('renders "System" when no user performed the action', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    await screen.findByText('Records were imported from a file.');
    expect(screen.getByText('System')).toBeTruthy();
  });

  // The AC's "entries render in plain language, not raw JSON" — the
  // collapsed table must never leak a snapshot's serialization.
  it('never shows raw JSON in a collapsed row', async () => {
    server.use(auditLogHandlers.listMixedActions);

    const { container } = renderAuditLogs();

    await screen.findByText('3 details changed.');
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.textContent).not.toContain('{');
    expect(table!.textContent).not.toContain('"full_name"');
  });

  it('shows the timestamp, not just the date, so same-day entries stay distinct', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    // `mixedActionFixtures[0]` is 2026-01-05T10:30:00Z; Asia/Dhaka is
    // UTC+6, and timestamps render on the school's clock.
    expect(mixedActionFixtures[0]?.created_at).toBe('2026-01-05T10:30:00.000Z');
    expect(await screen.findByText(at('2026-01-05T10:30:00.000Z'))).toBeTruthy();
  });

  it('reads its initial filter state from the URL, not a default', async () => {
    renderAuditLogs({ initialEntries: ['/audit-logs?action=LOGIN&entity_type=User'] });

    await within(await screen.findByRole('combobox', { name: 'Action' })).findByText('Signed in');
    expect(within(screen.getByRole('combobox', { name: 'Record type' })).getByText('User'));
  });

  it('sends the URL filters to the server as snake_case query params', async () => {
    const seen = captureParams();

    renderAuditLogs({
      initialEntries: [
        '/audit-logs?action=UPDATE&entity_type=Student&from_date=2026-01-01&to_date=2026-01-31',
      ],
    });

    await waitFor(() => expect(seen.params).not.toBeNull());
    expect(seen.params!.get('action')).toBe('UPDATE');
    expect(seen.params!.get('entity_type')).toBe('Student');
    expect(seen.params!.get('from_date')).toBe('2026-01-01');
    expect(seen.params!.get('to_date')).toBe('2026-01-31');
  });

  it('changing the action filter writes it to the URL and refetches', async () => {
    captureParams();

    const { router } = renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Action' }));
    await user.click(await screen.findByRole('option', { name: 'Payment recorded' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ action: 'PAYMENT_RECEIVED' }),
    );
  });

  // `ListUrlStatePatch` reads an *absent* key as "leave this param
  // untouched", so clearing a filter has to send `null`. Get this wrong
  // and "All actions" is a dead control: the URL keeps the old value and
  // an administrator has no way back to the unfiltered trail.
  it('clearing the action filter removes it from the URL', async () => {
    captureParams();

    const { router } = renderAuditLogs({ initialEntries: ['/audit-logs?action=UPDATE'] });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Action' }));
    await user.click(await screen.findByRole('option', { name: 'All actions' }));

    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('action'));
  });

  it('changing the record-type filter writes it to the URL', async () => {
    captureParams();

    const { router } = renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Record type' }));
    await user.click(await screen.findByRole('option', { name: 'Fee structure' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ entity_type: 'FeeStructure' }),
    );
  });

  // [15.2.1] the record-type filter's options come from the shared
  // `AUDIT_ENTITY_TYPES` catalog, not a hand-written list here — this
  // asserts every catalog entry actually shows up as an option, so a
  // silent drop (e.g. a typo in the catalog import) would fail this test.
  it('renders one filter option per catalog entity type, plus "All record types"', async () => {
    renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Record type' }));

    const options = await screen.findAllByRole('option');
    // +1 for "All record types".
    expect(options).toHaveLength(AUDIT_ENTITY_TYPES.length + 1);
  });

  // [15.2.1] a log row whose `entity_type` predates this lane's labels (or
  // any value not in the catalog) must still render, with a fallback
  // label, rather than a missing-translation key or a hidden row.
  it('renders a row with an unrecognized entity_type using the fallback label', async () => {
    server.use(
      http.get('/api/v1/audit-logs', () =>
        HttpResponse.json({
          data: [auditEntryFactory({ action: 'LOGIN', entity_type: 'Legacy', entity_id: null })],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderAuditLogs();

    expect(await screen.findByText('Record')).toBeTruthy();
  });

  // [15.2.6] an Enrollment row's diff links its student_id/class_id
  // metadata to the record they name — an id alone isn't actionable for
  // an administrator resolving a dispute.
  it('links an Enrollment row’s student_id and class_id metadata to their records', async () => {
    server.use(
      http.get('/api/v1/audit-logs', () =>
        HttpResponse.json({
          data: [
            auditEntryFactory({
              action: 'CREATE',
              entity_type: 'Enrollment',
              entity_id: 'enrollment-1',
              old_values: null,
              new_values: {
                student_id: 'student-42',
                class_id: 'class-7',
                section_id: 'section-9',
              },
            }),
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    renderAuditLogs();

    const toggle = await screen.findByRole('button', { name: /^Show changes:/ });
    await user.click(toggle);

    const studentLink = await screen.findByRole('link', { name: 'student-42' });
    expect(studentLink.getAttribute('href')).toBe('/students/student-42');

    const classLink = screen.getByRole('link', { name: 'class-7' });
    expect(classLink.getAttribute('href')).toBe('/classes/class-7');

    // `section_id` has no detail route — it renders as plain text, not a link.
    expect(screen.getByText('section-9').closest('a')).toBeNull();
  });

  // Never `toISOString().slice(0, 10)` — that shifts the day for anyone
  // west of UTC. `formatDate` builds the string from local calendar fields.
  it('writes a picked date to the URL as a plain ISO date', async () => {
    captureParams();

    const { router } = renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await pickDate(user, 'From date', '2026-01-01');

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ from_date: '2026-01-01' }),
    );
  });

  // A hand-edited or stale URL must not take the page down, and must not
  // put a value the server's `@IsDateString` would 400 on onto the wire.
  it('drops a malformed date filter from the URL instead of crashing', async () => {
    const seen = captureParams();

    renderAuditLogs({ initialEntries: ['/audit-logs?from_date=not-a-date&to_date=2026-02-30'] });

    await screen.findByRole('region', { name: TABLE_REGION });
    expect(seen.params!.get('from_date')).toBeNull();
    // `2026-02-30` is the right *shape* but not a real calendar date, and
    // the server is no backstop: `@IsDateString` is `isISO8601`, which
    // accepts it, and it then normalizes to `2026-03-02` before filtering.
    // Forwarding it would silently filter by a date nobody chose while the
    // picker sat empty, giving no hint that it had happened.
    expect(seen.params!.get('to_date')).toBeNull();
    expect(screen.getByRole('button', { name: /^To date, / }).textContent).toBe('Pick a date');
  });

  // Same reasoning as the dates: `?action=foo` fails the server's
  // `@IsEnum(AuditAction)` and `?limit=500` its `@Max(100)`. Either would
  // reject the loader's request and replace the page with the router's
  // error fallback, so both are dropped before they reach the wire.
  it('drops out-of-range action and limit params instead of crashing', async () => {
    const seen = captureParams();

    renderAuditLogs({ initialEntries: ['/audit-logs?action=NOT_AN_ACTION&limit=500'] });

    await screen.findByRole('region', { name: TABLE_REGION });
    expect(seen.params!.get('action')).toBeNull();
    expect(seen.params!.get('limit')).toBe('25');
  });

  it('offers every action in the shared enum, including the newest one', async () => {
    captureParams();

    renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Action' }));

    // [8.11.9]'s addition — a hardcoded list in this page would have
    // silently omitted it.
    expect(await screen.findByRole('option', { name: 'Reminder previewed' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Connection tested' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'All actions' })).toBeTruthy();
  });

  it('pages through the trail by asking the server for the next page', async () => {
    const seen = captureParams({
      data: [auditEntryFactory({ action: 'LOGIN' })],
      total: 60,
      page: 1,
      limit: 25,
      totalPages: 3,
    });

    const { router } = renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ page: 2 }));
    await waitFor(() => expect(seen.params!.get('page')).toBe('2'));
  });

  it('expands a row into its field-level diff, keyboard-operable', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    const toggle = await screen.findByRole('button', {
      name: `Show changes: 3 details changed., ${at('2026-01-05T10:30:00.000Z')}`,
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Collapsed: the panel isn't in the DOM, so naming it would point at
    // nothing (`data-table.tsx`'s own conditional `aria-controls`).
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    const user = userEvent.setup();
    toggle.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBe('audit-logs-list-expanded-audit-update');
    expect(document.getElementById(panelId!)).not.toBeNull();
    expect(within(document.getElementById(panelId!)!).getByText('Rahim Uddin')).toBeTruthy();
  });

  it('collapses again on Space, and drops aria-controls with the panel', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    const toggle = await screen.findByRole('button', {
      name: `Show changes: Signed in to the school., ${at('2026-01-02T07:00:00.000Z')}`,
    });

    const user = userEvent.setup();
    toggle.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));

    // An event row still gets a toggle (expansion is table-level in
    // `DataTable`), and its panel explains there was nothing to diff.
    expect(
      screen.getByText('This entry records an event, not an edit, so no field values changed.'),
    ).toBeTruthy();

    await user.keyboard(' ');
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(toggle.getAttribute('aria-controls')).toBeNull();
  });

  // The AC: "Read-only — no mutation affordances anywhere on page." The
  // only interactive controls are the filters, `DataTable`'s pagination,
  // and the per-row expand toggles.
  it('offers no mutation affordance anywhere on the page', async () => {
    server.use(auditLogHandlers.listMixedActions);

    const { container } = renderAuditLogs();

    await screen.findByText('3 details changed.');
    const main = container.querySelector('main');
    expect(main).not.toBeNull();

    // Anchored to the start of the accessible name on purpose: an
    // unanchored /new/i would match the expand toggle whose name quotes
    // the summary "A new fee structure was added."
    const MUTATION_VERB =
      /^(add|new|edit|delete|remove|save|import|export|create|send|generate)\b/i;
    const buttonNames = within(main!)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '');
    expect(buttonNames.filter((name) => MUTATION_VERB.test(name.trim()))).toEqual([]);

    // No row links out to an editable record either — every cell is text.
    const table = within(main!).getByRole('region', { name: TABLE_REGION });
    expect(within(table).queryAllByRole('link')).toHaveLength(0);
  });

  it('renders the empty state without a clear button when no filter is active', async () => {
    server.use(auditLogHandlers.listEmpty);

    renderAuditLogs();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'No activity found' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
    // Nothing was filtered, so the explanation doesn't blame filters.
    expect(screen.getByText('Nothing has been recorded for this school yet.')).toBeTruthy();
    expect(screen.queryByText(/Nothing matches these filters/)).toBeNull();
  });

  it('offers "Clear all filters" on an empty filtered result and clears every filter param', async () => {
    server.use(auditLogHandlers.listEmpty);

    const { router } = renderAuditLogs({
      initialEntries: ['/audit-logs?action=UPDATE&entity_type=Student&from_date=2026-01-01'],
    });

    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 2, name: 'No activity found' });
    expect(screen.getByText(/Nothing matches these filters/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('action');
      expect(router.state.location.search).not.toHaveProperty('entity_type');
      expect(router.state.location.search).not.toHaveProperty('from_date');
    });
  });

  it('puts the read-only note in the subtitle under the h1, and asks for 25 rows', async () => {
    const seen = captureParams();

    renderAuditLogs();

    const heading = await screen.findByRole('heading', { level: 1, name: 'Activity log' });
    expect(
      screen.getByText('Who did what, and when — view only, nothing here can be changed.'),
    ).toBeTruthy();
    expect(heading).toBeTruthy();
    await waitFor(() => expect(seen.params!.get('limit')).toBe('25'));
  });

  it('names the record from entity_label, and shows the type alone when there is none', async () => {
    captureParams({
      data: [
        auditEntryFactory({
          action: 'DELETE',
          entity_type: 'Student',
          entity_id: '3f2a1b4c-1111-2222-3333-444455556666',
          entity_label: 'Rahim Uddin',
        }),
        auditEntryFactory({
          action: 'DELETE',
          entity_type: 'Payment',
          entity_id: '9d8e7f6a-1111-2222-3333-444455556666',
          entity_label: null,
        }),
      ],
      total: 2,
      page: 1,
      limit: 25,
      totalPages: 1,
    });

    const { container } = renderAuditLogs();

    expect(await screen.findByText('Student: Rahim Uddin')).toBeTruthy();
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    // The type alone for the unlabelled row, and no id fragment anywhere.
    expect(within(table!).getByText('Payment')).toBeTruthy();
    expect(table!.textContent).not.toMatch(/[0-9a-f]{8}/);
  });

  // A failed *initial* load is the route loader's failure, not the
  // component's: `ensureQueryData` rejecting hands the match to the
  // router's `CatchBoundary` (`main.tsx`'s `RouteErrorFallback`, [8.9.8]),
  // exactly like every other list route in this app. `DataTable`'s inline
  // `error` message stays wired for a later refetch failure, which the
  // test harness has no way to provoke without a loader round-trip.

  // `GET /audit-logs` is `@Roles(ADMIN)`; AUDIT_LOG_READ is ADMIN-only in
  // `ROLE_PERMISSIONS`, so every other staff role gets the forbidden copy
  // instead of a screen whose every request would 403.
  it.each(['ACCOUNTANT', 'EXECUTIVE', 'TEACHER'])(
    'shows the forbidden state to a %s on direct navigation',
    async (role) => {
      // The server 403s these roles, so the route loader's request fails.
      // TanStack Router runs a matched route's loader regardless of what
      // its parent renders — `_staff.tsx`'s `RequirePermission` is what
      // actually decides this reader never sees the table, one layer up,
      // and it decides before the loader's request even resolves. Serving
      // a 403 here rather than a 200 is still the point of the test: with
      // a success-returning handler it passed even when an unhandled
      // loader rejection would have replaced the designed copy with the
      // router's generic error fallback in production. `errorHandler`
      // (not a hand-rolled body) because only a full `ApiErrorBody`
      // becomes a typed `ApiError` — anything else is a generic `Error`
      // that `shouldRetryQuery` retries twice before giving up.
      server.use(errorHandler('get', '/api/v1/audit-logs', 403, 'Forbidden resource'));

      renderAuditLogs({ role });

      // [8.14.17]: the heading is now `common:accessDenied.title` — every
      // gated staff route's generic default — but this route keeps its
      // own, more specific explanation (`auditLogs:forbidden.explanation`),
      // passed through as `RequirePermission`'s one documented override.
      expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
      expect(
        screen.getByText("Only an administrator can read this school's audit trail."),
      ).toBeTruthy();
      expect(screen.queryByRole('region', { name: TABLE_REGION })).toBeNull();
    },
  );

  it.each(['ACCOUNTANT', 'EXECUTIVE', 'TEACHER'])(
    'hides the Activity log nav item from a %s',
    async (role) => {
      renderAuditLogs({ role });

      await screen.findByRole('navigation', { name: 'Main' });
      expect(
        within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
          name: 'Activity log',
        }),
      ).toBeNull();
    },
  );

  it('shows the Activity log nav item to an ADMIN', async () => {
    server.use(auditLogHandlers.listMixedActions);

    renderAuditLogs();

    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Activity log' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    server.use(auditLogHandlers.listMixedActions);

    const { container } = renderAuditLogs();

    await screen.findByText('3 details changed.');
    await expect(container).toHaveNoViolations();
  });

  // Correction 2: the server param is `performed_by_user_id`, a UUID
  // (`QueryAuditLogDto.performed_by_user_id`, `@IsUUID()`) — the filter
  // must be a picker sourced from `useUsers`, not free text a viewer
  // could type garbage into and get a 400 back.
  it('picking a "Performed by" user writes performed_by_user_id to the URL', async () => {
    const seen = captureParams();
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({
          data: [{ id: 'user-42', full_name: 'Fatema Begum' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    const { router } = renderAuditLogs();

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Performed by' }));
    await user.click(await screen.findByRole('option', { name: 'Fatema Begum' }));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ performed_by_user_id: 'user-42' }),
    );
    await waitFor(() => expect(seen.params!.get('performed_by_user_id')).toBe('user-42'));
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    // The footer (and its page-size select) only exists while there are rows.
    captureParams({ data: [auditEntryFactory()], total: 1, page: 2, limit: 10, totalPages: 1 });

    const { router } = renderAuditLogs({ initialEntries: ['/audit-logs?page=2'] });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: TABLE_REGION });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale.
    await user.click(await screen.findByRole('option', { name: '50' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 50, page: 1 }));
  });
});
