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
may take (`app`, `demo`, `site-test`, ...). Edge limit: the API can resolve an active custom domain, but the site listener (`:8081`) only accepts subdomains of `ROOT_DOMAIN`; any other host gets 444 until the custom-domain edge work (#3646) ships. Direct edge mode does not expose school sites at all.

On staging, `SITE_TEST_HOST` is an always-on custom domain for the demo
school.

## Cache

| What                         | Key                               | TTL                         | Cleared by                                     |
| ---------------------------- | --------------------------------- | --------------------------- | ---------------------------------------------- |
| Manifest and pages (Redis)   | `site:<tenant>:<version>:<kind>`  | 24 h                        | A publish (new `version`, old keys never read) |
| Notice feed (Redis)          | `site:<tenant>:feed:notices`      | 60 s                        | TTL, or publish / switch on-off                |
| Pages (nginx `site_cache`)   | `$host$request_uri`               | 30 s                        | TTL; `?preview=` is never stored               |
| Pictures (nginx and browser) | `/media/<id>` (the id is the key) | 1 day nginx, 1 year browser | Nothing: a new picture gets a new id (D41)     |

## When something is down

| What is down          | What the visitor gets                                                                                                                                    | Why                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Redis                 | The page, built from Postgres. One error log per minute.                                                                                                 | D32, D42: never a 500   |
| API or site container | nginx serves the last good page, even an expired one; if none is cached, `maintenance.html` (503, `Retry-After: 30`), also when the upstream answers 500 | `proxy_cache_use_stale` |
| Postgres              | Same as API down for uncached pages; cached pages still show                                                                                             | D32                     |
| Object storage        | The page; the picture answers the one 404 and the site shows no picture                                                                                  | Rules 23, 24            |

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
a picture id keeps the id, which answers 404 until the school uploads it again. `site_media` also has database rows, and the public API needs the matching row, so restoring files alone does not revive old ids. Recovery: upload the picture again in the admin (new id), point the draft at it, publish. A restore never changes the school's
subdomain or custom domain, and only moves `version` / `draft_revision` forward.

## Learning

- **2026-11-07 (W1 close).** Surprise: the draft save and publish take `draft_revision`, not just `version`.
  Cost: tickets written against `{ config, version }` would have sent a body the API refuses. Fix: contract note
  posted on #3624. Rule candidate: a ticket that names an API body copies it from `schema.d.ts`, not from memory.
- **2026-11-07 (W1 close).** Surprise: Postgres `jsonb` stores keys in its own order. Cost: a restore preview showed
  `draft` as changed on an identical config. Fix: the `school_site` tab compares with sorted keys. Rule candidate: any
  tab that compares jsonb sorts keys first.
- **2026-11-07 (W1 close).** Surprise: `demo` and `site-test` are reserved subdomains, so the demo school cannot use
  its own short name. Cost: none, it uses `bmsc-high`. Rule candidate: seed code takes the subdomain from the school
  slug, never from the word "demo".
