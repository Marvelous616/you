# Increment 3.5: Repository, Server and Deployment — Completion & Verification Report

> **Project:** Life Logger  
> **Milestone:** Increment 3.5 (repository hygiene, runtime configuration, deployment)  
> **Git Release Tag:** `v0.3.5-increment-3.5`  
> **Date:** October 25, 2026  
> **Status:** Agent-side engineering complete — every automated gate passed locally, and the repository is published at `github.com/Marvelous616/you`. Server provisioning, the real drills and dual-device sync remain owner actions.

---

## 1. Executive Summary

Increment 3.5 adds no product behaviour. It turns a working codebase into something that can be cloned, configured, deployed, backed up, rolled back and measured without guesswork:

- The repository has no secrets, no absolute `file:///C:/…` links (in the working tree *or* in history), LF endings for shell scripts, and executable bits recorded in git.
- The server reads all runtime settings from environment variables, exposes `/health` with version, schema version, sync protocol version and a single-row database probe, serves the built web app, and shuts down cleanly on `SIGTERM`/`SIGINT`.
- `deploy/` contains a complete Arch Linux story: idempotent provisioning, systemd units, tag-triggered deploy with pre-deploy backup and automatic rollback, daily backups with integrity checks, a guarded restore, and a runbook.
- The benchmark harness gains host details, JSON output, a PC/server label and a 3x regression comparison, so the server baseline can be compared against the PC baseline without hand-editing JSON.
- The owner confirmed the server runs Arch Linux. The provisioning script already targets Arch and refuses to run elsewhere.

The remaining work needs the physical server and the phone. Section 12 lists the exact commands.

---

## 2. Delivered Work Packages

| WP | Deliverable | Status |
|---|---|---|
| **WP 3.5.1** | Repository hygiene: secret scan, relative links, `.gitattributes`, executable scripts, history rewrite | Complete (published) |
| **WP 3.5.2** | Runtime configuration, `/health`, static web serving, graceful shutdown | Complete (agent) |
| **WP 3.5.3** | Deploy artifacts: `deploy.sh`, `post-receive`, `server-setup.sh`, systemd units, backup/restore, tests | Complete (agent) |
| **WP 3.5.4** | Server provisioning on Arch Linux | Blocked — needs owner and hardware |
| **WP 3.5.5** | First deploy, on-host tests, benchmark baseline | Blocked — needs deployed server |
| **WP 3.5.6** | Benchmark regression guard | Complete (agent), server baseline pending |
| **WP 3.5.7** | Tailscale connectivity and Android transport | Blocked — needs server, PC and phone |

---

## 3. Architecture and Key Files

### Runtime configuration (`apps/server/src/config.ts`)

Every setting comes from the environment, with development defaults:

| Variable | Default | Purpose |
|---|---|---|
| `DB_PATH` | `data/life-logger.sqlite` (or under `DATA_DIR`) | SQLite file; relative paths resolve against the working directory. |
| `WEB_DIR` | `apps/web/dist` | Built web app served by the API process. |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` behind Tailscale Serve. |
| `PORT` | `4000` | HTTP port. |
| `LOG_LEVEL` | `info` | `fatal` through `silent`; invalid values stop startup. |
| `API_KEY` | unset | When set, every `/api/` request needs `Authorization: Bearer <key>`. |
| `APP_VERSION` | root `package.json` version | Release identifier; deploys set it from the tag. |
| `DATA_DIR` | `data` | Local-development fallback when `DB_PATH` is unset. |

`.env.example` documents the same names. `npm run dev` and `npm start` load the root `.env` with `--env-file-if-exists`, so a Windows developer does not need to export variables by hand.

The schema version is read once at startup, not per request. `/health` therefore never scans application tables.

### Health, static serving and shutdown

`GET /health` returns:

```json
{
  "status": "ok",
  "database": "connected",
  "version": "v0.3.5-increment-3.5",
  "schemaVersion": 3,
  "syncProtocolVersion": 1,
  "timestamp": "2026-10-25T…Z"
}
```

The probe is `SELECT 1`; a database failure returns HTTP 503 with `status: "error"` and `database: "unavailable"`. `/health` and the static assets stay open; the API key hook is scoped to `/api/`.

The built web app is served by the same process through `@fastify/static`. `index.html` is `no-cache`, hashed assets are `immutable`, and unknown extension-less `GET` paths fall back to `index.html` for client-side routing. `/api/`, `/health` and missing files still return JSON 404s.

`@fastify/static` is the only new runtime dependency. The alternative — a second static server or a reverse proxy — would add another process and more RAM to a 3.8 GB machine. The web app is already built by Vite; serving it from Fastify keeps one process and one port.

`SIGTERM` and `SIGINT` stop accepting requests, drain in-flight work, run `PRAGMA wal_checkpoint(TRUNCATE)`, close SQLite and exit 0 (1 on failure). Repeated signals are ignored, and a 10-second guard forces exit if a close hangs.

### Sync protocol

`SYNC_PROTOCOL_VERSION = 1` now lives in `packages/sync/src/protocol.ts` and is reported by `/health`, so a client can detect a server that speaks an older protocol before syncing.

### Web and Android

- The web footer fetches `/health` and shows the deployed version.
- Android has a **Server Connection** card for the server URL and API key, with a test for the client accessors. The values live for the current app session; durable settings arrive with `expo-sqlite` in Increment 4.

### Benchmark tooling

`tools/bench` gained `--output`, `--host-label`, `--compare` and `--help`. Output records CPU model, core count, RAM, Node version, platform, architecture and app version. `--compare <baseline>` fails when any shared metric exceeds 3x its baseline value, and prints the ratio. New metrics do not fail against an older baseline.

---

## 4. Repository Hygiene

### Secrets and absolute paths

- Tracked files were scanned for API keys, passwords, private keys, keystores and LAN addresses. None are present. Runtime secrets live in `/etc/lifelogger.env` on the server, documented by `.env.example` with empty values.
- `.gitignore` now excludes `.env` (except `.env.example`), Android/Expo native output, signing material, SQLite databases, the deploy lock and OS files.
- Absolute `file:///C:/` Markdown links pointing at the local checkout were replaced with relative links, including `%20` and `%28`/`%29` encoding for names with spaces and parentheses.

### History rewrite

The repository had no remote, so the absolute links were removed from history rather than left behind:

1. A mirror backup was taken outside the repository at `%TEMP%\opencode\you-backup.git`.
2. `git filter-branch --tree-filter` ran the link fixer over every commit, with `--tag-name-filter cat -- --all`.
3. `refs/original` was deleted, reflogs expired and `git gc --prune=now` pruned the old objects.
4. Verification:
   - `git log --all -p | grep -cE 'file:///C:/[A-Za-z0-9]'` returns **0**.
   - The rewritten HEAD tree is byte-identical to the pre-rewrite tree (`74a6f91…`).
   - Each rewritten tag tree differs from the backup only in documentation files, and only on link lines.
   - All three earlier tags were rewritten and still point at their original commits' content.

There are no other clones, so no collaborator needs to re-clone. The mirror backup outside the repository can be deleted once the owner is satisfied.

### Line endings and executable bits

`.gitattributes` forces LF for `*.sh`, `*.service`, `*.timer` and everything under `deploy/`, keeps CRLF for PowerShell, and treats database and image files as binary. `deploy.sh`, `backup.sh`, `restore.sh`, `server-setup.sh`, `post-receive` and the deploy test are recorded as mode `100755` in git.

---

## 5. Deployment Design

| Piece | Behaviour |
|---|---|
| `server-setup.sh` | Refuses non-Arch hosts (`/etc/arch-release`). Installs `git nodejs npm sqlite3 curl zram-generator sudo`, creates the `lifelogger` service account, directories, zram, lid settings, units, a narrow `systemctl` sudoers rule, the bare repository and the hook. Idempotent. |
| `post-receive` | Deploys only tags matching `v*`; branch pushes and tag deletions are ignored. |
| `deploy.sh` | Validates the tag regex, takes a `flock`, builds in a private worktree, backs up the database, switches `current`, writes `version.env`, restarts the service, health-checks for 10 seconds and rolls back on failure. Keeps the last five releases. Supports `--dry-run`. |
| `lifelogger.service` | Runs as `lifelogger`, reads `/etc/lifelogger.env`, sets `MemoryMax=1G`, restarts on failure, and stops gracefully. |
| `backup.sh` + timer | `sqlite3 .backup`, `PRAGMA integrity_check` on the copy, 14-day retention, non-zero exit on any failure. Daily at 03:30 with a 15-minute jitter and `Persistent=true`. |
| `restore.sh` | Refuses without `--yes`, refuses a backup that fails integrity, stops the service, moves the live database aside, clears `-wal`/`-shm`, copies the backup, starts the service and health-checks. `DB_PATH` can point at a scratch file for the drill. |

Deploys run as the owner's account (`DEPLOY_USER`, default `${SUDO_USER}`); the service and data are owned by `lifelogger`. The repository and releases are owned by the deploy user, so `git push` and builds do not need broad sudo.

The runbook (`deploy/README.md`) records the paths, first install, normal deploy, manual and automatic rollback, restore, backups, logs, Node upgrades, troubleshooting and drills. Its decisions table now records the owner-confirmed Arch Linux server.

---

## 6. Test Verification

| Gate | Result |
|---|---|
| Full suite | **154 tests in 23 files, all passing** |
| Server operations tests | `/health` ok and 503, static serving, SPA fallback, auth scoping, config parsing, graceful shutdown |
| Deploy script tests | **37 passed, 0 failed** with stubs for `systemctl`, `curl`, `sqlite3`, `git`, `npm`, `flock`, `ln` and `readlink` |
| ShellCheck | 0.11.0, clean at `--severity=style` for `deploy/*.sh`, `post-receive` and the deploy test |
| Root TypeScript build | `tsc -b` passed |
| Web production build | Vite build passed (`dist/assets/index-*.js`, 178.62 kB / 55.74 kB gzip) |
| Android typecheck | `npm run --workspace=@life-logger/android typecheck` passed |
| Fresh clone from GitHub | `git clone https://github.com/Marvelous616/you.git`, then `npm ci` (82 s), 154 tests, typecheck, web build, Android typecheck and the 37 deploy tests all passed |
| Benchmark regression guard | Compared the new PC run against `docs/benchmarks/increment-3-baseline.json`; no metric over 3x; unit and CLI tests cover the comparison and output formats |

Two papercuts found during verification were fixed:

- `npm run test:deploy` used `bash`, which resolves to the broken WSL bash on Windows. It now goes through `scripts/run-bash.mjs`, which prefers Git for Windows when present and uses plain `bash` everywhere else.
- The Android typecheck command in the README used `npm run --workspace=… exec`, which npm does not support. Android now has a `typecheck` script, and the README uses it.

---

## 7. Benchmark Results vs Targets

PC baseline: `docs/benchmarks/increment-3.5-pc-baseline.json` (i7-13700HX, 24 cores, 16 GB, Node v24.19.0, app version 0.3.5). The server column stays pending until WP 3.5.5.

| Metric | Target | PC | Server |
|---|---|---|---|
| Single marker save (avg) | `< 50 ms` | **0.039 ms** | pending |
| Single marker save (p95) | `< 50 ms` | **0.079 ms** | pending |
| Batch ingest, 5,000 records | `< 500 ms` | **185.84 ms** | pending |
| Day timeline query (avg) | `< 15 ms` | **0.075 ms** | pending |
| Quick-entry parse (avg) | `< 2 ms` | **0.0121 ms** | pending |
| Quick-entry parse (p95) | `< 2 ms` | **0.0177 ms** | pending |
| Single event save (avg) | `< 15 ms` | **0.0444 ms** | pending |
| 50-event lane layout (avg) | `< 30 ms` | **0.0762 ms** | pending |
| 50-event lane layout (p95) | `< 30 ms` | **0.096 ms** | pending |
| ICS parse, 200 events (avg) | `< 50 ms` | **1.592 ms** | pending |
| Calendar suggestion build, 200 events | `< 25 ms` | **0.568 ms** | pending |
| Single suggestion save (avg) | `< 15 ms` | **0.0393 ms** | pending |
| Pending suggestion query (avg) | `< 15 ms` | **0.867 ms** | pending |
| Suggestion accept flow (avg) | `< 25 ms` | **0.110 ms** | pending |

All PC targets pass. Every metric has more than 5x headroom on the PC; the tightest is batch ingest at 2.7x, which the server run must confirm.

---

## 8. Server Facts

Filled in when the owner provides access. The server is Arch Linux (owner-confirmed).

| Fact | Value |
|---|---|
| OS | Arch Linux — version, kernel and install state pending (`cat /etc/os-release`, `uname -r`, `findmnt /`, `lsblk -f`) |
| Node | PC **v24.19.0**; server pending (`node -v`). Match the major before the first deploy. |
| SSH | Pending — key-only login, password authentication disabled |
| Tailscale | Pending — record the server's tailnet name; server, PC and phone in the same tailnet; `tailscale serve --bg 8080` |
| Build drill | Pending — `npm ci` + build duration and peak RSS (`/usr/bin/time -v`) |
| Idle use | Pending — CPU and RSS of the running service |
| Rollback drill | Pending — record date and timing |
| Restore drill | Pending — record date, data check and `PRAGMA integrity_check` |
| Reboot drill | Pending — service and backup timer back without a login |

Do not deploy if `findmnt /` shows an `/run/archiso/cowspace` overlay: that is the live installer, not an installed system.

---

## 9. Quality Gate Checklist

- [x] A fresh clone from GitHub builds and passes all tests.
- [x] No secrets or absolute local paths in the repository or its history (scan and rewrite verified).
- [x] `.gitattributes` keeps LF endings, and the scripts are executable in git.
- [x] `/health` returns the version, schema version and sync protocol version, and is tested.
- [x] Clean shutdown on `SIGTERM` is tested.
- [x] Deploy script tests pass with stubs, and `shellcheck` is clean.
- [ ] The service is enabled, survives a reboot and starts without a login — needs the server.
- [ ] A tag push deploys and health-checks, and the new version shows in the web UI — needs the server.
- [ ] The rollback drill and the restore drill passed — simulated in tests; real drills need the server.
- [ ] The daily backup timer runs, and a backup passes `PRAGMA integrity_check` — needs the server.
- [ ] Tests and benchmarks pass on the server, and the baseline JSON is saved — needs the server.
- [x] The benchmark regression guard works (PC comparison and unit/CLI tests).
- [ ] The PC and the phone sync through the server over Tailscale — needs all three devices.
- [x] Release tagged `v0.3.5-increment-3.5`.

---

## 10. Risks and Decisions

| Risk | Mitigation / decision |
|---|---|
| The server is still running the live installer | `server-setup.sh` never checks this; the runbook requires `findmnt /` first and records the decision. |
| Builds exhaust RAM on 3.8 GB | zram, `MemoryMax=1G` on the service, and the documented PC-build fallback. Server build is attempted first. |
| Windows line endings break the scripts | `.gitattributes` plus shellcheck and the deploy tests; scripts are mode `100755`. |
| Native SQLite fails on the old CPU | Node 24's built-in `node:sqlite`; run the suite on the server before the first real deploy and record the version. |
| Android blocks plain HTTP | Preferred transport is HTTPS through Tailscale (`tailscale serve`), so no cleartext build flag is needed. |
| A bad release locks in a schema change | Migrations stay additive within a release; `deploy.sh` backs up before switching. |
| Backups share the server disk | The runbook requires periodic copies to the PC and records the last copy date. |
| History rewrite surprises the owner | The rewrite ran before the GitHub repository was populated; the remote history was force-updated and verified, and a mirror backup is kept locally. |

The repository is public at `github.com/Marvelous616/you`, the owner's choice; the secret and absolute-path scans are the safeguard, and no host details or credentials are committed. The runbook records **A: HTTPS through Tailscale** as the recommended device transport, to be confirmed when the phone first connects.

---

## 11. Known Limitations / Next Steps

1. The real deploy, rollback, restore, reboot and build drills are untested on hardware. The deploy tests use stubs because Windows cannot create symlinks without privileges.
2. The server baseline JSON and the server column of the benchmark table do not exist yet.
3. Android keeps the server URL and API key only for the current session; durable storage ships with `expo-sqlite` in Increment 4.
4. HTTPS/cleartext and live/installed OS stay owner decisions until confirmed on the host.
5. The 14-day dual-device dogfooding clock starts after Increment 4 WP 4.1 and Diagnostics, not here.

---

## 12. Owner Action Checklist

### 12.1 GitHub (done)

The repository is published at `https://github.com/Marvelous616/you` (public), with `main` and all four tags. Confirm the rewrite and tags at any time:

```bash
git ls-remote --tags origin
git log --all -p | grep -cE 'file:///C:/[A-Za-z0-9]'   # must print 0
```

The mirror backup outside the repository can be deleted once you are satisfied.

### 12.2 Prepare the Arch server

```bash
ssh <user>@<server>
findmnt / && lsblk -f && cat /etc/os-release && uname -r
node -v          # must match the PC major (v24.x)
```

If `/` is an `/run/archiso/cowspace` overlay, install Arch to the internal disk before continuing. Authenticate once to GitHub (read-only deploy key or `gh auth login`) and clone:

```bash
git clone https://github.com/Marvelous616/you.git ~/life-logger
cd ~/life-logger
sudo DEPLOY_USER="$USER" ./deploy/server-setup.sh
systemctl is-enabled lifelogger.service lifelogger-backup.timer
```

If the server Node major differs from the PC, install the matching major explicitly and re-run the check; the script warns but does not guess versions.

### 12.3 First deploy and on-host verification

On the PC:

```bash
git remote add server <user>@<server>:/opt/lifelogger/repo.git
git push server main
git push server v0.3.5-increment-3.5
```

On the server:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ | head
sudo systemctl status lifelogger
journalctl -u lifelogger -n 50 --no-pager
```

The web footer must show `v0.3.5-increment-3.5`. Then run the tests and the benchmark from the release checkout:

```bash
cd /opt/lifelogger/releases/v0.3.5-increment-3.5
npm ci
npm test
/usr/bin/time -v npm run build
node tools/bench/dist/index.js --output docs/benchmarks/increment-3.5-server-baseline.json --host-label server
node tools/bench/dist/index.js --compare docs/benchmarks/increment-3.5-pc-baseline.json
```

Copy `docs/benchmarks/increment-3.5-server-baseline.json` back to the PC and commit it. Record the build time, peak RSS and idle use in the report's Server facts table.

### 12.4 Tailscale and Android

Give the server a DHCP reservation or a stable LAN hostname before joining the tailnet, then:

```bash
sudo pacman -S --needed tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up
sudo tailscale serve --bg 8080
tailscale serve status
```

Set `HOST=127.0.0.1` in `/etc/lifelogger.env`, restart the service, and open `https://<machine>.<tailnet>.ts.net` from the phone. Enter that URL and the `API_KEY` from `/etc/lifelogger.env` in the app's **Server Connection** card. Log a marker on the PC, pull on the phone, and reverse. Repeat once with Wi-Fi off on the phone, then record the server's tailnet name in the report.

### 12.5 Drills to record

```bash
# backup and restore
sudo /opt/lifelogger/backup.sh
sudo DB_PATH=/tmp/life-logger-restore-drill.db \
  /opt/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
sqlite3 /tmp/life-logger-restore-drill.db 'PRAGMA integrity_check;'

# reboot
sudo reboot
# after boot:
systemctl is-active lifelogger lifelogger-backup.timer
systemctl list-timers lifelogger-backup.timer
```

Rollback drill: push a throwaway tag whose `/health` fails (for example, start the service with a broken `DB_PATH`), confirm the previous release returns, then delete the tag. Record the timing.

---

## 13. Release State

The release commit and annotated tag are published at `github.com/Marvelous616/you`. Confirm:

```bash
git log --oneline -1
git describe --tags --exact-match HEAD   # v0.3.5-increment-3.5
git ls-remote origin
```
