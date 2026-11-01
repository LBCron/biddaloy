# UX Principles — placement, navigation, keyboard, and "no silent gaps"

Decided 2026-09-17 while planning the academics epics (19.0–29.0) from the
reference-ERP analysis. This doc is the **interaction** contract; the
**visual** contract (type, colour, elevation, motion, focus vocabulary,
table→card grammar) stays in [09-design-direction.md](09-design-direction.md);
the **pattern** contract (which component, page shape, container, format and
wording a screen uses) is [21-ui-patterns.md](21-ui-patterns.md).
Read all three before planning any screen.

## 1. The rules in one screen

| #   | Rule                                            | What it means in practice                                                                                                                                                                                                 |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | **Every feature has one natural place.**        | Each screen is placed in the nav tree below (§3). Sub-features nest under their parent; nothing new is a top-level item unless a user job needs it. Every epic states _where each screen lives_ against this tree.        |
| U2  | **No silent gaps.**                             | Every registry that enumerates screens, entities or actions has a guard that **fails CI** when a new thing isn't registered (§2). A new screen may be wrong; it can never be _unchecked_.                                 |
| U3  | **Keyboard and accessibility are first-class.** | Every screen is fully keyboard-operable; the axe gate stays blocking; every nav group has one keyboard-journey spec and a new screen adds a test to its group's spec; a manual screen-reader pass closes every epic (§6). |
| U4  | **One palette, `Ctrl/Cmd+K`.**                  | Three tabs — _People · Page · Action_ — switchable by keyboard. Actions come from a registry, not from ad-hoc buttons (§4).                                                                                               |
| U5  | **Breadcrumbs mirror the URL.**                 | Derived from the route tree, entity names when loaded (a skeleton bar, never an id, while loading), clickable, shown only from 2 levels, identical on every screen (§5).                                                  |
| U6  | **Nothing new is unrecoverable.**               | Any epic that adds an entity ships its workbook tab (export + restore + round-trip test) and seed coverage in its wave-close ticket (§7).                                                                                 |
| U7  | **Reuse the shell, reuse the form.**            | New screens use `ui/src/shells/*` (list / detail / form / wizard). A palette action that opens a modal renders the _same_ form component as the page — never a second copy.                                               |

## 2. No silent gaps — the registries and their guards

SchoolManager already has several lists that enumerate "everything". The
problem is that most of them are hand-maintained: adding a route to the
router without adding it to the manifest silently drops that screen out of
the a11y gate. The fix is one guard per registry.

```mermaid
flowchart LR
  R[Router: client-admin route tree] -->|must contain every route in| M[e2e/route-manifest.json]
  M --> A[axe gate<br/>routes.a11y.spec.ts]
  M --> RS[responsive gates<br/>reflow / target-size]
  E[TypeORM entities<br/>server/test/all-entities.ts] -->|every entity has a tab or is allow-listed| W[workbook tab registry<br/>workbook/codec/registry.ts]
  T[Nav tree<br/>this doc §3] -->|every route has a home| N[navGroups / navItems]
  P[Palette action registry] -->|every action declares permission, kind, prefill| K[Ctrl+K › Action]
  I[i18n keys en/bn] -->|no missing key on any route| L[locale completeness]
  U[UI source files] -->|no native picker, raw date, page max-width, bare actions column| X[ESLint ux-guards<br/>ui/eslint-rules/ux-guards.mjs]
  D[Dialog files under client-admin/src/routes] -->|registered, allow-listed or deferred| P2[action-registry.test.ts]
```

| Registry                                                                                    | Enumerates                                                                                               | Guard today                                                                                                                                                                                                                                                                                                                                                                       | Guard required                                                                                                      | Owner             |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `e2e/route-manifest.json`                                                                   | Routes + overlays for the a11y and responsive suites                                                     | `client-admin/src/route-manifest.test.ts` — bidirectional diff between the manifest and the router's own route tree                                                                                                                                                                                                                                                               | fails on any route missing from the manifest, or any manifest entry with no matching route                          | Epic 30.0         |
| `client-admin/src/route-permissions.ts` (`STAFF_ROUTE_PERMISSIONS`)                         | Which permission gates each staff route                                                                  | `client-admin/src/route-permissions.test.ts` — bidirectional diff between the map's keys and the router's route tree                                                                                                                                                                                                                                                              | fails closed: a route with no entry is refused to everyone, and the test still flags it so it's caught before merge | Epic 30.0         |
| Workbook tab registry (`server/src/modules/workbook/codec/registry.ts`)                     | Which entities export/restore                                                                            | `registry.completeness.spec.ts` checks every entity in `ALL_ENTITIES` has a tab or sits in `entity-coverage.ts`'s explicit allowlist, with a reason                                                                                                                                                                                                                               | entity-level check: same as today                                                                                   | Epic 30.0         |
| Nav tree (§3) → `navGroups`/`navItems`                                                      | Where every screen lives                                                                                 | `client-admin/src/nav-tree.test.ts` + `nav-not-in-nav.ts` — every route is either in the nav tree or on the explicit `NOT_IN_NAV` allowlist (auth pages, framework plumbing)                                                                                                                                                                                                      | fails if a route is reachable but appears in neither list                                                           | Epic 30.0         |
| Palette action registry (`client-admin/src/action-registry.ts` + `unregistered-actions.ts`) | Every user-invocable palette action, and every dialog file under `client-admin/src/routes`               | `action-registry.test.ts`: every `ACTIONS` entry has a `run()`, a permission matching `STAFF_ROUTE_PERMISSIONS` (or a listed stricter exception) and a unique id; **every dialog file is in exactly one of three lists** (below); the page a `?flag=1` action lands on declares that flag. `unregistered-actions.test.ts` checks each deferred file exists and names an open epic | the three lists below                                                                                               | Epic 30.4, 31.5.1 |
| i18n locale files (`en`/`bn`)                                                               | Every user-visible string                                                                                | `ui/scripts/check-i18n-keys.mjs`, blocking in CI ("UI missing-translation-key check", `.github/workflows/ci.yml:220`)                                                                                                                                                                                                                                                             | fails on a key present in one locale but not the other, or a `t()` call with no matching key in either locale       | Epic 8.7          |
| Route breadcrumbs (`client-admin/src/route-crumbs.ts`)                                      | Breadcrumb label per route                                                                               | `client-admin/src/route-crumbs.test.ts` — same bidirectional-diff shape as the two guards above                                                                                                                                                                                                                                                                                   | fails if a route has no crumb entry, or an entry points at a route that no longer exists                            | Epic 30.0         |
| UX lint guards (D37)                                                                        | Four mechanical UX rules on UI source                                                                    | `ui/eslint-rules/ux-guards.mjs` — `no-native-picker`, `no-raw-date-display`, `no-page-max-width`, `row-actions-column`; the allow-list is each config block's `ignores` (`ui/eslint.config.mjs`, `client-admin/eslint.config.mjs`), one comment per entry; runs in CI lint (`yarn lint`), in pre-commit (`lint-staged`) and in pre-push (`yarn run check --affected`)             | a new violation fails lint; an entry leaves the allow-list only when its file is fixed                              | Epic 31.5.3       |
| UI pattern contract                                                                         | Which component, page shape, format and wording a screen uses                                            | [21-ui-patterns.md](21-ui-patterns.md) (the contract) and its "Known gaps" section                                                                                                                                                                                                                                                                                                | reviewed per ticket; the lint guards above enforce part of it                                                       | Epic 31.0         |
| Seed data                                                                                   | Demo rows for every entity ([22-demo-seed.md](22-demo-seed.md)); the dev seed covers only what e2e needs | `demo-seed.coverage.integration.spec.ts` (Epic 58, #2161): every `ALL_ENTITIES` entity is covered by one slice with rows, or `DEMO_SEED_EXEMPT` with a reason                                                                                                                                                                                                                     | fails on an uncovered or empty entity, a stale exemption, or `ALL_ENTITIES` drift                                   | Epic 58.0         |

**The three palette lists** (every dialog file under `client-admin/src/routes` that holds `<Dialog`, `DialogContent`, `<Sheet`, `SheetContent` or `<FullPageShell` must be in exactly one):

```mermaid
flowchart LR
  F["A dialog file in routes/"] --> Q{"Is it in the palette?"}
  Q -->|"yes"| A["ACTIONS<br/>(registered: run() + permission;<br/>its file is in REGISTERED_ACTION_FILES)"]
  Q -->|"no, on purpose"| W["PALETTE_ALLOW_LIST<br/>(one reason each)"]
  Q -->|"no, not yet"| U["UNREGISTERED_ACTIONS<br/>(owed by an open epic; empty today)"]
```

If a file is in none of them, `action-registry.test.ts` fails with: `Dialog file(s) with no palette decision: client-admin/src/routes/_staff/x/-new-dialog.tsx. Fix: (1) register an action in ACTIONS and add its id to REGISTERED_ACTION_FILES, (2) add it to PALETTE_ALLOW_LIST with a reason, or (3) add it to UNREGISTERED_ACTIONS with an owning epic.`

Concrete example of the rule applied: Epic 21.0 adds `/routines/class`.
The wave-close ticket must (a) add it to the route manifest, (b) add it to
the nav tree under _Academics › Timetable & routines_, (c) register
"Open my routine" as a palette action, (d) add `en`/`bn` keys, (e) add a
workbook tab for `routine_slots`. Any of those missing fails CI, not code
review.

## 3. Navigation tree

Built from a full inventory (672 rows: the reference ERP's nav, its
permission catalogue of 169 controllers, the analysis report's 136
features, every existing SchoolManager route, every open epic). 657 rows placed,
15 deliberately excluded (vendor quiz game, application-menu registry,
mobile-app CMS pages, framework plumbing), 0 unplaced. Owners in brackets:
`have` exists today · `partial` exists but thinner than the reference ·
`19.0` etc. = open epic · `N2` etc. = new-epic candidate from the report.

Roles: **A** admin · **Ac** accountant · **E** executive · **T** teacher ·
**G** guardian · **S** student · **P** platform (super-admin).

### 3.1 Staff tree

```text
Dashboard [have]                                                    A Ac E T
Applications [52.0] — top level, pending-count badge                A Ac E T (+ office, exam controller)
  New application · Application detail

People
  Students [have]                                                   A Ac E T
    New student · Import from Excel                                 A E
    Student detail — tabs today: Overview, Enrollment, Guardians, Attendance, Fees, Invoices, Payments, Communication, Activity
      + Results [19.0] · Homework [22.0] · Programs & milestones [34.0] · Notes [N11] · Records [N11]
      + Performance [28.0, have — MARK_VIEW]
      + Subjects (optional/4th) [19.0] · Fines [N8] · Documents [have, 32.0]
      + Applications [52.0, APPLICATION_MANAGE]
  Guardians [have] → detail: Information, Linked students, Payments, Communication
  Staff [partial] — ONE register (teachers, employees, administration, principal/VP as designations)
    Import from Excel [13.0, /staff/import]                         A
    "Former" filter [13.0] — people who left or were removed        A
    Staff detail — tabs today: Profile, Memberships, Permissions, Login history, Invitation
      + HR record [23.0] · Teaching assignments [29.0+23.0] · Attendance & leave [N5]
      + ACR · Incidents · Performance [28.0, have — ACR_READ, admin only]
      + Documents [have, 32.0] · Website profile [N13]
      + Applications [52.0, APPLICATION_MANAGE]
    Teaching assignments (bulk view) [29.0+23.0]                    A E
    Evaluations [28.0, have] — tabs ACR · Surveys · Incidents         A
      Survey detail (results sealed until closed)
  Admissions [27.0] · Admission reports [27.0+N11]                  A E
  Programs & milestones [34.0]                                      A E T

Academics
  Academic years & terms [have, 17.0 adds terms]                    A E
  Calendar [17.0] · Holidays [have API, 17.0 UI]                    A Ac E T
  Classes & sections [have] · Groups/streams [have, 33.0] · Classrooms [21.0]
  Subjects [partial → own page; flags: order, unit, effect, merge-with, grade-subject]
  Timetable & routines [21.0]  ("Routines")                         A Ac E T
    Class routine · Auto-generate · Routine setup · Substitutions · Exam routine · My routine (T)
  My class [47.0]  T  — the section(s) where the teacher is class teacher or assistant (`MY_CLASS_VIEW`)
  Homework [22.0] · Defaulters · Homework report                    A E T
  Syllabus [22.0]                                                   A E T
  Online learning [N6] · Online classes · Online exams              A E T

Attendance
  Students [have] · Monthly grid [have] · Upload device file [partial] · Period/subject-wise [have]
  Staff [N5] · Leave (balance only; requests → Applications)        A E (Ac)
  Reports [have] · Yearly summary [partial] · Defaulters [have] · Submission check-list [have]
  Printable register [have] · Sheet layout [Print module — follow-up epic]

Exams & Results
  Exams [19.0]                                                      A E T
  Exam setup [19.0] · Types & heads · Marks distribution · Report-card templates
  Marks entry [19.0+29.0] · Marks view [19.0] · Grading scales [20.0]
  Results [19.0] · Result by student ID
  Analysis [have] · Merit list · Defaulted list · Pass/fail (+ by component)
  Promotion [have] · Draft run · Grid override · Commit                   A E
  Segregation [26.0, not yet shipped]
  Seat plans [25.0] · Exam printables [48.0] — Exams › exam › Print tab

Finance
  Fees · Student dues · Fee structures · Generate fees · Payments (+ Student statement [8.15]) · Record payment · Invoices   [all have]
  Fines · Fine rules [38.0]
  Online payments [3.0] · Unmatched receipts [16.0]                 A Ac

Communications
  Send message [have] (+ to staff, role-wise [partial])             A E T
  Send an alert [67.0] — one-off bar alert to a chosen audience      A E
  Fee reminders [have] · Reminder history [have]                    A Ac (+ office)
  Message log [have] (97.0) — every message sent, Check status      A Ac (+ office)
  Notices [have]                                                    A E T
  Automatic notices [partial: absent ✓ · fine ✓ (38.0) · result/marks 19.0 · homework 22.0 · receipt 3.0]

Reports [8.15] — a hub that LINKS to screens that live with their data; no copies
  Communications · Collections [have] · Student dues [have] · Attendance [have]
  Student lists [8.15] · Student count [8.15] · Printables & documents [have, 32.0] · Certificate register · To print [48.0] · Exports [8.15]
  Applications report [52.0]
  Alerts report [67.0] — monthly rule-alert counts per rule and section   A E

Administration
  Print templates [have, 32.0] — library, then the full-screen editor
  Settings [have] → sub-pages:
    Attendance policy & times [have] · Communication providers [have] · Alerts & reminders [67.0]
    Printers [have, 32.0] (calibration, margins) · School profile & logo [have] · Region & locale [17.0] · Presets & feature toggles [N3]
    Organisation structure [have, 33.0 — Settings section, no new route; a
    shift/version/group field only shows once the tenant has 2+ entries in
    it] · Result templates library [19.0] · Backup & restore [have] · Website sync [N13]
  (Users merged into People › Staff — Epic 24.0; "Add user" is a dialog there)
  Roles & access [have, 24.0 — read-only] · Audit logs [have] · Security [have]

User menu → My account (profile, password, switch school/role, language, theme, sign out)
  My account / Security → Notification preferences [67.0] (mute push per category, quiet hours shown)
```

### 3.2 Guardian / student portal tree

```text
Overview [have]
Fees & invoices [have] · Pay online [3.0] · Statement [8.15] · Fines [38.0]
Attendance [have]
Results [19.0] · Homework [have] · Syllabus [22.0] · Routine [21.0]
Calendar & notices [17.0; notices have]
Online exam & class [N6] · Programs [34.0] · Documents [Print module — follow-up epic]
Applications [52.0] — under More on a phone
Account [have] — includes Notification preferences [67.0]
```

### 3.3 Platform (super-admin) tree

```text
Schools [have] · Public holiday sets [17.0] · Preset library [N3]
  Schools list: Trial column, ?trial filter · Engine health card [67.0] · School detail: Trial card + "Extend trial" [13.0]
```

Not in the nav on purpose (reached by a redirect, a link or a button):
`/welcome` (the setup wizard, opens once for an admin of an unfinished school),
`/register`, `/auth/social/done`, `/notifications` (from the bell and the modal footer) and `/portal/notifications` (from the portal bell). (`/staff/import` is in the nav, under
People, as shown above.)
The setup checklist is a card on the Dashboard. The attention bar sits under the
top bar on every shell; the trial warning is one of its rules (`trial.ending`).
See [34-onboarding.md](34-onboarding.md) and [23-attention.md](23-attention.md).

### 3.4 Placement decisions (final)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Academic years & terms live under **Academics**, next to Calendar.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P2  | Staff is **one register** with a staff-type filter and designations — not five registers.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P3  | Subjects get their **own page** under Academics; the class detail keeps a per-class offering tab.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P4  | Exam setup (types/heads/sub-heads, marks distribution, report-card templates) lives under **Exams & Results**, not Settings.                                                                                                                                                                                                                                                                                                                                                                                            |
| P5  | Reports is a **hub of links**; a report lives once, where its data lives.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P6  | Notices live under **Communications**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P7  | Fines live under **Finance › Fines** (list + Rules tab); money reuses Finance › Payments. Replaced the Attendance placement in Epic 38 because fines are generic, not attendance-only.                                                                                                                                                                                                                                                                                                                                  |
| P8  | Online learning is **one item** so a tenant toggle (N3) can hide it whole.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P9  | Teaching assignments bulk view lives under **People › Staff**; also a tab on staff detail and class detail.                                                                                                                                                                                                                                                                                                                                                                                                             |
| P10 | **Resolved (Epic 24.0):** Users merged into **People › Staff**. "Add user" is a dialog (`client-admin/src/routes/_staff/staff/-add-user-dialog.tsx`); there is no `administration.users` item.                                                                                                                                                                                                                                                                                                                          |
| P11 | Coaching centres reuse Class/Section, relabelled Course/Batch via tenant label overrides — not Programs. Programs are supplementary tracks (hifz, trades, labs, attachment).                                                                                                                                                                                                                                                                                                                                            |
| P12 | **My class** (Epic 47.0) lives under **Academics**, next to My routine. TEACHER only (`MY_CLASS_VIEW`). Routes `/my-class` and `/my-class/$sectionId`; palette actions `my-class.open` and `my-class.take-attendance` (`/my-class?then=attendance`). One section redirects straight to its page. A teacher with no class-teacher or assistant section sees "You are not a class teacher of any section yet — ask an admin." A section card shows a role badge (class teacher or assistant). Current academic year only. |
| P13 | **Applications** is a top-level staff item (like Dashboard) because every staff role both files and decides; its report also sits in the Reports hub (P5). Portal item "আবেদন" sits under More.                                                                                                                                                                                                                                                                                                                         |

## 4. Command palette — `Ctrl/Cmd+K`

One component, three tabs. Each tab is a mode; the shortcut opens the
palette on _People_; `←`/`→` move between tabs, `Ctrl+1`/`Ctrl+2`/`Ctrl+3`
jump directly to People/Page/Action, and typing a prefix jumps to a mode
as a shortcut (`/` Page, `>` Action). **`Tab` deliberately keeps its native
browser meaning** rather than switching tabs — the palette's search input
is a `role="combobox"` that must keep focus for the whole interaction, and
binding `Tab` inside it would break the browser's own focus-trap-escape
that keyboard users rely on (`ui/src/components/command-palette.tsx`'s own
comment block spells this out). It is the whole palette:
`CommandPaletteLauncher` (`client-admin/src/components/command-palette-launcher.tsx`)
opens it from the top bar, and the old `global-search` files no longer exist.

```mermaid
sequenceDiagram
  participant U as User
  participant K as Palette (Ctrl+K)
  participant S as Server search (permission-filtered)
  participant R as Action registry
  U->>K: Ctrl+K, types "0171"
  K->>S: people?q=0171 (students, guardians, staff — capped per type)
  S-->>K: guardian "Rahima Begum" → 2 linked students
  U->>K: → (switch to Action), types "pay"
  K->>R: match "Record payment" (kind: modal, prefill: student from context)
  R-->>U: opens the SAME payment form as /payments/record, student preselected
```

| Tab        | Matches on                                                                                                | Empty query shows                                                                                                                                                                 | Result row                                                |
| ---------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **People** | name en/bn, student/employee ID, roll, class/section, **phone (a guardian's phone finds their students)** | recently opened records                                                                                                                                                           | type chip · name · secondary line (class/section or role) |
| **Page**   | nav tree labels en/bn, route paths, synonyms ("routine" → Timetable & routines)                           | every permitted page, grouped by sidebar section in sidebar order (Dashboard first, no header); **Recent** (last 5) on top                                                        | group › item breadcrumb                                   |
| **Action** | action labels en/bn, synonyms                                                                             | every permitted action, grouped by the same sections; actions whose context is missing are shown disabled with a reason, at the bottom of their group; **Recent** (last 5) on top | label · kind icon · shortcut hint                         |

The results area has one fixed height (`min(60dvh, 28rem)`) in every state, so
the dialog never jumps. Row 1 is always highlighted, so Enter opens what you
see. ↑/↓ wrap around and scroll the highlighted row into view. Hover only moves
the highlight on real mouse movement, so it never fights the keyboard. The
matched text is bold, and a footer bar lists the shortcuts.

**Action registry contract** — the only way an operation becomes invocable:

```ts
{
  id: 'payments.record',
  label: { en: 'Record payment', bn: '…' },
  permission: 'payments:create',          // same gating as the nav
  kind: 'modal' | 'navigate' | 'inline',
  context: ['student', 'guardian'],       // what it can prefill from
  run: (ctx) => …                          // opens the shared form or navigates
}
```

Rules: no field-count restriction on modal actions — a modal may hold a
whole flow (pick person → see applied fees → record). Modal actions render
the same form component as the page (U7). Every action carries i18n labels
in both locales. The actual list lives in
`client-admin/src/action-registry.ts` (`ACTIONS` — registered actions, each with
a `run()` and a permission that matches `STAFF_ROUTE_PERMISSIONS` or a listed
stricter exception) and `client-admin/src/unregistered-actions.ts`
(`PALETTE_ALLOW_LIST` — dialog files deliberately not in the palette, one reason
each — and `UNREGISTERED_ACTIONS` — dialogs deferred to an open epic). See the
three-list diagram in §2.

`run()` can land on a page with a one-shot search flag. Example: `classes.create`
runs `navigate({ to: '/classes?new=1' })`; the Classes page opens its create
dialog through the shared `useLandingFlag` hook, and closing the dialog clears
only `new`, so list filters survive.

## 5. Breadcrumbs

- Derived from the TanStack route tree, never hand-written per page.
- Entity segments show the entity name once loaded. While it loads, the crumb is a
  skeleton bar (`h-3 w-24 rounded-sm bg-muted`) — **never an id** (D9). The tab
  title (`document.title`) uses the parent label meanwhile.
- The crumb row renders only when the trail has **2 or more crumbs**. A top-level
  page starts at its `h1`.
- Every crumb but the last is a link. The trail also feeds `document.title` (`Fees · Rahim Uddin · SchoolManager`).
- Sits **above** the page title inside the shell header; on phones only the last two crumbs show.
- Identical placement and behaviour on every screen — staff, portal and platform.

```mermaid
flowchart LR
  A["/students"] --> B["1 crumb → no crumb row<br/>h1 'শিক্ষার্থী'"]
  C["/students/&lt;id&gt;/fees"] --> D["শিক্ষার্থী › রহিম উদ্দিন › ফি<br/>(grey bar instead of the name while it loads)"]
```

## 6. Accessibility and keyboard gates

| Gate                                          | Today                                                                                                                                                       | Rule                                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe per route × locale × theme, plus overlays | blocking (`e2e/a11y/routes.a11y.spec.ts`)                                                                                                                   | stays blocking; manifest guard (§2) makes it complete                                                                                                                                                                   |
| Keyboard journey per nav group                | one spec per nav group (`e2e/keyboard/nav-<group>.spec.ts`: academics, administration, attendance, communications, exams-results, finance, people, reports) | one test per nav route: open it from the sidebar by keyboard, then open and close the page's primary task (or, where a page has none, check it is reachable) — mouse-free. A new screen adds a test to its group's spec |
| Focus vocabulary                              | 09-design-direction §12                                                                                                                                     | unchanged                                                                                                                                                                                                               |
| Screen reader                                 | none                                                                                                                                                        | manual VoiceOver/NVDA pass at every epic close, findings filed as issues                                                                                                                                                |
| Target size / reflow                          | blocking (`e2e/responsive/*`)                                                                                                                               | unchanged                                                                                                                                                                                                               |

## 7. Backup and restore coverage

Every epic that adds a tenant-scoped entity ships, in the wave-close ticket
of the wave that adds it: the workbook tab (export + restore), a round-trip
test (`server/test/workbook-roundtrip.integration.spec.ts` pattern), and
seed rows. The entity-level guard (§2) turns "forgot the tab" into a red
CI, and the allowlist (with a one-line reason per entry) is the only way
to opt an entity out. See [14-school-workbook.md](14-school-workbook.md).

## 8. What every epic must state

Three mandatory sections in every epic body (enforced by the `plan-epic`
skill template):

- **UX requirements** — where each screen lives (tree path from §3), the
  keyboard path for the primary task, palette actions it registers,
  breadcrumb shape, empty/error states, phone layout.
- **Backup & restore coverage** — entities added, their tabs, seed rows.
- **No-silent-gaps checklist** — route manifest, nav tree, action registry,
  i18n keys, workbook tab, seed: each ticked with the ticket that does it.

And one **UX round** in the grill (Phase 1): placement, keyboard path,
actions, breadcrumbs, empty states, phone — asked before decisions are
final, so UX is designed, not retrofitted.
