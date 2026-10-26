# Increment 3.5: Repository, Server and Deployment — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 3.5 redo — Arch package delivery
> **Git Release Tag:** `v0.3.6-increment-3.5`
> **Date:** October 26, 2026
> **Status:** Package built and published from this PC; every automated gate passed.
> Server migration, install and drills remain owner actions because this build PC
> has no SSH key for `zeserver`.

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

Pending, and not claimed as done:

- The package is not yet installed on `zeserver`. SSH reaches the host but this PC
  has no private key, so authentication fails.
- The old admin units and the legacy `WEB_DIR` are still on the server.
- Upgrade, rollback, restore and reboot drills are not recorded.
- PC/phone sync over the tailnet is unchanged and still owner-verified.

## 2. Delivered Work Packages

| WP | Result |
| --- | --- |
| 3.5.1 Repository and GitHub | Done. Public repository, `main`, historical tags, LF rules, executable bits, no tracked secrets or absolute local paths. |
| 3.5.2 Runtime configuration and health | Done. Environment-driven config, light `/health`, static web serving and clean `SIGTERM`; covered by the existing suite. |
| 3.5.3 Package and build artifacts | Done. `PKGBUILD`, esbuild bundle, units, sysusers/tmpfiles, backup/restore, build/release/install scripts, tests and runbook. |
| 3.5.4 Publish and migrate | Release published. Server migration and install pending SSH access. |
| 3.5.5 On-host verification and drills | Pending. Needs the server install. |
| 3.5.6 Benchmark regression guard | Done earlier; compare mode and tests unchanged. |
| 3.5.7 Connectivity | Pending owner verification over Tailscale. |

## 3. Architecture

### Runtime configuration

| Variable | Package default | Meaning |
| --- | --- | --- |
| `DB_PATH` | `/var/lib/lifelogger/life.db` | SQLite database. Keeps the existing filename, so no data move is needed. |
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
delivery, not runtime code. The server column is still pending because the package
is not installed yet.

| Metric | Target | PC | Server |
| --- | --- | --- | --- |
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
| Access | Tailscale MagicDNS `root@zeserver`; sshd is reachable |
| Authentication from this PC | **Blocked** — no private key in `~/.ssh`; `Permission denied (publickey,password)` |
| Hardware | Dell Inspiron 1545, Pentium T4300 (2) @ 2.10 GHz, 3.78 GiB RAM, 113.63 GiB disk |
| OS | Arch Linux, running kernel **7.2.6-arch2-1**, archiso 2025-06-01, Legacy BIOS |
| Installed kernel modules | `/lib/modules/7.2.11-arch1-1` only, so the running kernel and modules disagree |
| Root filesystem | `airootfs` overlay with `upperdir` on `/dev/sda2` (ext4); `/dev/sda1` vfat `ARCH_BOOT` |
| Persistence | Writable overlay on `sda2`; the exact free space must be rechecked before any large operation |
| Node | **v24.22.1**, npm 12.2.1 |
| Live database | `/var/lib/lifelogger/life.db`; the package default keeps this filename |
| Legacy config | `/etc/lifelogger.env` still has `WEB_DIR=apps/web/dist`; it may also set `HOST=0.0.0.0` |
| Legacy units | Admin units in `/etc/systemd/system/` shadow the packaged units until removed |
| Legacy tree | `/opt/lifelogger` is unused by the package; leave it until the install is verified |
| Tailscale | Up; the PC and phone reach the server over the tailnet. No public exposure. |

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
| Server installs and the packaged unit is active | **Pending** |
| `/health` and web footer show 0.3.6 on the server | **Pending** |
| Upgrade and rollback drills | **Pending** |
| Restore drill with `PRAGMA integrity_check` | **Pending** |
| Service and backup timer survive reboot | **Pending** |
| Benchmark regression guard | Pass earlier; unchanged |
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
| Old admin units shadow packaged units | The installer refuses; migration removes the three units first. |
| Legacy `WEB_DIR=apps/web/dist` | Migration rewrites it to `/usr/lib/lifelogger/web`; the service working directory is `/usr/lib/lifelogger`. |
| Backups live on the same disk | Documented off-machine copy procedure; daily retention is 14 days. |
| GitHub renames leading-dot assets | `release.sh` uploads a temp copy named `SRCINFO`; the first release was corrected manually. |
| Post-release docs commit is ahead of the tag | Tags are built from their own commit; `build.sh` refuses a non-tag HEAD, so future releases need a new tag. |
| No SSH key on this build PC | Owner must add a key or run the migration commands; the report does not claim the install. |

## 11. Known Limitations and Deviations

- **Server install is not verified.** The package release is complete, but the
  host still runs the old deploy. This report does not claim otherwise.
- The earlier version of this report, kept in git history, described the v1
  tag-push model. This document supersedes it; the v1 tag and release remain as
  history.
- The optional server benchmark was not run, because the install is pending.
- The package is installed with `pacman -U`, not from a hosted repository, so
  there is no automatic `pacman -Syu` upgrade path by design.
- The build-PC `--nodeps` workaround is local only; the package metadata is
  correct for a normal Arch builder.
- The `lifelogger-backup.timer` is enabled by the installer, but its first real
  run on the server is part of the pending verification.

## 12. Owner Actions

1. **SSH access.** Add a public key for this PC or provide a login. From this PC:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C lifelogger-build
   ssh-copy-id root@zeserver      # asks for the root password once
   ssh root@zeserver true         # must exit 0
   ```

   Alternatively append the printed `~/.ssh/id_ed25519.pub` to
   `/root/.ssh/authorized_keys` from the server console. No private key is in the
   repository.

2. **Approve the migration**, which stops the old service and removes the old
   admin units. Data and `/etc/lifelogger.env` are not deleted; a copy of the env
   file is kept.

   ```bash
   systemctl disable --now lifelogger.service lifelogger-backup.timer
   rm /etc/systemd/system/lifelogger.service \
      /etc/systemd/system/lifelogger-backup.service \
      /etc/systemd/system/lifelogger-backup.timer
   systemctl daemon-reload
   cp -a /etc/lifelogger.env /etc/lifelogger.env.before-package
   sed -i 's|^WEB_DIR=.*|WEB_DIR=/usr/lib/lifelogger/web|' /etc/lifelogger.env
   ```

3. **Install and verify.** With a checkout available on the server, run
   `packaging/install-release.sh v0.3.6-increment-3.5`, or download the release
   asset and run `pacman -U` followed by the two `systemctl enable --now` units.
   Then check:

   ```bash
   systemctl status lifelogger.service --no-pager
   curl -fsS http://127.0.0.1:8080/health
   ```

4. **Drills.** Upgrade, rollback, restore and reboot. The reboot needs console
   access because of the kernel/module mismatch. Record the timings in this
   report.

5. **Connectivity.** Confirm the PC and phone can log events both ways over
   Tailscale, and decide whether to move from `HOST=0.0.0.0` to `tailscale serve`
   with `HOST=127.0.0.1`.

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
| Server state | Old deploy still active; package install pending SSH access |
| Drills | Pending |

The package was built and tested on this PC, not on the Pentium server. The
server only needs `pacman`, Node and `sqlite`, all of which it already has.
