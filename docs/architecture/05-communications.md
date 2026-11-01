# Communications (Reminders)

Guardians who haven't paid fees get reminded via SMS, WhatsApp, Messenger,
or email — one guardian at a time, or in bulk across every flagged student
from [04-fees-payments-invoices.md](04-fees-payments-invoices.md#5-flag-overdue-fees-and-remind-guardians).

## Provider adapter pattern

```mermaid
flowchart LR
    CTRL["communications.controller.ts\n(send / reminder/single / reminder/bulk)"]
    REG["CommunicationProviderRegistry\n(picks provider by medium + tenant settings)"]
    IFACE["CommunicationProvider\n(interface: .send())"]
    SMS["SMS\nGreenweb / Mim SMS gateway"]
    WA["WhatsApp\nWhatsApp Cloud API"]
    MSG["Messenger\nprovider"]
    EMAIL["Email\nSMTP"]
    LOG["CommunicationLog\n(one row per message,\nevery medium)"]
    BATCH["ReminderBatch\n(bulk campaign tracking)"]

    CTRL --> REG
    REG --> IFACE
    IFACE --> SMS
    IFACE --> WA
    IFACE --> MSG
    IFACE --> EMAIL
    SMS --> LOG
    WA --> LOG
    MSG --> LOG
    EMAIL --> LOG
    CTRL -.->|"bulk send"| BATCH
    BATCH --> LOG
```

Every channel implements the same `CommunicationProvider` interface
(`modules/communications/providers/communication-provider.interface.ts`), so
the controller/service layer never branches on medium — it asks the
registry for "whatever handles WHATSAPP for this tenant" and calls
`.send()`. Per-tenant provider configuration (which SMS gateway, which SMTP
account, credentials) lives in `School.settings` / the tenant-settings
module, so different schools can use different providers without any code
change.

## Where this deviated from the original plan

The original plan specified **Twilio** for both SMS and WhatsApp. What
shipped instead:

- **SMS** — **Greenweb** and **Mim SMS**, two Bangladeshi SMS gateways
  (`providers/sms/greenweb-sms.gateway.ts`, `.../mim-sms.gateway.ts`),
  selected per-tenant via `sms-provider.factory.ts`. Twilio's per-message
  pricing and lack of local carrier relationships make it a poor fit for a
  Bangladesh-market product; local gateways are both cheaper and more
  reliable for BD phone numbers.
- **WhatsApp** — the **WhatsApp Cloud API** directly (Meta's own API), not
  Twilio's WhatsApp product.
- **Messenger** was added as a full channel, beyond the original three.

## Single vs. bulk sends

- **Single**: `POST communications/reminder/single/:studentId` (with a
  `.../preview` variant to show staff the rendered message before sending).
- **Bulk**: `POST communications/reminder/bulk` creates a `ReminderBatch`
  row up front (tracking the filter used and progress), then fans out to
  one `CommunicationLog` row per recipient as each send completes —
  `GET communications/reminder/bulk/:id` polls that batch's status.

## Free-form send: guardians only

`POST communications/send` does not take a phone number or email. The
caller sends a `guardian_id`; the server loads that guardian (404 if it is
another school's) and reads the address from the guardian's own record.
Only ADMIN, ACCOUNTANT and OFFICE_STAFF hold `COMMUNICATION_SEND`; teachers
do not.

```mermaid
flowchart LR
    REQ["POST /communications/send\n{ medium, guardian_id, message_body }"] --> G["guardian of this school?"]
    G -- no --> E404["404"]
    G -- yes --> A["address from guardian record\n(phone for SMS, email for EMAIL)"]
    A -- none --> E400["400 GUARDIAN_NO_ADDRESS"]
    A --> LOG["CommunicationLog + queue"]
```

If `student_id` is also sent, the guardian must be linked to that student
(else 400 `GUARDIAN_NOT_LINKED`). Internal senders (invoices, study plans,
incidents, applications) still call `enqueue` with addresses they resolved.

## Delivery tracking & debugging

Every send — success or failure, automated or staff-triggered — gets a
`CommunicationLog` row: recipient, channel, message content, delivery
status, and who/what triggered it (`sent_by` is null for
automatically-triggered sends). This is the first place to look when a
guardian says "I never got the reminder."

`CommunicationLog.status` moves through:

- `QUEUED` — waiting for `CommunicationsProcessor` to pick it up.
- `SENT` — the provider accepted it.
- `FAILED` — permanently failed (bad provider, no retries left, or the
  tenant is suspended — see below); `metadata.reason` / `metadata.error`
  says why.

## Push-first dispatch for routine automated notifications [#555]

"Push" here means a browser/OS notification delivered through the [Web
Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) to a
device the guardian's linked user account has subscribed from (see
`modules/push/`) — not SMS, WhatsApp, Messenger, or email. Free to send
(no gateway cost), so it's tried first for **routine** notifications, with
the guardian's normal preferred channel as the fallback.

**Routine** = `CommunicationLog.trigger === CommunicationTrigger.AUTOMATED`
— today that's only attendance-absence notices
(`absence-notice.scheduler.ts`'s daily sweep, and the same code path when
a class teacher finalizes a register early). A **staff-initiated** send —
one guardian (`SINGLE_REMINDER`), a bulk campaign (`BULK_REMINDER`), or a
freeform message (`MANUAL`) — always goes straight to the guardian's
preferred channel, exactly as before. `ACCOUNT_ACCESS` sends (invites,
OTPs, password resets) are excluded too: a fallback delay is not
acceptable for those.

```mermaid
flowchart TD
    Q["CommunicationsProcessor.process(job)\n(after the tenant-suspension check)"] --> R{"log.trigger ==\nAUTOMATED?"}
    R -->|no| PREF["Send via log.medium\n(unchanged — staff picked this channel)"]
    R -->|yes| U{"Guardian has a\nlinked user\n(guardian.user_id)?"}
    U -->|no| PREF
    U -->|yes| PUSH["PushService.sendToUser(userId, tenantId, payload)"]
    PUSH --> A{"accepted >= 1?"}
    A -->|yes, STOP| DONE["Rewrite this log:\nmedium = PUSH\nrecipient_address = push:&lt;user_id&gt;\nmetadata = {accepted, transient, pruned}\nstatus = SENT\n(one CommunicationLog row — no SMS/email log created)"]
    A -->|no, fall through| PREF
```

Decision table (opt-out is checked upstream — see
`reminder-recipients.util.ts#partitionByOptOut` — and stays authoritative:
an opted-out guardian never gets a `CommunicationLog` row queued at all,
so it never reaches this table):

| Trigger                                                           | Guardian has linked user + push subscription? | Push result      | What gets logged / sent                                                          |
| ----------------------------------------------------------------- | --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| `AUTOMATED` (routine)                                             | No                                            | —                | Preferred channel, unchanged (SMS/WhatsApp/Email)                                |
| `AUTOMATED` (routine)                                             | Yes                                           | `accepted >= 1`  | **One** `CommunicationLog` (`medium = PUSH`) — preferred channel is **not** sent |
| `AUTOMATED` (routine)                                             | Yes                                           | `accepted === 0` | Falls back to preferred channel, unchanged                                       |
| `MANUAL` / `SINGLE_REMINDER` / `BULK_REMINDER` / `ACCOUNT_ACCESS` | irrelevant                                    | —                | Preferred channel, unchanged — never tried via push                              |

Example: a guardian with the app installed as a PWA on their phone gets an
absence notice as a push notification instead of an SMS. A `push` medium
log for them looks like:

```json
{
  "medium": "PUSH",
  "recipient_address": "push:3f2a1c9e-...-user-id",
  "metadata": { "accepted": 1, "transient": 0, "pruned": 1 },
  "status": "SENT"
}
```

No push endpoint or subscription key ever lands in `CommunicationLog` —
only which user it went to and the accept/transient/pruned counts
`PushService.sendToUser` returned (see `modules/push/push.service.ts`).

For VAPID key generation, storage, and rotation cost, see
[`12-operations.md` §5 Web push](12-operations.md#5-web-push-vapid-keys).

`medium = 'PUSH'` is a value only `communication_logs.medium`'s own DB
enum accepts (`communication_logs_medium_enum`,
migration `1789400000000-AddPushCommunicationMedium.ts`) — it is
deliberately **not** part of the shared `CommunicationMedium` enum used
elsewhere (e.g. `guardian.preferred_communication`), because a guardian
can never _choose_ push as a preferred channel the way they can choose
SMS or email.

When push is accepted instead of SMS, the SMS credit reserved for that
log (fee, payment-receipt and calendar notices reserve credit and carry
`batchId` + `segments` in the job) is **released** (`settlePart(..., 'RELEASE')`,
`metadata.credit = RELEASED`), because no SMS goes out. Logs with no
reservation (unmetered tenant, no `batchId`) touch nothing.

### The arrival-notice branch [84.1.3 / D44]

An `ARRIVAL_NOTICE` log is **not** push-first. The subscription row already
says how the guardian wants it, so the processor obeys the log's `medium`
and never falls back to the other channel.

```mermaid
flowchart TD
  L[ARRIVAL_NOTICE log] --> M{medium}
  M -->|PUSH| P{guardian has a push device?}
  P -->|yes| S[push sent]
  P -->|no| F1[FAILED, reason NO_PUSH_DEVICE, never SMS]
  M -->|SMS| R[credit-reservation backstop, then SMS provider]
  M -->|anything else| F2[FAILED, reason ARRIVAL_MEDIUM]
```

Example: Rahim's guardian chose "in the app" but has no device. The log ends
`FAILED` with `metadata.reason = 'NO_PUSH_DEVICE'`; no SMS credit is spent.
Dedupe is the log's `reference_key` (`arrival:<date>:<student>:<guardian>`,
D22): a second notice for the same day is a unique-key conflict, so a skip.

## Arrival-notice log claim [#3286]

`ArrivalNoticeService` bounds `queue.add` with a 3 s timeout, but the add is not cancelled. So the
enqueue-timeout path and the worker can both reach the same log. One conditional UPDATE decides
who owns it (`server/src/modules/communications/worker/log-claim.ts`). No new status value and no
migration: the claim is `metadata.claimed_by` = the BullMQ job id.

```mermaid
stateDiagram-v2
    [*] --> QUEUED: log saved, reference_key set
    QUEUED --> QUEUED: worker claims (claimed_by = job id)<br/>a retry of the same job re-claims
    QUEUED --> FAILED: enqueue timeout, only if unclaimed<br/>(frees reference_key, releases credit)
    QUEUED --> SENT: worker delivers
    QUEUED --> FAILED: worker settles a failure
    FAILED --> [*]: late worker cannot claim, skips
    SENT --> [*]
```

- Worker (ARRIVAL_NOTICE only): `UPDATE ... WHERE status='QUEUED' AND (claimed_by IS NULL OR claimed_by = jobId)`. 0 rows = already settled, skip.
- Timeout path: `UPDATE ... SET status='FAILED', reference_key=NULL WHERE status='QUEUED' AND claimed_by IS NULL`. 0 rows = a worker owns it, so credit and key are left for the worker.
- Absence notices, fees and OTP logs never claim; their behaviour is unchanged.

## Suspended tenants: queued work is cancelled, not paused

A school (tenant) can be suspended by a SUPER_ADMIN
(`TenantStatusService`, `server/src/modules/schools/tenant-status.service.ts`).
`CommunicationsProcessor.process()` checks `tenantStatus.isActive(tenantId)`
before doing anything else — no provider call, no SMS credit debit for a
suspended tenant:

```mermaid
sequenceDiagram
    participant Q as BullMQ job
    participant P as CommunicationsProcessor
    participant T as TenantStatusService
    participant Prov as SMS/WhatsApp/Email provider

    Q->>P: process(job)
    P->>T: isActive(tenantId)
    alt tenant suspended
        T-->>P: false
        P->>P: log.status = FAILED\nmetadata.reason = "TENANT_SUSPENDED"
        P-->>Q: return (no throw, no retry)
    else tenant active
        T-->>P: true
        P->>Prov: send(message)
        Prov-->>P: result
    end
```

**Important:** this cancels the job, it does not pause it. A message
queued while a school is suspended ends up `FAILED` with
`metadata.reason = "TENANT_SUSPENDED"` and stays that way — reactivating
the school does **not** automatically resend it. Example: a bulk fee
reminder queues 200 `CommunicationLog` rows, the school gets suspended
mid-batch, and 80 rows haven't been picked up by a worker yet — those 80
end up `FAILED`. When the school is reactivated, staff have to trigger a
new send (single or bulk) for anyone who still needs the reminder.

## SMS credit settlement [15.6.6/#549]

A metered tenant's bulk SMS send **reserves** credits for the whole batch
up front (`batch:<batchId>`, epic #508's `RESERVE` ledger kind — see
[the credits doc/#546] for the batch-level reservation). Each individual
SMS job then **settles its own slice** of that reservation, once, right
after the provider call returns — this is the part this section documents.

```mermaid
flowchart TD
    P["Provider call returns"] --> O{"result.outcome"}
    O -->|ACCEPTED| D["DEBIT\nsettlePart(..., 'DEBIT')\nmetadata.credit = DEBITED"]
    O -->|REJECTED| R["RELEASE\nsettlePart(..., 'RELEASE')\nmetadata.credit = RELEASED"]
    O -->|AMBIGUOUS| U["stays RESERVED\nno settlePart call\nmetadata.credit = UNSETTLED\nSentry tag needs_reconciliation"]
    S["Tenant suspended\n(no provider call)"] --> R
```

| Provider outcome             | Meaning                                                                             | Ledger kind | Balance effect                                  | `metadata.credit` |
| ---------------------------- | ----------------------------------------------------------------------------------- | ----------- | ----------------------------------------------- | ----------------- |
| `ACCEPTED`                   | Provider took the message                                                           | `DEBIT`     | `reserved -= segments`, credits spent           | `DEBITED`         |
| `REJECTED`                   | Provider (or a pre-flight check) definitely refused it — 4xx/validation, never sent | `RELEASE`   | `reserved -= segments`, `available += segments` | `RELEASED`        |
| `AMBIGUOUS`                  | Timeout/5xx/unknown error _after_ the request went out — unclear if it was sent     | none        | untouched — stays reserved                      | `UNSETTLED`       |
| Tenant suspended before send | No provider call was made                                                           | `RELEASE`   | `reserved -= segments`, `available += segments` | `RELEASED`        |

A **post-acceptance delivery failure** (the SMS was accepted by the
gateway but never reaches the handset — bad number on the carrier side,
etc.) is **not** one of these outcomes: it's invisible to this processor,
which only sees the gateway's immediate accept/reject response. It stays
billed — this mirrors how a real carrier charges: you pay to hand the
message to the network, not for confirmed handset delivery.

### Key convention (#1317)

Every metered-SMS producer follows one rule, so the worker can find the
reservation it settles:

```mermaid
flowchart LR
    P["Producer picks a bare batchId\nfee-notify:G1:sms"] -->|"reserve key"| R["RESERVE\nbatch:fee-notify:G1:sms"]
    P -->|"job data"| J["{ logId, batchId: fee-notify:G1:sms, segments }"]
    J --> W["Worker settlePart(\nbatch:fee-notify:G1:sms,\nlog:LOG_ID)"]
    R -.same key.- W
```

| Producer                              | Bare `batchId` (job) / reserve key = `batch:` + it         |
| ------------------------------------- | ---------------------------------------------------------- |
| Bulk reminders                        | `<batch.id>`                                               |
| Calendar notify                       | `<batch.id>`                                               |
| Incident SMS                          | `incident:<incidentId>`                                    |
| Fee notification                      | `fee-notify:<feeGenerationId>:sms`                         |
| Payment receipt                       | `payment-notify:<paymentId>:<guardianId>`                  |
| Invoice send (manual)                 | `invoice-send:<invoiceId>:<guardianId>:<sendId>`           |
| Exam result SMS                       | `exam-result-sms:<examId>:<sendId>`                        |
| Absence notice                        | `<logId>` (one reservation per SMS log)                    |
| Homework notice                       | `<logId>`                                                  |
| Admission status SMS                  | `<logId>`                                                  |
| Single reminder                       | `<uuid>` (one per send, shared by its SMS logs)            |
| Free-form `POST /communications/send` | `<uuid>` (reserved inside `CommunicationsService.enqueue`) |

Rules:

- **Backstop:** the worker fails any SMS job for a metered tenant that
  carries no reservation (`metadata.reason = 'UNRESERVED_SMS'`, no provider
  call, no retry). A future producer that forgets to reserve cannot spend
  platform money.
- Automated producers (absence, homework, admission) that find the balance
  short do not queue the SMS: the log is saved `FAILED` with
  `metadata.reason = 'INSUFFICIENT_SMS_CREDIT'`. Staff-initiated sends
  (single reminder, free-form) answer 409 `INSUFFICIENT_SMS_CREDIT` instead.
- If the reserve call itself throws (a DB error, say), the automated
  producer saves that log `FAILED` with
  `metadata.reason = 'CREDIT_RESERVE_FAILED'` and moves on to the next
  recipient. A log is never left `QUEUED` with no job behind it.
- Single reminder reserves for the whole send up front. If its loop throws
  half-way (e.g. a log save fails), it gives back the unused part under the
  `unused:<uuid>` part key. Example: 3 segments reserved, 1 queued, then a
  save fails → 2 segments are released.
- **Exempt: two paths skip the queue and credit on purpose.** They call the
  SMS provider directly, so neither reserves and the backstop never sees them:
  - `account-access-delivery.service.ts` — invitations, login OTPs,
    password-reset links and backup/restore notices. A school at 0 credit
    must still be able to sign in and recover an account.
  - `schools/trial/admin-notice.service.ts` — trial warning, trial-ended and
    welcome notices to a school's admins. The platform sends these, not the
    school.

  Any other new SMS sender must go through the queue and reserve.

- A manual re-send gets its own `sendId` (and its own `reference_id`), so
  each send reserves and is capped on its own.
- `CommunicationsService.enqueue` releases the reservation itself when no job
  will ever exist: the log save or lookup throws (`enqueue-failed:<uuid>` part
  key) or `queue.add` throws (`log:<id>`). The exam-result loop does the same
  per job: a failed log save releases under `enqueue-failed:<uuid>`, a failed
  `queue.add` under `log:<id>`, and the loop carries on with the next job.
- The fee and payment listeners do **not** release on a `queue.add` failure.
  The log is marked `ENQUEUE_FAILED` and a replayed event re-claims that same
  log id, so the units stay held for the replay's settle. Releasing would make
  the re-sent SMS free.

### Reconciling stranded reservations (#1317)

Before the fix, fee, payment-receipt, invoice-send and exam-result reservations
were made under a key the worker never looked up (no `batch:` prefix). Their
units stayed in `reserved` forever. An operator command finds them and settles
the ones whose outcome is certain. It is **not** a migration and never runs on
boot: you start it by hand.

Run it **after** the fix is deployed **and** the communications queue has
drained (in-flight rows are skipped, so an early run is safe but incomplete).

**Deploy note:** drain or stop the communications workers before (or while)
deploying the producers. A rolling deploy lets an OLD worker handle a NEW-key
job (for example by push-delivering it), which leaves units reserved under a
`batch:` key. Run the dry-run afterwards: such rows show up as
`BATCH_REMAINDER`.

```bash
cd server && yarn sms-credit:reconcile                          # dry run, all tenants (default)
cd server && yarn sms-credit:reconcile --tenant=<uuid>          # dry run, one tenant
cd server && yarn sms-credit:reconcile --tenant=<uuid> --apply --confirm-db=<database name>  # act, one tenant
```

It connects with `DATABASE_URL` from `.env`, like `settings:reencrypt`, but an
already-exported `DATABASE_URL` wins over `.env`. So `--apply` is refused
(exit 2) unless `--confirm-db=<name>` equals the database it actually
connected to (the `database=` value on the first output line; a dry run
shows it). Dry runs need no confirmation.

How each linked SMS log is decided (the log's own `log:<id>` part key is used,
the same one the worker uses, so a re-run or a late worker can never charge or
credit twice):

```mermaid
flowchart TD
    L["Linked SMS log"] --> S{"log:ID:settle\nalready in ledger?"}
    S -->|yes| AS["ALREADY_SETTLED\n(--apply fixes metadata.credit only)"]
    S -->|no| Q{"status QUEUED?"}
    Q -->|yes| IF["IN_FLIGHT: untouched"]
    Q -->|no| E{"ENQUEUE_FAILED?"}
    E -->|yes| M1["MANUAL_REVIEW\nENQUEUE_FAILED_REPLAYABLE"]
    E -->|no| ST{"status"}
    ST -->|"SENT / DELIVERED / READ"| D["DEBIT"]
    ST -->|"FAILED: tenant suspended,\nno provider, invoice enqueue failed"| R["RELEASE"]
    ST -->|"any other FAILED"| M2["MANUAL_REVIEW\nFAILED_OUTCOME_UNKNOWN"]
```

Example dry run (made-up ids; only ids, counts and codes are printed, never
keys, phones, names or message text):

```text
sms-credit:reconcile mode=DRY-RUN database=biddaloy
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=91ef... units=2 action=DEBIT reason=SENT
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=44aa... units=1 action=RELEASE reason=TENANT_SUSPENDED
tenant=0a1b... reserve=7c2d... source=FEE_NOTIFY log=5be0... units=1 action=MANUAL_REVIEW reason=FAILED_OUTCOME_UNKNOWN
tenant=0a1b... stranded_reserves=1 settled_reserves=0 debit=1/2u release=1/1u manual=1/1u already_settled=0 in_flight=0 errors=0
```

`MANUAL_REVIEW` rows are only listed, never touched. They keep their units
reserved until a person decides:

| Reason                         | Meaning                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FAILED_OUTCOME_UNKNOWN`       | FAILED but we cannot tell rejected from ambiguous on old rows                                                                                                                                                                          |
| `ENQUEUE_FAILED_REPLAYABLE`    | A replayed event re-claims this log; releasing would make the re-send free                                                                                                                                                             |
| `ENQUEUE_FAILED_HOLDING_UNITS` | Same, on a post-fix `batch:` reservation. Listed only                                                                                                                                                                                  |
| `AMBIGUOUS_LINK`               | Invoice-send reserve has no single matching log (time-window match)                                                                                                                                                                    |
| `NO_LOG_LINK`                  | Exam-result reserve: logs carry no link to the reservation                                                                                                                                                                             |
| `SHARED_REFERENCE`             | Old invoice-send reserves for one invoice share a reference, so their caps mix; never settled. (Result SMS has one reserve per exam key, so it is never a group.) Reported once per group, as the units not yet settled (any key form) |
| `BATCH_REMAINDER`              | A `batch:` reserve older than 24h with units left and no QUEUED SMS log since: crashed worker, push-delivered by an old worker, or a rolling deploy. Listed only                                                                       |
| `SPLIT_ACROSS_DEPLOY`          | Both an old and a `batch:` reserve exist for the same send; their caps would mix                                                                                                                                                       |
| `EXCEEDS_RESERVATION`          | Settling this log would pass the reserved units                                                                                                                                                                                        |
| `ORPHAN_UNITS`                 | Reserved units no log accounts for                                                                                                                                                                                                     |
| `UNKNOWN_KEY`                  | Reserve key matches no known producer                                                                                                                                                                                                  |

Legacy fee and payment SMS that were delivered by **push** (not SMS) have no
SENT log to debit, so their reserved units show up as `ORPHAN_UNITS`. That is
manual review too.

Safe to re-run: settled rows show as `ALREADY_SETTLED` and nothing is written
twice. The exit code is 1 if any row ended in `ERROR`, 2 for bad arguments.

### Where settlement happens, and why it's outside the log-save transaction

`CommunicationsProcessor.settle()` (the log-save + batch-counter update)
already runs in one DB transaction — see its doc comment. Credit
settlement is a **separate, later** step, deliberately **not** part of
that transaction: a `SmsCreditService.settlePart` failure must never roll
back (or block recording) a send that already happened. If it fails, the
processor logs the error and writes `metadata.credit = 'UNSETTLED'`
instead of throwing — throwing here would risk BullMQ retrying a job
whose SMS was _already sent_, resending it to the guardian a second time.

### Idempotency and the retry/crash window

`settlePart(tenantId, batchKey, logKey, units, outcome)` is idempotent on
`` `${logKey}:settle` `` (`log:<logId>:settle`) — a second call with the
same key is a no-op. Since every settlement call in the processor uses
the same `log:<logId>` key regardless of how many times that job runs,
a BullMQ retry or stalled-job replay settles at most once.

This does **not** close the existing duplicate-send crash window
documented on `CommunicationsProcessor` itself: if the worker crashes
_after_ the provider accepts the message but _before_ the log save
commits, a replay resends the SMS (the log's status guard only catches a
replay _after_ that save landed). What settlement adds: if that same
crash happens after the provider call but before this class gets a chance
to run `settlePart`, the reservation for that log is left in its original
"neither debited nor released" state. The next time this job is
processed, it goes through the outcome mapping again and settles
normally — so the crash window is closed for credit-correctness the same
way it already is for the log/batch state. The `AMBIGUOUS` case is the
one that's expected to require a human: reconciliation tooling looks for
`metadata.credit = 'UNSETTLED'` and the `needs_reconciliation` Sentry tag
(reusing 15.1.4's queue-failure telemetry — see
`CommunicationsProcessor.flagAmbiguousSettlement`) to find these and
resolve them manually.

## Test inbox sink (`MESSAGE_SINK=mailpit`) [Epic 87]

With `MESSAGE_SINK=mailpit`, the registry skips every real provider. Each medium (SMS, WhatsApp, email, Messenger) is sent to Mailpit as an email with the real body, so you can read OTP codes in a browser. `DEMO_MODE` alone does **not** do this.

```mermaid
flowchart LR
  P[CommunicationsProcessor] --> R[Provider registry]
  R -- "MESSAGE_SINK unset" --> Real[SMS / WhatsApp / SMTP / Messenger]
  R -- "MESSAGE_SINK=mailpit" --> S[MailpitSinkProvider]
  S -- SMTP --> M[(Mailpit inbox)]
```

Example: an SMS to `01711111111` arrives as an email to `01711111111@sms.sink.invalid`, subject `[SMS]`, header `X-Tags: SMS`. The number stays out of the subject, because the demo inbox is public and lists subjects; search by `to:` instead.

| Variable                  | Default               | Meaning                                                                                                                                                                      |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MESSAGE_SINK`            | unset                 | `mailpit` turns the sink on. Anything else is off.                                                                                                                           |
| `MESSAGE_SINK_SMTP_URL`   | `smtp://mailpit:1025` | Where the sink sends. Dev `.env` sets it; `deploy/stack.yml` sets `smtp://<stack>-mailpit:1025`, since the bare `mailpit` alias is shared across stacks on the edge network. |
| `MESSAGE_SINK_PUBLIC_URL` | unset                 | Browser URL of the Mailpit UI, for links in docs and UI.                                                                                                                     |

If Mailpit cannot be reached (connection refused, reset, timed out, or its name does not resolve, e.g. during the nightly restart), the send fails with `Test inbox unreachable` and the queue retries it. The log row ends FAILED only when the retries run out. Any other sink error is final at once.

### Test inbox: deploy and learning [87.1.06]

Hostnames are single level: `inbox-demo.<domain>` and `inbox-staging.<domain>`. Cloudflare Universal SSL covers one level only, so `inbox.demo.<domain>` would have no cert.

Deploy prerequisites on demo and staging:

- `MESSAGE_SINK=mailpit` and `COMPOSE_PROFILES=sink` (config:check refuses either one missing). The deploy names `mailpit` in its `up` on staging and demo, because a profile alone never starts a service.
- `INBOX_*` keys in `edge.enc.env`.
- The edge nginx has a separate block for Mailpit's send API (`/api/v1/send`); it is not exposed like the UI.

Dated learning (2026-10-28):

- **Surprise:** test-env starts db, redis and seaweedfs only, so there is no Mailpit locally. Cost: the "OTP in Mailpit" proof could not run in CI. Fix: `mailpit-sink.smtp.spec.ts` runs the real provider against an in-test SMTP socket. Rule candidate: prove a sink with a socket listener, keep the live-inbox check as a manual step.
- **Surprise:** the existing provider spec mocks `nodemailer`, so it never checked the wire format (`X-Tags`, `To`, `Subject`). Fix: a second spec file with no mock. Rule candidate: one mocked spec plus one real-transport spec per provider.
- **Surprise:** a down inbox must fail the log row (D10). Covered by the closed-port case in the same spec.
- **Surprise:** a two-level host like `inbox.demo.<domain>` is outside Cloudflare's free Universal certificate, which covers one level only. Cost: the planned names would have failed TLS. Fix: single-level `inbox-demo.` and `inbox-staging.`. Rule candidate: new public hostnames are one label under the apex.
- **Surprise:** a shared nginx `map` lived in `ops.conf.template`, which the edge deletes when ops is off; the new inbox block then stopped nginx booting. Fix: the inbox template owns its own map. Rule candidate: a template never uses a variable defined in an optional template.
- **Surprise:** vitest does not type-check, so a stray `, null` argument passed 23 tests and failed `yarn lint`. Rule candidate: run `tsc` on the touched package before committing.

## Notice board (Epic 53)

A notice is a message pinned on the school board. People read it in the app. It is different from a manual alert (a one-off bar for a chosen audience, no read list) and from SMS (a paid text sent per person). A notice keeps a read list: `notice_recipients.seen_at` tells who has read it. SMS is optional and waits for admin approval.

```mermaid
erDiagram
  schools ||--o{ notices : "tenant_id (CASCADE)"
  notices ||--o{ notice_attachments : "notice_id (RESTRICT)"
  notices ||--o{ notice_recipients : "notice_id (RESTRICT)"
  users ||--o{ notices : "author_user_id (RESTRICT)"
  users ||--o{ notice_recipients : "user_id, STAFF"
  students ||--o{ notice_recipients : "student_id"
  guardians ||--o{ notice_recipients : "guardian_id"
  communication_logs ||--o{ notice_recipients : "communication_log_id (SET NULL)"
  notices {
    uuid id
    varchar title
    text body
    varchar status "DRAFT PUBLISHED WITHDRAWN"
    boolean important
    boolean pinned
    boolean is_public
    date expires_on
    varchar sms_status "NONE PENDING APPROVED DECLINED"
    int recipient_count
  }
  notice_attachments {
    uuid id
    varchar storage_key
    varchar mime_type "pdf png jpeg webp"
    int size_bytes "max 5 MB"
  }
  notice_recipients {
    uuid id
    varchar kind "STAFF STUDENT GUARDIAN"
    timestamptz seen_at
    timestamptz acknowledged_at
    boolean sms_wanted
  }
```

Example: a published notice "Eid holiday" with 2 staff and 1 guardian has 3 `notice_recipients` rows. When a teacher opens it, her row gets `seen_at`.

Every table has `tenant_id`. Only SHA-256 hashes of public and link tokens are stored. Source: `server/src/migrations/1791900001200-Notices.ts`.

### Notice board: Wave 1 learning (2026-11-01)

See the dated bullets in [27-qa-audit-lessons.md](27-qa-audit-lessons.md) (Docker hang, stale lock), [22-demo-seed.md](22-demo-seed.md) (coverage guard) and [36-domain-invariants.md](36-domain-invariants.md) (reset order, delete guard).
