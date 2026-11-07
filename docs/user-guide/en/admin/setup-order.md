<!-- guide:meta
feature: admin.setupOrder
title: The order to set up your school
summary: Which task to do in which order in a new school, step by step, following the setup list on the dashboard.
roles: [ADMIN]
sources:
  - client-admin/src/features/onboarding/setup-checklist-card.tsx
  - client-admin/src/features/onboarding/welcome-wizard.tsx
  - client-admin/src/features/onboarding/setup-doors.tsx
  - client-admin/src/routes/_staff/dashboard.tsx
labels:
  [
    setupChecklist:*,
    onboardingSetup:doors.*,
    onboardingSetup:guided.*,
    onboardingPeople:summary.*,
    curriculumPreset:title,
    curriculumPreset:submit,
    classes:sections.addSection,
    students:list.importStudents,
    guardians:invite.*,
  ]
helpIds: [admin.setupOrder, admin.setupOrder.action.continueSetup]
devices: [desktop, phone]
entry: [dashboard:setup-checklist, page:admin.createSchool]
keywords: [setup, order, checklist, onboarding, set up school, সেটআপ, ক্রম, চেকলিস্ট]
appVersion: 0.1.0 (beb2d2e77)
owner: tareq89
lastVerified: 2026-10-24
knownIssues: []
-->

# The order to set up your school

Here you find the order that makes the tasks of a new school easiest, one after another.

**Where to go:** The **Finish setting up your school** card on the dashboard. Each row of the card takes you to the page for its task. The same card is on the dashboard on a phone too.
**Before you start:** You must be the admin of the school. If you have not created your school yet, see [Creating your school and the setup wizard](create-school.md) first. If you want to understand first how things connect, read [How everything in your school fits together](how-it-works.md).

This page is about your **setup list**. The card on the dashboard has eight rows. Each row says **Done** or **To do**. The nine steps below follow the same order. Only the academic year and the routine are not on the card, so they are placed in between as steps of their own.

[See the steps](#task-main) · [Is everything correct](#confirm) · [If classes already exist](#task-existing) · [Problems and fixes](#trouble)

**On this page**

- [How you get here](#arrive)
- [The nine steps](#task-main)
- [How to know it worked](#confirm)
- [Other situations](#other)
  - [If classes or students already exist](#task-existing)
  - [If you pressed "Do this later" in the wizard](#task-later)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How you get here <a href="#arrive" id="arrive"></a>

**From the dashboard**

1. On the dashboard, find the **Finish setting up your school** card. It has a line like "3 of 8 done".
2. Press a row that says **To do**. → The page for that task opens. Start from the matching step below.

**From the last page of the setup wizard**

1. At the end of the wizard, on the **Your school is ready** page, the **What to do next** part has **Set up fees**, **Invite guardians** and **Set up messages**. How the wizard works is on the [Creating your school and the setup wizard](create-school.md) page.
2. Press **Go to dashboard**. → The same card shows on the dashboard. Start from step 7 below.

---

## The nine steps <a href="#task-main" id="task-main"></a>

It is easiest to follow the order, because each task stands on the one before it. Without a section you cannot admit a student. Without a class you cannot build a fee structure.

### Step 1: School profile <a href="#step-1" id="step-1"></a>

1. On the dashboard card, press **School profile**.

   → The **School** section of **Settings** opens, and you see the **School profile** part.

2. Type the **Name (Bengali)**. If you like, add a logo with **Upload logo**. If you have an **EIIN / registration number**, add that too.
3. Press **Save** at the bottom of the section.

   → The **Saved** message appears. The **School profile** row on the card says **Done**.

A Bangla name or a logo, either one, is enough to make the row **Done**.

![Settings, School section: the school profile fields, the logo upload and Save](img/setup-order-01.png)

### Step 2: Academic year <a href="#step-2" id="step-2"></a>

A class sits inside an academic year, so you need the academic year first. It is not one of the eight rows on the card.

- **If you use the ready-made curriculum in step 3:** the academic year is created by itself. You do not need to do anything in this step.
- **If you make the classes yourself:** in the left menu open **Academics → Academic years** (→ [Creating and managing academic years](../academics/academic-years.md)) and make an academic year first.

### Step 3: A ready-made curriculum, or your own classes <a href="#step-3" id="step-3"></a>

The row on the card is called **Classes**. It is **Done** as soon as there is one class.

**To use a ready-made curriculum:**

1. In the left menu, press **Administration → Ready-made curriculum** (→ `../administration/curriculum-preset.md`).

   → A page with three steps opens: **Choose a curriculum**, **Options** and **Confirm**.

2. Choose a curriculum, set the **Options**, then press **Use this curriculum**.

   → It asks you to type the name of the curriculum to confirm.

3. Confirm.

   → The academic year, classes, subjects, grading method and exam structure are all created together.

> **Remember:** A ready-made curriculum can be applied only to a brand new school, that is, a school with no classes or students yet. Some curricula have **Not verified** beside them. In that case, check the subjects and marks yourself.

**To make your own classes:** in the left menu open **Academics → Classes** (→ [Arranging classes, sections and subjects](../academics/classes.md)) and press **Add class**. If you need a shift or version, first see [Academic year, class, section](how-it-works.md#task-structure).

<img src="img/setup-03-curriculum-preset.png" alt="Ready-made curriculum page: 1 the Choose a curriculum step, 2 a curriculum card, 3 its Choose button; Use this curriculum comes on the Confirm step">

### Step 4: Sections <a href="#step-4" id="step-4"></a>

The row on the card is called **Sections**. It is **Done** as soon as there is one section.

1. In the left menu, press **Academics → Classes**.

   → The list of classes opens.

2. On the row of the class you want to add a section to, press **View**. Open the **Sections** tab.

   → You see the list of sections of that class.

3. Press **Add section**. Type a name and press **Save**.

   → The new section appears in the list.

### Step 5: Students <a href="#step-5" id="step-5"></a>

The row on the card is called **Students**. It is **Done** as soon as there is one student.

1. In the left menu, press **People → Students** (→ [Adding students and viewing their details](../people/students.md)).

   → The list of students opens.

2. To add many students at once, press **Import students**. See the rules for making the Excel file and the sample (→ [Sample schools: which one is yours?](scenarios.md)). Upload the file.

   → The file is checked first.

3. If the check is fine, confirm.

   → The students are added to the list.

Sending the invitation to guardians is in step 9.

<img src="img/setup-05-import-students.png" alt="the Students page: 1 the Import students button, admin">

<img src="img/setup-05b-import-check.png" alt="the Import students page after the file is checked: 1 No problems and the number of students that will be created, above the preview rows, admin">

### Step 6: Staff and roles <a href="#step-6" id="step-6"></a>

The row on the card is called **Staff**. It is **Done** when two different people are staff. A person who is both admin and teacher counts as one. Members of the governing committee are not counted here.

1. In the left menu, press **People → Staff** (→ [Adding and managing staff](../people/staff.md)).

   → The list of staff opens.

2. Add them one by one. Set each person's role (Admin, Teacher, Accountant and so on). To add many at once, see **Import from Excel** (→ [Adding staff from Excel](../people/staff-import.md)). In that file, the Role column is used to tell teachers and other staff apart.

   → The staff appear in the list.

3. Give the teacher sections. On the **People → Teacher assignments** page (→ [Giving teachers class and section duties](../people/teaching-assignments.md)), a teacher who has no assignment sees no section.

> **Remember:** Adding staff is not the end of the job. Without an assignment, a teacher cannot take attendance.

### Step 7: Fee structure <a href="#step-7" id="step-7"></a>

The row on the card is called **Fees**. It is **Done** as soon as there is one fee structure.

1. In the left menu, press **Finance → Fee structures** (→ `../finance/fee-structures.md`).

   → The list of fee structures opens.

2. Write which class pays how much for which item, and save.

   → The structure appears in the list. The **Fees** row on the card says **Done**.

Creating the fee bills and taking payments are not on this page. They come later on the path of a fee (→ [the fourth of the five pictures](how-it-works.md#task-money)).

![Fee structures page with the list of structures and the add button](img/setup-order-04.png)

### Step 8: Routine <a href="#step-8" id="step-8"></a>

This is not one of the rows on the card. Set it up only after the classes, sections and staff exist.

In the left menu, press **Academics → Routine setup** (→ [Setting up shifts, period times, rooms and rules for the routine](../academics/routine-setup.md)). The steps for making a routine are on that page.

### Step 9: Go live <a href="#step-9" id="step-9"></a>

The last two rows of the card: **Invite guardians** and **Message settings**.

If you answered **Yes, set it up** to **Do you want a school website too?** in the wizard, the card also has a **Set up the website** row. Press it to open the website page and follow the steps there.

1. On the card, press **Invite guardians**.

   → On the guardians page, **Invite guardians** opens.

2. Press **Preview invitations**. Check who will be invited and who is left out.

   → A line like "3 guardian(s) will be invited — 1 skipped." appears. Nothing has been sent yet.

3. If it is correct, press **Send invitations**.

   → The invitations go out. Nothing is sent until you confirm.

4. On the card, press **Message settings**. In the **Communication** section, turn on SMS or email.

   → When SMS or email is on, the row says **Done**. The **Invite guardians** row says **Done** once at least one guardian has joined.

When every row is **Done**, the card no longer shows on the dashboard.

> **Remember:** Nothing goes to any guardian until you press **Send invitations**.

---

## How to know it worked <a href="#confirm" id="confirm"></a>

| State                           | How you know                                                                           | What next                    |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| **Reached the school's system** | The row on the card says **Done**, and the "3 of 8 done" number at the top has gone up | Go to the next **To do** row |

The **Done** mark on a row is worked out again each time from the school's real information. If you make a class some other way, the **Classes** row also becomes **Done**.

**To check:** Leave the dashboard and go to the matching list, for example **Academics → Classes**. If the thing you made is there, it is in the system.

**If the tick does not appear:** see [Problems and fixes](#trouble). The information you gave has not been lost.

---

## Other situations <a href="#other" id="other"></a>

### If classes or students already exist <a href="#task-existing" id="task-existing"></a>

A ready-made curriculum cannot be applied, so the first way in step 3 is not for you. Take the way for **making your own classes**. The other steps are the same.

### If you pressed "Do this later" in the wizard <a href="#task-later" id="task-later"></a>

The setup wizard has a **Do this later** button (the close control of the wizard). If you press it, you go to the dashboard and the **Finish setting up your school** card is hidden, the same as pressing **Hide**. Nothing you made is lost. Start from step 1 of this page and do the tasks from the menu. (The door called **I will do it later** is different: it only takes you to the **Add your people** step.)

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                                          | What to do                                                                                                                                                                                                           | Who can help |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Your school already has classes or students, so a ready-made curriculum cannot be applied.** (the wizard's message) | Instead of the ready-made curriculum, make your own classes from **Academics → Classes**.                                                                                                                            | Admin        |
| The **Finish setting up your school** card is not on the dashboard                                                    | Either **Hide** (or the wizard's **Do this later**) was pressed before, or every row is **Done**. The card may also be missing because this school was already running before. Do the steps yourself from this page. | Admin        |
| I added staff but the **Staff** row says **To do**                                                                    | The row needs two different people to be **Done**. If one person is both admin and teacher, that counts as one.                                                                                                      | Admin        |
| **Could not mark setup as finished. You can still go to the dashboard.**                                              | Press **Go to dashboard**. You can carry on with the tasks from the card on the dashboard.                                                                                                                           | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role        | Can see the setup list and act on it                                    |
| ----------- | ----------------------------------------------------------------------- |
| Admin       | Yes                                                                     |
| Teacher     | No                                                                      |
| Accountant  | No. Can only do steps 5 (students) and 7 (**Finance → Fee structures**) |
| Other roles | No                                                                      |

Only the admin sees the **Finish setting up your school** card.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>What the three ways in the wizard mean</strong></summary>

<figure>
  <img src="diagrams/admin-structure.svg" alt="Classes inside an academic year, sections inside a class. Shift and version are labels on a class; group is a label on a section." width="720" />
</figure>

- **Step by step:** the school name and logo, a ready-made curriculum, then the sections of each class.
- **From an Excel file:** write the academic years, classes, sections, subjects and fees in one sample file and upload it. The file only adds new things. It does not change or delete anything you already have.
- **I will do it later:** goes to the **Add your people** step.

</details>

**Related pages**

- [**Creating your school and the setup wizard**](create-school.md): opening a school and the wizard.
- [**How everything in your school fits together**](how-it-works.md): the structure of a school in five pictures.
- [**Creating and managing academic years**](../academics/academic-years.md): step 2: make the academic year first.
- [**Arranging classes, sections and subjects**](../academics/classes.md): step 3: make classes, sections and subjects by hand.
- [**Adding students and viewing their details**](../people/students.md): step 5: add or import students.
- [**Ready-made curriculum**](../administration/curriculum-preset.md) — In a brand-new school, choose a ready-made curriculum and create the academic year, classes, subjects.

---

_Version 0.1.0 · Last verified 2026-10-24_
