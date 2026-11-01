<!-- guide:meta
feature: dashboard
title: Seeing today's work on the dashboard
summary: See on the first page after sign-in what needs your attention today, and go to the right page in one press.
roles: [ADMIN, EXECUTIVE, TEACHER, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER, COMMITTEE]
sources:
  - client-admin/src/dashboard/layout/dashboard-page.tsx
  - client-admin/src/dashboard/layout/briefing-slot.tsx
  - client-admin/src/dashboard/layout/dashboard-grid.tsx
  - client-admin/src/dashboard/layout/widget-slot.tsx
  - client-admin/src/dashboard/layout/committee-summary.tsx
  - client-admin/src/routes/portal/index.tsx
  - shared/src/dashboard/widget-catalogue.ts
labels:
  [
    dashboard:page.*,
    dashboard:states.*,
    dashboard:committeeSummary.privacyNote,
    dashboard:committeeSummary.printReport,
    attention:bar.*,
    attention:modal.empty,
    attention:modal.seeAll,
    portal:today.*,
    portal:heatmap.title,
    portal:homeworkCard.title,
    portal:latestResult.title,
    portal:nextHoliday.title,
    portal:fees.dueThisMonth,
    nav:items.dashboard,
    nav:items.portalOverview,
  ]
helpIds: [dashboard]
devices: [desktop, phone]
entry: [sidebar, palette, notification:morning-digest]
keywords: [dashboard, home, first page, today's work, to-do, widgets, briefing]
appVersion: 0.1.0 (6b36c2549)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# Seeing today's work on the dashboard

See on the first page after sign-in what needs your attention today, and go to the right page in one press.

**Go to:** **Dashboard** in the left menu. On a phone, the **☰** menu at the top left ([opening on a phone](../start/phone.md)).
**Before you start:** nothing. The dashboard is already set up for every staff role.

The **dashboard** ([glossary](../help/glossary.md#dashboard)) is a page of **widgets**. A widget is a small card: it holds a number or a short list, and a link to the place where you do that work. Your role decides which widgets you get; a teacher and an accountant do not see the same page.

[See today's work](#task-main) · [Dashboard by role](#task-roles) · [On a phone](#task-phone) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [See today's work](#task-main)
- [How to know the dashboard loaded properly](#confirm)
- [Other situations](#other)
  - [Dashboard by role](#task-roles)
  - [The committee member's dashboard](#task-committee)
  - [The dashboard on a phone](#task-phone)
  - [The guardian's Overview page](#task-portal)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**From the left menu:** press **Dashboard**. Start at step 1 below.

**From search:** in the search box at the top (Ctrl+K) type "dashboard" and choose it. How search works: [Find any page](../start/find-anything.md).

**From the morning summary notification:**

1. On a school day, a notification arrives on your phone or computer in the morning, saying how many things need your attention today. How to turn it on or off: [Alerts and notifications](alerts.md#task-digest).
2. Press the notification. → The dashboard opens. Start at step 1 below.

---

## See today's work <a href="#task-main" id="task-main"></a>

1. Press **Dashboard** in the left menu.

   → The **Dashboard** title at the top, with today's weekday and date below it. The **Customise** button is on the right.

2. Read the long row just under the title. This is today's summary: how many alerts are open for you.

   → For example **2 urgent · 3 warnings**, with **most urgent: …** below. If there is nothing, it says **Nothing needs you right now.**

<img src="img/dashboard-01-admin.png" alt="top of the dashboard, with the summary row and the See all to-do button marked, admin">

3. To see the full list, press **See all to-do (n)** on the summary.

   → The **Alerts & notifications** page opens, on the **To-do** tab. What each alert means and what to do: [Alerts and notifications](alerts.md).

4. Scroll down. Look at the number on each widget, and press the link for the work you want to do.

   → The page for that work opens. What each widget means: [What the widgets mean](widgets.md).

<img src="img/dashboard-01-admin.png" alt="the whole dashboard, the grid of widgets, admin">

> **Keep in mind:** the dashboard only shows. Pressing something here changes no data; the work happens on the page the link opens.

To change the order or which widgets show: [Customising the dashboard](customise.md).

---

## How to know the dashboard loaded properly <a href="#confirm" id="confirm"></a>

This page saves nothing. Each widget loads on its own, so you can tell the state of one widget like this:

| State                   | How you can tell                                           | What next                                                  |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| **Loading**             | A grey empty box where the card will be                    | Wait a moment.                                             |
| **Showing old figures** | **Showing the last saved figures.** at the top of the card | New figures arrive by themselves when you are back online. |
| **Did not load**        | **This widget could not load.** and a **Try again** button | Press **Try again**. The other widgets are fine.           |
| **All good**            | You can see the number, the short sentence and the link    | Done.                                                      |

**If no message appears:** see [Problems and fixes](#trouble). Even if the dashboard does not appear, none of your data is lost.

---

## Other situations <a href="#other" id="other"></a>

### Dashboard by role <a href="#task-roles" id="task-roles"></a>

Every role has its own starting layout. The list below is generated from the app's own list; press a name to open the meaning of that widget. If you have changed things yourself, your dashboard may differ from this.

<!-- guide:generated:widgets:roles -->

### Admin

1. [Student attendance today](widgets.md#widget.attendance-today) — Share present today and sections left (shown as a small tile on a phone)
2. [Teachers and staff](widgets.md#widget.staff-today) — Who is present, who is on leave
3. [Collection this month](widgets.md#widget.collection-month) — How much came in against this month's bills (shown as a small tile on a phone)
4. [Waiting for your approval](widgets.md#widget.approvals-pending) — Leave, admission and fee waiver requests (shown as a small tile on a phone)
5. [At-risk students](widgets.md#widget.at-risk-students) — Students with 2 or more warning signs (shown as a small tile on a phone)
6. [Mark entry](widgets.md#widget.mark-entry-progress) — Which classes still have marks to submit
7. [Syllabus progress](widgets.md#widget.syllabus-progress) — Which classes are behind in teaching
8. [What's coming up](widgets.md#widget.upcoming) — Next holiday and upcoming events
9. [SMS balance](widgets.md#widget.sms-balance) — How many more SMS can be sent
10. [Failed messages](widgets.md#widget.failed-messages) — SMS that failed in the last 7 days
11. [Setup checklist](widgets.md#widget.setup-checklist) — What is left to set up for your school
12. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Accountant

1. [Collection today](widgets.md#widget.collection-today) — Money received today, cash and other (shown as a small tile on a phone)
2. [Collection this month](widgets.md#widget.collection-month) — How much came in against this month's bills (shown as a small tile on a phone)
3. [Fee generation](widgets.md#widget.fee-generation-status) — Whether this month's bills are made
4. [Reminders waiting](widgets.md#widget.reminders-pending) — Fee reminders ready to send (shown as a small tile on a phone)
5. [Collection by month](widgets.md#widget.collection-by-month) — Collection for each month of this academic year
6. [Unpaid bills by age](widgets.md#widget.dues-ageing) — Unpaid amount by how long it is overdue (shown as a small tile on a phone)
7. [Recent payments](widgets.md#widget.recent-payments) — The latest payments received
8. [Dues by class](widgets.md#widget.dues-by-class) — Which classes owe the most
9. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Teacher

1. [My routine today](widgets.md#widget.my-routine-today) — Your periods today, in order
2. [Attendance left to take](widgets.md#widget.my-pending-sections) — Your sections where attendance is not taken yet (shown as a small tile on a phone)
3. [Mark deadlines](widgets.md#widget.my-mark-deadlines) — Marks you still need to submit, and by when (shown as a small tile on a phone)
4. [Homework to check](widgets.md#widget.homework-to-check) — Submitted homework waiting for your check (shown as a small tile on a phone)
5. [My leave balance](widgets.md#widget.my-leave-balance) — Leave you have taken and what is left (shown as a small tile on a phone)
6. [My class streaks](widgets.md#widget.class-teacher-streaks) — Students absent several days in a row
7. [My syllabus progress](widgets.md#widget.my-syllabus-progress) — How far you have taught in each class
8. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Academic coordinator

1. [Student attendance today](widgets.md#widget.attendance-today) — Share present today and sections left (shown as a small tile on a phone)
2. [Teachers and staff](widgets.md#widget.staff-today) — Who is present, who is on leave
3. [Collection this month](widgets.md#widget.collection-month) — How much came in against this month's bills (shown as a small tile on a phone)
4. [Waiting for your approval](widgets.md#widget.approvals-pending) — Leave, admission and fee waiver requests (shown as a small tile on a phone)
5. [At-risk students](widgets.md#widget.at-risk-students) — Students with 2 or more warning signs (shown as a small tile on a phone)
6. [Mark entry](widgets.md#widget.mark-entry-progress) — Which classes still have marks to submit
7. [Syllabus progress](widgets.md#widget.syllabus-progress) — Which classes are behind in teaching
8. [What's coming up](widgets.md#widget.upcoming) — Next holiday and upcoming events
9. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Office staff

1. [Admissions today](widgets.md#widget.admissions-today) — New admission applications today (shown as a small tile on a phone)
2. [Students added today](widgets.md#widget.students-added-today) — Students newly added today (shown as a small tile on a phone)
3. [Guardian details missing](widgets.md#widget.guardians-incomplete) — Students with no guardian phone number (shown as a small tile on a phone)
4. [Student attendance today](widgets.md#widget.attendance-today) — Share present today and sections left (shown as a small tile on a phone)
5. [Teachers and staff](widgets.md#widget.staff-today) — Who is present, who is on leave
6. [Print queue](widgets.md#widget.print-queue) — Documents waiting to be printed
7. [What's coming up](widgets.md#widget.upcoming) — Next holiday and upcoming events
8. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Exam controller

1. [Mark entry](widgets.md#widget.mark-entry-progress) — Which classes still have marks to submit
2. [Results](widgets.md#widget.results-state) — Which exams have results published (shown as a small tile on a phone)
3. [Seat plans](widgets.md#widget.seat-plan-status) — Which exams have a seat plan and which do not
4. [Print queue](widgets.md#widget.print-queue) — Documents waiting to be printed
5. [What's coming up](widgets.md#widget.upcoming) — Next holiday and upcoming events
6. [Latest notices](widgets.md#widget.latest-notices) — The newest notices addressed to you

### Committee member

1. [Enrolment](widgets.md#widget.committee-enrollment) — Total students and change from last year (shown as a small tile on a phone)
2. [Attendance](widgets.md#widget.committee-attendance) — Attendance over time against the target (shown as a small tile on a phone)
3. [Finance](widgets.md#widget.committee-finance) — Collection and dues in short (shown as a small tile on a phone)
4. [Pass rate](widgets.md#widget.committee-pass-rate) — Pass rate in the latest published exam (shown as a small tile on a phone)

<!-- /guide:generated -->

<img src="img/dashboard-01-teacher.png" alt="the teacher's dashboard, teacher">
<img src="img/dashboard-01-accountant.png" alt="the accountant's dashboard, accountant">
<img src="img/dashboard-01-office.png" alt="the office staff's dashboard, office staff">
<img src="img/dashboard-01-exam.png" alt="the exam controller's dashboard, exam controller">

If you have more than one role, you see the dashboard of the role you are in now.

In a new school where not one setup step is done yet, the admin first sees only the setup list. What the steps are: [How everything in the school fits together](../admin/how-it-works.md) and [The order to set up your school](../admin/setup-order.md).

### The committee member's dashboard <a href="#task-committee" id="task-committee"></a>

A committee member does not see today's summary like the others. On their page:

- Under the title, the month and academic year instead of the date.
- A line just under the title: **For the committee: totals only, no personal details**.
- At the top, a **Print monthly meeting report** button. How to print the report: [Customising the dashboard → Monthly meeting report](customise.md#task-committee-report).

<img src="img/dashboard-01-committee.png" alt="the committee member's dashboard, with the Print monthly meeting report button, committee member">

The whole role in one place: [Committee member](../roles/committee.md).

### The dashboard on a phone <a href="#task-phone" id="task-phone"></a>

On a phone the widgets are the same, just laid out differently:

1. At the top, **Key numbers**: small tiles in two columns. A widget that shows only a single number becomes a small tile here. Pressing a tile that has no link opens the whole widget; press again to close it.
2. Below that, the other widgets, one under another, in a compact size.
3. The **Customise** button is on the phone too.

Which widgets become tiles on a phone is written next to each name in the role list above.

<img src="img/dashboard-phone-01-teacher.png" alt="the teacher's dashboard, the key-number tiles, teacher" width="300">

### The guardian's Overview page <a href="#task-portal" id="task-portal"></a>

The guardian's app has no dashboard. Instead it has an **Overview** page with a few fixed cards; these cannot be rearranged:

- Today's row: whether each child is at school today, for example **At school today** or **Attendance not taken yet**.
- **This month's attendance**
- **Due this month** (fees)
- **Today's homework**
- **Latest result**
- **Next holiday**

<img src="img/dashboard-phone-02-guardian.png" alt="the guardian's Overview page, guardian" width="300">

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                               | What to do                                                                                                | Who can help |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------ |
| **This widget could not load.**            | Press **Try again**. If it keeps happening, reload the page.                                              | Admin        |
| **All widgets are hidden**                 | Press **Customise**, then show the ones you want — [Customising the dashboard](customise.md).             | Yourself     |
| The summary row is missing                 | If the summary cannot be fetched, the row stays hidden and the rest of the page is fine. Reload the page. | Admin        |
| **Showing the last saved figures.**        | You are offline. The numbers may be old; they refresh by themselves when you are back online.             | Yourself     |
| A widget that was there before is now gone | You probably hid it, or your role changed. Open **Customise** and look at the **Hidden** list.            | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                                                     | Sees the dashboard        | Today's summary | Customise their own | Monthly meeting report |
| ------------------------------------------------------------------------ | ------------------------- | --------------- | ------------------- | ---------------------- |
| Admin                                                                    | Yes                       | Yes             | Yes                 | No                     |
| Academic coordinator, teacher, accountant, office staff, exam controller | Yes                       | Yes             | Yes                 | No                     |
| Committee member                                                         | Yes, totals only          | No              | Yes                 | Yes                    |
| Parent, student                                                          | No, the **Overview** page | No              | No                  | No                     |

A widget shows only when it is set aside for your role and you have permission to see that data.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page</strong> — from top to bottom</summary>

1. **Title** — **Dashboard**, with today's weekday and date below.
2. **Customise** — show, hide and rearrange widgets.
3. **Today's summary** — the count of your open alerts, and **See all to-do (n)**.
4. **The widget grid** — the widgets for your role, in the order you set.

</details>

<details>
<summary><strong>How the dashboard works</strong> — from widget to the page where the work is</summary>

<figure>
  <img src="diagrams/dashboard-overview.svg" alt="Several widgets on the dashboard; each widget shows a number and leads to the page where the work is done; alerts feed the dashboard" width="720">
  <figcaption><em>How the dashboard works</em></figcaption>
</figure>

- Each widget shows a number, and the page its link opens is where the work happens.
- Today's summary comes from the school's alerts; the same count shows on the bell icon at the top of the page.
- Each person can arrange which widget goes where, separately for each of their roles.

</details>

**Related pages**

- [**What the widgets mean**](widgets.md) — what each widget's number says, where it comes from, what to do.
- [**Customising the dashboard**](customise.md) — show, hide and rearrange widgets; the school's dashboard settings; the monthly meeting report.
- [**Alerts and notifications**](alerts.md) — the full list behind today's summary.
- [**Welcome to SchoolManager**](../README.md) — what each role does, at a glance.
- [**Attendance reports**](../attendance/attendance-reports.md) — the full attendance numbers behind the dashboard.
- [**Staff attendance and leave**](../attendance/staff-attendance.md) — staff attendance and leave.

---

_Version 0.1.0 · Last verified 2026-10-24_
