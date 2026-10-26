# Increment 3.5: Repository, Server and Deployment — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 3.5 redo — Arch package delivery
> **Git Release Tag:** `v0.3.6-increment-3.5`
> **Date:** October 26, 2026
> **Status:** Package built and published from this PC; installed and verified on
> `zeserver`. Backup, scratch restore and same-version reinstall drills passed.
> True version upgrade, rollback and reboot drills remain pending.

---

## 1. Executive Summary

Increment 3.5 adds no product behaviour. It changes how the server receives the
application. The first attempt built and deployed on the server by pushing a git
tag; this redo replaces that with one Arch package built on this PC, published on
GitHub and installed with `pacman`.

The redo was requested because the old model was too heavy and too fragile for the
target host:

- It ran `npm ci`, the full build and the test suite on a 3.78 GiB Pentium with
  two cores.
- Every release grew a new directory with its own `node_modules` under
  `/opt/lifelogger/releases`, kept alive by a `current` symlink.
- A `post-receive` hook, a deploy lock, a version file and a health rollback were
  all custom code that had to be maintained for each release.
- The host boots from a persistent archiso, so a failed deploy had to be repaired
  through the same fragile path.

Now the PC does the compiling. The server downloads a 447,684-byte package,
verifies its SHA-256, lets `pacman` place the files and restarts the same systemd
service. The database and `/etc/lifelogger.env` stay outside package ownership, so
install, upgrade and rollback do not touch data or secrets.

Delivered:

- `packaging/` with a real `PKGBUILD`, a single-file CommonJS server bundle,
  packaged units, sysusers/tmpfiles entries, backup/restore scripts, a build
  script, a release script and a server installer.
- Release `v0.3.6-increment-3.5` at
  `https://github.com/Marvelous616/you/releases/tag/v0.3.6-increment-3.5`
  with the package, `.sha256`, `PKGBUILD` and `SRCINFO`.
- 154 unit/integration tests, 59 packaging checks, 29 built-package checks,
  clean shellcheck and typechecks.
- The old `deploy/` tree and its tag-push mechanism removed from `main`.

Installed on `zeserver` on 2026-10-26:

- The old deploy had never completed. `/opt/lifelogger/releases` was empty,
  `current` was missing, the bare repo had no refs, the service was inactive and
  there was no database. The migration therefore had no data to preserve.
- The three shadow admin units were backed up to
  `/root/lifelogger-pre-package-20261026-191910/` and removed. `WEB_DIR` now
  points at `/usr/lib/lifelogger/web`; `DB_PATH`, `HOST`, `PORT`, `LOG_LEVEL` and
  the API key were kept.
- `install-release.sh` installed the package, enabled the service and timer and
  reached a healthy `/health` in **9 s**. The service created the database and
  schema 3 on first start.
- A same-version reinstall took **5 s**, a packaged backup took **1 s** and a
  scratch restore took **1 s**, both with `PRAGMA integrity_check` returning `ok`.
- The web footer reads `Life Logger 0.3.6 · schema 3 · sync protocol 1`.

Remaining, and not claimed as done:

- A true version upgrade and rollback drill need a second release.
- The reboot drill needs the boot media and console access because the running
  kernel and `/lib/modules` disagree.
- PC/phone sync over the tailnet is unchanged and still owner-verified.

## 2. Delivered Work Packages

| WP | Result |
| --- | --- |
| 3.5.1 Repository and GitHub | Done. Public repository, `main`, historical tags, LF rules, executable bits, no tracked secrets or absolute local paths. |
| 3.5.2 Runtime configuration and health | Done. Environment-driven config, light `/health`, static web serving and clean `SIGTERM`; covered by the existing suite. |
| 3.5.3 Package and build artifacts | Done. `PKGBUILD`, esbuild bundle, units, sysusers/tmpfiles, backup/restore, build/release/install scripts, tests and runbook. |
| 3.5.4 Publish and migrate | Done. Release published; old units backed up and removed, `WEB_DIR` migrated, package installed and verified. |
| 3.5.5 On-host verification and drills | Partial. Install, `/health`, footer, backup, scratch restore and same-version reinstall passed. Version upgrade, rollback and reboot drills pending. |
| 3.5.6 Benchmark regression guard | Done earlier; compare mode and tests unchanged. |
| 3.5.7 Connectivity | Pending owner verification over Tailscale. |

## 3. Architecture

### Runtime configuration

| Variable | Package default | Meaning |
| --- | --- | --- |
| `DB_PATH` | `/var/lib/lifelogger/life.db` | SQLite database. Keeps the package filename; the server had no pre-existing database. |
| `WEB_DIR` | `/usr/lib/lifelogger/web` | Built web app inside the package. |
| `HOST` | `127.0.0.1` | Loopback default; `/etc/lifelogger.env` may still set `0.0.0.0` for direct tailnet access. |
| `PORT` | `8080` | HTTP port. |
| `LOG_LEVEL` | `info` | Fastify log level. |
| `API_KEY` | unset | When set in `/etc/lifelogger.env`, `/api/` requires a bearer key. |
| `APP_VERSION` | `/usr/lib/lifelogger/version.env` | Written by `package()`; loaded last so it cannot be overridden. |

The unit loads the package defaults, then `/etc/lifelogger.env`, then
`version.env`. The backup unit loads the same two environment files, so a
host-specific `DB_PATH` is honoured by backups.

### Health and serving

`GET /health` returns `status`, `database`, `version`, `schemaVersion`,
`syncProtocolVersion` and a timestamp. The database probe is a single-row
`SELECT 1`; the schema version is read once at startup. A database failure returns
HTTP 503. `/health` and the static assets stay open; the API key hook is scoped to
`/api/`.

The built web app is served by the same Fastify process. `index.html` is
`no-cache`, hashed assets are immutable, and unknown extension-less `GET` paths
fall back to `index.html`. `SIGTERM`/`SIGINT` stop accepting requests, drain,
checkpoint the WAL, close SQLite and exit.

### Package layout

```text
/usr/bin/lifelogger
/usr/lib/lifelogger/{server.cjs,lifelogger.env,version.env,backup.sh,restore.sh}
/usr/lib/lifelogger/web/{index.html,assets/...}
/usr/lib/systemd/system/lifelogger.service
/usr/lib/systemd/system/lifelogger-backup.{service,timer}
/usr/lib/sysusers.d/lifelogger.conf
/usr/lib/tmpfiles.d/lifelogger.conf
/usr/share/doc/lifelogger/README.md
```

The package does **not** own `/etc/lifelogger.env` or `/var/lib/lifelogger`. That
is the boundary that makes an upgrade safe.

### Single-file server

`packaging/bundle-server.mjs` runs esbuild over `apps/server/dist/index.js` and
emits one CommonJS file. CJS is required: Fastify's dynamic requires fail in an
ESM bundle with `Dynamic require of "node:events" is not supported`.
`import.meta.url` is replaced at build time with the bundle's own file URL so
`node:sqlite` and the static-serving paths resolve without `node_modules`.

The extracted package was started in a temporary directory with no
`node_modules`, answered `/health`, served the web app and stopped cleanly on
`SIGTERM`.

### Units and installer

- `lifelogger.service` runs as `lifelogger`, restarts always, and keeps
  `MemoryMax=1G`, `ProtectSystem=strict`, `ProtectHome=true`,
  `ReadWritePaths=/var/lib/lifelogger` and `NoNewPrivileges=true`.
- `lifelogger-backup.timer` runs daily at 03:30 with jitter and persistence.
- `install-release.sh` locks with `flock`, validates the tag, refuses while an
  admin unit shadows the packaged one, downloads the package and checksum,
  verifies SHA-256, runs `pacman -U`, reloads systemd, enables the service and
  timer, and requires `/health` to report the new version. On failure it
  reinstalls the previous cached package. `--dry-run` prints the plan without
  downloading or changing anything.

## 4. Repository Hygiene

- `deploy/` was removed: `deploy.sh`, `post-receive`, `server-setup.sh`, the
  admin units, the deploy tests and the old runbook. The release symlink farm is
  gone.
- `packaging/` is the only delivery path. `.gitattributes` keeps LF for
  `packaging/**`, `PKGBUILD`, `.SRCINFO` and `*.install`; shell scripts and the
  runner are executable in git.
- `.gitignore` covers package artifacts, `packaging/src`, `packaging/pkg` and
  build output.
- A scan of tracked files found no API keys, private keys or absolute
  `file:///C:/` development paths; the history check for those paths returns 0.
- The repository is public. Historical tags, including
  `v0.3.5-increment-3.5`, remain. The redo is a new tag, not a rewritten one.
- The untracked `ses_*.json` session file in the worktree is not committed.

## 5. Packaging, Build and Release

### Build host

| Fact | Value |
| --- | --- |
| OS | Arch Linux, kernel 7.2.11-arch1-1 |
| CPU | 13th Gen Intel Core i7-13700HX, 16 cores / 24 threads |
| RAM | 15.7 GiB |
| Node | v22.23.2 via nvm; npm 10.9.8 |
| Package tool | `makepkg` from `base-devel` |
| Warm rebuild of the published tag | 18 s (`makepkg --cleanbuild`, git clone and npm cache warm) |

The build PC's pacman `nodejs` provider is an older LTS (20.20.2), while the nvm
Node 22.23.2 is first on `PATH`. `build.sh` checks the `PATH` version and passes
`--nodeps` only in that case. The PKGBUILD still declares the real runtime
requirement, `nodejs>=22.5`, which the server's Node 24.22.1 satisfies.

### Package metadata

| Fact | Value |
| --- | --- |
| Package | `lifelogger 0.3.6-1` |
| Architecture | `any` |
| Runtime dependencies | `nodejs>=22.5`, `sqlite` |
| Build dependencies | `git`, `nodejs`, `npm` |
| Source | `git+https://github.com/Marvelous616/you.git#tag=v0.3.6-increment-3.5` |
| Artifact | `lifelogger-0.3.6-1-any.pkg.tar.zst`, 447,684 bytes (437 KiB) |
| SHA-256 | `cd568fb4714b862260833cd2fb6069d575d7486cd358c16bd502009a513bb85e` |
| Tag commit | `5e054bc` |

### Release

- URL: `https://github.com/Marvelous616/you/releases/tag/v0.3.6-increment-3.5`
- Assets: package (447,684 bytes), `.sha256` (101 bytes), `PKGBUILD` (2,066
  bytes), `SRCINFO` (458 bytes).
- `packaging/release.sh` regenerates `.SRCINFO`, pushes `main` and the annotated
  tag, builds the package from the pushed tag, then creates the release.

GitHub renames assets whose names start with a dot, so the first upload appeared
as `default.SRCINFO`. The release was corrected by deleting that asset and
uploading a copy named `SRCINFO`. `release.sh` now always uploads a temp copy
named `SRCINFO`, and the runbook and spec say so.

## 6. Test Verification

| Gate | Result |
| --- | --- |
| Unit and integration suite | **154 tests in 23 files passed** (`npm test`) |
| TypeScript project build | Passed (`tsc -b`) |
| Android TypeScript check | Passed (`tsc --noEmit`) |
| Package input checks | **37 passed** (version/tag, metadata, unit hardening, env order, file paths, script syntax) |
| Script stub checks | **22 passed** (backup, restore, installer, dry run, health, rollback paths) |
| Built-package verification | **29 passed** (metadata, file list, ownership boundaries, checksum, extracted server smoke test) |
| ShellCheck | 0.11.0, **zero findings** for all packaging bash scripts, the `.install` scriptlet and the `sh` runner |
| Vite production build | Passed inside the package `build()` |
| `makepkg` | Produced `lifelogger-0.3.6-1-any.pkg.tar.zst` |
| Bundle isolation | Runs with no `node_modules`; `/health` reports 0.3.6 and the database connected |
| Clean shutdown | `SIGTERM` exits 0 after the WAL checkpoint |

The packaging checks run inside `makepkg`'s `check()`, so the published artifact
cannot be produced without them. The built-package check runs against the artifact
after the build, not against the source tree.

## 7. Benchmark Results vs Targets

The PC baseline is `docs/benchmarks/increment-3.5-pc-baseline.json`. It was
recorded before this redo on the same class of machine; this increment changes
delivery, not runtime code. The server benchmark was not run because it is optional
for a delivery-only increment and would add synthetic records to the new database.

| Metric | Target | PC | Server |
| --- | --- | --- | --- |
| Single marker save (avg) | `< 50 ms` | **0.039 ms** | not run |
| Single marker save (p95) | `< 50 ms` | **0.079 ms** | not run |
| Batch ingest, 5,000 records | `< 500 ms` | **185.84 ms** | not run |
| Day timeline query (avg) | `< 15 ms` | **0.075 ms** | not run |
| Quick-entry parse (avg) | `< 2 ms` | **0.0121 ms** | not run |
| Quick-entry parse (p95) | `< 2 ms` | **0.0177 ms** | not run |
| Single event save (avg) | `< 15 ms` | **0.0444 ms** | not run |
| 50-event lane layout (avg) | `< 30 ms` | **0.0762 ms** | not run |
| 50-event lane layout (p95) | `< 30 ms` | **0.096 ms** | not run |
| ICS parse, 200 events (avg) | `< 50 ms` | **1.592 ms** | not run |
| Calendar suggestion build, 200 events | `< 25 ms` | **0.568 ms** | not run |
| Single suggestion save (avg) | `< 15 ms` | **0.0393 ms** | not run |
| Pending suggestion query (avg) | `< 15 ms` | **0.867 ms** | not run |
| Suggestion accept flow (avg) | `< 25 ms` | **0.110 ms** | not run |

The regression guard (`tools/bench --compare`) fails when a shared metric exceeds
3x its baseline. A server baseline is optional for this redo; the package has no
new runtime work.

## 8. Build Host and Server Facts

### Build host

See Section 5. The build is reproducible from the tag; the warm rebuild took 18 s.
The published artifact's checksum covers the exact bytes uploaded.

### Server

| Fact | Value |
| --- | --- |
| Access | Tailscale MagicDNS `root@zeserver`; ed25519 key installed on 2026-10-26 |
| Hardware | Dell Inspiron 1545, Pentium T4300 (2) @ 2.10 GHz, 3.78 GiB RAM, 113.63 GiB disk |
| OS | Arch Linux, running kernel **7.2.6-arch2-1**, archiso 2025-06-01, Legacy BIOS |
| Installed kernel modules | `/lib/modules/7.2.11-arch1-1` only, so the running kernel and modules disagree |
| Root filesystem | `airootfs` overlay with `upperdir` on `/dev/sda2` (ext4); `/dev/sda1` vfat `ARCH_BOOT` |
| Persistence | Writable overlay on `sda2`; 17.06 GiB used of 113.63 GiB (15%) after the install |
| Node | **v24.22.1**, npm 12.2.1 |
| Package | `lifelogger 0.3.6-1` installed from the GitHub release |
| Service | `lifelogger.service` active and enabled; 28.0 MiB RSS, 30.0 MiB peak after the reinstall |
| Backup timer | `lifelogger-backup.timer` active and enabled; a manual run succeeded |
| Database | `/var/lib/lifelogger/life.db`, schema 3, created on first start; the package default keeps this filename |
| Legacy deploy | Never completed: empty `releases`, no `current`, no refs in `repo.git`, no database, inactive service |
| Legacy config | `WEB_DIR` migrated to `/usr/lib/lifelogger/web`; `DB_PATH`, `HOST=0.0.0.0`, `PORT`, `LOG_LEVEL` and the API key were kept |
| Legacy units | Three admin units backed up to `/root/lifelogger-pre-package-20261026-191910/` and removed |
| Legacy tree | `/opt/lifelogger` left in place; it contains scripts and an empty repo, no live data |
| Tailscale | Up; the PC and phone reach the server over the tailnet. No public exposure. |

### Server install verification

| Check | Result |
| --- | --- |
| Package | `pacman -Q lifelogger` -> `lifelogger 0.3.6-1` |
| Install time | **9 s** from installer start to a healthy service |
| Same-version reinstall | **5 s**; the installer found and reused the cached package |
| `/health` | `status: ok`, `database: connected`, `version: 0.3.6`, `schemaVersion: 3`, `syncProtocolVersion: 1` |
| Web footer | Headless Chrome: `Life Logger 0.3.6 · schema 3 · sync protocol 1` |
| Service | active and enabled; packaged unit at `/usr/lib/systemd/system/lifelogger.service` |
| Backup timer | active and enabled; next run scheduled by systemd |
| Database | `PRAGMA integrity_check` -> `ok`; 12 tables including `events`, `markers`, `days`, `journal_entries`, `captures`, `calendar_items`, `suggestions` and `schema_migrations` (versions 1-3) |
| Backup drill | **1 s**; `life-logger-20261026T135045Z.db`, mode 600, integrity `ok` |
| Restore drill | **1 s** into `/tmp/lifelogger-restore-drill.db`; health passed; integrity `ok`; live DB untouched |
| Reachability from the PC | `curl http://zeserver:8080/health` returned the same JSON over the tailnet |
| Old units backup | `/root/lifelogger-pre-package-20261026-191910/` contains the three units and the pre-migration env |

### Accepted risk

The owner accepted, in writing on 2026-10-26, that the server is a persistent
archiso rather than a normal installed system. The decision and its mitigations
are recorded in `packaging/README.md` under "Accepted risk: persistent archiso
server": no blind `pacman -Syu`, keep the ISO available, watch overlay space, and
keep off-machine copies of data and configuration. This redo does not change that
decision, repair the kernel/module mismatch, or reinstall the host.

## 9. Quality Gate Checklist

| Gate | Status |
| --- | --- |
| Fresh clone builds and 154 tests pass | Pass |
| No tracked secrets or absolute local paths | Pass |
| LF endings and executable bits | Pass |
| `/health` is light and reports version, schema and sync protocol | Pass |
| Clean `SIGTERM` shutdown | Pass |
| Packaging input and stub checks | Pass (59) |
| ShellCheck | Pass (0.11.0, zero findings) |
| `makepkg` artifact and built-package verification | Pass (29 checks) |
| Package does not own `/etc/lifelogger.env` or `/var/lib/lifelogger` | Pass |
| Release assets and checksum | Pass |
| Server installs and the packaged unit is active | Pass (9 s) |
| `/health` and web footer show 0.3.6 on the server | Pass |
| Upgrade and rollback drills | Partial: same-version reinstall pass (5 s); true version upgrade and rollback pending a second release |
| Restore drill with `PRAGMA integrity_check` | Pass (scratch DB, 1 s) |
| Service and backup timer survive reboot | **Pending** (needs boot media and console) |
| Benchmark regression guard | Pass earlier; unchanged; server benchmark not run |
| PC and phone sync over Tailscale | **Pending owner** |

## 10. Risks and Decisions

| Risk or decision | Mitigation |
| --- | --- |
| Persistent archiso host | Accepted in writing; no blind updates, ISO retained, off-machine copies. |
| Running kernel has no matching modules | Do not reboot without console access; verify `sda1` and `/lib/modules` first. |
| Package is unsigned | Publish and verify SHA-256; download only from this repository; no third-party repos. |
| No hosted pacman repository | Release assets plus `pacman -U` or `install-release.sh`; upgrades are explicit. |
| Tag must exist before the build | `release.sh` pushes the tag, then builds; `build.sh` validates the tag with `git ls-remote`. |
| Build PC's pacman Node is too old | `build.sh` checks the `PATH` Node and uses `--nodeps` only then; the PKGBUILD still declares `nodejs>=22.5`. |
| Fastify fails in an ESM bundle | Emit CommonJS and replace `import.meta.url`; verified by the extracted-package smoke test. |
| Old admin units shadow packaged units | Done 2026-10-26: backed up, removed and `daemon-reload` run before the install. |
| Legacy `WEB_DIR=apps/web/dist` | Done 2026-10-26: rewritten to `/usr/lib/lifelogger/web`; `DB_PATH`, `HOST`, `PORT`, `LOG_LEVEL` and the API key kept. |
| Backups live on the same disk | Documented off-machine copy procedure; daily retention is 14 days. |
| GitHub renames leading-dot assets | `release.sh` uploads a temp copy named `SRCINFO`; the first release was corrected manually. |
| Post-release docs commit is ahead of the tag | Tags are built from their own commit; `build.sh` refuses a non-tag HEAD, so future releases need a new tag. |
| True version rollback needs a second release | The installer's rollback path is covered by the 22 stub checks; the next release will provide the live upgrade/rollback drill. |
| The old deploy never completed | Verified before migration: no release, no `current`, no refs, no database. The migration preserved no data because none existed. |
| Live SQLite file is mode 644 | The directory is mode 750 owned by `lifelogger`, so only root and the service user can traverse it. A future packaged unit `UMask=0077` would tighten the file itself. |

## 11. Known Limitations and Deviations

- **Server install is verified; three drills remain.** The package is installed
  and serving. A true version upgrade/rollback needs a second release, and the
  reboot drill needs the boot media plus console access.
- The old deploy never completed: there was no release directory, no `current`
  symlink, no database and no backup. No server data was lost or migrated.
- The optional server benchmark was not run. It is not part of the acceptance
  gates for this delivery, and running it would add synthetic records to the new
  database.
- The package is installed with `pacman -U`, not from a hosted repository, so
  there is no automatic `pacman -Syu` upgrade path by design.
- The build-PC `--nodeps` workaround is local only; the package metadata is
  correct for a normal Arch builder.
- The backup service was run manually and passed. The first timer-triggered run
  will happen at the next scheduled run (03:30 with jitter).
- The live database file is mode 644 while its directory is mode 750 and owned
  by `lifelogger`; only root and the service user can traverse the directory. A
  future `UMask=0077` in the packaged unit would harden the file itself.
- The web footer was verified with headless Chrome on the build PC. The desktop
  browser pane was not connected during this session.
- The server still sets `HOST=0.0.0.0`; moving to `tailscale serve` with
  `HOST=127.0.0.1` remains a separate owner decision.
- The earlier version of this report, kept in git history, described the v1
  tag-push model. This document supersedes it; the v1 tag and release remain as
  history.

## 12. Owner Actions

### Completed on 2026-10-26

1. **SSH access.** An ed25519 key was generated on this PC
   (`SHA256:CJTusUBrNXSbiFhyZTHrUo0xMZ554sec/Kca3dfK2Oc`, comment
   `lifelogger-build`), the owner ran `ssh-copy-id`, and `ssh root@zeserver true`
   now exits 0. No private key is in the repository.
2. **Migration.** The old units and pre-migration env were backed up to
   `/root/lifelogger-pre-package-20261026-191910/`. The old service and timer were
   disabled, the three admin units removed, systemd reloaded, and `WEB_DIR`
   rewritten to `/usr/lib/lifelogger/web`. `DB_PATH`, `HOST=0.0.0.0`, `PORT`,
   `LOG_LEVEL` and the API key were kept.
3. **Install and verification.** The release installer installed
   `lifelogger 0.3.6-1`, enabled the service and timer, and health-checked in 9 s.
   The database was created on first start at
   `/var/lib/lifelogger/life.db`, schema 3. The service is active, the timer is
   active, `/health` passes and the web footer shows 0.3.6.
4. **Drills that passed.** Same-version reinstall (5 s), packaged backup (1 s),
   scratch restore (1 s, integrity `ok`) and the headless-Chrome footer check.
5. **No data migration was needed.** The old deploy had never completed and the
   server had no database or backups. `/opt/lifelogger` was left in place and
   contains no live data.

### Remaining

1. **Reboot drill.** Do this only with the archiso boot media attached and
   console access available. The running kernel is 7.2.6 while `/lib/modules`
   only has 7.2.11, and the host boots with `copytoram=y` from the ISO UUID
   `2025-06-01-09-10-39-00`. Do not reboot blindly. After a reboot, verify
   `systemctl is-active lifelogger.service lifelogger-backup.timer` and
   `/health`.
2. **True upgrade and rollback drill.** Build and publish the next tag, install
   it, and then reinstall the previous cached package (or exercise the installer
   rollback path) and verify health. Keep `/var/cache/lifelogger` until the next
   release is proven.
3. **Connectivity.** Confirm the PC and phone can log events both ways over the
   tailnet. Decide whether to keep `HOST=0.0.0.0` or move to `tailscale serve`
   with `HOST=127.0.0.1`.
4. **Off-machine backup.** Copy `/var/lib/lifelogger/backups` to this PC or
   another host. The automatic backup is on the same disk as the live database.

## 13. Release State

| Item | Value |
| --- | --- |
| Release | `https://github.com/Marvelous616/you/releases/tag/v0.3.6-increment-3.5` |
| Tag | `v0.3.6-increment-3.5` (annotated) |
| Commit | `5e054bc` |
| Package | `lifelogger-0.3.6-1-any.pkg.tar.zst` |
| Size | 447,684 bytes (437 KiB) |
| SHA-256 | `cd568fb4714b862260833cd2fb6069d575d7486cd358c16bd502009a513bb85e` |
| Assets | package, package `.sha256`, `PKGBUILD`, `SRCINFO` |
| Server state | `lifelogger 0.3.6-1` installed; service and backup timer active and enabled; `/health` ok; DB schema 3 |
| Install time | 9 s from installer start to healthy (`/var/cache/lifelogger` keeps the package) |
| Drills | Backup 1 s, scratch restore 1 s, same-version reinstall 5 s; true upgrade, rollback and reboot pending |

The package was built and tested on this PC, not on the Pentium server. The
server only needs `pacman`, Node and `sqlite`, all of which it already has.
