# UI patterns — how every screen is put together

Decided 2026-10-04 while planning Epic 31.0 (UX retrofit, #811); reconciled
with the shipped code by 31.5.4 (#1458). This is the **pattern** contract: which building block a screen uses, and the rules that
make every screen look and behave like the same product.

It sits between two older contracts. Read the one you need:

| Question                                                                           | Doc                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| Which colour, font size, border, shadow, motion token?                             | [09-design-direction.md](09-design-direction.md) |
| Where does a screen live in the nav? Palette, breadcrumbs, registries, a11y gates? | [15-ux-principles.md](15-ux-principles.md)       |
| **Which component, which layout, which wording, which format?**                    | **this doc**                                     |

> **Status — read this first.** Epic 31.0's foundation is **built**. Every
> component in §10 exists in `ui/` (or `client-admin/`, where §10 says so). Plan
> and design every new screen to this contract. Where the code and this doc
> disagree, **the code is right**: fix the doc. Rules the code still breaks are
> listed in [§14 Known gaps](#14-known-gaps) — the rule stays, the gap is named.

```mermaid
flowchart LR
  A["Epic 31.0 plan<br/>(this doc, before wave 1)"] --> B["Waves 1–11 build it"]
  B --> C["31.5.4 reconciles:<br/>code wins, gaps named in §14"]
```

## 1. The rules on one screen

| #   | Rule                                    | In practice                                                                                                                                                                                                                                         |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **One kit.**                            | Every mockup starts from the kit in `.claude/skills/redesign-page/` (5 shell starters + `patterns.html`). You copy patterns; you do not invent one. A pattern that is missing is added to the kit first, then used.                                 |
| P2  | **Fix it in the shared component.**     | A look or behaviour that more than one screen needs lives in `ui/`, never copied into a route file.                                                                                                                                                 |
| P3  | **A page owns only itself.**            | A page ticket edits its route files, its feature folder and its own locale namespace. Shared code (`ui/src/**`, layouts, `nav-tree.ts`, `route-crumbs.ts`, `action-registry.ts`, `nav.json`, `common.json`) changes only in a ticket made for that. |
| P4  | **Nothing raw on screen.**              | No UUID, no i18n key, no enum constant (`CASH`, `Father`), no regex or locale code, no English server message. Show the name, a translated label, a translated sentence.                                                                            |
| P5  | **One primary action per view.**        | One filled button. Others are outline. Rare ones go into a "More" menu.                                                                                                                                                                             |
| P6  | **The phone is designed, not shrunk.**  | One column, tables become cards, filters hide behind one button, every control is at least 44 px tall.                                                                                                                                              |
| P7  | **Title = breadcrumb = sidebar label.** | One name per thing, in plain words, in Bangla and English.                                                                                                                                                                                          |

## 2. Anatomy of a page

```mermaid
flowchart TD
  subgraph Shell["AppShell — same on staff, portal and platform"]
    TB["Top bar — desktop: school · search (Ctrl+K) · bell · language · theme · account<br/>phone: menu + school name · search · bell · account (one sticky 56 px row)"]
    SB["Sidebar (desktop) / drawer (phone)<br/>every item has its own icon · exactly ONE item active"]
    subgraph Main["PageContainer — centred: max-w-screen-xl (lists, details) or max-w-3xl (forms)"]
      BC["Breadcrumbs — only when 2+ levels; names, never ids (a grey bar while a name loads)"]
      PH["PageHeader — h1 · one-line subtitle · actions (1 primary + ≤2 outline + More)"]
      BODY["Body — FilterBar + DataTable · or tabs · or cards · or a form"]
    end
    BN["Bottom bar (phone) — fixed, up to 4 cells per role + More"]
  end
  TB --- SB
  SB --- Main
  BC --> PH --> BODY
  Main --- BN
```

- Gutters are 16 px on phone and 24 px on desktop (`p-4 md:p-6` on the shell's
  `<main>`). `PageContainer` sets width only. A route file never sets its own
  `max-w-*`, `mx-auto` or page padding — the `no-page-max-width` lint rule
  ([15 §2](15-ux-principles.md)) checks it.
- Portal and platform use the **same `AppShell`** as staff (D33): same top bar,
  same phone row, same drawer, same bottom bar. Only the items differ.
- The bottom bar is on every signed-in page on phone. `AppShell` puts it in a
  `fixed inset-x-0 bottom-0` wrapper and adds matching bottom padding to the
  page, so content never hides behind it. It is hidden only inside a full-page
  modal, which has its own action footer. A cell is never empty or duplicated:
  most roles get 4 cells, SUPER_ADMIN's platform console 3, COMMITTEE 2 — plus
  "More", which opens the drawer.
- The phone drawer is a full-height sheet with a sticky header: brand on the
  left, a 44 px close button on the top right that never scrolls away.
- **On phone**, language, theme, security, switch school and sign out live in
  the account menu. On desktop language and theme are buttons in the top bar and
  the account menu holds the rest.

## 3. Which container does a task get?

```mermaid
flowchart TD
  Q1{"Does the task have its own<br/>sidebar item?"} -->|yes| PAGE["A page<br/>(ListShell / DetailShell / FormShell / WizardShell)"]
  Q1 -->|"no — it opens from a button"| Q2{"More than 6 fields, or steps,<br/>or it contains a table / list / preview?"}
  Q2 -->|yes| FP["Full-page modal — FullPageShell"]
  Q2 -->|no| Q3{"Is it only a yes/no on<br/>something destructive?"}
  Q3 -->|yes| CD["ConfirmDialog (sm) — the only place a red filled button appears"]
  Q3 -->|no| DLG["Dialog — sm 400 · md 560 · lg 720"]
```

| Container           | Rules                                                                                                                                                                                                                                                                                                                                                                                                              | Example                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Page**            | Lives in the nav tree. `PageHeader` on top.                                                                                                                                                                                                                                                                                                                                                                        | `/students`, `/communications/send`                                                                       |
| **Full-page modal** | Covers the app chrome. **Is in the address bar**: its own route when one exists, otherwise a search param on the host route. Sticky header: title left, a very visible Close (X + word, 44 px) top right. Body centred. Sticky footer: secondary left, primary right. When the page passes `dirty`, Esc and Close ask before discarding changes. Closing returns to where the user came from (`useCloseFullPage`). | Add student `/students/new`, record payment `/payments/record`, generate fees `/fees/generate?generate=1` |
| **Dialog**          | Cancel (outline), then the primary on the right. 20 px padding on every side; header, body and footer share it.                                                                                                                                                                                                                                                                                                    | Add guardian, rename                                                                                      |
| **ConfirmDialog**   | Says what will be lost. Cancel + red filled confirm.                                                                                                                                                                                                                                                                                                                                                               | Delete student                                                                                            |

## 4. The four page shapes

| Shape           | Built from                                                             | Must have                                                     |
| --------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| **List**        | `ListShell` → `PageHeader` + `FilterBar` + `DataTable`                 | visible total, row actions as icons, empty state, error state |
| **Detail**      | `DetailShell` → header (name, status badge, key facts, actions) + tabs | tabs switch (one panel visible), tab in the URL               |
| **Form / task** | `FormShell` (page) or `FullPageShell` (opened from a button)           | visible label on every field, one Save, cancel/close          |
| **Wizard**      | `WizardShell` or `FullPageShell` with steps                            | step indicator, Back / Next in the footer                     |

Signed-out pages (login, reset, public receipt, public admission form) use
`AuthLayout`: logo, a centred card, the language switcher top right.

## 5. Lists and tables

- **Row actions** are icon buttons with a tooltip that names the action — never
  underlined text. At most 3 icons; more go into a "More" menu with icon + text.
  On phone cards the same actions show icon + visible label (there is no hover).

  | Intent                                                             | Icon                          | Colour  |
  | ------------------------------------------------------------------ | ----------------------------- | ------- |
  | view / open                                                        | `eye`                         | neutral |
  | edit                                                               | `pencil`                      | brand   |
  | pay / approve                                                      | `hand-coins` / `circle-check` | success |
  | send (message, reminder) / restore                                 | `send` / `archive-restore`    | brand   |
  | reject                                                             | `circle-x`                    | danger  |
  | print / download                                                   | `printer` / `download`        | neutral |
  | duplicate / archive                                                | `copy` / `archive`            | neutral |
  | delete (the record is gone) / remove (taken out of this list only) | `trash-2` / `circle-minus`    | danger  |

- **Every table shows its total.** Paginated: "Showing 1–25 of 312" + rows per
  page + pager. Short and unpaginated: "Total 12".
- **Default page size is 25** (options 25 / 50 / 100, `PAGE_SIZE_OPTIONS` in
  `ui/src/utils/page-size.ts`). The list-state hook owns it; a route does not pass its own.
- A table column with `id: 'actions'` must render `<RowActions>` (the
  `row-actions-column` lint rule). Pass `data-focus-anchor` on the "view" action
  so Back returns focus to the row.
- **Empty table** → `EmptyState` and no pager. **Failed load** → `ErrorState` with Retry.
  ListShell switches to the no-matches state by itself when a filter is active; a page only
  sets `kind: 'no-results'` to use its own words.
- **Numbers are right-aligned.** **Status is always a `StatusBadge`** with a tone
  and an icon (success / warning / danger / info / neutral) — never plain text.
- **Phone:** `DataTable` card mode. A short unpaginated table becomes compact two-line rows.

## 6. Filters and forms

- **Every control has a visible label** — filters too. A placeholder is not a label.
- Date and select fields show a placeholder (`তারিখ বাছুন`, `বাছুন`). Required
  fields are marked. An empty select keeps its full width.
- **No browser-native `<select>`, date, time, month, week or datetime-local
  input.** Use `Select`, `Combobox`, `DatePicker`, `MonthPicker`, `TimeInput`.
  The `no-native-picker` lint rule fails the build otherwise.
- `DatePicker` needs the tenant `config` (`useRegionConfig()`) and an
  `aria-label`. `MonthPicker` takes `"2026-10"`, `TimeInput` takes `"08:00"`.
- **FilterBar on phone:** the search field plus one "Filter (n)" button that opens
  a bottom sheet. Active filters show as removable chips, with one "Clear all".
- Field gap 16 px, label-to-control 6 px. Help text under the control; the error
  replaces it.

- **A create or send dialog sends one request per double-click.** The submit
  button gets `loading={mutation.isPending}`, plus an `inFlight` ref guard
  (see `-program-form-dialog.tsx`) because a fast double-click can fire before
  React re-renders. Sends and creates also carry an `Idempotency-Key`
  (`useIdempotencyKey()`), so the server is the second line. **A new
  create/send dialog joins the registry** in
  `e2e/journeys/double-submit.registry.ts`; `double-submit.spec.ts` then
  proves it.

```mermaid
flowchart LR
  A[double-click Save] --> B[button busy, ref guard set]
  B --> C[exactly one request]
```

A registry entry (the program dialog):

```ts
{
  name: 'program',
  route: '/programs',
  open: (page) => addButton(page, 'programs.actions.add'),
  fill: (page, suffix) => page.getByLabel(/name/i).fill(`Dbl program ${suffix}`),
  submitKey: 'programs.formDialog.save',
  postUrl: /\/api\/v1\/programs$/,
  done: dialogClosed,
}
```

## 7. Formats — one function each (`ui/src/utils`)

Every formatter takes the tenant's `RegionConfig` (`useRegionConfig()`), so the
school's numeral setting is applied for you. Empty or missing values show `—`.
None of them throws while rendering.

| What                       | English                        | Bangla                            | Function                                                                             |
| -------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------ |
| Date                       | `9th September, 2026`          | `৯ই সেপ্টেম্বর, ২০২৬`             | `formatDate`                                                                         |
| Date + time                | `9th September, 2026, 3:45 PM` | `৯ই সেপ্টেম্বর, ২০২৬, বিকাল ৩:৪৫` | `formatDateTime`                                                                     |
| Date range                 | `8th – 10th October`           | `৮ই – ১০ই অক্টোবর`                | `formatDateRange`                                                                    |
| Month                      | `October 2026`                 | `অক্টোবর ২০২৬`                    | `formatMonth`                                                                        |
| Time (12-hour, no seconds) | `8:00 AM`                      | `সকাল ৮:০০`                       | `formatTime`                                                                         |
| Number / count             | `1,250`                        | `১,২৫০`                           | `formatNumber(value, config, { decimals? })`; `{{count}}` in translations follows it |
| Money                      | `৳500.00`                      | `৳৫০০.০০`                         | `formatCurrency` (minor units) / `formatServerAmount` (server decimal)               |
| Phone                      | `01711-000004`                 | `01711-000004`                    | `formatPhone`                                                                        |

- `formatNumber` always groups by thousands and has one option, `decimals`.
  There is no "no separator" switch. A year is not a number: write it through
  `formatDate` / `formatMonth`.
- **Phone rules:** the display form is `01711-000004` and always uses Latin
  digits (D6). `formatPhone` strips the country code or a leading `0`, checks
  the number against the region's pattern, then applies the region's mask
  (`config.phone.displayFormat`). A number it cannot parse is shown **as the
  user typed it** — never hidden, never an error. `parsePhone` accepts Bangla or
  Latin digits.
- Bangla day ordinals: ১লা, ২রা, ৩রা, ৪ঠা, ৫ই–১৮ই, ১৯শে–৩১শে.
- **Never mix digits** inside one value. In the Bangla UI, numerals follow the
  school's numeral setting. The English UI always uses Latin digits and English
  words. Things a person copies or dials stay Latin in both:
  registration / invoice / receipt numbers, phone numbers, emails, codes.
- ISO strings (`2026-09-09`) appear only in exports, URLs and API calls. Use
  `toIsoDate` for those — never `formatDate` output as data. The
  `no-raw-date-display` lint rule catches hand-rolled `toISOString().slice(…)`
  and `toLocale…String()` on dates.

## 8. Calendar and dates

One month component serves the date picker and the calendar page.

- Header (`MonthHeader`): the month in words (`অক্টোবর ২০২৬`), icon prev/next, a
  "Today" button. `MonthGrid` draws it itself when you pass `onMonthChange`.
- Today is ringed; the selected day is filled; today is selected by default.
- **Desktop calendar page:** month grid with event chips + a panel for the selected day.
- **Phone:** full-width month grid with event dots; the selected day's events are
  listed under it. No grid/agenda toggle.

## 9. Spacing, buttons, states

| Where                      | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Page gutter                | 16 px phone / 24 px desktop                                                       |
| Between sections of a page | 24 px                                                                             |
| Card padding               | 16 px phone / 20 px desktop                                                       |
| Dialog padding             | 20 px on every side                                                               |
| Control height             | 44 px on phone; 32 px on desktop for staff, 44 px for portal and signed-out pages |
| Radius                     | controls 8 px, cards and dialogs 12 px                                            |

- **Buttons:** one filled primary per view; outline = secondary; ghost = tertiary;
  red **filled** (`Button variant="danger"`) only inside a `ConfirmDialog`;
  underlined links only for navigation inside a sentence. A `PageHeader` action
  with `priority: 'destructive'` is the _tinted_ `destructive` variant, not the
  filled one.
- **Anything clickable shows a pointer cursor;** disabled shows `not-allowed`.
  One global rule in `ui/src/styles/globals.css` does it (buttons, `a[href]`,
  `role=tab|menuitem|option`, a focusable `role=gridcell`, `summary`, `label[for]`) — never add `cursor-pointer` by hand.
- **Empty state:** icon, title, one sentence, one (outline) action.
  **Error state:** a translated sentence + Retry.
  **Loading:** a skeleton shaped like the content.
- **Settings-like pages** with many sections use a category side list
  (`?section=`) — `SettingsLayout` + `SettingsSection` in
  `client-admin/src/pages/settings/` (not in `ui/`; seven categories: school,
  academics, finance, communication, printing, security, backup); on phone the category list comes first, then the section with a
  back control. Each section keeps its own Save. Technical fields sit under "Advanced".
- **Notification badge:** a pill that holds four digits, with real contrast in
  both themes.

## 10. Component catalogue

All of these are **shipped**. "Use" means import from `@biddaloy/ui/components`,
`@biddaloy/ui/shells` or `@biddaloy/ui/utils` (the root `@biddaloy/ui` barrel
re-exports all three). Props and exact classes are in
`.claude/skills/redesign-page/patterns.md`.

The last column is the ticket and the commit that shipped it. Foundation tickets
landed on the accumulating Epic 31.0 stack, so most have no PR number of their
own; where one exists it is shown.

| Component                                                                                                                  | Folder (`ui/src/…`)                | Use it for                                                                                                | Shipped by                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `AppShell`, `BottomNav`                                                                                                    | `components/`                      | the frame of every signed-in page                                                                         | 31.2.9a `aa974a18`, 31.2.10 `86cd013b`, 31.3.8a `17a52938` |
| `Breadcrumbs`                                                                                                              | `components/`                      | the trail above the title                                                                                 | 31.3.5 `8ccaec56`                                          |
| `PageContainer`, `PageHeader`                                                                                              | `shells/`                          | width and the title row of every page                                                                     | 31.2.5a `33306cf9`                                         |
| `ListShell`, `DetailShell`, `FormShell`, `WizardShell`                                                                     | `shells/`                          | the four page shapes                                                                                      | 31.2.5a–c                                                  |
| `FullPageShell`, `useCloseFullPage`                                                                                        | `shells/`                          | task forms opened from a button                                                                           | 31.2.6 `fa6351a7` (#1418)                                  |
| `Dialog` (`size`), `ConfirmDialog`                                                                                         | `components/`                      | short forms, destructive confirms                                                                         | 31.2.6 `fa6351a7` (#1418)                                  |
| `DataTable` + `RowActions` + `TableCount`                                                                                  | `components/`                      | every table                                                                                               | 31.2.4a `b085d981` (#1414), 31.2.4b `91bccacf` (#1415)     |
| `FilterBar`                                                                                                                | `shells/`                          | every filter row                                                                                          | 31.2.7a `9dd79756`                                         |
| `FilterSheet`                                                                                                              | `components/`                      | the phone filter bottom sheet                                                                             | 31.2.7a `9dd79756`                                         |
| `Select`, `Combobox`, `FormField`, `Label`                                                                                 | `components/`                      | form controls                                                                                             | 31.2.7b `5bac961c`                                         |
| `MultiCombobox`                                                                                                            | `components/`                      | pick several people or roles                                                                              | 52.1.3                                                     |
| `Timeline`                                                                                                                 | `components/`                      | an application's or record's event history                                                                | 52.1.3                                                     |
| `DatePicker`, `MonthPicker`, `TimeInput`                                                                                   | `components/`                      | every date, month, time input                                                                             | 31.2.2 `0b2e79b9`                                          |
| `MonthGrid`, `DayPanel`, `AgendaList`                                                                                      | `components/calendar/`             | calendar views                                                                                            | 31.2.3a `78cf6d9c`                                         |
| `StatusBadge` (`tone` + `label`, or `domain` + `status`)                                                                   | `components/`                      | every status                                                                                              | 31.2.8b `853dc892` (#1421)                                 |
| `EmptyState` (`headingLevel`), `ErrorState`, `Skeleton`                                                                    | `components/`                      | the three states                                                                                          | 31.2.8a `f6f82059`                                         |
| `AuthLayout`                                                                                                               | `components/`                      | signed-out pages                                                                                          | 31.2.12 `5d98e1c3`                                         |
| `formatDate`, `formatDateTime`, `formatDateRange`, `formatMonth`, `formatTime`, `formatNumber`, `formatPhone`, `toIsoDate` | `utils/`                           | every value on screen                                                                                     | 31.2.1a `08da25db`, 31.2.1b `b34e6abf`, 31.1.2b            |
| `CommandPalette`                                                                                                           | `components/`                      | `Ctrl+K`                                                                                                  | Epic 30.4                                                  |
| `CommandPaletteLauncher`, `StaffUserMenu` (`securityTo`)                                                                   | `client-admin/src/components/`     | the staff / portal / platform top bar                                                                     | 31.3.1 `a1633389`, 31.3.2 `ac3ecb0a`, 31.3.3 `2ed4ceff`    |
| `SettingsLayout`, `SettingsSection`                                                                                        | `client-admin/src/pages/settings/` | settings pages                                                                                            | 31.4 admin lane                                            |
| `LessonStatusGroup`                                                                                                        | `components/`                      | taught / partly / not taught for one lesson period                                                        | 66.1.05 (#2003)                                            |
| `RadioRows`, `ChoiceCards`                                                                                                 | `components/`                      | a radio list with captions; big radio cards                                                               | 66.1.05 (#2003)                                            |
| `Stepper` (`StepIndicator` is the old name)                                                                                | `components/`                      | step bar on phone, numbered circles on desktop                                                            | 66.1.06 (#2004)                                            |
| `ReorderButtons`                                                                                                           | `components/`                      | ↑ ↓ in a row's actions cell                                                                               | 66.1.06 (#2004)                                            |
| `ExamMarkerRow`, `ExamMarkerLine`                                                                                          | `components/`                      | the "exam syllabus up to here" row (table / phone card list)                                              | 66.1.06 (#2004)                                            |
| `WidgetCard`                                                                                                               | `components/dashboard/`            | frame of every dashboard widget: full or compact (tap to expand), loading / error / empty                 | new, Epic 169.0 wave 1                                     |
| `StatTile`                                                                                                                 | `components/dashboard/`            | phone KPI tile with a trend (icon + text) and a Sparkline or Meter                                        | new, Epic 169.0 wave 1                                     |
| `Sparkline`, `Meter`                                                                                                       | `components/dashboard/`            | tiny trend line; progress bar with an optional target marker                                              | new, Epic 169.0 wave 1                                     |
| `BriefingLine`, `BriefingChip`                                                                                             | `components/dashboard/`            | the top "what needs you today" line, one primary action                                                   | new, Epic 169.0 wave 1                                     |
| `LineChart`, `ColumnChart`                                                                                                 | `components/dashboard/`            | trends over time; simple or stacked columns (SVG, no chart library)                                       | new, Epic 169.0 wave 1                                     |
| `StackedBar`                                                                                                               | `components/dashboard/`            | one bar split into labelled parts (by method, ageing)                                                     | new, Epic 169.0 wave 1                                     |
| `ChartTableToggle`                                                                                                         | `components/dashboard/`            | chart with a "show as table" switch and a summary sentence                                                | new, Epic 169.0 wave 1                                     |
| `BarWidget`                                                                                                                | `components/performance/`          | changed: `target`, `emphasis`, `bare`                                                                     | changed, Epic 169.0 wave 1                                 |
| `AttendanceMonthGrid`                                                                                                      | `components/`                      | changed: `upcoming` days                                                                                  | changed, Epic 169.0 wave 1                                 |
| `HelpHint`, `HelpProvider`, `useHelp`                                                                                      | `components/`                      | the (?) that opens a help card linking into the user guide; see [HelpHint placement](#helphint-placement) | Epic 44 (#2561)                                            |

Shell and shared props that tripped people (read the source, not the plan):

- `AppShell` takes `mobileTitle` + `mobileActions` for the phone row.
  `mobileHeaderActions` and `drawerHeader` are **gone** (31.3.8a).
- `BottomNav` takes `items` (max 4) and `more: { label, icon?, active? }`. The
  "More" cell is a `<button>` that sets `data-active="true"`; it never carries
  `aria-current`. A current cell carries `aria-current="page"`.
- `BreadcrumbItem` has `loading?: boolean`: a grey bar shows and the crumb is never a link.
- `EmptyState`'s `headingLevel` defaults to `2`; a whole-route placeholder passes `1`.
  `secondaryAction` renders as a ghost button.
- `Button` variants: `default`, `outline`, `secondary`, `ghost`, `destructive`
  (tinted), `danger` (filled red, `ConfirmDialog` only), `link`.
- `CommandPaletteLauncher` takes `pages` (the palette's Page tab for portal and platform).

### HelpHint placement

The **(?)** opens a short card with a link into the user guide
([39-user-guide → In-app help](39-user-guide.md#in-app-help-epic-44)). It is a
muted icon with a 44 px target and no pulse (D22).

**Where it goes (D18):** page titles, crucial actions, hard fields and
multi-part section headers. Not on every field.

| Element                                                                                                 | How to wire it                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page title                                                                                              | nothing: `PageHeader` finds the page id from the route (E15)                                                                                                                          |
| Header action shown inline (primary, first two secondaries, or a lone destructive)                      | `helpId` on the `PageAction`; the (?) follows its button and hides on phone when the button does (a secondary or destructive without `keepOnPhone`). The primary's (?) stays on phone |
| Header action in the More menu (tertiary, third and later secondaries, a destructive that is not alone) | a menu item draws no (?). Put the id on the dialog it opens (`helpId` on `ConfirmDialog`, or a `<HelpHint>` beside a `DialogTitle`); no dialog: list it in `help-unwired.ts`          |
| Table row action                                                                                        | none on the row (a (?) per row is noise). Put the id on the dialog it opens, as for a More-menu item                                                                                  |
| `FilterBar` field                                                                                       | `helpId` on the field descriptor; the (?) follows the label                                                                                                                           |
| `DataTable` expand toggle                                                                               | `expandHelpId` on the table: one (?) in the expand column header (desktop table only)                                                                                                 |
| `FullPageShell` footer primary                                                                          | `helpId` on `primary`; the (?) follows the button                                                                                                                                     |
| `EmptyState` action                                                                                     | `helpId` on `action`                                                                                                                                                                  |
| Any other button                                                                                        | `<HelpHint helpId="…" />` right after it, inside its flex row                                                                                                                         |
| Form field                                                                                              | `helpId` on its `FormField`; the (?) follows the label                                                                                                                                |
| Section header                                                                                          | `<HelpHint helpId="…" />` after the `h2`, in a `flex items-center gap-1` row                                                                                                          |
| Dashboard widget                                                                                        | nothing: `WidgetSlot` passes `widget.<key>` to `WidgetCard` (E23)                                                                                                                     |

Example, from `client-admin/src/routes/_staff/attendance/$sectionId.tsx`:

```tsx
<Button type="submit">…</Button>
<HelpHint helpId="attendance.attendance.action.submit" />
```

**No page, no icon.** `HelpHint` renders nothing when the id has no guide
entry or `VITE_HANDBOOK_URL` is empty (E4). Never draw a (?) that leads
nowhere, and never invent an id the guide does not declare: a spot with no
entry becomes a sub-issue of #3017 (E19).

**`data-help-id` is the capture hook (E24).** The (?) button carries
`data-help-id="<id>"`. The guide's capture toolkit
(`e2e/docs/helpers/capture.ts`) hides every `[data-help-id]`, so screenshots
never show it; a PR that only adds a (?) writes
`User guide: not affected — adds (?) only; screenshots exclude it (E24)`.
e2e locators use the same hook: the (?) is a button named "Help: <title>", so
a name match that could hit it adds `:not([data-help-id])` or uses
`exact: true`.

## 11. Wording

- Write for a school clerk. No "batch", "run", "commit", "slug", "token",
  "provider", "step-up approval".
- One word per thing in each language (`শ্রেণি`, never also `ক্লাস`).
- There is no separate glossary file. The words live in
  `ui/src/i18n/locales/{en,bn}/nav.json` and `common.json` (31.3.4a, #1439, put
  the shared labels there). A new screen takes its words from those files and adds
  to them — it does not coin a second name.
- Every string exists in `en` and `bn`. Bangla is often longer and taller: never
  fix a width to an English word.

## 12. How to design a new screen (or redesign one)

```mermaid
flowchart LR
  A["1. Pick the page shape (§4)<br/>and the container (§3)"] --> B["2. Copy a starter<br/>from the kit"]
  B --> C["3. Fill it with PATTERN blocks<br/>from patterns.html"]
  C --> D["4. Shoot desktop 1440 + phone 390<br/>(shoot.mjs)"]
  D --> E{"Looks like the kit?<br/>One primary? ≥44 px on phone?"}
  E -->|no| C
  E -->|yes| F["5. Ticket: screenshots +<br/>'use X from @biddaloy/ui'"]
```

The kit lives in `.claude/skills/redesign-page/`:

| File                                            | What it is                                           |
| ----------------------------------------------- | ---------------------------------------------------- |
| `starter.html`                                  | staff shell (sidebar, top bar, phone bottom bar)     |
| `starter-portal.html` · `starter-platform.html` | guardian portal and platform console shells          |
| `starter-fullpage.html`                         | full-page modal frame                                |
| `starter-guest.html`                            | signed-out card (`AuthLayout`)                       |
| `patterns.html`                                 | every pattern once, between `PATTERN: Name` comments |
| `patterns.md`                                   | component names, props, exact classes                |
| `nav-icons.md`                                  | icon per nav item, bottom-bar cells per role         |

A concrete example — the Students list (`/students`) mapped to the kit:

| Part of the page                              | Pattern                    | What the ticket says                                             |
| --------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| Title + "Add student"                         | `PageHeader`               | one primary; "Import" is outline; "Upload photos" goes into More |
| Search, class, section, status, date of birth | `FilterBar`                | every field labelled; phone: search + "Filter (2)"               |
| Rows                                          | `DataTable` + `RowActions` | view (neutral), edit (brand), collect fee (success)              |
| Footer                                        | `TableCount`               | "১–২৫ দেখানো হচ্ছে, মোট ৪৮"                                      |
| No students yet                               | `EmptyState`               | title, one sentence, outline "Add student"                       |

Planning a large UI epic (many screens at once)? Follow the method Epic 31.0
used, so tickets cannot collide and nothing is built twice:

1. Kit first (or extend it) — the spec for shared tickets and the parts bin for page mockups.
2. Shared code in _foundation_ tickets; each page in its own ticket that only says "use".
3. What a page needs from shared code is written down as a request and decided
   **before** tickets are created.
4. Tickets that share a file form one lane and run in order; lanes of a wave share
   no file — check it with a script over every `## Files` list, not by eye.

## 13. What a ticket with a screen must state

In addition to the three sections [15-ux-principles.md](15-ux-principles.md) §8 asks for:

- the **page shape** (§4) and the **container** of each task (§3);
- the **kit patterns** it uses, by name — and any pattern it needs that the kit lacks;
- **desktop and phone** screenshots of a mockup built from the kit;
- the **one primary action** of each view;
- that it follows §7 formats and §11 wording — and the glossary words it adds.

## 14. Known gaps

The rules above are the target. The code, as built by Epic 31.0, still breaks a
few of them. The rule stays; the gap is named here so nobody copies it as if it
were the pattern. Each row was checked in the source on the Epic 31.0 stack.

```mermaid
flowchart LR
  R["Rule in this doc"] --> C{"Does the code<br/>keep it?"}
  C -->|yes| OK["Nothing to write"]
  C -->|no| G["Row in this table<br/>(rule stays, gap named)"]
  G --> F["Fix in the shared component,<br/>then delete the row"]
```

### Shared components

| Component               | Gap                                                                                                                               | Where                                                                                                 | Until it is fixed                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ConfirmDialog`         | No error slot. A failed confirm cannot show its message inside the dialog.                                                        | `ui/src/components/confirm-dialog.tsx`                                                                | Close the dialog and show the error on the page behind it.                                                    |
| `FullPageShell`         | The footer `secondary` button calls its own `onClick` directly. It **skips** the "discard changes?" check that Close and Esc run. | `ui/src/shells/full-page-shell.tsx` (`secondary` is wired to `secondary.onClick`, not `requestClose`) | Make the secondary's `onClick` call the same close handler you pass as `onClose`, and check `dirty` yourself. |
| `FullPageShellAction`   | No `icon` prop (`PageAction` has one).                                                                                            | same file                                                                                             | Footer buttons are label-only; do not mock an icon there.                                                     |
| `RowActions`            | No per-row name. Every row's "view" icon has the same `aria-label` ("View"), so a screen reader hears ten identical buttons.      | `ui/src/components/row-actions.tsx` (`RowAction.label` only)                                          | Make the label name the row: `"View Rahim Uddin"`.                                                            |
| `PageHeaderActions`     | No `print:hidden`. Header buttons print with the page. (`DataTable`'s footer has it.)                                             | `ui/src/shells/page-header.tsx`                                                                       | Hide the header row in the page's own print styles.                                                           |
| `WizardShell`           | No `subtitle`, unlike `PageHeader`.                                                                                               | `ui/src/shells/wizard-shell.tsx`                                                                      | Put one line of help text in the first step; do not mock a subtitle.                                          |
| `StatusBadge`           | No `className`. Its props are the `tone` / `domain` union only.                                                                   | `ui/src/components/status-badge.tsx`                                                                  | Wrap it in a `<span>` for layout.                                                                             |
| `useWarnUnsavedChanges` | Guards only the browser `beforeunload` (closing the tab, reload). It does **not** block in-app navigation.                        | `ui/src/shells/use-form-shell.ts`                                                                     | `FullPageShell` covers its own Close / Esc; a plain page needs a router blocker of its own.                   |

### Focus does not return after a dialog closes

```mermaid
sequenceDiagram
  participant U as User (keyboard)
  participant B as Header primary Button
  participant D as Dialog / full-page modal
  U->>B: Enter
  B->>D: sets state to open
  Note over B,D: The button is a plain Button, not a Radix DialogTrigger,<br/>so Radix has no trigger element to remember
  U->>D: Esc
  D-->>U: closes. Focus drops to document.body
```

The page-header primary `Button` only sets state. It is not a Radix
`DialogTrigger`, so when the dialog or full-page modal closes there is no
trigger to refocus and focus drops to `<body>`. The keyboard e2e helper
`e2e/keyboard/keyboard-utils.ts` carries `FOCUS_RETURN_KNOWN_BROKEN = true`, so
its "focus returns to the trigger" assertion is skipped. Flip the flag to
`false` when the bug is fixed; every primary-task journey then checks it.

### Palette landing flags

A palette action can land on a page with a one-shot search flag. Example:
`classes.create` runs `navigate({ to: '/classes?new=1' })`, the Classes page
opens its create dialog, and closing the dialog removes `new` from the URL.

```mermaid
flowchart LR
  K["Ctrl+K › Add class"] --> N["navigate /classes?new=1"]
  N --> H["useLandingFlag('new', allowed)"]
  H -->|"flag = 1 and allowed"| O["dialog opens"]
  O -->|close| X["only `new` is cleared;<br/>filters stay"]
```

Every page uses the shared hook `useLandingFlag(key, allowed)` in
`client-admin/src/routes/_staff/-use-landing-flag.ts`. Do not write a second
copy. `action-registry.test.ts` checks that the page declares each flag a
palette action navigates to.

### Accessibility learnings (Epic #2642, Wave 3, 2026-10-19)

- **Tab panel focus (#2601, #2629).** A tab panel needs a visible focus ring on keyboard focus, and `aria-controls` must point at a panel that exists. Rule candidate: the axe suite covers it -> no rule.
- **Grid rows (#2628).** The calendar month grid used bare cells; real ARIA rows and readable out-of-month dates fixed it. -> no rule.
- **Opt-in scroll region (#2630).** A scrollable table must be keyboard-focusable, and a filter checkbox needs a 24px target. -> no rule.

### List learnings (Epic #2642, Wave 4, 2026-10-19)

- **ListShell shows a no-match state on its own (#2591).** When a rendered filter has a value and there are no rows, `ListShell` swaps in "No matches" with a Clear button. A page keeps its own words by passing `kind: 'no-results'`; without it the page's text is replaced. -> no rule.
- **Selection is in memory (#2602).** Row selection never goes into the URL; the URL holds filters only. -> no rule.

### Final result learnings (Epic #2203, Wave 5, 2026-11-02)

- **The breadcrumb trail owns `document.title` (#3421).** `/results/final` and its detail page set `document.title` in their own effect, but `_staff.tsx` writes the trail after them (a parent effect runs after its child's), so the tab reads "Class 8 2026 · চূড়ান্ত ফলাফল · ফলাফল · …", not the page's own string. A route with a trail should not set the title by hand. -> no rule.
- **A list response must carry every relation its type declares (#3421).** `GET /exams` joined `class` but not `academic_year`, which the `Exam` schema lists; unit tests mocked the field, and the My class page crashed only on real data. Read a nested field with a real API response in at least one Playwright journey. -> no rule.
- **One more heading on a shared page breaks loose locators (#3421).** The portal final card added a heading containing "ফলাফল", so `getByRole('heading', { name })` in `result-publish.spec.ts` matched two. Match page titles with `exact: true`. -> no rule.

### File-upload full pages (Epic 81, Wave 3, 2026-11-06)

- **A host can own the Save button of `BulkUploadPreview` (2026-11-06, #3478).** Pass `hideConfirm` and `onControllerChange`; the page puts `controller.confirm()` in the `FullPageShell` footer and reads `controller.status` / `confirmDisabled`. The footer's secondary bypasses the shell's dirty check, so the page asks "discard?" itself. -> no rule.
- **Row errors must not raise `hard_error_count` when the server staged the rest (2026-11-06, #3478).** `BulkUploadPreview` disables Save on any hard error. The marks sheet saves the good rows (D7), so its hook reports 0 hard errors whenever `staging_id` is set and only the error table shows the bad rows. The page test mocked HTTP (the hook ran) but only ever with `staging_id: null`, so only the Playwright journey (T2) caught it; the page test now covers staged + row errors. -> no rule.
- **A host-confirm page needs its own "nothing to save" and "list is locked" states (2026-11-06, #3478).** Save shows `Save {n}` and turns off at 0; a 409 shows the page's own sentence plus a "Back to grid" button, not the server's English. -> no rule.
- **Match alert text by role (2026-11-06, #3478).** `BulkUploadPreview` also announces errors in an `sr-only` live region, so `getByText(sentence)` matches two nodes; use `getByRole('alert').filter({ hasText })`. -> no rule.

### Attendance sheet foundation learnings (Epic #2429, Wave 4, 2026-11-06)

- **A field's help text lives in the field's own namespace.** `HelpHint` reads `<field.ns>:help.<key>`, so `help.cardNo` goes in `students.json` / `staff.json`, not in `common.json`. A key written to the wrong namespace shows as a raw key at runtime and `check:i18n` does not see it. -> no rule.
- **Breadcrumb and nav labels resolve from `nav.json` `items.*`.** The i18n lane put them under `common.json`, so the routes lane's `{ key: 'uploads' }` had nothing to read. Lanes that share a label key must agree on the file in the ticket body. -> no rule.
- **The UI-kit gap: none.** `ScanCardField` and `AttendanceMarkBadges` took props-only text, so no component needed a new token or shell.

### Attendance sheet and source learnings (Epic #2429, Wave 5, 2026-11-06)

- **A key used with `defaultValue` still counts as missing.** Three W5 lanes shipped `t('x', { defaultValue })` while the i18n keys were pending, and nothing failed. `check:i18n` only flags plain `t('key')` calls, so those keys stayed absent until the close ticket. Land the en + bn keys in the same PR as the call. -> no rule.
- **Dynamic keys are invisible to `check:i18n`.** A key built as `reference.labels.<header>` on the student import page needs a `card_no` label and column text, and the checker cannot see that. Add the key when you add a column to the template. -> no rule.
- **A permission gate belongs above the data hook.** `if (!canManage) return null` placed after `useAttendanceDevices()` still sends the request, and the user gets a 403. Split into an outer gate and an inner component that owns the queries. -> no rule.
- **`ScanCardField` already strips characters outside `A-Z a-z 0-9 -`.** A client-side pattern check on its value can only fail for a value loaded from the server, so test the failure path with a 500, not a bad string.
- **Breadcrumb entity names come from `ENTITY_RESOLVERS`, keyed by the crumb's own label key** (`uploadDetail`), reading the query cache the page already filled.

### UX lint stragglers

`ui/eslint-rules/ux-guards.mjs` holds four rules (`no-native-picker`,
`no-raw-date-display`, `no-page-max-width`, `row-actions-column`; see
[15 §2](15-ux-principles.md)). Files that still break one are allow-listed in
the `ignores` of the config block in `ui/eslint.config.mjs` and
`client-admin/eslint.config.mjs`, each with a comment. There are **14**
entries today: the `toISOString()` slices that need a UTC-versus-local choice,
three dialogs and three student pages that size themselves with `max-w-*`, one
command-palette false positive, and the print editor (`src/components/print/editor/**`).
Remove an entry when its file is fixed; never add one without a reason comment.
