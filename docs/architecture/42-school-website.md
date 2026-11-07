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

## SEO

Each school host answers these itself. The site builds them from the by-host read model: no new server route.

```mermaid
flowchart LR
  V["Search engine or share card"] --> S["site (Astro SSR)"]
  S -->|"/sitemap.xml /robots.txt /feed.xml /llms.txt /og/home.png"| M{"Host resolved,<br/>not noindex, not preview?"}
  M -->|yes| OK["The file"]
  M -->|no| N["The same 404 body as an unknown host"]
```

| Endpoint            | Answer                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| `/sitemap.xml`      | Every enabled page that has a route, bn and en, each with `hreflang` alternates        |
| `/robots.txt`       | `Allow: /`, `Disallow: /?preview=` and the sitemap; `Disallow: /` when noindex/preview |
| `/feed.xml?lang=en` | RSS 2.0 of the blog; 404 when the blog page is switched off                            |
| `/llms.txt`         | A plain-text summary: name, page URLs, recent posts                                    |
| `/og/<page>.png`    | A 1200 x 630 card: palette colour, school name, page title                             |

Each page also carries one canonical, bn/en/`x-default` alternates, Open Graph and Twitter tags, and JSON-LD
(`EducationalOrganization`, `BreadcrumbList`, `NewsArticle` for a post).

- **Noindex.** `school_sites.noindex`, any preview (the `X-Site-Preview` header, a `/website/preview/<theme>/` path, a
  `?preview=<token>` draft) gives `robots: noindex`, no canonical, no JSON-LD and no sitemap, feed, llms or card.
  Only `robots.txt` answers in a header preview (`Disallow: /`).
- **Escaping.** JSON-LD is written with `<` escaped, so no value can close the script tag. XML drops characters XML 1.0
  cannot carry, then escapes the rest.
- **The card has no logo, on purpose.** Drawing it needs no fetch, so nothing a school typed can make the site call out
  (no SSRF), and the work stays small. Cards are cached in memory (200), for one hour.
- **Limit.** The sitemap and RSS list only the 12 newest posts, because the blog feed carries 12. A paged list feed
  would lift it.
- **Fonts.** The card is drawn with the system fonts of the container; the Alpine image has none for Bangla, so the
  card text can show empty boxes until the image installs one.

## Budgets in CI

| Job (workflow)                        | When                                         | What it checks                                                                                                                                 |
| ------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `site-budget` (`ci.yml`)              | When `site/**` or the website module changes | Demo school on the real API, built site, Lighthouse mobile (3G): performance, accessibility, SEO >= 0.9; layout shift <= 0.05; script <= 30 KB |
| `site-themes` (`nightly-quality.yml`) | Nightly                                      | Runs the site e2e, which rewrites `site/e2e/__screenshots__/<theme>/`; the changed files are listed and uploaded                               |

Config: `lighthouserc.site.cjs`. The preview URL is noindex by design, so it has no SEO budget. There is no results
page URL until Epic 70.

Reading a failure: open the `site-reports` artifact (kept 7 days) and the assertion name in the log. Raising a
threshold is a decision, never a CI fix. `site-themes` never fails on a picture diff (fonts differ a little between
runners): read the diff list in the job summary, and commit the new pictures if the change was meant.

## Gallery and video on the site

```mermaid
flowchart LR
  A[page/home feed: one album, max 12 photos] --> B[GalleryCarousel: 3:2 slides, dots, swipe]
  C[page/gallery feed: every album] --> D[GalleryGrid + viewer dialog]
  E[video section: 11-char YouTube id] --> F[poster + play button] -->|click| G[one sandboxed youtube-nocookie iframe]
```

- Photos are `/media/<mediaId>` (1200x800, 3:2). Captions are bilingual and optional; the image `alt` is the caption, else the album title.
- A gallery section with no photo, and a video section with no valid id, render nothing (D12). The gallery page is a 404 then, and absent from nav and sitemap.
- The carousel logic is one module, `site/src/lib/carousel.ts`, shared by the hero and the gallery. It auto-advances every 6 s, pauses on hover and focus, and never auto-advances under `prefers-reduced-motion`.
- The viewer is a native `<dialog>` (Esc closes, Tab stays inside, focus returns to the tile) with arrow keys and swipe. Script: `site/src/islands/gallery-viewer.ts`.
- Video is click-to-play: before the click the page has no iframe and makes no request to YouTube. The island re-checks the id with `^[A-Za-z0-9_-]{11}$` before building the URL.
- All seven themes register both sections and style them only through the `--gc-*` and `--ve-*` variables of `basic/theme.css`.

## Backup and restore

`school_site`, `site_posts`, `site_enquiries`, `staff_web_profiles` and `site_gallery_albums` are workbook tabs. Pictures (`site_media`) are
files in storage, not rows: a restored post or staff card loses its picture link, and a restored config that points at
a picture id keeps the id, which answers 404 until the school uploads it again. A restore never changes the school's
subdomain or custom domain, and only moves `version` / `draft_revision` forward.

```mermaid
flowchart LR
  A[site_gallery_albums: title + order] -->|tab, never deleted by a restore| R[restored: empty albums]
  P[site_gallery_photos] -.->|RESTRICT FK to site_media, a storage file| X[not in backup: exempt, with reason]
  M[site_media] -.-> X
```

- **Gallery.** Only the album folders are a tab (`site_gallery_albums`, key `sort_order`, `deleteByAbsence: false`: an
  album with photos is held by a RESTRICT foreign key, and one made after the backup must survive a restore). Photos
  point at `site_media`, a file in the storage backup, so they are in `ENTITY_COVERAGE_EXEMPT` with that reason. A restore
  can therefore never bring back a storage key or a photo without its file; the admin refills the empty albums.
- **Exam results on the website.** `exams.website_published_at` and `website_show_names` are explicit columns of the
  `exams` tab, so a restore puts back exactly the state that was exported (published stays published, off stays off).
  A restore never publishes an exam that was not published when the backup was taken.

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

**Custom hosts only once edge routes them (follow-up).** Today the edge nginx does not send an unknown `Host` to the
site container (Rule 12 answers 444), so an ACTIVE custom domain resolves in the API but a visitor cannot reach it
until a reviewed edge change lands.

Failure and release rules:

- A name is claimed in `school_sites.custom_domain` (unique) before Cloudflare is asked. A lost create answer is
  adopted by looking the hostname up; a claim with no Cloudflare id after 15 minutes is adopted or released.
- A host that FAILS (7 days stuck, or Cloudflare says blocked/moved/deleted) is deleted at Cloudflare and its name
  released, so another school can claim it. The status stays `FAILED` with no host so the school sees why.
- ACTIVE hosts are asked about once a day (inside the same 200 per tick cap).
- Replacing a domain creates the new hostname first, swaps the row, then deletes the old one. A refused replace
  leaves the live domain untouched.
- `PUT` and `DELETE` carry the route throttle plus an hourly per-school cap (20) in Redis, because one Cloudflare
  token serves every school. `PUT` fails closed if Redis is down; `DELETE` fails open.
- A publish that races a status change can answer `site.stale`; the admin screen reloads and retries.

### Not done / follow-ups

- Edge routing of custom hosts (the blocker above), its own reviewed ticket.
- Dangling-CNAME takeover: confirm in Cloudflare's docs whether it validates a CNAME that already points at the
  fallback origin without the ownership TXT.
- Deleting a school should delete its Cloudflare hostname (today only the DB row cascades).
- `Idempotency-Key` does not compare the request body: the same key with another host replays the first answer.
- The three new nullable columns are exempt from the demo seed (see `22-demo-seed.md`).

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

- **2026-11-07 (W4, themes).** Surprise: the mockups were not AA-clean. Cost: every theme needed a contrast pass.
  What changed from the mockups, per theme: Primary darkened its bright primaries; Premium's brass on oxblood failed as
  small text, so brass is for hairlines and large labels; College and Madrasa use their accent colour as decoration
  only, never for text; Premium's display fonts exist in one weight, so no theme asks for a bold the file lacks (fonts
  are one weight per file). Fix: per-theme tokens and the specs in `site-themes/src/*.spec.ts`. Rule candidate: a
  mockup colour is a starting point; run `contrast.mjs` on the real tokens before building on them.
- **2026-11-07 (W4, themes).** Surprise: Astro bundles the CSS of every theme into one page, so one theme's rules
  restyled another. Cost: Primary, High school, International and Premium leaked into each other until fixed. Fix: every
  theme's CSS sits under `.t-<theme>`, and the cross-theme spec in `site/e2e/themes/` guards it. Rule candidate: a new
  theme's selectors all start with its `.t-<theme>` class.
- **2026-11-07 (W4, themes).** Surprise: `--ink-3` failed AA in all themes, and no test noticed; review did. Cost: one
  fix round across seven themes. Fix: darkened per theme, and the per-theme specs now check it. Rule candidate: contrast
  is checked for every text token, not just body and heading.
- **2026-11-07 (W4, custom domain).** Surprise: Cloudflare for SaaS never routes a custom host through our edge, so
  Rule 12 ("the origin is reachable only through the edge") could not be proven for custom hosts here. Cost: the
  scope moved to #3655. Rule candidate: a rule that depends on a third party's routing gets its own ticket and a
  staging check.
- **2026-11-07 (W4, custom domain).** Surprise: a create call that times out after Cloudflare accepted it leaves an
  orphaned hostname. Cost: a hostname we do not know about. Fix: the claim row is written first and a retry looks the
  hostname up before creating one. Rule candidate: every create call to a provider is safe to repeat.
- **2026-11-07 (W4, custom domain).** Surprise: FAILED rows kept squatting their domain, so no other school could
  claim it. Cost: found while reading the unique index. Fix: a FAILED row releases the host. Rule candidate: a unique
  index over a state column says which states hold the value.
- **2026-11-07 (W4, custom domain).** Surprise: all schools share one Cloudflare token, so one busy school can
  throttle the others. Cost: none yet. Fix: none yet; keep the number of Cloudflare calls per school low. Rule candidate: a shared provider token is
  a shared quota; say so in the doc.
- **2026-11-07 (W4, SEO).** Surprise: the share card draws text with system fonts, and the Alpine image had none for
  Bangla. Cost: boxes instead of letters. Fix: the Dockerfile installs Bengali and Latin fonts. Also: the sitemap lists
  only 12 blog posts until the feed is paged. The Lighthouse preview URL is noindex by design, so indexability is
  asserted in a separate check. Lighthouse numbers: not measured locally; CI-only.
- **2026-11-07 (W4 close).** Surprise: lint-staged's ESLint run is gentler than CI's `cd ui && npx eslint .`. Cost: a
  rule error shows only in CI. Rule candidate: after touching `ui/`, run the full CI-style ESLint once.
- **2026-11-07 (W4 close).** Surprise: the gate's `--only integration,infra,e2e` never runs unit specs, so a red unit
  spec can pass the gate. Cost: a failing `*.spec.ts` shows only in CI's unit job. Rule candidate: run the touched unit
  specs by hand before the gate.
- **2026-11-07 (W4 close, #3648).** `e2e/website-themes.spec.ts` publishes in a school of its own, because
  `journeys/website-setup.spec.ts` needs the shared school to be never-published. It checks the public read API
  (`/public/site/by-host/<host>/manifest`), not `html[data-theme]`, since the e2e stack has no site container; pixel
  and theme render checks are in `site/e2e/themes/*.spec.ts`. The ticket text said "six themes"; the enum has seven.
- **2026-11-07 (W5, 40.5.01).** The public results table is not a new read model: it reads the same `results`,
  `result_subjects` and `students` rows as the staff panel, behind one gate (`exams.status = 'PUBLISHED'` AND
  `website_published_at` set, same school). Withdrawing an exam, or reopening it, hides it on the next request
  because the results feed is never cached (a page of student data must not outlive a withdrawal). A Turnstile
  token works once, so only the table call carries it; the per-subject call takes the unguessable result id from a
  table answer and is throttled the same.
- **2026-11-07 (W5 review fixes, 40.5.01).** Three limits guard the results table: Turnstile and 30/min per IP
  (Nest throttler) and 300/min per school (Redis counter). When Redis is down the per-IP and per-school limits are
  OFF (D42: fail open); Turnstile still stands. The per-subject call has no Turnstile (a token works once), so what
  protects it is a signed handle: `website-results.handle.ts` signs exam id, result id and a 30-minute expiry (HMAC,
  key `JWT_SECRET`, domain `site-result:`), and `detail` accepts nothing else, so a result id can never be guessed.
  The whole results surface (list and both POSTs) answers the one 404 unless the school's Results page is switched
  on (D12): the page is in every theme's manifest as a section-less `results` page, off by default
  (`ThemePage.enabledByDefault: false`); the admin switches it on in the Pages tab "Results page" card, which
  adds it to an older draft that lacks it (`setPageEnabled`), then publishes. Reopening an exam takes it off the website (clears `website_published_at`, bumps the site version).
  The results page carries `noindex`; it is not in the sitemap.

### Wave 5 and 6 close (2026-11-08)

- **2026-11-08 (W5 close).** Surprise: the demo school's published site had no Results page, and the public results
  list and both POSTs answer the one 404 without it (D12). Cost: a demo exam on the website that nobody could look up.
  Fix: the `website` slice adds `{ page: 'results', enabled: true, sections: [] }` to the draft before it publishes,
  and writes `website_published_at` / `website_show_names` on the most recent published exam from the exam's own
  publish time (no clock). Rule candidate: a feature that is off in every theme by default gets its switch in the demo
  seed in the same ticket.
- **2026-11-08 (W5).** Surprise: names are ON by default when results go on the website (D36), and the results are
  about children. Cost: a reviewer asked twice whether a school can publish names by accident. Fix: the publish dialog
  says in one sentence whether names will show, and the switch sits above the confirm button; the choice is saved on
  the exam before it is published. Rule candidate: a default that exposes minors' data is written in the dialog
  sentence itself, not only on a switch.
- **2026-11-08 (W5).** Surprise: a result id in a URL could be enumerated. Fix: the per-subject call takes a signed
  handle (HMAC over exam id, result id and a 30-minute expiry, domain-separated key), never a raw id. Rule candidate:
  an id that a visitor can only get from a list must still not be accepted from a guess.
- **2026-11-08 (W6).** Surprise: two gallery photos with the same bytes shared one `site_media` row, so deleting
  one photo deleted the file the other still showed (data loss), and no test noticed; review did. Fix: one storage key
  per row (`tenants/<id>/site/<hash>-<uuid>.webp`) and the quota counts a distinct file once. Rule candidate: when rows
  share a file by hash, say who owns the delete.
- **2026-11-08 (W6).** Surprise: switching theme dropped the new scalar field kinds (`uuid`, `bool`, `choice`,
  `youtubeId`, `seconds`): `changeTheme` copied only text fields. Cost: a gallery album choice and a video id vanished on
  a theme change. Fix: scalars are copied when the target theme has the same field. Rule candidate: a new field kind
  adds a theme-switch test in the same ticket.
- **2026-11-08 (W6 close).** Surprise: the "same inputs give the same data" demo-seed test flaked. Cause: the staff
  attendance query had no `ORDER BY`, so the order of staff (random uuid ids) decided which `ctx.rng` draw each person
  got. Fix: `ORDER BY u.email` (a seeded value); the coverage spec passed twice in a row afterwards. Rule candidate: any
  seed query that feeds `ctx.rng` per row orders by a seeded column, never by id or insertion order.
- **2026-11-08 (W6 close).** Surprise: `GalleryService` writes `draft` through `m.update` and TypeScript 6.0.3 refuses
  the type (`gallery.service.ts:203`), so `nest build` fails, and with it the e2e web server. Cost: found only when the
  e2e run tried to start the server. Fix: reported for the gallery lane (`draft: draft as never`). Rule candidate:
  run `tsc --noEmit -p tsconfig.build.json` after every server lane, not only the lane's own specs.
- **2026-11-08 (process).** A fresh agent worktree cannot checkout or commit under the sandbox (the orchestrator
  commits); generated files (`schema.d.ts`, `routeTree.gen.ts`) conflict on every merge, so take ours and regenerate.
  The 100-file cap was passed twice by gate fixes (guide pages and CI files). Rule candidate: a gate fix goes on its
  owning branch only if that branch has room, otherwise on a new stacked branch. The `draft_revision` migration was
  edited across PRs, which makes the migration history hard to read; a column added later is a new migration.
- **2026-11-08 (process).** Security: CodeQL flagged a reflected XSS in an error page (`errorPath(request.url)`):
  the path of the request went into the HTML. Rule candidate: an error page prints fixed text only.
- **2026-11-08 (process).** A green local gate did not mean CI passes: `site-themes` was not built in some CI jobs,
  `import/order` lint differs from lint-staged, the e2e route manifest was five routes short, and the Lighthouse
  `assertMatrix` is CI-only. Rule candidate: after a gate, run the CI job's own commands for the packages touched.
- **Not verified:** the Playwright theme specs (`site/e2e/themes/*.spec.ts`) were never run; Lighthouse numbers are
  CI-only; the Results page and the gallery page were read through the public API, not rendered by the site container
  (the e2e stack has none).
