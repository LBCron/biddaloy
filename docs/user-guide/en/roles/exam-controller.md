# Exam controller

This role keeps everything about exams in one pair of hands, from setting them up to publishing results.

As an Exam controller you are busiest in exam season. First you create the exams, make seat plans and print the exam papers. When teachers submit marks, you see who is still left. When all the marks are in, you generate the results and publish them. After you publish, guardians and students see the results in their app.

**At a glance:** [Your first day](#first-day) · [Who does what diagram](#diagram) · [Your 5 common tasks](#tasks) · [All features](#features) · [What you cannot do](#cannot) · [Desk card](#card)

---

## Your first day <a href="#first-day" id="first-day"></a>

1. [Sign in](../start/sign-in.md#task-main). The dashboard shows the state of mark submission and results as soon as you are in.
2. [Build an exam template](../exams-results/exam-templates.md#task-main). It says how many marks each subject has; set it once and use it again and again.
3. [Create an exam](../exams-results/exams.md#task-main).
4. [Create a seat plan](../exams-results/seat-plans.md#task-main).
5. [See the state of mark submission](../exams-results/marks-entry.md#task-main). You can tell which teacher has not submitted yet.

---

## Who does what <a href="#diagram" id="diagram"></a>

![Exam controller in the middle; teachers submit marks, the Admin sets the grading scale, and when the Exam controller publishes results they reach the guardian's and student's portal](diagrams/roles-exam-controller.svg)
<!-- diagram brief: teacher -> Exam controller : submitted marks (MARK_ENTER -> MARK_VIEW); Admin -> Exam controller : grading scale (GRADING_SCALE_MANAGE Admin only); Exam controller -> portal (guardian, student) : published results (RESULT_PUBLISH -> RESULT_READ); Exam controller -> student : seat plan and exam papers (SEAT_PLAN_MANAGE, DOCUMENT_PRINT); Exam controller -> Academic coordinator : results and analysis (RESULT_READ); Exam controller -> Admin : results for promotion (PROMOTION_MANAGE Admin only) -->

Where marks come from, and where results go.

---

## Your 5 common tasks <a href="#tasks" id="tasks"></a>

1. **[Create an exam](../exams-results/exams.md#task-main)** — pick the name, class and template, then create the exam.
2. **[Create a seat plan](../exams-results/seat-plans.md#task-main)** — pick the exam and rooms, publish the plan.
3. **[Print exam papers](../administration/print-templates/exam-documents.md#task-main)** — pick admit cards or attendance sheets, then print.
4. **[See submitted marks](../exams-results/marks-entry.md#task-main)** — see which subject's marks are left, and remind the teacher.
5. **[Publish results](../exams-results/results.md#task-main)** — generate the results, check them, then publish.

---

## All features <a href="#features" id="features"></a>

All your features, in the order of the left menu. The list is built automatically.

<!-- guide:generated:roles:exam-controller -->

- [Dashboard](../dashboard/dashboard.md) — See on the first page after sign-in what needs your attention today, and go to the right page in one press.
- [Applications](../applications/applications.md) — Submit school applications such as leave, fee waiver, transfer certificate, testimonial and section change, enter a guardian's paper application into the app, and approve or reject applications waiting for your decision. When the last step is approved, work such as leave or a waiver happens by itself.

**People**

- [Students](../people/students.md) — Add a new student, import many at once, and use each student's profile to handle class, guardians, fees, notes and leaving the school.
- [Calendar](../people/calendar.md) — See school holidays, exams, meetings and events in a month calendar. The Admin adds them, imports them from a file or copies them from last year. Everyone can subscribe in their own phone calendar app.

**Academics**

- [Routine review](../academics/routine-review.md) — See every period of the arranged routine in one list, send it for review so teachers can look, publish it, handle teachers' change requests, and copy the routine to another academic year.
- [My routine](../academics/my-routine.md) — Teachers see their own periods for today and the next days, see whom they are covering for, and report whether each period was taught.

**Attendance**

- [Attendance](../attendance/attendance.md) — Take your section's attendance, mark late arrivals and leave, and fix mistakes.
- [Attendance reports](../attendance/attendance-reports.md) — See a section's monthly attendance figures, find who is falling behind, and send a reminder if needed.
- [Attendance register](../attendance/attendance-register.md) — See a section's whole month of attendance laid out like the paper register, print it, and correct several days at once on a computer.
- [Staff attendance](../attendance/staff-attendance.md) — Record teachers' and staff attendance every day, check your own leave balance, request leave, and approve requests.

**Exams & Results**

- [Exams](../exams-results/exams.md) — Add an exam for a class, set the parts and marks of each subject, give a schedule, and follow the exam from marks submission to published results.
- [Exam structures](../exams-results/exam-templates.md) — Write the parts and marks of every class and subject once in a structure, then pick the structure when you add an exam to get all the parts at once.
- [Enter marks](../exams-results/marks-entry.md) — Pick an exam, open the marks list for your section and subject, type each student's marks or mark them absent or exempt, then submit the list.
- [Seat plans](../exams-results/seat-plans.md) — Pick the subjects of an exam and the rooms to make who sits in which room and seat, change seats if needed, give rooms an invigilator, then publish.
- [Results](../exams-results/results.md) — Build an exam's results from the submitted marks, check them and publish, send guardians an SMS, reopen when needed, and print each student's report card.
- [Final results](../exams-results/final-results.md) — See a class's final result for the year. Staff who may process results also put the published exams together, choose how much each counts, build and check it, publish it for guardians, send the SMS, print the report cards and reopen it.
- [Result analysis](../exams-results/analysis.md) — See an exam's merit list, the students who failed or were absent and the pass/fail by subject, filter by section, print or download a CSV.

**Reports**

- [Print & documents](../reports/printables.md) — See what was printed, which certificates were issued and what is still waiting to be printed, in three tabs; reprint or revoke a card, or download the certificate list for Excel.

<!-- /guide:generated -->

---

## What you cannot do <a href="#cannot" id="cannot"></a>

- Enter or change marks. You only view marks. Who can: the [Teacher](./teacher.md).
- Set the grading scale, or promote students. Who can: the [Admin](./admin.md).
- Issue certificates. Who can: the [Academic coordinator](./headmaster.md) or [Office staff](./office-staff.md).
- Add students or change their details. Who can: [Office staff](./office-staff.md).
- Anything about money, fees or invoices. Who can: the [Accountant](./accountant.md).
- Take student attendance. Who can: the [Teacher](./teacher.md).

---

## Desk card <a href="#card" id="card"></a>

The five common tasks on one page, to print and keep on your desk.

[Open the card (PDF)](cards/exam-controller.en.pdf) · [বাংলা কার্ড (PDF)](cards/exam-controller.bn.pdf)

---

## Learn more <a href="#more" id="more"></a>

**Related pages**

- [Roles and access](../administration/roles.md) — what each role can do, side by side.
- [Signing in](../start/sign-in.md) — the first time in, and passwords.
- [Merit list and results analysis](../exams-results/analysis.md) — understanding results after publishing.
- [Setting the grading scale](../exams-results/grading-scales.md) — how marks become a grade.
- [All roles](./README.md)
