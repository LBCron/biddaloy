<!-- guide:meta
feature: reports.studentCount
title: Student count (BANBEIS)
summary: See students by class and gender and the number of teachers and staff. Download to Excel or print the numbers for the BANBEIS annual survey.
roles: [ADMIN, ACCOUNTANT, TEACHER, EXECUTIVE, COMMITTEE]
sources:
  - client-admin/src/routes/_staff/reports/student-count.tsx
  - server/src/modules/reports/student-count/student-count.controller.ts
  - server/src/modules/reports/student-count/student-count.service.ts
labels:
  [
    reports:studentCount.*,
    nav:items.studentCount,
    nav:groups.reports,
  ]
helpIds: [reports.studentCount]
devices: [desktop, phone]
entry: [sidebar, palette]
keywords:
  [ছাত্রসংখ্যা, শিক্ষার্থী সংখ্যা, BANBEIS, ব্যানবেইস, বার্ষিক জরিপ, শ্রেণি, লিঙ্গ, ধর্ম, শিক্ষক ও কর্মচারী, student count, head count, enrolment, survey, gender, religion, staff]
appVersion: 0.1.0 (0d2ba6bc5)
owner: tareq89
lastVerified: 2026-10-31
knownIssues:
  - { id: teacher-count-does-not-load, checked: 2026-10-31, issue: null }
-->

# Student count (BANBEIS)

See, on one page, how many boys and girls each class has in an academic year, and how many teachers and staff the school has. Take the numbers for the BANBEIS (Bangladesh Bureau of Educational Information and Statistics) annual survey from here.

**How to get there:** in the left menu, **Reports → Student count (BANBEIS)**. Or press the **Student count (BANBEIS)** card on the [All reports](hub.md) page. It works on a computer or a phone.
**Before you start:** the school needs at least one **current** academic year. If there is none, make one year current on the [Academic years](../academics/academic-years.md) page. If you are an admin, an accountant, an academic coordinator or a committee member you can see the numbers; see [Who can do what](#roles). This page is for viewing; it changes no data.

The page shows the school's **student count table**: boys, girls and total for every class. It counts the students who have an active (ACTIVE) enrolment in that year, each student once. Below it there is a small table of teachers and staff.

[See the count](#task-main) · [Another academic year](#task-year) · [Download to Excel](#task-download) · [Print](#task-print) · [Hidden numbers](#task-hidden) · [Problems and fixes](#trouble)

**On this page**

- [See the student count](#task-main)
- [How to know the numbers are right](#confirm)
- [Other situations](#other)
  - [See another academic year](#task-year)
  - [Download to Excel](#task-download)
  - [Print](#task-print)
  - [Numbers hidden for committee members](#task-hidden)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Known issues](#known-issues)
- [Learn more](#more)

---

## See the student count <a href="#task-main" id="task-main"></a>

1. In the left menu press **Reports**, then press **Student count (BANBEIS)**.

   → The page opens and the numbers for the current academic year appear at once. You press no button. Under the title it says "Take the student numbers for the BANBEIS annual survey from here."

2. Look at the line under the title for the year, such as **Academic year 2026**.

   → The tables below are for this year.

3. In the **Students by class** table read the row of each class. The columns are **Boys**, **Girls** and, if present, **Other**, and last **Total**.

   → The last row, **Total**, adds up each column. The bottom right cell is the school's total number of students. If some student has no gender recorded, a **Not given** column appears.

4. If the school has more than one religion recorded, each gender splits by religion, with that gender's total beside it. With one religion there is no split.

5. Below that, look at the **Teachers and staff** table: **Teachers**, **Other staff**, and **Not given** for people whose post is not set; **Total** at the end.

   → This table has no gender, because the school's data does not record staff gender. Its numbers are always today's count; changing the academic year does not change it.

**On a phone:** each class is a card instead of a table, such as "Class 6 — Boys 40 · Girls 38 · Total 78". The last card holds the school's **Total**.

<figure>
  <img src="diagrams/reports-student-count-overview.svg" alt="Students with an active enrolment in the chosen academic year are counted once each into the class and gender table; teachers and staff are counted as of today in a separate table by type; a committee member sees a dash in any cell under five, while the totals are true" width="720">
  <figcaption><em>Where the student count comes from</em></figcaption>
</figure>

> **Remember:** this page stores nothing. Each time you open it, the numbers come from the enrolment and staff data of that moment.

---

## How to know the numbers are right <a href="#confirm" id="confirm"></a>

| State                           | How to tell                                                                             | What next                                 |
| ------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Changed on screen only**      | When you change the academic year, the new year's numbers come at once; nothing to save | —                                         |
| **Reached the school's system** | The tables show numbers and the grey placeholder is gone                                | Check them; download or print if you need |

This page does not keep anything on your phone or computer, so there is no "Saved on this device" state. The chosen academic year is held in the page address, so reloading shows the same year.

**If the numbers do not match:** someone may have enrolled or moved a student at the same time. Reload the page. Only **active** enrolments are counted; enrolments that are not active are left out.

---

## Other situations <a href="#other" id="other"></a>

### See another academic year <a href="#task-year" id="task-year"></a>

1. Next to the **Academic year …** line press **Change**.

   → A list of the school's academic years opens. The chosen year is marked.

2. Pick a year.

   → The page changes to that year's numbers. The year is held in the page address.

**Change** appears only when the school has more than one academic year.

### Download to Excel <a href="#task-download" id="task-download"></a>

Only the admin and the accountant get this. For other roles the button is not there at all.

1. After the numbers appear, press **Download to Excel** at the top right.

   → An Excel file named `student-count` downloads. It has four columns: **শ্রেণি**, **লিঙ্গ**, **ধর্ম**, **শিক্ষার্থী** (class, gender, religion, students), with the headings in Bangla. There is one row for each class, gender and religion. The gender cell reads MALE, FEMALE or OTHER. The file opens in Excel with Bangla names intact.

2. For the teachers and staff table, press **Download to Excel** beside that table.

   → A separate file named `staff-count` downloads, with two columns: **ধরন**, **জন** (type, people).

The file holds the numbers of the academic year you are looking at.

### Print <a href="#task-print" id="task-print"></a>

Everyone who can see the numbers gets this. Until the numbers appear, the button is grey.

1. Press **Print** at the top right.

   → The browser's print window opens. The buttons and **Change** are not printed. The paper starts with the school's name, **Student count (BANBEIS)**, the academic year and the school's EIIN. The EIIN prints only when the school's profile has a registration ID.

### Numbers hidden for committee members <a href="#task-hidden" id="task-hidden"></a>

If you sign in as a committee member, a cell with fewer than five people shows **—** instead of a number, never **0**. Move the mouse over the cell and it says "Hidden to protect privacy (fewer than 5)".

- If a row or column total would need a hidden cell, that total also shows **—**. Adding up only the visible cells would give too small a number, and subtracting would reveal the hidden one.
- The school's total number of students is never hidden; it is the true number.
- A line at the bottom says "— means the number is hidden because fewer than 5 students are counted there."
- The same rule applies to the teachers and staff table.

For other roles nothing is hidden.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                     | What to do                                                                                                                                         | Who can help |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Could not load the student count.**            | Press **Retry**. If you are a teacher, this is a [known issue](#known-issues): the count does not load for your role.                              | Admin        |
| **No academic year chosen yet**                  | The school has no current year. Make one year current on the [Academic years](../academics/academic-years.md) page ([Known issues](#known-issues)) | Admin        |
| **No students counted for this year**            | This year has no active enrolments. If the school has more than one year, pick another with **Change**.                                            | —            |
| **The file could not be downloaded. Try again.** | Press **Download to Excel** again after a while.                                                                                                   | Admin        |
| You cannot find **Download to Excel**            | Your role cannot download files. See [Who can do what](#roles).                                                                                    | Admin        |
| A cell shows **—**                               | You are a committee member and the cell has fewer than five people. See [hidden numbers](#task-hidden).                                            | —            |
| **Change** does not appear                       | The school has only one academic year.                                                                                                             | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                          | See the count                                                                       | Download to Excel | Print |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------- | ----- |
| Admin                         | Yes                                                                                 | Yes               | Yes   |
| Accountant                    | Yes                                                                                 | Yes               | Yes   |
| Academic coordinator          | Yes                                                                                 | No                | Yes   |
| Committee member              | Yes, numbers under 5 show **—**                                                     | No                | Yes   |
| Teacher                       | No. The menu item shows but the count does not load ([Known issues](#known-issues)) | No                | —     |
| Office staff, Exam controller | No (no menu item)                                                                   | No                | No    |

**Teacher:** the school-wide student count goes only to a role that may see the whole school's data. A teacher sees only their own assigned sections, so the server does not give this count.

---

## Known issues <a href="#known-issues" id="known-issues"></a>

Verified on version 0.1.0 on 2026-10-31. This section is removed once the fixes ship.

| Issue                                                                                                                                                                                             | Who and when                               | Data saved?                          | What to do for now                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Student count (BANBEIS)** is in a teacher's menu and in [All reports](hub.md), but opening it shows **Could not load the student count.**, because a teacher does not get the school-wide count | Teachers, every time                       | A report only views; nothing changes | Ask an admin or an academic coordinator to read the count                                       |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page, top to bottom</strong></summary>

- The title, a one-line description, and at the top right **Download to Excel** (admin and accountant only) and **Print**.
- The **Academic year …** line and **Change**.
- The **Students by class** table: a row for each class, a column for each gender (split by religion where there is more than one), and **Total** row and column at the end.
- The **Teachers and staff** table and its own **Download to Excel**.
- If any number is hidden, an explaining line at the bottom.

</details>

<details>
<summary><strong>How the numbers are counted</strong></summary>

- **Students:** those whose enrolment in the chosen academic year is **active**. Deleted students or classes are left out. Each student is counted once.
- **Order of classes:** by class number, smallest first.
- **If gender or religion is not recorded:** a separate **Not given** group.
- **Teachers and staff:** every staff profile of the school, by today's open post. If the post is a teaching post the person counts as **Teachers**, otherwise **Other staff**; with no post, **Not given**. It does not depend on the academic year.
- **Committee member:** numbers under 5 are hidden; totals are true.

</details>

**Related pages**

- [**All reports**](hub.md) — find and open every report in one place

---

_Version 0.1.0 · last verified 2026-10-31_
