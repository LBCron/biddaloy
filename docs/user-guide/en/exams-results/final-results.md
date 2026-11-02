<!-- guide:meta
feature: examsResults.finalResults
title: Final results
summary: Put a class's published exams together into one final result for the year, choose how much each exam counts, build and check it, publish it for guardians, send the SMS, print the report cards and reopen it when needed.
roles: [ADMIN, EXAM_CONTROLLER, TEACHER, EXECUTIVE, OFFICE_STAFF]
sources:
  - client-admin/src/routes/_staff/results/final/index.tsx
  - client-admin/src/routes/_staff/results/final/$finalResultId.tsx
  - client-admin/src/routes/_staff/results/final/-setup-panel.tsx
  - client-admin/src/routes/_staff/results/final/-results-panel.tsx
  - client-admin/src/routes/_staff/results/final/-print-panel.tsx
  - client-admin/src/routes/_staff/results/final/-build-dialog.tsx
  - client-admin/src/routes/_staff/results/final/-publish-dialog.tsx
  - client-admin/src/routes/_staff/results/final/-sms-dialog.tsx
  - client-admin/src/route-permissions.ts
  - client-admin/src/nav-tree.ts
  - server/src/modules/final-results/final-results.controller.ts
  - server/src/modules/final-results/final-results.service.ts
  - server/src/modules/final-results/final-result-rules.ts
  - server/src/modules/exams/result-sms.service.ts
labels:
  [
    exams:finalResults.*,
    exams:help.finalResults.*,
    exams:reportCard.*,
    nav:items.finalResults*,
    nav:groups.examsResults,
  ]
helpIds: [examsResults.finalResults]
devices: [desktop, phone]
entry: [sidebar, palette, page:people.students, page:examsResults.promotion]
keywords:
  [চূড়ান্ত ফলাফল, বার্ষিক ফলাফল, শতাংশ, ফল তৈরি, প্রকাশ, রিপোর্ট কার্ড, টেবুলেশন শিট, final result, share, build results, publish, report card, tabulation sheet, annual result]
appVersion: 0.1.0 (535fdad08)
owner: tareq89
lastVerified: 2026-11-02
knownIssues: []
-->

# Final results

Put the exams of one class together into one **Final result** for the year, and give guardians one report card.

**Where to go:** in the left menu, **Exams & Results → Final results**. On a phone, press **☰** at the top left to open the menu, then follow the same path.
**Before you start:** be the school's Admin or Exam controller. At least one exam of the class must have its results **Published** ([Processing and publishing results](results.md)). The academic year must have a [grading scale](grading-scales.md).

A final result takes the published exams of a class, for example Half Yearly and Annual. You choose how much each exam counts, for example 30 and 70. The app then works out every student's marks, grade, GPA and position for the whole year. A final result has three states: **Draft** (you are still choosing), **Built** (only the school sees it) and **Published** (guardians see it).

[Make a final result](#task-main) · [Remarks and conduct](#task-notes) · [Send SMS](#task-sms) · [Print](#task-print) · [Reopen](#task-reopen) · [Problems and fixes](#trouble)

**On this page**

- [How you get to this page](#arrive)
- [Make a final result](#task-main)
- [How to know it is built and published](#confirm)
- [Other situations](#other)
  - [Send the SMS to guardians](#task-sms)
  - [Print the report cards and the tabulation sheet](#task-print)
  - [Reopen a published final result](#task-reopen)
  - [Build again after something changes](#task-rebuild)
  - [Count class tests too](#task-tests)
  - [Give a subject its own share](#task-subject)
  - [Count only the best exams](#task-best)
  - [A student was absent in one exam](#task-absent)
  - [Working days and days present](#task-attendance)
  - [Who writes the remark and conduct](#task-notes)
  - [Why an exam cannot be reopened first](#task-exam-reopen)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get to this page <a href="#arrive" id="arrive"></a>

**From the left menu**

1. In the left menu press **Exams & Results → Final results**. → The **Final results** page opens. Start from [Make a final result](#task-main) below.

**From a student's page**

1. Open a student's page from the [Students](../people/students.md) list and look at the results. Press **Open the final result**. → That class's final result opens straight away.

**From the search**

1. Press **Ctrl+K** and type "Final results". → This page opens.

**From the class promotion page**

1. When you make a promotion list and the class has no published final result, the page shows **Go to final results**. Press it. → This page opens.

---

## Make a final result <a href="#task-main" id="task-main"></a>

1. In the left menu press **Exams & Results**, then press **Final results**.

   → The **Final results** page opens. In the **Academic year** box the current year is chosen. Below it is one row for each class with its **Status**, **Published on** and a button.

2. If you need another year, choose it in the **Academic year** box.

3. Press **Start** next to the class.

   → The class's final result opens on the **Setup** tab, in the **Draft** state. If the class has no published exam yet, **Start** cannot be pressed and the row says **No exam result of this class is published yet, so you can't start.** Press **Go to results** and publish an exam first.

4. Under **Which exams count**, look at the list. The term exams are already ticked, each with a **Share (%)** box. Untick an exam you do not want to count.

   → The shares are filled in for you. If this class had a final result last year with the same exam names, the same shares come back. Otherwise they are equal, for example 50 and 50 for two exams.

5. Change the **Share (%)** of each exam if you need to. For example, type 30 for Half Yearly and 70 for Annual.

   → **Total …** is shown below the list. If it is not 100, you see **Must total 100 (now …)** and you cannot save.

6. Press **Save**.

   → **Saved.** appears.

7. At the top right, press **Build results**.

   → The **Build the final results?** window opens. It says **Each student's final result is worked out from the published exams.**

8. Press **Build results** in the window.

   → The window closes and says how many students' results are built. The state becomes **Built**.

9. Open the **Results** tab and look through the list. Use the **Section** box to see one section. You see **Roll**, **Name**, **Total marks**, **GPA**, **Grade**, **Position**, **Position in section**, **Working days** and **Days present**. A student who failed shows **Failed**.

10. If everything is right, press **Publish** at the top right.

    → The **Publish the final results?** window says **Guardians can see the result once it is published.** If some students have no remark or no conduct grade, it also says how many, with **Go to section**. You can still publish.

11. Press **Publish** in the window.

    → The state becomes **Published**. Guardians now see the final result on their page ([Results](../portal/results.md)).

| What you press in the window | What happens                                                    | Done? |
| ---------------------------- | --------------------------------------------------------------- | ----- |
| **Build results**            | Every student's final result is worked out from the exams.      | Yes   |
| **Publish**                  | Guardians can see the final result. Setup can no longer change. | Yes   |
| **Cancel**                   | Nothing happens.                                                | No    |

> **Remember:** guardians do not see a **Built** result. They see it only after you press **Publish**.

---

## How to know it is built and published <a href="#confirm" id="confirm"></a>

This page does not keep anything separately on your phone or computer. Each action goes to the school's system as soon as you press the button in the window. There is no "changed on screen only" or "saved on this device" state.

| State                           | How you know                                                                                                                     | What next                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Reached the school's system** | The window closes, the badge at the top changes to **Built** or **Published**, and the students' rows appear on **Results** tab. | Press the button for the next step. |

**To check:** go to another page, then open **Final results** again. The class's row should show the same state, and **Published on** has a date after publishing.

**If the window does not close:** read the red message in the window and see [Problems and fixes](#trouble). Nothing is left half done. Either the whole action happens or nothing does.

---

## Other situations <a href="#other" id="other"></a>

### Send the SMS to guardians <a href="#task-sms" id="task-sms"></a>

1. Open the **Published** final result.
2. At the top right press **Send SMS**.

   → The **Send the final result SMS** window opens. Before publishing, it says **Publish the result before sending SMS.**

3. Press **Send**.

   → It says **Sent to … guardians.** The message carries the name "Final result" and the year.

A guardian with no phone number gets no message. If you send again for the same publication, those who already got a message do not get a second one.

### Print the report cards and the tabulation sheet <a href="#task-print" id="task-print"></a>

1. Open the final result and press the **Print** tab. Build the results first; before that the tab says **Build the results first, then you can print the cards.**
2. Choose a section. Choose a **Student** to preview one card on the page.

   → The report card shows each exam, the **Final** column, **Working days**, **Days present**, the class teacher's remark and the conduct grades.

3. Press **Print all cards** to print every card of the section, or **Tabulation sheet** to print the section's sheet with every exam and the final result side by side.

If the section has many students, the page shows the first part and says so. Print the rest one section at a time. A card that could not load is marked on the printout; press the button again to try once more.

### Reopen a published final result <a href="#task-reopen" id="task-reopen"></a>

If a mistake is found after publishing, put the final result back to **Built**.

1. Open the **Published** final result.
2. At the top right press the red **Reopen**.

   → The **Reopen the final results?** window says **Guardians will no longer see the result. Remarks and marks can be changed again.**

3. Press **Reopen** and finish the extra approval check that appears.

   → The state becomes **Built**. Guardians no longer see the result.

4. Change what is wrong, then [build again](#task-rebuild) and publish again.

| What you press | What happens                                                               | Reopened? |
| -------------- | -------------------------------------------------------------------------- | --------- |
| **Reopen**     | After the approval the final result is not published and setup can change. | Yes       |
| **Cancel**     | Nothing changes.                                                           | No        |

### Build again after something changes <a href="#task-rebuild" id="task-rebuild"></a>

In the **Built** state there is a **Build again** button. Press it and confirm. The new results replace the old ones. Do this after you change a share or an exam's marks. When you change a grade in the [grading scale](grading-scales.md), a built final result is worked out again by itself.

### Count class tests too <a href="#task-tests" id="task-tests"></a>

At first only the term exams are ticked. To count a monthly exam or class test, tick it in **Which exams count** and give it a share. All the ticked shares must still total 100.

### Give a subject its own share <a href="#task-subject" id="task-subject"></a>

1. On the **Setup** tab, open **More rules**.
2. Turn on **Different share per subject**.

   → A table appears with one row for each subject and a box for each exam.

3. Fill every row so that it totals 100. For example, Maths 40 and 60, English 30 and 70.
4. Press **Save**.

If a row does not total 100 you see **Each subject's shares must total 100.**

### Count only the best exams <a href="#task-best" id="task-best"></a>

1. On the **Setup** tab, open **More rules**.
2. Turn on **Count best N exams**.
3. In **How many best exams**, type a number. It cannot be more than the number of ticked exams.
4. Press **Save**.

Now only each student's best few exams count in each subject, and the rest are left out. For example, with 3 exams and 2 chosen, the weakest exam of the subject is left out for that student. While this is on, **Different share per subject** is off.

The other rules in **More rules** are **Round marks** (to a whole number or to two decimals) and **Failing any exam fails the subject**.

### A student was absent in one exam <a href="#task-absent" id="task-absent"></a>

The student gets 0 for that exam's share, and the report card shows **Absent** in that exam's column. The normal pass mark then decides whether the student passes the subject. The student is not skipped and the shares of the other exams are not changed.

### Working days and days present <a href="#task-attendance" id="task-attendance"></a>

The report card shows **Working days** and **Days present** from the attendance records, the same numbers as in the attendance reports. For a final result they are counted from the first day of the academic year to the day you publish. For one exam's report card they are counted for that exam's term. If the exam has no term, they are counted from the first day of the year to the last day of the exam. The numbers are fixed at the moment you publish.

### Who writes the remark and conduct <a href="#task-notes" id="task-notes"></a>

The class teacher (or the assistant class teacher) of a section writes each student's **Class teacher's remark** (up to 300 characters) and the conduct grades from **Academics → My class**. See [My class](../academics/my-class.md#task-notes). An Admin or Exam controller can write them for any section. Nobody can change them after the result is published; reopen it first.

### Why an exam cannot be reopened first <a href="#task-exam-reopen" id="task-exam-reopen"></a>

If a **Published** final result counts an exam, that exam cannot be reopened. The app says **A published final result counts this exam. Reopen that final result first, on the Final results page.** [Reopen the final result](#task-reopen) first.

If the final result is only **Built**, you can reopen the exam. The final result then goes back to **Draft**, its built results are removed, and you must build it again.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                     | What to do                                                                                                                                        | Who can help |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Couldn't load final results.**                                                 | Check your internet and try again.                                                                                                                | Admin        |
| **No class has a final result set up yet**                                       | Press **Start** next to a class.                                                                                                                  | Admin        |
| **No exam result of this class is published yet, so you can't start.**           | [Publish](results.md#task-publish) at least one exam of the class first.                                                                          | Admin        |
| **Couldn't start the final result. Try again.**                                  | Check your internet and try again.                                                                                                                | Admin        |
| **Must total 100 (now …)**                                                       | Change the shares so they total 100.                                                                                                              | —            |
| **Each subject's shares must total 100.**                                        | Fix the row of the subject in **Different share per subject**.                                                                                    | —            |
| **Cannot be more than the number of exams.**                                     | Type a smaller number in **How many best exams**, or tick more exams.                                                                             | —            |
| **The result is published, so it cannot be changed now. Reopen it first.**       | [Reopen](#task-reopen) the final result, then change it.                                                                                          | Admin        |
| **Couldn't build the final results.**                                            | Check your internet. Also check that the academic year has a [grading scale](grading-scales.md) and that every student has chosen their subjects. | Admin        |
| **Couldn't publish the final results.**                                          | Check your internet. A final result must be **Built** before it can be published.                                                                 | Admin        |
| **Couldn't reopen the final results.**                                           | Check that the extra approval was finished and the final result is **Published**.                                                                 | Admin        |
| **Publish the result before sending SMS.**                                       | [Publish](#confirm) first.                                                                                                                        | Admin        |
| **Couldn't send the SMS.**                                                       | Check that there are enough SMS credits, then try again.                                                                                          | Admin        |
| **Build the results first, then you can print the cards.**                       | Build the final result first.                                                                                                                     | Admin        |
| **… cards couldn't load.**                                                       | Press the print button again.                                                                                                                     | —            |
| **A published final result counts this exam. Reopen that final result first, …** | See [Why an exam cannot be reopened first](#task-exam-reopen).                                                                                    | Admin        |
| You do not see **Start**, **Build results** or **Publish**                       | See [Who can do what](#roles).                                                                                                                    | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                         | See the list and results | Start, set up, build | Publish, SMS, reopen | Write remarks and conduct     |
| ---------------------------- | ------------------------ | -------------------- | -------------------- | ----------------------------- |
| Admin                        | Yes                      | Yes                  | Yes                  | Yes, any section              |
| Exam controller              | Yes                      | Yes                  | Yes                  | Yes, any section              |
| Teacher                      | Own sections only        | No                   | No                   | Own section, as class teacher |
| Executive, Office staff      | Yes                      | No                   | No                   | No                            |
| Accountant, Committee member | No                       | No                   | No                   | No                            |

**Final results** is not in the left menu of the other roles. Guardians and students see a published final result on their own page ([Results](../portal/results.md)).

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page</strong> — top to bottom</summary>

1. **Final results** — the heading, with the **Academic year** box.
2. **The list** — **Class**, **Status**, **Published on** and a button: **Start** or **Open**.
3. On a class's page: the facts at the top (**Class**, **Academic year**, **Students**, **Failed**, **Published on**) and the buttons.
4. The three tabs: **Setup**, **Results**, **Print**.

</details>

<details>
<summary><strong>What each field means</strong></summary>

| Field                              | What to enter                                                                    | Required? |
| ---------------------------------- | -------------------------------------------------------------------------------- | --------- |
| Academic year                      | Which year's final results to show.                                              | Yes       |
| Which exams count                  | Tick the published exams that make up the final result.                          | Yes       |
| Share (%)                          | How much of the final result each exam counts for. They must add up to 100.      | Yes       |
| Round marks                        | Whether a subject's total is a whole number or kept to two decimals.             | No        |
| Failing any exam fails the subject | If on, failing even one counted exam fails that subject, however high the total. | No        |
| Different share per subject        | If on, you set the shares of each exam separately for every subject.             | No        |
| Count best N exams                 | If on, only the student's best few exams count in each subject.                  | No        |
| Section                            | Show one section's students only.                                                | No        |

</details>

<details>
<summary><strong>How a final result is worked out</strong> — steps and grades</summary>

<figure>
  <img src="diagrams/exams-results-final-results-overview.svg" alt="From Draft, pressing Build results makes it Built; pressing Publish makes it Published, when guardians see it and the SMS and printing are available; pressing Reopen makes it Built again after extra approval" width="720">
  <figcaption><em>The steps of a final result</em></figcaption>
</figure>

- **A subject's marks:** each exam's marks in the subject are multiplied by that exam's share and added. For example, 80 in Half Yearly at 30% and 90 in Annual at 70% make 87. If an exam does not have the subject, the shares of the other exams are scaled up to 100.
- **Grade and GPA:** the total is turned into a grade and GPA by the [grading scale](grading-scales.md), the same way as for one exam. The fourth subject and the failing rules work as in [Processing and publishing results](results.md).
- **Position:** higher GPA first; if the GPA is equal, higher total marks first. Students with equal results share a position. A student who failed has no position.
- **Who is included:** the students who are in the class this year when you press **Build results**. Students who left are not included; students already promoted are.

</details>

**Related pages**

- [**Processing and publishing results**](results.md) — publish each exam before you make the final result.
- [**Setting up grading scales**](grading-scales.md) — which percentage gets which grade and GPA.
- [**Promoting students**](promotion.md) — rank students by the final result when you promote them.
- [**My class**](../academics/my-class.md) — the class teacher writes remarks and conduct here.
- [**Print & documents**](../reports/printables.md) — the print history; prints from Final results are not in it.
- [**Results**](../portal/results.md) — where guardians and students see the published final result.

---

_Version 0.1.0 · last verified 2026-11-02_
