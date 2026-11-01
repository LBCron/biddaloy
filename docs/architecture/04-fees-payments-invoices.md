# Fees, Payments & Invoices

This is the core business flow the whole system exists for: charge students
for fees, collect payments, and prove what was charged and paid. It was
rebuilt end-to-end in Epic 16 — the section at the bottom explains what
changed and why, if you're looking for something this doc used to describe.

## The entities

```mermaid
erDiagram
    FeeStructure ||--o{ StudentFee : "generates"
    FeeStructure ||--o{ FineRule : "fine rate for"
    FineRule ||--o{ StudentFee : "fines (nullable — null = logged manually)"
    RecurringSchedule ||--o{ StudentFee : "generates (recurring)"
    RecurringSchedule ||--o{ RecurringScheduleExclusion : "opt-outs"
    DiscountRule ||--o{ StudentFee : "auto-applies discount"
    StudentFee ||--o{ PaymentAllocation : "paid down by"
    Payment ||--o{ PaymentAllocation : "splits into"
    Payment ||--o| Invoice : "issues"
    Payment ||--o| StudentWallet : "credits (overpayment)"
    StudentWallet ||--o{ Payment : "funds (as tender)"
    Invoice ||--o| Invoice : "credit note references original"

    FeeStructure {
        uuid id
        decimal amount
        enum fee_type
        uuid class_id "optional label"
        uuid section_id "optional label"
    }
    StudentFee {
        uuid id
        uuid student_id
        date period_start
        enum period_type "MONTH or WEEK"
        int occurrence "duplicate-generation counter"
        decimal total_amount
        decimal discount_amount
        decimal paid_amount
        enum status "PENDING, PARTIALLY_PAID, PAID, OVERDUE, WAIVED (fully waived fine)"
        uuid late_fee_for_student_fee_id "self-reference, nullable: set means this row IS a late fee"
        string note "FINE bills only: reason shown to the family"
        date incident_date "FINE bills only: null on a rule-generated fine"
        uuid fine_rule_id "FINE bills only: null means logged manually"
    }
    FineRule {
        uuid id
        uuid academic_year_id
        enum trigger "ATTENDANCE_ABSENT or ATTENDANCE_LATE"
        uuid fee_structure_id "the fine's rate + label"
        uuid class_id "nullable: null is the school default"
        int free_per_period
        decimal cap_per_period "nullable: no cap"
        jsonb conditions "e.g. min_minutes_late"
        bool is_active
    }
    RecurringSchedule {
        uuid id
        jsonb audience "class/section/enrollment filter"
        jsonb rule "MONTHLY or WEEKLY + day/weekday"
        bool is_active
    }
    Payment {
        uuid id
        decimal total_amount
        enum payment_method "CASH CHEQUE BANK_TRANSFER CARD BKASH NAGAD ROCKET"
        string idempotency_key "unique per tenant"
        uuid reversal_of_payment_id "nullable: set means this row IS a reversal"
        uuid reversed_by_payment_id "nullable: set on the payment that was reversed"
    }
    PaymentAllocation {
        uuid id
        uuid student_fee_id
        decimal allocated_amount
        enum allocation_type "DUE or CURRENT"
    }
    StudentWallet {
        uuid student_id
        decimal balance
    }
    Invoice {
        uuid id
        string invoice_number "INV-YYYY-XXXXX"
        enum kind "INVOICE or CREDIT_NOTE"
        enum status "DRAFT ISSUED PAID OVERDUE CANCELLED"
        uuid related_invoice_id "nullable: a credit note points at the invoice it cancels"
        jsonb snapshot "line items frozen at issue time"
    }
    DiscountRule {
        uuid id
        enum kind "FLAT or PERCENT"
        decimal standing_discount_amount
    }
```

A `StudentFee` row is one student owing one fee for one period — the
"bill." Two bills for the same student in the same month are two separate
rows (e.g. tuition + exam fee), never merged. `FeeStructure` is a price tag
consumed at generation time; editing it later doesn't change bills already
generated, only future ones.

**"Is this a late fee / a reversal?" is a relationship, not a flag.** There
is no `is_late_fee` or `is_reversal` column. The API fields of those names
are derived in the DTO mappers from whether the self-reference is set:

```ts
// server/src/modules/fees/dto/family.dto.ts
is_late_fee: fee.late_fee_for_student_fee_id !== null,
is_reversal: payment.reversal_of_payment_id !== null,
```

That way the row always says _which_ bill it is a late fee for, or _which_
payment it reverses — a boolean alone could never be reconciled.

## Generate: turning a price tag into bills

```mermaid
sequenceDiagram
    actor Staff
    participant UI as GenerateFeesModal
    participant API as FeeGenerationService
    participant DB

    Staff->>UI: pick period + fee structures + students
    UI->>API: POST /fees/generate {structure_ids, period_start, student_ids}
    API->>DB: for each (student, structure): does a StudentFee already exist for this period?
    alt no duplicate
        API->>DB: INSERT StudentFee (occurrence=1)
    else duplicate found
        Note over API: D6 — staff picked one of three modes up front
        alt skip (default, free)
            API-->>UI: counted as "skipped", nothing written
        else remove older (needs approval if the old bill was already paid)
            API->>DB: DELETE old StudentFee, INSERT new one
        else create anyway (needs approval)
            API->>DB: INSERT StudentFee (occurrence=2, label "Exam Fee (2)")
        end
    end
    API-->>Staff: {created: 4, skipped: 2}
```

Example response for a run that generated 2 real bills and skipped 2
pre-existing duplicates:

```json
{
  "generation_id": "8e2f...",
  "created": 2,
  "skipped": 2,
  "student_fees": [
    { "id": "a1b2...", "student_id": "c3d4...", "fee_name": "Tuition", "total_amount": "1500.00" }
  ]
}
```

`RecurringSchedule` runs the same generation logic on a timer (see
"Daily job" below) instead of a staff click — audience is a filter
(class/section/program/enrollment status), evaluated fresh every run day, so a
student who joins mid-year starts getting billed automatically and one who
leaves stops, without editing the schedule (D4). `RecurringScheduleExclusion`
opts one specific student out of an otherwise-matching schedule. [34.2.2] A
`program_id` audience bills students with an ACTIVE `ProgramEnrollment` in
that program AND an ACTIVE class enrollment in the schedule's academic year —
combinable with class/section (both filters intersect), e.g.
`{ "program_id": "…", "enrollment_status": "ACTIVE" }`. One-off generation
(`POST /fees/generate`, `/fees/generate/preview`) accepts the same
`program_id`, resolved through the identical join and intersected with any
explicit `student_ids`.

`DiscountRule` (FLAT or PERCENT, scoped to all fee types or a chosen list,
optionally dated) auto-applies at generation time and writes to
`StudentFee.standing_discount_amount`. A one-off discount typed in during
checkout writes to `one_off_discount_amount` instead; `discount_amount` is
always their sum. Both discount paths go through the same approval-gated
flow described below (D8).

## Checkout: turning bills into a payment

```mermaid
sequenceDiagram
    actor Staff
    participant UI as Record Payment modal
    participant API as CheckoutService
    participant Wallet as StudentWallet
    participant Invoice as InvoiceService
    participant Notify as Notifications

    Staff->>UI: search student(s), pick bills, enter tender
    UI->>API: GET /payments/cart?student_ids=... (preview: due/current/total)
    API-->>UI: {bills, suggested: {allocations}}
    opt discount typed in during checkout
        UI->>API: POST /auth/step-up (scope fees.discount)
        API-->>UI: X-Approval-Token
    end
    Staff->>UI: confirm
    UI->>API: POST /payments/checkout {idempotency_key, allocations[], method}
    API->>API: lock bill rows (SELECT ... FOR UPDATE), classify each allocation DUE/CURRENT
    API->>API: reject any period in the future (advances no longer allowed as a bill allocation)
    alt tender exceeds total owed
        API->>Wallet: credit the difference
    end
    API->>Invoice: create Invoice (snapshot of what was just paid)
    API-->>Notify: emit payments.recorded
    API-->>Staff: 201 {payment, invoice_id}
```

Multi-child checkout is one `Payment` + one `Invoice`, allocations grouped
per student; each child's dues update independently (D12). Overpayment goes
to `StudentWallet.balance` rather than a `PaymentAllocationType.ADVANCE`
row — the old advance-payment type was removed (D5, see below); wallet
balance can be spent as tender on a later checkout instead. `idempotency_key`
is unique per tenant, so a retried request (e.g. a double-click, or a client
retry after a timeout) returns the original payment rather than double
charging (D20).

## Reversal: undoing a payment

```mermaid
sequenceDiagram
    actor Admin
    participant API as CheckoutService
    participant DB

    Admin->>API: POST /payments/:id/reverse {reason}
    API->>API: POST /auth/step-up (scope payments.reverse) if no valid token yet
    API-->>Admin: 403 APPROVAL_REQUIRED {details: {code, scope}}
    Admin->>API: retry with X-Approval-Token
    API->>DB: was any wallet credit from this payment already spent?
    alt spent
        API-->>Admin: 409 — reverse the spender first (D10)
    else untouched
        API->>DB: restore StudentFee.paid_amount/status, claw back any wallet credit
        API->>DB: INSERT reversal Payment (reversal_of_payment_id = original, REFUNDED)
        API->>DB: UPDATE original Payment (reversed_by_payment_id = reversal, REFUNDED)
        API->>DB: INSERT Invoice (kind = CREDIT_NOTE, related_invoice_id = original)
        API->>DB: UPDATE original Invoice (status = CANCELLED)
        API-->>Admin: 200
    end
```

Note the shape: a reversal is a **second, positive `Payment` row** pointing
back at the first, not a negative amount and not a deleted row. The two
rows reference each other (`reversal_of_payment_id` one way,
`reversed_by_payment_id` the other), so the original stays on the books
with a visible audit trail. The credit note works the same way — a second
`Invoice` row, never an edit.

Reversal is only ever full, never partial, and only ADMIN can call it —
`PAYMENT_REVERSE` stays admin-gated by explicit decision, not just an
approval-scope check (confirmed again during wave 8: granting it to
ACCOUNTANT would need a deliberate widening, not a side effect of any
ticket). A payment whose wallet credit has already been spent by a later
checkout can't be reversed until that later payment is reversed first (D10)
— otherwise the wallet balance would go negative with no record of why.

The 403 body shape matters here: `ApprovalRequiredException` nests its
`code`/`scope` under a `details` key (`{"details": {"code": "APPROVAL_REQUIRED", "scope": "..."}}`).
Every real consumer (`ui/src/hooks/approval.tsx`, `ui/src/api/errors.ts`)
reads `error.details.code` — a mismatch here silently breaks every step-up
retry flow in the app while still passing unit tests that mock the body
directly. See [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)
for the full step-up sequence (request OTP → verify → token → retry).

## Invoices

Generated automatically when a payment is recorded, with a sequential
number (`INV-YYYY-XXXXX`). The `snapshot` field freezes the line items at
issue time, so an invoice stays historically accurate even if the
underlying fee structure is edited later. `kind` is `INVOICE` or
`CREDIT_NOTE`; `ISSUED` is a `status`, not a kind.

Invoices are immutable after issue (D21) — a reversal never edits the
original invoice, it creates a second `Invoice` row with
`kind = CREDIT_NOTE` and `related_invoice_id` pointing at it. "Immutable"
here means the _financial_ fields: once `status` leaves `DRAFT`, only
`status`, `updated_at` and `deleted_at` may change on that row
(`invoice.entity.ts`). That is what lets a reversal flip the original to
`CANCELLED` while its amounts and `snapshot` stay exactly as issued.

Two ways to view an invoice:

- **Print** (`GET /invoices/:id/print`) — server-rendered HTML sized for
  A4 or POS 80mm (`@page { size: 80mm auto }`), reachable by staff and by
  the paying family (PARENT/STUDENT roles).
- **Public share link** (`POST /invoices/:id/share`, admin/accountant
  only) — a 32-byte random token (hash stored, not the token itself),
  expires 30 days after it is made (D9), individually revocable, rate-limited, opens at `/i/<token>` with
  no login required (D15). The content shown there is receipt-only — no
  internal remarks, no staff user IDs. Regenerating (`POST
/invoices/:id/share/regenerate`) kills every older link for that invoice
  and mints a new one. Links that existed when expiry shipped got 30 days
  from the deploy (D22).

  A link stops working (same 404 as any dead link) when the school is not
  ACTIVE, and all of a student's links are revoked when any guardian is
  unlinked from that student (68.4.21, #2298).

  > As of wave 8, family callers (PARENT/STUDENT) cannot mint or list
  > their own share link — only print. A family-visible "get me a link to
  > share" affordance would need a new family-scoped share endpoint; not
  > built yet, tracked as follow-up.

## Daily job: schedules and late fees

```mermaid
sequenceDiagram
    participant Cron
    participant Scheduler as FeesDailyScheduler
    participant DB

    Cron->>Scheduler: fires once per day, Asia/Dhaka (D14)
    Scheduler->>DB: which RecurringSchedules are due today, and active?
    loop each due schedule
        Scheduler->>DB: resolve current audience (same filter logic as generate)
        Scheduler->>DB: idempotency check — already ran for this (schedule, period)?
        alt not yet run
            Scheduler->>DB: generate StudentFee per matched student (same duplicate rules as manual generate)
        end
    end
    Scheduler->>DB: any bill past its late-fee grace period with a fee type that has one configured?
    loop each qualifying bill
        Scheduler->>DB: INSERT StudentFee (late_fee_for_student_fee_id = the overdue bill)
    end
```

Late fees are off by default, configured per fee type (`grace_days`, FLAT
or PERCENT of the outstanding balance, applied once, never compounding —
D11). A late fee is its own `StudentFee` row linked back to the bill it's
late on via `late_fee_for_student_fee_id`, not a field mutated on the
original bill. Waiving a late fee works like waiving any bill; see
[Write-offs and wallet payouts](#write-offs-and-wallet-payouts).

### Write-offs and wallet payouts

Three ways a bill or the wallet is settled without a normal payment.
Each one is audited. Waiving needs a `fees.discount` approval token and a wallet payout needs `payments.reverse`. The wallet credit for a removed paid bill is automatic; the removal itself is what is gated (`fees.edit_paid`, or the duplicate-override approval).

```mermaid
flowchart TD
    A[Open bill, any fee type] -->|"POST /fees/bills/:id/waive<br/>fees.discount approval"| B[One-off discount on the bill<br/>WAIVED if nothing was paid]
    C[Bill that already holds money is removed] -->|automatic| D[Money goes to the student wallet<br/>CREDIT_BILL_REMOVED]
    D --> E[Wallet balance]
    E -->|"POST /students/:id/wallet/payout<br/>payments.reverse approval"| F[Cash refund<br/>DEBIT_PAYOUT, never below 0]
```

- **Waive any bill.** Late fee, tuition, fine: all can be written off, in
  full or in part. No fake 0.01 payment needed. Old route
  `POST /fees/fines/:id/waive` still works and does the same thing.
- **Removed paid bill.** If a bill that already holds checkout money is
  removed, that money is credited to the student wallet. It is not lost.
- **Wallet payout.** Staff pay wallet money back as cash. Example: pay out
  300 from 1,800, the balance becomes 1,500. More than the balance is
  refused with `409 WALLET_PAYOUT_EXCEEDS_BALANCE`. It works for a student
  who has left. Two payouts at the same time cannot overdraw the wallet:
  the second waits for the first.

Notification on a schedule-generated bill defaults **on**; a manually-run
batch defaults **off** — staff have to opt in explicitly for a one-time
run (D13). Channel order is push → WhatsApp → SMS, with SMS only sent if
the school has it enabled and has credit remaining. See
[05-communications.md](05-communications.md).

## Fines

A fine is just a bill: `FeeStructure.fee_type = 'FINE'` (e.g. "Absent",
"Late", "Damage", "Lost ID card") and the fine itself is an ordinary
`StudentFee` row. There's no separate "fine" table for the bill itself —
checkout, reversal, and invoicing have **no fine-specific branch** anywhere.
Two things get a fine onto a bill (Epic 38 #818):

```mermaid
flowchart LR
  R[fine_rules] --> SW[FineSweepService]
  AT[(attendance_records)] --> SW
  FS[FeeStructure fee_type=FINE] -. rate + label .-> SW
  FS -. default amount .-> M[Log fine]
  SW -->|1 bill / student / month| G[FeeGenerationService.generate]
  M -->|1 bill per student| G
  G --> SF[(StudentFee + note, incident_date, fine_rule_id)]
  SF --> D[Dues · Record Payment · Invoices — unchanged]
  SF --> W[Waive = one-off discount, FEE_APPROVE step-up]
  SF --> P[Portal: Due this month + Fees › Fines]
  SF --> N[Fine notice]
```

- **Rule-driven (automatic, monthly)** — a `FineRule` names a trigger
  (`ATTENDANCE_ABSENT` or `ATTENDANCE_LATE`), a `FeeStructure` (the rate),
  an optional class scope, `free_per_period` and an optional
  `cap_per_period`. `FineSweepService` reads `attendance_records`
  read-only (it never writes a mark), counts hits per student for the
  month, and bills `max(0, count - free_per_period) × rate`, capped. At or
  below the free threshold there is no bill at all (see the example below). It runs
  daily as part of `FeesDailyScheduler` (like the late-fee sweep below),
  self-healing the previous month once `correctionWindowDays` has passed —
  a late attendance correction never mutates a bill already generated.
  Example, `free_per_period: 2`, rate 50:

  | Absences in the month | Bill                             |
  | --------------------- | -------------------------------- |
  | 1 or 2                | none (within the free threshold) |
  | 3                     | (3 - 2) × 50 = 50                |
  | 5                     | (5 - 2) × 50 = 150               |

- **Staff-logged (manual)** — `POST /fees/fines` (`FinesService.logFine`)
  takes a reason and incident date, for anything a rule can't see (a
  broken window, a lost ID card, a discipline case). ADMIN/ACCOUNTANT
  only, `FEE_GENERATE` permission, no approval needed to _add_ a fine.

**`cap_per_period` is per rule, not per bill.** Each rule is capped on
its own. When two rules point at the same fee structure, their fines are
added into one bill, so that bill can be bigger than one cap
(`fine-sweep.service.ts`: the cap is applied per rule in `compute`; the
merge happens in `generate`, where rows for one student and structure are
added together).

```mermaid
flowchart LR
  A["Rule ABSENT, cap 100 -> 100"] --> C["same fee structure -> one bill of 200"]
  B["Rule LATE, cap 100 -> 100"] --> C
```

Both paths write through the same `FeeGenerationService.generate()` used
by every other bill, extended with `billOverrides` — a per-(student, fee
structure) map of `{ amount, note, fine_rule_id }` that lets one
`generate()` call bill different students different amounts, instead of
everyone paying the structure's fixed price.

### A worked example: a class rule fines "3+ absences a month, ৳20 each, capped at ৳200"

The rule (`FineRule`, `trigger: 'ATTENDANCE_ABSENT'`):

```json
{
  "id": "9f11...",
  "academic_year_id": "2b7a...",
  "trigger": "ATTENDANCE_ABSENT",
  "fee_structure_id": "c001...",
  "class_id": "cl-10...",
  "free_per_period": 2,
  "cap_per_period": "200.00",
  "conditions": {},
  "is_active": true
}
```

A student in that class was marked `ABSENT` 5 times in September. Staff
open **Finance › Fines**, pick "Generate", and preview September:

```json
// POST /fees/fines/generate/preview {"month": "2026-09", "class_id": "cl-10..."}
{
  "students": [
    {
      "student_id": "a1b2...",
      "rule_id": "9f11...",
      "fee_structure_id": "c001...",
      "count": 5,
      "amount": 60.0,
      "note": "5 absences (2 free)"
    }
  ],
  "total_amount": 60.0,
  "would_create": 1,
  "duplicates": []
}
```

`amount` is `(5 - 2 free) × ৳20 = ৳60` — under the ৳200 cap, so the cap
never kicks in here. Confirming the preview calls
`POST /fees/fines/generate`, which produces this `StudentFee` row:

```json
{
  "id": "e4d5...",
  "student_id": "a1b2...",
  "fee_structure_id": "c001...",
  "period_start": "2026-09-01",
  "total_amount": "60.00",
  "status": "PENDING",
  "note": "5 absences (2 free)",
  "incident_date": null,
  "fine_rule_id": "9f11..."
}
```

`incident_date` stays `null` on a rule-generated fine — there's no single
day, it's a monthly count. A manually-logged fine is the opposite:
`fine_rule_id` is `null` (that's what marks it "logged manually", not a
separate kind flag) and `incident_date` is the day it happened. From that
row on, the fine behaves exactly like any other bill: it shows up in
dues, Record Payment can collect it, and it prints on an invoice.

### Waiving a fine (D24)

Waiving reduces or clears a fine the same way a checkout discount does —
`POST /fees/bills/:id/waive` (legacy alias `POST /fees/fines/:id/waive`) behind
`FEE_APPROVE` step-up (`ApprovalScope.FEES_DISCOUNT`), reason required, any open
bill of any fee type:

| Situation                                 | Waive amount                 | Resulting `status`     |
| ----------------------------------------- | ---------------------------- | ---------------------- |
| Unpaid fine, waived in full               | the whole outstanding amount | `WAIVED`               |
| Partly paid fine, rest waived             | the remaining balance        | `PAID`                 |
| Partly paid fine, only part of the rest   | less than the balance        | stays `PARTIALLY_PAID` |
| Fully paid fine                           | — (nothing outstanding)      | rejected, `409`        |
| Bill not open (`PAID`/`WAIVED`/`ADVANCE`) | —                            | rejected, same `409`   |

There's no dedicated "waive" column — the endpoint writes the same
`one_off_discount_amount`/`discount_amount` fields checkout uses, and
`status` is derived from whatever's left outstanding after the discount.

### The manual-occurrence rule (D28)

Every other bill in this doc asks "does one already exist for this
(student, structure, period)?" and offers skip/remove-older/create-anyway
(D6, "Generate" above) when it does. A **manually-logged** fine skips that
question entirely: `FinesService.logFine()` calls `generate()` with
`alwaysNewOccurrence: true`, so a second damage report on the same
student in the same month always creates a new bill, no duplicate prompt,
no approval. A **rule-generated** fine still goes through the normal
duplicate check (SKIP by default) — the sweep is idempotent per month, so
re-running it never double-bills.

### Fines never get late fees

`LateFeeService` explicitly skips `fee_type = 'FINE'` bills
(`late-fee.service.ts`, D10) — a fine is already a penalty; charging a
late fee on top of it isn't a case anyone asked for.

### Learnings (Epic #2642, Wave 3, 2026-10-19)

- **Checkout lock order (#2647).** Two separate orders, both in `checkout.service.ts`:
  - **Rows: bills, then wallet.** Checkout locks every bill (`pessimistic_write`), then the wallet row. Wallet debit and reversal use the same order. A path that took the wallet first while another held a bill would deadlock.
  - **Wallet lock before the approval token.** The wallet balance is checked under its lock _before_ `approvalService.consume()` burns the one-time token, so a concurrent spend fails without wasting the approval.

  TO_WALLET siblings are refused, and reversal handles a stale bill. Cost: a race between two checkouts on one wallet. Rule candidate: in any money path, lock bills then wallet, and burn approval tokens last -> Rule 24-27 candidate.

## Student statement

A statement answers one question for one student: **what was charged, what was paid, and what is still owed after each line?** It is a coded report (Epic 8.15 D10), not a defined one, because it is a ledger. The code is `server/src/modules/fees/statement/student-statement.service.ts`; the numbers are the same ones the student's fees tab and the dues list show.

### Where the lines come from

The service reads four kinds of line and puts them in one list. Nothing is stored: every request reads the tables again.

```mermaid
flowchart LR
  SF1["student_fees<br/>total_amount"] -->|"BILL, debit"| L
  SF2["student_fees<br/>standing_discount_amount"] -->|"DISCOUNT, credit"| L
  PA1["payment_allocations<br/>allocated_amount"] -->|"PAYMENT credit<br/>(REVERSAL debit if the payment is a reversal)"| L
  PA2["payment_allocations<br/>discount_amount"] -->|"DISCOUNT credit<br/>(REVERSAL debit if reversal)"| L
  L["entries<br/>one row per line"] --> W["running balance<br/>SUM(debit - credit) over all history"]
  W --> OUT["opening balance, lines,<br/>closing balance"]
  WL["wallet_transactions"] -.->|"listed apart,<br/>never in the balance"| OUT
```

| Line kind  | Source row                                                             | Column | Date it carries                              |
| ---------- | ---------------------------------------------------------------------- | ------ | -------------------------------------------- |
| `BILL`     | a `student_fees` row (not deleted)                                     | debit  | its `due_date`, else its `period_start`      |
| `DISCOUNT` | the same row's standing discount (only when above 0)                   | credit | same date as its bill                        |
| `PAYMENT`  | one `payment_allocations` row of a normal payment (`allocated_amount`) | credit | `payment_date`, in Asia/Dhaka                |
| `DISCOUNT` | the same allocation's one-off `discount_amount` (only when above 0)    | credit | `payment_date`, in Asia/Dhaka                |
| `REVERSAL` | an allocation (or its discount) of a payment that undoes another       | debit  | the reversal's `payment_date`, in Asia/Dhaka |

Payments reach a bill only through allocations, so one payment spread over two bills shows as two `PAYMENT` lines, each named after its bill's fee. A reversal is its own payment whose allocations mirror the original, so its lines come out as `REVERSAL` debits that put the money back on what is owed. A payment counts only if it succeeded, or is one side of a reversal; a failed or pending payment is left out. Lines of another student, or of another school, can never enter: both the school and the student are in the query itself.

### Order and running balance

Lines sort by date, then by kind (bill, then its standing discount, then payments, then one-off discounts), then by the time the row was created, then by its id. So on the day a bill falls due, the bill comes first and its discount right after it. The balance after a line is the sum of `debit - credit` of **every line up to and including it**, counted from the student's first line ever. A debit makes the student owe more, a credit less.

### The opening balance rule

A statement can ask for a range: `from` and `to`, both optional, both `YYYY-MM-DD`.

- The balance is always counted over the whole history first, and the range only cuts the list afterwards. So an earlier `from` never changes a later balance.
- **Opening balance** = the balance after the last line dated before `from`. With no `from`, or nothing before it, it is 0.
- **Closing balance** = the balance after the last line shown. If the range holds no line, it is the opening balance.
- With no range at all, the closing balance equals what the dues list says the student still owes (the integration spec asserts this).

### Advance money is listed apart

A wallet holds money paid in advance. It is not owed and not paid against a bill yet, so it never enters the balance. The response carries `wallet_balance` and `wallet_moves` (date, kind, amount, note; positive adds to the wallet, negative takes from it) beside the lines, in the order they happened. The wallet moves are not cut by `from` and `to`.

### An example

Karim has two bills in March. Bill A is 1,000 with a 100 standing discount; he pays 400 on 5 March and that payment is reversed on 20 March. Bill B is 500, paid 450 with a 50 discount at the counter.

| Date       | Kind       | Debit | Credit | Still owed |
| ---------- | ---------- | ----- | ------ | ---------- |
| 2026-03-01 | `BILL`     | 1,000 | 0      | 1,000      |
| 2026-03-01 | `DISCOUNT` | 0     | 100    | 900        |
| 2026-03-05 | `PAYMENT`  | 0     | 400    | 500        |
| 2026-03-10 | `BILL`     | 500   | 0      | 1,000      |
| 2026-03-12 | `PAYMENT`  | 0     | 450    | 550        |
| 2026-03-12 | `DISCOUNT` | 0     | 50     | 500        |
| 2026-03-20 | `REVERSAL` | 400   | 0      | 900        |

Asking for `?from=2026-03-10` shows the last four lines. The opening balance is 500 (what was owed after the 5 March payment) and the balances on those lines are unchanged. The closing balance is 900 either way.

### The two routes

| Route                                       | Who                                          | Notes                                                                                                                   |
| ------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /students/:studentId/statement`        | staff with `INVOICE_READ` and `PAYMENT_READ` | `:studentId` goes through `ParseUUIDPipe`; an unknown student is a 404                                                  |
| `GET /portal/students/:studentId/statement` | a parent or student with `FEE_READ`          | only for a student linked to the caller (`FamilyAccessService`); any other student is the same 404, a staff role is 403 |

Both take `from` and `to`, and both return the same body. Each request writes a `report_runs` row (source `student-statement`, the student and the range as params, the line count; no money values), so a look at a statement is audited like any report run.

## Family-facing access

Parents/students see a deliberately narrower view of all of the above —
`server/src/modules/fees/dto/family.dto.ts` is the single module that owns
every family-facing DTO and mapper, with an explicit allow-list per
resource (bill, wallet, payment, invoice, schedule, discount rule). Fields
like `approved_by_user_id`, `reversal_reason`, internal notes, and a
full (non-last-4) payment reference are withheld everywhere a family caller
can read — this was tightened during wave 8 after an audit found four real
routes leaking staff-internal fields to PARENT/STUDENT (discount-rule
`reason` and approver IDs, wallet transaction notes, invoice notes, and an
unmasked payment reference).

## Notable design decisions (D1–D21, from Epic 16 #637)

| #   | Decision                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Student-only payee. Guardian/company/`payee_type` generalisation is a future epic.                                                                   |
| D2  | One bill per student × fee structure × period. Unique `(student_id, fee_structure_id, period_start, occurrence)`.                                    |
| D3  | Fee structure is just a price tag — dropped `month`, `is_recurring`, `applicability` (`FeeApplicability` enum), `fee_structure_students`.            |
| D4  | Recurring audience is a filter + exclusions, evaluated fresh on each run day.                                                                        |
| D5  | Advances became the student wallet. `PaymentAllocationType.ADVANCE`, `is_advance_payment`, `original_advance_month/year` removed.                    |
| D6  | Duplicate-generation offers skip / remove-older / create-anyway (see "Generate" above).                                                              |
| D7  | Structure amount edits are audit-logged, effective next generation; bills snapshot the amount at generation time. Soft-delete only.                  |
| D8  | Discount rules are FLAT or PERCENT, admin-verified once on create/edit; one-off checkout discounts are admin-verified every time.                    |
| D9  | Approval is the permission `FEE_APPROVE`, re-verified every time regardless of role. See [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md). |
| D10 | Reversal is full-only; a payment whose wallet credit was already spent can't be reversed until the spender is.                                       |
| D11 | Late fees: off by default, FLAT/PERCENT, `grace_days`, once per bill, no compounding.                                                                |
| D12 | Multi-child checkout is one payment + one invoice, grouped by student.                                                                               |
| D13 | Notify defaults: schedules on, manual batches off.                                                                                                   |
| D14 | Scheduling runs in `Asia/Dhaka` (`SCHOOL_TZ`).                                                                                                       |
| D15 | Public invoice links: 32-byte token, hash stored, revocable, rate-limited.                                                                           |
| D16 | Payment methods: `CASH, CHEQUE, BANK_TRANSFER, CARD, BKASH, NAGAD, ROCKET` — `UPI`/`ONLINE` removed.                                                 |
| D17 | Barcode/QR is keyboard-wedge only; camera scanning is out of scope.                                                                                  |
| D18 | Both old wizards (`generate-fees-wizard.tsx`, `record-payment-wizard.tsx`) deleted, replaced by single modal forms.                                  |
| D19 | No production data existed yet — migrations were free to drop/recreate; seed/`e2e/seed-contract`/`api-types` regenerated at each wave close.         |
| D20 | Checkout is idempotent (`idempotency_key` unique per tenant), locks bill rows during allocation.                                                     |
| D21 | Invoices immutable after issue; changes produce a credit note, never an edit.                                                                        |

### Fines (D22–D28, from Epic 38 #818)

| #   | Decision                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D22 | A class `FineRule` replaces the school default for that trigger; one active rule per (tenant, academic year, trigger, class_id), `NULLS NOT DISTINCT`.                                                     |
| D23 | A `LATE` mark with `minutes_late` still `NULL` counts as a hit; `min_minutes_late` only filters marks where the minutes are actually known.                                                                |
| D24 | Waive covers the outstanding amount only — full waive on an unpaid fine gives `WAIVED`, waiving the rest of a partly-paid one gives `PAID` (see the waive table above). A fully paid fine can't be waived. |
| D25 | Permissions: log/generate a fine needs `FEE_GENERATE`; rule CRUD needs `FEE_STRUCTURE_CREATE/UPDATE/DELETE`; waive needs `FEE_APPROVE` step-up. EXECUTIVE stays read-only.                                 |
| D26 | The daily sweep runs from `correctionWindowDays + 1` to month end, always billing the _previous_ month (self-healing after a late attendance correction).                                                  |
| D27 | `FineRule` is scoped to one `academic_year_id`; the sweep resolves the year that contains the attended month.                                                                                              |
| D28 | A manually-logged fine always creates a new bill (`alwaysNewOccurrence: true`) — no duplicate prompt, no approval, unlike every other `generate()` caller.                                                 |

## What was removed, and why

- **`FeeApplicability` (`ALL`/`SELECTED`)** — the old fee-structure model
  could target a whole class/section or an explicit student list. D3
  replaced this with the price-tag model: a `FeeStructure` no longer
  targets anyone directly, and `RecurringSchedule`'s audience filter (D4)
  is the only targeting mechanism left. Removed from `shared/src/enums`
  in wave 8, having had zero remaining consumers since wave 1.
- **`PaymentAllocationType.ADVANCE`** — pre-paying a future bill used to
  create a `StudentFee` row with an `ADVANCE`-type allocation. D5 replaced
  this with `StudentWallet`: an overpayment now credits a balance the
  student can spend later, rather than pre-allocating against a specific
  future bill. A future-dated allocation attempt now throws
  `BadRequestException` instead of succeeding.
- **Generate/record-payment wizards** — multi-step wizards were replaced
  with single modal forms (D18); the wizard route names and nav entries
  are gone.
- **`UPI`/`ONLINE` payment methods** — dropped per D16; not a supported
  gateway in this market segment at this time.

## See also

- Multi-tenancy and the tenant-scoping convention every table here
  follows: [01-domain-model.md](01-domain-model.md#conventions-worth-knowing-before-you-add-a-table).
- Approval/step-up flow in full: [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md).
- How a flagged-overdue bill turns into a reminder message:
  [05-communications.md](05-communications.md).
