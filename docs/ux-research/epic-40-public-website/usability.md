# Epic 40 usability test — school website admin and public site

Ticket #3614 (40.0.03) of Epic #820. Decisions: D12, D16, D25, D31, D34.
Words come from [`glossary.md`](glossary.md). Screens: [`admin/README.md`](admin/README.md), public mockups in `site/`.

**Status: NOT RUN. The test needs real office staff and guardians, so it has not happened.
The results tables are blank on purpose (no invented results). Owed by #3657 (40.5.09), which re-runs tasks 1–5 on the built screens if the human run cannot happen before W2 starts.**

## Tasks

Target for every task: done **unaided**, **3 minutes or less**, and the tester is never asked what a glossary "never say" word means.

| Task | Say this (bn, as read to the tester) | Start screen | Success = |
|---|---|---|---|
| T1 | "স্কুলের ওয়েবসাইট চালু করে প্রকাশ করুন" | `wizard-1-address.html` | reaches `wizard-done.html` |
| T2 | "এই নোটিশটা ওয়েবসাইটে দেখান" | `notice-form-tick.html` | turns on the website switch |
| T3 | "বার্ষিক পরীক্ষার ফল ওয়েবসাইটে দিন" | `exam-publish-website.html` | confirms publish |
| T4 | "হোমপেজের 'আমাদের কথা' অংশ শিক্ষকদের নিচে নামান আর ইংরেজি লেখাটা বদলান" | `pages.html` | moves section below teachers (not just down), opens `section-editor.html`, edits English text |
| T5 | "স্কুলের নিজের ঠিকানা rumsc.edu-তে সাইট দেখাতে কী করতে হবে, নির্দেশ পড়ে বলুন" | `address.html` | names the two lines to add and where |

Guardian tasks (public mockup `site/basic/home.html`, on a phone): G1 "কোথায় ভর্তির তথ্য?" and G2 "আজকের নোটিশ কোথায়?", each 1 minute or less.

## Participants (human-run, owner to fill)

| # | Who | Must be true | Tasks | Name (first only) / date |
|---|---|---|---|---|
| P1 | Office staff (ADMIN of a pilot school) | uses the school app | T1–T5 | _blank_ |
| P2 | Office staff | same | T1–T5 | _blank_ |
| P3 | Office staff (optional) | same | T1–T5 | _blank_ |
| P4 | Guardian | has a child in school | G1, G2 | _blank_ |
| P5 | Guardian | same | G1, G2 | _blank_ |

No phone numbers, photos or real child names (public repo).

## Script (about 15 minutes per person)

1. Say: "We test the screen, not you. Nothing you do is wrong."
2. Ask to note timings. No recording.
3. Open the start screen. Read the task. Say nothing else. Start the timer when you stop talking.
4. Ask them to think aloud. Do not hint. After 20 seconds of silence ask only "What are you looking for?".
5. Stop at "done" or at 3:00 (mark fail). Mockups are static: the tester points and says what they would press, then show the next picture.
6. Ask: "In your own words, what does this button do?" and "What happens next?".
7. Record time, unaided y/n, hesitation, words used.

Fix rule: hesitation over 10 seconds, or a word not in the glossary for something on screen, is a finding even on a pass. A failed task means fix the mockup in `admin/` or `site/`, reshoot, and re-run that task with the next participant.

## Results (fill on the human run)

| Task | Person | Role / device | Time (m:ss) | Unaided? | Hesitated at | Words used / quote | Pass |
|---|---|---|---|---|---|---|---|
| T1 | P1 | | | | | | |
| T2 | P1 | | | | | | |
| T3 | P1 | | | | | | |
| T4 | P1 | | | | | | |
| T5 | P1 | | | | | | |
| G1 | P4 | | | | | | |
| G2 | P4 | | | | | | |

(Repeat rows for P2, P3, P5.)

## What changed

| Finding | Mockup fixed | Reshot |
|---|---|---|
| _none yet, no run_ | | |
