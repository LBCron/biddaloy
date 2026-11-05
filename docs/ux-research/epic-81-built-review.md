# Epic 81 marks import: built screens review (NOT a usability test)

**No participants took part.** Ticket #3467 (the human usability test of the
marks import) was skipped by decision D1: no real users were available. Nothing
here is participant data, and no participant results are invented. The
"re-run on the built app with the #3467 participants" step of #3478 is therefore
**pending**; it should be done when #3467 is picked up again.

What this file records instead: each task T1-T5 is covered by a Playwright spec
that drives the built app (bn locale, e2e school, real API). A green spec proves
the flow works. It does not prove a person finds it easy.

| Task | What the user does | Covered by | Human re-run |
| --- | --- | --- | --- |
| T1 | Teacher downloads the sheet, fills 5 marks and one `A`, uploads, reads the counts, saves, sees the marks in the grid | `e2e/journeys/marks-import.spec.ts` "T1" | pending (#3467 skipped) |
| T2 | A mark above full marks shows as an error row with a fixed sentence; Save still saves the rest (D7) | `e2e/journeys/marks-import.spec.ts` "T2" | pending (#3467 skipped) |
| T3 | Uploads a corrected sheet, sees the "changed" count and `old -> new` | `e2e/journeys/marks-import.spec.ts` "T3" | pending (#3467 skipped) |
| T4 | Admin opens Upload from the marks list page | `e2e/journeys/marks-import.spec.ts` "T4" | pending (#3467 skipped) |
| T5 | Exam controller opens Upload from the list page and saves (D5b) | `e2e/journeys/marks-import.spec.ts` "T5" | pending (#3467 skipped) |
| - | Submitted list: Upload hidden on the grid; direct URL shows the translated 409 sentence and "Back to grid" | `e2e/journeys/marks-import.spec.ts` "a submitted list ..." | n/a |
| - | Keyboard only: palette, import page, file input, Save, Esc back | `e2e/keyboard/marks-import.spec.ts` | n/a |

Also checked in T1: the audit log has a `Mark` row with `source: SHEET` and a
named uploader (`performed_by_name`).

## Problems found while running the built screens

| # | Screen | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | Import page after upload | **Bug.** When some rows had errors, `useValidateMarksSheet` reported `hard_error_count = errors.length`, so `BulkUploadPreview` kept Save disabled even though the server had staged the good rows. This broke D7 ("Save still saves the rest"). | Fixed in this ticket (`ui/src/hooks/exams.ts`, unit test in `exams.test.tsx`). T2 covers it. |

No string or layout problems were seen. Screenshots were not taken for this
ticket, so there is no visual comparison; that is left to the human re-run.

## Not covered

- Real users, and any time-on-task or error-rate measure (see top).
- Dark theme, `en` locale and 320 px reflow.
- Opening the downloaded file in real Excel or LibreOffice: the specs edit the
  sheet with exceljs, which is not the same as a person typing in a cell.
- Teacher login for T1-T3: no API can create the subject-scoped teacher
  assignment a teacher needs to write marks (same gap as `marks-entry.spec.ts`).
  The import page behaves the same for ADMIN.
