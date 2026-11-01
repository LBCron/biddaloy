<!-- guide:meta
feature: help.troubleshooting
title: What to do when something goes wrong
summary: The usual problems with signing in, installing on a phone, offline attendance, fee mistakes, printing and SMS: what the screen says, why, and how to fix it.
roles: [TEACHER, ADMIN, EXECUTIVE, ACCOUNTANT, OFFICE_STAFF, EXAM_CONTROLLER, COMMITTEE, PARENT, STUDENT]
sources:
  - ui/src/i18n/locales/en/auth.json
  - ui/src/i18n/locales/en/common.json
  - ui/src/i18n/locales/en/attendance.json
  - ui/src/i18n/locales/en/printPreview.json
  - ui/src/i18n/locales/en/communications.json
  - server/src/common/filters/known-errors.ts
labels:
  [
    auth:errors.*,
    common:offline.*,
    common:sync.*,
    attendance:mark.submitOffline,
    attendance:mark.queuedToast,
    printPreview:popupBlocked,
    communications:send.smsNotReady.*,
  ]
helpIds: [help.troubleshooting]
devices: [desktop, phone]
entry: [sidebar]
keywords:
  [সমস্যা, সমাধান, কাজ করছে না, ঢুকতে পারছি না, পাসওয়ার্ড ভুল, অফলাইন, প্রিন্ট হচ্ছে না, এসএমএস যায়নি, ভুল পেমেন্ট, troubleshooting, error, problem, not working, SMS failed]
appVersion: 0.1.0 (21aad534a)
owner: tareq89
lastVerified: 2026-10-25
knownIssues: []
-->

# What to do when something goes wrong

The usual problems with signing in, installing on a phone, offline attendance, fee mistakes, printing and SMS are all here in one place. For each one you get: what the screen says, why it happens, and how to fix it.

**How to look:** Read the red or yellow message on the screen. Find that text below (on a computer, press Ctrl and F to search inside the page). If you cannot find it, open the **Problems and fixes** section of the page you were working on.

<figure>
  <img src="diagrams/help-troubleshooting.svg" alt="Three steps when something goes wrong: read the message on the screen, find that message on this page to see the cause and the fix, and if it is still not fixed, tell your school admin and include the message" width="720" />
</figure>

**On this page**

- [Signing in](#signin)
- [Phone and app install](#phone)
- [Attendance without internet](#offline)
- [Fee mistakes](#fees)
- [Printing](#print)
- [SMS did not arrive](#sms)
- [You cannot see a page or button](#cant-see)
- [If it is still not fixed](#help)

---

## Signing in <a href="#signin" id="signin"></a>

### "That email/phone or password is incorrect."

- **Why:** The number, the email or the password did not match. <!-- source: ui/src/i18n/locales/en/auth.json errors.invalidCredentials -->
- **What to do:**
  1. Check the number or email and type it again.
  2. Type the password again, slowly.
  3. If you cannot remember it, see [Forgot your password](../start/sign-in.md#task-forgot).

### "Enter a valid email or an 11-digit phone number."

- **Why:** The phone number is not a full 11 digits, or the email is not written correctly. <!-- source: ui/src/i18n/locales/en/auth.json identifier.invalid -->
- **What to do:** Start the number with 0 and type all 11 digits, for example `01712345678`. <!-- source: docs/user-guide/en/start/sign-in.md#trouble -->

### "Too many attempts. Try again in … seconds."

- **Why:** Too many wrong tries in a short time. For safety the app pauses for a while. <!-- source: ui/src/i18n/locales/en/auth.json errors.rateLimited_* -->
- **What to do:** Wait for the time shown in the message, then try again.

### "This account isn't linked to a school yet. …"

- **Why:** Your account exists, but no school has added you. <!-- source: ui/src/i18n/locales/en/auth.json errors.noMemberships -->
- **What to do:** Ask the school admin to add you. For staff the admin uses [Add a staff member](../people/staff.md#task-main). For guardians, the admin uses the [guardian invitation](../people/guardians.md) page.

### "This account has been suspended."

- **Why:** You opened an invitation link, but the school has switched your account off. <!-- source: client-admin/src/routes/activate.tsx (status suspended); ui/src/i18n/locales/en/auth.json activate.suspended -->
- **What to do:** Contact the school office. Only the school can switch it back on.

### The code does not arrive

- **Why:** The number is wrong, the phone has no network, or the email code went to spam. <!-- source: docs/user-guide/en/start/sign-in.md#trouble -->
- **What to do:**
  1. Check that the number is right.
  2. If it is an email, look in the spam folder.
  3. If it still does not come after a few tries, try again in an hour.

On the demo site or the staging site no code goes to a phone or an email. Find it in the **test inbox** instead: tap **Open test inbox** in the bar at the top of the page, or in the line under the code box. Steps: [Where do codes and messages go on the demo?](../start/sign-in.md#task-test-inbox) <!-- source: ui/src/i18n/locales/en/auth.json help.testInbox -->

### "This link has expired."

- **Why:** The invitation link is too old. A password reset link that is too old or already used says **This link has expired or has already been used.** instead. <!-- source: client-admin/src/routes/activate.tsx; client-admin/src/routes/reset-password.tsx; ui/src/i18n/locales/en/auth.json activate.expired, forgot.linkExpired -->
- **What to do:** For an invitation link, see [If you got an invitation link](../start/sign-in.md#task-invite). For a reset link, see [Forgot your password](../start/sign-in.md#task-forgot).

### "Something went wrong. Please try again."

- **Why:** Usually an internet problem. <!-- source: ui/src/i18n/locales/en/auth.json errors.generic -->
- **What to do:** Check your internet and try again. If it keeps happening, tell your admin.

All the sign-in messages: [Signing in → Problems and fixes](../start/sign-in.md#trouble).

---

## Phone and app install <a href="#phone" id="phone"></a>

### The menu has no "Install app"

- **Why:** The app may already be installed, or the browser has not offered it yet. <!-- source: docs/user-guide/en/start/phone.md#trouble -->
- **What to do:** [Install it from the Chrome menu](../start/phone.md#task-chrome-menu).

### No "Install app" on an iPhone

- **Why:** You are in Chrome or another browser. On an iPhone the app installs from Safari. <!-- source: docs/user-guide/en/start/phone.md#trouble -->
- **What to do:** Open the address in Safari, then follow the steps in [On an iPhone](../start/phone.md#task-iphone).

### Opening from the icon asks you to sign in again

- **Why:** An installed app can open separately from the browser. <!-- source: docs/user-guide/en/start/phone.md#trouble -->
- **What to do:** [Sign in](../start/sign-in.md) once more.

### The address does not open

- **What to do:** Compare the address with the text the admin sent you, and check your internet. <!-- source: docs/user-guide/en/start/phone.md#trouble -->

---

## Attendance without internet <a href="#offline" id="offline"></a>

### The submit button says "Save on device"

- **Why:** There is no internet. This is not a mistake. The attendance is kept first on your phone or computer. <!-- source: docs/user-guide/en/attendance/attendance.md#task-offline; ui/src/i18n/locales/en/attendance.json mark.submitOffline -->
- **What to do:**
  1. Press the button. The message **Saved on device — will sync when you're back online** appears. <!-- source: ui/src/i18n/locales/en/attendance.json mark.queuedToast -->
  2. When the internet is back, open the app on this same device or keep it open. If the app is closed, nothing is sent.
  3. When it is sent, the message **1 offline change saved.** appears.

### "You're offline — 1 change waiting to send"

- **Why:** The work is still only on this device. It has not reached the school's system. <!-- source: ui/src/i18n/locales/en/common.json sync.offlineWithCount_* -->
- **What to do:** Turn the internet on and keep the app open. What the three states mean: [Glossary → The three states](glossary.md#states).

### Still "waiting to send" after the internet is back

- **Why:** There are two possible reasons. Someone else has marked attendance in the same register in the meantime, or it could not be sent even after several tries. <!-- source: docs/user-guide/en/attendance/attendance.md#task-offline -->
- **What to do:**
  1. Open the **Your changes** panel at the top.
  2. If it says **This was changed somewhere else while it waited**, choose which version to keep.
  3. If it says **This couldn't be sent after several tries**, open the register again and press **Submit attendance**.
  4. If it still does not work, tell your admin.

The full rules: [Taking attendance → Attendance without internet](../attendance/attendance.md#task-offline).

---

## Fee mistakes <a href="#fees" id="fees"></a>

Nothing is deleted from the money records. To fix a mistake, a new opposite entry is added, so that it can be seen later what happened. <!-- source: docs/user-guide/en/finance/payments.md#confirm -->

### A payment was recorded for the wrong student, the wrong amount or the wrong method

- **Why:** A mistake was made when the payment was taken. A payment itself cannot be edited. <!-- source: docs/user-guide/en/finance/payments.md#task-reverse -->
- **What to do:**
  1. The admin reverses the whole payment: [Reverse a payment](../finance/payments.md#task-reverse). A part of a payment cannot be reversed.
  2. After the reversal the bills become due again, and a **credit note** is made against the invoice. <!-- source: docs/user-guide/en/finance/payments.md#task-reverse -->
  3. Then [record the payment](../finance/record-payment.md) again, correctly.

### "Later payments must be reversed first:"

- **Why:** Some of this payment's money was kept as credit, and a later payment has spent that credit. <!-- source: docs/user-guide/en/finance/payments.md#task-later -->
- **What to do:** Open the links and reverse the later payments first, then this one. Steps: [When it asks you to reverse later payments first](../finance/payments.md#task-later).

### "Another admin must approve this reversal. Ask them to enter their code."

- **Why:** The school has another admin, so you cannot approve your own reversal. <!-- source: docs/user-guide/en/finance/payments.md#trouble -->
- **What to do:** Call the other admin. Press **Reverse payment** again, and they enter their code in the approval window.

### Invoices and credit notes get mixed up

- **Why:** A reversed payment's invoice has a credit note against it. Both show in the same list. <!-- source: docs/user-guide/en/finance/invoices.md#confirm -->
- **What to do:** See [Invoice or credit note: how to tell](../finance/invoices.md#confirm).

### Two bills for the same fee for one student in one month

- **Why:** When the bills were created, someone chose **Create anyway**. <!-- source: docs/user-guide/en/finance/generate-fees.md#trouble -->
- **What to do:** If no money has been paid on the second round, press **Remove uncollected**: [Change a round's period, remove uncollected bills or delete a round](../finance/generate-fees.md#task-batch).

### A wrong fine was charged

- **What to do:** Waive the fine in full or in part: [Waive a fine](../finance/fines.md#task-waive). <!-- source: docs/user-guide/en/finance/fines.md -->

### A wrong mark in published results

This is not a fee, but the same question comes up. Published results cannot be edited directly.

- **What to do:** The admin [reopens the results](../exams-results/results.md#task-reopen), the mark is fixed, and then they are [processed again](../exams-results/results.md#task-reprocess). <!-- source: docs/user-guide/en/exams-results/results.md -->

---

## Printing <a href="#print" id="print"></a>

The app does not print by itself. It opens the browser's own print window, and your printer prints from there. <!-- source: docs/user-guide/en/dashboard/customise.md#task-committee-report; docs/user-guide/en/administration/print-templates.md#preview-print -->

### "Your browser blocked the print window. …"

- **Why:** The browser has pop-ups turned off, so it could not open the print window. <!-- source: ui/src/i18n/locales/en/printPreview.json popupBlocked -->
- **What to do:**
  1. In the browser, allow pop-ups for this site.
  2. Press **Print** again.

For a receipt or an invoice you may instead see **The receipt could not be opened for printing.** or **Couldn't open the printable invoice. Try again.** Allow pop-ups, check your internet, then press again. <!-- source: docs/user-guide/en/finance/payments.md#trouble; docs/user-guide/en/finance/invoices.md#trouble -->

### "Add your first printer to be able to print."

- **Why:** No printer has been added for the school yet. <!-- source: docs/user-guide/en/administration/print-templates.md#trouble -->
- **What to do:** The admin adds a printer from the [Printers and calibration](../administration/print-templates/printers-and-calibration.md) page.

### "No design for this document yet"

- **Why:** No print design has been published for this paper (for example the ID card). <!-- source: docs/user-guide/en/administration/print-templates.md#trouble -->
- **What to do:** The admin [makes the first design from a ready-made one](../administration/print-templates.md#task-main).

### The print is shifted or cut off on the paper

- **What to do:**
  1. In the browser's print window, set **Scale 100%** and **Margins None**. <!-- source: docs/user-guide/en/administration/print-templates.md#trouble -->
  2. If it is still shifted, [calibrate](../administration/print-templates/printers-and-calibration.md) the printer.

### "Could not start printing. Nothing was printed."

- **What to do:** Try again after a little while. Nothing was printed, so there is no risk of printing twice. <!-- source: docs/user-guide/en/administration/print-templates.md#trouble -->

For a report card you may see **The print could not be recorded, so it was not printed. Try again.** Check your internet and press **Print** again. <!-- source: docs/user-guide/en/exams-results/results.md#trouble -->

---

## SMS did not arrive <a href="#sms" id="sms"></a>

You can see who got the message and who did not. For fee reminders, open the [Reminder history](../communications/reminder-history.md) page. Next to each message that did not arrive it says **Why it failed**. <!-- source: docs/user-guide/en/communications/reminder-history.md#trouble -->

For any one message, find it in the [Message log](../communications/message-log.md) by name or phone. When **Check status** shows there, press it to ask the company whether it arrived. <!-- source: docs/user-guide/en/communications/message-log.md#task-check -->

### "This school has no SMS credit left, …"

- **Why:** The school's SMS credit has run out. For result SMS, if the credit is not enough, no message goes at all. <!-- source: ui/src/i18n/locales/en/communications.json send.smsNotReady.NO_CREDIT; docs/user-guide/en/exams-results/results.md#trouble -->
- **What to do:** Ask the admin to add credit. For now, pick another channel such as WhatsApp or email. <!-- source: docs/user-guide/en/communications/send-message.md#trouble -->

### "SMS is not set up for this school, …"

- **Why:** This channel has not been turned on in the school's settings. <!-- source: docs/user-guide/en/communications/send-message.md#trouble -->
- **What to do:** The admin turns it on in **Settings › Communication** ([Changing the school's settings](../administration/settings.md)). Then send again.

### "no address for this channel"

- **Why:** The app does not have this guardian's phone number or email. <!-- source: docs/user-guide/en/communications/send-message.md#trouble -->
- **What to do:** Add the number on the [Guardians](../people/guardians.md) page, or pick another guardian or channel.

### Some reminder messages failed

- **What to do:** [Retry the failed deliveries](../communications/reminder-history.md#task-retry). If the round is still **Processing**, let it finish first. <!-- source: docs/user-guide/en/communications/reminder-history.md -->

### The result SMS did not go

- **Why:** Result SMS do not go before the results are published, or the credit is low. <!-- source: docs/user-guide/en/exams-results/results.md#trouble -->
- **What to do:** First [publish the results](../exams-results/results.md#task-publish), check the credit, then [send the SMS](../exams-results/results.md#task-sms).

---

## You cannot see a page or button <a href="#cant-see" id="cant-see"></a>

A page is missing from the menu, a list is empty, or the screen says **You don't have access to this page.**? This is usually not a mistake: your role does not have permission for that work, or another school or academic year is selected. <!-- source: ui/src/i18n/locales/en/common.json accessDenied.title --> Go through it step by step: [Why can't I see this?](cant-see-this.md)

---

## If it is still not fixed <a href="#help" id="help"></a>

1. Reload the page once. Check your internet.
2. Write down the message on the screen exactly, or take a screenshot.
3. Tell the school admin: which page you were on, what you pressed, and what it said.

If a word is not clear, see the [Glossary](glossary.md).

---

_Version 0.1.0 · Last verified 2026-10-25_
