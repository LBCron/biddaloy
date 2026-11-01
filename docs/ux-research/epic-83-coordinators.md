# Epic 83 usability test — coordinators (status: not run yet)

Ticket 83.0.1 (#3183) asks for clickable mockups and a test of tasks T1–T5 with one
office/admin and two senior teachers. **That test needs real people and has not been
run.** The screens were built straight from the epic's UX requirements and glossary
([epic-83-glossary.md](epic-83-glossary.md)); this file is the script to run on the
built screens, and the place to record the results.

## Tasks (participants' own words)

| #   | Who                 | Task                                              | Screen                                               |
| --- | ------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| T1  | Admin               | "Make Rahim sir coordinator of classes 6, 7, 8"   | People › Staff › Teaching assignments › Coordinators |
| T2  | Class coordinator   | "See which sections have no attendance today"     | Academics › My coordination                          |
| T3  | Subject coordinator | "See which maths teacher has not entered marks"   | Academics › My coordination                          |
| T4  | Coordinator         | "Tell those teachers to submit marks by Thursday" | My coordination › Notify teachers                    |
| T5  | Admin               | "Remove a coordinator"                            | Coordinators tab › Remove coordinator                |

Target: each task unaided, in 2 minutes or less. Logins: the demo school's
`admin` card for T1/T5 and the `class-teacher-8a` card (class coordinator of three
High classes) for T2/T4; the Mathematics coordinator from the demo seed for T3.

## Results

| #   | Participant | Time | Unaided? | Where they hesitated | Change made |
| --- | ----------- | ---- | -------- | -------------------- | ----------- |
|     |             |      |          |                      |             |

Automated stand-ins until then: `e2e/journeys/coordinators-tab.spec.ts` (T1, T5) and
`e2e/journeys/my-coordination.spec.ts` (T2–T4) walk the same paths on the seed.
