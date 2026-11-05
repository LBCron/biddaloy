<!-- guide:meta
feature: examsResults.results
title: Processing and publishing results
summary: Build an exam's results from the submitted marks, check them and publish, send guardians an SMS, reopen when needed, and print each student's report card.
roles: [ADMIN, EXAM_CONTROLLER]
sources:
  - client-admin/src/routes/_staff/results/index.tsx
  - client-admin/src/routes/_staff/results/$examId.$studentId.tsx
  - client-admin/src/routes/_staff/results/-process-dialog.tsx
  - client-admin/src/routes/_staff/results/-publish-dialog.tsx
  - client-admin/src/routes/_staff/results/-send-result-sms-dialog.tsx
  - client-admin/src/routes/_staff/exams/-detail/results-panel.tsx
  - client-admin/src/routes/_staff/exams/-detail/use-result-actions.tsx
  - client-admin/src/routes/_staff/students/-detail/results-panel.tsx
  - client-admin/src/route-permissions.ts
  - server/src/modules/exams/results.controller.ts
  - server/src/modules/exams/results.service.ts
  - server/src/modules/exams/result-rules.ts
  - server/src/modules/exams/result-sms.service.ts
labels:
  [
    exams:status.*,
    exams:resultsRoute.*,
    exams:resultsPanel.*,
    exams:processDialog.*,
    exams:publishDialog.*,
    exams:reopenDialog.*,
    exams:smsDialog.*,
    exams:reportCard.*,
    grading:resultsPage.*,
    grading:marksEntry.noExams*,
    printHistory:reopenRevoke*,
    printHistory:reopenRegisterError,
    nav:items.results,
    nav:groups.examsResults,
  ]
helpIds:
  [
    examsResults.results,
    examsResults.results.action.process,
    examsResults.results.action.publish,
    examsResults.results.action.reopen,
    examsResults.results.action.sendSms,
    examsResults.results.action.printReportCard,
  ]
devices: [desktop, phone]
entry: [sidebar, palette, page:people.students]
keywords:
  [ফলাফল, ফল প্রকাশ, প্রক্রিয়া, জিপিএ, অবস্থান, ফলাফলপত্র, এসএমএস, পুনরায় খুলুন, results, process, publish, report card, GPA, SMS, reopen]
appVersion: 0.1.0 (dd9119702)
owner: tareq89
lastVerified: 2026-11-02
knownIssues: []
-->

# Processing and publishing results

Build an exam's results from the submitted marks, check them and publish, and tell guardians by SMS.

**Where to go:** in the left menu, **Exams & Results → Results**. On a phone, press **☰** at the top left to open the menu, then follow the same path.
**Before you start:** be the school's Admin or Exam controller. The Teachers must have submitted the marks lists ([Enter marks](marks-entry.md)). The exam's academic year must have a [grading scale](grading-scales.md).

This page is about an exam's **results**. The results of every exam are in one of three states: **Draft** (not built yet), **Processed** (built; only school staff see it) and **Published** (guardians see it). When you choose an exam, its state and the next step are written at the top, and the main button is always the next step.

To put the exams of a class together into one result for the whole year, use [Final results](final-results.md). Publish each exam here first.

[Process results](#task-main) · [Publish](#task-publish) · [Send SMS](#task-sms) · [Reopen](#task-reopen) · [Print a report card](#task-card) · [Problems and fixes](#trouble)

**On this page**

- [How you get to this page](#arrive)
- [Process results](#task-main)
- [How to know the results are built and published](#confirm)
- [Other situations](#other)
  - [Publish the results](#task-publish)
  - [Send the result SMS to guardians](#task-sms)
  - [Reopen published results](#task-reopen)
  - [View and print one student's report card](#task-card)
  - [Process again after marks change](#task-reprocess)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get to this page <a href="#arrive" id="arrive"></a>

**From the left menu**

1. In the left menu press **Exams & Results → Results**. → This page opens with the first exam chosen. Start from [Process results](#task-main) below.

**From a student's page**

1. Open a student's page from the [Students](../people/students.md) list, then press an exam's row in their results section. → That exam's report card opens straight away; start from step 2 of [View and print a report card](#task-card).

**From the exam's page**

1. The results tab of [the exam's page](exams.md) has the same list and the same buttons. The steps there follow this page.

---

## Process results <a href="#task-main" id="task-main"></a>

1. In the left menu press **Exams & Results**, then press **Results**.

   → The **Results** page opens.

2. In the **Exam** box, choose the exam.

   → The state appears beside it, for example **Draft**, with **Work out the results once every marks list is submitted.** Below it is **No results yet**.

![Results page with an exam chosen: the Draft badge, the line saying to work out the results once every marks list is submitted, and the Process result button on the right](img/results-02-draft.png)

3. On the right press **Process result**.

   → The **Process this exam's results?** window opens. If every marks list is submitted, the window has only a **Process** button. If a list is not submitted, it says **… marks list(s) are still not submitted:** with the list of them, and a warning.

4. Press **Process**.

   → The window closes. The state becomes **Processed**, with **Check the results, then publish. Guardians see them after publishing.** In the list below, each student has **Position**, **Roll · Name**, **Total**, **GPA**, **Grade** and **Pass** or **Fail**.

| What you press in the window | What happens                                                                                                                                                                                                      | Results built? |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **Process**                  | Every student's result is worked out from all the submitted marks.                                                                                                                                                | Yes            |
| **Process anyway**           | The results are worked out with lists that are not submitted or have blank cells, as they are. **A blank cell counts as absent, so that student fails that subject.** This decision is recorded in the audit log. | Yes            |
| **Cancel**                   | Nothing happens.                                                                                                                                                                                                  | No             |

> **Remember:** guardians do not see **Processed** results. To show them, [publish](#task-publish).

---

## How to know the results are built and published <a href="#confirm" id="confirm"></a>

This page does not keep anything separately on your phone or computer. Each action goes to the school's system as soon as you press the button in the window, so there is no "changed on screen only" or "saved on this device" state.

| State                           | How you know                                                                                                          | What next                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Reached the school's system** | The window closes, the badge beside the exam changes to **Processed** or **Published**, and the students' rows appear | Press the next step's button |

**To check:** go to another page, open **Results** again and choose the exam. If the badge and the list are the same, the action is in the system. After publishing you can also open one student's report card ([Report card](#task-card)).

**If the window does not close:** read the red message in the window and see [Problems and fixes](#trouble). Nothing is left half done; either the whole action happens or nothing does.

---

## Other situations <a href="#other" id="other"></a>

### Publish the results <a href="#task-publish" id="task-publish"></a>

1. Choose an exam in the **Processed** state. Look through the list; to see only the students who failed, tick **Fails only**.
2. On the right press **Publish**.

   → The **Publish these results?** window says **… student result(s) become visible to guardians.**

3. In the window press **Publish**.

   → The state becomes **Published**, with **Guardians can see these results.** The main button is now **Send result SMS**.

| What you press | What happens                                                     | Published? |
| -------------- | ---------------------------------------------------------------- | ---------- |
| **Publish**    | The results are published; guardians see them on their own page. | Yes        |
| **Cancel**     | Nothing changes.                                                 | No         |

After publishing, no mark or marks list of this exam can be changed, and neither can the grades of the [grading scale](grading-scales.md#task-published) used for these results.

### Send the result SMS to guardians <a href="#task-sms" id="task-sms"></a>

1. Choose the **Published** exam.
2. Press **Send result SMS**.

   → The **Send result SMS** window says **Up to … guardian(s) will be sent their child's result by SMS. Credits are taken per SMS part: a long message is split into parts, and each part uses one credit.** The number is an estimate; you cannot see in advance exactly how many will get it.

3. Press **Send**.

   → The window shows a green tick with **… message(s) queued.**, and **Send** can no longer be pressed. The messages then go out one by one.

The message has the student's name, the exam name, the GPA and the grade, and "(Fail)" if the student failed. A guardian with no phone number does not get a message. If you send again for the same publication, those who already got a message do not get a second one. If you reopen the results and publish again, that counts as a new publication.

| What you press | What happens                                                  | Sent? |
| -------------- | ------------------------------------------------------------- | ----- |
| **Send**       | The messages join the sending queue and SMS credits are used. | Yes   |
| **Cancel**     | Nothing is sent.                                              | No    |

### Reopen published results <a href="#task-reopen" id="task-reopen"></a>

If a mistake is found after publishing, the results can be put back to **Processed**.

1. Choose the **Published** exam.
2. On the right press **⋯** (more actions), then press the red **Reopen**.

   → The **Reopen this exam's results?** window says **… published result(s) will be unpublished and marks become editable again. This needs extra approval.** If certificates were issued for this exam earlier, the **Certificates already issued for this exam** list appears below, all ticked.

3. Untick any certificate you do not want to cancel.
4. Press the red button: **Reopen and revoke …** if certificates are ticked, or **Reopen** if not.

   → An extra approval window appears; finish the check with what it asks for. Then the state becomes **Processed**, and guardians no longer see the results.

5. To correct the marks, the Admin [reopens](marks-entry.md#task-reopen) that marks list, the Teacher corrects it and submits again. If marks change while the results are Processed, the results are recalculated by themselves.
6. At the end, **Publish** again.

| What you press          | What happens                                                                           | Reopened? |
| ----------------------- | -------------------------------------------------------------------------------------- | --------- |
| **Reopen**              | After approval the results are unpublished; the certificates stay as they were.        | Yes       |
| **Reopen and revoke …** | After approval the results are unpublished, and the ticked certificates are cancelled. | Yes       |
| **Cancel**              | Nothing changes.                                                                       | No        |

After reopening, the submitted marks lists do not open by themselves; the Admin must reopen each list separately. Only the Admin sees the ticks for cancelling certificates; others see **Ask an admin to revoke these from the certificate register**.

**If a final result counts this exam:** an exam that a **Published** [final result](final-results.md) counts cannot be reopened. The app says **A published final result counts this exam. Reopen that final result first, on the Final results page.** [Reopen the final result](final-results.md#task-reopen) first, then come back. If that final result is only **Built**, you can reopen the exam; the final result then goes back to **Draft** and you must build it again.

### View and print one student's report card <a href="#task-card" id="task-card"></a>

1. In the results list, press the student's **Roll · Name**.

   → The student's report card opens: at the top the name, **Pass** or **Fail**, **Exam**, **Roll**, **GPA** (with the grade) and **Position**. Below is the report card with the school's name and address, **Obtained**, **Grade** and **GPA** for each subject, and at the end the **Grade legend**.

2. At the top press **Print**.

   → The app first records the print, then opens the print window. If the record cannot be made, nothing is printed.

<img src="img/results-02-card.png" alt="one student's report card, GPA and position at the top, Print on the right, subject marks and the grade legend below; admin">

The report card also shows **Working days** and **Days present**, the **Class teacher's remark** and the **Conduct** grades, when they are available. The class teacher writes the remark and grades ([My class](../academics/my-class.md#task-notes)); they cannot be changed after the results are published.

To print many report cards or certificates at once, see [Certificates](../administration/print-templates/certificates.md) and [Exam documents](../administration/print-templates/exam-documents.md).

### Process again after marks change <a href="#task-reprocess" id="task-reprocess"></a>

In the **Processed** state there is a **Process again** button (on a phone, inside **⋯**). Pressing it opens the same **Process this exam's results?** window, and the new results replace the old ones. You cannot process again in the **Published** state; first [reopen](#task-reopen).

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                                | What to do                                                                                                                                                                                                                                                                              | Who can help                                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **No exams yet**                                                                                            | [Create an exam](exams.md) first.                                                                                                                                                                                                                                                       | Admin                                                                     |
| **Couldn't load exams.** or **Couldn't load results.**                                                      | Check your internet and try again.                                                                                                                                                                                                                                                      | Admin                                                                     |
| **Submitted, but has blank cells — reopen this sheet**                                                      | The list is submitted but some cells are blank. The Admin [reopens](marks-entry.md#task-reopen) the list, and the Teacher fills the cells and submits again.                                                                                                                            | Teacher, Admin                                                            |
| **Couldn't process this exam.**                                                                             | It appears for a few reasons: the exam's academic year has no [grading scale](grading-scales.md); a student has not chosen a subject from an optional subject group; a section of a class with group-based subjects has no group set; or an internet problem. Check one by one and fix. | Admin                                                                     |
| **Couldn't publish these results.**                                                                         | Check your internet. Results cannot be published unless the exam is **Processed**; reload the page to see the state.                                                                                                                                                                    | Admin                                                                     |
| **Couldn't reopen this exam.**                                                                              | Check whether the approval was finished, and whether the exam is **Published**.                                                                                                                                                                                                         | Admin                                                                     |
| **The results are reopened, but these could not be revoked: …. Try again or use the certificate register.** | The results are already reopened. Pressing the red button again only tries to cancel the remaining certificates.                                                                                                                                                                        | Admin ([Certificates](../administration/print-templates/certificates.md)) |
| **Couldn't load the certificates issued for this exam. Check the certificate register after reopening.**    | After reopening, go to the certificate register and check the old certificates.                                                                                                                                                                                                         | Admin ([Certificates](../administration/print-templates/certificates.md)) |
| **Results must be published before an SMS can be sent.**                                                    | [Publish](#task-publish) first.                                                                                                                                                                                                                                                         | Admin                                                                     |
| **Couldn't send the result SMS.**                                                                           | Check that there are enough SMS credits, then try again. If credits are low, no message goes at all.                                                                                                                                                                                    | Admin                                                                     |
| **Couldn't load this report card.**                                                                         | Try again. It also appears if this student's result for this exam is not built yet.                                                                                                                                                                                                     | Admin                                                                     |
| **The print could not be recorded, so it was not printed. Try again.**                                      | Check your internet and press **Print** again.                                                                                                                                                                                                                                          | —                                                                         |
| Some students have no **Position** in the list                                                              | This is normal: a student who failed has no position.                                                                                                                                                                                                                                   | —                                                                         |
| You do not see the **Process result** or **Publish** button                                                 | See [Who can do what](#roles).                                                                                                                                                                                                                                                          | Admin                                                                     |

More help with this: [What to do when something goes wrong](../help/troubleshooting.md#sms).

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                        | Open this page | Process and process again | Publish, SMS, reopen | Cancel certificates when reopening |
| ------------------------------------------- | -------------- | ------------------------- | -------------------- | ---------------------------------- |
| Admin                                       | Yes            | Yes                       | Yes                  | Yes                                |
| Exam controller                             | Yes            | Yes                       | Yes                  | No                                 |
| Academic coordinator, Teacher, Office staff | No             | No                        | No                   | No                                 |
| Accountant, Committee member                | No             | No                        | No                   | No                                 |

**Results** is not in the left menu of the other roles. The Academic coordinator, Teacher and Office staff are allowed to read results. A Teacher gets results only for students in their own section; another student's results show "not found". Guardians see published results on their own page.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page</strong> — top to bottom</summary>

1. **Results** — the heading; below it **Pick an exam, work out its results, then publish them.**
2. The **Exam** box, with the state badge and the next-step line beside it.
3. The **Fails only** tick.
4. The action buttons — **Result analysis**, **Process again**, the main button, and **⋯**. On a phone you see the main button, and the rest are inside **⋯**.
5. **The list** — **Position**, **Roll · Name**, **Total**, **GPA**, **Grade**, **Status**. Press a column name to sort by that column; it starts with 25 students per page.

<img src="img/results-01-processed.png" alt="the five parts of the Results page of a processed exam marked with numbers, admin">

</details>

<details>
<summary><strong>What each field means</strong></summary>

| Field                             | What to enter                                                                | Required? |
| --------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Exam                              | Whose results. The first time, the first exam in the list is already chosen. | Yes       |
| Fails only                        | If ticked, only students who failed are in the list.                         | No        |
| Ticks for cancelling certificates | Which old certificates to cancel when reopening. All are ticked at first.    | No        |

</details>

<details>
<summary><strong>How results are worked out</strong> — states, grades, GPA and position</summary>

<figure>
  <img src="diagrams/exams-results-results-overview.svg" alt="From Draft, pressing Process result makes it Processed; pressing Publish makes it Published, when guardians see it and the SMS can be sent; pressing Reopen makes it Processed again after extra approval" width="720">
  <figcaption><em>The three states of results</em></figcaption>
</figure>

- **A subject's grade:** each subject's percentage is rounded to a whole number, and the grade and GPA come from the [grading scale](grading-scales.md). If a student is absent in any part, the subject's grade is **ABS** and the subject is failed. If a student gets less than the pass mark in any part, the subject gets the scale's fail grade. An exempt part is left out of the calculation. If you process anyway, blank cells count as absent.
- **Total GPA:** add up the GPA of the compulsory subjects. If there is a fourth subject, add the amount its GPA is above 2. Divide that sum by the number of compulsory subjects and round to two decimals; the total GPA never goes above 5. If a student fails any compulsory subject, the whole result is **F** and the GPA is 0. If the fourth subject is failed, only its extra amount is left out.
- **Position:** higher GPA first; if the GPA is equal, higher total marks first. If both are equal, they share a position and the next student skips that number (1, 2, 2, 4). A student who failed has no position.

</details>

**Related pages**

- [**Entering and submitting exam marks**](marks-entry.md) — Teachers submit the marks lists before the results.
- [**Setting up grading scales**](grading-scales.md) — which percentage gets which grade and GPA.
- [**Students**](../people/students.md) — a student's page shows the results of all their exams.
- [**Creating and setting up exams**](exams.md) — the same results tab is on the exam's page too.
- [**Final results**](final-results.md) — put the exams of a class together into one result for the year.
- [**Promoting students**](promotion.md) — moving students up to the next class after the results.
- [**Printing exam documents**](../administration/print-templates/exam-documents.md) — Print admit cards, seat slips, mark sheets and result documents for an exam, one at a time or in batches.
- [**Merit list and result analysis**](analysis.md) — See an exam's merit list, the students who failed or were absent and the pass/fail by subject, filter by section, print or download a CSV.
- [**Promoting students**](promotion.md) — Using published results, move a class's students up to the next class in the new academic year, keep them in the same class or graduate them.
- [**Results**](../portal/results.md) — where guardians and students see published results.

---

_Version 0.1.0 · last verified 2026-10-25_
