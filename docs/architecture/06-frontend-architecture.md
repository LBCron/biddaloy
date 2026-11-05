# Frontend Architecture

Three frontend packages, one strict rule about how they relate:

```mermaid
flowchart TB
    subgraph "ui/ (@biddaloy/ui)"
        PRIM["primitives/\n(raw Radix wrappers —\nButton, Dialog, Select, ...)"]
        COMP["components/\n(composed, opinionated —\nDataTable, FormField, DatePicker, ...)"]
        SHELL["shells/\n(page-level layout patterns —\nFormShell, ListShell, DetailShell, WizardShell)"]
        HOOKS["hooks/ + api/\n(TanStack Query hooks,\napiClient with token refresh)"]
        I18N["i18n/\n(i18next, lazy namespaces)"]
    end

    APP["client-admin\n(the SPA — staff routes + /portal)"]

    APP -->|"public subpaths only"| COMP
    APP --> SHELL
    APP --> HOOKS

    APP -.->|"BLOCKED by eslint\ncomponent-boundary rule"| PRIM
```

## One SPA, two audiences

There is **one** client package, served at `/`. Staff and guardians are
separated by _route_, not by package ([8.9.10]) — `ROLE_PERMISSIONS[PARENT]`
and `ROLE_PERMISSIONS[STUDENT]` are byte-identical, so a package (or a route
tree) per role would be two copies of the same thing.

```mermaid
flowchart TD
    ROOT["__root.tsx\nauth + tenant/role guard\n(no chrome)"]
    SLASH["/ — index.tsx\nredirect by audience"]
    LOGIN["/login, /select-school\n(chrome-free)"]
    STAFF["_staff.tsx (pathless)\nSTAFF_ROLES guard + AppShell + staff nav"]
    PORTAL["portal.tsx\nGUARDIAN_ROLES guard + lighter shell"]
    SROUTES["/dashboard, /students, /students/:id,\n/fees, /settings, /invoices/:id,\n/attendance, /attendance/:sectionId"]
    PROUTES["/portal, /portal/fees, /portal/attendance"]

    ROOT --> SLASH
    ROOT --> LOGIN
    ROOT --> STAFF
    ROOT --> PORTAL
    SLASH -->|"staff role"| SROUTES
    SLASH -->|"PARENT or STUDENT"| PROUTES
    STAFF --> SROUTES
    PORTAL --> PROUTES
    STAFF -.->|"guardian lands here → /portal"| PORTAL
    PORTAL -.->|"staff lands here → /dashboard"| STAFF
```

Concretely: a PARENT signing in is sent to `/portal`; typing `/students`
redirects them back to `/portal` rather than rendering a page whose every
request returns 403. An ADMIN typing `/portal` is sent to `/dashboard`.
Because `_staff` is a _pathless_ layout, staff URLs are unchanged — only the
dashboard moved, from `/` to `/dashboard`, freeing `/` to be the redirect.

The audience lists live in `shared/src/enums/audiences.ts`
(`STAFF_ROLES`, `GUARDIAN_ROLES`) and both guards are the existing
`ui/src/routes/require-role.tsx`. Client-side gating is a UX nicety: the
server's `RolesGuard`/`ContextGuard` remain the security boundary.

**When does a second client package become right?** When the entry bundle
says so. `client-admin/scripts/check-route-chunks.mjs` gzips the entry
chunk and fails CI above a fixed ceiling (220,000 B today, against 215,380 B
measured), so "split it later if it gets heavy" is a number, not a memory.

## The component boundary rule (enforced, not a convention)

`client-admin` may **only** import from
`@biddaloy/ui`'s published subpaths — never Radix directly, never a deep
`ui/src/...` or `.../primitives/...` path, never a raw `Intl`/
`toLocaleString()` call in place of a shared formatter. This is enforced by
a custom ESLint rule (`ui/eslint-rules/component-boundary.mjs`), registered
only in the client apps' eslint configs — `ui/` itself is exempt, since its
own wrapper components are exactly the code that's supposed to reach into
Radix and primitives.

**Why this matters when you're adding a feature**: if you need a UI piece
that doesn't exist yet in `ui/components/`, build it _there_ and export it
through a public subpath — don't reach past the boundary from a client app,
even for "just this one case." The lint rule will fail CI if you do.

## `ui/` structure

| Folder           | What lives here                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primitives/`    | Thin Radix wrappers (Button, Dialog, Select, Checkbox, Tooltip, Skeleton, …) — the only place allowed to `import { ... } from 'radix-ui'`                                                                                                                                                                                                                                                                           |
| `components/`    | Composed, opinionated components built on primitives — `DataTable` with `RowActions` and `TableCount`, `FilterSheet`, `DatePicker`, `MonthPicker`, `TimeInput`, `Combobox`, `ConfirmDialog`, `AuthLayout`, `StatusBadge`, `EmptyState`, `ErrorState`, `FileUpload`, `Pagination`, `Menu`, `AppShell`, `BottomNav`, `Breadcrumbs`, `CommandPalette`, … (the full list is the `export` list of `components/index.ts`) |
| `shells/`        | Reusable **page-level** layout patterns — the four page shapes `ListShell` (with `FilterBar`), `DetailShell`, `FormShell`, `WizardShell`, plus `PageContainer`, `PageHeader` and `FullPageShell` (the full-page modal). Both client apps build their actual pages by composing these rather than laying out pages from scratch.                                                                                     |
| `hooks/`, `api/` | TanStack Query hooks (e.g. `useCreatePayment`) and the shared `apiClient` — including the access-token-refresh flow described in [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)                                                                                                                                                                                                                         |
| `i18n/`          | i18next setup with per-namespace lazy loading and locale persistence                                                                                                                                                                                                                                                                                                                                                |
| `test/`          | Shared test factories and MSW request handlers, reused by both client apps' test suites                                                                                                                                                                                                                                                                                                                             |

The catalogue of components and the rules for using them (page shapes, dialog
versus full-page modal, formats, wording) is in
[21-ui-patterns.md](21-ui-patterns.md).

Storybook documents every `components/`/`primitives/` entry with stories;
Tailwind design tokens live in `tailwind.preset.ts`, checked for
WCAG contrast compliance by `ui/scripts/check-contrast.mjs` in CI.

## `DataTable`'s two render modes: table and cards

[8.14.7] `DataTable` (`ui/src/components/data-table.tsx`) renders either a
`<table>` or a `<ul>` of `Card`s from the exact same props — same columns,
same selection set, same sorting, same pagination. Nothing above it (not
`ListShell`, not the page) needs to know which mode is active:

```mermaid
flowchart TD
    A["DataTable renders"] --> B{"layout prop"}
    B -- "'table'" --> T["&lt;table&gt; (data-table.tsx)"]
    B -- "'cards'" --> C["&lt;ul&gt; of Cards (data-table-cards.tsx)"]
    B -- "'auto' (default)" --> M["measure own container\n(useContainerWidth + ResizeObserver)"]
    M -- "width &lt; 768px" --> C
    M -- "width &gt;= 768px" --> T
```

**Why the table's own container width, not the viewport.** A
`useMediaQuery`-style check against `window.innerWidth` would get this
wrong for a table sitting inside a narrow detail pane or a dialog on an
otherwise wide screen — that table is narrow regardless of what the
viewport measures. `useContainerWidth` (`ui/src/hooks/
use-container-width.ts`) instead watches `DataTable`'s own root element
with a `ResizeObserver`.

**Why one component picks between two trees in JS, instead of `@container`
CSS hiding one and showing the other.** CSS can only pick between
pre-rendered markup; it can't stop React from mounting a `<table>` that
will never be shown. A hidden `<table>` and a hidden `<ul>` rendered
side-by-side would double the accessible tree (two captions, two sets of
row checkboxes, two live regions) and break every existing table-mode
locator that assumes there is exactly one table. So `DataTable` decides in
JS which single tree to render, not which one to hide.

**Worked example** — a money column that right-aligns in both modes:

```ts
const columns: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name, card: 'title' },
  { id: 'balance', header: 'Balance', accessorFn: (row) => row.balance, align: 'end' },
];
```

`card: 'title'` places a column's value as the card's heading instead of a
`<dl>` field (see `DataTableCardRole` for the other roles — `'subtitle'`,
`'badge'`, `'actions'`, `'hidden'`); `align: 'end'` right-aligns the
column and adds `tabular-nums` in **both** the table's `<td>` and the
card's `<dd>`. Neither prop is required — a column with neither declared
still renders (as a `dl` field, start-aligned), so a page that hasn't been
tuned for cards yet still produces a usable one.

## The financial-mutation guard (enforced, not a convention)

A second custom ESLint rule, `no-optimistic-financial-mutation`
(`ui/eslint-rules/financial-mutation.mjs`), blocks optimistic UI on any
`useMutation` call touching a payment or enrollment endpoint. Reasoning,
straight from the rule's own comment: showing "৳4,500 received" and then
rolling back on error means the UI confirmed a payment that didn't
happen — at a cash counter, with the parent standing there, that's not a
glitch, it's an argument. This is a lint rule specifically so it's caught
every time a mutation is added or edited, not just when someone remembers
to check for it in review.

**If you're building a form that touches money or enrollment status**:
don't add optimistic updates to its mutation. Show a pending state and wait
for the server response.

## Writes are never retried automatically

A write that fails with a 5xx or no reply may still have been saved. Retrying it would
create the record twice, so the app client sets `mutations.retry: false` and tells the user.
Only a request that carries an `Idempotency-Key` may add its own `retry` (D4).

```mermaid
flowchart LR
  A["Write fails<br/>(5xx or no reply)"] --> B["No automatic retry"]
  B --> C["Toast: may have been saved,<br/>check the list"]
```

Reads still retry twice on a 5xx (`shouldRetryQuery`). A guard spec
(`ui/src/hooks/mutation-retry.guard.spec.ts`) fails on `retry: shouldRetryQuery` inside a
`useMutation`.

## The client app

- **`client-admin`** — the whole SPA, both audiences. Staff routes manage
  students/guardians/classes/fee structures/payments, send reminders and
  view audit logs (teachers use these too — no separate `client-teacher`
  app was built, see [00-overview.md](00-overview.md)). Its `/portal`
  routes are the guardian/student self-service side: a placeholder shell
  today, filled in by Epic 5.0 (#187).

One Vite + React 19 SPA consuming `@biddaloy/ui`, built once and served as
static assets at `/` by the NestJS server in production (see
[00-overview.md](00-overview.md) for the system diagram). The package name
is a leftover from when a second client package was planned; renaming it is
its own mechanical change.

## Routing

`client-admin` uses **TanStack Router**, file-based: every file under
`src/routes/` becomes a route, and `@tanstack/router-plugin`'s Vite plugin
generates `src/routeTree.gen.ts` (committed, never hand-edited — same
treatment as `ui/src/api/schema.d.ts`) and code-splits each route into its
own chunk automatically. It was chosen specifically for typed, per-route
search-param validation: a route declares a Zod `validateSearch` schema
with `.catch()` fallbacks, so `?page=abc` degrades to a sensible default
instead of crashing the page — see [`ui/README.md`'s Routing
section](../../ui/README.md) for the hooks and test harness this is built
on.

```mermaid
flowchart TB
    MAIN["main.tsx\nqueryClient = createAppQueryClient()\ncreateRouter({ routeTree, context: { queryClient } })"]
    ROOT["routes/__root.tsx\nbeforeLoad: auth + tenant/role guard [8.9.3]\nroute announcer + notFoundComponent\n(no chrome of its own)"]
    IDX["routes/index.tsx\n/ → /dashboard or /portal"]
    STAFF["routes/_staff.tsx (pathless)\nSTAFF_ROLES guard + AppShell + staff nav"]
    PORTAL["routes/portal.tsx\n/portal — GUARDIAN_ROLES guard + lighter shell"]
    DASH["routes/_staff/dashboard.tsx\n/dashboard"]
    SETTINGS["routes/_staff/settings.tsx\n/settings\n(permission-gated)"]
    STUDENTS["routes/_staff/students/index.tsx\n/students\nvalidateSearch: zod"]
    STUDENT["routes/_staff/students/$studentId.tsx\n/students/$studentId"]
    FEES["routes/_staff/fees.tsx\n/fees"]
    PIDX["routes/portal/index.tsx\n/portal"]
    PFEES["routes/portal/fees.tsx\n/portal/fees"]
    LOGIN["routes/login.tsx\n/login\n(the guard's own redirect target — stub until [8.9.4])"]

    MAIN --> ROOT
    ROOT --> IDX
    ROOT --> LOGIN
    ROOT --> STAFF
    ROOT --> PORTAL
    STAFF --> DASH
    STAFF --> SETTINGS
    STAFF --> STUDENTS
    STAFF --> STUDENT
    STAFF --> FEES
    PORTAL --> PIDX
    PORTAL --> PFEES
```

Every route runs `ROOT`'s `beforeLoad` — `/login` included, which is why
that guard explicitly skips redirecting when already there. See
[02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)'s "Client
session lifecycle" for the full cold-load-vs-mid-session sequence.

**Hover a sidebar link, and its route chunk _and_ its data start loading**
before the click lands — `defaultPreload: 'intent'` on the router, paired
with each route's own `loader` calling
`context.queryClient.ensureQueryData(...)` so the prefetch populates
TanStack Query's cache, not just a separate router-level cache. A route
with no `loader` still gets its JS chunk preloaded on hover; only the data
prefetch needs one.

The router's own `defaultPreloadStaleTime: 0` hands freshness off to Query
entirely: `createAppQueryClient()` (`ui/src/api/query-client.ts`) sets
`staleTime: 30_000`, so a prefetched result that's still within its 30s
window is served straight from Query's cache instead of being silently
re-fetched by the router's separate preload cache. See [`ui/README.md`'s
"The app's query client" section](../../ui/README.md) for the full set of
tuned defaults and why each one is set the way it is.

### Route access: two gates, refuse-in-place

**[8.14.17]:** every staff route now sits behind two client-side gates,
stacked inside `routes/_staff.tsx`, each answering a different question:

```mermaid
flowchart TD
    URL["a staff URL, e.g. /fees/dues"]
    ROLE{"RequireRole\nallow: STAFF_ROLES"}
    PERM{"RequirePermission\npermission: STAFF_ROUTE_PERMISSIONS[routeId]"}
    PORTAL["redirect to /portal\n(wrong app half)"]
    DENIED["AccessDeniedState\nrenders in place\n(right app half, wrong permission)"]
    PAGE["the route's own page"]

    URL --> ROLE
    ROLE -->|"role not in STAFF_ROLES"| PORTAL
    ROLE -->|"role in STAFF_ROLES"| PERM
    PERM -->|"role lacks the permission"| DENIED
    PERM -->|"role holds the permission"| PAGE
```

1. **`RequireRole`** (`ui/src/routes/require-role.tsx`) answers "is this
   the right _app half_" — staff chrome vs. `/portal`. A guardian who
   types `/students` is simply lost, so this one **redirects** (defaults
   to `/`, the same role-aware redirect `routes/index.tsx` uses).
2. **`RequirePermission`** (`ui/src/routes/require-permission.tsx`)
   answers "does this role hold the right _permission_, given it's
   already in the right app half" — e.g. a `TEACHER` on `/fees/dues`,
   which needs `FEE_COLLECT`. This one **refuses in place**: no redirect,
   no `useEffect`, no `navigate` call anywhere in the component. Silently
   bouncing a teacher who typed a URL somewhere unexplained is its own
   bug, not a fix — the whole point is that the refusal explains itself
   on the URL the person actually visited.

`RequirePermission` renders `AccessDeniedState`
(`ui/src/components/access-denied-state.tsx`) — a sibling of
`EmptyState`/`RouteStatusState`, same dashed/flat/`bg-muted` treatment,
`role="status"` because a refusal is not an application fault. It ships
its own i18n copy (`common.json`'s `accessDenied` block) so 27 route
files don't each repeat the same three translated strings; a route with
more specific copy (`/audit-logs`) overrides just the `explanation`.

**The permission-to-route map is one file,** `client-admin/src/
route-permissions.ts`'s `STAFF_ROUTE_PERMISSIONS`, keyed by TanStack
Router's own route ID (not URL path — an index route's ID carries a
trailing slash, e.g. `/_staff/students/`). Its value type is
non-optional: "no permission required" is not an expressible value, so a
route added later without an entry **fails closed** — it refuses
everyone, including admins — rather than rendering to everyone.
`client-admin/src/route-permissions.test.ts` is the drift guard: it
diffs the map's key set against the route tree's actual leaves in both
directions, so a typo'd key (which would otherwise silently mean "no
gate") fails a test instead of shipping.

The full table, one row per staff route:

| Route ID                                  | Permission                |
| ----------------------------------------- | ------------------------- |
| `/_staff/dashboard`                       | `DASHBOARD_VIEW`          |
| `/_staff/students/`                       | `STUDENT_READ`            |
| `/_staff/students/new`                    | `STUDENT_CREATE`          |
| `/_staff/students/import`                 | `STUDENT_BULK_UPLOAD`     |
| `/_staff/students/$studentId`             | `STUDENT_READ`            |
| `/_staff/students/$studentId_/edit`       | `STUDENT_UPDATE`          |
| `/_staff/guardians/`                      | `GUARDIAN_READ`           |
| `/_staff/guardians/$guardianId`           | `GUARDIAN_READ`           |
| `/_staff/staff/`                          | `USER_READ`               |
| `/_staff/staff/$userId`                   | `USER_READ`               |
| `/_staff/fees/`                           | `FEE_STRUCTURE_READ`      |
| `/_staff/fees/dues`                       | `FEE_COLLECT`             |
| `/_staff/fees/generate`                   | `FEE_GENERATE`            |
| `/_staff/fee-structures/`                 | `FEE_STRUCTURE_READ`      |
| `/_staff/invoices/`                       | `INVOICE_READ`            |
| `/_staff/invoices/$invoiceId`             | `INVOICE_READ`            |
| `/_staff/payments/record`                 | `PAYMENT_RECORD`          |
| `/_staff/communications/send`             | `COMMUNICATION_SEND`      |
| `/_staff/communications/reminders`        | `COMMUNICATION_BULK_SEND` |
| `/_staff/communications/batches/`         | `COMMUNICATION_BULK_SEND` |
| `/_staff/communications/batches/$batchId` | `COMMUNICATION_BULK_SEND` |
| `/_staff/academic-years/`                 | `ACADEMIC_YEAR_MANAGE`    |
| `/_staff/academic-years/$academicYearId`  | `ACADEMIC_YEAR_MANAGE`    |
| `/_staff/classes/`                        | `CLASS_MANAGE`            |
| `/_staff/classes/$classId`                | `CLASS_MANAGE`            |
| `/_staff/audit-logs/`                     | `AUDIT_LOG_READ`          |
| `/_staff/settings`                        | `SETTINGS_MANAGE`         |
| `/_staff/attendance/`                     | `ATTENDANCE_READ`         |
| `/_staff/attendance/$sectionId`           | `ATTENDANCE_READ`         |
| `/_staff/attendance/reports`              | `ATTENDANCE_READ`         |
| `/_staff/attendance/register`             | `ATTENDANCE_READ`         |

Each permission is the same one `_staff.tsx`'s sidebar already gates that
route's nav item on — a route and its own nav entry cannot drift apart
about who's allowed in, because they're checked from the same map.

**No route ships a reduced, still-visible read-only view under this
gate.** A role either holds the route's permission and sees the whole
page, or it doesn't and sees `AccessDeniedState` — there is no partial
middle ground (e.g. `EXECUTIVE` seeing `/invoices` read-only). Adding
one would mean _granting_ a new permission in `shared/src/enums/
permissions.ts`'s `ROLE_PERMISSIONS` (e.g. `INVOICE_READ` to
`EXECUTIVE`), which is a product decision this client-only change does
not make — flagged in that file's own comments, not resolved here.

**This closes a UI hole, not a security one.** Both gates are
client-side convenience: the actual security boundary is the server's
`RolesGuard`/`ContextGuard` stack, which already 403s a role the API
doesn't trust. Before [8.14.17], a `TEACHER` who typed `/fees/dues`
directly saw every student's payment balance rendered in the browser —
the _page_ rendered even though every request it made would eventually
fail or (worse, for some endpoints) succeed because the server's
`@Roles` list is broader than `ROLE_PERMISSIONS` for that role. This
ticket stops the client from _showing_ data a role shouldn't see. It does
not stop a script from calling the same API directly and getting the
same over-broad response the server already returns.

[#399](https://github.com/tareq89/biddaloy/issues/399) ([10.4]) closed
that server-side gap: every tenant route now declares
`@RequirePermissions`, and `@Roles` no longer admits a role
`ROLE_PERMISSIONS` doesn't back. See
`server/src/permission-matrix.e2e-spec.ts` for the regression coverage
and the `ROLE_NARROWINGS`/`UI_ONLY_PERMISSIONS` lists it enforces.

### How a guardian moves between their children

A guardian linked to several students switches children by **navigating**,
not by holding state. The chosen child rides in the `?student=` search
param, so every switch is an ordinary URL:

```text
/portal/fees?student=8f3c1e02-4b7a-4d19-9c55-2a1f6b0d77e4
```

That single decision is what makes switching bookmarkable, back-button
friendly, and keyboard-operable and screen-reader-announced without any
extra ARIA wiring — the chips are real links, so an `<a>` is focusable,
activates on Enter, and the active one carries `aria-current="page"`.

```mermaid
flowchart LR
    LAND["/portal<br/>landing — one card per child"]
    FEES["/portal/fees?student=&lt;id&gt;<br/>that child's fee view"]
    PICK["StudentPicker<br/>(@biddaloy/ui)"]
    API["GET /students/mine<br/>the caller's own children"]
    SRV["FamilyAccessService<br/>(server)"]

    LAND -->|"tap a child card<br/>(whole card is the link)"| FEES
    FEES --> PICK
    PICK -->|"switch child<br/>rewrites ?student="| FEES
    FEES --> API
    API --> SRV
    SRV -.->|"re-checks the family link<br/>on every request"| FEES
```

Two rules hold at both ends of that flow:

- **Fewer than two children renders no switcher at all.** `StudentPicker`
  returns `null` below two items, so the rule lives in the component
  rather than in each call site. A guardian of one child sees no chips and
  no chevrons anywhere.
- **`?student=` never widens access.** It is a hint, not an authorization.
  A value the caller cannot see falls back to their first linked student
  rather than erroring (see `feesSearchSchema`), and the server re-checks
  the family link on every request regardless — so hand-editing the URL to
  another family's student id returns that guardian's own data, not
  someone else's.

**404s render inside the shell, not a bare page** — `notFoundComponent` is
set on the _root_ route, so when nothing matches, the root's own
`AppShell` (sidebar, header) still renders around the not-found content,
in the same `<Outlet />` position a matched route's content would occupy.

## Offline reads: two caches, one rule

The admin SPA keeps working when the network drops. Two independent layers
do that, and they answer different questions.

```mermaid
flowchart LR
    Q["queryFn<br/>(TanStack Query)"] --> AX[axios]
    AX --> SW["Service worker<br/>NetworkFirst 'api-cache'"]
    SW -->|"online"| NET[["Server"]]
    SW -->|"offline, cached"| AX
    AX -->|"no response at all"| DX[("Dexie<br/>'biddaloy-offline'")]
    DX --> Q
    NET --> AX
```

|                                                              | Service worker `api-cache`                                       | Dexie `biddaloy-offline`                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| Added by                                                     | [8.12.1]                                                         | [8.12.3]                                                  |
| Caches                                                       | every `GET /api/v1/*`, as raw HTTP responses                     | 4 reference lists, as structured rows                     |
| Knows the data's age?                                        | yes — it stamps `x-sw-cached-at` on every response it stores     | yes — `fetchedAt` per row                                 |
| Works with no service worker (dev, first visit, other SPAs)? | no                                                               | yes                                                       |
| Cap / expiry                                                 | 100 entries, 24h                                                 | 20 rows per tenant+entity, 24h                            |
| Lives in                                                     | `client-admin/src/sw.ts`, `client-admin/src/pwa/cache-policy.ts` | `ui/src/api/offline-db.ts`, `ui/src/api/offline-cache.ts` |

The Dexie layer **complements** the service worker; it does not replace it.

**What is cached: students, classes, class sections, fee structures.** That
list is a closed union (`CacheableEntity`), not a convention — so wrapping a
money query is a compile error.

**What is deliberately never cached: fee dues, invoices, payments.** A
balance that is silently an hour old is how a school takes a payment twice.
If a later issue needs one of these offline, it has to build the "this
figure is N hours old, do not act on it" affordance first.

**Cached data is always labelled.** `CachedDataNotice` renders
`"Showing saved data from 23 hours ago"` above any list served from either
cache, and adds an offline hint when `navigator.onLine` is false. It
renders nothing for fresh data. The age travels beside the query result in
a side channel (`ui/src/api/freshness.ts`) rather than inside it, so no
query's data type or route loader had to change.

**How "is this stale?" is decided.** The service worker stamps every
response it stores with `x-sw-cached-at`, holding `Date.now()` at the
moment it cached it; the presence of that header is what marks a response
as a replay. It is deliberately _not_ decided by comparing the server's
`Date` header against the browser's clock — that compares two different
clocks, so a phone running a couple of minutes fast would label every
fresh response stale and show "showing saved data" permanently to a
fully-online user. Unsynced clocks are routine on the low-end Android this
work targets. Same clock in, same clock out.

**An HTTP error is never answered from cache.** A 401/403/404 means the
server refused the request — often because the caller lost access to that
tenant — so serving the cached copy would render data the server just said
this user may not see. Only a _no-response_ network failure falls back.

### The write path: queue, replay, and telling the user

Reads are only half of it. A write made with no connection is persisted
and replayed later, and the user is told where it stands.

### Mutation learnings (Epic #2642, Wave 4, 2026-10-19)

- **Mutations never retry (#2596).** Retrying a write after a lost reply created the record twice. Only a request with an Idempotency-Key may opt in. Rule candidate: enforced by `ui/src/hooks/mutation-retry.guard.spec.ts` -> no rule. An unknown outcome shows the `outcomeUnknown` toast.
- **`notifyManager` scheduler (#2594, #2622).** `query-client.ts` sets `notifyManager.setScheduler(queueMicrotask)` so a double click does not slip between the click and the pending flag. -> no rule.
- **`networkMode: 'always'` only for the queueing mutation (#2632).** Queries default to `offlineFirst`; the attendance save sets `always` so offline it writes the queue row instead of pausing. -> no rule.
- **A unit test using `navigator.onLine` hid #2632.** The test faked the flag the code never read. Fix: the Playwright PWA spec goes offline for real. -> no rule.

### Why not Background Sync (D1, closes #406)

[11.6]/#406 asked for a **closed-tab** replay: register a Background Sync
event when a mutation is queued offline, so a teacher who closes the app
still gets the row sent once the phone reconnects. Epic 15's D1 decision
(#508) is that this is **unsupported** — the queue keeps replaying only
when a tab is open (on `online`, on login, or "Send now"), same as today.

The reason isn't "hard," it's "the auth model doesn't have a safe answer
for a service worker running with no open tab":

- **The access token is never persisted.** It lives in page memory only
  (`ui/src/api/client.ts`) so a stolen disk/IndexedDB dump can't replay
  requests as the user. A service worker outliving the tab would need a
  token from _somewhere_ — storing one defeats the reason it isn't stored
  today.
- **Refresh tokens rotate.** A worker refreshing concurrently with a
  reopened tab risks tripping reuse detection and logging the user out
  mid-sync.
- **Queued rows carry a tenant ID but no role.** Role is resolved from the
  live session, not persisted per-row — a worker replaying with no session
  has no role to authorize the write under.
- **Logout, session expiry, tenant switch and suspension all revoke
  access by tearing down page state.** None of that reaches a worker
  replaying after the tab is gone.

The #406 checklist, answered:

| #406 asked for                                              | Answer                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Auth without persisting a reusable bearer token             | No such mechanism exists here — see above                                                     |
| Refresh-token rotation coordinated with an open tab         | Not attempted; closed-tab means no tab to coordinate with                                     |
| Tenant/role context authenticated per queued row            | Rows don't carry role; can't be authorized headless                                           |
| Logout/session-expiry/tenant-switch/suspension block replay | They already do, by removing page state a worker never had                                    |
| Cross-context lock                                          | No service-worker/page lock; each open tab can replay                                         |
| Mutation idempotency                                        | Required per queued mutation; attendance uses `client_request_id` to collapse replayed writes |
| Behaviour when the platform declines to run a sync event    | N/A — never registered                                                                        |

**What stays true:** every rule in the flow below (ordering, money never
queued, 401 pauses rather than strikes) is exactly what #406 asked
Background Sync to preserve. It's preserved — just by never handing
replay to a context that can't meet the auth bar, not by a service-worker
implementation of it.

```mermaid
flowchart TD
    W["a write, made offline"] --> Q[("Dexie 'mutationQueue'<br/>++seq = submission order")]
    ONLINE(["browser goes online<br/>· or login · or 'Send now'"]) --> R{replay,<br/>oldest first}
    Q --> R
    R -->|2xx| DONE["row deleted"]
    R -->|"409 / 412"| C["status: conflict<br/>a human decides"]
    R -->|"5 strikes"| D["status: dead"]
    R -->|"no response"| Q
    R -->|"401 / 403"| Q
    C --> STOP["everything behind it waits"]
    D --> STOP
```

**Ordering is the point.** Replay walks ascending `seq` and stops at the
first row it cannot clear. Queued writes commonly touch the same record —
correcting a mark you just made — so letting later rows overtake a blocked
one applies edits out of order against server state nobody reconciled.
`SyncStatus` explains the block rather than working around it.

**Money is never queued.** `QueueableEntity` is a closed union, so
`entity: 'payments'` does not compile; a second, case-insensitive path
guard catches strings built at runtime, which the union cannot see. A
queued payment replayed hours later — after the parent walked out with a
receipt — is unrecoverable.

**A 401 during replay is not a strike and never ends the session.** A token
routinely expires while a tab sits offline, so the first replayed row would
otherwise trigger the refresh-then-logout path, and logout deletes the whole
database. Replay opts out of that branch: it stops, changes nothing, and
waits for the user to re-authenticate.

| State the user sees              | Means                                        |
| -------------------------------- | -------------------------------------------- |
| _(nothing)_                      | online, queue empty and readable             |
| "N changes waiting to send"      | queued, will go on their own                 |
| "Some changes need attention"    | a conflict or dead row is blocking the queue |
| "Can't check for unsent changes" | the queue could not be read — **not** zero   |

That last row is the one worth guarding: "you have nothing unsynced" and
"I cannot tell whether you have anything unsynced" must never look the same
to someone deciding whether it is safe to close the tab.

**`enqueueMutation` now has a real consumer.** [8.12.4] shipped the engine
and [8.12.5] the indicator queue-less; [9.6] is the first feature to
actually call `enqueueMutation` — the teacher marking screen
(`/attendance/$sectionId`) queues a `PUT .../register` write when
`useOnline()` reports offline, instead of the client-admin app that was
speculated here before attendance shipped. `startQueueReplay()`'s wiring
in `client-admin/src/main.tsx` predates this by two tickets and needed no
change — it was already generic over `QueueableEntity`, attendance's
`'attendance'` member included.

### Tenant isolation

Same rule as everywhere else in SchoolManager, with two independent mechanisms
because one silent failure shows one school's students under another
school's name:

1. **Structural.** Every Dexie row's primary key starts with its tenant id,
   and every read filters on the _currently active_ tenant. A cross-tenant
   hit is impossible even if every purge below failed.
2. **Purge.** `setActiveTenant` (a real switch) drops the leaving tenant's
   rows; `clearAuthState` (logout, session expiry, failed refresh) deletes
   the whole database. These are the same two funnels that already clear
   the service-worker cache.

Both funnels also clear the freshness map and — as of [8.12.3] — every
autosaved form draft. Draft storage keys are tenant-scoped too
(`form-shell-draft:<tenantId>:<formKey>`); before that, an administrator of
two schools was offered school A's abandoned draft while working in
school B.

## The registry family — one list per "does every X have a Y"

A handful of files each answer one "did we forget one" question — every
route has a manifest entry, every route has a permission, every route is
reachable from the nav tree — and each is paired with a test that fails
the build the moment the list and reality drift apart. See
[15-ux-principles.md §2](15-ux-principles.md) for the full guard table
(one row per registry, with the exact "guard today" file and what it
checks); this section is the shape they all share.

```mermaid
flowchart LR
    R[Router route tree<br/>routeTree.gen.ts] --> M[route-manifest.json]
    R --> P[route-permissions.ts]
    R --> N[nav-tree.ts]
    R --> C[route-crumbs.ts]
    M --> GM[route-manifest.test.ts]
    P --> GP[route-permissions.test.ts]
    N --> GN[nav-tree.test.ts]
    C --> GC[route-crumbs.test.ts]
    GM -->|diff fails| CI[CI red]
    GP -->|diff fails| CI
    GN -->|diff fails| CI
    GC -->|diff fails| CI
    A[action-registry.ts + unregistered-actions.ts] --> GA["action-registry.test.ts<br/>every dialog file registered or allow-listed"]
    GA -->|dialog file in no list| CI
    X["ux-guards.mjs<br/>(ESLint)"] -->|"runs in ci.yml, pre-commit, pre-push"| CI
```

Every route-keyed registry's _test_ lives beside the router
(`client-admin/src/`), not inside `ui/` — the router itself is
`client-admin`-owned, so a check keyed by route ID has to live where the
route IDs are real, not in the route-agnostic `ui/` package. Two rows
below aren't route-keyed at all: `route-manifest.json` itself lives in
`e2e/` (it's shared with the Playwright suites), and the workbook tab
registry is server-side — it guards TypeORM entities, not client routes.

| Registry file                                                                                                                | Guards                                                                                                                                                                                                                                                                                                                 | What a failure looks like                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route-manifest.json` (`e2e/`) + `route-manifest.test.ts`                                                                    | Every router route has a manifest entry for the a11y/responsive suites                                                                                                                                                                                                                                                 | `route-manifest.test.ts` fails: the two sorted path lists aren't equal, so Vitest prints its own array diff (the assertion has no custom message)                                                                                                                                                                                                                                       |
| `route-permissions.ts` (`STAFF_ROUTE_PERMISSIONS`) + `route-permissions.test.ts`                                             | Every staff route has an explicit permission (fails closed, not open)                                                                                                                                                                                                                                                  | `route-permissions.test.ts` fails: `route(s) missing a STAFF_ROUTE_PERMISSIONS entry: /_staff/attendance/reports`                                                                                                                                                                                                                                                                       |
| `nav-not-in-nav.ts` + `nav-tree.test.ts`                                                                                     | Every route is either in the nav tree or on the explicit `NOT_IN_NAV` allowlist                                                                                                                                                                                                                                        | `nav-tree.test.ts` fails: `leaf route(s) with no sidebar home and no NOT_IN_NAV reason: /_staff/reports/new`                                                                                                                                                                                                                                                                            |
| `route-crumbs.ts` + `route-crumbs.test.ts`                                                                                   | Every route has a breadcrumb label                                                                                                                                                                                                                                                                                     | `route-crumbs.test.ts` fails: `route(s) missing ROUTE_CRUMBS entry: /_staff/reports/new`                                                                                                                                                                                                                                                                                                |
| `action-registry.ts` (`ACTIONS`) + `unregistered-actions.ts` (`PALETTE_ALLOW_LIST`, `UNREGISTERED_ACTIONS`)                  | Every `Ctrl+K` palette action has a real `run()`, a permission that matches `STAFF_ROUTE_PERMISSIONS` (or a listed stricter exception) and a unique id. **Every dialog file under `client-admin/src/routes` is in exactly one list:** registered in `ACTIONS`, allow-listed with a reason, or deferred to an open epic | `action-registry.test.ts` fails: `Dialog file(s) with no palette decision: client-admin/src/routes/_staff/x/-new-dialog.tsx. Fix: (1) register an action in ACTIONS and add its id to REGISTERED_ACTION_FILES, (2) add it to PALETTE_ALLOW_LIST with a reason, or (3) add it to UNREGISTERED_ACTIONS with an owning epic.` A stale deferred entry fails `unregistered-actions.test.ts`. |
| `ui/eslint-rules/ux-guards.mjs` (rules `no-native-picker`, `no-raw-date-display`, `no-page-max-width`, `row-actions-column`) | UI source files follow four mechanical UX rules; files that still break one are in the `ignores` of `ui/eslint.config.mjs` / `client-admin/eslint.config.mjs`, with a comment each                                                                                                                                     | `yarn lint` fails with the rule's message, e.g. ``Native `<select>` is banned (D25) — use `Select`/`Combobox`, or `DatePicker`/`MonthPicker`/`TimeInput` from `@biddaloy/ui/components`.``                                                                                                                                                                                              |
| Workbook tab registry (`server/src/modules/workbook/codec/registry.ts`) + `registry.completeness.spec.ts`                    | Every TypeORM entity is exported/restored by a workbook tab, or is explicitly allow-listed in `entity-coverage.ts` with a reason                                                                                                                                                                                       | `registry.completeness.spec.ts` fails: `Entity "NewFeatureLog" has no workbook tab and no entry in ENTITY_COVERAGE_EXEMPT.` (a hypothetical new entity added without a tab or an exemption — `PushSubscription` itself is already listed in `entity-coverage.ts` as an exempt, regenerable credential, so it never trips this check)                                                    |

**What's deliberately out of scope here, and where it lives instead:**
the palette's _search results_ — which people/pages an action can find —
are server-side and tenant-scoped (a comment in the action registry marks
this as Epic 33.0's branch-filtering seam for `search.service.ts`), not
part of any registry above. Likewise a tenant renaming "Section" to
"Batch" (Epic 35.0's label overrides) changes what a route's nav label
_says_, not whether it's registered.

## Marks-sheet import hooks (Epic 81)

Three hooks in `ui/src/hooks/exams.ts` wrap the three sheet routes. A screen
only calls them; it never builds a request.

```mermaid
flowchart LR
  A[useDownloadMarksSheet] -->|saves .xlsx| B[teacher fills it]
  B --> C[useValidateMarksSheet]
  C -->|PreviewResult: errors + counts + changes| D{errors?}
  D -- no --> E[useCommitMarksSheet]
  E -->|Idempotency-Key, retry false| F[grid + progress refetch]
```

- `useValidateMarksSheet` returns the shared `PreviewResult`, so
  `BulkUploadPreview` can show it. The server sends row errors as codes, never
  prose; the screen translates each code from `marksImport.errors.<CODE>`.
  When any row has an error the server stages nothing and `staging_id` is `''`.
- `useCommitMarksSheet` follows Rule 25: `retry: false`, one `Idempotency-Key`
  per attempt (`useIdempotencyKey`), rotated on success.
- Strings: `marksImport` namespace (en + bn) and `exams.marksSheet.*` for the
  two buttons.

## Testing

Vitest for unit/component tests (colocated `*.test.tsx`), Playwright for
end-to-end flows, MSW for mocking the API in both. Shared test factories
and handlers live in `ui/src/test/` so admin and student test suites build
fixtures the same way. See `ui/CONTRIBUTING.md` and `ui/README.md` for the
exact commands and CI gates.
