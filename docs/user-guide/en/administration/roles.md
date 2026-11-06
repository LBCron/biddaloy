<!-- guide:meta
feature: administration.roles
title: Roles and permissions
summary: See side by side what each staff role in the school can see and do, on one page. The page is view-only; nothing changes from here.
roles: [ADMIN]
sources:
  - client-admin/src/routes/_staff/roles/index.tsx
  - client-admin/src/routes/_staff/roles/-role-card.tsx
  - client-admin/src/routes/_staff/staff/-detail/permissions-tab.tsx
  - client-admin/src/route-permissions.ts
  - shared/src/enums/permissions.ts
  - shared/src/enums/audiences.ts
labels:
  [
    staff:rolesAccess.*,
    staff:roles.*,
    staff:roleDescriptions.*,
    staff:permissions.groups.*,
    nav:items.rolesAccess,
    nav:groups.administration,
  ]
helpIds: [administration.roles]
devices: [desktop]
entry: [sidebar, palette]
keywords:
  [ভূমিকা, অনুমতি, কে কী দেখে, শিক্ষক, হিসাবরক্ষক, অফিস সহকারী, পরীক্ষা নিয়ন্ত্রক, roles, permissions, access, role, permission, রোল]
appVersion: 0.1.0 (63bfc7884)
owner: tareq89
lastVerified: 2026-10-25
knownIssues: []
-->

# Roles and permissions

Compare what each role in the school can see and do, on one page.

**Go to:** **Administration → Roles & access** in the left menu. View this page on a computer.
**Before you start:** be an Admin. The menu of every other role does not have this page.

Every staff member has one **role**, such as Teacher or Accountant. The role decides what they see and do in the app. This page only shows; there is no button on it, and nothing changes. A person's role is chosen when you add them on the [**Staff**](../people/staff.md#task-main) list.

[Read the page](#task-main) · [Who can do what, in short](#matrix) · [Problems and fixes](#trouble)

**On this page**

- [See the permissions of one role](#task-main)
- [How to know you are on the right card](#confirm)
- [Who can do what, in short](#matrix)
- [Other situations](#other)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## See the permissions of one role <a href="#task-main" id="task-main"></a>

1. Press **Administration** in the left menu, then press **Roles & access**.

   → The title **Roles & access** at the top, and below it "What each role can see and do in this school. Read-only." Then seven cards, one for each role: **Admin**, **Accountant**, **Academic coordinator**, **Teacher**, **Exam controller**, **Office staff**, **Committee member**.

2. Find the card of the role you want to see.

   → The card shows the role's name, one line about its work, its data access (for example **Whole school** or **Assigned sections only**) and the total number of permissions, for example **18 permissions** on the Exam controller card.

3. Press a group under the card, for example **Fees (…)**. The number in brackets is how many permissions are in that group.

   → The group opens and every permission in it is shown in plain words. Press it again to close it.

<img src="img/roles-01-list.png" alt="Roles & access page; 1 · title and the &quot;Read-only&quot; line 2 · one role card 3 · data access 4 · permission count 5 · one open permission group; admin">

> **Remember:** these cards come from the same list the school's system uses to check every action. So what the card says matches what the app allows. A Teacher's permissions still work only inside their own sections.

This page does not save anything, so there is no "was it saved" state to check.

---

## How to know you are on the right card <a href="#confirm" id="confirm"></a>

The card has the role's name at the top and a number such as **18 permissions**. When you open a group, the number in brackets after its name equals the number of permissions listed inside it. This page never saves anything, so there is no "saved" message to look for.

---

## Who can do what, in short <a href="#matrix" id="matrix"></a>

The full list is on the cards. Here are the main points.

**Data access.** Every role sees only its own school's data. Nobody can ever see another school's data.

| Role                                                                                     | How much data they see |
| ---------------------------------------------------------------------------------------- | ---------------------- |
| Admin, Accountant, Academic coordinator, Office staff, Exam controller, Committee member | Whole school           |
| Teacher                                                                                  | Assigned sections only |

A teacher sees the students, attendance and marks of only the sections given to them ([**Teacher assignments**](../people/teaching-assignments.md)). If no section is given, the list is empty. If they open the page of someone outside their sections, they get "not found".

**What each role mainly does**

| Role                 | What they can do                                                                                                                                                                                                                       | What they cannot do                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Admin                | Everything in the school: staff, students, guardians, fees, payments, exams, results, routines, printing, settings, backups, the activity log. Only the Admin can approve money-risk actions and cancel payments.                      | —                                                                                        |
| Accountant           | Create and change fee structures, generate fee bills, take payments, invoices, discount rules, automatic billing, finance reports, send messages. Add and edit students and guardians, import students from a file, print ID cards.    | Approve fee actions, cancel payments, delete students or fee structures, exams, settings |
| Academic coordinator | View students, results, marks and reports; import students from a file; approve staff leave; view applications and decide on them; run programs; change a student's status (for example left school); issue certificates; send alerts. | Take money or generate bills, enter marks, settings                                      |
| Teacher              | In their own sections: take attendance, enter marks, give and view homework, arrange the syllabus, write student notes, write program progress. View their sections' students, guardians and fees.                                     | Anything outside their sections, take money, publish results                             |
| Exam controller      | Arrange exams for the whole school, seat plans, enter marks as backup when a teacher is absent, generate and publish results, print documents.                                                                                         | Money, add students                                                                      |
| Office staff         | View admission applicants, add and edit students and guardians, import from a file, student records, send messages, printing and certificates, view applications and decide at their own step. Only view fees and invoices.            | Take money, delete students, settings                                                    |
| Committee member     | View only: dashboard, committee reports, staff evaluations, calendar.                                                                                                                                                                  | See student details, change anything                                                     |

Every staff role except Committee member can mark and view their own attendance, and can apply for themselves ([**Applications**](../applications/applications.md)).

**Notices** (in the **Communication** group): every role can read the notices sent to them. Admin, Academic coordinator, Teacher and Office staff can post notices; a teacher posts only to their own sections. Only the Admin and the Academic coordinator can manage everyone's notices and approve a notice's SMS.

---

## Other situations <a href="#other" id="other"></a>

- **A role you expected is missing:** the school has seven fixed roles. There is no way to add one here.
- **A permission seems missing from a group:** groups only show permissions the role has. A permission the role does not have is not listed.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                   | What to do                                                                                                     | Who can help |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------ |
| **Roles & access** is not in the menu          | This page is for the Admin only. If you are not the Admin, ask the Admin to show you your role's card.         | Admin        |
| A staff member does not see a button           | Check whether their role's card has the permission for that action. If it does not, this is correct behaviour. | Admin        |
| You want to change someone's role              | You cannot do it from this page. See the [**Staff**](../people/staff.md) page.                                 | Admin        |
| A teacher says their list is empty             | Check whether any section is given to them: [**Teacher assignments**](../people/teaching-assignments.md).      | Admin        |
| You want a new role or permissions of your own | Not possible. The school has these seven roles, and the permissions of each are fixed.                         | —            |

If a page or button is missing, see [Why can't I see this?](../help/cant-see-this.md).

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                                                                       | See this page | Change anything      |
| ------------------------------------------------------------------------------------------ | ------------- | -------------------- |
| Admin                                                                                      | Yes           | Nothing changes here |
| Accountant, Academic coordinator, Teacher, Exam controller, Office staff, Committee member | No            | No                   |

Opening this page needs the permission to view the staff list, which only the Admin has. If another role opens the address directly, the page does not open; a message appears instead.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>The parts of the page</strong> — Roles & access</summary>

1. The title **Roles & access** and the "Read-only" line.
2. The role card — name and a one-line description.
3. Data access — **Whole school** or **Assigned sections only**.
4. The number of permissions.
5. The permission groups — for example **Fees**, **Attendance & leave**, [**Applications**](../applications/applications.md); press one to open it.

<img src="img/roles-01-list.png" alt="Roles & access page, the five parts marked with numbers; admin">

</details>

<details>
<summary><strong>How roles work</strong> — who sees how much</summary>

<figure>
  <img src="diagrams/administration-roles-overview.svg" alt="In your school the Admin sees everything; the Accountant, Academic coordinator, Exam controller, Office staff and Committee member see their own part of the whole school; the Teacher sees only their own sections" width="720">
  <figcaption><em>How much each role sees</em></figcaption>
</figure>

- **One person, one role:** in one school a staff member has one role.
- **Permissions are checked twice:** the menu shows only the pages you have permission for. If someone opens an address directly, the school's system checks again and blocks the action.
- **Super admin:** this is a platform role that no school can give. So it is not on the cards.
- **Parents and students:** they are not staff. They use the same app, but after sign-in they land on their own **portal** pages ([**Overview**](../portal/overview.md)), and they see only their own family or their own information.

</details>

**Related pages**

- **Role pages** — one page for each role, with its first day and common tasks: [Admin](../roles/admin.md), [Accountant](../roles/accountant.md), [Academic coordinator](../roles/headmaster.md), [Teacher](../roles/teacher.md), [Exam controller](../roles/exam-controller.md), [Office staff](../roles/office-staff.md), [Committee member](../roles/committee.md), [Guardian](../roles/guardian.md), [Student](../roles/student.md).
- [**Staff**](../people/staff.md) — add staff and choose the role.
- [**Teacher assignments**](../people/teaching-assignments.md) — which teacher sees which section.
- [**Activity log**](audit-logs.md) — who changed what, and when.
- [**Applications**](../applications/applications.md) — which role decides which application.
- [**Changing the school's settings**](settings.md) — Set the school's profile, academic rules, fee rules, communication, printing, sign-in, backup and alerts on one page, in nine categories.

---

_Version 0.1.0 · Last checked 2026-10-25_
