# Epic 53 notice board: usability tasks and status

**Status: NOT DONE, needs a human run.** No real person has tried these tasks, on mockups or on
the built screens. Nothing below is a result.

Why: the usability test (#3367) needs real office staff and real guardians. It was skipped by
decision D1, so there are no mockup results either. Step 5 of #3382 ("re-run tasks ক, গ, ঙ on the
built screens with one staff member and one guardian") cannot be done by an agent. Its acceptance
line ("tasks ক, গ, ঙ pass unaided") stays **open** until a person runs it.

## The tasks (from the epic)

| #   | Who                   | Task                                                 | Target        | Where it starts                                    |
| --- | --------------------- | ---------------------------------------------------- | ------------- | -------------------------------------------------- |
| ক   | Office staff or admin | Post a PDF notice to the guardians of Class 9 and 10 | 3 min or less | Communications › নোটিশ › নতুন নোটিশ                |
| গ   | Office staff or admin | See who has not read a notice                        | 1 min or less | Communications › নোটিশ › open a notice › কে পড়েছে |
| ঙ   | Guardian              | Open the latest notice                               | 1 min or less | Portal Overview, or Portal › নোটিশ                 |

Tasks খ (important notice plus SMS request) and ঘ (turn off a public link) are not in #3382's
scope. Neither is built as a screen a user can reach yet (the public link has no client page, D19).

"Unaided" means the person gets there without anyone telling them where to click.

## How to run it

1. Use the demo school. Sign in as the `admin` card for ক and গ, and as a guardian card for ঙ.
2. Read the task aloud in the person's own words. Say nothing else. Do not point.
3. Time it. Write down where they stopped, hesitated or went the wrong way.
4. Fill in the table below. A task passes only if it is unaided and inside its target.

## Results

| #   | Participant | Time | Unaided? | Where they hesitated | Change made |
| --- | ----------- | ---- | -------- | -------------------- | ----------- |
| ক   | not run     |      |          |                      |             |
| গ   | not run     |      |          |                      |             |
| ঙ   | not run     |      |          |                      |             |

## What stands in for it until then

These Playwright specs walk the same paths on seeded data. They prove the paths work, not that a
person finds them.

| Task     | Automated stand-in                                                                    |
| -------- | ------------------------------------------------------------------------------------- |
| ক        | `e2e/journeys/notices.spec.ts` step 1 (compose, PDF, guardians of a section, publish) |
| গ        | `e2e/journeys/notices.spec.ts` step 4 (the "who has read it" report)                  |
| ঙ        | `e2e/journeys/notices.spec.ts` step 2 (guardian opens it from the Overview)           |
| keyboard | `e2e/keyboard/nav-communications.spec.ts` (notices)                                   |
| axe      | `e2e/a11y/notices.a11y.spec.ts` (list, compose, detail, portal list)                  |

## Screen-reader pass (#3390): NOT DONE, needs a human

An agent cannot run VoiceOver or NVDA. Nothing below is a result.

Screens to cover, in this order: compose (3 steps), notice detail (link panel, SMS part), SMS approval page, "who has read it" report, portal list and detail, public page `/n/<token>`.

What to check on each: the page has one `h1`; every button and checkbox says what it does when read alone (for example "Send an SMS to <name>"); the dead-link message is read when the page loads; a toast ("Link copied.") is announced; focus lands inside a dialog and returns on close.

| Screen                 | Reader + browser | Result | Notes |
| ---------------------- | ---------------- | ------ | ----- |
| compose                | not run          |        |       |
| detail                 | not run          |        |       |
| SMS approval           | not run          |        |       |
| report                 | not run          |        |       |
| portal list and detail | not run          |        |       |
| public page            | not run          |        |       |

Automated stand-ins: `e2e/a11y/notices.a11y.spec.ts` (axe) and `e2e/keyboard/nav-communications.spec.ts`. They do not replace listening to it.

## Tasks খ and ঘ (#3390): NOT DONE, needs real people

| #   | Who          | Task                                       | Target        |
| --- | ------------ | ------------------------------------------ | ------------- |
| খ   | Office staff | Mark a notice important and ask for an SMS | 3 min or less |
| ঘ   | Admin        | Turn off a public link                     | 1 min or less |

Both screens are now built (link panel and SMS page). Run them like tasks ক, গ, ঙ above (demo school, read the task aloud, say nothing, time it) together with a quick ক-ঙ sweep. The acceptance line "every usability task passes unaided" stays **open** until a person has done it.

Automated stand-in for খ and ঘ: `e2e/journeys/notice-links-sms.spec.ts`.
