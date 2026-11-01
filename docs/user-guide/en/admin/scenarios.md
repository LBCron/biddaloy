<!-- guide:meta
feature: admin.scenarios
title: Sample schools: which one is yours?
summary: Pick a ready-made Excel file that looks like your school, put in your own details, and upload it in the setup wizard of a new school.
roles: [ADMIN]
sources:
  - server/src/scripts/guide-scenarios/scenarios.ts
  - client-admin/src/features/onboarding/excel/excel-setup.tsx
  - client-admin/src/features/onboarding/setup-doors.tsx
labels: [onboardingSetup:excel.*, onboardingSetup:doors.*, onboardingSetup:support, backup:diffTabName.*, nav:tenantBar.switchSchoolOrRole]
helpIds: [admin.scenarios]
devices: [desktop, phone]
entry: [page:admin.createSchool, page:admin.setupOrder]
keywords: [sample, excel, example school, madrasa, cambridge, shift, branch, scenario, template, sample school]
appVersion: 0.1.0 (6b36c2549)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# Sample schools: which one is yours?

Pick a ready-made Excel file that looks like your school, put in your own details, and set up your school in one go.

**Where to go:** This is a reading page, not a menu in the app. You upload the file in the setup wizard of a new school.
**Before you start:** You are the Admin of a new school, and you have not closed the wizard yet. You need Excel on a computer (or any program that opens `.xlsx` files).

There are five samples. Each has one Excel file, except School and college, which has three (one per branch). All names, phone numbers and amounts are examples. Put in your own details before you upload.

[Which one is yours](#task-main) · [How to know it worked](#confirm) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [Pick a sample and upload it](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**From the create-school page**

1. Read the wizard part of [Creating your school and the setup wizard](create-school.md) and come here from there. → This page opens.

**From the setup-order page**

1. [The order to set up your school](setup-order.md) mentions the samples in [Step 5: Students](setup-order.md#step-5). Come here from there. → This page opens.

---

## Pick a sample and upload it <a href="#task-main" id="task-main"></a>

**Which one is yours?**

| Sample                                                                                       | Shifts       | Versions        | Branches | Groups                        | Medium or board          | Classes    | File                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------ | --------------- | -------- | ----------------------------- | ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Primary, one shift](scenarios/primary-single-shift.md)                                      | 1 (no name)  | None            | 1        | None                          | Bangla                   | Class 1–5  | [primary-school.xlsx](../admin-setup/scenarios/files/primary-school.xlsx)                                                                                                                                        |
| [High school, two shifts and two versions](scenarios/high-school-two-shifts-two-versions.md) | Morning, Day | Bangla, English | 1        | None                          | Bangla and English       | Class 6–10 | [high-school-two-shifts.xlsx](../admin-setup/scenarios/files/high-school-two-shifts.xlsx)                                                                                                                        |
| [School and college, three branches](scenarios/school-college-three-branches.md)             | None         | None            | 3        | Science, Commerce, Humanities | Bangla                   | Class 9–12 | [1](../admin-setup/scenarios/files/school-and-college-branch-1.xlsx), [2](../admin-setup/scenarios/files/school-and-college-branch-2.xlsx), [3](../admin-setup/scenarios/files/school-and-college-branch-3.xlsx) |
| [Nurani madrasa](scenarios/nurani-madrasa.md)                                                | Morning      | None            | 1        | None                          | Madrasa (not verified)   | Class 1–5  | [nurani-madrasa.xlsx](../admin-setup/scenarios/files/nurani-madrasa.xlsx)                                                                                                                                        |
| [English medium, Cambridge](scenarios/english-medium-cambridge.md)                           | None         | English         | 1        | None                          | Cambridge (not verified) | Year 7–11  | [cambridge-english-medium.xlsx](../admin-setup/scenarios/files/cambridge-english-medium.xlsx)                                                                                                                    |

- A small school with one shift, Class 1 to Class 5: **Primary, one shift**.
- Morning and day shifts, Bangla and English versions: **High school**.
- Branches in several places, groups in Class 11 and 12: **School and college**.
- Primary with the Quran and Arabic: **Nurani madrasa**.
- Year 7 to Year 11, everything taught in English: **English medium**.

If your school is not exactly like any of them, take the closest one, then change the class, section or subject rows in Excel.

**The same four steps for every sample** (each sample page has the details):

1. Download the sample file.
2. Open it in Excel and replace the example names, phone numbers, staff and fee amounts with your own.

   > **Remember:** the cells in the sheets point at each other. If you rename a class, shift, version or year, use Excel's **Find and Replace** and press **Replace All** across the whole file. Do not touch the `id` columns.

3. In the setup wizard, choose **From an Excel file**, press **Upload file**, look at the **This is what will be created** list, then press **Create these** ([The setup wizard, step by step](create-school.md#task-wizard)). The **Download sample file** button in the wizard is the app's own blank sample; the files on this page are different.

   → The message **Your school has been set up.** appears.

4. Do the rest by hand: the real fee amounts, staff and roles, and the routine ([The order to set up your school](setup-order.md)).

---

## How to know it worked <a href="#confirm" id="confirm"></a>

| Stage                                  | How you know                                                                                                                                                                                     | What next                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Before it is created**               | The **This is what will be created** list shows a count for each sheet (**Academic years**, **Classes**, **Sections**, **Subjects**, **Users**, **Guardians**, **Students**, **Fee structures**) | Check the counts against the table on the sample page (adjusted if you added or removed rows) |
| **It has reached the school's system** | The message **Your school has been set up.** appears                                                                                                                                             | Go on to the next step of the wizard                                                          |

**To double-check:** open the list of classes and see whether the sample's classes are there.

---

## Other situations <a href="#other" id="other"></a>

**If you have several branches:** every branch is a separate school. Upload each branch's own file in its own school. To move from one school to another, use **Switch school or role**. We could not verify how an admin opens the extra branch schools by themselves; ask the SchoolManager team to open them. Details: [School and college with three branches](scenarios/school-college-three-branches.md).

**If you closed the wizard:** the wizard comes only once. If you pressed **Do this later**, it does not return. We could not verify whether there is another way to upload this file later. Use the link at the bottom of the wizard, **Want us to set it up for you? Talk to us**, or ask the SchoolManager team directly. Do not use the restore option in Settings → Backup: it replaces the school's current data with the data in the file.

**If your kind of school is not on the list:** take the closest sample and change it in Excel.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                          | What to do                                                                                                                                                             | Who can help       |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **This is not the sample file. Download it above and use that one.**                                  | Download this guide's sample file again. Do not change the `_meta` sheet.                                                                                              | SchoolManager team |
| **This is not a valid .xlsx file. Save the sample as .xlsx in Excel and upload it again.**            | In Excel, use **Save As** and pick the `.xlsx` type. Then upload that file.                                                                                            | none needed        |
| **This file is too large to read. Check that it is the sample file you filled in.**                   | Upload the sample you filled in, not another file.                                                                                                                     | SchoolManager team |
| **This sample was made by a different version of the app. Download it again above and use that one.** | Download the sample again from this page and put your details in that one.                                                                                             | none needed        |
| **Another file is being checked right now. Wait a minute and try again.**                             | Wait a minute, then upload again.                                                                                                                                      | none needed        |
| **N problems found — fix them in the file and upload again**                                          | Press **Download the list of problems**, fix the file from the list, and upload again. If the sheets no longer match after a rename, check your **Replace All** again. | none needed        |
| **Already created: ... Fix the problem and upload again.**                                            | Fix the problem the message describes and upload again.                                                                                                                | SchoolManager team |
| The wizard does not come back                                                                         | See [If you closed the wizard](#other) above.                                                                                                                          | SchoolManager team |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role          | Can upload the file                      |
| ------------- | ---------------------------------------- |
| Admin         | Yes, in the setup wizard of a new school |
| Everyone else | No                                       |

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>How academic year, class and section fit together</strong></summary>

<figure>
  <img src="diagrams/admin-structure.svg" alt="Classes inside an academic year, sections inside a class. Shift and version are labels on a class; group is a label on a section." width="720" />
</figure>

- Each file has 9 sheets: `_meta`, `academic_years`, `classes`, `sections`, `subjects`, `users`, `guardians`, `students`, `fee_structures`.
- The file only adds new things; it does not change anything that already exists.
- Each file has two example staff: one teacher and one accountant.

</details>

**Read next**

- [**Creating your school and the setup wizard**](create-school.md): where to upload the file.
- [**The order to set up your school**](setup-order.md): what to do after the upload.
- [**How everything in your school fits together**](how-it-works.md): shift, version, group and branch.

---

_Version 0.1.0 · Last verified 2026-10-24_
