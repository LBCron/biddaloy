<!-- guide:meta
feature: reports.printables
title: Print & documents
summary: See what was printed, which certificates were issued and what is still waiting to be printed, in three tabs; reprint or revoke a card, or download the certificate list for Excel.
roles: [ADMIN, EXECUTIVE, OFFICE_STAFF, EXAM_CONTROLLER]
sources:
  - client-admin/src/routes/_staff/reports/printables.tsx
  - client-admin/src/components/print/history/printables-tabs.tsx
  - client-admin/src/components/print/history/print-history-page.tsx
  - client-admin/src/components/print/history/certificate-register.tsx
  - client-admin/src/components/print/history/to-print.tsx
  - client-admin/src/components/print/history/to-print-cards.tsx
  - client-admin/src/components/print/history/reprint-dialog.tsx
  - client-admin/src/components/print/history/revoke-dialog.tsx
  - client-admin/src/components/print/history/history-item-dialog.tsx
  - server/src/modules/print/jobs/print-history.controller.ts
  - server/src/modules/print/jobs/certificates.controller.ts
  - client-admin/src/routes/_staff/results/final/-print-panel.tsx
labels:
  [
    printHistory:*,
    nav:items.printables,
    nav:groups.reports,
  ]
helpIds:
  [
    reports.printables,
    reports.printables.action.reprint,
    reports.printables.action.revoke,
    reports.printables.action.printAdmitCards,
    reports.printables.action.printIdCards,
    reports.printables.action.exportRegister,
    reports.printables.field.revokeReason,
    reports.printables.field.validity,
  ]
devices: [desktop]
entry: [sidebar, palette]
keywords:
  [print, printed, print history, certificate, certificate register, admit card, id card, reprint, revoke, QR, history]
appVersion: 0.1.0 (3f7e424fc)
owner: tareq89
lastVerified: 2026-11-02
knownIssues: []
-->

# Print & documents

See in one place what the school has printed, which certificates were given and what is still waiting to be printed.

**Where to go:** in the left menu, **Reports → Print & documents**. Do the work on this page on a computer.
**Before you start:** be an Admin, Academic coordinator, Office staff or Exam controller ([who can do what](#roles)). To reprint, a printer must already be added.

The page has three tabs: **Print history**, **Certificate register** and **To print**. Every printed copy has its own number and QR code. The rules for printing cards and certificates are on the pages [Printing ID cards](../administration/print-templates/id-cards.md), [Certificates](../administration/print-templates/certificates.md) and [Exam documents](../administration/print-templates/exam-documents.md).

[See the history](#task-main) · [Reprint](#task-reprint) · [Revoke](#task-revoke) · [To print](#task-to-print) · [Problems and fixes](#trouble)

**On this page**

- [Find what was printed](#task-main)
- [How to know a print went well](#confirm)
- [Other situations](#other)
  - [Reprint a card or certificate](#task-reprint)
  - [Revoke a card or certificate](#task-revoke)
  - [See the certificate register and download it for Excel](#task-register)
  - [Prints from Final results](#task-final-prints)
  - [Print what is still waiting](#task-to-print)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## Find what was printed <a href="#task-main" id="task-main"></a>

1. In the left menu press **Reports**, then press **Print & documents**.

   → The **Print history** tab opens. Each print is one row: **Printed**, **Person**, **Document**, **Printed by**, **Copy**, **Status**. The newest come first.

2. In the **Search by name** box type the person's name.
3. If needed, filter by **Document type**, **Date**, **Result** or **Status**.

   → The list gets shorter at once, from the first page.

4. Press **View** on a row.

   → **Printed copy** opens: the front and back picture, who printed it and when, the copy number and the status. If it was revoked, the reason is shown too.

![Print & documents, Print history tab, with the filters, the list, and one row showing Revoked](img/printables-02-revoked.png)

> **Remember:** **Printed copy** does not show the QR code, because the QR code is not stored. Reprint to get a new one.

---

## How to know a print went well <a href="#confirm" id="confirm"></a>

Every print has a mark in the **Status** column:

| Status          | Meaning                                                                            | What next                                                      |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Printed**     | Printing is done; the card or certificate is valid                                 | Nothing more to do                                             |
| **Pending**     | Printing has started; nobody has answered **Did all … cards print correctly?** yet | Check the paper, then answer that question in the print window |
| **Not printed** | Printing failed                                                                    | [Reprint](#task-reprint)                                       |
| **Revoked**     | Someone revoked it; scanning the QR code shows it is not valid                     | Print a new one if you need one                                |

After printing, the print window asks **Did all … cards print correctly?** **Yes, all printed** makes every copy **Printed**. With **Some failed…**, the copies you tick become **Not printed** and the rest **Printed**.

This page does not keep anything on your phone or computer, so there is no "saved on this device" state. The filters are kept in the page address and stay after a reload.

---

## Other situations <a href="#other" id="other"></a>

### Reprint a card or certificate <a href="#task-reprint" id="task-reprint"></a>

1. Press **Reprint** on the row.

   → The **Reprint …** window opens: **This prints the same card exactly as before, as a new copy with its own QR code.**

2. From **Printer** choose a printer.
3. Press **Print**.

   → The browser's print window opens. A new row with a new copy number appears in the history. The earlier copy is not revoked; if you want to make it useless, [revoke it](#task-revoke).

A revoked row does not have **Reprint**.

### Revoke a card or certificate <a href="#task-revoke" id="task-revoke"></a>

Revoke a card if it is lost or printed by mistake. Only an Admin can do this.

1. Press **Revoke** on the row.

   → The **Revoke …** window opens: **Anyone scanning this card's QR code will see it is no longer valid.**

2. Type the **Reason**, for example "Card was lost". It is required, up to 280 characters. Only staff see it.
3. Press **Revoke card**.

   → The message **Card revoked** appears, and the row's **Status** becomes **Revoked**.

> **Remember:** there is no button on this page to undo a revoke. Be sure before you revoke.

### See the certificate register and download it for Excel <a href="#task-register" id="task-register"></a>

1. Press the **Certificate register** tab.

   → It shows this year's certificates, for example **… certificates in 2026**. Columns: **Serial**, **Kind**, **Student**, **Issued on**, **Issued by**, **Copy**, **Status**. For a second copy, **Copy** says **… · duplicate**.

2. To search, type a **Name or serial number**. To see every year, choose **All years** from **Year**.
3. To get the list, press **Download for Excel**.

   → A file of the list downloads, following the filters you picked.

Certificates are not issued from here; they are issued from the student's Documents tab ([Students](../people/students.md)).

### Prints from Final results <a href="#task-final-prints" id="task-final-prints"></a>

The report cards and the tabulation sheet printed from the **Print** tab of a [final result](../exams-results/final-results.md) open the browser's print window straight away. They are **not** saved in the **Print history** and do not get a copy number or a QR code. If you need a record, print the exam's report card from [Processing and publishing results](../exams-results/results.md#task-card), which does record the print.

### Print what is still waiting <a href="#task-to-print" id="task-to-print"></a>

Only people who can print see the **To print** tab. The tab shows the number waiting beside it.

1. Press **To print**.

   → At the top it says **… papers waiting, nearest exam first**. There are two parts: **Admit cards** and **ID cards**.

2. Under **Admit cards**, each exam and class card says **… waiting**. Press **Print … admit cards**.

   → Admit cards of students who owe fees are printed too; they are marked **Owes fees** in the list.

3. Under **ID cards**, on the **Never got an ID card** card, press **Print … ID cards**.

   → Students with no photo are left out; it says **… have no photo and will be left out.** To add a photo, press **Add** on the row.

You can filter the waiting list by type and **Class**.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                       | What to do                                                                                 | Who can help |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| **Could not load the print history.**              | Reload the page.                                                                           | Admin        |
| **Add a printer in Settings first.**               | Add a printer ([Printers](../administration/print-templates/printers-and-calibration.md)). | Admin        |
| **Your browser blocked the print window. …**       | Allow pop-ups for this site, then press **Print** again.                                   | —            |
| **Could not start printing. Nothing was printed.** | Try again.                                                                                 | Admin        |
| **Could not revoke this card.**                    | Reload the page and check whether someone else already revoked it.                         | Admin        |
| **Enter a reason.**                                | The **Reason** box is empty. Type a reason and press again.                                | —            |
| No **To print** tab, or no **Reprint**             | Your role cannot print these. See [who can do what](#roles).                               | Admin        |
| ACR is missing from **Document type**              | ACR is confidential; only people who can see ACRs see it.                                  | Admin        |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                                  | View history and register, Excel | Reprint: ID and admit cards | Reprint: student certificates | To print | Revoke |
| ------------------------------------- | -------------------------------- | --------------------------- | ----------------------------- | -------- | ------ |
| Admin                                 | Yes                              | Yes                         | Yes                           | Yes      | Yes    |
| Academic coordinator                  | Yes                              | No                          | Yes                           | No       | No     |
| Office staff                          | Yes                              | Yes                         | Yes                           | Yes      | No     |
| Exam controller                       | Yes                              | Yes                         | No                            | Yes      | No     |
| Accountant, Teacher, Committee member | No                               | No                          | No                            | No       | No     |

**Admin:** can do everything. Only the Admin gets the **Printed by** filter, and only the Admin can revoke. The Admin also sees prints of ACRs.

**Academic coordinator:** can view and can reprint student certificates. Does not get the **Design** filter, **Print ID cards** or the **To print** tab.

**Office staff:** everything except revoke.

**Exam controller:** prints ID cards and admit cards and gets **To print**; cannot reprint student certificates.

An Accountant may have permission to print but not to view the history, so **Print & documents** is not in their left menu.

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>Parts of the page, top to bottom</strong> — the Print history tab</summary>

- The **Print & documents** title and the **Print ID cards** button.
- Three tabs: **Print history**, **Certificate register**, **To print**.
- Filters: **Search by name**, **Document type**, **Design**, **Printed by**, **Date**, **Result**, **Status**.
- The list: **View**, **Reprint**, **Revoke** on each row.

![Print & documents, Print history tab, with the filters, the list, and one row showing Revoked](img/printables-02-revoked.png)

</details>

<details>
<summary><strong>What each field means</strong></summary>

<!-- guide:generated:fields:printHistory -->

| Field               | What to enter                                                                                                                 | Required? |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| Reason for revoking | Why you are revoking the card, such as card lost; up to 280 characters. Only staff see it.                                    | Yes       |
| Status              | Valid means the card or certificate is still good. Revoked means someone cancelled it; a QR scan shows it is no longer valid. | No        |
| Result              | Filter by how the print went: Printed, Not printed or Waiting. Leave empty for all.                                           | No        |

<!-- /guide:generated -->

</details>

<details>
<summary><strong>How printing, reprinting and revoking work</strong></summary>

<figure>
  <img src="diagrams/reports-printables-overview.svg" alt="Every print is a new copy in the history with its own QR code; printing again makes another new copy and the earlier one stays valid; revoking a copy makes only its QR code show as not valid when scanned" width="720">
  <figcaption><em>The copies and status of one card</em></figcaption>
</figure>

- **Copy number:** if you print the same document for the same person again, it gets a number one higher than the largest earlier copy number.
- **Reprint means a new copy:** the earlier copy is not revoked by itself.
- **Revoke:** only that copy stops working. Staff can see the reason; people who scan the QR code cannot.
- **Certificate register:** it shows the current year at first; clear **Year** to see all years.

</details>

**Related pages**

- [**Adding students and viewing their details**](../people/students.md) — a student's certificate is issued from there.

- [**Printing ID cards, certificates and exam papers**](../administration/print-templates.md) — the print designs
- [**Issuing certificates**](../administration/print-templates/certificates.md) — designing and issuing certificates
- [**Final results**](../exams-results/final-results.md) — print the final report cards and the tabulation sheet.
- [**Printing ID cards**](../administration/print-templates/id-cards.md) — designing and printing ID cards

---

_Version 0.1.0 · last verified 2026-10-25_
