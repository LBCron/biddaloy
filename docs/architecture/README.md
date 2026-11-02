# SchoolManager Architecture Docs

This is the source of truth for how SchoolManager is actually built. It replaces
the old planning documents from before the system existed — those captured
the _original vision_; these docs describe _what was actually built_,
including every place implementation diverged from that original plan (and
why).

Each file below is self-contained — read only the one you need for the task
at hand instead of loading the whole set.

| Doc | Read this when you're... |
|---|---|
| [00-overview.md](00-overview.md) | Getting oriented, or need the big picture / tech stack / what changed from the original plan |
| [01-domain-model.md](01-domain-model.md) | Touching any database entity, or need to understand how the data model fits together |
| [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md) | Working on login, tokens, roles, permissions, or anything tenant-scoped |
| [03-backend-modules.md](03-backend-modules.md) | Adding/changing a NestJS module, controller, or API route |
| [04-fees-payments-invoices.md](04-fees-payments-invoices.md) | Working on fee generation, payments, dues, or invoices — the core business flow |
| [05-communications.md](05-communications.md) | Working on SMS/WhatsApp/email/Messenger reminders |
| [06-frontend-architecture.md](06-frontend-architecture.md) | Working in `ui/` or `client-admin/` (the one SPA — staff routes + `/portal`) |
| [07-deployment.md](07-deployment.md) | Working on the shape of the deployment: the three stacks plus edge and ops on one VM, networks, the tunnel and direct edge modes, images and tags, runtime config, migrations, the deploy sequence and the staging gate, CI, or the demo and staging environments |
| [08-security.md](08-security.md) | **Security rules** (read first for any change to auth, routes, uploads, SQL, logs or infra), then login, tokens, CSRF, audit logging, or PII/data-protection handling |
| [09-design-direction.md](09-design-direction.md) | Touching design tokens — type, colour, elevation, borders, density, motion — or the interaction contract built on top of them: focus vocabulary, action hierarchy, table→card responsive grammar, `ui/` i18n defaults, access states. Decided in 8.13 (#343–#354), recorded from 8.14 (#365–#377, #457–#461) |
| [10-third-party-services.md](10-third-party-services.md) | Need to know what external services/APIs SchoolManager depends on (Postgres, Redis, BullMQ, S3/SeaweedFS object storage, SMS/WhatsApp/email providers, Sentry) and what the platform itself calls (Cloudflare tunnel and R2, Let's Encrypt, GHCR, Telegram, Kuma pushes) — and what it deliberately doesn't use (no payment gateway) |
| [11-attendance.md](11-attendance.md) | Working on attendance, registers, the teacher marking flow, or integrating a scanner |
| [12-operations.md](12-operations.md) | On call, debugging a production incident, or need the Kuma monitor table, alert routing and thresholds, `biddaloy-doctor`, the nightly timeline, or runbooks for 5xx spikes, readiness failures, edge or tunnel trouble, a late backup, or a failed restore drill or demo rebuild |
| [13-backup-restore.md](13-backup-restore.md) | Working on backups, the nightly restore drill (the restore proof) and its scrub, `biddaloy-restore-prod`, restoring files, key handling, the log archive, or the `backup` and `seaweedfs` services |
| [14-school-workbook.md](14-school-workbook.md) | Working on per-school workbook export/import, the `/backup/*` routes, the tab registry, or restore/retention semantics for one tenant's data |
| [15-ux-principles.md](15-ux-principles.md) | Planning or building any screen: where it lives in the nav tree, the `Ctrl+K` palette and its action registry, breadcrumbs, keyboard/a11y gates, the "no silent gaps" registry guards, and the three sections every epic must carry |
| [16-academic-calendar.md](16-academic-calendar.md) | Working on `modules/calendar` — calendar events, terms, import/export, the ICS feed, public holidays, or reminders for a calendar event |
| [17-evaluations-and-performance.md](17-evaluations-and-performance.md) | Working on staff ACR, incident reports, teacher surveys (and the sealed-results rule), or the student/class/staff Performance tabs |
| [18-staff-attendance-leave.md](18-staff-attendance-leave.md) | Working on staff attendance, staff profiles, leave policies/requests, or the live leave-balance formula |
| [19-student-lifecycle.md](19-student-lifecycle.md) | Working on a student leaving, graduating or being readmitted, student profile records / health notes / staff notes / public-exam results, or the admission and leaving report |
| [20-presets.md](20-presets.md) | Working on `modules/presets` — curriculum packs (NCTB, Alia, Qawmi, Cambridge, Blank), applying or resetting a school's preset, subject choice groups, exam templates from a pack, or adding a new board or country |
| [21-ui-patterns.md](21-ui-patterns.md) | Designing, planning or building any screen: page shapes, page vs full-page modal vs dialog, table / filter / form rules, date-number-money formats, phone rules, wording, the component catalogue, and how to mock a screen up from the kit |
| [22-demo-seed.md](22-demo-seed.md) | Adding or changing **any table or column** (the demo seed must get rows for it), working on `seed:demo`, the demo site, `DEMO_MODE`, load-test data, or **running the demo site** (nightly reset, env, sweep, rollback) |
| [23-attention.md](23-attention.md) | Working on the attention bar/modal, alert rules, the to-do/history page, manual alerts, the alerts report, push mute/quiet hours, or the guardian SMS fallback |
| [24-applications.md](24-applications.md) | Working on `modules/applications` — any application type (leave, fee waiver, certificates, general letters), who decides it, what approval does, the inbox/pending count, or the portal application pages |
| [25-cloudflare.md](25-cloudflare.md) | Changing a Cloudflare setting: the tunnel, DNS, Access apps for staging and ops, cache and WAF rules, Turnstile widgets, R2 tokens, or what direct mode replaces |
| [26-dashboard.md](26-dashboard.md) | Working on `/dashboard`: role dashboards, widgets and the widget catalogue, adding a widget, the layout and digest preferences, the morning summary push, or committee aggregates |
| [27-qa-audit-lessons.md](27-qa-audit-lessons.md) | You are fixing a bug found by QA, or closing a wave of Epic #2642 |
| [28-platform-runbook.md](28-platform-runbook.md) | Running the servers: day-0 checklist, provisioning, `biddaloy-deploy`, releases and rollback, the verification log, restore, secret rotation, growing or moving the VM. Part 10b (test inbox deploy) also in Bangla: [bn/test-inbox-deploy.md](bn/test-inbox-deploy.md). The staging databases, the nightly drill and part 10b together, in plain Bangla for the owner: [runbook-bn/staging-and-test-inbox.md](runbook-bn/staging-and-test-inbox.md) |
| [29-landing.md](29-landing.md) | Working on the public marketing site `landing/`: content flags, third parties and consent, sitemap/robots/`llms.txt`/JSON-LD, the Lighthouse budget and Playwright smoke in CI, copy rules, screenshots |
| [30-deployment-target.md](30-deployment-target.md) | Asking *why* the deployment is shaped this way (decisions D1–D26), how it compares with a larger company, *when* to add HA, a managed DB, a second VM or Cloudflare as code (future-work triggers), or what each Epic 79.0 wave learned |
| [31-vps-deploy-walkthrough.md](31-vps-deploy-walkthrough.md) | **Deploying from zero** on any domain, VM or provider: the complete step-by-step guide (laptop tools, keys, Cloudflare, GitHub, Telegram/Sentry/SMS, provision, secrets, images, first deploy, first accounts, Kuma/Beszel/Dozzle, verify, everyday releases, moving VM, new domain, direct mode) with every problem hit on the first real deploy and its fix |
| [32-programs.md](32-programs.md) | Working on `modules/programs` — a program's milestones, student enrolment/progress, the program fee audience, or the report-card Programs block |
| [33-print-module.md](33-print-module.md) | Working on `modules/print` or `print/` in shared/client — templates and the editor, printer profiles, print jobs and history, certificates and serial numbers, the certificate register, exam documents (admit cards, seat lists, tabulation), the public `/v/:token` verify page, or adding a new document kind |
| [34-onboarding.md](34-onboarding.md) | Working on `/register`, the welcome wizard and setup checklist, the free trial and seat limit, first-password, or Google sign-in |
| [35-study-plans.md](35-study-plans.md) | Working on `modules/study-plans` — lesson plans per section and subject, marking periods taught, how expected dates are computed, the study-plan template library and CSV, or the late-marking escalation |
| [36-domain-invariants.md](36-domain-invariants.md) | Planning or reviewing any change to money, enrolment, results, attendance, tenancy or permissions — the rules that must always hold, and the code that enforces each one |
| [37-dashboard-load-test.md](37-dashboard-load-test.md) | Running or changing the manual 10,000-student dashboard load test (`load:seed`, `run-dashboard-load.ts`), or reading its p95-per-widget table |
| [38-billing.md](38-billing.md) | Working on seat orders, the bKash pay step and its callback, the reconciler, the numbered receipt, or `platform_payments` |
| [39-user-guide.md](39-user-guide.md) | Working on `docs/user-guide/` (the bilingual GitBook help guide), adding a guide page for a new screen, the page template, `guide:check` / `guide:impact`, generated guide files, or the `User guide: not affected` PR line |
| [40-reporting-engine.md](40-reporting-engine.md) | Working on `modules/reports` beyond the coded collections report — the report registry and compiler, report definitions and versions, runs, CSV/XLSX exports, the Reports hub and designer, schedules and snapshots, or the BANBEIS student count |
| [41-reporting-load-test.md](41-reporting-load-test.md) | Running or changing the reports load test (`report-runner.perf.spec.ts`, 3,000 students, p95 under 2 s), adding an index for a report, or reading the plans behind the `ReportingIndexes` migration |

For practical "how do I run/develop/test this" instructions, see the root
[`README.md`](../../README.md) — these docs cover the _why_ behind the
architecture, README covers the _how_ of working in the repo day to day.
