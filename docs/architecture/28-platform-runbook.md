# 28. Setup and operations guide

One page. Follow it top to bottom and you end with five things live on one VM:
**prod**, **staging**, **demo**, **ops** (Kuma, Beszel, Dozzle) and the **landing** site.
Later parts cover daily use, switching VM, switching to BDIX (no Cloudflare) and
losing a key.

Why the setup looks like this: [30-deployment-target.md](30-deployment-target.md)
(decisions D1 to D26). Example values below are fake on purpose:
`203.0.113.10` is a documentation IP, `age1qz...` is a shortened key, and the
40-hex SHA `3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b` is made up. Replace them.

> **What has and has not been proven.** Every command here was checked against the
> code in this repo. Nothing has run on a real VM yet; that is Epic 79 wave 5 and
> is owner-run. Steps marked **UNVERIFIED on a real VM** are exactly those. Steps
> marked **GAP** are places where the code does not do what a first-time setup needs
> ([Known gaps](#known-gaps)).

## Contents

- [Part 0. The picture and the order](#part-0-the-picture-and-the-order)
- [Part 1. Laptop tools](#part-1-laptop-tools)
- [Part 2. Keys](#part-2-keys)
- [Part 3. Buy the VM](#part-3-buy-the-vm)
- [Part 4. Cloudflare](#part-4-cloudflare-tunnel-mode)
- [Part 5. GitHub](#part-5-github)
- [Part 6. Sentry, Telegram, SMS](#part-6-sentry-telegram-sms)
- [Part 7. Provision](#part-7-provision)
- [Part 8. Secrets](#part-8-secrets)
- [Part 9. The age key for backups](#part-9-the-age-key-for-backups)
- [Part 10. First deploy](#part-10-first-deploy)
- [Part 11. After the first deploy](#part-11-after-the-first-deploy)
- [Part 12. Every day use](#part-12-every-day-use)
- [Part 13. Switch VM or provider](#part-13-switch-vm-or-provider)
- [Part 14. Switch to direct mode (BDIX)](#part-14-switch-to-direct-mode-bdix-no-cloudflare)
- [Part 15. Move ops to its own VM](#part-15-move-ops-to-its-own-vm)
- [Part 16. Rotate a secret, lose a key](#part-16-rotate-a-secret-lose-a-key)
- [Known gaps](#known-gaps)

## Part 0. The picture and the order

```mermaid
flowchart TD
  P1["1 Laptop tools"] --> P2["2 Keys"]
  P2 --> P3["3 Buy the VM"]
  P3 --> P4["4 Cloudflare:<br/>zone, tunnel, DNS, Access,<br/>Turnstile, R2"]
  P4 --> P5["5 GitHub:<br/>deploy key, GHCR token,<br/>Actions secrets"]
  P5 --> P6["6 Sentry, Telegram, SMS"]
  P6 --> P7["7 Provision the VM<br/>(prints 2 public keys)"]
  P7 --> P8["8 Secrets:<br/>.sops.yaml + 5 files"]
  P8 --> P9["9 Backup age key"]
  P9 --> P10["10 First deploy"]
  P10 --> P11["11 After: super admin,<br/>Smoke Test School, Kuma, Beszel"]
  P11 --> P12["12 Every day use"]
  P12 -.-> P13["13 Switch VM"]
  P12 -.-> P14["14 Direct mode"]
  P12 -.-> P15["15 Ops on its own VM"]
  P12 -.-> P16["16 Rotate / lose a key"]
```

Parts 4 to 6 only create accounts and collect values. Nothing is installed until
part 7. You can do 4 to 6 in any order, but finish them before part 8, because part 8
needs every value.

### Accounts you will have at the end

| Account                 | What it is for                                                       | Part |
| ----------------------- | -------------------------------------------------------------------- | ---- |
| Cloudflare              | DNS, tunnel, Access login for staging and ops, Turnstile, R2 backups | 4    |
| VM provider             | The one server (6 vCPU, 12 GB, 100 GB NVMe)                          | 3    |
| GitHub                  | Code, image registry (GHCR), deploy button, deploy keys              | 5    |
| Sentry                  | Error reports (one browser project, one server project)              | 6    |
| Telegram                | Alerts and deploy messages (a bot and a group)                       | 6    |
| SMS gateway             | The app's own SMS and critical alerts                                | 6    |
| Google, Facebook (Meta) | "Sign in with" buttons (prod only, optional)                         | 6    |

### Hostnames

The default domain in the repo is `schoolmanagerp.com`
(`infra/ansible/inventory/prod.yml`). Seven names are served:

| Name                         | Goes to | Login in front of it                |
| ---------------------------- | ------- | ----------------------------------- |
| `schoolmanagerp.com`         | landing | none                                |
| `app.schoolmanagerp.com`     | prod    | none (the app's own login)          |
| `demo.schoolmanagerp.com`    | demo    | none                                |
| `staging.schoolmanagerp.com` | staging | Cloudflare Access (+ the app login) |
| `kuma.schoolmanagerp.com`    | Kuma    | Cloudflare Access (+ Kuma login)    |
| `beszel.schoolmanagerp.com`  | Beszel  | Cloudflare Access (+ Beszel login)  |
| `logs.schoolmanagerp.com`    | Dozzle  | Cloudflare Access (+ Dozzle login)  |

## Part 1. Laptop tools

```bash
brew install ansible sops age gh cloudflared
cd ~/Workspace-personal/biddaloy            # your clone of tareq89/biddaloy
ansible-galaxy install -r infra/ansible/requirements.yml
gh auth login
```

Versions to expect (the VM pins its own, see `infra/ansible/group_vars/all.yml`):

```bash
ansible --version | head -1      # ansible [core 2.18.x]  (CI and the VM use 2.18.6)
sops --version                   # sops 3.9.x or newer (needed for --filename-override)
age --version                    # 1.x
gh --version                     # 2.x
cloudflared --version            # any recent version
```

Optional: `htpasswd` (macOS has it built in; Linux: `apt install apache2-utils`).
Part 8 uses it to make the staging password hash, and part 14 for basic-auth users.

**If it fails.**
`ansible-galaxy` says "role not found": check you are online, then re-run; the roles are
pulled from GitHub by commit SHA. Next: `ansible-galaxy install -r infra/ansible/requirements.yml --force`.

## Part 2. Keys

Three kinds of key. Do not mix them up.

```mermaid
flowchart LR
  subgraph laptop ["Your laptop"]
    OP["operator age key<br/>(opens secrets)"]
    SSH["your SSH key<br/>(logs in to the VM)"]
  end
  subgraph offline ["Somewhere else, offline"]
    REC["recovery age key<br/>(opens secrets if the laptop dies)"]
  end
  subgraph vm ["The VM makes these itself (part 7)"]
    H["host age key"]
    RD["repo deploy key"]
  end
  subgraph gh ["GitHub Actions"]
    GD["GitHub deploy SSH key<br/>(can run only biddaloy-deploy)"]
  end
```

### 2a. Operator age key (your laptop)

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
# Public key: age1qz9x...        <- copy this line, it is the PUBLIC half
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
```

Put the `export` line in your shell profile. The file holds the **private** key. Never
commit it, never paste it in chat.

### 2b. Recovery age key (not on the same laptop)

Run this on a **different** machine (a friend's, or a clean one you will wipe), then move
the private half somewhere offline:

```bash
age-keygen -o recovery.txt
# Public key: age1rk4m...        <- you will paste this into .sops.yaml
```

Store `recovery.txt` on an encrypted USB stick (and a printed copy in a safe place).
Delete it from the machine you made it on. **Rule: the operator key and the recovery
key never live on the same laptop.** If they did, losing the laptop would lose both.

### 2c. Your SSH key

The playbook looks for `~/.ssh/id_ed25519` and its `.pub` by default
(`operator_ssh_privkey` in `infra/ansible/group_vars/all.yml`).

```bash
ls ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "you@laptop"
```

A different path: add `-e operator_ssh_privkey=~/.ssh/other` to every `ansible-playbook` line
in part 7. Two operators: see [`infra/ansible/README.md`](../../infra/ansible/README.md).

### 2d. The SSH key pair for GitHub deploys

GitHub Actions logs in as `deploy` with this key. On the VM it can run **only**
`biddaloy-deploy` (a "forced command", D12). Make a key with no passphrase:

```bash
ssh-keygen -t ed25519 -N '' -C biddaloy-github-deploy -f ~/.ssh/biddaloy_github_deploy
cat ~/.ssh/biddaloy_github_deploy.pub
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK7f... biddaloy-github-deploy
```

The **public** line goes to the VM in part 7. The **private** file goes into the GitHub
secret `DEPLOY_SSH_KEY` in part 5. The playbook accepts only one line of the form
`ssh-ed25519 <base64> [comment]` (`provision.yml`, first task).

## Part 3. Buy the VM

Ask for:

- Ubuntu **24.04 LTS** or newer, x86_64 or arm64 (22.04 is refused: its Python 3.10 cannot run the ansible-core the deploy uses on the VM)
- 6 vCPU, 12 GB RAM, 100 GB NVMe (decision P12)
- a public **IPv4** address
- your SSH public key installed for **root** (most providers have a field for it)

Check it works:

```bash
ssh root@203.0.113.10 true && echo ok
# ok
```

If the provider gives you a different admin user (`ubuntu`, `admin`), use that name in
part 7: `-e ansible_user=ubuntu`. It must be able to `sudo`.

**If it fails.** `Permission denied (publickey)`: the provider did not install your key. Add
it in the provider's panel, or use their web console to paste it into
`/root/.ssh/authorized_keys`. Next: re-run the `ssh` line.

**Providers.** Any plain Ubuntu VM works. The setup needs no provider feature, only SSH and
a stable IPv4. If you choose a **BDIX** provider (Bangladesh local network; needed for
direct mode, part 14) check three things before you pay:

| Check                 | Why                                                                           |
| --------------------- | ----------------------------------------------------------------------------- |
| A public IPv4 address | direct mode needs ports 80 and 443 reachable from the internet                |
| VNC / web console     | if you ever lock yourself out of SSH, the console is the only way back in     |
| Snapshot support      | take one before the first deploy and before each big change (cheap insurance) |

## Part 4. Cloudflare, tunnel mode

Tunnel mode means **no web port is open** on the VM. A small program on the VM
(`cloudflared`) calls out to Cloudflare, and Cloudflare sends visitors through that call.

```mermaid
flowchart LR
  V["Visitor"] --> CF["Cloudflare<br/>(TLS, Access login)"]
  CF -->|"tunnel, VM dials out"| C["cloudflared on the VM"]
  C --> N["nginx"]
  N --> A["prod / staging / demo / ops / landing"]
```

### 4a. Add the zone

1. Cloudflare dashboard, **Add a site**, enter `schoolmanagerp.com`, pick the Free plan.
2. At your domain registrar, replace the nameservers with the two Cloudflare shows
   (for example `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`).
3. Wait until the dashboard says **Active** (minutes to a few hours).

You do not set SSL/TLS mode for the tunnel: Cloudflare to `cloudflared` is already
encrypted and the last hop stays inside the VM. Other Cloudflare settings (cache rule for
`/api/*`, WAF, rate limit, Bot Fight off): [25-cloudflare.md](25-cloudflare.md). Note
that page still describes the old Origin CA setup; the rows about `/api/` cache, WAF,
rate limit and Bot Fight Mode still apply.

### 4b. Create the tunnel

```bash
cloudflared tunnel login                 # opens a browser, pick the zone
cloudflared tunnel create biddaloy
# Created tunnel biddaloy with id 5b1c7a52-0f3e-4c34-9a77-3d1d5a0c1f10
# Tunnel credentials written to /Users/you/.cloudflared/5b1c7a52-0f3e-4c34-9a77-3d1d5a0c1f10.json
```

Two values for `edge.enc.env` (part 8):

| Key                                  | Value                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `CLOUDFLARE_TUNNEL_ID`               | `5b1c7a52-0f3e-4c34-9a77-3d1d5a0c1f10`                                  |
| `CLOUDFLARE_TUNNEL_CREDENTIALS_JSON` | the file's contents on **one line**: `jq -c . ~/.cloudflared/<id>.json` |

The tunnel's routing (which hostname goes where) is **not** set in the dashboard. It is
rendered from git by the deploy (`infra/ansible/templates/cloudflared-config.yml.j2`, D17).

### 4c. DNS: one CNAME per hostname

```bash
for h in schoolmanagerp.com app.schoolmanagerp.com demo.schoolmanagerp.com \
         staging.schoolmanagerp.com kuma.schoolmanagerp.com \
         beszel.schoolmanagerp.com logs.schoolmanagerp.com \
         inbox-demo.schoolmanagerp.com inbox-staging.schoolmanagerp.com; do
  cloudflared tunnel route dns biddaloy "$h"
done
# Added CNAME app.schoolmanagerp.com which will route to this tunnel
```

Check in the dashboard (DNS > Records): each name is a **Proxied** CNAME to
`5b1c7a52-0f3e-4c34-9a77-3d1d5a0c1f10.cfargotunnel.com`.

> `www.schoolmanagerp.com` is not in the list above because it is not one of the nine
> names. The tunnel config routes it too, and nginx redirects it to the apex. If you want
> it to work, add a proxied `www` CNAME to the same tunnel target.

### 4d. Zero Trust: the Access login (staging and ops)

1. Dashboard > **Zero Trust**. First time, pick a team name, for example `myteam`
   (your login page becomes `myteam.cloudflareaccess.com`). That name is
   `CF_ACCESS_TEAM`.
2. **Access > Applications > Add an application > Self-hosted.**
3. Application 1, name `Staging`, hostnames `staging.schoolmanagerp.com` and `inbox-staging.schoolmanagerp.com` (Mailpit's test inbox, Epic 87), session 24 hours.
   Policy `Owner only`: action **Allow**, include **Emails** = your email. Identity
   provider: Google (or One-time PIN if you have not set Google up). Save, then open the
   application and copy **Application Audience (AUD) Tag**: that is `CF_ACCESS_AUD_STAGING`.
4. Application 2, name `Ops`, **three** hostnames: `kuma.schoolmanagerp.com`,
   `beszel.schoolmanagerp.com`, `logs.schoolmanagerp.com`, same `Owner only` policy.
   Its AUD tag is `CF_ACCESS_AUD_OPS`.
5. **Bypass for Kuma push (D14).** The VM's own timers post job results to
   `https://kuma.schoolmanagerp.com/api/push/<token>` and cannot answer a login. Add a
   third application: name `Kuma push`, hostname `kuma.schoolmanagerp.com`, path
   `api/push/*`, one policy with action **Bypass** and include **Everyone**. A path-scoped
   application is more specific than the `Ops` one, so it wins for that path only.
   The tunnel config already skips the Access check for that path on the VM side (first
   `ingress` rule of `cloudflared-config.yml.j2`); this is the Cloudflare-side half. The
   push URL carries a secret token, and Kuma checks it.

Owner steps for the test inbox (Epic 87): add the two proxied CNAMEs in 4c, put
`inbox-staging` on the `Staging` Access app (step 3), and set the two `INBOX_*` keys in
`edge.enc.env` (the cloudflared template needs both). Optional: a Kuma HTTP monitor on
`https://inbox-demo.schoolmanagerp.com/readyz`. The names are single-level (`inbox-demo.`, `inbox-staging.`)
on purpose: Cloudflare's free Universal certificate covers `*.schoolmanagerp.com` only, so a two-level
name like `inbox.demo.` would fail TLS without a paid Advanced Certificate.

The staging inbox has **one** login, the Access app above (basic auth in direct mode); Mailpit
itself has none. This is a written exception to Rule 12
([08-security](08-security.md#rule-12-the-origin-is-reachable-only-through-the-edge)): anyone
past Access can read and delete every staging sign-in code and reset link. So keep staging free
of real contacts except your own: the restore drill and any staging load keep the platform admins' and the smoke
school admin's emails, and those must be your addresses.

**If it fails.** Open `https://staging.schoolmanagerp.com` in a private window after part 10:
it must show the Cloudflare login. A page with no login means the Access application does
not cover that hostname. Next: edit the application's hostnames.

No deploy checks this for you: there is no `access_confirmed` switch any more. In tunnel
mode, Cloudflare Access is what keeps staging and ops closed. In direct mode, the basic-auth
login does the same job.

### 4e. Turnstile (the captcha on public forms)

Dashboard > **Turnstile > Add widget**.

| Widget | Hostname                  | Keys go to                                                           |
| ------ | ------------------------- | -------------------------------------------------------------------- |
| 1      | `app.schoolmanagerp.com`  | `prod.enc.env`: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`         |
| 2      | `demo.schoolmanagerp.com` | `demo.enc.env`: same two keys (replace the test pair in the example) |

Staging uses Cloudflare's public always-pass test pair, already in
`staging.example.env`. Prod needs both keys or neither (`config:check` refuses one alone).

### 4f. R2 (backups and archived logs)

1. Dashboard > **R2 Object Storage > Create bucket**, name `biddaloy-backups`
   (location: automatic).
2. Note your account id (R2 overview, right side). The S3 endpoint is
   `https://<account-id>.r2.cloudflarestorage.com`, for example
   `https://0a1b2c3d4e5f60718293a4b5c6d7e8f9.r2.cloudflarestorage.com`.
3. **R2 > Manage API tokens > Create API token.**
   - **Token 1:** permission **Object Read & Write**, restricted to bucket
     `biddaloy-backups`. Copy the Access Key ID and Secret Access Key. They go to prod
     `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` and edge
     `LOG_ARCHIVE_S3_ACCESS_KEY_ID` / `LOG_ARCHIVE_S3_SECRET_ACCESS_KEY`.
   - **Token 2:** permission **Object Read only**, same bucket. It goes to staging
     `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` (D19). Staging can never
     overwrite a prod backup.
4. The bucket name `biddaloy-backups` and the endpoint also go into the `*_S3_BUCKET`
   and `*_S3_ENDPOINT` keys of the same files.

Backups land under `db/hourly/` and `db/daily/`; archived logs under `logs/`.

## Part 5. GitHub

### 5a. Repo deploy key (the VM reads the code)

The VM clones `git@github.com:tareq89/biddaloy.git` with a key **it made itself** in part 7.
You come back to this step after part 7 prints it. Repo **Settings > Deploy keys > Add
deploy key**, title `biddaloy-vm`, paste the printed line, leave **Allow write access
off** (read-only).

### 5b. GHCR pull token

The VM pulls images from `ghcr.io/tareq89/*`. When the repo is private the packages are
private too (P16), so the VM needs a token.

GitHub > your avatar > **Settings > Developer settings > Personal access tokens >
Tokens (classic) > Generate new token (classic)**. Scope: **only `read:packages`**.
It goes to edge: `GHCR_PULL_USER` = your GitHub username, `GHCR_PULL_TOKEN` = `ghp_...`.

### 5c. Actions secrets for the Deploy button

The workflow `.github/workflows/deploy.yml` uses an **Environment** named `production`.
Put the three deploy secrets in that environment, **not** at repo level (repo-level secrets
would let any branch deploy).

1. Repo **Settings > Environments > New environment** `production`.
2. **Deployment branches and tags** > **Selected branches** > add `main`.
3. Add environment secrets:

| Secret                   | Value                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `DEPLOY_HOST`            | `203.0.113.10`                                                       |
| `DEPLOY_SSH_KEY`         | the whole **private** file `~/.ssh/biddaloy_github_deploy` (part 2d) |
| `DEPLOY_SSH_KNOWN_HOSTS` | one line from `ssh-keyscan -t ed25519 203.0.113.10`                  |

Make the known-hosts line, and check it against the VM's own fingerprint before you trust it:

```bash
ssh-keyscan -t ed25519 203.0.113.10
# 203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPq2...
ssh-keyscan -t ed25519 203.0.113.10 | ssh-keygen -lf -
# 256 SHA256:Zk3e... 203.0.113.10 (ED25519)
# Compare that SHA256 with the one printed on the VM console:
#   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Set them from the terminal if you like:

```bash
gh secret set DEPLOY_HOST --env production --body 203.0.113.10
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/biddaloy_github_deploy
ssh-keyscan -t ed25519 203.0.113.10 | gh secret set DEPLOY_SSH_KNOWN_HOSTS --env production
```

Repo-level (used when images are built, `publish-image.yml`):

| Kind     | Name                                                                                                                            | Value                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Secret   | `SENTRY_AUTH_TOKEN`                                                                                                             | Sentry token for uploading source maps (part 6) |
| Variable | `SENTRY_ORG`                                                                                                                    | your Sentry organisation slug                   |
| Variable | `SENTRY_PROJECT`                                                                                                                | the **browser** project slug                    |
| Variable | `PUBLIC_UMAMI_ID`, `PUBLIC_UMAMI_SRC`, `PUBLIC_CLARITY_ID`, `PUBLIC_META_PIXEL_ID`, `PUBLIC_WA_NUMBER`, `PUBLIC_AIPRAKTOR_SITE` | landing-site values, all optional               |

`SENTRY_AUTH_TOKEN` is optional: without it the build skips source-map upload.
Variables are in **Settings > Secrets and variables > Actions > Variables**.

### 5d. Make the first images exist

The VM only pulls; it never builds. Images are published when `main` changes.

```bash
gh workflow run publish-image.yml --ref main      # or merge any PR into main
gh run list -w publish-image.yml --limit 3
# completed  success  Publish images  main  workflow_dispatch  ...
```

It builds four images for each commit: `biddaloy-app`, `biddaloy-backup`,
`biddaloy-demo-reset`, `biddaloy-landing`. Do part 8 first if you have not: you will
publish again after you commit the secrets.

### 5e. Staging workflow key

The **Staging** workflow (`.github/workflows/staging.yml`) loads a backup into staging or
switches the staging database. It uses its **own** key, not the deploy key. Each key can run
only one command on the VM:

```mermaid
flowchart LR
  D["Deploy workflow<br/>DEPLOY_SSH_KEY"] -->|forced command| BD["biddaloy-deploy --from-github"]
  S["Staging workflow<br/>STAGING_SSH_KEY"] -->|forced command| BS["biddaloy-staging --from-github"]
```

So a leaked deploy key cannot wipe staging data, and the staging key cannot deploy (Epic 88 D6-B).
Until you do the steps below the Staging workflow fails at the ssh step; everything else works.

1. Make a second key pair (not a copy of the deploy one; the playbook stops if both are the same):

   ```bash
   ssh-keygen -t ed25519 -N '' -C biddaloy-github-staging -f ~/.ssh/biddaloy_github_staging
   ```

2. Paste the **public** line into `infra/ansible/inventory/prod.yml`, replacing the `UNSET-...`
   placeholder, commit it, and run `provision.yml` once (part 7c):

   ```yaml
   github_staging_pubkey_pinned: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQ9x... biddaloy-github-staging
   ```

3. Repo **Settings > Environments > New environment** `staging`, **Deployment branches and
   tags** > **Selected branches** > add `main`. Add three environment secrets. Environment
   secrets are private to their environment, so the `production` ones are not visible here:

   ```bash
   gh secret set STAGING_HOST --env staging --body 203.0.113.10
   gh secret set STAGING_SSH_KEY --env staging < ~/.ssh/biddaloy_github_staging
   ssh-keyscan -t ed25519 203.0.113.10 | gh secret set STAGING_SSH_KNOWN_HOSTS --env staging
   ```

   Check the known-hosts line against the VM's fingerprint, the same way as in 5c.

4. Try it: **Actions > Staging > Run workflow**, action `status`. The summary shows
   `active db: ...` and `exit status: 0`.

## Part 6. Sentry, Telegram, SMS

### Sentry

Create two projects in one organisation: a **Browser (React)** project and a **Node.js**
project. Each gives a DSN (`https://<key>@o0.ingest.sentry.io/<id>`).

| Key                          | From                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| `SENTRY_DSN_WEB`             | the browser project DSN                                        |
| `SENTRY_DSN`                 | the server project DSN                                         |
| `SENTRY_TRACES_SAMPLE_RATE`  | `0.1` (must be filled; empty fails boot)                       |
| `SENTRY_CRON_MONITOR_URL`    | optional: Sentry cron monitor check-in URL                     |
| `SENTRY_AUTH_TOKEN` (GitHub) | Settings > Auth Tokens, scope `project:releases` / source maps |

Prod, staging and demo all use the same two DSNs. The environment name comes from
`SENTRY_ENVIRONMENT`, so Sentry shows them as separate environments by itself.

### Telegram (alerts and deploy messages)

1. In Telegram, message **@BotFather**, send `/newbot`, follow the prompts. It replies with
   a token like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`. That is `TELEGRAM_BOT_TOKEN`.
2. Create a group, add the bot to it, send any message in the group.
3. Read the chat id:

   ```bash
   curl -s "https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/getUpdates" \
     | jq '.result[].message.chat | {id, title}'
   # { "id": -1001234567890, "title": "Biddaloy alerts" }
   ```

   `-1001234567890` is `TELEGRAM_CHAT_ID` (negative for groups). Empty `result`? Send one
   more message in the group and repeat.

Both keys live in **`edge.enc.env`** (not ops). Every deploy decrypts edge first, and ops
may move to another VM. Kuma's and Beszel's own Telegram alerts are set in their web UIs
(part 11) and need no key here.

### SMS gateway

Use the gateway you already use for school SMS. You need an API key, a sender id, and the
gateway's HTTP API URL. Set `SMS_PROVIDER` to the provider's name and fill that provider's own keys (for example
`ONECODESOFT_API_KEY`, `ONECODESOFT_SENDER_ID`, `ONECODESOFT_API_URL`) in `prod.enc.env`. The old
`PLATFORM_SMS_*` keys still work for one more release when `SMS_PROVIDER` is unset. Also set
`PLATFORM_ALERT_PHONES` (fallback phone numbers for platform alerts, comma separated).
Staging and demo never get SMS keys (`config:check --env staging` refuses them).

### Google and Facebook sign-in (optional, prod only)

Create an OAuth client in the Google Cloud console and a Meta app. Their id and secret
go to the four `*_OAUTH_*` keys of `prod.enc.env`. Leave all four empty to turn the
buttons off.

## Part 7. Provision

Provision turns the empty Ubuntu VM into the hardened Docker host (SSH keys only, firewall,
fail2ban, auto-updates, Docker, `/opt/biddaloy`, the host age key, the repo deploy key,
the nightly timers). It does not deploy the app.

```mermaid
flowchart LR
  A["fresh VM, root login"] -->|"1st run: -e ansible_user=root"| B["probe: can deploy@ log in with<br/>your key and use sudo?"]
  B -- "no" --> X["play stops.<br/>Root login is still open."]
  B -- "yes" --> C["root and password login off,<br/>firewall, Docker, timers"]
  C --> D["prints 2 public keys"]
  D -->|"2nd run, as deploy"| E["changed=0"]
```

### 7a. First run

```bash
export BIDDALOY_HOST=203.0.113.10
cd infra/ansible
ansible-playbook provision.yml -e ansible_user=root
```

**Keep a root SSH session open in another terminal until the second run succeeds.**
The play turns off root login. Before it does, it adds your key to `deploy` and tests that
login. If the test fails, the play stops with root still open.

At the end it prints (values are examples):

```text
TASK [Keys to register] ****
ok: [biddaloy-1] =>
  msg:
  - 'HOST AGE PUBLIC KEY: age1w8x3tq5p7c9...'
  - 'Add it to .sops.yaml, run `sops updatekeys infra/secrets/*.enc.env`, and commit.'
  - 'REPO DEPLOY KEY: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ4n... biddaloy-repo-deploy'
  - 'Add it as a read-only deploy key on the GitHub repo (Settings > Deploy keys).'
```

Copy the two values to where they go:

| Printed value         | Goes to                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `HOST AGE PUBLIC KEY` | `.sops.yaml` (part 8)                                                                           |
| `REPO DEPLOY KEY`     | GitHub repo Settings > Deploy keys, read-only ([5a](#5a-repo-deploy-key-the-vm-reads-the-code)) |

You can read them again any time: `ssh deploy@203.0.113.10 'sudo age-keygen -y /opt/biddaloy/keys/host.age; cat ~/.ssh/github_repo.pub'`.

### 7b. Install the GitHub deploy key

`github_deploy_pubkey_pinned` in `infra/ansible/inventory/prod.yml` is a **placeholder**
(`UNSET-paste-the-GitHub-Actions-deploy-public-key-here`). While it starts with `UNSET`, no
GitHub key is installed. Replace it with the line from part 2d, commit it, and re-run:

```yaml
# infra/ansible/inventory/prod.yml
github_deploy_pubkey_pinned: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK7f... biddaloy-github-deploy
```

For a quick test without editing the file you can use the environment variable instead:
`BIDDALOY_GITHUB_DEPLOY_PUBKEY="$(cat ~/.ssh/biddaloy_github_deploy.pub)"` before the run.
Pinning it in the file is better: a later run from another laptop keeps the key.

### 7c. Second run, as `deploy`

```bash
ansible-playbook provision.yml | tail -3
# PLAY RECAP *****
# biddaloy-1 : ok=61 changed=0 unreachable=0 failed=0 skipped=4 rescued=0 ignored=0
```

`changed=0` is the proof that provision is repeatable. After 7b, run once more: the first
run after setting the key shows `changed=1`, the next one `changed=0`.

Check:

```bash
ssh deploy@203.0.113.10 'ls -l /opt/biddaloy/deploy.lock; id; command -v biddaloy-deploy'
# -rw-rw-r-- 1 deploy deploy 0 ... /opt/biddaloy/deploy.lock
# uid=1001(deploy) ... groups=...,docker,systemd-journal
# /usr/local/bin/biddaloy-deploy
ssh root@203.0.113.10 true
# root@203.0.113.10: Permission denied (publickey).      <- good
```

**If it fails.**

| You see                                                    | Meaning / Next                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Permission denied (publickey)` in the probe task          | your key is not the one in `operator_ssh_pubkey`. Fix `-e operator_ssh_privkey=...`. Root is still open. |
| `Unexpected public listener: tcp 0.0.0.0:xxxx`             | something else listens on a public port. Find it: `ss -tuln`. Stop it, re-run.                           |
| `github_deploy_pubkey ... a single "ssh-ed25519 ..." line` | the pasted key has options or a newline. Paste exactly one line.                                         |
| You locked yourself out                                    | use the provider's VNC console, or restore the snapshot.                                                 |

**UNVERIFIED on a real VM** (Epic 79 wave 5, owner-run): the whole of part 7, including the
`changed=0` second run and the ufw `limit` rule.

## Part 8. Secrets

All secrets live in git, **encrypted** with sops + age, in `infra/secrets/*.enc.env`. Each
file is encrypted for three keys: yours (operator), the recovery key, and the VM's host key.
That is why the VM can decrypt them itself during a deploy. Background and the CI guard:
[`infra/secrets/README.md`](../../infra/secrets/README.md).

### 8a. Put the three public keys into `.sops.yaml`

```yaml
# .sops.yaml  (public keys only, safe to commit)
creation_rules:
  - path_regex: infra/secrets/.*\.enc\.(env|pem)$
    age: >-
      age1qz9x...,
      age1rk4m...,
      age1w8x3tq5p7c9...
```

Order in the file: operator, recovery, host (the three `REPLACE_WITH_...` lines today).

### 8b. Create the five files

```bash
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt
sops infra/secrets/edge.enc.env       # opens $EDITOR on a new file
sops infra/secrets/ops.enc.env
sops infra/secrets/prod.enc.env
sops infra/secrets/staging.enc.env
sops infra/secrets/demo.enc.env
```

In each editor, paste the keys from the matching `infra/secrets/<name>.example.env` and
fill every value from the table below. **Never type values into the `.example.env` files**
(the CI guard fails on a value there, except the public defaults it lists).

Random values: `openssl rand -hex 32`. **Hex only**, because compose expands `$` in `.env`
values and `POSTGRES_PASSWORD` is dropped into `DATABASE_URL` without URL-encoding, so
`@ / : $` would break it. The one exception is `SETTINGS_ENCRYPTION_KEY`, which must be
base64 of 32 bytes (`openssl rand -base64 32`).

### 8c. The staging password hash

Staging sets one password on every user, `STAGING_PASSWORD` (at least 12 characters), and
needs its bcrypt hash too, base64-encoded (`$` signs in the raw hash would be mangled).
Make both, then paste them:

```bash
pw=$(openssl rand -hex 16)
echo "STAGING_PASSWORD=$pw"
htpasswd -bnBC 12 "" "$pw" | tr -d ':\n' | base64 | tr -d '\n'; echo
# JDJ5JDEyJGFiY2RlZi4uLg==     <- STAGING_PASSWORD_HASH_B64 (shortened)
```

`config:check` decodes the hash and verifies it against `STAGING_PASSWORD`, so a wrong hash
is caught in 8d. **UNVERIFIED:** `htpasswd` writes a `$2y$` hash; the check accepts `$2a$`,
`$2b$` and `$2y$` prefixes (`scripts/backup/staging-refresh.sh:62`).

### 8d. Check each file before it ships

```bash
sops -d infra/secrets/prod.enc.env    | yarn config:check --env prod    --file /dev/stdin
sops -d infra/secrets/staging.enc.env | yarn config:check --env staging --file /dev/stdin
sops -d infra/secrets/demo.enc.env    | yarn config:check --env demo    --file /dev/stdin
# config:check: ok
```

It fails on a missing variable, a wrong `ENV_NAME`, one Turnstile key alone, and a staging
or demo file that points at the prod database or bucket. Errors name variables, never values.
`yarn` needs `yarn install` in the repo first; skip this check if you have not installed
dependencies, the deploy runs the same check on the VM.

### 8e. Check the recovery key opens them too

```bash
sops -d infra/secrets/prod.enc.env >/dev/null && echo laptop ok
HOME=$(mktemp -d) SOPS_AGE_KEY_FILE=/Volumes/usb/recovery.txt \
  sops -d infra/secrets/prod.enc.env >/dev/null && echo recovery ok
```

### 8f. Commit, merge, publish

```bash
git checkout -b chore/secrets-first-setup
git add .sops.yaml infra/ansible/inventory/prod.yml infra/secrets/*.enc.env
git commit -m "chore: first secrets and GitHub deploy key"
git push -u origin chore/secrets-first-setup
```

Open a PR, merge it into `main`, then wait for **Publish images** to turn green
(`gh run list -w publish-image.yml --limit 1`). The sha you deploy in part 10 must be on
`main` with its images published. The VM reads the secrets **from the checkout of that
sha**, so a secret you change later needs a new commit and a new deploy.

### Which value comes from where

Every key of the five example files. "From" says which part gives you the value.

| Key                                  | File              | From                 | Value shape                                                                            |
| ------------------------------------ | ----------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `ENV_NAME`                           | `prod.enc.env`    | part 7               | already filled in the example (`prod`)                                                 |
| `COMPOSE_PROFILES`                   | `prod.enc.env`    | part 8               | leave the example value (`replica,backup`)                                             |
| `APP_VERSION`                        | `prod.enc.env`    | the deploy / default | leave empty; the deploy sets it                                                        |
| `APP_MEM`                            | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_MEM`                             | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_MEM`                          | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_MEM`                             | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_CPUS`                           | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_CPUS`                            | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_CPUS`                         | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_CPUS`                            | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_BASE_URL`                       | `prod.enc.env`    | part 8               | `https://app.schoolmanagerp.com` (no trailing slash)                                   |
| `PUBLIC_APP_URL`                     | `prod.enc.env`    | part 8               | same as `APP_BASE_URL`                                                                 |
| `CORS_ORIGINS`                       | `prod.enc.env`    | part 8               | same origin as `APP_BASE_URL`                                                          |
| `SUPPORT_CONTACT_URL`                | `prod.enc.env`    | part 8               | `https://wa.me/8801XXXXXXXXX`                                                          |
| `PLATFORM_TENANT_ID`                 | `prod.enc.env`    | part 11              | id of the platform school (uuid); fill after part 11, then redeploy                    |
| `POSTGRES_USER`                      | `prod.enc.env`    | part 8               | `biddaloy`                                                                             |
| `POSTGRES_DB`                        | `prod.enc.env`    | part 8               | prod `biddaloy`; staging must be `biddaloy_staging`; demo must be `biddaloy_demo`      |
| `POSTGRES_PASSWORD`                  | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `S3_BUCKET`                          | `prod.enc.env`    | part 8               | prod `biddaloy`; staging must be `biddaloy-staging`; demo must be `biddaloy-demo`      |
| `S3_REGION`                          | `prod.enc.env`    | part 8               | `us-east-1`                                                                            |
| `S3_ACCESS_KEY_ID`                   | `prod.enc.env`    | part 8               | `openssl rand -hex 16`                                                                 |
| `S3_SECRET_ACCESS_KEY`               | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `DB_SSL_REJECT_UNAUTHORIZED`         | `prod.enc.env`    | part 8               | leave empty                                                                            |
| `JWT_SECRET`                         | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `JWT_SECRET_PREVIOUS`                | `prod.enc.env`    | the deploy / default | leave empty until you rotate                                                           |
| `SETTINGS_ENCRYPTION_KEY`            | `prod.enc.env`    | part 8               | `openssl rand -base64 32`                                                              |
| `SETTINGS_ENCRYPTION_KEY_PREVIOUS`   | `prod.enc.env`    | the deploy / default | leave empty until you rotate                                                           |
| `HEALTH_TOKEN`                       | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `BACKUP_AGE_PUBLIC_KEY`              | `prod.enc.env`    | part 9               | `age1qz...` (public half of the backup key)                                            |
| `BACKUP_S3_ENDPOINT`                 | `prod.enc.env`    | part 4               | `https://<account-id>.r2.cloudflarestorage.com`                                        |
| `BACKUP_S3_BUCKET`                   | `prod.enc.env`    | part 4               | `biddaloy-backups`                                                                     |
| `BACKUP_S3_ACCESS_KEY_ID`            | `prod.enc.env`    | part 4               | R2 token 1 (prod, read+write) or token 2 (staging, read-only)                          |
| `BACKUP_S3_SECRET_ACCESS_KEY`        | `prod.enc.env`    | part 4               | same token as the key id above                                                         |
| `BACKUP_RCLONE_CRYPT_PASSWORD`       | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `BACKUP_RCLONE_CRYPT_SALT`           | `prod.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `BACKUP_PUSH_URL`                    | `prod.enc.env`    | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `LOG_ARCHIVE_PUSH_URL`               | `prod.enc.env`    | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `SENTRY_CRON_MONITOR_URL`            | `prod.enc.env`    | part 6               | Sentry cron monitor check-in URL (optional)                                            |
| `BACKUP_SCHEDULE`                    | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_RETENTION_DAYS`              | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_HOURLY_KEEP`                 | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_DAILY_KEEP`                  | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_TRASH_DAYS`                  | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_FILES_MAX_DELETE`            | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_NET_WAIT_SECS`               | `prod.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_MEM`                         | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `BACKUP_CPUS`                        | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `JOBS_MEM`                           | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `JOBS_CPUS`                          | `prod.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `TURNSTILE_SITE_KEY`                 | `prod.enc.env`    | part 4               | prod/demo: widget site key; staging/demo example already holds the test pair           |
| `TURNSTILE_SECRET_KEY`               | `prod.enc.env`    | part 4               | prod: widget secret; staging/demo example already holds the test pair                  |
| `SENTRY_DSN`                         | `prod.enc.env`    | part 6               | `https://<key>@o0.ingest.sentry.io/0` (server project)                                 |
| `SENTRY_DSN_WEB`                     | `prod.enc.env`    | part 6               | `https://<key>@o0.ingest.sentry.io/1` (browser project)                                |
| `SENTRY_TRACES_SAMPLE_RATE`          | `prod.enc.env`    | part 6               | `0.1`                                                                                  |
| `GOOGLE_OAUTH_CLIENT_ID`             | `prod.enc.env`    | part 6               | Google Cloud console (prod only; staging stays empty)                                  |
| `GOOGLE_OAUTH_CLIENT_SECRET`         | `prod.enc.env`    | part 6               | same console (prod only)                                                               |
| `FACEBOOK_OAUTH_CLIENT_ID`           | `prod.enc.env`    | part 6               | Meta developers console (prod only)                                                    |
| `FACEBOOK_OAUTH_CLIENT_SECRET`       | `prod.enc.env`    | part 6               | same console (prod only)                                                               |
| `SMS_PROVIDER`                       | `prod.enc.env`    | part 6               | registered SMS provider name, e.g. `onecodesoft` (prod only)                           |
| `GREENWEB_API_KEY`                   | `prod.enc.env`    | part 6               | key if that provider is chosen (prod only)                                             |
| `GREENWEB_API_URL`                   | `prod.enc.env`    | part 6               | optional gateway URL; empty uses Greenweb's own (prod only)                            |
| `MIMSMS_API_KEY`                     | `prod.enc.env`    | part 6               | key if that provider is chosen (prod only)                                             |
| `MIMSMS_SENDER_ID`                   | `prod.enc.env`    | part 6               | sender id if that provider is chosen (prod only)                                       |
| `MIMSMS_API_URL`                     | `prod.enc.env`    | part 6               | optional gateway URL; empty uses MimSMS's own (prod only)                              |
| `ONECODESOFT_API_KEY`                | `prod.enc.env`    | part 6               | key if that provider is chosen (prod only)                                             |
| `ONECODESOFT_SENDER_ID`              | `prod.enc.env`    | part 6               | sender id if that provider is chosen (prod only)                                       |
| `ONECODESOFT_API_URL`                | `prod.enc.env`    | part 6               | gateway HTTP API URL (prod only)                                                       |
| `PLATFORM_SMS_PROVIDER`              | `prod.enc.env`    | part 6               | provider name your gateway uses (deprecated, read until the next release; prod only)   |
| `PLATFORM_SMS_API_KEY`               | `prod.enc.env`    | part 6               | gateway API key (deprecated, read until the next release; prod only)                   |
| `PLATFORM_SMS_SENDER_ID`             | `prod.enc.env`    | part 6               | sender id approved by the gateway (deprecated, read until the next release; prod only) |
| `PLATFORM_SMS_API_URL`               | `prod.enc.env`    | part 6               | gateway HTTP API URL (deprecated, read until the next release; prod only)              |
| `PLATFORM_ALERT_PHONES`              | `prod.enc.env`    | part 6               | `+8801700000000,+8801800000000`                                                        |
| `OTP_SMS_ALLOWED_PREFIXES`           | `prod.enc.env`    | the deploy / default | leave empty (default `+880`)                                                           |
| `SMOKE_SCHOOL_SLUG`                  | `prod.enc.env`    | part 11              | slug of the Smoke Test School, e.g. `smoke-test`                                       |
| `SMOKE_ADMIN_EMAIL`                  | `prod.enc.env`    | part 11              | login you create in part 11                                                            |
| `SMOKE_ADMIN_PASSWORD`               | `prod.enc.env`    | part 11              | `openssl rand -hex 16`; staging must equal `STAGING_PASSWORD`                          |
| `SMOKE_TEACHER_EMAIL`                | `prod.enc.env`    | part 11              | login you create in part 11                                                            |
| `SMOKE_TEACHER_PASSWORD`             | `prod.enc.env`    | part 11              | `openssl rand -hex 16`; staging must equal `STAGING_PASSWORD`                          |
| `SMOKE_SUPER_ADMIN_EMAIL`            | `prod.enc.env`    | part 11              | the platform super admin login                                                         |
| `SMOKE_SUPER_ADMIN_PASSWORD`         | `prod.enc.env`    | part 11              | its password; staging must equal `STAGING_PASSWORD`                                    |
| `ENV_NAME`                           | `staging.enc.env` | part 7               | already filled in the example (`staging`)                                              |
| `DEMO_MODE`                          | `staging.enc.env` | part 8               | leave the example value                                                                |
| `APP_VERSION`                        | `staging.enc.env` | the deploy / default | leave empty; the deploy sets it                                                        |
| `APP_MEM`                            | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_MEM`                             | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_MEM`                          | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_MEM`                             | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_CPUS`                           | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_CPUS`                            | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_CPUS`                         | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_CPUS`                            | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_BASE_URL`                       | `staging.enc.env` | part 8               | `https://app.schoolmanagerp.com` (no trailing slash)                                   |
| `PUBLIC_APP_URL`                     | `staging.enc.env` | part 8               | same as `APP_BASE_URL`                                                                 |
| `CORS_ORIGINS`                       | `staging.enc.env` | part 8               | same origin as `APP_BASE_URL`                                                          |
| `SUPPORT_CONTACT_URL`                | `staging.enc.env` | part 8               | `https://wa.me/8801XXXXXXXXX`                                                          |
| `PLATFORM_TENANT_ID`                 | `staging.enc.env` | part 11              | id of the platform school (uuid); fill after part 11, then redeploy                    |
| `POSTGRES_USER`                      | `staging.enc.env` | part 8               | `biddaloy`                                                                             |
| `POSTGRES_DB`                        | `staging.enc.env` | part 8               | prod `biddaloy`; staging must be `biddaloy_staging`; demo must be `biddaloy_demo`      |
| `POSTGRES_PASSWORD`                  | `staging.enc.env` | part 8               | openssl rand -hex 32                                                                   |
| `S3_BUCKET`                          | `staging.enc.env` | part 8               | prod `biddaloy`; staging must be `biddaloy-staging`; demo must be `biddaloy-demo`      |
| `S3_REGION`                          | `staging.enc.env` | part 8               | `us-east-1`                                                                            |
| `S3_ACCESS_KEY_ID`                   | `staging.enc.env` | part 8               | `openssl rand -hex 16`                                                                 |
| `S3_SECRET_ACCESS_KEY`               | `staging.enc.env` | part 8               | openssl rand -hex 32                                                                   |
| `DB_SSL_REJECT_UNAUTHORIZED`         | `staging.enc.env` | part 8               | leave empty                                                                            |
| `JWT_SECRET`                         | `staging.enc.env` | part 8               | openssl rand -hex 32                                                                   |
| `JWT_SECRET_PREVIOUS`                | `staging.enc.env` | the deploy / default | leave empty until you rotate                                                           |
| `SETTINGS_ENCRYPTION_KEY`            | `staging.enc.env` | part 8               | `openssl rand -base64 32`                                                              |
| `SETTINGS_ENCRYPTION_KEY_PREVIOUS`   | `staging.enc.env` | the deploy / default | leave empty until you rotate                                                           |
| `HEALTH_TOKEN`                       | `staging.enc.env` | part 8               | openssl rand -hex 32                                                                   |
| `STAGING_PASSWORD`                   | `staging.enc.env` | part 8               | at least 12 characters: `openssl rand -hex 16`                                         |
| `BACKUP_AGE_PUBLIC_KEY`              | `staging.enc.env` | part 9               | `age1qz...` (public half of the backup key)                                            |
| `BACKUP_AGE_PRIVATE_KEY`             | `staging.enc.env` | part 9               | `AGE-SECRET-KEY-1...` (staging only)                                                   |
| `BACKUP_S3_ENDPOINT`                 | `staging.enc.env` | part 4               | `https://<account-id>.r2.cloudflarestorage.com`                                        |
| `BACKUP_S3_BUCKET`                   | `staging.enc.env` | part 4               | `biddaloy-backups`                                                                     |
| `BACKUP_S3_ACCESS_KEY_ID`            | `staging.enc.env` | part 4               | R2 token 1 (prod, read+write) or token 2 (staging, read-only)                          |
| `BACKUP_S3_SECRET_ACCESS_KEY`        | `staging.enc.env` | part 4               | same token as the key id above                                                         |
| `BACKUP_PUSH_URL`                    | `staging.enc.env` | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `RESTORE_DRILL_PUSH_URL`             | `staging.enc.env` | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `SENTRY_CRON_MONITOR_URL`            | `staging.enc.env` | part 6               | Sentry cron monitor check-in URL (optional)                                            |
| `BACKUP_SCHEDULE`                    | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_RETENTION_DAYS`              | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_HOURLY_KEEP`                 | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_DAILY_KEEP`                  | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_TRASH_DAYS`                  | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_FILES_MAX_DELETE`            | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_NET_WAIT_SECS`               | `staging.enc.env` | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `BACKUP_MEM`                         | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `BACKUP_CPUS`                        | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `JOBS_MEM`                           | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `JOBS_CPUS`                          | `staging.enc.env` | the deploy / default | leave the example value or empty (D23)                                                 |
| `TURNSTILE_SITE_KEY`                 | `staging.enc.env` | part 4               | prod/demo: widget site key; staging/demo example already holds the test pair           |
| `TURNSTILE_SECRET_KEY`               | `staging.enc.env` | part 4               | prod: widget secret; staging/demo example already holds the test pair                  |
| `SENTRY_DSN`                         | `staging.enc.env` | part 6               | `https://<key>@o0.ingest.sentry.io/0` (server project)                                 |
| `SENTRY_DSN_WEB`                     | `staging.enc.env` | part 6               | `https://<key>@o0.ingest.sentry.io/1` (browser project)                                |
| `SENTRY_TRACES_SAMPLE_RATE`          | `staging.enc.env` | part 6               | `0.1`                                                                                  |
| `GOOGLE_OAUTH_CLIENT_ID`             | `staging.enc.env` | part 6               | Google Cloud console (prod only; staging stays empty)                                  |
| `GOOGLE_OAUTH_CLIENT_SECRET`         | `staging.enc.env` | part 6               | same console (prod only)                                                               |
| `FACEBOOK_OAUTH_CLIENT_ID`           | `staging.enc.env` | part 6               | Meta developers console (prod only)                                                    |
| `FACEBOOK_OAUTH_CLIENT_SECRET`       | `staging.enc.env` | part 6               | same console (prod only)                                                               |
| `SMS_PROVIDER`                       | `staging.enc.env` | part 6               | registered SMS provider name, e.g. `onecodesoft` (prod only; staging stays empty)      |
| `GREENWEB_API_KEY`                   | `staging.enc.env` | part 6               | key if that provider is chosen (prod only; staging stays empty)                        |
| `GREENWEB_API_URL`                   | `staging.enc.env` | part 6               | optional gateway URL; empty uses Greenweb's own (prod only; staging stays empty)       |
| `MIMSMS_API_KEY`                     | `staging.enc.env` | part 6               | key if that provider is chosen (prod only; staging stays empty)                        |
| `MIMSMS_SENDER_ID`                   | `staging.enc.env` | part 6               | sender id if that provider is chosen (prod only; staging stays empty)                  |
| `MIMSMS_API_URL`                     | `staging.enc.env` | part 6               | optional gateway URL; empty uses MimSMS's own (prod only; staging stays empty)         |
| `ONECODESOFT_API_KEY`                | `staging.enc.env` | part 6               | key if that provider is chosen (prod only; staging stays empty)                        |
| `ONECODESOFT_SENDER_ID`              | `staging.enc.env` | part 6               | sender id if that provider is chosen (prod only; staging stays empty)                  |
| `ONECODESOFT_API_URL`                | `staging.enc.env` | part 6               | gateway HTTP API URL (prod only; staging stays empty)                                  |
| `PLATFORM_SMS_PROVIDER`              | `staging.enc.env` | part 6               | provider name your gateway uses (deprecated, read until the next release; prod only)   |
| `PLATFORM_SMS_API_KEY`               | `staging.enc.env` | part 6               | gateway API key (deprecated, read until the next release; prod only)                   |
| `PLATFORM_SMS_SENDER_ID`             | `staging.enc.env` | part 6               | sender id approved by the gateway (deprecated, read until the next release; prod only) |
| `PLATFORM_SMS_API_URL`               | `staging.enc.env` | part 6               | gateway HTTP API URL (deprecated, read until the next release; prod only)              |
| `PLATFORM_ALERT_PHONES`              | `staging.enc.env` | part 6               | `+8801700000000,+8801800000000`                                                        |
| `OTP_SMS_ALLOWED_PREFIXES`           | `staging.enc.env` | the deploy / default | leave empty (default `+880`)                                                           |
| `SMOKE_SCHOOL_SLUG`                  | `staging.enc.env` | part 11              | slug of the Smoke Test School, e.g. `smoke-test`                                       |
| `SMOKE_ADMIN_EMAIL`                  | `staging.enc.env` | part 11              | login you create in part 11                                                            |
| `SMOKE_ADMIN_PASSWORD`               | `staging.enc.env` | part 11              | `openssl rand -hex 16`; staging must equal `STAGING_PASSWORD`                          |
| `SMOKE_TEACHER_EMAIL`                | `staging.enc.env` | part 11              | login you create in part 11                                                            |
| `SMOKE_TEACHER_PASSWORD`             | `staging.enc.env` | part 11              | `openssl rand -hex 16`; staging must equal `STAGING_PASSWORD`                          |
| `SMOKE_SUPER_ADMIN_EMAIL`            | `staging.enc.env` | part 11              | the platform super admin login                                                         |
| `SMOKE_SUPER_ADMIN_PASSWORD`         | `staging.enc.env` | part 11              | its password; staging must equal `STAGING_PASSWORD`                                    |
| `STAGING_PASSWORD_HASH_B64`          | `staging.enc.env` | part 8               | base64 of the bcrypt cost-12 hash of `STAGING_PASSWORD` (see part 8, step 4)           |
| `STAGING_REFRESH_DEADLINE`           | `staging.enc.env` | the deploy / default | leave empty (default 02:50)                                                            |
| `ENV_NAME`                           | `demo.enc.env`    | part 7               | already filled in the example (`demo`)                                                 |
| `DEMO_MODE`                          | `demo.enc.env`    | part 8               | leave the example value                                                                |
| `APP_VERSION`                        | `demo.enc.env`    | the deploy / default | leave empty; the deploy sets it                                                        |
| `APP_MEM`                            | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_MEM`                             | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_MEM`                          | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_MEM`                             | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_CPUS`                           | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `PG_CPUS`                            | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `REDIS_CPUS`                         | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `S3_CPUS`                            | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_BASE_URL`                       | `demo.enc.env`    | part 8               | `https://app.schoolmanagerp.com` (no trailing slash)                                   |
| `PUBLIC_APP_URL`                     | `demo.enc.env`    | part 8               | same as `APP_BASE_URL`                                                                 |
| `CORS_ORIGINS`                       | `demo.enc.env`    | part 8               | same origin as `APP_BASE_URL`                                                          |
| `SUPPORT_CONTACT_URL`                | `demo.enc.env`    | part 8               | `https://wa.me/8801XXXXXXXXX`                                                          |
| `POSTGRES_USER`                      | `demo.enc.env`    | part 8               | `biddaloy`                                                                             |
| `POSTGRES_DB`                        | `demo.enc.env`    | part 8               | prod `biddaloy`; staging must be `biddaloy_staging`; demo must be `biddaloy_demo`      |
| `POSTGRES_PASSWORD`                  | `demo.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `S3_BUCKET`                          | `demo.enc.env`    | part 8               | prod `biddaloy`; staging must be `biddaloy-staging`; demo must be `biddaloy-demo`      |
| `S3_REGION`                          | `demo.enc.env`    | part 8               | `us-east-1`                                                                            |
| `S3_ACCESS_KEY_ID`                   | `demo.enc.env`    | part 8               | `openssl rand -hex 16`                                                                 |
| `S3_SECRET_ACCESS_KEY`               | `demo.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `DB_SSL_REJECT_UNAUTHORIZED`         | `demo.enc.env`    | part 8               | leave empty                                                                            |
| `JWT_SECRET`                         | `demo.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `JWT_SECRET_PREVIOUS`                | `demo.enc.env`    | the deploy / default | leave empty until you rotate                                                           |
| `SETTINGS_ENCRYPTION_KEY`            | `demo.enc.env`    | part 8               | `openssl rand -base64 32`                                                              |
| `SETTINGS_ENCRYPTION_KEY_PREVIOUS`   | `demo.enc.env`    | the deploy / default | leave empty until you rotate                                                           |
| `HEALTH_TOKEN`                       | `demo.enc.env`    | part 8               | openssl rand -hex 32                                                                   |
| `DEMO_PASSWORD`                      | `demo.enc.env`    | part 8               | `openssl rand -hex 16`                                                                 |
| `DEMO_RESET_PUSH_URL`                | `demo.enc.env`    | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `SENTRY_CRONS_URL`                   | `demo.enc.env`    | part 6               | Sentry crons check-in URL (optional)                                                   |
| `DEMO_SWEEP_CMD`                     | `demo.enc.env`    | part 8               | set this or `DEMO_SKIP_SWEEP`; start with `DEMO_SKIP_SWEEP=true`                       |
| `DEMO_SKIP_SWEEP`                    | `demo.enc.env`    | part 8               | `true`                                                                                 |
| `DEMO_SWEEP_URL`                     | `demo.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `DEMO_SWEEP_TIMEOUT`                 | `demo.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `DEMO_SCALE`                         | `demo.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `DEMO_YEARS`                         | `demo.enc.env`    | the deploy / default | leave empty (default in `deploy/stack.yml`)                                            |
| `DEMO_RESET_MEM`                     | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `DEMO_RESET_CPUS`                    | `demo.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `TURNSTILE_SITE_KEY`                 | `demo.enc.env`    | part 4               | prod/demo: widget site key; staging/demo example already holds the test pair           |
| `TURNSTILE_SECRET_KEY`               | `demo.enc.env`    | part 4               | prod: widget secret; staging/demo example already holds the test pair                  |
| `SENTRY_DSN`                         | `demo.enc.env`    | part 6               | `https://<key>@o0.ingest.sentry.io/0` (server project)                                 |
| `SENTRY_DSN_WEB`                     | `demo.enc.env`    | part 6               | `https://<key>@o0.ingest.sentry.io/1` (browser project)                                |
| `SENTRY_TRACES_SAMPLE_RATE`          | `demo.enc.env`    | part 6               | `0.1`                                                                                  |
| `SMS_PROVIDER`                       | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `GREENWEB_API_KEY`                   | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `GREENWEB_API_URL`                   | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `MIMSMS_API_KEY`                     | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `MIMSMS_SENDER_ID`                   | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `MIMSMS_API_URL`                     | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `ONECODESOFT_API_KEY`                | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `ONECODESOFT_SENDER_ID`              | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `ONECODESOFT_API_URL`                | `demo.enc.env`    | part 6               | leave empty (config:check refuses a value on demo)                                     |
| `EDGE_MODE`                          | `edge.enc.env`    | part 4               | `tunnel` (`direct` in part 14)                                                         |
| `NGINX_MEM`                          | `edge.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `NGINX_CPUS`                         | `edge.enc.env`    | the deploy / default | leave the example value or empty (D23)                                                 |
| `APP_DOMAIN`                         | `edge.enc.env`    | part 4               | `app.schoolmanagerp.com`                                                               |
| `STAGING_DOMAIN`                     | `edge.enc.env`    | part 4               | `staging.schoolmanagerp.com`                                                           |
| `DEMO_DOMAIN`                        | `edge.enc.env`    | part 4               | `demo.schoolmanagerp.com`                                                              |
| `INBOX_DEMO_DOMAIN`                  | `edge.enc.env`    | part 4               | `inbox-demo.schoolmanagerp.com` (public Mailpit UI, no login)                          |
| `INBOX_STAGING_DOMAIN`               | `edge.enc.env`    | part 4               | `inbox-staging.schoolmanagerp.com` (behind the Staging Access app)                     |
| `LANDING_DOMAIN`                     | `edge.enc.env`    | part 4               | `schoolmanagerp.com`                                                                   |
| `KUMA_DOMAIN`                        | `edge.enc.env`    | part 4               | `kuma.schoolmanagerp.com`                                                              |
| `BESZEL_DOMAIN`                      | `edge.enc.env`    | part 4               | `beszel.schoolmanagerp.com`                                                            |
| `LOGS_DOMAIN`                        | `edge.enc.env`    | part 4               | `logs.schoolmanagerp.com`                                                              |
| `OPS_UPSTREAM_HOST`                  | `edge.enc.env`    | part 8               | `uptime-kuma` (any non-empty value; empty = ops is on another host)                    |
| `LANDING_VERSION`                    | `edge.enc.env`    | the deploy / default | leave empty; the deploy sets it                                                        |
| `CLOUDFLARE_TUNNEL_ID`               | `edge.enc.env`    | part 4               | uuid printed by `cloudflared tunnel create`                                            |
| `CLOUDFLARE_TUNNEL_CREDENTIALS_JSON` | `edge.enc.env`    | part 4               | the credentials JSON, on one line                                                      |
| `CF_ACCESS_TEAM`                     | `edge.enc.env`    | part 4               | `myteam` (from `myteam.cloudflareaccess.com`)                                          |
| `CF_ACCESS_AUD_STAGING`              | `edge.enc.env`    | part 4               | 64-hex Application Audience tag of the staging Access app                              |
| `CF_ACCESS_AUD_OPS`                  | `edge.enc.env`    | part 4               | 64-hex Application Audience tag of the ops Access app                                  |
| `BASIC_AUTH_HTPASSWD`                | `edge.enc.env`    | part 14              | `htpasswd -nbB user pass`; leave empty in tunnel mode                                  |
| `LETSENCRYPT_EMAIL`                  | `edge.enc.env`    | part 14              | `ops@schoolmanagerp.com`; leave empty in tunnel mode                                   |
| `GHCR_PULL_USER`                     | `edge.enc.env`    | part 5               | your GitHub username                                                                   |
| `GHCR_PULL_TOKEN`                    | `edge.enc.env`    | part 5               | classic PAT with only `read:packages`: `ghp_...`                                       |
| `TELEGRAM_BOT_TOKEN`                 | `edge.enc.env`    | part 6               | `123456:ABC...` from BotFather                                                         |
| `TELEGRAM_CHAT_ID`                   | `edge.enc.env`    | part 6               | `-1001234567890`                                                                       |
| `LOG_ARCHIVE_PUSH_URL`               | `edge.enc.env`    | part 11              | `https://kuma.schoolmanagerp.com/api/push/<token>`                                     |
| `LOG_ARCHIVE_S3_ENDPOINT`            | `edge.enc.env`    | part 4               | same as prod `BACKUP_S3_ENDPOINT`                                                      |
| `LOG_ARCHIVE_S3_BUCKET`              | `edge.enc.env`    | part 4               | `biddaloy-backups`                                                                     |
| `LOG_ARCHIVE_S3_ACCESS_KEY_ID`       | `edge.enc.env`    | part 4               | R2 token 1                                                                             |
| `LOG_ARCHIVE_S3_SECRET_ACCESS_KEY`   | `edge.enc.env`    | part 4               | R2 token 1                                                                             |
| `LOG_ARCHIVE_RCLONE_CRYPT_PASSWORD`  | `edge.enc.env`    | part 8               | same value as prod `BACKUP_RCLONE_CRYPT_PASSWORD`                                      |
| `LOG_ARCHIVE_RCLONE_CRYPT_SALT`      | `edge.enc.env`    | part 8               | same value as prod `BACKUP_RCLONE_CRYPT_SALT`                                          |
| `BESZEL_KEY`                         | `edge.enc.env`    | part 11              | public key from the Beszel hub "Add system"; same value in `edge` and `ops`            |
| `BESZEL_KEY`                         | `ops.enc.env`     | part 11              | public key from the Beszel hub "Add system"; same value in `edge` and `ops`            |
| `DOZZLE_USERS_YML`                   | `ops.enc.env`     | part 11              | the whole `users.yml` on one line, `\n` for newlines                                   |
| `BESZEL_MEM`                         | `ops.enc.env`     | the deploy / default | leave the example value or empty (D23)                                                 |
| `KUMA_MEM`                           | `ops.enc.env`     | the deploy / default | leave the example value or empty (D23)                                                 |
| `DOZZLE_MEM`                         | `ops.enc.env`     | the deploy / default | leave the example value or empty (D23)                                                 |

## Part 9. The age key for backups

Prod encrypts every database dump with a **public** age key. Whoever holds the **private**
half can read the backups, so it goes in two safe places only.

```bash
age-keygen -o backup.key
# Public key: age1qz8s...
```

| Half    | Goes to                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| public  | `prod.enc.env` `BACKUP_AGE_PUBLIC_KEY`, and `staging.enc.env` `BACKUP_AGE_PUBLIC_KEY`                                                            |
| private | `staging.enc.env` `BACKUP_AGE_PRIVATE_KEY` (D19; staging restores last night's dump with it) and your **offline vault** next to the recovery key |

Then delete `backup.key` from the laptop. The deploy writes the staging copy to
`/opt/biddaloy/staging/restore/key.txt` (owner uid 10001, mode 0400).

## Part 10. First deploy

Deploy runs **on the VM**. Your laptop (or GitHub) only logs in and runs `biddaloy-deploy`.

```mermaid
sequenceDiagram
  actor You
  participant L as scripts/deploy.sh (laptop)
  participant V as VM: biddaloy-deploy
  participant A as ansible deploy.yml
  You->>L: deploy all 3f9c2ab...
  L->>L: sha pushed to origin?
  L->>V: ssh deploy@VM "biddaloy-deploy all 3f9c2ab..."
  V->>V: lock, fetch, checkout sha
  V->>A: stack=edge, then ops*, staging, prod, demo
  A->>A: preflight, env files, pull, backup (prod), migrate, up, smoke
  A-->>You: PLAY RECAP, Telegram message
```

\* `ops` is deployed by `all` when the host is in the `ops` group. Provision writes the
host's groups to `/opt/biddaloy/host-groups`, and `biddaloy-deploy all` reads that file.

### The command

```bash
cd ~/Workspace-personal/biddaloy
git fetch origin && git checkout main && git pull
export BIDDALOY_HOST=203.0.113.10
scripts/deploy.sh all 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
```

`scripts/deploy.sh <stack|all> <sha> [--hotfix "reason"] [--skip-backup]` checks that the
sha is on origin, then runs the same `biddaloy-deploy` GitHub runs. `all` deploys in the
order **edge, ops (if in the host groups), staging, prod, demo**, and stops at the first
failure. Staging goes before prod so its "ok" line opens the prod gate.

Since the first sha is also the first prod deploy, no `--hotfix` is needed: staging runs
first inside `all` and writes its own ok line. (The older example in
`infra/ansible/README.md` that adds `--hotfix "first deploy"` is harmless, not required.)

### What each step prints

For every stack the playbook (`infra/ansible/deploy.yml`) goes through these steps, and a
failure names the one it stopped at:

| Step                  | What happens                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| inputs, checkout      | sha is 40 hex, the checkout is clean                                                                   |
| decrypt               | the host key opens the secrets                                                                         |
| settings              | required keys are filled (smoke logins, `BACKUP_AGE_PRIVATE_KEY` on staging, domains, tunnel on edge)  |
| staging-gate          | prod only: staging has an ok line for this sha, or `--hotfix`                                          |
| disk, registry, image | at least 10 GB free, GHCR login works, the sha image exists                                            |
| config-check          | `yarn config:check` on the new env                                                                     |
| networks, env         | creates `biddaloy-edge` (`172.30.0.0/24`) and `biddaloy-ops-edge`, writes `/opt/biddaloy/<stack>/.env` |
| pull, backup          | pulls images; prod backs up to R2 first (skipped on a truly fresh host)                                |
| migration             | runs pending migrations                                                                                |
| up, smoke             | starts the stack, waits for ready, logs in as the smoke accounts                                       |
| edge only             | nginx templates come from a snapshot at `/opt/biddaloy/edge/release`, not the live checkout            |

On the end of each stack:

```text
PLAY RECAP *****
localhost : ok=58 changed=21 unreachable=0 failed=0 skipped=9 rescued=0 ignored=0
```

and a line is added to `/opt/biddaloy/<stack>/deploys.log`:

```text
2026-10-23T08:14:09Z staging 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b ok
```

### If it fails

Every failure prints the same three lines and sends a Telegram message:

```text
FAILED at: image (staging, 3f9c2ab4e1d0)
Why:       manifest unknown: ghcr.io/tareq89/biddaloy-app:3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
Next:      check the Publish image run for 3f9c2ab4e1d0: gh run list -w publish-image.yml
```

The full output stays on the VM in `/opt/biddaloy/logs/<stack>-last-deploy.log`. Run the
`Next:` command (the doctor's `Next:` lines carry the full `docker compose -p ... -f ...`
flags; the short `docker compose -p prod logs app` in a deploy message needs them added, see
the `dcp` helper in [11a](#11a-platform-super-admin)), fix, and rerun the same `scripts/deploy.sh` line. Common first-time
failures:

| `FAILED at` | Usual cause                                                               | Next                                                                  |
| ----------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `clone`     | the repo deploy key is not added to GitHub                                | part 5a, then rerun                                                   |
| `decrypt`   | the host age key is not in `.sops.yaml` or files were not updated         | `sops updatekeys infra/secrets/<file>` for each, commit, merge, rerun |
| `settings`  | a key named in `Why:` is empty                                            | `sops infra/secrets/<file>`, fix, commit, merge, rerun                |
| `registry`  | `GHCR_PULL_USER` / `GHCR_PULL_TOKEN` wrong or token lacks `read:packages` | part 5b                                                               |
| `image`     | Publish images did not finish for that sha                                | `gh run list -w publish-image.yml`                                    |

> **First install and the smoke test.** `prod` and `staging` deploys end by logging in as
> the `SMOKE_*` accounts. On a brand-new database (zero users) those accounts cannot exist
> yet, so the deploy runs the health checks only. It prints a `WARNING: smoke login checks
SKIPPED` line and writes `note: smoke-login-skipped` on the `deploys.log` line and in
> Telegram. So `all` works on the first install, in this order: edge, ops, staging, prod,
> demo. After part 11, redeploy prod and staging so the login checks run. The first `demo`
> deploy runs `reset.sh --now` by itself to build the demo school.
> Still open: nothing creates the first platform super admin ([Known gaps](#known-gaps) #1).
> **UNVERIFIED on a real VM.**

Now run the doctor, a read-only health table:

```bash
ssh deploy@203.0.113.10 biddaloy-doctor
# (format: CHECK  STATUS  DETAIL, and an indented "Next: <command>" under every WARN or FAIL;
#  the exact rows depend on your host, so this is the shape, not real output)
```

Exit code: `0` all OK, `1` a WARN, `2` a FAIL. One stack: `biddaloy-doctor prod` (also
`staging`, `demo`, `edge`). Machine-readable: `biddaloy-doctor --json`.

### 10b. Deploy the test inbox (Epic 87), staging and demo

> বাংলায় পড়ুন: [bn/test-inbox-deploy.md](bn/test-inbox-deploy.md), আর staging সহ একসাথে: [runbook-bn/staging-and-test-inbox.md](runbook-bn/staging-and-test-inbox.md).

Staging and demo send every email, SMS, WhatsApp and Messenger message to one Mailpit inbox,
so nothing reaches a real person. Prod never runs it. Do this once, in this order:

```mermaid
flowchart TD
    Z["0. Laptop: pull main, set BIDDALOY_HOST"] --> A["1. Edit staging.enc.env and demo.enc.env"]
    A --> B["2. Edit edge.enc.env: two INBOX_* keys"]
    B --> C["3. Cloudflare: DNS + Access"]
    C --> D["4. Merge to main, wait for Publish images, deploy edge"]
    D --> E["5. Deploy staging, then demo"]
    E --> F["6. Check the inbox"]
```

**0. Before you start.** Work from an up-to-date `main`, and put your VM's address in a variable
once. Every command below reads it, so you never type the address again.

```bash
git checkout main && git pull --ff-only
export BIDDALOY_HOST=203.0.113.10   # your VM's public IP
```

> **Never type `<...>` in a command.** In zsh, `<` reads a file, so a pasted
> `ssh deploy@<vm-ip>` fails with `zsh: no such file or directory: vm-ip`. Every command in
> this part uses `$BIDDALOY_HOST` and `$SHA` instead of placeholders.

**1. Stack env files** (`sops infra/secrets/staging.enc.env`, then `demo.enc.env`). Config-check
refuses a deploy that is missing any of these:

```text
MESSAGE_SINK=mailpit
COMPOSE_PROFILES=sink                     # starts the mailpit container; keep other profiles you have
MESSAGE_SINK_PUBLIC_URL=https://inbox-staging.schoolmanagerp.com   # demo: https://inbox-demo.schoolmanagerp.com
SMOKE_INBOX_API_URL=http://staging-mailpit:8025                    # staging only; adds the smoke `inbox` check
```

Optional check before you commit (needs `yarn install`; the VM runs the same check anyway):

```bash
sops -d infra/secrets/staging.enc.env | yarn config:check --env staging --file /dev/stdin
sops -d infra/secrets/demo.enc.env    | yarn config:check --env demo    --file /dev/stdin
```

**2. Edge env** (`sops infra/secrets/edge.enc.env`): set `INBOX_DEMO_DOMAIN=inbox-demo.schoolmanagerp.com`
and `INBOX_STAGING_DOMAIN=inbox-staging.schoolmanagerp.com`. Without both, the edge preflight fails.

**3. Cloudflare** (part 4c and 4d): two proxied CNAMEs (`inbox-demo`, `inbox-staging`) to the tunnel,
and `inbox-staging` added to the `Staging` Access app. `inbox-demo` is public on purpose. The names
are single-level: `inbox-demo.`, never `inbox.demo.`.

```bash
for h in inbox-demo.schoolmanagerp.com inbox-staging.schoolmanagerp.com; do
  cloudflared tunnel route dns biddaloy "$h"
done
```

**4. Merge, wait for images, deploy edge.** Commit the three `.enc.env` files, merge to `main`, and
wait for **Publish images** to go green. The VM reads the secrets from the checkout of the sha you
deploy, so that sha must contain your edits.

```bash
gh run list -w publish-image.yml --limit 1   # wait for: completed success
git pull --ff-only && SHA=$(git rev-parse HEAD)
scripts/deploy.sh edge "$SHA"
```

`scripts/deploy.sh` refuses a sha that is not on GitHub yet, then runs `biddaloy-deploy` on the VM.
The edge deploy recreates cloudflared when the tunnel config changed (PR #3242), so the two new
hostnames reach nginx. The tunnel, prod included, drops for a few seconds.

> **Edge deployed before #3242 (merged 2026-10-29)?** Then the VM's tunnel config already has the
> inbox hosts, but cloudflared still runs the old one. Both inbox hosts answer an **empty** `404`,
> and the next edge deploy sees no change. Prove it, then restart once by hand:
>
> ```bash
> ssh deploy@$BIDDALOY_HOST 'grep -n inbox /opt/biddaloy/edge/cloudflared/config.yml; stat -c %y /opt/biddaloy/edge/cloudflared/config.yml; docker inspect -f "{{.State.StartedAt}}" $(docker ps -qf name=cloudflared)'
> ```
>
> Two `inbox` lines, and a container start time **older** than the file time, means it is stale:
>
> ```bash
> ssh deploy@$BIDDALOY_HOST 'docker restart $(docker ps -qf name=cloudflared)'
> ```
>
> Real example (2026-10-29): the file changed `2026-10-29 11:12 +0600`, the container started
> `2026-10-22T17:47Z`. After the restart `/readyz` answered `200`. Prod blips for a few seconds.

**5. Deploy the stacks.** Same `$SHA`, staging first. The deploy starts mailpit itself; no manual
`docker compose` needed.

```bash
scripts/deploy.sh staging "$SHA"
scripts/deploy.sh demo "$SHA"
```

**6. Check.**

| Check                                                                                   | Expected                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `curl -s -o /dev/null -w '%{http_code}\n' https://inbox-demo.schoolmanagerp.com/readyz` | `200`                                                    |
| `curl -sI https://inbox-staging.schoolmanagerp.com/`                                    | `302` to `<team>.cloudflareaccess.com` (no page)         |
| Open `https://inbox-staging.schoolmanagerp.com` in a browser, sign in                   | the Mailpit inbox, not a `404`                           |
| Staging deploy output                                                                   | `PASS ... inbox: ok`                                     |
| "Forgot password" on staging, with a real active account (see below)                    | the sign-in notice links to the inbox; the code is there |

The `302` comes from Cloudflare Access, before the tunnel. It does not prove the tunnel routes
the host, so always open the staging inbox once after signing in.

**What lands in the inbox.** Every medium arrives as an email in Mailpit, tagged by medium.
Mailpit lists a tag only once at least one message carries it, so an inbox with only SMS shows
only the `SMS` tag.

| Medium    | Tag         | Subject                                       | To                             |
| --------- | ----------- | --------------------------------------------- | ------------------------------ |
| Email     | `EMAIL`     | the real subject                              | the real email address         |
| SMS       | `SMS`       | `[SMS]`                                       | `<phone>@sms.sink.invalid`     |
| WhatsApp  | `WHATSAPP`  | `[WHATSAPP]`, or `[WhatsApp template <name>]` | `<phone>@sms.sink.invalid`     |
| Messenger | `MESSENGER` | `[MESSENGER]`                                 | `<recipient>@sms.sink.invalid` |

"Forgot password" picks the channel from what you typed and what is verified
(`recovery.service.ts`):

```mermaid
flowchart TD
    I["identifier typed"] --> U{"active account<br/>matches?"}
    U -->|no| N["nothing is sent<br/>(same 202, on purpose: Rule 18)"]
    U -->|"phone matched"| P{"phone verified, or<br/>no verified email?"}
    P -->|yes| S["SMS code"]
    P -->|no| L["email link"]
    U -->|"email matched"| E{"email verified, or<br/>no verified phone?"}
    E -->|yes| L
    E -->|no| S
```

So a random or unknown address puts nothing in the inbox, and an account with an unverified email
but a verified phone gets an SMS even when you typed the email. To see an `EMAIL` message, use an
active account whose email is verified, or one with no phone.

**If it fails.**

| You see                                           | Cause                                              | Fix                                                                                                    |
| ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `zsh: no such file or directory: vm-ip`           | a `<placeholder>` was typed literally              | set `BIDDALOY_HOST` (step 0) and use the commands as written                                           |
| `Unable to create '.git/index.lock': File exists` | a crashed git process left an empty lock           | check `pgrep -fl git` shows nothing, then `rm -f .git/index.lock`                                      |
| Deploy stops at `settings` or config-check        | a key from step 1 or 2 is missing                  | the `Why:` line names it; fix with `sops`, push, rerun the same deploy                                 |
| Inbox host answers an **empty** `404`             | cloudflared still runs the old tunnel config       | the check and restart in step 4                                                                        |
| Inbox host answers `502`                          | nginx reaches the host but not mailpit             | `ssh deploy@$BIDDALOY_HOST 'docker ps --format "{{.Names}} {{.Status}}" \| grep -iE "mailpit\|nginx"'` |
| Staging inbox: login works, then `404`            | same as the empty `404`                            | the check and restart in step 4                                                                        |
| Only the `SMS` tag, no email                      | forgot-password picked SMS for that account        | see the flowchart above; try an account with a verified email                                          |
| A random email puts nothing in the inbox          | no account matched, so nothing is sent (by design) | use a real active account                                                                              |

Rolling back leaves mailpit running on purpose.

**Staging with real providers (optional).** Staging alone may skip the inbox and send real
messages. In `staging.enc.env` set `ALLOW_REAL_PROVIDERS_ON_STAGING=true`, `MESSAGE_SINK=real`,
fill the provider keys, and remove `sink` from `COMPOSE_PROFILES`. Real contacts get real
messages, so do not copy prod data into staging while it is on. Demo and prod refuse the flag.

## Part 11. After the first deploy

### 11a. Platform super admin

The super admin belongs to the **platform school**, whose id is `PLATFORM_TENANT_ID` in
`prod.enc.env` and `staging.enc.env`. SUPER_ADMINs of that school get platform rights
(billing, alerts); everyone else does not.

**GAP:** there is no script in the repo that creates the first platform super admin on a
fresh prod database. The decision is the owner's: either insert the first user by hand in
Postgres, or add a one-off bootstrap command to the app. Whatever you choose, record the
login in `prod.enc.env` (`SMOKE_SUPER_ADMIN_EMAIL`, `SMOKE_SUPER_ADMIN_PASSWORD`). See
[Known gaps](#known-gaps) #1.

Find the platform school id and set it:

```bash
ssh deploy@203.0.113.10
# helper: run docker compose against one stack the way the deploy does
dcp() { docker compose -p "$1" --project-directory "/opt/biddaloy/$1" -f /opt/biddaloy/repo/deploy/stack.yml "${@:2}"; }
dcp prod exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT id, slug FROM schools"'
# 6f1c2a9e-0b7d-4c1e-9a55-2f3d8e4b7c10|default-school
```

Put the id in `PLATFORM_TENANT_ID` of `prod.enc.env` **and** `staging.enc.env`, then commit,
merge, and redeploy ([Part 12](#part-12-every-day-use)).

### 11b. The Smoke Test School (D20)

The smoke test needs a real school in prod with logins of its own, so staging (a copy of
prod) can run the same checks.

1. Open `https://app.schoolmanagerp.com/register` and register a school named
   **Smoke Test School**.
2. As the platform super admin, open the platform billing page and **grant the school seats**
   (D20), so its logins are not blocked.
3. In that school create a **teacher** account.
4. Write into `prod.enc.env` **and** `staging.enc.env`: `SMOKE_SCHOOL_SLUG` (lowercase
   letters, digits, dashes, e.g. `smoke-test-school`), `SMOKE_ADMIN_EMAIL/PASSWORD`,
   `SMOKE_TEACHER_EMAIL/PASSWORD`, `SMOKE_SUPER_ADMIN_EMAIL/PASSWORD`. In staging the
   passwords must be the same as `STAGING_PASSWORD`, because the staging load (`biddaloy-staging load`)
   resets every password to it.
5. Commit, merge, wait for Publish, then redeploy **prod**, then **staging**, at the new sha.

### 11c. Uptime Kuma

Open `https://kuma.schoolmanagerp.com` (Cloudflare login first, then Kuma's own). Create
the Kuma admin account the first time. Then add these monitors.

**Push monitors.** Kuma > **Add New Monitor** > type **Push**. Kuma shows a push URL; take
the token from it and build `https://kuma.schoolmanagerp.com/api/push/<token>` (the
public URL, so the VM's timers and containers can reach it; the Access bypass from 4d
makes it work).

| Monitor name           | Interval | Retries / grace | Token goes to                                            |
| ---------------------- | -------- | --------------- | -------------------------------------------------------- |
| `backup-hourly`        | 3600 s   | 900 s grace     | `prod.enc.env` `BACKUP_PUSH_URL`                         |
| `restore-drill`        | 93600 s  | none (26 h)     | `staging.enc.env` `RESTORE_DRILL_PUSH_URL`               |
| `demo-rebuild-nightly` | 86400 s  | 3600 s grace    | `demo.enc.env` `DEMO_RESET_PUSH_URL`                     |
| `log-archive-nightly`  | 86400 s  | 3600 s grace    | `prod.enc.env` and `edge.enc.env` `LOG_ARCHIVE_PUSH_URL` |

`staging.enc.env` also has `BACKUP_PUSH_URL`: leave it empty or give it its own push
monitor (the staging backup container pushes to it).

**HTTP monitors** (**Add New Monitor** > **HTTP(s)**):

| Name             | URL                                          | Notes                                                                       |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `app-public`     | `https://app.schoolmanagerp.com/api/health`  | retries 3 (alert after ~3 min)                                              |
| `demo-public`    | `https://demo.schoolmanagerp.com/api/health` |                                                                             |
| `landing-public` | `https://schoolmanagerp.com/`                |                                                                             |
| `app-tls-expiry` | `https://app.schoolmanagerp.com/`            | direct mode only (part 14): tick "Certificate Expiry Notification", 14 days |

Cloudflare renews TLS in tunnel mode, so the expiry monitor matters only in direct mode.

**Notifications.** Kuma > Settings > Notifications > **Setup Notification**:

- **Telegram:** bot token and chat id from part 6, tick **Default enabled** and **Apply on
  all existing monitors**.
- **SMS (webhook):** type **Webhook**, URL = your SMS gateway's HTTP API, body in the
  format the gateway documents (JSON or form). Attach it only to `app-public` and
  `backup-hourly`. The URL shape each gateway expects is in
  `server/src/modules/communications/providers/sms/*.gateway.ts`.

Put the push URLs into the secret files, commit, merge, Publish, redeploy the affected
stacks (prod, staging, demo, edge).

### 11d. Beszel

Open `https://beszel.schoolmanagerp.com`, create the admin. **Add System**: host
`/beszel_socket/beszel.sock` (the agent's unix socket; the port is ignored). Beszel shows a
public key. Put it in `ops.enc.env` **and** `edge.enc.env` as `BESZEL_KEY` (same value),
commit, merge, Publish, then redeploy `edge` and `ops` (the whole deploy; the agent restarts
until the key is set).

Alerts (hub > system > bell icon), as in [12-operations.md](12-operations.md#2-alert-thresholds):

| Signal | Threshold                |
| ------ | ------------------------ |
| CPU    | above 90% for 15 min     |
| Memory | above 90% for 10 min     |
| Disk   | above 80%                |
| Status | down (agent unreachable) |

Telegram for Beszel is a Shoutrrr URL in the hub settings:
`telegram://123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11@telegram?chats=-1001234567890`.

### 11e. Dozzle users

Dozzle (the live log viewer at `logs.`) has its own login. Make a `users.yml` with bcrypt
hashes, join it to one line with `\n` for newlines, and set it as `DOZZLE_USERS_YML` in
`ops.enc.env`:

```yaml
users:
  owner:
    name: Owner
    email: you@schoolmanagerp.com
    password: '$2y$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ0123'
```

```bash
htpasswd -nbB -C 12 owner 'a-long-password'     # prints owner:$2y$12$...; use the hash part
```

One line for the secret: `users:\n  owner:\n    name: Owner\n    email: ...`. The deploy renders it
to `/opt/biddaloy/ops/dozzle/users.yml`. Dozzle's exact file format is Dozzle's; see its
documentation for `users.yml`. **UNVERIFIED** here.

## Part 12. Every day use

### Deploy staging, then prod

Always the same sha, staging first. Prod refuses a sha staging has not passed (D10).

```mermaid
flowchart LR
  M["merge to main"] --> P["Publish images<br/>(wait for green)"]
  P --> S["deploy staging &lt;sha&gt;"]
  S --> T["click through staging"]
  T --> R["deploy prod &lt;sha&gt;"]
```

**From the laptop:**

```bash
export BIDDALOY_HOST=203.0.113.10
scripts/deploy.sh staging 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
scripts/deploy.sh prod    3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
```

**From GitHub:** repo > **Actions > Deploy > Run workflow**. The workflow runs from `main` only, and the VM refuses any sha that is not on `main`. The form has four fields:

| Field         | Value                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Branch        | `main` (the `production` environment allows only main)                                                         |
| Stack         | pick `staging`, `prod`, `demo`, `edge` or `ops`                                                                |
| sha           | the full 40-hex sha. Empty: for `prod` it is the last sha staging passed; for the others it is the branch head |
| hotfix_reason | prod only; see below                                                                                           |

or from the terminal: `gh workflow run deploy.yml -f stack=staging -f sha=3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b`.

The Actions summary shows only the three-line failure block and the Ansible recap; the full
log stays on the VM.

### Read a failure

```text
FAILED at: migrate (prod, 3f9c2ab4e1d0)
Why:       migration 1797000000000 failed: relation "fee_items" does not exist
Next:      biddaloy-doctor prod   ·   logs: docker compose -p prod logs app
```

- `FAILED at` is the step, `Why` is the reason, `Next` is what to run.
- If the stack was already running an older version, the deploy puts that version back
  (status `rolled-back` in `deploys.log`). **Migrations are not undone.**
- Exit codes of `biddaloy-deploy`: `0` ok, `1` failed, `2` refused (bad input),
  `75` another deploy is running (wait, rerun).

### Hotfix

A hotfix skips the "staging passed it first" gate. Use it only when you must ship now.

```bash
scripts/deploy.sh prod 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b --hotfix "login broken for all schools"
```

The reason is 3 to 200 characters of letters, digits, space and `. , : _ / -`. It travels
in the environment variable `BIDDALOY_HOTFIX_REASON`, never as an Ansible `-e` value (Ansible
would run a `{{ }}` in it as root), and is written to `deploys.log` and Telegram. Other
flag: `--skip-backup` skips the pre-deploy prod backup (only if you accept the risk).

### The nightly jobs

All times are Asia/Dhaka. Each ends in one Kuma push, so a silent failure turns into an alert.

| Time       | Job                                                  | Kuma monitor           |
| ---------- | ---------------------------------------------------- | ---------------------- |
| every hour | prod backup to R2 (02:00 also keeps the daily copy)  | `backup-hourly`        |
| 02:20      | restore drill (restore, scrub, migrate, smoke, drop) | `restore-drill`        |
| 03:00      | demo rebuild                                         | `demo-rebuild-nightly` |
| 04:00      | log archive to R2                                    | `log-archive-nightly`  |

Run one by hand and read its result:

```bash
ssh deploy@203.0.113.10
sudo systemctl start biddaloy-nightly@restore-drill.service    # or demo-rebuild, log-archive
journalctl -u 'biddaloy-nightly@*' --since today --no-pager | tail -20
systemctl list-timers 'biddaloy-nightly@*'
```

### Staging: dev, staging and the nightly drill

> বাংলায় পড়ুন: [runbook-bn/staging-and-test-inbox.md](runbook-bn/staging-and-test-inbox.md).

Staging used to be replaced with a fresh copy of prod every night. It no longer is (Epic 88).
Now staging has **two databases**, you choose when to load a prod copy, and a separate **nightly
drill** proves that restoring a backup still works. This page is the one place that explains all
three. The why is in [13-backup-restore.md](13-backup-restore.md#the-nightly-restore-drill-proves-restores).

**Words used here.** _Backup:_ an encrypted prod copy in R2 (24 hourly and 14 daily ones are
listed). _Scrub:_ replacing real names, phones and emails with fakes. _Active db:_ the database the
staging app is connected to right now. _Drill:_ restore a backup into a throwaway database and
throw it away.

```mermaid
flowchart TD
  subgraph VM["Staging Postgres (one server, three databases)"]
    DEV[("biddaloy_staging_dev<br/>empty, migrated<br/>app default")]
    STG[("biddaloy_staging<br/>scrubbed prod copy<br/>loaded by hand")]
    DRILL[("biddaloy_staging_drill<br/>throwaway<br/>exists only while a job runs")]
  end
  R2[("R2 backups<br/>24 hourly + 14 daily")]
  R2 -->|"load: restore + scrub into drill db, then swap"| STG
  R2 -->|"02:20 nightly drill: restore + scrub + migrate + smoke, then drop"| DRILL
  APP["staging app"] -->|"active-db = dev (default)"| DEV
  APP -.->|"active-db = staging<br/>(use staging)"| STG
```

- **dev** (default): empty and migrated. Use it to try new code with no real-looking data. The
  app header shows a `DEV` badge.
- **staging**: a scrubbed copy of one prod backup. Use it to see how new code meets real shapes of
  data. The badge shows `STAGING` and the backup date. It is **empty until you load a backup**, and
  `use staging` is refused while it is empty.
- **The drill** never touches either of them. It is the restore proof, not a way to fill staging.

#### The commands

One command does all of it: `biddaloy-staging <verb>`. It runs on the VM, as the `deploy` user.
There are three ways to reach it. All three run the same code.

| Way         | How                                                                                              | Good for                                       |
| ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| On the VM   | `ssh deploy@$BIDDALOY_HOST`, then `biddaloy-staging status`                                      | everything, with prompts                       |
| From laptop | `BIDDALOY_HOST=$BIDDALOY_HOST scripts/staging.sh status` (`ssh -t` under the hood)               | everything, with prompts (the pick list works) |
| From GitHub | **Actions > Staging > Run workflow**, pick an action (needs [part 5e](#5e-staging-workflow-key)) | no terminal; no pick list, so give a key       |

```mermaid
flowchart LR
  L["laptop<br/>scripts/staging.sh"] -->|"ssh as deploy"| BS["biddaloy-staging"]
  V["on the VM"] --> BS
  G["GitHub Staging workflow<br/>STAGING_SSH_KEY"] -->|"forced command:<br/>--from-github"| BS
  BS --> P[("staging Postgres, Redis, bucket")]
```

The GitHub key can run **only** these exact forms, nothing else: `status`, `backups`,
`load <key> --yes [--use]`, `use dev|staging --yes`, `clean-dev --yes`. A list number is not
accepted there (use `backups` first, then give the key). Mutating verbs run detached, so closing
the browser tab does not stop them half way.

Each example below is the shape of the real output. Dates, sizes and shas are made up.

**`status`**: read-only. What is active, what is loaded, the last drill, the last five changes.

```bash
biddaloy-staging status
# active db:     dev (biddaloy_staging_dev)
# loaded backup: 2026-10-28
# staging sha:   3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
# last drill:    2026-10-29T02:31:07+0600 duration=642s schools=12 users=1480 students=9120
# history (last 5):
#   2026-10-28T09:14:02Z deploy load db/daily/2026-10-28.dump.age ok
```

**`backups`**: read-only. The 24 newest hourly and 14 newest daily dumps, numbered.

```bash
biddaloy-staging backups
#  No.  Backup (UTC date, size)
#    1  db/hourly/20261029T060011Z.dump.age   2026-10-29 06:00:41 41.3 MB
#    2  db/hourly/20261029T050010Z.dump.age   2026-10-29 05:00:39 41.2 MB
#   ...
#   25  db/daily/2026-10-29.dump.age          2026-10-29 02:00:52 41.0 MB
# Next: biddaloy-staging load <number>   (add --use to switch the app to it)
```

**`load`**: put a scrubbed copy of one backup into `biddaloy_staging`. Pick by number, by key, or
`latest-daily` / `latest-hourly`. With no argument it shows the list and asks. A number given as an
argument picks from the list `backups` printed last (saved in `staging/backups-list`), never a fresh
one, so a dump that lands in between cannot change which backup `3` means. With no saved list a
number is refused.

```bash
biddaloy-staging load latest-daily --use
# Load db/daily/2026-10-29.dump.age (written 2026-10-29) into biddaloy_staging and switch the app to it. Type yes to go on: yes
# 2026-10-29T10:05:02+0600 biddaloy-staging: loading db/daily/2026-10-29.dump.age (written 2026-10-29)
# step: refresh (into the scratch database biddaloy_staging_drill, not biddaloy_staging)
# step: swap
# step: migrate biddaloy_staging
# step: flush-redis
# step: deploy staging 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
# 2026-10-29T10:12:44+0600 biddaloy-staging: done: the app now serves staging (biddaloy_staging). Next: biddaloy-staging status
```

What `load` does: it restores and **scrubs in the scratch database first**, then swaps it in as
`biddaloy_staging`. The old one stays as `biddaloy_staging_prev`. If it fails before the swap,
nothing changed. If the app is serving staging, it is stopped briefly around the swap. `--use`
also switches the app to the loaded copy. `--yes` skips the prompt (the GitHub way always uses it).

**`use dev|staging`**: point the app at one database. It migrates that database, flushes Redis,
writes `/opt/biddaloy/staging/active-db`, then redeploys the same sha.

```bash
biddaloy-staging use dev
# Switch the staging app to dev (it restarts and Redis is flushed). Type yes to go on: yes
# step: migrate biddaloy_staging_dev
# step: flush-redis
# step: deploy staging 3f9c2ab4e1d07a5b6c8f9e0d1a2b3c4d5e6f7a8b
# 2026-10-29T10:20:03+0600 biddaloy-staging: done: the app now serves dev (biddaloy_staging_dev). Next: biddaloy-staging status

biddaloy-staging use staging       # while biddaloy_staging is empty:
# REFUSED: biddaloy_staging is empty (D18): load a backup first
# Next: biddaloy-staging load   (pick a backup; add --use to switch right after)
# Nothing was modified.
```

**`clean-dev`**: reset dev. It recreates `biddaloy_staging_dev` empty, empties the dev bucket and
migrates. It cannot touch `biddaloy_staging`. If dev is the active db, the app stops briefly.

```bash
biddaloy-staging clean-dev --yes
# step: stop-app
# step: recreate-db
# step: empty-bucket
# step: migrate
# step: flush-redis
# 2026-10-29T10:31:10+0600 biddaloy-staging: done: biddaloy_staging_dev is empty and migrated. Next: biddaloy-staging status
```

Exit codes: `0` ok, `1` a step failed, `2` refused (nothing was changed). Every refusal and failure
prints four lines you can act on: `FAILED at:` or `REFUSED:`, `Why:`, `State:` (what is changed
right now), `Next:` (the command to run). Locks: it waits up to an hour for a running deploy or
nightly job, so two jobs never overlap. Every change adds a line to `/opt/biddaloy/staging/history.log`.

#### The nightly drill

At 02:20 Asia/Dhaka, `biddaloy-nightly restore-drill` restores the newest **daily** backup into
`biddaloy_staging_drill`, scrubs it, migrates it with the staging image, runs the smoke test on a
one-off app and drops it. It never stops or swaps the live staging app. It skips itself (and
reports `down`) if less than 1 GB of RAM is free. It always ends in one Kuma push on the
`restore-drill` monitor.

```mermaid
flowchart LR
  T["02:20 timer"] --> M{"1 GB RAM free?"}
  M -->|no| D1["Kuma: down, not enough memory"]
  M -->|yes| S["refresh: restore + scrub"] --> G["migrate"] --> K["smoke"] --> X["drop the drill db"]
  X --> U["write last-drill, Kuma: up"]
  S -.->|"any step fails"| D2["Kuma: down + the step name"]
  G -.-> D2
  K -.-> D2
```

A green night leaves one line in `/opt/biddaloy/staging/last-drill`, and `status` and
`biddaloy-doctor staging` show it. A failed night leaves yesterday's line.

**What an alert looks like.** The Telegram message comes from the Kuma monitor `restore-drill`:
`restore-drill is DOWN` with the message `refresh`, `migrate`, `smoke`, `guard` or
`not enough memory`. No push for 26 hours also turns it red (the timer did not run at all).

**When the drill fails.**

1. Read the step in the alert, then the log on the VM:

   ```bash
   journalctl -u biddaloy-nightly@restore-drill.service -n 200 --no-pager
   cat /opt/biddaloy/staging/last-drill        # yesterday's green line
   ```

2. `not enough memory`: nothing was changed. Check `free -m`, free some RAM, run it again.
3. `refresh`: usually the day's backup is not in R2 yet (the job waits until 02:50), or a new
   column is not scrubbed. Check `backup-hourly` in Kuma first.
4. `migrate`: tonight's prod data does not migrate with the staging code. Take it seriously: the
   same migration would fail on prod.
5. `smoke`: the data restores but the app cannot serve it.
6. Run it again by hand:

   ```bash
   sudo systemctl start biddaloy-nightly@restore-drill.service
   ```

7. Message `ok, warning: drill db not dropped` is green but needs a hand: drop the leftover
   `biddaloy_staging_drill` (steps in [12-operations.md, 3.10](12-operations.md)).

Staging users are never blocked by a failed drill. Only the restore proof is missing that night.

#### What is NOT verified on a real VM yet

Nothing in Epic 88 has run on a real VM. The code is tested with stand-ins
(`deploy/bin/test/biddaloy-staging.test.sh`: 122 checks pass). On go-live, check these first:

| Check this first                        | How                                                                                                                    | Why it is unproven                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The GitHub staging key (forced command) | Run **Actions > Staging** with `status`; it must show `active db: ...` and `exit status: 0`                            | the `authorized_keys` command line and `SSH_ORIGINAL_COMMAND` were only tested with stand-ins   |
| The `restore-drill` Kuma monitor        | Create the Push monitor (part 11c), set `RESTORE_DRILL_PUSH_URL`, run the drill once by hand, see the monitor go green | a monitor that never got a push is not the same as a monitor that works                         |
| The old systemd timer is gone           | `systemctl list-timers 'biddaloy-nightly@*'` must not list `staging-refresh`; run `provision.yml` once                 | the ansible task that retires `biddaloy-nightly@staging-refresh.timer` has not run on a real VM |
| A real `load` with the real backup      | `biddaloy-staging backups`, then `load latest-daily --use`, then open staging and check the `STAGING` badge date       | needs the real R2 token (read-only) and a real prod dump                                        |
| The memory guard on the real VM size    | run the drill while staging is up; confirm it does not run out of memory                                               | 1 GB free is a guess for the chosen VM size                                                     |

### Staging commands: what has been proven (Epic 88, wave 3)

What the `biddaloy-staging` commands (list backups, load, use, clean-dev, `--from-github`) have
been through so far, in plain words:

- **Proven with stand-ins.** `bash deploy/bin/test/biddaloy-staging.test.sh` runs every verb
  against fake `docker` and `biddaloy-deploy` programs. Result on 2026-10-29: `122 passed, 0 failed`.
  It checks the pick list, the refusals (empty staging db, bad key, bad verb) and the exact
  commands the GitHub key may run.
- **Learned:** `load` never fills `biddaloy_staging` directly. It builds the copy in the scratch
  database `biddaloy_staging_drill`, scrubs it, and only then swaps it in. So a failed load leaves the
  old staging as it was, and unscrubbed data is never in a database the app can reach.
- **Learned:** `use staging` is refused while `biddaloy_staging` is empty, and a switch that cannot
  flush Redis is aborted (the app is started again on the old database).
- **Not proven yet:** a run on a real Docker stack, and on a real VM. Those need the owner's test
  VM (Docker was not available for this ticket). The checklist is in [the staging part above](#what-is-not-verified-on-a-real-vm-yet).

### Where logs live

| What                  | Where                                                          |
| --------------------- | -------------------------------------------------------------- |
| Recent logs, live     | Dozzle: `https://logs.schoolmanagerp.com`                      |
| Last deploy output    | `/opt/biddaloy/logs/<stack>-last-deploy.log`                   |
| Deploy history        | `/opt/biddaloy/<stack>/deploys.log`                            |
| Older logs (180 days) | R2 bucket `biddaloy-backups`, folder `logs/<date>/`, encrypted |

Download and decrypt one day. The folder and file names are encrypted by rclone, so you
need the same crypt password and salt as in `prod.enc.env`
(`BACKUP_RCLONE_CRYPT_PASSWORD` / `_SALT`, or `LOG_ARCHIVE_RCLONE_CRYPT_*` if you set them):

```bash
umask 077; mkdir -p ~/r2logs && cd ~/r2logs
eval "$(sops -d ../path/to/infra/secrets/prod.enc.env | sed 's/^/export /')"   # or export the 6 values by hand
export RCLONE_CONFIG=$PWD/rclone.conf
{
  printf '[r2]\ntype = s3\nprovider = Cloudflare\nendpoint = %s\nregion = auto\nno_check_bucket = true\naccess_key_id = %s\nsecret_access_key = %s\n\n' \
    "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
  printf '[r2crypt]\ntype = crypt\nremote = r2:%s\nfilename_encryption = standard\npassword = %s\npassword2 = %s\n' \
    "$BACKUP_S3_BUCKET" "$(printf %s "$BACKUP_RCLONE_CRYPT_PASSWORD" | rclone obscure -)" "$(printf %s "$BACKUP_RCLONE_CRYPT_SALT" | rclone obscure -)"
} > rclone.conf
rclone copy r2crypt:logs/2026-10-22/ ./2026-10-22/
gunzip ./2026-10-22/*.log.gz && ls ./2026-10-22
# host.log   prod-app.log   nginx.log ...
```

This is the same config `scripts/backup/log-archive.sh` builds. Delete `rclone.conf` and the
exported variables afterwards. **UNVERIFIED** on a real bucket.

## Part 13. Switch VM or provider

Use this when the VM dies, is too small, or you change provider. The tunnel moves with
you; in tunnel mode **DNS does not change**.

```mermaid
flowchart TD
  A["1 Buy a new VM"] --> B["2 provision.yml<br/>(part 7; BIDDALOY_HOST = new IP)"]
  B --> C["3 Add the new host age key<br/>to .sops.yaml, sops updatekeys,<br/>commit, merge, Publish"]
  C --> D["4 deploy all &lt;sha&gt;"]
  D --> E["5 biddaloy-restore-prod<br/>(prod data from R2)"]
  E --> F["6 deploy prod &lt;sha&gt;"]
  F --> G["7 Move the traffic:<br/>stop cloudflared on the old VM<br/>(direct mode: change A records)"]
  G --> H["8 Keep the old VM 7 days, then delete"]
```

| #   | Step                                                                                                                                                                                                         | Time         | What users see                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------- |
| 1   | New VM, `ssh root@<new-ip> true`                                                                                                                                                                             | 10 min       | nothing                                                                   |
| 2   | `export BIDDALOY_HOST=<new-ip>` and run part 7 (both runs). New host age key and repo deploy key print                                                                                                       | 15 min       | nothing                                                                   |
| 3   | Add the new host age key to `.sops.yaml` (keep the old one for now), `sops updatekeys infra/secrets/<file>` for each of the 5 files, commit, merge, wait for Publish. Add the new repo deploy key to GitHub. | 10 min       | nothing                                                                   |
| 4   | `scripts/deploy.sh all <sha>` against the new IP (the new prod database is empty, so smoke login is skipped with a warning)                                                                                  | 20 to 40 min | nothing (old VM still serves)                                             |
| 5   | On the new VM, with the backup private key file (mode 0600, owner uid 10001): see below                                                                                                                      | 5 to 30 min  | nothing                                                                   |
| 6   | `scripts/deploy.sh prod <sha>`: backs up, migrates, starts, smokes                                                                                                                                           | 5 min        | nothing                                                                   |
| 7   | Stop traffic to the old VM and let the new one answer ([below](#step-7-move-the-traffic))                                                                                                                    | 1 to 5 min   | **writes between the last backup and now are lost; up to 1 hour of data** |
| 8   | Keep the old VM, powered on but not serving, for 7 days                                                                                                                                                      | 7 days       | nothing                                                                   |

### Step 5, restore prod data

Prepare the key file on the new VM (the script refuses anything else):

```bash
scp backup.key deploy@<new-ip>:/tmp/backup.key
ssh deploy@<new-ip>
sudo install -o 10001 -g 10001 -m 0400 /tmp/backup.key /opt/biddaloy/restore-key.txt && shred -u /tmp/backup.key
biddaloy-restore-prod --age-key-file /opt/biddaloy/restore-key.txt --from latest-daily \
  --yes-restore-prod biddaloy
# ... done. Next: biddaloy-deploy prod <sha>   (backs up, migrates, starts the app and smokes it)
```

- `--from` takes `latest-hourly`, `latest-daily`, or a key such as `db/hourly/20260922T200000Z.dump.age`.
  The `latest-*` choices only pick dumps newer than this VM's `prod_pgdata` volume was
  created, so a stale dump from before the VM existed is never picked. If the age cannot be
  read, pass an exact key.
- `--yes-restore-prod` must repeat the database name from `/opt/biddaloy/prod/.env` (`POSTGRES_DB`).
- It refuses a non-empty database, so a mistake cannot overwrite live data. `--skip-files`
  skips copying uploaded files; `--max-age-hours N` changes the freshness limit (default 36).
- It never starts the app. Step 6 does.
- Delete the key file afterwards: `shred -u /opt/biddaloy/restore-key.txt`.

### Step 7, move the traffic

- **Tunnel mode:** the new VM's `cloudflared` already uses the same tunnel credentials and
  id, so both VMs are connected to the same tunnel. To cut over, on the **old** VM stop
  the connector so Cloudflare sends everything to the new one:

  ```bash
  ssh deploy@<old-ip> 'docker stop edge-cloudflared-1'
  ```

  Nothing changes in DNS. To undo: `docker start edge-cloudflared-1` on the old VM.
  (While both connectors run, Cloudflare spreads requests across them; stop the old one
  right after step 6 so users do not hit the old database.)

- **Direct mode:** change the A records of the seven hostnames to the new IP at your DNS
  provider. Allow the record's TTL to pass; lower the TTL a day before.

After the cutover: `ssh deploy@<new-ip> biddaloy-doctor`, and look at `app-public` in Kuma.

**UNVERIFIED on a real VM** (wave 5): steps 2 to 7 end to end, and the "two connectors on
one tunnel" behaviour.

## Part 14. Switch to direct mode (BDIX, no Cloudflare)

Direct mode: the VM serves ports 80 and 443 itself, gets certificates from Let's Encrypt,
and staging/ops sit behind **basic auth** instead of Cloudflare Access.

| Part                  | Tunnel (now)      | Direct                                   |
| --------------------- | ----------------- | ---------------------------------------- |
| Public ports          | SSH only          | SSH, 80, 443                             |
| TLS                   | Cloudflare        | Let's Encrypt, auto-renew (HTTP-01)      |
| Staging and ops login | Cloudflare Access | nginx basic auth, then each tool's login |
| Moving VM             | DNS unchanged     | change A records                         |

Steps:

1. **DNS at the new provider.** A records for all seven names (and `www.`) pointing at the
   VM's public IPv4, for example `app.schoolmanagerp.com A 203.0.113.10`. They must resolve
   **before** the deploy, or Let's Encrypt fails.
2. **Inventory:** in `infra/ansible/inventory/prod.yml` set `edge_mode: direct`. This
   opens ports 80 and 443 in the firewall.
3. **`edge.enc.env`:** set `EDGE_MODE=direct`, `LETSENCRYPT_EMAIL=ops@schoolmanagerp.com`,
   and `BASIC_AUTH_HTPASSWD` (one bcrypt line per user; join several with `\n`):

   ```bash
   htpasswd -nbB owner 'a-long-password'
   # owner:$2y$05$k3m... -> BASIC_AUTH_HTPASSWD=owner:$2y$05$k3m...
   ```

   The tunnel keys can stay or be cleared; they are not used in direct mode.

4. Commit, merge, wait for Publish. **Re-provision** to open the firewall:

   ```bash
   cd infra/ansible && ansible-playbook provision.yml     # changed>0 (ufw), then again: changed=0
   ```

5. Deploy the edge: `scripts/deploy.sh edge <sha>`. The first start serves a short-lived
   self-signed certificate so nginx can answer Let's Encrypt's challenge, then certbot
   fetches the real one and nginx reloads.
6. Check:

   ```bash
   curl -sI https://app.schoolmanagerp.com/ | head -1     # HTTP/2 200
   echo | openssl s_client -connect app.schoolmanagerp.com:443 -servername app.schoolmanagerp.com 2>/dev/null \
     | openssl x509 -noout -issuer -enddate                # issuer: Let's Encrypt
   curl -sI https://staging.schoolmanagerp.com/ | head -1  # HTTP/2 401  (basic auth)
   ```

What changes for the Access-protected hosts: `staging.`, `kuma.`, `beszel.` and `logs.` now
ask for the **basic-auth** user and password first, then the tool's own login. Kuma's
`/api/push/*` path stays open (the job timers cannot log in).

**Turnstile still works without the Cloudflare proxy.** Turnstile is a separate widget
that talks to Cloudflare from the visitor's browser and from the app's server; it does not
need your site to be proxied. Verify: open `https://app.schoolmanagerp.com/register`; the
widget must render and a test sign-up must not show a Turnstile error. Add the TLS-expiry
Kuma monitor from part 11c.

**UNVERIFIED on a real VM** (wave 5, step 8): real Let's Encrypt issuance and the basic-auth
prompts.

## Part 15. Move ops to its own VM

Do this when budget allows: until ops has its own VM, **a dead VM pages nobody**, because
Kuma dies with it.

1. **Inventory.** In `infra/ansible/inventory/prod.yml` add a host and move `ops` to it:

   ```yaml
   all:
     children:
       ops:
         hosts:
           biddaloy-ops: # was biddaloy-1
     hosts:
       biddaloy-ops:
         ansible_host: 198.51.100.20
         ansible_user: deploy
   ```

2. **Provision the new host:** `ansible-playbook provision.yml -l biddaloy-ops -e ansible_user=root`
   (then once more without `-e`). Add its host age key to `.sops.yaml`, `sops updatekeys`
   on the five files (at least `ops.enc.env` and `edge.enc.env`), commit, merge, Publish.
3. **Deploy ops there:** `biddaloy-deploy ops <sha>` on the new VM.
4. **Remove ops from the first VM:** set `OPS_UPSTREAM_HOST=` (empty) in the first VM's
   `edge.enc.env` so nginx stops serving the ops names, redeploy `edge`, then on the first
   VM `docker compose -p ops --project-directory /opt/biddaloy/ops -f /opt/biddaloy/repo/deploy/ops.yml down`.
5. **Push URLs stay the same.** They point at `https://kuma.schoolmanagerp.com/api/push/<token>`,
   a hostname, so after the tunnel or DNS sends `kuma.` to the new VM nothing in the
   secret files changes. Restore Kuma's settings (monitors, notifications) from its
   backup, or re-create them with part 11c.

**UNVERIFIED, and not fully supported yet:** the inventory shape above matches
`group_vars/all.yml` (`ops_host: "{{ groups['ops'][0] }}"`), but a tunnel serving
`kuma.` to a second VM needs a second `cloudflared` there, and the repo has no ops-only
edge. Treat part 15 as a plan to confirm in wave 5 ([Known gaps](#known-gaps) #2).

## Part 16. Rotate a secret, lose a key

### Rotate a secret

1. `sops infra/secrets/prod.enc.env`, change the value. For `JWT_SECRET` and
   `SETTINGS_ENCRYPTION_KEY` first copy the old value into the matching `*_PREVIOUS`
   key, so nobody is signed out and nothing stored becomes unreadable.
2. Commit, merge to `main`, wait for Publish images.
3. Deploy the **new** sha: `scripts/deploy.sh staging <sha>` then `prod <sha>`. The deploy
   reads secrets from the checkout of that sha, so an old sha never carries the new value.
4. A database password also needs `ALTER ROLE` in Postgres before the deploy; per-secret
   steps: [12-operations.md section 8](12-operations.md).

### Lose the operator key (laptop lost)

```mermaid
flowchart TD
  A["Laptop lost"] --> B["Fetch the recovery key<br/>from the offline vault"]
  B --> C["On a clean machine:<br/>sops -d proves it opens the files"]
  C --> D["age-keygen a new operator key"]
  D --> E["Edit .sops.yaml: replace the old<br/>operator key with the new public key"]
  E --> F["sops updatekeys on all 5 files"]
  F --> G["Assume the old key is stolen:<br/>rotate every secret, commit, deploy"]
```

```bash
HOME=$(mktemp -d) SOPS_AGE_KEY_FILE=/Volumes/usb/recovery.txt sops -d infra/secrets/prod.enc.env >/dev/null && echo recovery ok
age-keygen -o ~/.config/sops/age/keys.txt        # new operator key; edit .sops.yaml with the new public key
for f in infra/secrets/*.enc.env; do SOPS_AGE_KEY_FILE=/Volumes/usb/recovery.txt sops updatekeys -y "$f"; done
```

Also revoke the lost laptop's SSH key on the VM (remove it from `deploy`'s authorized keys
by re-running provision with the remaining keys in `operator_ssh_pubkey`).

### Lose the recovery key

Nothing breaks today (the operator and host keys still work). Make a new recovery key as in
2b, put its public key in `.sops.yaml` in place of the old one, `sops updatekeys` on all
five files, commit, deploy. Do it soon: until then you have one fewer way back in.

### Lose the host age key (VM rebuilt)

A rebuilt VM makes a new host key. Add it (part 13 step 3) and `sops updatekeys`, then
remove the old host public key from `.sops.yaml` and `updatekeys` again.

### Lose the backup age private key

You can no longer read **old** backups. Make a new pair (part 9), update prod's public key,
staging's private key, redeploy. New backups use the new key. Keep two offline copies next time.

## Known gaps

Places where the code and a first-time setup disagree. None is fixed by this page; each
needs a code or owner decision.

| #   | Gap                                                                                                                                                            | Where                                          | Effect                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| 1   | No command creates the first platform super admin on a fresh prod database                                                                                     | none (searched `server/src/scripts`, docs)     | part 11a is a manual step the owner must decide    |
| 2   | Ops on its own VM: `edge.yml` always runs a Beszel agent and nginx on the app VM, and the tunnel config lists the ops hostnames for the same `cloudflared`     | `deploy/edge.yml`, `cloudflared-config.yml.j2` | part 15 needs a second edge or tunnel; unconfirmed |
| 3   | `infra/ansible/README.md` and `scripts/deploy.sh` header say first deploy uses `--hotfix "first deploy"`; `all` runs staging first so the gate is already open | `biddaloy-deploy:219-223`                      | harmless; not needed                               |
