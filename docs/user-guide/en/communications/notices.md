<!-- guide:meta
feature: communications.notices
title: Give and follow notices
summary: Write a school notice and send it to chosen people; see who has read it, run or turn off the public link, and ask for an SMS to be approved.
roles: [ADMIN, EXECUTIVE, TEACHER, OFFICE_STAFF]
sources:
  - client-admin/src/routes/_staff/communications/notices/index.tsx
  - client-admin/src/routes/_staff/communications/notices/new.tsx
  - client-admin/src/routes/_staff/communications/notices/$noticeId/index.tsx
  - client-admin/src/routes/_staff/communications/notices/$noticeId/edit.tsx
  - client-admin/src/routes/n.$token.tsx
  - client-admin/src/features/notices/compose/notice-compose.tsx
  - client-admin/src/features/notices/compose/audience-tabs.tsx
  - client-admin/src/features/notices/manage/notice-list.tsx
  - client-admin/src/features/notices/manage/notice-detail.tsx
  - client-admin/src/features/notices/manage/notice-report-tab.tsx
  - client-admin/src/features/notices/manage/notice-link-panel.tsx
  - client-admin/src/features/notices/manage/notice-sms-page.tsx
labels: [notices:manage.*, notices:public.*, noticeCompose:*, common:audienceBuilder.*, attention:notice.*, nav:items.notices, nav:groups.communications]
helpIds:
  [
    communications.notices,
    communications.notices.field.important,
    communications.notices.field.pinned,
    communications.notices.field.isPublic,
    communications.notices.field.sms,
    communications.notices.field.expires,
  ]
devices: [desktop]
entry: [sidebar, palette, notification:sms-pending]
keywords: [নোটিশ, বিজ্ঞপ্তি, কে পড়েছে, পাবলিক লিংক, SMS অনুমোদন, notice, notice board, public link, read report, SMS approval]
appVersion: 0.1.0 (19c3f195c)
owner: tareq89
lastVerified: 2026-11-02
knownIssues: []
-->

# Give and follow notices

Write a school notice, send it to chosen people, and later see who has read it.

**Where to go:** in the left menu, **Communications → Notices**. Do this on a computer.
**Before you start:** be an Admin, Academic coordinator, Teacher or Office staff ([who can do what](#roles)). The people you send to must already be in the app.

A notice is an announcement from the school: a title, some text, and up to three files if you like. A person with an account sees the notice in the app. A person without an account is counted too; an SMS is the way to reach them ([Sending an SMS](#task-sms)). Someone with no phone number cannot be reached, and you are told this before you publish.

[Give a notice](#task-main) · [Choosing who gets it](#task-who) · [See who has read it](#task-report) · [Public link](#task-public) · [SMS](#task-sms) · [Problems and fixes](#trouble)

**On this page**

- [How to get to this page](#arrive)
- [Give a notice](#task-main)
- [How to know the notice went](#confirm)
- [Other situations](#other)
  - [Choosing who gets it](#task-who)
  - [Urgent and normal notices](#task-important)
  - [See who has read it](#task-report)
  - [Public link](#task-public)
  - [What a person sees who gets the link](#task-public-page)
  - [Sending an SMS](#task-sms)
  - [Edit, withdraw, copy](#task-manage)
- [Problems and fixes](#trouble)
- [Who can do what](#roles)
- [Learn more](#more)

---

## How to get to this page <a href="#arrive" id="arrive"></a>

**From the menu:** in the left menu press **Communications**, then **Notices**.

**By search:** press the search button at the top and type "notice".

**From an SMS approval task (Admin and Academic coordinator):**

1. In the bar at the top you see **SMS approval pending: <notice title>**.
2. Press **Open notice**. → The notice page opens. Carry on from step 2 of [Sending an SMS](#task-sms).

---

## Give a notice <a href="#task-main" id="task-main"></a>

1. Open **Communications → Notices**, then press **Give a notice**.

   → **New notice** opens. At the top are three steps: **Write and attach**, **Who gets it**, **Check**.

2. Write the **Title** (up to 140 letters) and the **Notice text** (up to 5,000 letters).

3. If you like, add files with **Attach files**. Up to 3 files, each up to 5 MB. PDF, JPG, PNG or WebP are fine. A phone HEIC picture is not; make it a JPG first.

4. Tick the boxes you need:

   | Box                                        | What happens when ticked                                                         |
   | ------------------------------------------ | -------------------------------------------------------------------------------- |
   | **Urgent**                                 | The notice counts as urgent ([Urgent and normal notices](#task-important))       |
   | **Pin to the top**                         | The notice stays at the top of the board                                         |
   | **Public (anyone with the link can read)** | The notice gets a link ([Public link](#task-public))                             |
   | **Also ask to send an SMS**                | A request for an SMS goes to an admin for approval ([Sending an SMS](#task-sms)) |

   Pick **Valid until**. After that date the notice leaves the board. Leave it empty for **No end date**.

5. Press **Next step**. If you like, press **Keep as draft** first; **Draft saved** shows, and you can come back and finish later.

   → The **Who gets it** step opens.

6. Choose who gets it from the tabs at the top, then add people from the list ([Choosing who gets it](#task-who)). If nobody is chosen, **Choose at least one person** shows.

7. Press **Next step**.

   → **Check before publishing** opens with the counts: **Will get it in the app**, **SMS only**, **Cannot be reached**, and the total.

8. Press **Publish**. → The box **Publish this notice?** shows, with the same counts.

9. Press **Yes, publish**.

   → The notice is published and you go to the notice page. If you ticked **Public**, a **Public link** box shows first: copy the link now and press **Done**. The link is shown only this once.

> **Remember:** nobody gets the notice until you press **Publish** and **Yes, publish**. After publishing, who gets it cannot be changed.

---

## How to know the notice went <a href="#confirm" id="confirm"></a>

Open the **Notices** list. In the notice's row look at **Status**, and at **Seen**, for example **12 of 48**.

| Status        | What it means                                               |
| ------------- | ----------------------------------------------------------- |
| **Draft**     | You only saved it. Nobody has it.                           |
| **Published** | People are getting it.                                      |
| **Withdrawn** | You withdrew it. It has left everyone, and the link is off. |

If a box or message did not show, see [Problems and fixes](#trouble).

---

## Other situations <a href="#other" id="other"></a>

### Choosing who gets it <a href="#task-who" id="task-who"></a>

The **Who gets it** step has tabs at the top. Open one tab and use the filters to find people.

| Tab                         | Who it finds                                          |
| --------------------------- | ----------------------------------------------------- |
| **Guardians**               | Guardians of the students in a class or section       |
| **All teachers and staff**  | Staff by role                                         |
| **Students**                | Students of a class or section                        |
| **By name**                 | Staff or students, by typing a name                   |
| **Failed an exam**          | Students who failed one exam, or their guardians      |
| **Fee due**                 | Everyone with an unpaid fee that is past its due date |
| **Low attendance**          | Attendance below the percent you give                 |
| **Shift, version or group** | People in one shift, version or group                 |

You can take people from the list in two ways:

- Tick a few and press **Add to chosen list**.
- To take everyone, press **Add all matching**; the number shows in brackets.

At the bottom a bar such as **Chosen (30)** shows. Press it to open the **Chosen list**. To drop someone, press **Remove from chosen list** on their row; **Back to the list** takes you back to the search. One notice can have at most 5,000 people.

### Urgent and normal notices <a href="#task-important" id="task-important"></a>

| Type       | Where it shows                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Normal** | In the notices list and the home card. A notification also goes to the app.                                                                                                 |
| **Urgent** | Everywhere a normal one does, and a warning bar on the dashboard of each person with an account, until they press **Mark as read** (or **I have read this** on the notice). |

In both cases the app notification always goes. An SMS is a separate choice, in [Sending an SMS](#task-sms).

### See who has read it <a href="#task-report" id="task-report"></a>

1. In the **Notices** list press the notice's name. → The notice opens.
2. Press the **Who has read it** tab.

   → At the top the numbers **Total**, **Seen in the app**, **Opened the link**, **I've read it**, **Could not be reached**. Below, a table: **Name**, **For**, **Seen**, **Link opened**, **I've read it**.

3. To find people, pick from **Show**: **Everyone**, **Seen**, **Not seen yet**, **I've read it** or **Could not be reached**.

People with no account in the app are here too. When they open the SMS link, their row shows **Yes** under **Link opened**. **I've read it** appears only for an urgent notice, when someone presses **I have read this**.

### Public link <a href="#task-public" id="task-public"></a>

When you tick **Public**, the notice gets a link. Anyone who has the link can read the notice without logging in. If you do not tick it, only the people it was sent to read it. A personal link sent by SMS also opens without logging in, so if someone forwards that SMS, whoever gets it can read the notice too.

Look at the **Public link** part of the notice page.

| You press             | What happens                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copy link**         | The link is copied and **Link copied.** shows. The link is shown only once, when it is made; to copy it again you need **New link**.                                        |
| **New link**          | The box **Make a new link?** shows. If you confirm, the old link stops working, and people who have it cannot open the notice. The new link is shown once.                  |
| **Turn off the link** | The box **Turn off the public link?** shows. If you confirm, the link stops working. People it was sent to can still read it in the app. **The public link is off.** shows. |

After you turn the link off, to get a link again, **Edit** the notice and tick **Public** ([Edit, withdraw, copy](#task-manage)).

A link always lasts as long as the notice. At any time you can make a new link, turn the link off, or withdraw the notice.

**When the school's data is restored from a backup:** the earlier links of the notices in that backup stop working, and so do the personal links sent by SMS for them. A backup made before the notice board existed has no notices, so restoring it leaves notices and their links as they are. If someone says a public link does not open, check the notice and make a new public link. Personal links already sent by SMS cannot be made again; people with an account can still read the notice in the app ([Restore from a backup](../administration/settings.md#task-restore)).

### What a person sees who gets the link <a href="#task-public-page" id="task-public-page"></a>

The link starts with `/n/`. Anyone can open it; no login is needed.

- The page shows the school's name, the **Published** and **Edited** dates, the title, the text, and a **Files** part.
- The files come as links: press **Open <file name>** and the file opens. Pictures are not placed on the page.
- If the link is off, the notice is withdrawn, or the link is wrong, the same message shows every time: **This notice is not available**. The real reason is not shown.

Each person who gets an SMS gets their own link. Opening it counts only that person's reading.

### Sending an SMS <a href="#task-sms" id="task-sms"></a>

An SMS never goes by itself. An admin must approve it first, and SMS costs credits.

**Asking:**

1. When you write the notice, tick **Also ask to send an SMS**. Or after publishing, in the **SMS** part of the notice page press **Ask for an SMS**.

   → **SMS requested. An admin will look at it.** shows. In the **SMS** part the status becomes **Waiting**.

**Approving or declining (whoever has the approval permission):**

2. On the notice page, in the **SMS** part, press **Look at the SMS**.

   → The page **SMS for this notice** opens. It has the **SMS text**, the letters and parts count, **SMS credits it will use**, and a table of people who may get it: **Name**, **For**, **Phone**, **Send**.

3. To leave someone out, untick **Send** on their row. A person with no phone shows **No phone number**; a person who said no shows **Asked not to get SMS**.

4. Press **Approve and send**, or press **Decline** to send nothing.

| You press            | What happens                                                                                                                      | Credits used |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Approve and send** | **SMS on their way: 30.** shows. Each person gets an SMS with their own link. The status becomes **Sent**.                        | Yes          |
| **Decline**          | The box **Decline this SMS?** shows; if you confirm, **SMS declined. Nothing was sent.** shows. The status becomes **Cancelled**. | No           |

5. After a decision the request can only be read: **This request is already decided. You can only read it.**

Whoever asks, an admin's own request goes through this same step. Without the approval permission the SMS page does not open; it says **Only an admin can look at the SMS request.** If the notice is withdrawn or ends while a request waits, the request closes: **The notice is no longer live, so the SMS cannot be sent.**

### Edit, withdraw, copy <a href="#task-manage" id="task-manage"></a>

These buttons are in the notices list and on the notice page.

| Button       | What it does                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edit**     | Change the text, files, urgent and end date. Who gets it cannot be changed.                                                                                 |
| **Withdraw** | The box **Withdraw this notice?** shows. If you confirm, it leaves everyone and the link is off. **Notice withdrawn.** shows. It cannot be turned on again. |
| **Copy**     | **A new draft was made from this notice.** shows. Open the draft, choose the new people and publish.                                                        |

In the **Notices** list you can search by title and filter by **Status**. A teacher or office staff member sees only the notices they wrote.

---

## Problems and fixes <a href="#trouble" id="trouble"></a>

| What you see                                                                                               | What to do                                                                                                    | Who can help |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ |
| **Write a title** / **Write the notice text**                                                              | Fill in the box.                                                                                              | —            |
| **Choose at least one person**                                                                             | Add someone in the **Who gets it** step.                                                                      | —            |
| **At most 3 files**                                                                                        | Remove one file.                                                                                              | —            |
| **This file type is not allowed**                                                                          | Use PDF, JPG, PNG or WebP.                                                                                    | —            |
| **Make it JPG**                                                                                            | Save the file as JPG and add it again.                                                                        | —            |
| **Could not publish. Try again.**                                                                          | Press **Retry**.                                                                                              | Admin        |
| **The notice is published, but the public link could not be made.**                                        | Press **Retry**. The notice has gone; only the link is missing.                                               | Admin        |
| Many people under **Cannot be reached**                                                                    | They have no phone number or account. Add a phone number to the guardian's details.                           | Admin        |
| Someone says the link does not open                                                                        | The link is off, the notice is withdrawn, or the school's data was restored. See [Public link](#task-public). | Admin        |
| **Only an admin can look at the SMS request.**                                                             | Ask an Admin or Academic coordinator who can approve.                                                         | Admin        |
| **Not enough SMS credit. Nothing was sent, and the request is still waiting. Top up, then approve again.** | Buy SMS credit, then open the SMS page and press **Approve and send** again.                                  | Admin        |
| **Your earlier click is still being worked on. Wait a moment, then open the page again.**                  | Do not press again. Wait, then open the notice again to see what happened.                                    | —            |

---

## Who can do what <a href="#roles" id="roles"></a>

| Role                 | Write a notice | See and edit all notices | Approve SMS |
| -------------------- | -------------- | ------------------------ | ----------- |
| Admin                | Yes            | Yes                      | Yes         |
| Academic coordinator | Yes            | Yes                      | Yes         |
| Teacher              | Yes            | Only their own           | No          |
| Office staff         | Yes            | Only their own           | No          |

Other roles read notices but cannot give them. For parents and students: [Notices (parent and student)](../portal/notices.md).

---

## Learn more <a href="#more" id="more"></a>

<details>
<summary><strong>What the boxes mean</strong></summary>

<!-- guide:generated:fields:noticeCompose:important,pinned,isPublic,sms,expires -->

| Field                                  | What to enter                                                                | Required? |
| -------------------------------------- | ---------------------------------------------------------------------------- | --------- |
| Urgent                                 | Marks the notice as urgent so it stands out in the list.                     | No        |
| Pin to the top                         | Keeps the notice at the top of the board.                                    | No        |
| Public (anyone with the link can read) | Anyone who has the link can read it, without logging in.                     | No        |
| Also ask to send an SMS                | Ask for an SMS copy. An admin must approve it first, and SMS costs credits.  | No        |
| Valid until                            | After this date the notice leaves the board. Leave it empty for no end date. | No        |

<!-- /guide:generated -->

</details>

<details>
<summary><strong>How a notice works</strong></summary>

<figure>
  <img src="diagrams/communications-notices-overview.svg" alt="Write a notice and pick people, publish, it reaches the app, an urgent one adds a warning bar, then the public link, SMS approval and withdraw" width="720">
  <figcaption><em>How a notice travels</em></figcaption>
</figure>

- **App:** anyone with an account gets the notice in the app.
- **SMS:** only after an admin approves, and it uses credits.
- **Link:** you can turn it off at any time.

</details>

**Related pages**

- [**Notices (parent and student)**](../portal/notices.md) — where parents and students read notices.

---

_Version 0.1.0 · Last verified 2026-11-02_
