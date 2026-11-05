<!-- guide:meta
feature: reports.hub
title: All reports
summary: Find every school report in one place, open it, download it to Excel, print it on A4 and say if it helped. An admin can also keep a list as a report.
roles: [ADMIN, ACCOUNTANT, TEACHER, EXECUTIVE, COMMITTEE]
sources:
  - client-admin/src/routes/_staff/reports/index.tsx
  - client-admin/src/routes/_staff/reports/$reportId.tsx
  - client-admin/src/routes/_staff/reports/new.tsx
  - client-admin/src/routes/_staff/reports/$reportId_.edit.tsx
  - client-admin/src/routes/_staff/reports/-delivery/schedule-dialog.tsx
  - client-admin/src/routes/_staff/reports/-delivery/snapshots-panel.tsx
  - client-admin/src/routes/_staff/reports/runs.$runId.tsx
  - client-admin/src/dashboard/report-cards/report-cards.tsx
  - client-admin/src/dashboard/report-cards/report-prefs.ts
  - client-admin/src/routes/_staff/reports/-designer/start-screen.tsx
  - client-admin/src/routes/_staff/reports/-designer/designer-screen.tsx
  - client-admin/src/routes/_staff/reports/-designer/save-dialog.tsx
  - client-admin/src/routes/_staff/reports/-designer/question-starters.ts
  - ui/src/components/report-view/drill.ts
  - ui/src/components/report-view/format-cell.ts
  - client-admin/src/routes/_staff/reports/-coded-reports.ts
  - ui/src/components/report-prompts.tsx
  - ui/src/components/export-menu.tsx
  - client-admin/src/routes/_staff/print/-document/report-pages.tsx
  - client-admin/src/routes/_staff/-save-as-report/save-as-report-dialog.tsx
  - client-admin/src/routes/_staff/-save-as-report/list-to-definition.ts
  - server/src/modules/reports/report-meta.controller.ts
  - server/src/modules/reports/report-runs.controller.ts
  - server/src/modules/reports/report-definitions.controller.ts
labels:
  [
    reports:hub.*,
    reports:runner.*,
    reports:prompts.*,
    reports:designer.*,
    reportDesigner:*,
    common:export.*,
    common:saveAsReport.*,
    common:reportPrint.*,
    reports:delivery.*,
    reports:copies.*,
    reports:pinned.*,
    reports:usefulCard.*,
    reports:landing.*,
    reports:listHint.*,
    nav:items.allReports,
    nav:groups.reports,
  ]
helpIds:
  [
    reports.hub,
    reports.hub.action.newReport#task-design,
    reports.hub.field.search#task-main,
    reports.hub.section.questions#task-answer,
    reports.hub.action.showReport#task-answer,
    reports.hub.action.downloadExcel#task-download,
    reports.hub.action.print#task-print,
    reports.hub.action.emailRegularly#task-email,
    reports.hub.action.keepCopy#task-copy,
    reports.hub.action.showOnDashboard#task-pin,
    reports.hub.section.feedback#task-feedback,
    reports.hub.section.designTrays#task-design,
    reports.hub.section.designFilters#task-design,
    reports.hub.section.designLayout#task-design,
    reports.hub.section.designMore#task-design,
    reports.hub.field.whoCanSee#task-design,
  ]
devices: [desktop, phone]
entry: [sidebar, palette]
keywords:
  [রিপোর্ট, সব রিপোর্ট, রিপোর্ট খুঁজুন, পছন্দের রিপোর্ট, Excel, CSV, প্রিন্ট, রিপোর্ট হিসেবে রাখুন, মতামত, reports, all reports, catalogue, favourite, keep as report, print, download]
appVersion: 0.1.0 (0d2ba6bc5)
owner: tareq89
lastVerified: 2026-10-31
knownIssues:
  - { id: viewers-cannot-change-choices, checked: 2026-10-31, issue: null }
  - { id: teacher-student-count-card, checked: 2026-10-31, issue: null }
-->

# All reports

Find every school report in one place, open it, download it to Excel, print it on A4 paper, and say whether the report was useful.

**How to get there:** in the left menu, **Reports → All reports**. It works on a computer or a phone. The A4 print page opens on a computer only.
**Before you start:** you must be an admin, an accountant, a teacher, an academic coordinator or a committee member. What each role can do is in [Who can do what](#roles). This page is for viewing; opening a report never changes any data.

This page shows the list of **reports**. The list holds two kinds. One kind is the **ready reports**: reports the school's admin has made. They open on this page and show their answer at once. The other kind has its own page, such as the [Fee collection report](collections-report.md). Pressing its card opens that report's own page. You only see the reports your role may open.

[Find and open a report](#task-main) · [Change the choices](#task-answer) · [Download to Excel](#task-download) · [Print](#task-print) · [Say if it helped](#task-feedback) · [Keep as a report](#task-keep) · [Make a report](#task-design) · [Colours and links](#task-drill) · [Email regularly](#task-email) · [Keep a copy](#task-copy) · [Show on the dashboard](#task-pin) · [Problems and fixes](#trouble)

**On this page**

- [Find and open a report](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
  - [Change a report's questions](#task-answer)
  - [Download to Excel](#task-download)
  - [Print on A4 paper](#task-print)
  - [Say whether the report was useful](#task-feedback)
  - [Keep a list as a report](#task-keep)
  - [Make a report](#task-design)
  - [Colours and links in a report](#task-drill)
  - [Email a report regularly](#task-email)
  - [Keep today's copy](#task-copy)
  - [Show a report on your dashboard](#task-pin)
  - [Reports you may need](#task-card)
  - [The page the email link opens](#task-link)
  - [Star a favourite report](#task-favourite)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Known issues](#known-issues)
- [Learn more](#more)

---

## Find and open a report <a href="#task-main" id="task-main"></a>

1. In the left menu press **Reports**, then press **All reports**.

   → The **All reports** page opens. Under the title it says "Open a report and the answer is on screen at once." Each report is a card: the name on top, one line about it below. The cards are grouped, for example **Ready reports**, **Fees and money** and **Attendance**, depending on your role.

2. In the **Find a report** box type part of a report's name. Bangla and English names both work.

   → Only the cards whose name matches stay. If nothing matches, **No report matches** appears with a **Clear search** button.

3. Press the name of a report.

   → A ready report opens on this page and runs at once. You fill in no form; the answer is on screen. Any other report opens its own page.

4. Read the result table. A plain table shows 100 rows at a time; if there are more, use the page buttons under the table.

   → One report brings at most 10,000 rows. If there are more, a line at the top says **Showing the first … rows only. Narrow the choices to see the rest.**

<figure>
  <img src="diagrams/reports-hub-overview.svg" alt="From All reports you open a ready report or another report; after the result, Download to Excel and Print are for the admin and the accountant, changing the choices and feedback are for everyone who opens the report; from the students, dues or payments list the admin can keep the list as a report; the admin can also make a new report in the designer; a number in a report can open a list or another report" width="720">
  <figcaption><em>Who can do what from All reports</em></figcaption>
</figure>

> **Remember:** an opened report always shows the data of that moment. If you change the choices, the old result stays until you press **Show report** again.

---

## How to know it worked <a href="#confirm" id="confirm"></a>

| State                                              | How to tell                                                                                                                                                                                                       | What next                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Changed on screen only**                         | You changed an answer in the choices form but did not press **Show report**. The result below is for the old choices                                                                                              | Press **Show report**                            |
| **Reached the school's system**                    | The result table has appeared. It was fetched live from the school's system and the grey placeholder is gone                                                                                                      | Read it, download or print if you need           |
| **Reached the school's system** (kept as a report) | The **Kept as a report** message appeared. To check, open **All reports**; the new report is under **Ready reports**                                                                                              | Press its card, or press **Open** in the message |
| **Saved on this device**                           | Starred favourites, reports you put on your dashboard, which reports you opened and your "Was this report useful?" answer stay only in this browser, on this computer or phone. Another device will not show them | Nothing to do                                    |

---

## Other situations <a href="#other" id="other"></a>

### Change a report's questions <a href="#task-answer" id="task-answer"></a>

Anyone who can open the report can do this, when the report asks questions. The line is not there for a report that asks none.

Some reports ask questions when they run, such as which academic year or which class.

1. Look at the line above the result. It lists the current answers together, for example "2026 · Class 6 · All sections". At the end of the line press **Change**.

   → The **Choices for this report** form opens, with one field for each question the report asks.

2. Fill in the fields:
   - **Academic year**: pick one year. It starts as the current year.
   - **Class**: pick one or more classes. If you pick none, it is **All classes**.
   - **Section**: shows only the sections of the classes you picked. If you change the class, the section choice is cleared. If you pick none, it is **All sections**.
   - Dates: **From** and **To**.

   → If a required field is empty, a message appears next to it, such as **Pick a class**.

3. Press **Show report**, or press Enter in any field.

   → The form closes and the result changes to the new choices. The choices are kept in the page address, so reloading the page or sending the address opens the same view.

**Start again** puts every answer back to the report's starting answer; you still have to press **Show report**.

**On a phone:** the form opens as a sheet from the bottom. Change something and close the sheet, and the report runs with the new choices.

| You press       | What happens                                                                     | Saved?                |
| --------------- | -------------------------------------------------------------------------------- | --------------------- |
| **Show report** | The form closes, the result is shown for the new choices, the address holds them | No, nothing is stored |
| **Start again** | The answers go back to the starting answers; the result stays as it was          | No                    |

### Download to Excel <a href="#task-download" id="task-download"></a>

Only the admin and the accountant get this. For other roles the button is not there at all.

1. After the result appears, press **Download to Excel · … items** at the top right. The number is how many rows this choice has in all.

   → An Excel file downloads. It holds every row for these choices, not only the page you see.

2. For a CSV file instead, press the arrow beside the button (**More ways to download**), then **For other software (CSV)**.

   → A CSV file downloads.

With more than 5,000 rows the file does not download at once. The message **This file is large, so it is being prepared. You will see it under the bell when it is ready.** appears; when it is ready you find the file under the bell icon. If the result has no rows at all, the button is grey.

> **Remember:** the file may hold student or staff names. Do not send it outside the school.

### Print on A4 paper <a href="#task-print" id="task-print"></a>

Only the admin and the accountant get this. The print page opens on a computer.

1. After the result appears, press **Print** at the top. Until the result is there, the button is grey.

   → The print page opens in a new tab. At the top it shows the report name and your choices. Below, **Preparing the document…** shows, then the A4 pages appear.

2. Look at the pages. They hold the school's name and address, the report name, your choices on one line, the print date, and the table. All rows are printed, not only the page you were looking at.

   → A wide table (more than seven columns) is put on a landscape sheet by itself. In Chrome or Edge a page number such as **Page 1 of 3** prints at the bottom; other browsers print without a number.

3. At the top press **Print**.

   → The browser's print window opens. Print from there, or save as PDF.

The choices that were shown with the result are used. Anything you changed in the form but did not run is not printed. If a report is very long, a line at the bottom says **This report is very long. Only the first … rows are printed.**

**On a phone:** the print page shows **Open this on a computer**. Press **Copy link** and open the link on a computer.

When you are done, **Close** takes this tab to the **All reports** page. You can also close the tab and go back to the earlier tab.

### Say whether the report was useful <a href="#task-feedback" id="task-feedback"></a>

Everyone who can open reports gets this. A small line appears under the result the first time a result shows for a report.

1. Next to **Was this report useful?** press **Yes** or **No** (the thumb buttons).

   → **Yes** sends your answer at once and **Thank you.** appears. **No** opens the **What was missing?** box.

2. After **No**, write what was missing if you like (up to 500 characters), then press **Send**. You may send it empty.

   → **Thank you.** appears.

Once you answer, the question does not come back for that report in this browser. The line never blocks the result and does not print. If the answer cannot be sent, **Could not send your answer.** appears; press the button again.

### Keep a list as a report <a href="#task-keep" id="task-keep"></a>

Only the admin gets this. It is not done on the **All reports** page; it is done from three lists: [Students](../people/students.md), [Student dues](../finance/dues.md) and [Payments](../finance/payments.md). Whatever choices are set on the list become the report. The report then appears on **All reports** under **Ready reports**.

1. Open one of the three lists and set the class, section or other choices.

   → The list changes to your choices.

2. At the top press the arrow beside the **Download to Excel** button (**More ways to download**), then press **Keep this as a report**.

   → The **Keep this as a report** window opens. (The overdue-only dues list has no arrow; there **Keep this as a report** is a separate button.)

3. In **Report name** fix the name. A name is filled in for you: with a class chosen it is "Class name — Students", without one just "Students" (for dues "Dues", for payments "Payments"). If you empty it, **Give the report a name.** appears.

4. In **Who can see it** pick which roles will see the report. Admins can always see it, so that box is locked. Your own role is ticked at the start.

5. If an **Ask when running** part shows, check each switch. On the students list it is the academic year; on the payments list it is the dates. With the switch on, the report asks that question each time it runs ("Starts as … "). With it off, the report keeps that value ("It stays …").

6. Read the notes at the bottom. What will not go into the report is written there, for example **This filter will not go into the report: What you typed in search**.

   → The dues list becomes one row for each student in the report, with the total billed, paid and still owed on their open bills. The payments list becomes one row for each payment, with its amount. A payment that was reversed later and is hidden on the list is hidden in the report too. If a student was deleted later, their payment stays in the report but the name and registration number are left blank, as on the list. Failed or pending payments are not in the report, because no money came in. If you pick a status or a fee type on the dues list, the report keeps only those bills, so a student's other open bills are not in the totals. The dialog says so in a separate note, because the filter still applies. If **Overdue only** is on, the report counts only bills past their due date, while the list adds up all open bills of each student it shows, so totals and the students shown can differ. The dialog notes this too.

7. Press **Keep as report**.

   → The button shows **Keeping…**. When it ends, the window closes and **Kept as a report** appears with **Open**. Press **Open** to run the report.

| You press          | What happens                                                    | Saved? |
| ------------------ | --------------------------------------------------------------- | ------ |
| **Keep as report** | The report is made and switched on; it shows on **All reports** | Yes    |
| **Cancel**         | Nothing changes; you go back to the list                        | No     |

> **Remember:** nothing is kept until you press **Keep as report**. The report does not hold that moment's rows; it holds the rules of the choices. Each time you open it, fresh data comes.

**A tip on the lists.** On the Students and Dues lists, the third time you pick a filter in one visit, one quiet line appears under the buttons: **Need this often? Keep this as a report**. Press the link to open the same window, or press the X (**Hide this tip**) to hide it. It shows once for you on each list, and only to the admin. Typing in the search box does not count.

### Make a report <a href="#task-design" id="task-design"></a>

Only the admin gets this. It is on the **New report** button at the top right of **All reports**, and in the Ctrl+K search as **New report**.

1. Press **New report**.

   → The start screen opens. First **Start from a ready report** with a card for each ready report. Then **Start from a question** with four cards. Last, small, a link **Start blank**.

2. Choose how to start:
   - Press a ready report. A copy is made and opens for you to change. The ready report stays as it is.
   - Or on a question card pick from the lists, then press **Start**. The cards are **How many …, by …?**, **List of those who …?**, **How much money …, by …?** and **How much per month …?**. The lists use the school's own names, such as **Class** and **Gender**.
   - Or press **Start blank**.

   → The designer opens on one screen. The controls are on the left and the **Result** on the right. On a phone the result is on top, and the **Change** button opens the controls from the bottom.

3. Change the report by clicking:
   - **About** picks what the report is about, such as students or fees. It also offers **Final results** (published results only, for people who can open results), **Programs** (who is enrolled in which program) and **Applications** (kind, status and dates, never the letter itself; for people who manage applications). A teacher sees only their own sections.
   - **Show**, **Split by** and **Count / Add up** are three boxes. Press a name under a topic to put it in a box. Type in **Search** to find a name faster.
   - **Only those who…** narrows the report, for example "Class is Class 6". Switch on **Ask when running** to make the condition a question that is asked each time.
   - **How it looks** has four pictures: **List**, **Grouped**, **Table of counts** and **Chart**. One is chosen for you, with a line that says why.
   - **More** holds colour rules such as "If Still owed is more than 5,000 then Red".

   → About half a second after your last click the **Result** changes, showing the first 50 rows. The old result stays, a little faded, until the new one arrives.

4. If two things cannot go together, a sentence appears in red next to the part you changed, such as **These two cannot be split together: Student name and Count. Take one away.** Take one away and the result comes back.

5. Press **Save** at the top, or press Ctrl+S. In the **Save this report** window check **Report name** (filled in from your choices), tick **Who can see it** (admins always see it; your own role is ticked), and write a **Folder (optional)** if you like. Then press:
   - **Save**: the report is kept as a draft, and only you can see it.
   - **Switch on for everyone**: the roles you ticked can open it from **All reports**.

   → A message says **The report is saved. Only you can see it for now.** or **The report is on for everyone.** with **Open the report**.

To change a report later, open it and press **Change** at the top right. For a ready report the button says **Copy and change**: the copy is changed and the ready report stays as it is.

| Key           | What it does                                                       |
| ------------- | ------------------------------------------------------------------ |
| Tab           | Moves from box to box, and from name to name                       |
| Enter         | Adds the name you are on to its box                                |
| Alt+↑ / Alt+↓ | Moves a picked name up or down inside its box                      |
| Ctrl+S        | Saves (a report that is already saved is saved as a draft at once) |

If you try to leave with changes that are not saved, **Leave without saving?** asks first. **Stay here** keeps your work.

| You press                  | What happens                                        | Saved? |
| -------------------------- | --------------------------------------------------- | ------ |
| **Save**                   | The report is kept as a draft. Only you see it      | Yes    |
| **Switch on for everyone** | The report is kept and the ticked roles can open it | Yes    |
| **Leave without saving**   | You leave and the changes are lost                  | No     |

> **Remember:** the result in the designer shows only the first 50 rows, to be quick. The saved report shows all of them when it runs.

### Colours and links in a report <a href="#task-drill" id="task-drill"></a>

A report can colour numbers and can open the list of people behind a number. The admin sets the colours under **More** in the designer.

1. Look at a coloured number. It has a small picture beside it (a tick, a clock, a triangle or a dash), so the colour is never the only sign. A screen reader reads the colour's name after the number.

   → Under the report a line says what each colour means, for example **Red = If Still owed is more than 5,000 then**.

2. Look for a number with a small arrow ↗ beside it. Move the pointer over it and it is underlined. Press it.

   → The list of those people opens, or another report, with the same choices (for example the same class). At the top of that page is **Go back**.

3. Press **Go back**.

   → You return to the first report with the choices it had.

A number that is hidden for privacy (shown as **—**) and a number that is 0 never have a link. Everyone who opens the report sees its colours and links. A link to the list of students shows only to a role that may open the student list.

### Email a report regularly <a href="#task-email" id="task-email"></a>

Only the admin gets this. It is in the three-dots menu (**More actions**) at the top right of an open report.

1. Open a report and set its choices the way you want them. Press **More actions**, then **Email this regularly**.

   → The **Email this report regularly** window opens. It holds one sentence, for example **Every month on day 1 at 9:00 am, send to Admin**, with a box for each part you can change.

2. Change the parts you want: how often (**day**, **week** or **month**), the day, the time (on the hour, from 6:00 am to 9:00 pm) and who gets it. It starts as every month, on day 1, at 9:00 am, to your own role. For a week the day box shows the days of the week; for a day there is no day box. The days of a month stop at 28, so every month has them.

   → The sentence changes with your choices.

3. Press **Start emailing**.

   → **Done. … will get this report by email.** appears and the window closes.

Everyone with that role gets their own email. It holds a link, not the file. They sign in and open the link, and the report is made fresh for them, with what their own role may see. The choices that were on screen when you pressed the button are used each time. Only the roles that may download reports are listed (the admin and the accountant).

To stop an email, open **Email this regularly** again. Under **Already emailed regularly**, press **Stop** beside its sentence.

| You press          | What happens                                                         | Saved? |
| ------------------ | -------------------------------------------------------------------- | ------ |
| **Start emailing** | The regular email is set up; the first one goes at the next set time | Yes    |
| **Stop**           | That regular email ends                                              | Yes    |
| **Cancel**         | Nothing changes                                                      | No     |

### Keep today's copy <a href="#task-copy" id="task-copy"></a>

The admin and the accountant get this. Use it for a report you must be able to show later exactly as it was, such as the BANBEIS count you sent.

1. Open the report and wait for the result. Press **More actions**, then **Keep today's copy**. Until the result is there, the choice is grey.

   → The **Keep today's copy** window opens.

2. In **What is it for?** write a few words, for example **BANBEIS 2026 submission**. If you leave it empty, the report's name and the date are used.

3. **Numbers as of** starts at today. Change it only if the numbers are for another day. A day in the future is not accepted.

4. Press **Keep copy**.

   → **Copy kept.** appears. Under the result a **Kept copies** list shows the date, what it is for and a **Download to Excel** button.

A kept copy never changes and is not deleted. Months later, **Download to Excel** gives the same file. The **Kept copies** list shows only the copies of the report you have open, and only copies you made (the admin sees everyone's). It does not show at all while there are none.

| You press             | What happens                       | Saved? |
| --------------------- | ---------------------------------- | ------ |
| **Keep copy**         | The copy is stored and listed      | Yes    |
| **Download to Excel** | The kept file downloads, unchanged | No     |
| **Cancel**            | Nothing is kept                    | No     |

> **Remember:** the copy may hold student or staff names. Do not send it outside the school.

### Show a report on your dashboard <a href="#task-pin" id="task-pin"></a>

Everyone who has a dashboard and can open reports gets this. It is one click with no window.

1. Open a report. Press **More actions**, then **Show on my dashboard**.

   → **Shown on your dashboard.** appears.

2. Open **Dashboard**.

   → A card with the report's name sits above the other cards. It shows the report's first count for each row, up to 50 rows, with **Open the full report** under it.

3. To take it off, press **Remove from my dashboard** on the card, or open the report and press **More actions**, then **Remove from my dashboard**.

   → The card goes away.

The card is made for your own role, so you see only what you may see. If a number is hidden to protect privacy, a line under the card says so. If one card cannot load, it says **This report could not be shown.** with **Try again**, and the rest of the dashboard works. A report that is no longer open to your role is skipped.

Your reports on the dashboard stay in this browser only ([Saved on this device](#confirm)); on another computer you press **Show on my dashboard** again.

### Reports you may need <a href="#task-card" id="task-card"></a>

The admin, the accountant and the academic coordinator see this card on the **Dashboard**. It helps a new person find the first reports.

1. Open **Dashboard** and look for the card **Reports you may need**.

   → It lists up to three ready reports you have not opened yet, each with one line about it. The BANBEIS student count comes first when you have not opened it this academic year. It says **Not opened this academic year yet.** only if you opened it in an earlier academic year; someone who has never opened it does not see that line.

2. Press a report's name.

   → The report opens and runs at once.

3. To hide the card for good, press **Hide this card** (the X).

   → The card goes and does not come back.

Once you have opened all the ready reports, the card goes away by itself. Which reports you opened, and whether you hid the card, stay in this browser only ([Saved on this device](#confirm)).

### The page the email link opens <a href="#task-link" id="task-link"></a>

A regular email holds a link such as `…/reports/runs/…`. Everyone who gets one signs in, then sees one of these:

| What the page says                          | What it means                                         | What to do                                             |
| ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| **Your report is being prepared**           | The file is not ready yet. The page updates by itself | Wait on the page                                       |
| **Your report is ready**                    | The file is there                                     | Press **Download to Excel**                            |
| **This file is no longer there**            | Files stay for 24 hours                               | Open the report from **All reports** for fresh numbers |
| **This report could not be made**           | The report failed this time                           | Open the report and narrow the choices                 |
| **We cannot find this file**                | It belongs to someone else, or it was removed         | Sign in with the account that got the email            |
| **You can read this report on screen only** | Your role cannot take files out                       | Open the report, or ask the admin                      |

### Star a favourite report <a href="#task-favourite" id="task-favourite"></a>

1. Press the star at the top right of a card (**Add … to favourites**).

   → The card moves up into the **Favourites** group. A report never shows twice.

2. To remove it, press the star again (**Remove … from favourites**).

   → The card goes back to its earlier group.

Favourites stay in this browser only ([Saved on this device](#confirm)). If the browser does not let the page store anything, the star works for that visit only and is not remembered.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                              | What to do                                                                                                                                          | Who can help |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **The ready reports could not be loaded.**                                                | Press **Try again**. The cards of the other reports stay on the page.                                                                               | Admin        |
| **No report matches**                                                                     | Try another word, or press **Clear search**.                                                                                                        | —            |
| **This report is not available**                                                          | It was removed, or it is not meant for your role. Press **See all reports**.                                                                        | Admin        |
| **Nobody matches these choices**                                                          | Try another class, or change the choices above.                                                                                                     | —            |
| **This report is taking too long. Narrow the filters and try again.**                     | The choices form opens by itself. Narrow the class, section or dates and press **Show report**.                                                     | Admin        |
| **Answer the questions above first, then show the report.**                               | The choices form opens by itself. Answer the questions in it and press **Show report**.                                                             | Admin        |
| **This report has nothing to show yet.**                                                  | The report is empty. Tell the admin.                                                                                                                | Admin        |
| **The report could not be shown. Try again.**                                             | Press **Try again**. If it still fails, reload the page.                                                                                            | Admin        |
| **The file could not be downloaded. Try again.**                                          | Press **Download to Excel** again after a while.                                                                                                    | Admin        |
| **The document could not be loaded.**                                                     | On the print page press **Retry**.                                                                                                                  | Admin        |
| **Open this on a computer**                                                               | The print page does not open on a phone. Press **Copy link** and open it on a computer.                                                             | —            |
| You cannot find **Download to Excel**, **Print**, **Change** or **Keep this as a report** | Your role cannot do this. See [Who can do what](#roles).                                                                                            | Admin        |
| **The report could not be kept. Nothing was saved. Try again.**                           | Press **Keep as report** again.                                                                                                                     | Admin        |
| **The report was saved but could not be switched on. Try again.**                         | The report is made, only not switched on. The form is locked. Pressing **Keep as report** again does not make a new report; it only switches it on. | Admin        |
| **We could not confirm whether this was saved. Check the list before trying again.**      | First open **All reports** and see whether the new report is there. If it is, do not keep it again.                                                 | Admin        |
| **This report could not be shown.** (on a dashboard card)                                 | Press **Try again** on that card. The other cards stay.                                                                                             | Admin        |
| **This could not be set up. Try again.**                                                  | Press **Start emailing** again. The same regular email is not set up twice.                                                                         | Admin        |
| **The copy could not be kept. Try again.**                                                | Press **Keep copy** again. The same copy is not made twice.                                                                                         | Admin        |
| **Could not send your answer.**                                                           | Press **Yes** or **Send** again.                                                                                                                    | —            |
| **These two cannot be split together: … Take one away.**                                  | One of the names you put under **Show** cannot be counted beside a number. Take it out of **Show**, or take the **Count / Add up** away.            | Admin        |
| **The result could not be fetched. Try again in a moment.**                               | The designer could not get the result. Change something or wait a moment; the old result stays on screen.                                           | Admin        |
| **The report could not be saved. Try again.**                                             | Press **Save** again. The same report is not made twice.                                                                                            | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                          | See reports                | Download to Excel | Print | Change the report itself | Keep as a report |
| ----------------------------- | -------------------------- | ----------------- | ----- | ------------------------ | ---------------- |
| Admin                         | All reports                | Yes               | Yes   | Yes                      | Yes              |
| Accountant                    | Those made visible to them | Yes               | Yes   | No                       | No               |
| Teacher                       | Those made visible to them | No                | No    | No                       | No               |
| Academic coordinator          | Those made visible to them | No                | No    | No                       | No               |
| Committee member              | Those made visible to them | No                | No    | No                       | No               |
| Office staff, Exam controller | No (no menu item)          | No                | No    | No                       | No               |

**Which cards you see:** the admin sees every **ready report**. Others see only the ones whose maker let their role see them. A card for another report shows only when your role may open that report's page; for example the Fee collection report is for the admin, the accountant and the academic coordinator.

**New report:** only the admin can make a report, copy a ready report and change a report ([Make a report](#task-design)). The button is not shown to other roles.

**Change the report itself:** only the admin can change a report's layout, questions and colours (the **Change** button at the top of a report). Everyone who opens a report sees its layout (grouped list, table of counts, chart), its colours and links, and can answer its questions in the choices form. The print page follows the same layout. If a report is not meant for your role, it does not open at all.

**Email regularly, keep a copy, show on the dashboard:** only the admin can email a report regularly. The admin and the accountant can keep today's copy and download it later. Anyone who has a dashboard and can open reports can show a report on it. The admin, the accountant and the academic coordinator see **Reports you may need** on the dashboard.

---

## Known issues <a href="#known-issues" id="known-issues"></a>

Verified on version 0.1.0 on 2026-10-31. This section is removed once the fixes ship.

| Issue                                                                                                                                                                                                 | Who and when                                           | Data saved?                          | What to do for now                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Only the admin can change a report's answers. If a question has no answer, **Answer the questions above first, then show the report.** appears for others, though they have no question fields at all | Everyone except the admin, when opening a ready report | A report only views; nothing changes | Ask the admin to change the choices and show the result, or to keep another report for other choices |
| A teacher sees the [**Student count (BANBEIS)**](student-count.md) card in **All reports**, but when it opens no count loads ([details](student-count.md#known-issues))                               | Teachers, every time                                   | A report only views; nothing changes | Nothing to do. An admin or an academic coordinator can see the count                                 |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page, top to bottom</strong></summary>

**The All reports page**

- The title and a one-line description.
- The **Find a report** box (it shows whenever there are cards).
- The **Favourites** group, holding starred reports.
- The ready-report groups. The group with no name is called **Ready reports**.
- The groups for other reports: Students, Fees and money, Attendance, Exams and results, Printouts and documents, Messages and alerts, Applications. A group where you can open nothing does not show.

**The page where a report opens**

- The report's name.
- (Admin) the line of current answers and **Change**.
- At the top right **Print** and **Download to Excel** (depending on your role).
- (Admin) the **Choices for this report** form.
- The result: a table, a grouped list, a table of counts or a chart. A table of counts can be switched with **See as table** and **See as list**, a chart with **See as chart** and **See as table**.
- Under the result, **Was this report useful?**

</details>

<details>
<summary><strong>What each list becomes when kept as a report</strong></summary>

| List         | What goes into the report                                     | Question when running                 |
| ------------ | ------------------------------------------------------------- | ------------------------------------- |
| Students     | The choices and the columns you see; one row for each student | Academic year                         |
| Student dues | One row for each student, with the total of their open bills  | None                                  |
| Payments     | One row for each payment, with its amount                     | Dates (if dates were set on the list) |

Class and section go into the report by name, not by id. If a class is renamed, check the report again.

</details>

<details>
<summary><strong>What each field means</strong></summary>

<!-- guide:generated:fields:reports:search -->

| Field         | What to enter                                                     | Required? |
| ------------- | ----------------------------------------------------------------- | --------- |
| Find a report | Type part of a report's name. Bangla and English names both work. | No        |

<!-- /guide:generated -->

<!-- guide:generated:fields:reportDesigner:whoCanSee -->

| Field          | What to enter                                                             | Required? |
| -------------- | ------------------------------------------------------------------------- | --------- |
| Who can see it | Tick each role that may open this report. Admins always see every report. | No        |

<!-- /guide:generated -->

</details>

**Related pages**

- [**Student count (BANBEIS)**](student-count.md) — how the sidebar item opens the ready BANBEIS report

---

_Version 0.1.0 · last verified 2026-10-31_
