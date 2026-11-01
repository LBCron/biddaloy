# SchoolManager

A school management system. Multi-tenant. NestJS backend + React/Vite SPAs.

## Architecture reference

Before planning or implementing any new feature, read
[`docs/architecture/README.md`](docs/architecture/README.md) — it's a small
index into modular docs covering the domain model, auth/multi-tenancy,
backend modules, the fees/payments/invoices flow, communications, frontend
architecture, and deployment. Read only the specific doc relevant to the
task, not the whole set.

Package-specific conventions live in that package's own `CLAUDE.md` (e.g.
`server/CLAUDE.md` for NestJS testing standards) rather than here.

## Issue rule (always, for every issue you create)

Every issue created, by hand or by a skill, goes in the **Biddaloy Development**
project (`gh project item-add 2 --owner tareq89 --url <issue-url>`) and carries
at least one fitting label and one milestone (`Product — before first release`,
`SaaS launch readiness — before first paying school` or `After first release`).
Pass `--label` and `--milestone` to `gh issue create`; never leave an issue bare.
Issues about AI work use the `AI Integration` project instead, with its milestone.

## Seed data rule (always, for any change that touches the database)

Any epic, ticket or bug fix that adds or changes a table or column also
updates the **demo seed** (`server/src/scripts/demo-seed/`), so the feature has
realistic data in the demo school. A CI coverage guard enforces it once
Epic 58 (#1732) Wave 1 lands. Before that, record the gap as
[`docs/architecture/22-demo-seed.md`](docs/architecture/22-demo-seed.md)
says. Follow that doc's safety rules: no literal dates, fresh DB only,
`ctx.rng` only, real services for "today", no real contacts. The dev seed
(`yarn seed`) stays e2e-only.

## User guide rule (always, for any change a user can see)

A new or changed feature updates its guide page(s) in `docs/user-guide/{bn,en}`
(both languages) per [`docs/architecture/39-user-guide.md`](docs/architecture/39-user-guide.md)
(Recipe R1). A removed feature removes its page and its coverage entry.

- CI `guide:impact` fails a PR that touches a page's sources or labels without
  updating the bn and en page, unless the PR body carries the line
  `User guide: not affected — <reason>`.
- Field help text lives in i18n `help.*` keys, not in the guide page.
- Media regenerates through `yarn guide:shoot`; videos are out of scope (Epic 42 D48).

## Security rules (always)

Any change to auth, routes, uploads, SQL, logs or infra follows these. The full
text, the reason and the enforcing test live in
[`08-security.md` → Security rules](docs/architecture/08-security.md#security-rules).

- **Routes are closed by default.** Every route declares `@RequirePermissions(...)`, or `@AuthenticatedOnly()` plus an `IDENTITY_SCOPED` reason (D14). → [08-security §Rules 1](docs/architecture/08-security.md#rule-1-routes-are-closed-by-default)
- **Teacher reads are scoped.** Only assigned sections, via `TeacherScopeService`; outside is 404, no assignment is an empty list (D2). → [08-security §Rules 2](docs/architecture/08-security.md#rule-2-teacher-reads-are-scoped-to-assigned-sections)
- **UUID params use `ParseUUIDPipe`.** A non-UUID `:id` is a 400, never a 500 (75.13). → [08-security §Rules 3](docs/architecture/08-security.md#rule-3-every-id-path-param-goes-through-parseuuidpipe)
- **No string-built SQL.** No `${}` in a query; LIKE input goes through `normalizeSearchTerm` (75.15). → [08-security §Rules 4](docs/architecture/08-security.md#rule-4-no-string-built-sql)
- **Limits and money are capped.** `limit` ≤ 100, money ≤ `MONEY_MAX` with 2 decimals; clients page (75.14). → [08-security §Rules 5](docs/architecture/08-security.md#rule-5-limit-is-capped-and-money-fields-are-bounded)
- **Uploads are checked by signature.** `matchesDeclaredType`, never the client mimetype; xlsx through `xlsx-guard` (75.8). → [08-security §Rules 6](docs/architecture/08-security.md#rule-6-uploads-are-checked-by-file-signature)
- **Outbound HTTP is guarded.** A user- or tenant-influenced URL goes only through `pinned-http.ts` after `assertSafeHttpDestination`; any other call is a fixed host on the reviewed `REVIEWED_OUTBOUND` list (75.24). → [08-security §Rules 7](docs/architecture/08-security.md#rule-7-outbound-http-goes-through-the-ssrf-guard-or-a-reviewed-fixed-host)
- **Cut sessions off.** Suspend, remove or reset bumps `users.tokens_valid_after` (D12). → [08-security §Rules 8](docs/architecture/08-security.md#rule-8-suspend-remove-or-reset-bumps-tokens_valid_after)
- **One bcrypt cost.** `hashPassword` / `verifyPassword` only, `BCRYPT_COST` 12, 72-byte limit (D5). → [08-security §Rules 9](docs/architecture/08-security.md#rule-9-one-bcrypt-cost-one-password-check)
- **Unsafe config never boots.** `assertProductionConfig`; JWT HS256 + `iss` + `aud`, `JWT_SECRET_PREVIOUS` for rotation (75.9, 75.10). → [08-security §Rules 10](docs/architecture/08-security.md#rule-10-boot-refuses-unsafe-config-and-jwts-are-pinned)
- **Client IP is `req.ip`.** Set by edge nginx (`EDGE_MODE`; tunnel mode trusts `CF-Connecting-IP` only from `EDGE_TRUSTED_CIDR`); never read `X-Forwarded-For` (75.4). → [08-security §Rules 11](docs/architecture/08-security.md#rule-11-client-ip-comes-only-from-reqip)
- **The origin is reachable only through the edge.** Unknown `Host` gets 444; tunnel mode publishes no web port, direct mode serves known hosts only, protected hosts carry two auth layers (D14, D17). → [08-security §Rules 12](docs/architecture/08-security.md#rule-12-the-origin-is-reachable-only-through-the-edge)
- **Logs carry no secrets.** nginx `redacted` format + `redactPii`; new secret URL shapes join it (75.23). → [08-security §Rules 13](docs/architecture/08-security.md#rule-13-logs-never-carry-secrets)
- **`/api/*` is `no-store`.** The SPA shell is `no-cache`; the service worker skips auth and public routes (75.20). → [08-security §Rules 14](docs/architecture/08-security.md#rule-14-api-responses-are-no-store)
- **Redis down is decided per route.** `@FailClosedWithoutRedis()` + `redis-outage-routes.ts`; platform alert on outage (D4, D15). → [08-security §Rules 15](docs/architecture/08-security.md#rule-15-redis-down-has-a-written-answer-per-route)
- **Share links expire.** 30 days, regenerate kills old links (D9, D22). → [08-security §Rules 16](docs/architecture/08-security.md#rule-16-public-share-links-expire)
- **Shared contact changes wait.** Pending until the person approves; a link never changes state on open (D3, D11, D23). → [08-security §Rules 17](docs/architecture/08-security.md#rule-17-a-shared-persons-new-contact-waits-for-their-approval)
- **Equal-time account answers.** One lookup on the request path, the rest in `detach()` (75.17). → [08-security §Rules 18](docs/architecture/08-security.md#rule-18-does-this-account-exist-answers-take-equal-time)
- **Webhooks are verified.** `verifyWebhookSignature` before anything else (75.30). → [08-security §Rules 19](docs/architecture/08-security.md#rule-19-inbound-webhooks-go-through-the-verification-kit)
- **Reachability changes update the snapshot.** `route-status.snapshot.txt` in the same PR, each line explained (D21). → [08-security §Rules 20](docs/architecture/08-security.md#rule-20-a-reachability-change-updates-the-route-snapshot)
- **Pin CI and images.** Actions by SHA, images by `@sha256:`, audit allowlist with `recheckBy` (75.25, 75.26). → [08-security §Rules 21](docs/architecture/08-security.md#rule-21-ci-actions-and-images-are-pinned)
- **Public write forms carry Turnstile.** `TurnstileService` before any write; fails closed in production (75.16). → [08-security §Rules 22](docs/architecture/08-security.md#rule-22-public-write-forms-carry-turnstile)
- **Errors never echo input.** Within one operation, every failure path uses the same text, and no message echoes the submitted value (75.19). → [08-security §Rules 23](docs/architecture/08-security.md#rule-23-errors-never-echo-what-was-sent)
- **Known errors map in one place.** DB and parser failures become fixed 4xx sentences in `known-errors.ts`, never the raw text (2642). → [08-security §Rules 24](docs/architecture/08-security.md#rule-24-errors-are-mapped-in-one-place-and-never-echo-input)
- **Writes never auto-retry.** UI mutations are `retry: false`; send and create routes carry an `Idempotency-Key` (2642). → [08-security §Rules 25](docs/architecture/08-security.md#rule-25-writes-never-auto-retry-and-sending-and-billing-routes-carry-an-idempotency-key)
- **Money compares in whole paisa.** `toPaisa()`, no tolerance, DB CHECKs behind it (2642). → [08-security §Rules 26](docs/architecture/08-security.md#rule-26-money-is-compared-in-whole-paisa-with-db-checks-behind-it)
- **Guard parent deletes.** No `remove()` while a child row exists; new FKs join the delete-guard registry (2642). → [08-security §Rules 27](docs/architecture/08-security.md#rule-27-a-parent-row-cannot-be-deleted-while-a-child-row-references-it)

## Documentation style (always, for any doc in this repo)

Any time you write or edit documentation — root or package `README.md`,
`docs/architecture/*`, `CONTRIBUTING.md`, code comments meant to teach,
anything a human or another agent will read to understand the system —
it must be **dead simple to understand**:

- Prefer a diagram (Mermaid: `flowchart`, `sequenceDiagram`, `erDiagram`)
  over a paragraph whenever you're describing a flow, a relationship
  between things, or "what talks to what." If you catch yourself writing
  three or more sentences to describe a shape, draw it instead.
- Include a concrete example (a real request/response, a real file path, a
  real value) wherever the abstract description alone would leave the
  reader guessing what it looks like in practice.
- Write for someone who is not already an expert in this codebase. Define
  jargon on first use or don't use it. Short sentences over long ones.
- This does not mean dumbing down _accuracy_ — keep the technical rigor
  and the honest "why," including deviations from any prior plan — it
  means presenting it as plainly and visually as possible.

## RTK (Rust Token Killer)

Use `rtk` for shell commands whenever possible to reduce command-output tokens.

**Golden rule:** Prefix commands with `rtk`. If RTK has no dedicated filter,
it passes the command through unchanged.

```bash
rtk git status
rtk git diff
rtk vitest
rtk tsc
```

This also applies to command chains:

```bash
rtk git add . && rtk git commit -m "msg"
```

When unsure which RTK command or syntax to use, **look up the available
command and examples from RTK itself** rather than relying on a hardcoded
command list:

```bash
rtk --help
rtk <command> --help
```

Prefer the RTK equivalent for Git, tests, builds, linting, TypeScript,
package managers, file/search operations, Docker/Kubernetes, and other
supported commands.

Use `rtk proxy <cmd>` when raw/unfiltered output is specifically required.

## Additional token optimization practices

Beyond RTK, apply these techniques to keep every interaction lean.

### Navigation & file reading

- Prefer the `serena` MCP tools (`find_symbol`, `find_referencing_symbols`,
  `get_symbols_overview`, etc.) over `Read`/`Grep`/`Bash` for code search —
  they return targeted symbol matches instead of whole files.
- When `serena` isn't applicable, use `rg --files` or `git ls-files` instead
  of `find` or `ls -R`.
- Always filter JSON/API output with `jq` before showing it to the AI:

  ```bash
  curl -s api/endpoint | jq '.items[] | {id, name}'
  ```

### Command flags for less noise

- Use `--quiet`, `--no-color`, `--porcelain`, `--unified=0`, `-l`, etc. on
  every CLI tool when supported.
- For Git: `git diff --stat`, `git diff --unified=0`, `git status --porcelain`.
- For logs: `--fail-fast` and show only the first error.

### Batching commands

Combine independent commands into a single line to reduce round-trips:

```bash
rtk git status --porcelain && rtk git diff --stat
```

### AI response format

When summarising or explaining, prefer:

- Bullet points (≤5) instead of paragraphs.
- One-line summaries for each step.
- Output as JSON (e.g., `{file, line, message}`) when appropriate.

## Model & effort routing

Model choice and effort level set the price of every token, not just their
count — get these right before reaching for RTK/headroom/caveman to shave
output size.

- **Default to `/effort low`.** Escalate only for planning/architecture
  decisions or a task that's actually hard. Effort is session-wide and
  multiplies cost on every turn, so leaving it high by default taxes routine
  edits and fixes that never needed it.
- **Route by phase, not by session.** When a task splits into a
  cheap-to-get-wrong step (planning, architecture) and an
  expensive-to-get-wrong step (execution), pin each to its own model via a
  subagent (see `.claude/agents/`) instead of running the whole thing on
  whatever the session happens to be on. `implement-issue` /
  `implement-epic` are the reference implementation of this pattern.
- **Batch independent tool calls into one message.** This is the dominant
  cost term — bigger than prompt size. Every round trip re-reads the entire
  fixed context floor below, so two serial calls cost twice that floor while
  two batched calls cost it once.
- **Delegate exploration only when it's genuinely heavy.** A subagent pays
  the same ~50k floor the parent does, so a one-file lookup costs more
  delegated than done inline. Delegate when the dig would otherwise leave
  many intermediate reads in the parent's context for every later turn.
- **Prefer one warm session over frequent restarts.** Each new session
  re-writes the ~~53k prefix to cache (~~$0.21 at 1h TTL) before doing any
  work; a warm cache measured ~60% cheaper for identical context. Start
  fresh when the topic genuinely changes — not as a routine saving habit.

### Measured context floor (2026-09-03, this repo)

`claude -p "say ok" --output-format json`, total context for a trivial request:

| Config                      | Tokens |
| --------------------------- | ------ |
| Project + all 4 MCP servers | 52,949 |
| Project, MCP servers off    | 50,012 |
| Empty dir, no MCP           | 43,608 |

~43.6k is irreducible (Claude Code's system prompt, built-in tools, bundled
skills, user `CLAUDE.md`, memory). ~6.4k is project-level — this file, project
skills, graphify hook context. All four MCP servers together are only ~2.9k.

**This rules out skill/plugin trimming:** the skill listing is already capped
near 1% of context, so removing entries just redistributes that budget.
Disabling a whole plugin measured 52,948 vs 52,949 — no effect. Don't spend
effort there. Hooks are `command` type and cost latency, not tokens; the
exception is a hook that injects context (graphify's `hook-guard`), which
does add tokens to every matching tool call.

## Caveman Ultra

**MANDATORY: Use Caveman Ultra mode throughout every session in this project.**

At session start, activate:

```text
/caveman ultra
```

This governs conversational output only — code, tests, commit messages, PR
descriptions, and any plan or doc meant to be reviewed stay normal and
readable. When dispatching a subagent, tell it explicitly to run in
`/caveman ultra` too — subagents are separate contexts and don't inherit the
parent's mode unless told in the dispatch prompt.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
