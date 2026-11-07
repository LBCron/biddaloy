# School website (Epic 40)

Every school can have a public website at `<school>.<root domain>` (for example `bmsc-high.schoolmanagerp.com`),
or at its own domain. The school edits a **draft** in the admin app and **publishes** it. The public site shows only
the published copy.

Wave 1 (this page) covers the database, the by-host API, the `site/` container and the edge. The admin screens,
blog, enquiries, gallery and results come in later waves and add to this page.

## Request flow

```mermaid
flowchart LR
  V[Visitor browser] --> CF[Cloudflare]
  CF -->|"*.root, tunnel"| N["nginx :8081<br/>site.conf.template"]
  N -->|"30 s micro-cache"| S["site container (Astro SSR)<br/>site/"]
  S -->|"GET /api/v1/public/site/by-host/HOST/..."| API[NestJS API<br/>modules/website/public]
  API --> R[(Redis cache)]
  API --> P[(Postgres)]
  API --> O[(Object storage<br/>pictures)]
  N -->|"/media/*"| API
```

The site container is anonymous: no cookie ever reaches it, and no tenant id is sent. The API reads the school from
the `Host` name only.

## Publish

```mermaid
sequenceDiagram
  participant A as Admin app
  participant API as /website API
  participant DB as school_sites
  participant R as Redis
  A->>API: PUT /website/draft { config, draft_revision }
  API->>DB: update where draft_revision = N (else 409 site.stale)
  A->>API: POST /website/publish { version, draft_revision } + Idempotency-Key
  API->>DB: published = draft, version + 1 (only if both numbers still match, else 409 site.stale)
  API->>R: delete the feed keys of this school
  Note over R: Content keys carry the version, so the old ones simply stop being read
```

Example body: `PUT /api/v1/website/draft` with `{"config": {...}, "draft_revision": 3}`. A save from a stale tab, or a
publish of a draft nobody on that screen has seen, answers 409 `site.stale`.

## Host to school

| Host the visitor typed                                       | Looked up in                                                              | Answer                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| `bmsc-high.<root>`                                           | `school_sites.subdomain`                                                  | The site                                      |
| `old-name.<root>` (renamed < 30 days)                        | `school_sites.previous_subdomain` until `previous_until`                  | 301 to the new subdomain                      |
| `www.myschool.edu.bd`                                        | `school_sites.custom_domain`, only when `custom_domain_status = 'ACTIVE'` | The site                                      |
| anything else, off site, nothing published, suspended school | n/a                                                                       | One identical 404 (`site.not_found`, Rule 23) |

Subdomains are 3 to 30 characters (`SITE_SUBDOMAIN_RE`); `RESERVED_SUBDOMAINS` in `shared` lists the names no school
may take (`app`, `demo`, `site-test`, ...). On staging, `SITE_TEST_HOST` is an always-on custom domain for the demo
school.

## Cache

| What                         | Key                               | TTL   | Cleared by                                     |
| ---------------------------- | --------------------------------- | ----- | ---------------------------------------------- |
| Manifest and pages (Redis)   | `site:<tenant>:<version>:<kind>`  | 24 h  | A publish (new `version`, old keys never read) |
| Notice feed (Redis)          | `site:<tenant>:feed:notices`      | 60 s  | TTL, or publish / switch on-off                |
| Pages (nginx `site_cache`)   | `$host$request_uri`               | 30 s  | TTL; `?preview=` is never stored               |
| Pictures (nginx and browser) | `/media/<id>` (the id is the key) | 1 day | Nothing: a new picture gets a new id (D41)     |

## When something is down

| What is down          | What the visitor gets                                                                             | Why                     |
| --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| Redis                 | The page, built from Postgres. One error log per minute.                                          | D32, D42: never a 500   |
| API or site container | nginx serves the last good page, even an expired one; if none is cached, `maintenance.html` (503) | `proxy_cache_use_stale` |
| Postgres              | Same as API down for uncached pages; cached pages still show                                      | D32                     |
| Object storage        | The page; the picture answers the one 404 and the site shows no picture                           | Rules 23, 24            |

## File map

| Path                                                   | What lives there                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `server/src/modules/website/`                          | Entities, admin `/website` API, public by-host API, Redis cache      |
| `server/src/migrations/1791900003400-SchoolWebsite.ts` | The five tables; drops the unused `schools.domain`                   |
| `site-themes/`                                         | Theme manifests (palettes, fonts, sections) and `validateSiteConfig` |
| `site/`                                                | The Astro SSR site container, themes under `site/src/themes/`        |
| `nginx/templates/site.conf.template`                   | The `:8081` listener, micro-cache, `/media/` rule, maintenance page  |
| `server/src/modules/workbook/tabs/website/`            | Backup and restore tabs (four tables)                                |
| `server/src/scripts/demo-seed/slices/website.ts`       | The demo school's published site                                     |

## Backup and restore

`school_site`, `site_posts`, `site_enquiries` and `staff_web_profiles` are workbook tabs. Pictures (`site_media`) are
files in storage, not rows: a restored post or staff card loses its picture link, and a restored config that points at
a picture id keeps the id, which answers 404 until the school uploads it again. A restore never changes the school's
subdomain or custom domain, and only moves `version` / `draft_revision` forward.

## Custom domain and analytics (40.4.08)

```mermaid
stateDiagram-v2
  [*] --> PENDING_DNS: PUT website/custom-domain
  PENDING_DNS --> PENDING_SSL: Cloudflare confirms ownership TXT
  PENDING_SSL --> ACTIVE: certificate issued
  PENDING_DNS --> FAILED: 7 days without progress
  PENDING_SSL --> FAILED: 7 days without progress
  ACTIVE --> [*]: DELETE website/custom-domain
```

A BullMQ job (`site-custom-domain`) asks Cloudflare every 10 minutes about each `PENDING_*` hostname. Only `ACTIVE`
resolves in `SiteHostService`; every other host gets the one 404. Cloudflare unreachable changes nothing (D42).

Example: the school types `www.myschool.edu.bd`; the API answers 202 with two records to add at the registrar:

```text
CNAME  www.myschool.edu.bd                      -> sites.<SITE_ROOT_DOMAIN>
TXT    _cf-custom-hostname.www.myschool.edu.bd  -> <value from Cloudflare>
```

| Env                                 | Meaning                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `CF_SAAS_API_TOKEN` + `CF_ZONE_ID`  | Both or neither (boot refuses one). Neither = custom domains off, routes 409. |
| `CF_SAAS_FALLBACK_ORIGIN`           | Default `sites.<SITE_ROOT_DOMAIN>`.                                           |
| `UMAMI_API_URL` + `UMAMI_API_TOKEN` | Both set = first publish creates one Umami site. Unset = no analytics.        |

The server cannot see `EDGE_MODE` (it is an edge container variable), so "direct mode" means the operator leaves the
two Cloudflare values empty. Every refusal (off, malformed, platform name, taken by another school) is one 409
`site.custom_domain_unavailable`; Cloudflare down is 503 `site.custom_domain_try_later`.

## Learning

- **2026-11-07 (W4, 40.4.08).** Cloudflare for SaaS needs: a zone with the fallback origin proxied, a token scoped
  to "SSL and Certificates: Edit" only, and the school's CNAME plus the `_cf-custom-hostname` TXT. An apex needs the
  school's DNS to flatten CNAMEs (D23); otherwise the registrar forwards apex to `www`. Claiming the host in our own
  unique index before asking Cloudflare means two schools racing for one host never create two hostnames.

- **2026-11-07 (W1 close).** Surprise: the draft save and publish take `draft_revision`, not just `version`.
  Cost: tickets written against `{ config, version }` would have sent a body the API refuses. Fix: contract note
  posted on #3624. Rule candidate: a ticket that names an API body copies it from `schema.d.ts`, not from memory.
- **2026-11-07 (W1 close).** Surprise: Postgres `jsonb` stores keys in its own order. Cost: a restore preview showed
  `draft` as changed on an identical config. Fix: the `school_site` tab compares with sorted keys. Rule candidate: any
  tab that compares jsonb sorts keys first.
- **2026-11-07 (W1 close).** Surprise: `demo` and `site-test` are reserved subdomains, so the demo school cannot use
  its own short name. Cost: none, it uses `bmsc-high`. Rule candidate: seed code takes the subdomain from the school
  slug, never from the word "demo".
- **2026-11-07 (W2 close).** Surprise: the server lane (#3622) rejected the `logo` media slot while the wizard
  (#3625) uploaded to it. Cost: each lane's own tests were green; only regenerating `schema.d.ts` and running the
  typecheck exposed the mismatch. Fix: caught at W2 close. Rule candidate: regenerate `schema.d.ts` as soon as each
  server lane lands, so a client lane never builds on a stale contract.
- **2026-11-07 (W2 close).** Surprise: a client type was hand-typed (a `media.url` field) instead of taken from
  `schema.d.ts`; the admin media list has no picture URL. Cost: the wizard preview had to use the blob it just
  uploaded. Fix: preview from the uploaded blob. Rule candidate: client types for an API response come from the
  generated schema, never from memory of the ticket.
- **2026-11-07 (W2 close).** Surprise: a fresh worktree has no built `shared/dist` or `site-themes/dist`, and the
  symlinked main-checkout `node_modules/@biddaloy/*` points at main's stale packages. Cost: server build and
  migrations failed with missing exports until the packages were linked to the worktree and `yarn build:shared`
  and `yarn build:site-themes` ran. Rule candidate: an e2e run in a worktree links `@biddaloy/*` to its own
  packages and builds shared first.
- **2026-11-07 (W3).** Surprise: every wave so far had at least one hand-typed API shape that the server did not
  match (W2 `media.url`; W3 a post `excerpt`, a bare `string[]` of suggestions, enquiry `status`, teacher `name`).
  Cost: one fix round per wave, found only after `schema.d.ts` was regenerated. Fix: client lanes now use generated
  types only. Rule candidate: regenerate `schema.d.ts` the moment a server lane lands, and brief client lanes from it.
- **2026-11-07 (W3).** Surprise: the logo is stored twice. The website screens upload to the `logo` site-media slot,
  the public site served `schools.logo_key`, so a new logo never showed. Cost: found by review, not by any test.
  Fix: `/media/logo` and the manifest prefer the newest site-media logo and fall back to the profile logo; the
  manifest cache key carries the logo row id because uploads do not bump `school_sites.version`. Rule candidate: when
  two places can hold one picture, name which one the public read uses before building the upload.
- **2026-11-07 (W3).** Surprise: one accumulating branch reached 141 files. Cost: it could not become a PR under
  the 100-file cap and could not be rewritten (no force push), so it was rebuilt as three stacked branches. Rule
  candidate: count files after every cherry-pick and cut at about 80, before the branch is pushed.
- **2026-11-07 (W3).** Surprise: a public query parameter (`?classSectionId=`) went straight into a Redis key.
  Cost: caught in review; anyone could have created unbounded keys. Fix: validate and check the school owns it
  before the cache is touched. Rule candidate: nothing a visitor sends becomes a cache key unchecked.
- **2026-11-07 (W3).** Surprise: ticking "Public" on a notice used to mean only "anyone with the link"; it now also
  lists the notice on the school website, and old public notices appear after the first publish. Fix: the field note
  and the guide say both. Rule candidate: renaming a flag's meaning needs the wording and the guide changed together.
- **2026-11-07 (W3).** Surprise: running the integration and e2e suites together on one machine produced only
  timeouts, with a different failing file each run, and every file passed alone. Cost: hours of reruns with no
  signal. Fix: gates run one section at a time in one agent. Rule candidate: record the load average with every gate.
