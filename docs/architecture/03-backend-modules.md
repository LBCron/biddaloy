# Backend Modules

All server code lives in `server/src/modules/*`, one NestJS module per
folder. All routes are served under `/api/v1/...` (see the root README's
"API Versioning" section for the versioning/deprecation policy).

```mermaid
flowchart LR
    subgraph Identity
        auth["auth\nlogin/refresh/logout"]
        users["users\nUser + Teacher CRUD"]
        schools["schools\ntenant + settings\n(no public CRUD API yet)"]
    end
    subgraph Academics
        academics["academics\nAcademicYear controller"]
        classes["classes\nClass + ClassSection"]
        students["students\nStudent + Guardian + bulk upload"]
        enrollments["enrollments"]
        attendance["attendance\nregisters, corrections,\ndevice ingest"]
        calendar["calendar\nevents, terms, import/export,\nICS feed, public holidays"]
        grading["grading\nGradingScale + GradingBand"]
        exams["exams\nExam/marks/results (Epic 19.0)\n+ AnalysisService (merit/defaulted/pass-fail, Epic 26.5)"]
        promotions["promotions\nPromotionRun + PromotionEntry (Epic 26.6-26.8)"]
    end
    subgraph Money
        fees["fees\nFeeStructure, generation,\ndues, payments"]
        invoices["invoices"]
    end
    subgraph Ops
        communications["communications\nreminders, adapters"]
        audit["audit\nread-only log viewer"]
        health["health\n/api/health"]
    end
    subgraph Timetabling
        routines["routines\nshifts, rooms, routine slots,\nsubstitutions, change requests"]
    end

    auth --> users
    students --> classes
    students --> fees
    fees --> invoices
    fees --> communications
    attendance --> classes
    attendance --> communications
    calendar --> attendance
    calendar --> communications
    routines --> classes
    routines --> academics
    routines --> attendance
    exams --> classes
    exams --> students
    exams --> grading
    exams --> communications
    promotions --> exams
    promotions --> classes
    promotions --> enrollments
```

## Module reference

| Module           | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Key routes (all under `/api/v1/`)                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | Login, refresh-token rotation, logout, access-token denylist, login lockout                                                                                                                                                                                                                                                                                                                                                                                                                   | `POST auth/login`, `POST auth/refresh`, `POST auth/logout`, `POST auth/logout-all`                                                                                                                                                                                                                                                                                                  |
| `users`          | `User` + `Teacher` CRUD                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `POST/GET/PATCH/DELETE users`, `POST/GET/PATCH teachers`                                                                                                                                                                                                                                                                                                                            |
| `schools`        | `School` (tenant) entity + per-tenant settings (comms provider config, currency, etc.)                                                                                                                                                                                                                                                                                                                                                                                                        | Internal service only today — no public controller yet                                                                                                                                                                                                                                                                                                                              |
| `academics`      | `AcademicYear` (no longer owns holidays — see `calendar`)                                                                                                                                                                                                                                                                                                                                                                                                                                     | `POST/GET/PATCH/DELETE academic-years`, `POST academic-years/:id/set-current`                                                                                                                                                                                                                                                                                                       |
| `classes`        | `Class` + `ClassSection` + `TeacherScopeService` (teacher role in a section)                                                                                                                                                                                                                                                                                                                                                                                                                  | `POST/GET/PATCH/DELETE classes`, nested `.../sections` routes; `GET /my-class/sections`; `GET/POST/DELETE /coordinators` (`CoordinatorsController`, `CLASS_MANAGE`); `GET /coordination/overview`, `POST /coordination/alerts` (`CoordinationController` in `CoordinationModule`, `COORDINATION_VIEW`)                                                                              |
| `students`       | `Student`, `Guardian`, Excel bulk upload                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `POST/GET/PATCH/DELETE students`, `POST students/bulk-upload`, `POST/GET/PATCH/DELETE guardians`                                                                                                                                                                                                                                                                                    |
| `enrollments`    | `Enrollment` history                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `POST enrollments`, `GET enrollments/student/:studentId`, `PATCH enrollments/:id`                                                                                                                                                                                                                                                                                                   |
| `attendance`     | `AttendanceSession`/`Record`, corrections, summaries, auto-absent notices, device ingest                                                                                                                                                                                                                                                                                                                                                                                                      | `GET attendance/my-sections`, `PUT attendance/sections/:id/register`, `PATCH attendance/records/:id`, `GET attendance/flags/low`, `POST attendance/device-events` — see [11-attendance.md](11-attendance.md)                                                                                                                                                                        |
| `fees`           | `FeeStructure`, fee generation engine, dues/flagging, `Payment` + allocations                                                                                                                                                                                                                                                                                                                                                                                                                 | `POST/GET/PATCH/DELETE fee-structures`, `POST fees/generate`, `GET fees/dues`, `GET fees/dues/flagged`, `POST payments/checkout`                                                                                                                                                                                                                                                    |
| `invoices`       | `Invoice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `POST/GET invoices`, `GET invoices/:id/print`                                                                                                                                                                                                                                                                                                                                       |
| `communications` | `CommunicationLog`, `ReminderBatch`, provider adapters                                                                                                                                                                                                                                                                                                                                                                                                                                        | `POST communications/send`, `POST communications/reminder/single/:studentId`, `POST communications/reminder/bulk`                                                                                                                                                                                                                                                                   |
| `calendar`       | `CalendarEvent`, `AcademicTerm`, `CalendarEventClass`, `CalendarFeedToken`, `PublicHolidaySet` — see [16-academic-calendar.md](16-academic-calendar.md)                                                                                                                                                                                                                                                                                                                                       | `POST/GET/PATCH/DELETE calendar/events`, `POST/GET academic-terms`, `POST calendar-import/validate`, `POST calendar-import/commit`, `GET calendar/feed`, `GET calendar/feed/:token.ics`, `GET/POST public-holidays`                                                                                                                                                                 |
| `grading`        | `GradingScale`, `GradingBand`, band-validation, recompute preview/confirm — see [01-domain-model.md](01-domain-model.md#grading-modulesgrading)                                                                                                                                                                                                                                                                                                                                               | `POST/GET/PATCH/DELETE grading/scales`, `POST grading/scales/:id/copy`, `POST grading/scales/:id/bands/preview`, `POST grading/scales/:id/bands/confirm` (approval-gated)                                                                                                                                                                                                           |
| `exams`          | `Exam`, `ExamComponent`, `MarkGrid`, `Mark`, `Result`, `ResultSubject`, `StudentSubjectChoice` (Epic 19.0); `AnalysisService` — merit list, defaulters, pass/fail (subject- and component-level), CSV exports, all read over already-computed `Result`/`ResultSubject` rows (Epic 26.5) — see [01-domain-model.md](01-domain-model.md#exams-marks--results-modulesexams--epic-190)                                                                                                            | `POST/GET/PATCH exams`, `POST/GET/PATCH exams/:id/components`, `GET/PATCH exams/:id/marks`, `POST exams/:id/marks/submit`\|`reopen`, `GET exams/:id/marks/progress`, `GET exams/:id/results`, `POST exams/:id/results/process`\|`publish`\|`reopen`\|`sms`, `GET students/:id/results`, `GET exams/:id/analysis/merit`\|`defaulted`\|`pass-fail`\|`pass-fail/components` (+ `.csv`) |
| `promotions`     | `PromotionRun`, `PromotionEntry` — draft, preview, override, commit an end-of-year class promotion (D7 mean-GPA ranking, D8 BLOCK/SNAKE section placement) — see [01-domain-model.md](01-domain-model.md#promotions-modulespromotions--epic-266268)                                                                                                                                                                                                                                           | `POST/GET promotions`, `GET promotions/:id`, `PATCH promotions/:id/entries`, `POST promotions/:id/refresh`\|`commit` (approval-gated, `ApprovalScope.PROMOTION_OVERRIDE`), `DELETE promotions/:id`, `GET promotions/suggest-target`, `GET students/:id/promotion-overrides`                                                                                                         |
| `audit`          | Read access to `AuditLog`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `GET audit`                                                                                                                                                                                                                                                                                                                                                                         |
| `health`         | Liveness check, version-neutral                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `GET /api/health`                                                                                                                                                                                                                                                                                                                                                                   |
| `routines`       | `Shift`, `PeriodSlot`, `Room`, `Routine`, `RoutineSlot`, `RoutineSlotTeacher`, `RoutineSubstitution`, `RoutineChangeRequest` — see below                                                                                                                                                                                                                                                                                                                                                      | `POST/GET/PATCH/DELETE routines/shifts`, `PUT routines/shifts/:id/period-slots`, `POST/GET routines/rooms`, `POST/GET routines`, `POST/GET routines/:id/slots`, `PATCH/DELETE routines/slots/:slotId`, `POST routines/:id/submit-for-review`, `POST routines/:id/publish`, `GET routines/resolve`, `POST routines/substitutions`, `POST routines/slots/:slotId/change-requests`     |
| `study-plans`    | `StudyPlan`, `LessonDelivery`, `StudyPlanTemplate` — lesson plans per section × subject, dated on read (never stored); see [35-study-plans.md](35-study-plans.md)                                                                                                                                                                                                                                                                                                                             | `GET/POST/PATCH/DELETE study-plans`, `GET study-plans/:id/schedule`, `PUT study-plans/:id/lessons`, `PUT lesson-deliveries`, `GET/POST study-plan-templates`, `GET students/:studentId/study-plans`                                                                                                                                                                                 |
| `applications`   | applications + events + tags + attachments, the type catalogue handlers, reviewer rules (`ReviewerScopeService`), letter snapshot, notify. Routes: `POST/GET /applications`, `GET /applications/:id`, `POST /applications/:id/{approve,reject,consider,withdraw,cancel,comments,tags,attachments}`, `POST /applications/bulk-approve`, `GET /applications/{pending-count,reports,addressees,tag-options}`, `POST /applications/letter-preview` — see [24-applications.md](24-applications.md) |
| `reports`        | Coded `CollectionsReportService` plus, from Epic 8.15: `reports/engine` (registry, compiler, security, runner), `reports/export` (CSV/XLSX streaming, run log, queue), `reports/definitions` (drafts, versions, catalogue) — see [40-reporting-engine.md](40-reporting-engine.md)                                                                                                                                                                                                             |

### `TeacherScopeService` (classes module)

`server/src/modules/classes/teacher-scope.service.ts`. It answers one
question: **what is this teacher's role in this section?** The JWT carries a
**user** id, so it does the join `user → teachers.user_id →
teacher_class_sections` for you, with `tenant_id` on every table.

```mermaid
flowchart LR
  C["MyClassController<br/>GET /my-class/sections"] --> T["TeacherScopeService"]
  M["MarksAuthorizationService<br/>(exams)"] --> T
  T --> R1["rolesInSection(user, section)<br/>→ homeroom: CLASS | ASSISTANT | null<br/>+ live subjectIds"]
  T --> R2["homeroomSections(user)<br/>→ current-year CLASS/ASSISTANT sections"]
  F["FamilyAccessService.assertLinked<br/>students.controller lists, notes, enrollments"] --> S["teacherSectionIds / teacherCanSeeStudent<br/>(free functions, current year only)"]
  T --> S
```

- `rolesInSection` returns `subjectIds` of **live** subjects only. A
  soft-deleted subject loses its teacher's marks access.
- `homeroomSections` keeps the current academic year only and skips
  soft-deleted sections and classes. It backs `GET /my-class/sections`
  (`MY_CLASS_VIEW`, TEACHER only).
- It only answers for the teacher's own rows. Tenant-wide roles never reach
  it: callers check `hasTenantDataScope` first.

**This is the place new teacher-scope checks go.** Epic 75 (75.6 to 75.6-e)
moves the caller-scope joins onto this file, **current academic year only**.
A teacher miss is **404**, never 403 (D13). A teacher with no assignment gets
empty lists.

One query answers "which sections does this teacher see?": every live
CLASS / ASSISTANT / SUBJECT row in a live section of a live class of the
**current** year (a SUBJECT row counts only while its subject is live). It is
exported as plain functions that take an `EntityManager`, so modules that
cannot import `ClassModule` (Student, Enrollment) still use it:

| Function                                            | Returns                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `teacherAssignments(manager, { userId, tenantId })` | `{ section_id, class_id, assignment_type, subject_id }[]`                                     |
| `teacherSectionIds(manager, { userId, tenantId })`  | distinct `section_id`s                                                                        |
| `teacherCanSeeStudent(manager, { …, studentId })`   | `true` when a live student of the tenant sits in a visible section; `false` for a non-UUID id |

`TeacherScopeService` has thin wrappers (`currentAssignments`, `sectionIds`,
`canSeeStudent`). `rolesInSection` and `teachesSubjectInClass` are unchanged,
so marks behave as before.

#### Coordinators widen reads, never writes (Epic 83)

A **coordinator** row (`coordinator_assignments`, see
[01-domain-model.md](01-domain-model.md#coordinators-coordinator_assignments-epic-83))
adds every section of a coordinated class to what a teacher may **read**. It
counts only when the caller passes `includeCoordinated: true` (D18). The
default is `false`, so a call site that does not pass it answers exactly as
before.

```mermaid
flowchart LR
  R["read route<br/>(students, register, results…)"] -- "includeCoordinated: true" --> T["TeacherScopeService"]
  W["write route / fees / messages"] -- "no flag" --> T
  T --> A["teaching rows<br/>(teacher_class_sections)"]
  T -- "only with the flag" --> B["coordinator rows<br/>(coordinator_assignments, current year)"]
  A --> U["section ids = A ∪ B"]
  B --> U
```

`rolesInSection` also returns `coordinated: { allSubjects, subjectIds }` (D19).
`homeroom` and `subjectIds` never include coordinator rows, so the marks write
gate (`assertCanWrite`, `writableSubjects`) is unchanged. `coordinatedClasses()`
lists the caller's rows for My coordination.
The flag can also be `'classLevel'`: only class coordinators widen, for reads that show every
subject at once (results, analysis), so a subject coordinator never sees another subject's marks
there.

| Call site                                                            | Passes the flag?    | Why                                                   |
| -------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| `students.controller` lists, `GET /students/:id`, guardians          | yes                 | D4 read                                               |
| `results.controller`, `analysis.controller`                          | `'classLevel'`      | D4: every subject at once, so class coordinators only |
| `MarksAuthorizationService.assertCanRead` (grid read)                | yes (`coordinated`) | subject coordinators read their subject only          |
| attendance register view, record history, periods, section summaries | yes                 | D4 read; marking never passes it                      |
| homework analytics (`assertCanViewSection` / `assertCanViewClass`)   | yes                 | D4 read                                               |
| study plans `canRead`                                                | yes (`coordinated`) | D4 read; `canWrite` unchanged                         |
| `search.service`, `attention-query.service` student alerts           | yes                 | D4 read                                               |
| homework list / detail                                               | **no**              | the same `findOne` gates homework writes              |
| marks write, attendance marking, finalize, corrections, matrix save  | **no**              | D4: coordinators never write                          |
| fees, fines, checkout, payments, communications                      | **no**              | D5: oversight is academic                             |

Example: Rahim teaches only 6-A but coordinates Class 7. `GET /students/<a 7-B
student>` is 200; `PUT /attendance/sections/<7-B>/register` is still 404, and so is
`GET /payments/student/<that student>`. The enforcing spec is
`server/src/coordinator-scope.e2e-spec.ts`.

**Teacher-reachable routes and where each is scoped (Epic 75 audit).** Scope for
every row: the student sits in a section where the caller has any live row in the
current year. Per-subject writes (marks, homework) keep their subject rules.

| Route(s)                                                                                                                                                                                                                                                                  | Scoped by                                                                              | Ticket             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| `GET /students`, `GET /students/ids`, `GET /guardians`, `GET /guardians/:id`                                                                                                                                                                                              | `sectionScope` (now current-year only); guardian miss is 404                           | 75.6               |
| `GET /students/:id`, `/students/:id/photo`, and every route that calls `FamilyAccessService.assertLinked` (payments/student, wallet, attendance/students/:id/\*, transcript, document prints, admit card, student results, programs per student, study plans per student) | `assertLinked` TEACHER branch, 404                                                     | 75.6               |
| `GET /enrollments/student/:studentId`, `GET /enrollments/:studentId/current`                                                                                                                                                                                              | `teacherCanSeeStudent` in the controller, 404                                          | 75.6               |
| `GET/POST /students/:id/notes`, `DELETE …/notes/:noteId`                                                                                                                                                                                                                  | `teacherSectionIds` in `student-notes.service.ts`, 404                                 | 75.6               |
| `GET /students/:id/lifecycle-events`, `GET /students/:id/public-exams`                                                                                                                                                                                                    | `assertLinked`, 404                                                                    | 75.6               |
| Attendance section routes                                                                                                                                                                                                                                                 | `AttendanceAccessService` own join, any year, 403                                      | 75.6-b             |
| Homework routes, `performance/students/:id`, `performance/classes/:id`                                                                                                                                                                                                    | `HomeworkAccessService` / `performance.service.ts` own joins                           | 75.6-c             |
| `GET /fees/dues`, `/fees/dues/flagged`, `/fees/fines`, `/payments/guardian/:id`, `/payments/cart`, `/students/:id/discount-rules`, `communications/*`, `audit-logs/entity/:type/:id`                                                                                      | none today                                                                             | 75.6-d             |
| `GET /exams/:examId/results`, `…/results/:studentId`, `exams/:examId/analysis/*`, `GET /search`                                                                                                                                                                           | `sectionScope` / `assertCanSeeStudent` (403 today) or none                             | 75.6-e             |
| Marks, syllabus, study plans, lesson deliveries, attention, my-class                                                                                                                                                                                                      | `TeacherScopeService` already                                                          | no change          |
| `GET /programs/:id/enrollments`, `POST /programs/:id/achievements`, `DELETE /milestone-achievements/:id`                                                                                                                                                                  | none, on purpose: programs (Hifz, clubs) run across sections and D2 does not list them | accepted exception |
| Calendar, routines, notices, dashboard, academic structure, applications, surveys, own staff attendance                                                                                                                                                                   | open, per D2                                                                           | no change          |
| Incidents/ACR, staff-hr, leave approve                                                                                                                                                                                                                                    | TEACHER lacks `ACR_READ` / `STAFF_HR_READ` / `LEAVE_APPROVE`                           | unreachable        |

**Marks rules** (`MarksAuthorizationService`, `exams/marks-authorization.util.ts`),
for a teacher without tenant-wide data scope:

| Action | Allowed when                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| Write  | a `SUBJECT_TEACHER` row for that exact, live (not deleted) subject. Homeroom never writes                      |
| Read   | that same subject row, **or** a `CLASS_TEACHER` / `ASSISTANT_CLASS_TEACHER` row for the section (all subjects) |

Both also need `rolesInSection().inYearWindow`: the section is in the current
academic year, **or** in last year while its class still has a DRAFT exam
(X-07, kept by D31). Example: the admin flips the year to 2027 while Class 7's
2026 half-yearly is still DRAFT. The 2026 Math teacher can still finish that
sheet, and the marks-due alerts still name them. Once the exam is published,
current-year-only applies again. A PROCESSED exam does not hold the window
open (D45): if the 2026 half-yearly is already processed and no DRAFT exam is
left, only an admin can correct its marks.

A teacher miss is a **404** with the missing-section body (`Section with ID
"<id>" not found`, D33), like every other teacher route.
`GET /exams/:examId/marks/progress` lists and counts only the (section,
subject) grids a teacher may **write** (`writableSubjects`, D44). Example: the
class teacher of 7A who teaches Math sees "7A Math", not "7A English". They can
read the English sheet, but every save on it would 404. `GET /performance/classes/:classId`
without `sectionId` aggregates only the teacher's own sections (D35), the same
rule as `exams/:examId/analysis/*`.

## Routines module

`server/src/modules/routines/` (Epic 21.0, class routine/timetable). Owns
the eight entities in
[01-domain-model.md](01-domain-model.md#class-routines--timetables-modulesroutines)
and one service per concern rather than one god-service:

```mermaid
flowchart TD
    shiftsSvc["ShiftsService\n+ PeriodSlotsService"] -->|"day layout"| slotsSvc
    roomsSvc["RoomsService"] -->|"optional room per slot"| slotsSvc
    slotsSvc["RoutineSlotsService\n(create/update/delete a slot)"] -->|"every write"| constraintCheck["ConstraintCheckService\n(hard-constraint validation)"]
    constraintCheck -->|"blocks a save on violation"| slotsSvc
    greedyFill["GreedyFillService\n(fills empty slots)"] --> slotsSvc
    stateSvc["RoutineStateService\n(DRAFT to REVIEW to PUBLISHED)"] --> slotsSvc
    resolveSvc["ResolveRoutineService\n(GET /routines/resolve)"] -->|"reads"| slotsSvc
    resolveSvc -->|"applies dated overrides"| subsSvc["SubstitutionsService"]
    changeReqSvc["ChangeRequestsService"] -->|"targets a published slot"| slotsSvc
    workloadSvc["WorkloadService\n(periods/teacher/day)"] -->|"reads"| slotsSvc
    copySvc["CopyRoutineService\n(copy a routine to a new year)"] --> slotsSvc
```

- **`ConstraintCheckService`** is the hard-constraint gate (D1 below): a
  teacher can't be in two places at once, a section can't have two subjects
  in one slot. It runs on every slot write and blocks the save with a 409
  rather than silently overwriting.
- **`ResolveRoutineService`** (`GET routines/resolve`) is the one place
  recurrence (weekly/biweekly/monthly), effective dating
  (`valid_from`/`valid_to`), weekly-off/holiday exclusion, and dated
  substitutions all get resolved into "what actually happens on this date" —
  every agenda view (`/routines/my`, `/portal/routine`) calls this instead
  of re-deriving any of that logic client-side.
- **`RoutineStateService`** enforces the one-way-ish lifecycle: a change on
  a _published_ routine must go through a `RoutineChangeRequest`, never a
  direct edit — see `RoutineChangeRequest`'s entry in the domain-model doc.

### Deferred, with context

Copied from Epic 21.0's own tracking issue (#783) so a future reader doesn't
need to open GitHub to find out why something obviously useful isn't here
yet.

- **Auto-generating the routine (a real constraint solver).** Deliberately
  not built (D1). The pain in a 30-teacher school is errors, not typing, and
  the binding constraints are political and invisible to a model — senior
  teacher gets mornings, these two must never be adjacent. Schools that run
  solvers hand-fix a large slice of the output. What ships instead:
  hard-constraint validation plus a greedy fill for empty slots. **Trigger
  to revisit:** a school with 40+ sections says manual entry is unworkable.
  **Hooks left:** the constraint values already live in
  `TenantSettings.routine` (D19), and the greedy fill is its own service, so
  a solver replaces one function rather than a subsystem.
- **Drag-and-drop grid editing.** Deferred, not rejected (D17). The keyboard
  model has to exist first because it is the accessibility gate; drag layers
  on top of it cleanly and the reverse never happens.
- **Projecting routine slots into `calendar_events`.** #701 left
  `external_refs jsonb` for exactly this and forbade RRULE on the calendar
  side. Additive later. Note `calendar_event_classes` is class-level —
  projecting a section-level routine needs the nullable `section_id` #701
  already flagged as additive.
- **Google Calendar push.** #701 claims routine depends on it; backwards
  (D5) — it is a consumer. Needs a Google Cloud project, OAuth consent, a
  Workspace admin decision and guardian emails, which many BD guardians do
  not have.
- **Period attendance auto-created from the routine.**
  `AttendanceSession.period_no` and `subject_id` already exist and nothing
  populates them meaningfully. This epic ships the resolver (D14) that
  makes it possible; whether attendance auto-creates sessions is a policy
  call belonging to **Epic 41.0**.
- **Online class links per slot** (Epic 37.0) and **homework note per slot**
  (Epic 22.0). Both hang off a routine slot; the resolver returns slot ids,
  which is all either needs.
- **Printing routine sheets** — Epic 32.0's document service.
- **"Your first class is at 10" notifications.** #701 deferred reminders
  generally, pending demand; same call here.
- **Exam routine** — D13; its own issue on Epic 19.0 once `Exam` exists.

## Cross-cutting `common/`

`server/src/common/` holds code every module leans on, not owned by any one
feature:

- **`decorators/api-tenant-auth.decorator.ts`** — the `@ApiTenantAuth()`
  bundle every tenant-scoped controller applies (see
  [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)).
- **`decorators/sanitize-text.decorator.ts`** — strips/allowlists HTML from
  free-text input fields (guardian notes, reminder messages, etc.).
- **`rate-limit/`** — per-route throttling tiers, backed by a fail-open
  Redis storage (rate limiting fails _open_, not closed — a Redis outage
  degrades protection but never takes the API down).
- **`filters/http-exception.filter.ts`** — the single place every uncaught
  exception becomes a consistent JSON error body.
- **`request-context.util.ts`** — per-request context (current tenant,
  user, role) threaded through services without prop-drilling it manually.

## API versioning

All routes are served under `/api/v1/` (`main.ts`'s `enableVersioning`, URI
style — visible in logs, curl-able, cacheable, and trivially routable at
nginx via a broad `location /api/` prefix match, no rewrite needed).
`/api/health` is version-neutral (`@Version(VERSION_NEUTRAL)` on
`AppController.health`) and stays reachable at that exact path regardless of
version bumps, so orchestrator health checks never break on one.

`server/src/api-versioning.ts` is the single place that knows the current
version string, read by both `main.ts` and `server/test/helpers/e2e-app.helper.ts`.
That covers today's single-version setup (every route is `1` by default);
it is **not** by itself enough to run two versions side by side — see below.

### Deprecation policy

Introducing `/api/v2/...` while `/api/v1/...` stays live is not a one-line
change: `enableVersioning`'s `defaultVersion` would need to become `['1',
'2']`, and every route whose v2 behavior differs from v1 needs an explicit
`@Version('1')` (or `'2'`) so the two don't collide on the same handler.
There's no code for this yet — it's written up here so the first real bump
follows a plan instead of improvising one under pressure:

- `/api/v2/...` is added alongside `/api/v1/...` — routes are never removed
  in the same change that adds their replacement.
- `/api/v1/...` stays live for **at least 90 days** after `/api/v2/...`
  ships, giving the first-party SPAs (the only current consumers) a full
  sprint-scale window to migrate.
- Once a removal date is set, deprecated (`/api/v1/...`) responses carry a
  `Deprecation` header per [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html)
  (a structured Unix timestamp, e.g. `Deprecation: @1735689600`) and a
  `Sunset` header per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html)
  (an HTTP-date, e.g. `Sunset: Thu, 01 Jan 2026 00:00:00 GMT`), so any
  consumer — including a future third-party one — can detect the
  deprecation programmatically without reading docs.
- The bump and its sunset date are announced in this section and in the
  epic/issue tracking the migration — there's no separate public changelog
  yet.

## API documentation (Swagger)

Interactive docs (`server/src/swagger.ts`, `server/src/docs-auth.ts`) are
reachable at **`/api/docs`** — version-neutral, like `/api/health`, so the
docs URL doesn't move on a version bump. The bearer scheme and the
`X-Tenant-ID`/`X-Role` header contract (see `ApiTenantAuth` in
`server/src/common/decorators/`) are documented on every guarded
controller, so "Try it out" works once you paste in a token.

**Gating** (`shouldMountDocs` in `swagger.ts`):

- Outside production, docs always mount, unauthenticated — nothing sensitive
  about a dev environment's own API shape.
- In production, docs are off by default: the route doesn't exist (a real
  404, not a rejection) unless `ENABLE_API_DOCS=true` is set.
- With `ENABLE_API_DOCS=true` in production, the route is additionally
  gated by Basic Auth (`API_DOCS_USER`/`API_DOCS_PASSWORD`, both required —
  the app refuses to boot with `ENABLE_API_DOCS=true` and no credentials
  set, rather than silently serving the docs unauthenticated).

**Generating a client**: `docs:generate` first builds `@biddaloy/shared` (`predocs:generate`) and, run directly, still needs DB env. `yarn docs:generate` (from `server/`) writes the
current OpenAPI document to `server/openapi.json`, for the SPAs to generate
a typed client from (`yarn api:types` at the repo root runs both steps —
see the root README's "Regenerating API types"). This runs `nest build`
first and executes the **compiled** script (`node dist/scripts/generate-openapi.js`),
not `ts-node` — `@nestjs/swagger`'s CLI plugin (`nest-cli.json`'s
`compilerOptions.plugins`), which auto-infers `@ApiProperty()` for DTO/
entity fields from their TypeScript types, only runs through Nest's own
build compiler. Running the script via `ts-node` instead produces a
document with every DTO schema empty — Nest's compiler is what makes the
annotations effectively free instead of a decorator on every one of ~50
DTO classes.

**No sensitive field ever appears in a schema**: `User.password_hash` is
marked `@ApiHideProperty()` directly on the entity, so it's excluded from
every schema that references `User` — including ones no current endpoint
actually returns with that relation populated (Guardian.user, Student.user,
Payment.received_by) — not just the ones a controller happens to sanitize
today. Verified by generating the real document (`yarn docs:generate`) and
confirming zero `password_hash` occurrences; this can't be verified by an
ordinary Vitest test, since the CLI plugin (and therefore the schema
shape) doesn't run under Vitest's SWC-based transform at all.

## Adding a new module

Follow the shape of an existing one (`enrollments` is a good small
example): `*.module.ts`, `*.controller.ts` with `@ApiTenantAuth()` +
`@Roles(...)`, `*.service.ts`, `entities/*.entity.ts` with a relations
docstring (see [01-domain-model.md](01-domain-model.md) for the convention),
`dto/*.dto.ts` for request/response shapes. Every new controller/service
needs corresponding tests — see `server/CLAUDE.md` for the testing
standards enforced in this package.
