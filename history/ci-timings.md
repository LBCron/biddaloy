## CI timing trend

Over the trailing 53 run(s) (of 60 fetched, cancelled excluded from the failure rate below).

**Failure rate:** 96% (51/53)

### Wall time

| n | Median | p90 | Pass rate |
|---:|---:|---:|---:|
| 53 | 1663.0s | 2347.0s | 4% |

### Per-job

| Job | n | Median | p90 |
|---|---:|---:|---:|
| Integration & e2e tests | 53 | 1477.0s | 2250.0s |
| Frontend tests (3/3) | 52 | 664.0s | 922.0s |
| Frontend tests (1/3) | 52 | 693.0s | 880.0s |
| Frontend tests (2/3) | 52 | 670.0s | 874.0s |
| E2E smoke (chromium 3/3) | 52 | 644.0s | 720.0s |
| E2E smoke (chromium 2/3) | 52 | 621.0s | 706.0s |
| E2E smoke (chromium 1/3) | 52 | 523.0s | 638.0s |
| Build, lint, unit tests | 53 | 350.0s | 424.0s |
| Infra config tests | 53 | 0.0s | 313.0s |
| Dependency vulnerability scan | 53 | 209.0s | 287.0s |
| Landing build | 53 | 0.0s | 232.0s |
| Storybook build | 53 | 68.0s | 139.0s |
| User guide checks | 53 | 62.0s | 128.0s |
| Frontend coverage merge | 52 | 63.0s | 79.0s |
| Bundle size delta | 52 | 52.0s | 65.0s |
| Test timings & budgets | 51 | 15.0s | 19.0s |
| Detect changed areas | 53 | 11.0s | 13.0s |
| Route sweeps (chromium-sweeps) | 53 | 0.0s | 0.0s |
| Nightly quality (merge queue) | 53 | 0.0s | 0.0s |
| Frontend tests (${{ matrix.shard }}/3) | 1 | 0.0s | 0.0s |
| E2E smoke (${{ matrix.browser }} ${{ matrix.shard }}/3) | 1 | -1.0s | -1.0s |
