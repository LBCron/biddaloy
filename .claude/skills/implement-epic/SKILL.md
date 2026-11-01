---
name: implement-epic
description: Implement a whole epic in parallel — group its sub-issues into file-disjoint lanes, run a subagent per lane, review and integrate, then open and land the PRs in a merge order that cannot conflict. Use whenever the user invokes /implement-epic, gives an epic number or link and asks to build it out, or asks to work an epic's sub-issues in parallel rather than one at a time. Also use to resume a partially-finished epic run. For a single issue or a short hand-picked list, use implement-issue instead.
---

# Implement Epic

Take an epic with N sub-issues and land it as a small number of parallel,
conflict-free PR chains instead of one N-long serial queue.

`implement-issue` is the inner loop and stays the authority on how a single
ticket gets planned, built, reviewed and shipped. This skill owns everything
around it: which tickets can run at the same time, who owns which files, what
gets integrated before anything reaches `main`, and where a human says yes.

**The core idea:** ordering does not prevent merge conflicts — **disjointness**
does. A numbered branch name only decides who has to resolve the conflict. So
the central job here is partitioning the epic into groups that own
non-overlapping file territory, and serializing the handful of things that can
never be disjoint.

## Invocation

```
/implement-epic 364
/implement-epic https://github.com/org/repo/issues/364
/implement-epic plan 364
/implement-epic 364 --groups 2 --only w1
/implement-epic 364 --recommended
/implement-epic resume
```

- **epic number or link** → full run.
- **`plan <epic>`** → run steps 0–3 only: resolve, plan every sub-issue,
  publish each plan to its GitHub issue, partition, then stop at GATE 1 without
  writing code. Mirrors `/implement-issue plan`. A later full run picks up the
  published plans instead of redoing them.
- **`resume`** (or no argument with a state file present) → read
  `.implement-epic-state.md` and continue.
- **`--groups N`** → cap parallel lanes (default 3; for a **plan-grade** epic
  the default is one lane per sub-issue in the wave, max 8 — see step 3).
- **`--only w<N>`** → run one wave and stop. `w<N>c` is that wave's close
  sub-wave.
- **`--recommended`** → decide instead of asking. See
  [Recommended mode](#recommended-mode---recommended).

Record the flag in the state file header so `resume` keeps it.

### Recommended mode (`--recommended`)

Every time the run would stop to ask the user — a gate, a re-partition, a
plan-drift verdict, a fix approach, a plan that could go two ways — do this
instead:

1. Analyse it: what is the choice, what does each path cost and risk.
2. Write 2–4 options. Flag exactly one as **(recommended)**, with a one-line
   reason.
3. Take the recommended option and keep going.
4. Log it in the state file under `## Decisions` (and in the PR description
   of the PR it lands in), so the user can review every call later:

```markdown
## Decisions
- D3 (w2, #1240): 2 lanes both touch ui/src/hooks/survey.ts
  - A: merge both lanes into one (recommended — serial, zero conflict risk)
  - B: pull survey.ts out as its own hot-path lane
  - Chosen: A
```

With `--recommended` the run **does not stop until the whole epic is
implemented**: every wave, every wave-close task, every PR opened and put
through step 8. The model takes the recommended path at every fork itself. The
only stops are GATE 3 (merging) and a hard error (an outage or usage limit is
not one — wait and resume).

Passing `--recommended` is the user's approval for GATE 1 and GATE 2. It is
**not** approval for:

- **GATE 3 — merging to `main`.** Still the user's explicit call, per PR.
  There is no auto-merge, under any flag, ever.
- Anything the rules below forbid outright: `--force` / `-D`, history
  rewrites, crossing the 90-file chain ceiling or the 100-file PR limit.

Pass the flag down: tell every `epic-group-worker` (and, through it, every
planner / implementer / reviewer) to resolve its own choices the same way and
return the options + chosen one in its report, so you can log them.

## Mode

Run in `/caveman ultra` so orchestration chatter stays cheap. This
governs **your conversational output only**. Plans, code, commit messages, PR
descriptions and the state file stay normal and readable — a compressed plan
defeats its purpose, since the user has to review it.

When dispatching `epic-group-worker` (and it, in turn, dispatching
`issue-planner` / `issue-implementer` / the review subagent), tell them to run
in `/caveman ultra` for their own narration, with the same carve-out —
published plans, code, tests, stories, and commit/PR text stay normal.
Subagents are separate contexts and don't inherit your mode unless told.

Also tell them to run in `/ponytail full`. Unlike caveman, this shapes the
artifact: each group's plan and code should take the leanest design that
satisfies its tickets — reuse/extend over new abstraction, no speculative
scope — never cutting input validation, auth, tenant isolation, or error
handling at a trust boundary. Say it explicitly in every dispatch prompt; it
doesn't inherit down the `epic-group-worker` → `issue-planner`/
`issue-implementer` chain either.

Also paste the [Network outages](#network-outages) rule into every dispatch
prompt, for the same reason: it has to reach every agent at every level.

## Network outages

A run spans hours, and the network will drop. When it does, **wait and
resume — never fail the work.** This rule is for the orchestrator and every
agent it starts, at every level. Two kinds of call can fail:

| Failed call | Looks like |
|---|---|
| **Tool network call** — `git fetch/push`, `gh`, `yarn install`, `curl` | `Could not resolve host`, `ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `Network is unreachable`, `ssh: connect to host … timed out` |
| **LLM call** — a dispatched agent returns an API error instead of a report | `API Error`, `Connection error`, `Request timed out`, `fetch failed`, `overloaded` / 529, any 5xx |

Claude Code already retries a failed LLM call a few times on its own; this
rule starts when that error finally surfaces.

**Usage limit** (`usage limit reached`, `rate_limit_error`, 429 from the LLM
API) is handled the same way, except the probe can't see it — the network is
fine. Wait 5 minutes, retry (resume the agent / re-run), and repeat until it
goes through. Never treat it as a hard error and never delete the resume
timer for it.

**Not an outage — handle normally:** an auth error, a 4xx from GitHub, a red
CI job. An SSH drop mid-`pre-push` hook while the probe below says online is
also not an outage; retry the push once.

### The probe

One command checks both GitHub and the LLM API. Plain `curl` (no `-f`) exits
0 on any HTTP answer, even a 404 — only "can't connect" fails:

```bash
curl -sI --max-time 10 https://api.github.com >/dev/null \
  && curl -sI --max-time 10 https://api.anthropic.com >/dev/null \
  && echo online || echo offline
```

### When a call fails

```mermaid
flowchart TD
    F["call failed\n(tool or LLM)"] --> P{probe}
    P -->|online| N["not an outage —\nhandle the error normally"]
    P -->|offline| W["wait: probe every 5 min\n(keep doing local work)"]
    W -->|online| R{which call?}
    R -->|tool| T["re-run the exact command"]
    R -->|"agent's LLM call"| A["SendMessage the same agent:\n'network is back, continue where you stopped'"]
    A -->|resume fails| D["re-dispatch a fresh agent on the\nsame worktree + branch, same queue position"]
```

1. **Wait**, probing every 5 minutes. Use the Monitor tool with this loop; if
   Monitor isn't available, run it as a background Bash command and wait for
   it to exit:

   ```bash
   until curl -sI --max-time 10 https://api.github.com >/dev/null \
     && curl -sI --max-time 10 https://api.anthropic.com >/dev/null; do sleep 300; done; echo online
   ```

2. While waiting, keep doing local work that needs no network (edit, unit
   tests, lint). Don't start anything that will need the network halfway.
3. **Resume:**
   - tool call → re-run the exact command that failed.
   - an agent's LLM call → `SendMessage` the same agent (by its name or
     agent id) to continue. It keeps its transcript and its worktree, so it
     picks up mid-ticket. Only if that fails, dispatch a fresh agent of the
     same type on the **same** worktree and branch, told which ticket and
     step to resume from (the state file and `git log` say where it was).

Never mark a ticket `blocked`, count a step-8 fix round, or skip a step
because of an outage. Note each outage window in the state file.

### When the orchestrator's own LLM call fails

Nothing inside the session can react to that — the turn just ends. So a
timer does it from outside the turn. While the run is working on its own
(not stopped at a gate for the user), keep a recurring job alive:

```
CronCreate  cron: "*/5 * * * *"  prompt: "/implement-epic resume"
```

- Create it when work starts (after GATE 1, or at the start of `resume`).
  Record its job id in the state file.
- It only fires when the session is idle. If the session went idle because
  an LLM call failed, the next fire is a fresh LLM call that resumes the run
  from the state file — the same 5-minute recheck.
- **Delete it (`CronDelete`) whenever the run stops for the user** — at any
  gate, at the end of the run, on a hard error (an outage or a usage limit is
  not one) — and create it again when
  work restarts. Otherwise it fires every 5 minutes while you wait on a human.
- When it fires and the run is actually still busy (an agent or a wait loop
  is running), answer in one line and end the turn — don't re-dispatch
  anything.
- Cron jobs live only in this session and expire after 7 days. If the whole
  session dies, the user restarts with `/implement-epic resume`.

## Architecture

```mermaid
flowchart TB
    E["Epic #364"] --> DG["Provisional graph\ndeclared edges + hot paths"]
    DG --> P["Plan EVERY sub-issue\npublished to GitHub · file lists extracted"]
    P --> W["Waves → Groups\npartitioned on real file lists"]
    W --> G1{{"GATE 1\nuser approves groups\n(plan mode stops here)"}}
    G1 --> A1["group agent w1-g1\nworktree"]
    G1 --> A2["group agent w1-g2\nworktree"]
    G1 --> A3["group agent w1-g3\nworktree"]
    A1 --> INT["accumulating PR branch\nmerge wave heads · regenerate artifacts · full CI"]
    A2 --> INT
    A3 --> INT
    INT --> G2{{"GATE 2\nwave green on accumulating branch"}}
    G2 --> NW{{"next wave needs a PR yet?\n(100-file cap check)"}}
    NW -->|no, keep going| W
    NW -->|yes| PR["open PR N for what's accumulated\nnext branch stacks on PR N's branch"]
    PR -->|don't wait| W
    PR --> CR["Opus review + CI loop\nSonnet fixes · capped at 3 rounds\nstill red → [RED] in title, move on"]
    CR --> G3{{"GATE 3\nuser merges, bottom-up\n(never automatic)"}}
```

## Model routing

Same constraint as `implement-issue`: **you cannot switch your own model.**
Delegation to a pinned subagent is the only switch available.

| Phase | Runs on | How |
|---|---|---|
| Grouping, integration, PRs, merges | the session's model | here |
| Per-ticket plan — **plan-grade, standard tier** | Sonnet | folded into `issue-implementer` (`mode: self-preflight`); no separate agent |
| Per-ticket plan — **plan-grade, money tier** | Sonnet | `issue-preflight` subagent (verifies the body, publishes a `## Plan` pointer) |
| Per-ticket plan — everything else | Opus | `issue-planner` subagent |
| Per-ticket implementation | Sonnet | `issue-implementer` subagent |
| Per-ticket review — **money tier** | Opus | `issue-reviewer` subagent, from the group agent |
| Per-ticket review — **standard tier** | Sonnet | `Agent(model: "sonnet")` following `issue-reviewer.md`, from the group agent |
| PR review, CodeRabbit-style | Opus 5.5 | `Agent(model: "opus")` running `code-review` on the whole PR (step 8) |
| Review / CI fix rounds | Opus 5.5 | `Agent(model: "opus")`, every round (step 8) |
| Group orchestration | Sonnet | `epic-group-worker`, one per lane |

**Plan-grade** = the sub-issue body carries `## Files`, `## Tests`,
`## Acceptance` and a how-section — `## Steps` (Epic 16) or `## Contract`
(Epics 14/15). The plan already exists on the ticket; paying Opus to re-derive
it is the single largest avoidable cost in an epic run.

**Review tier** — where the expensive model actually earns its price. A ticket
is **money** when its `## Files` touches `server/src/migrations/**`,
`server/src/modules/fees/**` (beyond `dto/` and controller-only changes),
`server/src/modules/invoices/**`, `server/src/modules/reports/**`,
`server/src/modules/auth/**`, or its body mentions an approval scope, wallet,
allocation, reversal, ledger or late fee.

A ticket is **also money-tier**, regardless of which module directory it
lives in, when its `## Files` or plan touches code that can **delete,
overwrite, or bulk-mutate tenant data outside the ticket's own new tables** —
e.g. a restore/import processor, a retention/cleanup job, a bulk deletion
endpoint. Epic 14's workbook restore module missed the path list above and
produced two critical bugs (a pin/retention race, and a TypeORM orphaning bug
that nulled cross-tenant foreign keys) — it should have been money-tier on
behavior, not on path.

Everything else — UI, docs, hooks, wave-close glue — is **standard**. An epic
body may override with an explicit list.

**You compute the tier**, once per ticket, from its `## Files` at step 2 —
it's a path match on text you've already fetched, not a job for an agent.
Record it in the state file, hand it to each group worker with its queue, and
the worker passes it to every agent it dispatches. The plan agent (pre-flight,
planner, or the implementer's self-pre-flight) writes it on the `## Plan`
comment so the reviewer has it too. The tier decides two things: whether a
standard ticket skips the separate pre-flight agent, and who reviews.

**Effort** is session-wide and cannot be set per agent (see `implement-issue`,
"Effort cannot be routed per phase"). Run the orchestrating session at
`/effort low`; model tier is the only per-phase lever, and the table above is
the whole of it. Never claim a per-phase effort split in a report.

State the actual session model in one line before starting, as
`implement-issue` does.

If the session carries a *"Do not call the Agent tool unless the user requested
it"* rule, invoking this skill **is** that request — parallel subagents are how
this skill is specified to work.

## The wave loop

A full run (no `--only`) works the waves **one at a time, to completion**:

```
for each wave N in order:
    step 5   run wave N's lanes in parallel          (GATE 1 once, before wave 1)
    step 6   merge wave N's heads into the accumulating
             PR branch, verify green                  → GATE 2 (per wave)
    w<N>c    run the wave-close task on the accumulating
             branch, add its commit                    (plan-grade epics)
    check the accumulating branch's file count against main
        still ≤ 100  → keep accumulating, go to next wave without opening a PR
        would cross  → step 7: open PR N for what's accumulated,
                        start step 8 on it, and start a fresh accumulating
                        branch rooted on PR N's head branch (stacked).
                        Don't wait for review, CI or a merge.
next wave — its lanes root at the accumulating branch's current head,
NOT at `main` (only a merge moves `main`, and merges are the user's)
```

Wave N+1 is never started until wave N is **integration-green on the
accumulating branch** — its tickets build on wave N's tables, services and
types, and the accumulating branch already has them even before any PR
merges to `main`. So a wave-N+1 lane's base branch is the accumulating
branch's current head, not `origin/main`, whenever a PR hasn't been cut yet.
Record this explicitly in the state file for each wave, since `resume` and
any dispatched worker need to know which branch is the real "current head"
distinct from `main`.

`--only w<N>` runs exactly one wave's step 5–6 (plus its close task) and
stops, leaving the accumulating branch exactly where it is — it does not
force a PR open. `resume` continues from the recorded wave and accumulating
branch.

PRs open back-to-back, no pacing wait between them — open the next one as soon
as the previous `gh pr create` returns, don't wait on CI or CodeRabbit first.
This matters less now that PRs are infrequent (ideally one per epic), but
still applies if the 100-file cap forces more than one. Expect a wave to still
span some real time (CI run length, CodeRabbit rounds, GATE 3 approval), and a
multi-wave epic to span hours to a day depending on epic size — but nothing in
the loop should have you sitting idle. While integration or CI runs, keep
working: dispatch the next wave's lanes against the accumulating branch. The
state file and the `## Plan` comments carry position between sessions if a run
does span more than one.

## Step 0 — Resolve the epic

```bash
gh api --paginate repos/<owner>/<repo>/issues/<epic>/sub_issues \
  --jq '.[] | "\(.number)|\(.title)|\(.state)"'
```

Sub-issues are **native** in this repo — read them from that endpoint, don't
scrape the epic body's table. Skip anything already closed. `--paginate` is not
optional: the endpoint returns 30 per page, so a large epic silently loses its
tail without it, and a missing ticket is invisible rather than loud.

If the epic has no native sub-issues, fall back to the body's issue links and
say which source you used.

## Step 1 — Build the dependency graph

Three sources, in descending confidence:

1. **Declared.** Sub-issue bodies state their edges in prose: *"Depends on
   13.1"*, *"**Blocks every other sub-issue**"*, *"Depends on #410"*. Parse
   every body and extract them. These are authoritative.
2. **Predicted file overlap.** After planning (step 2), each plan names the
   files it will touch. Two tickets sharing a file are dependent even when no
   body says so — e.g. a sidebar ticket and a header ticket both editing
   `ui/src/components/app-shell.tsx`. This is the edge type that actually
   produces merge conflicts.
3. **Hot paths — always serialized, never parallel.** Any ticket whose plan
   touches these goes in a lane by itself, or in the same lane as every other
   ticket touching them:

   | Path | Why |
   |---|---|
   | `server/src/migrations/**` | epoch-ms filename prefixes collide and misorder across branches |
   | `shared/src/**` | ripples into server and every client |
   | `ui/src/api/schema.d.ts` | generated + committed |
   | `client-admin/src/routeTree.gen.ts` | generated + committed |
   | `ui/src/hooks/**` | shared hooks; any two lanes that both touch backup/export/import features tend to share a hook file, and conflicts there are silent until merge |
   | `ui/src/i18n/locales/**` | same file per locale accumulates keys from every UI-touching lane in a wave; low conflict risk (usually additive) but still real, as seen in wave 4 |

Source 2 is the one that actually prevents conflicts, and it does not exist
until every ticket has a plan. That ordering is not negotiable: a partition
built on sources 1 and 3 alone is a **guess**, and discovering an overlap after
workers are already editing separate worktrees means two lanes have been writing
the same file for however long the discovery took. Step 2 therefore plans the
whole epic before any implementation starts.

### Blockers — found up front, not mid-run

Before any code, look for tickets that **cannot** be built yet. A dependency
inside the epic is just ordering (waves handle it). A blocker is something
outside the epic, or missing from `main`:

- a `Depends on #N` where #N is in another epic and still open
  (`gh issue view <N> --json state`)
- a seam the body says must already exist — a table, service, endpoint,
  route — that `graphify query` / a grep shows is not on `main`
- an epic body that marks the ticket blocked or deferred

For each blocked ticket, write the options and flag one recommended, e.g.:

```markdown
- #1255 needs the role guard from #786 (Epic 24, open)
  - A: skip #1255 and #1257 (depends on it); leave both open (recommended)
  - B: build a minimal guard here — duplicates #786's work
  - Chosen: A
```

These go to GATE 1 as decisions (`--recommended` takes the recommended one).
A skipped ticket takes every ticket that depends on it with it — follow the
graph: declared edges plus file overlap.

**Found mid-run instead** (a `blocked-on: #N` from pre-flight, or a ticket
that fails for good): don't stop the run. Skip that ticket and every ticket
that depends on it, in this wave and later ones, and carry on with the rest.
Record each skip, and why, in the state file under `## Skipped`. Skipped
issues stay open; they go in the PR description and the final report.

### What happens to a failed ticket's code

The worker never puts half-done code on its chain. It saves it to a pushed
side branch `epic/<slug>/<group>-blocked-<n>` or discards it, depending on
why it failed. Then you try to finish it **in this run**:

| Why it failed | What you do |
|---|---|
| **Needs files outside its lane** | Right after that wave is integrated, rerun the ticket as a one-lane mini-wave on the accumulating branch, starting from its side branch. With no other lane running, territory no longer matters. It joins the PR like any ticket. |
| **Tests stay red** | After the last wave, one more attempt: an Opus 5.5 implementer starts from the side branch with the failing output in hand. Green → it joins the open PR (or the next stacked one). Still red → comment on the issue. |
| **Blocked on missing work** | Nothing to retry until the blocker merges. Comment on the issue. |
| **Plan was wrong** | The code was discarded. Comment on the issue with what's wrong in the plan and the right approach. |

A ticket that ends up finished also un-skips its dependents — run them in
the same retry pass, in dependency order.

**The comment on the issue**, for any ticket still unfinished at the end:

```markdown
## Not finished in Epic #<epic> — context for the next attempt
- Code: `epic/<slug>/<group>-blocked-<n>` (pushed) — or "discarded: <why>"
- What failed: <command + output>
- Why it couldn't be finished in this run: <reason>
- Next step: <e.g. resume from the branch, fix X in file:line>
```

The issue stays open. The next `/implement-issue <n>` or
`/implement-epic resume` reads that comment and continues from the branch
instead of starting over. The side branch's worktree is removed as soon as
the code is pushed; the branch itself stays until the ticket ships, then
goes with that PR's other branches.

## Step 2 — Plan the whole epic first (discovery)

Build a **provisional** grouping from sources 1 and 3 — enough to order the
planning work, not to run implementation on. Then plan every open sub-issue
before any code is written:

- Dispatch `issue-planner` per ticket. These are independent and cheap to
  parallelize; batch them, respecting the same concurrency cap as groups.
- Each plan is published to its own GitHub issue as a `## Plan — <id>` comment.
  That is the durable artifact; it survives compaction, and step 5's workers
  read it instead of re-planning.
- Skip any ticket that already carries a current plan comment.
- From each plan, extract **the list of files it intends to touch**. If a plan
  doesn't name its files, send it back for revision — the partition depends on
  it, and so does the workers' territory rule.

### Plan-grade epics — pre-flight instead of planning

Before dispatching any planner, read one sub-issue body. If it carries
`## Files`, `## Tests`, `## Acceptance` and `## Steps` or `## Contract`, the
epic is **plan-grade** (Epics 14, 15 and 16 are). Then:

- **Dispatch no plan agent at discovery.** Fetch every open sub-issue body in
  one paginated `gh api` call, take the file list straight from `## Files`,
  and compute each ticket's review tier from it. That is all step 3 needs.
  Verifying a wave-5 body against wave-0 `main` would only report seams that
  haven't merged yet, so verification belongs at the moment of implementation,
  not here.
- Pre-flight happens **inside the group worker, per ticket, against the
  chain head**: standard tier → `issue-implementer` in `self-preflight` mode
  (verify, publish the `## Plan` pointer, implement — one agent); money tier →
  `issue-preflight` first, then the implementer. Either returns
  `needs-planner` when the body is not actually plan-grade or needs structural
  correction — only then does the worker dispatch `issue-planner` for that
  ticket — and `blocked-on: #<n>` when a seam it depends on has not merged.
- If a pre-flight correction changes a ticket's `## Files` in a way that
  crosses a lane's territory, the worker reports it and you re-partition; the
  discovery-time file list was an estimate, as the file cap already assumes.
- Waves are **declared**: each body says `Wave N` and the epic body carries a
  wave table. Use them. Still verify file-disjointness inside a wave from the
  `## Files` lists — a declared wave is a claim, and step 3 checks it.

`/implement-epic plan <epic>` stops here, after GATE 1, having published every
plan and written no code. That is the whole of its contract: this phase, then
stop.

## Step 3 — Partition into waves and groups

- A **wave** is a dependency level: everything in wave N+1 depends on something
  in wave N. Waves run one after another.
- A **group** is a lane inside a wave: a sequential queue of tickets that owns a
  file territory no other lane in that wave touches. Groups run in parallel.

Rules:

- A ticket that blocks many others (`**Blocks every other sub-issue**`, e.g.
  #417, #429, #410) is a wave of its own. Don't try to parallelize around it.
- Default max 3 concurrent groups. More lanes means more worktrees and more
  review load — it does not mean proportionally more throughput.
- Give each group a one-line territory description ("the `ui/` shell
  components", "server fees module + its DTOs"). If you cannot write that line,
  the partition is wrong.
- **Plan-grade epics:** use what the epic declares.
  - If the epic body declares **lanes** inside each wave (Epics 14/15: a lane
    table with a territory and an ordered task list), the lanes *are* the
    groups — one worker per lane, tasks in the declared order, up to the
    wave's lane count (`--groups` still caps it; Epic 14 wave 2 needs
    `--groups 6` or its tab lanes queue).
  - If the epic declares only **waves** (Epic 16), every sub-issue in a wave
    is its own lane, all in parallel, up to 8.
  - A wave's **close** task, when the epic has one ("wave close — seed,
    api-types, e2e"), is not a lane in that wave: it runs as its own one-lane
    sub-wave `w<N>c` **after wave N is integrated on the accumulating
    branch**, because it regenerates committed artifacts and needs every
    sibling in. It never waits for a merge to `main`.
  - **Disjointness is a scripted check, not an eyeball pass — this has already
    failed once.** Epic 14 wave 4's two lanes (w4-g1, w4-g2) both touched
    `ui/src/hooks/backup.ts`, its test file, and
    `ui/src/i18n/locales/*/backup.json`, undetected by inspection until the
    PRs conflicted at merge time. Before finalizing the partition, run an
    actual set-intersection check across every pair of lanes' `## Files`
    lists, e.g.:

    ```bash
    comm -12 <(sort lane-a-files.txt) <(sort lane-b-files.txt)
    ```

    Do this for every pair of lanes in the wave. Any non-empty intersection
    means those lanes must be merged into one, or the shared file must be
    pulled out as its own serialized hot-path lane. This is a hard rule, not
    a suggestion.

### UI work needs no mockup gate

There is no design-approval step. A ticket that changes UI ships in the same run
as everything else — the standard it is held to is **consistency with the app
that already exists**: `@biddaloy/ui` components and tokens only, the
established patterns reused (the four shells, the portal card grammar, the
density modes), no one-off styles or ad-hoc colors, and Storybook stories for
the meaningful states.

If a needed component genuinely does not exist, extend the design system
following its own conventions rather than inventing a local one, and report the
addition so it lands in the PR description.

Reviewer checklist (both tiers): **a user-visible change updates its guide page(s)
in `docs/user-guide/{bn,en}` (bn and en), or the PR body has
`User guide: not affected — <reason>`; `yarn guide:check` and `yarn guide:impact`
pass.** A miss is a finding.

Consistency is checked in the review pass (step 5's second reviewer), not by a
human gate before the work starts.

## GATE 1 — user approves the plan

Every plan is published by now (or, for a plan-grade epic, every body's
`## Files` has been read), so this gate reviews a partition built on real
file lists rather than a guess. Before spawning any implementation worker,
print and stop for approval:

- waves and groups, with each group's ticket queue, tier per ticket, and
  territory line
- the serialized hot-path lane, if any
- every blocker found up front, with its options and the recommended one
- how many agents will run and roughly what that costs
- the permission check below

Do not spawn on assumed approval (`--recommended` is the approval given up
front).

### Permission check — an unattended run dies on one prompt

A single permission prompt blocks the run until a human answers. Before GATE
1, read `permissions` from `.claude/settings.json`,
`.claude/settings.local.json` and `~/.claude/settings.json`. The run needs,
without prompting: Edit/Write, and Bash for `git`, `gh`, `yarn`, `node`,
`npx`, `curl`, `graphify`, `rtk`.

If `defaultMode` isn't `auto` / `bypassPermissions` and the `allow` list
doesn't cover those, print the exact missing rules at GATE 1, e.g.
`"Bash(gh:*)"`, and suggest the user switch to auto mode or add them. **Never
edit permission settings yourself** — that is the user's trust boundary.
Carry on either way; a prompt is a pause, not a failure.

## Step 4 — Write the state file

`.implement-epic-state.md` at the repo root. `.git/info/exclude` is per-clone,
so add the rule before the first write rather than assuming it exists —
otherwise a later `git add -A` in a fresh clone stages the state file into
someone's PR:

```bash
grep -qxF '.implement-epic-state.md' .git/info/exclude \
  || echo '.implement-epic-state.md' >> .git/info/exclude
```

Each worktree has its own exclude file; the workers inherit this one only if
they were created from a clone that already has it, so re-run the same
idempotent line in any worktree that writes state.

The file:

```markdown
# Epic 364 — UX & Interaction Layer
Base: main   Groups: 3   Started: 2026-08-29T11:02Z

## Wave 1
### w1-g1 — ui/ shell components
Branch chain: epic/8.14/w1-g1-01-sidebar → epic/8.14/w1-g1-02-header
- 365 sidebar        tier: standard  status: done      plan: <url>  files: 12
- 366 header         tier: standard  status: in-progress — implementing
- 367 mobile nav     tier: standard  status: pending
### w1-g2 — router + query layer
- 369 transitions    tier: money     status: blocked — plan wrong, re-planning

## Integration
Branch: epic/8.14/integration   status: not started
## PRs
(none yet)
## Decisions
## Skipped
## Outages
```

Update after **every** completed ticket and every state change, not once per
group. This plus `git log` is how a fresh session reconstructs position after
compaction or a usage limit.

## Step 5 — Run the groups

Spawn one `epic-group-worker` subagent per group in the current wave, **in a
single message so they run concurrently**, each with
`isolation: "worktree"`.

Worktree isolation is not optional. Parallel agents sharing one working tree
will `git checkout` over each other within seconds.

Give each agent: its ticket queue in order, its base branch, its branch-name
prefix, its territory line, the file cap, whether the epic is **plan-grade**,
and each ticket's **review tier** (computed at step 2, in the state file).
For a non-plan-grade epic every ticket already has a published plan from
step 2, so the worker's planning step is a lookup. For a plan-grade epic the
worker pre-flights each ticket at implementation time against its chain head
(standard tier inside the implementer, money tier as a separate agent) and
only escalates to the planner on `needs-planner`. Its definition
(`.claude/agents/epic-group-worker.md`) carries the rest of the contract.

### What group agents do NOT do — and why

These three overrides deviate from `implement-issue` deliberately. Anyone
"fixing" them back reintroduces the failure they prevent.

1. **No `gh pr create`.** N agents opening PRs concurrently is still worth
   avoiding — it makes merge order and CodeRabbit's per-PR context harder to
   reason about, not because of pacing (PRs now open back-to-back with no
   wait) but because the orchestrator is the one place that knows the actual
   dependency/merge order. Agents push branches and report ready; the
   orchestrator opens PRs serially, one after another, in step 6.
2. **No regenerating committed generated artifacts** (`schema.d.ts`,
   `routeTree.gen.ts`) — **but only while a wave actually has more than one
   lane.** The reason is conflict, not hygiene: two branches regenerating the
   same committed artifact conflict on every merge. So when a wave runs two or
   more lanes, they leave the artifact alone and it is regenerated once, at
   integration; if a ticket's tests need current types, generate them locally
   and leave them unstaged.

   **When a wave has exactly ONE lane, invert this: the ticket regenerates its
   own artifacts in its own PR.** There is no second branch to conflict with,
   and the artifact is stale *because of that ticket's own change* — a DTO,
   controller or route it moved. Deferring it to a later ticket does not defer
   the breakage: `ui/scripts/check-api-types.mjs` compares `schema.d.ts`
   byte-for-byte against a fresh generation and fails the "Integration & e2e
   tests" job on the PR that moved the surface, not on the one that was
   supposed to regenerate later. Epic 33's wave 1 (#889 / PR #895) failed
   exactly this way: the orchestrator applied the multi-lane rule to a
   single-lane wave and sent a red PR for a DTO addition.

   The test is "could another branch in this wave touch this file?", not "is
   this file generated?". If the answer is no, regenerate it here. Use the
   repo's own script (`yarn workspace @biddaloy/ui api:types`) — never a hand
   edit, since the check is byte-exact — and stop and report if regeneration
   sweeps in unrelated drift that was already sitting on `main`, rather than
   letting someone else's change ride in on the ticket's diff.

   **Nothing local runs that check.** `.husky/pre-push` runs `check.mjs
   --affected` (typecheck, lint, tests) and never `check-api-types.mjs`; it
   exists only as a CI step. Any ticket that touches a DTO, controller or
   route must run `node ui/scripts/check-api-types.mjs` by hand before
   pushing — Epic 33 paid two red CI rounds learning that a clean pre-push
   hook proves nothing about the schema.
3. **No merging to `main`,** ever.

`graphify update .` is the opposite case: **run it freely.** `graphify-out/` is
gitignored as of 2026-08-29, so a fresh graph costs nothing but keeps every
subsequent research query accurate. Each worktree keeps its own.

### File cap — checked before, not after

A branch cannot be split by file count after its commits exist without
rewriting history. So the check runs **before each ticket starts**:

```
if files_changed_on_branch + planned_files_for_next_ticket > 50:
    cut the chain here — the next ticket starts a new branch from this one
```

Soft cap **50**, hard ceiling **90** — never crossed. Generated artifacts don't
count, since they're regenerated at integration. A cut extends the chain
(`…-02-…` follows `…-01-…`); it does not start a new group.

### Branch naming

```
epic/<epic-slug>/w<wave>-g<group>-<seq>-<slug>
epic/8.14/w1-g2-03-header-usermenu
```

Lexical sort equals safe merge order. That is bookkeeping on top of
disjointness, not a substitute for it.

### Topology

- **Within a group:** ticket N+1 branches from ticket N's branch. Stacked PRs,
  each targeting its parent, retargeted when the parent merges.
- **Across groups:** each group's chain roots at `main`, and the chain's head
  PR targets `main` directly. This is only safe because groups are
  file-disjoint — which is why step 2's partition is the load-bearing step.

Never stack a branch on another group's branch and then PR it to `main`. That
carries the parent's commits into the diff and is exactly the duplicate-commit
failure this repo hit across the 8.7.x PRs.

### Failure isolation

A failed ticket blocks only the tickets that depend on it. Mark it `blocked`
with the reason and skip it plus its dependents (see
[Blockers](#blockers--found-up-front-not-mid-run)). The worker carries on
with the rest of its queue from its last committed ticket, and you retry the
failed ticket later in the run (see
[What happens to a failed ticket's code](#what-happens-to-a-failed-tickets-code)). One bad ticket
never stalls the fleet, and never silently disappears. Give each worker the
list of which tickets in its queue depend on which, so it can skip correctly.

## Step 6 — Integration

Every group green in isolation does not mean the union is green. Before any PR:

```bash
git checkout -b epic/<slug>/integration main
# merge every group head, in wave then group order
# regenerate schema.d.ts / routeTree.gen.ts if endpoints, DTOs or routes moved
yarn ci:local
```

This is the first full-suite run — per-ticket work only ran the tests
touched by that ticket, so this is where cross-lane breakage first surfaces.
Red integration is fixed **now**, before PRs exist — never at merge time: for
each failure, plan the fix (what broke and why, which chain owns it), then
apply it.

### Everything fixed here must reach the PR heads

The integration branch is throwaway; the PRs come from the group chains. So a
fix made *only* on the integration branch is tested and then thrown away, and
`main` receives the untested version. Nothing in the merge order catches this,
because each chain merges green on its own.

For every change made during integration:

1. Apply it to the **chain that owns the file** — the same territory rule the
   workers followed. Cherry-pick it onto that chain's head, or make it there
   and re-merge.
2. Regenerated artifacts (`schema.d.ts`, `routeTree.gen.ts`) go as their own
   commit on the chain that changed the endpoints, DTOs or routes behind them —
   not on whichever chain happens to be last.
3. Re-merge the updated heads into the integration branch and re-run
   `yarn ci:local`.

Then verify the transfer landed rather than assuming it: the integration tree
and the merge of the PR heads must be identical.

```bash
git diff --stat epic/<slug>/integration <last-merged-head>   # expect: empty
```

A non-empty diff means something green exists only on the integration branch.
Find it and move it before opening any PR.

## GATE 2 — integration green

Report the integration result for this wave, the full branch/PR table, total
files changed per chain, and the accumulating branch's running file count
against `main`. This gate happens **every wave**, whether or not a PR is
about to open — GATE 3 is the separate, PR-specific approval that only fires
when the file count forces one open. Stop for approval before opening any
PR — a PR is outward-facing and hard to unpublish. (`--recommended` is that
approval given up front: report, then keep going.)

## Step 7 — Open the PRs

The orchestrator opens them, never the agents.

### Default to one PR per epic — consolidate, don't fragment

**Try to ship the whole epic as a single PR to `main`.** Once a wave's chains
are integration-green, merge them into one accumulating branch rather than
opening a separate PR per chain — carry that branch forward wave after wave,
so by the time the epic is done there is (ideally) exactly one PR containing
everything, which is far easier for both CodeRabbit and a human reviewer than
a scattered stack of small ones.

The only thing that forces a split is the 100-file cap below. Check the
running file count against `main` after every wave merges into the
accumulating branch:

```bash
git diff --name-only main...<accumulating-branch> | wc -l
```

- **Still ≤ 100:** keep going — merge the next wave into the same branch, do
  not open a PR yet.
- **Would cross 100 once the next wave lands:** open a PR for what's
  accumulated so far (this closes out PR N), then start a **new** accumulating
  branch rooted on **PR N's head branch** for the next wave onward. Once a PR
  is open, treat it as closed to new waves. The new branch becomes PR N+1,
  with **base = PR N's branch, not `main`** — the next wave needs the earlier
  waves' code, and `main` doesn't have it until the user merges. Repeat.

```mermaid
flowchart LR
    M[main] --> P1["PR 1 · waves 1–2\nbase: main"]
    P1 --> P2["PR 2 · waves 3–4\nbase: PR 1's branch"]
    P2 --> P3["PR 3 · wave 5\nbase: PR 2's branch"]
```

Stacked-PR rules (each one has already cost this repo time):

- **CodeRabbit only reviews PRs whose base is `main`.** PR 2+ show "Review
  skipped" until retargeted — the Opus review in step 8 covers them.
- **A fix pushed to PR N's branch must reach every PR above it.** Rebase the
  upper branches with `git rebase --onto`, push them with
  `--force-with-lease`, and keep every branch linear — the user
  rebase-merges, and `--no-ff` merge commits block that.
- **The user may merge a PR at any time.** `git fetch` and re-check the
  remote tip before every push.
- After PR N merges to `main`: retarget PR N+1 to `main`, rebase it onto the
  new `main`, push. CodeRabbit then reviews it; fold its findings into a
  step-8 round.

**PR size: under 100 files, aiming for 80–90.** Do not cut a PR early. Keep
merging waves into the accumulating branch until the next wave would push it
past 99 files; cut there, so each PR lands in the 80–99 range. Only the **last**
PR of the epic may be smaller. If a wave boundary leaves the branch under 80
and the next wave would cross 99, cut at the commit boundary inside that wave
that lands closest to 90.

So in the common case a small-to-medium epic ships as **one** PR opened after
the final wave. A large epic ships as **two or three**, each as large as the
100-file cap allows, opened only when the cap would otherwise be breached —
not one per wave and not one per chain. Record each PR's wave/chain coverage
in the state file so `resume` knows which accumulating branch is still open
for additions.

This changes step 6's integration shape too: "the integration branch" is now
the same thing as "the accumulating PR branch" — there's no separate
throwaway integration branch discarded before PRs open. Build it once per
wave, verify green (GATE 2), keep accumulating, and only cut a PR out of it
when the file-count forces one.

### CodeRabbit's 100-file limit — checked before every merge into the
accumulating branch, and again immediately before every `gh pr create`

CodeRabbit does not review a PR that changes more than **100 files**; it posts
a summary and skips the line-by-line pass, which silently removes the review
the whole point of opening the PR was to get. The branch cap (soft 50 / hard
90) protects individual chains *before* the work, but three things can still
push the accumulating branch over 100 after that: multiple chains merging
into one branch, regenerated artifacts (`schema.d.ts`, `routeTree.gen.ts` —
excluded from the per-chain cap, counted by CodeRabbit), and integration fixes
cherry-picked onto chain heads. So count again immediately before each
`gh pr create`, against the branch the PR will actually target:

```bash
git diff --name-only <target>...<head> | wc -l     # must be ≤ 100, generated files included
```

If it exceeds 100, **do not open the PR.** Cut the accumulating branch at the
last wave boundary that keeps the count under the limit — open that as PR N,
then continue accumulating the rest on a fresh branch stacked on PR N's
branch, for PR N+1 (per the consolidation logic above). Within a single chain, if a chain alone
would exceed 100 (rare — the 50/90-file chain cap should prevent this), split
it at a commit boundary the same way: tickets are separate commits, cut a new
branch after the last one that keeps the count under the limit. Never trim
files to get under the number, and never rewrite history to merge commits.
Record every split in the state file.

Wave-close tasks are the usual single-chain offender (seed + regenerated
types + Playwright). If a close task alone would push its own chain over 100,
split it into "regenerated artifacts" and "everything else" as two commits at
minimum, cut at that boundary if needed.

- Consolidated-PR order, then within each PR: wave order, group order, chain
  order for how commits stack inside it.
- **No pacing wait between PRs.** Open them back-to-back as soon as each
  branch is ready — don't wait on the previous PR's CI or CodeRabbit pass
  before opening the next one. If CodeRabbit reviews a PR shallowly because
  it arrived close behind another, that's a `pr-fix`-round problem to catch
  in step 8, not a reason to sit idle in step 7.
- PR 1 targets `main`; each later PR targets the PR before it.
- **Title format:** `<epic number> <wave number> <issue numbers> <title>`, e.g.
  `44 w2 #3015 #3017 Wire remaining help ids`. A PR spanning waves writes the
  range (`w1-2`); a `[RED]` prefix, when it applies, goes in front. The issue
  numbers are exactly the ones this PR solves, the same set as its `Closes`
  lines.
- Each description: the issue, the approach, plan corrections the planner
  found, design-system additions, how to test, its position in the merge
  order, and these sections whenever they're non-empty:
  - **Decisions** — every `--recommended` call that landed in this PR
    (alarming plan drift first).
  - **Skipped tickets** — and what blocked them.
  - **Unresolved review findings** — anything a worker's review pass flagged
    and didn't fix within its 2 rounds, each with the issue filed for it.
  - **Issues filed** — every issue filed for a problem found during the run
    (see [Problems found along the way](#problems-found-along-the-way--fix-it-or-file-it)).
  - **Commits made with `--no-verify`** — and which hook failed.
- **The description must list every issue this PR completes**, one line per
  issue, in this pattern:

  ```
  Closes #<issue number> - <issue title>
  ```

  A consolidated PR covers many tickets — before opening it, walk the full
  list of tickets landing in this PR (every wave/chain merged into the
  accumulating branch) and confirm each has its own `Closes #N - <title>`
  line. Don't stop at the first one found; a missing line means that issue
  never auto-closes on merge.
- Record every PR number and timestamp in the state file as it opens.

## Step 8 — Review and CI

Every PR gets the same loop, right after it opens:

1. **Review (Opus 5.5).** Dispatch `Agent(model: "opus")` to run the
   `code-review` skill on the PR's full diff against its base, at high effort.
   It reviews the way CodeRabbit does: a short summary and walkthrough, then
   each finding with file:line, severity (critical / major / minor / nit), what
   is wrong, and the suggested fix. It does not fix anything. The same agent
   also runs the `coderabbit-review` skill (CodeRabbit CLI, `--agent
   --base <base>`) and merges those findings into the review. If the CLI can't
   review (rate-limited, no included reviews left, over the file limit, or
   `review_skipped`), the review says "CodeRabbit CLI: skipped (<reason>)" and
   goes on without it. No waiting, retrying, narrowing the scope to fit, or
   `--use-credits`.
2. **Post it on the PR** as a review comment, so it lives with the PR:

   ```bash
   gh pr review <n> --comment --body-file <review.md>
   ```

3. **Fix (Opus 5.5).** Dispatch `Agent(model: "opus")` with the review,
   any CodeRabbit comments, and every failing CI check
   (`gh pr checks <n>`). It addresses all of them in one round, then replies
   on the review saying what it fixed and what it left, with the reason.
4. Repeat from 1 for the next round — a fresh review of the new diff, plus
   CI.

Use the `pr-fix` skill's semantics rather than restating them — including its
**batch-then-verify** discipline (see that skill's Tests step): diagnose every
CI failure and every actionable CodeRabbit finding you currently know about
*before* fixing anything, apply all the fixes, run the full affected suite
**once**, then push once. **Cap: 3 rounds per PR.** A round is exactly one
diagnose-all → fix-all → verify-once → push cycle, not one push per
individual fix — pushing after each fix re-triggers the entire CI matrix (14+
jobs) and a fresh CodeRabbit pass for a single line change, which is the
single largest avoidable cost in this step. An uncapped loop can burn a whole
session on one stubborn PR.

**Still red after round 3?** Don't stop the run. Mark the PR red in its title
and move on to the next wave:

```bash
gh pr edit <n> --title "[RED] <original title>"   # title format: see Step 7
```

Add a PR comment listing what is still failing or unresolved, and note it in
the state file. Remove the `[RED] ` prefix if a later fix (e.g. one propagated
from a lower PR) turns it green.

The exception: a fix you're genuinely unsure about (touches locking,
concurrency, money-tier correctness, or anything CodeRabbit itself flagged as
subtle) is worth its own isolated commit and, if truly risky, its own
verification pass — bundling a risky fix in with four mechanical ones makes
it harder to attribute a regression to the right change, and gives it a
shallower review pass on the bundled diff. Batch the safe, obviously-correct
fixes; keep the one risky fix legible on its own.

Every fix round runs on Opus 5.5, whatever the tier. Common CI failures here:
Node 22 vs 24, the `bn` e2e locale, byte-exact `api-types`, the 80 % branch
gate.

If CI fails on something the epic didn't cause (a pre-existing flake — this
repo runs ~28% CI failure), diagnose the actual root cause rather than
re-running until it happens to pass: reproduce it in isolation a few times to
confirm it's genuinely pre-existing and unrelated to this PR's files, and fix
the root cause if it's cheap to do so (a genuine flake is often a real, if
minor, bug — e.g. code relying on an unordered SQL read for a required order —
not pure bad luck). Say explicitly which it was (root-caused and fixed, or
confirmed pre-existing and filed as an issue) instead of silently "fixing" unrelated
code to get green, and never silently re-run a red job without saying so.

## GATE 3 — merge

Present the ordered merge list and stop. **Merge only the PR(s) the user
explicitly approves, only when they explicitly say so — never on assumed or
standing approval, even if every prior PR in the same run was approved and
merged the same way.** Green CI is not approval. There is no auto-merge — no
flag, no condition, no exception. On approval for a given PR, merge it, then
rebase and retarget whatever was stacked on it.

### After any merge — mark done and close the issues

This runs for **every** merged PR of the run, whether you merged it or the
user merged it by hand on GitHub. The user tells you when they merged one by
hand — no polling. Confirm it before acting:

```bash
gh pr view <n> --json state,mergedAt,baseRefName --jq '"\(.state) \(.mergedAt) \(.baseRefName)"'
```

For each PR that is newly `MERGED` **into `main`**:

1. List its issues — every `Closes #N` line in its description (step 7).
2. Per issue: check every box under `## Acceptance` (`- [ ]` → `- [x]`), then

   ```bash
   gh issue close <N> --reason completed \
     --comment "Done — shipped in #<pr>, merged <YYYY-MM-DD>."
   ```

   The project board's default "Item closed" workflow then sets its status
   to **Done**. Close it even if GitHub's auto-close already did (`gh issue view <N>
   --json state` first; skip the close, still tick the boxes).
3. In the state file: mark the PR `merged <date>` and every ticket in it
   `done`.
4. If the epic now has no open sub-issues, close the epic issue the same way.
5. Remove the PR's worktrees **right away**, in the same turn — see
   [Then clean up](#then-clean-up--immediately-on-every-merge).

A stacked PR merged into its **parent branch** instead of `main` is not
shipped yet: copy its `Closes #N` lines into the parent PR's description, and
its issues close when the parent lands on `main`. Its worktrees still go
right away — its commits now live on the parent branch.

Do this per issue, not once per wave. A wave-close task gets no close (it
isn't a sub-issue); every ticket sub-issue that shipped does.

### Then clean up — immediately, on every merge

**The moment a PR is merged** — by you or by the user, into `main` or into a
parent branch — remove every worktree that belongs to it, in the same turn
you notice the merge. Not at epic close, not after the next wave: a worktree
whose cleanup is deferred is one whose cleanup never happens. This repo
reached 109 live worktrees before anyone noticed, and a worktree carries a
full `node_modules` — the cost is tens of GB and a measurably slower `git`
for every later command in every later session.

"Belongs to it" means every worktree whose branch is in that PR:

- the PR's head branch (the accumulating branch),
- every lane chain branch merged into it (its `epic-group-worker`
  worktrees, usually under `.claude/worktrees/agent-*`),
- any step-8 fix-round worktree for that PR.

Map branches to paths with `git worktree list --porcelain`; the state file
lists which branches each PR carries. If an agent is still running in one of
them, stop it first (`TaskStop`) — the PR is merged, its work is done.

For a split epic, retarget the PR above to its new base **before** deleting
the merged branch, or GitHub closes that PR along with the deleted base.

```bash
git worktree remove <path>        # refuses if the tree is dirty — good
git branch -d <branch>            # lowercase -d: refuses if unmerged — good
git worktree prune
```

Use plain `-d` and plain `remove`. Both refuse when work would be lost, and
that refusal is the safety check — it is the whole point. **Never reach for
`--force` or `-D` to make a refusal go away.** A refusal means the lane still
holds something `main` does not: read it, land it or report it, then remove.
The one exception: a worktree from a subagent that died before its first
commit (usage limit, crash) holds nothing — verify zero commits and zero
uncommitted files, then `--force` is honest.

Before removing, confirm the work is genuinely on `main` — ancestry alone lies
when a PR was squash-merged, so check patch-equivalence:

```bash
git status --porcelain            # must be empty
git cherry main <branch> | grep '^+'   # must be empty: no unique commits left
```

(For a PR merged into a parent branch, check against that branch instead of
`main`.) The user rebase-merges, which gives the commits new SHAs, so
`git branch -d` will often refuse even when `git cherry` is empty. Remove the
worktree anyway — that is the expensive part — and list the branch in the
report for the user to delete; don't `-D` it without their say-so.

At epic close, sweep: every branch and worktree the run created is gone, or is
listed in the final report with the reason it survived. Say which in the report
— "cleaned up" is a claim, so make it a checked one.

## Problems found along the way — fix it or file it

Any problem found during the run — a worker's "couldn't fix" report, an
unresolved review finding, a still-red check on a `[RED]` PR, a pre-existing
CI failure, a wrong claim in an issue body, a bug spotted next to the code —
gets exactly one of two outcomes:

1. **Fix it in this session and commit it.** On the chain or accumulating
   branch that owns the file, as its own commit, before the PR it belongs in
   opens (or as a step-8 round after).
2. **If that isn't possible** (outside the epic's scope, needs a product
   call, too big, blocked), **file a GitHub issue** with enough detail that
   someone with no context can act on it. Search first so you don't file a
   duplicate:

   ```bash
   gh issue list --state open --search "<key words>"
   gh issue create --title "<what is wrong, in one line>" --body-file <issue.md> \
     --label "<fitting label>" --milestone "<milestone>"
   gh project item-add 2 --owner tareq89 --url <issue-url>   # Biddaloy Development
   ```

   The body:

   ```markdown
   ## What's wrong
   <one paragraph; file:line>
   ## How it was found
   Epic #<epic>, ticket #<n>, PR #<pr>, branch <branch>
   <command + the output that shows it>
   ## Why it wasn't fixed in the epic
   <outside scope / needs a product call / too big / blocked by #N>
   ## Suggested fix
   <concrete steps, files to touch>
   ```

Link every filed issue from the PR description and the final report. Nothing
is left as "noted" only.

## Resuming

The state file on disk and the plan comments on GitHub are the sources of
truth; conversation context is expendable. On resume: read
`.implement-epic-state.md`, confirm against `git worktree list`, `git branch -a`
and `gh pr list`, then continue from the exact recorded position. Re-check the
session model and report it. Never re-plan a ticket that already has a current
`## Plan — <id>` comment.

## Rules that hold throughout

- Groups are disjoint or they are not groups. If two lanes need the same file,
  they are one lane.
- Never spawn a group agent without `isolation: "worktree"`.
- Never let a group agent in a MULTI-LANE wave regenerate committed artifacts,
  open a PR, or merge
  to `main`.
- No pacing wait between opening PRs — open the next one as soon as its
  branch is ready. Don't sit idle; while one PR's CI/CodeRabbit runs, keep
  working the next ticket or PR.
- Never cross the 90-file hard ceiling on a single chain's branch.
- Default to one PR for the whole epic — keep merging wave heads into the same
  accumulating branch instead of opening a PR per wave or per chain. Only cut
  a PR when the accumulating branch's diff against `main` would otherwise
  exceed 100 files; then start a fresh accumulating branch stacked on that
  PR's branch, right away — PR N+1 targets PR N, not `main`.
- Never open a PR whose diff against its target is 100+ files (aim 80–99; only the last PR may be smaller), generated
  files included — cut the accumulating branch at the last wave boundary that
  stays under the limit instead.
- Never open PRs before that wave's integration is green.
- Never pass a gate on assumed approval — this applies with special force to
  GATE 3: never merge a PR without the user's explicit go-ahead **for that
  specific PR**, every time, no matter how routine or how green its CI is.
  A prior approval to merge one PR is not standing approval for the next one.
  `--recommended` pre-approves GATE 1 / GATE 2 only, never GATE 3. Auto-merge
  does not exist.
- After any PR of the run merges to `main` — by you, or by the user who then
  tells you — tick its issues' acceptance boxes and close them.
- A PR still red after 3 fix rounds gets `[RED]` in its title; the run moves
  on. A blocked ticket is skipped with its dependents; the run moves on.
- If a commit or push fails on a git hook, retry with `--no-verify` and
  record it for the PR description. Integration's `yarn ci:local` still runs
  the full checks.
- After any PR of the run merges — anywhere, by anyone — remove its
  worktrees in that same turn.
- Never start Docker containers — no `docker compose up`, `docker run`, or
  a compose file of your own — not in a lane, not at integration. Anything
  that needs Postgres, Redis or S3 runs through `yarn test-env run -- <cmd>`
  (or `up` … `down` for several steps), which takes a per-worktree database,
  Redis slot block and bucket on the one shared `biddaloy` stack and removes
  them afterwards (README "Test infrastructure"). `yarn ci:local` already
  does this. Run `yarn test-env sweep` when the run ends or is stopped.
- A network outage is a wait, not a failure — for tool calls and LLM calls
  alike: probe GitHub + the LLM API every 5 minutes, then resume the failed
  command or agent. Keep the 5-minute resume cron alive while working; delete
  it at every stop for the user.
- Never let a ticket proceed to commit/integration on an **alarming** plan-drift
  verdict from `issue-reviewer` without surfacing it to the user first — an
  alarming verdict means the diff may not be what was actually approved at
  plan time, which is a different question from whether the code is correct.
  Under `--recommended`, decide it per Recommended mode instead, and list it
  first in that PR's "Decisions" section so the user sees it.
- Never bypass the design system: existing components and tokens first,
  extend it by its own conventions if something is genuinely missing.
- Never re-plan a ticket that already has a current plan comment.
- Never dispatch `issue-planner` for a plan-grade ticket unless
  `issue-preflight` or the implementer's self-pre-flight returned
  `needs-planner`.
- Never dispatch `issue-preflight` for a standard-tier ticket, and never
  self-pre-flight a money-tier one.
- Never run the Opus reviewer on a standard-tier ticket, and never run the
  Sonnet reviewer on a money-tier one — the tier is on the `## Plan` comment.
- Every problem found during the run is either fixed and committed in this
  session, or filed as a detailed GitHub issue. Never just "noted".
- Update the state file after every ticket and every state change.

## Report at the end

```markdown
| Wave | Group | Ticket | Branch | Files | PR | Target | Opened |
|---|---|---|---|---|---|---|---|
```

Plus, in plain sentences: what merged, what is still open and why, tickets
skipped and what blocked them, PRs marked `[RED]` and what is still failing,
every `--recommended` decision, commits made with `--no-verify`, unresolved
review findings, issues filed during the run, design-system additions made,
and any CI failure judged pre-existing rather than caused by this epic.
