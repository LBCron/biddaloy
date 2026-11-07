# Visual regression ([8.5.4])

Playwright `toHaveScreenshot`, no Chromatic/Percy. **Baselines are
Linux-only** — macOS renders fonts differently, so the suite refuses to
run outside Linux (`determinism.ts`'s `assertLinux`; `ALLOW_NON_LINUX_VISUAL=1`
overrides it, but its output is not a valid baseline). The supported way to
write baselines is the pinned Playwright Docker image (`yarn e2e:visual:update`).

## What gets captured

| Suite     | Config                         | Captures                                                                      |
| --------- | ------------------------------ | ----------------------------------------------------------------------------- |
| Routes    | `e2e/visual.config.ts`         | Every static route in `e2e/route-manifest.json`, full page at 1280×800        |
| Storybook | `e2e/visual-stories.config.ts` | Every story in the static build (opt out with a `no-visual` tag on the story) |

`$param` routes are not captured — their content comes from records the
harness seeds with unique names, which can never diff cleanly. Dynamic
screens are covered at the component level by the Storybook suite.

## Determinism kit (`e2e/visual/determinism.ts`)

- Clock frozen at `2026-01-15T10:00:00+06:00` (`page.clock.install`)
- Animations/transitions/carets killed by injected CSS + `reducedMotion`
- `document.fonts.ready` awaited before every capture
- Data comes only from the deterministic DB seed
- Config defaults: `maxDiffPixelRatio: 0.001`, `animations: 'disabled'`

## Updating baselines

A baseline change is legitimate only for an intentional UI change, and
the new images are reviewed in the PR diff like any other code.

```bash
docker compose up -d db redis
DB_DESTROY_CONFIRM=true yarn workspace @biddaloy/server db:reset
yarn workspace @biddaloy/server seed
export SEED_ADMIN_PASSWORD=...   # same value the seed used
yarn e2e:visual:update           # docker run of the pinned image
```

Running it twice must produce zero diff — if it doesn't, the screen has
a determinism leak; fix that, never widen `maxDiffPixelRatio`.

## Per-browser baselines

Baselines live under `e2e/visual/__screenshots__/{projectName}/` — one
directory per browser. Only the default set (chromium) is committed.
To add a browser:

```bash
E2E_BROWSERS=webkit yarn e2e:visual:update
git add e2e/visual/__screenshots__/webkit
```

Until you do, `E2E_BROWSERS=webkit yarn e2e:visual` fails with missing
snapshot errors — that is the guidance, not a bug.

## Masking

A route with inherently unstable pixels lists CSS selectors in its
manifest entry's `visualMask` array; the route suite masks them at
capture. Prefer fixing the instability (frozen clock already covers
timestamps) over masking.

## CI

The `e2e-visual` job runs both suites inside the pinned container
(service hostnames, not localhost) and uploads the HTML report + diff
images as artifacts on failure. It is `continue-on-error` at
introduction — the workflow carries a dated TODO to flip it to blocking.
