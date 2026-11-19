# Increment 3.5: Repository, Server and Deployment

Life Logger · Specification v2 · November 20, 2026 · Starts from `v0.3.0-increment-3`

## 1. Purpose and outcome

Increment 3 is engineering complete but exists only on the development PC. This increment puts it on GitHub and on the always-on home server as a native Arch package, built on the PC and installed with `pacman`. It adds no product features.

When this increment is done:

- The code is in a GitHub repository, and a fresh clone builds and passes all tests.
- A single `.pkg.tar.zst` is assembled on the PC, attached to a GitHub release, and installs the server bundle, web app, systemd units and configuration on Arch.
- The server runs Life Logger as a service that starts on boot and restarts on failure.
- `lifelogger-update <version>` downloads a release, verifies it, installs it, health-checks it and rolls back on failure. Pushing a git tag does **not** deploy.
- The database is backed up daily, and a restore has been tested.
- The PC and the phone can both reach the server, and a change logged on one shows up on the other.
- The test suite and benchmarks have been run on the server hardware, so the performance targets are measured on the real host.

## 2. Context

| Item | Value |
| --- | --- |
| Code | TypeScript monorepo: `packages/domain`, `packages/persistence`, `packages/sync`, `apps/server` (Fastify, SQLite in WAL mode), `apps/web` (React, Vite), `apps/android` (Expo React Native) |
| State | Tagged `v0.3.0-increment-3` per the Increment 3 report, 132 tests passing, benchmarks recorded in `docs/benchmarks/increment-3-baseline.json` |
| Development machine | Windows PC (PowerShell); Node v24.x, GNU tar available, no WSL and no makepkg |
| Server | Always-on Dell Inspiron 1545 laptop, hostname `zeserver`, Arch Linux from a persistent archiso overlay, Pentium T4300 (2 cores), about 3.8 GB RAM, on the tailnet |
| Access | SSH as root from the PC; the phone connects over Tailscale HTTPS |
| Runtime dependency | Node 24 built-in `node:sqlite`; no native SQLite module to cross-compile |

The server is a low-end machine and the package is built elsewhere. Anything this increment adds must be light on CPU and memory at runtime.

## 3. Scope and non-goals

In scope: the GitHub push, runtime configuration, a health endpoint, a reproducible Arch package, the release asset, a health-checked updater, backup and restore scripts, systemd units, server provisioning, connectivity from the PC and the phone, and on-host verification.

Out of scope, and not to be started here:

- Product features, schema changes and migrations.
- The Android `expo-sqlite` binding. It is still needed before the 14-day dual-device dogfood and is the first work package of Increment 4.
- The Diagnostics extension, full-text search, things and dynamic types, and recurring-event expansion.
- Docker, a CI service, a GitHub Pages pacman repository, and exposing the server to the public internet.

## 4. Ground rules for the agent

1. Do not guess names. Read the `package.json` scripts, the server entry point and the existing config before writing anything that refers to them, and use what you find.
2. Keep all existing tests passing. New code gets tests.
3. No secrets, passwords, private keys, keystores, LAN addresses or tailnet addresses in the repository. Use placeholders and environment variables.
4. Prefer boring tools: bash, systemd, git, SQLite CLI and Node's standard library. esbuild is the one new build dependency: it turns the server and workspace packages into one JavaScript file so no `node_modules` ships in the package. Node's built-in zstd and a small ustar writer assemble the archive on Windows without WSL, Docker or fakeroot.
5. Keep everything light. `/health` must not scan tables, and scripts must work with 3.8 GB of RAM.
6. No emojis in the UI.
7. Anything destructive on the server (deleting files, replacing the database, touching partitions) needs explicit confirmation from the owner first.
8. Shell scripts are written for Linux. `.gitattributes` keeps LF line endings and git records the executable bits.
9. When a step needs the owner, stop and list exactly what the owner must run, then continue once the output is pasted back.
10. No package may overwrite `/etc/lifelogger.env`, `/var/lib/lifelogger` or the service contract. The env file is a pacman `backup=` file; data is owned by tmpfiles and never packaged.

## 5. Who does what

| Task | Agent | Owner |
| --- | --- | --- |
| Repository hygiene, README, `.gitattributes`, secret scan | Yes | Reviews |
| Create the GitHub repository and push | Provides commands | Yes |
| Config, `/health`, graceful shutdown, tests | Yes | |
| Package sources, builder, updater, units, runbook in `packaging/` | Yes | Reviews |
| Build and inspect the package on the PC | Yes | |
| Publish the GitHub release asset | Provides commands, prepares asset | Yes (release creation) |
| Commands on the server | Only over an SSH session the owner opens or approves | Otherwise runs them |
| Install, upgrade and rollback | Provides exact commands | Runs or approves |

## 6. Work packages

### WP 3.5.1: Repository and GitHub

Tasks

- Verify the release tag exists with `git tag -l` and points at the Increment 3 commit. Create it if it does not.
- Review `.gitignore`: `node_modules`, build output, `*.db`, `*.db-wal`, `*.db-shm`, `.env` files, Expo and Android build output, `*.jks` and `*.keystore`.
- Add `.gitattributes` forcing LF for `*.sh`, `packaging/**` and unit files, and mark shell scripts executable in git with `git update-index --chmod=+x`.
- Scan the working tree and the full history for secrets and absolute local paths. Replace absolute `file://` links in tracked docs with relative links.
- Add a `README.md`: what it is, requirements, install, test, build, run, environment variables, repository layout, and a link to `packaging/README.md`.
- Owner: create the GitHub repository, add `origin`, and push `main` and all tags.

Acceptance

- `git ls-remote --tags origin` lists `v0.3.0-increment-3`.
- A fresh clone in an empty folder passes `npm ci`, the root build and the full test suite.
- No tracked file contains a secret or an absolute path on the PC.

### WP 3.5.2: Runtime configuration and health

Tasks

- Read every runtime setting from environment variables with documented defaults: database path, port, bind address, static web directory and log level. Commit an `.env.example`.
- Make the server serve the built web app. `index.html` is sent with `no-cache` and hashed assets with long cache lifetimes, so a new release shows up on the next page load.
- Add `GET /health`, with no authentication, returning JSON with `status`, the app version, the schema version and the sync protocol version. It reads cached or pragma values only, and returns 503 if the database cannot be opened.
- Show the server version in the web footer, so an install can be confirmed by eye.
- Handle `SIGTERM` and `SIGINT`: stop accepting requests, finish in-flight ones, checkpoint the WAL, close SQLite and exit 0.
- On startup, log the version, the database path and the schema version. If the database schema is newer than the code, log a warning and keep running. Additive-only migrations within a release are recorded in `packaging/README.md`.

Acceptance

- Tests cover `/health` (ok and failure), environment parsing and clean shutdown. All earlier tests still pass.
- A trivial UI change in a new package makes the new version visible on a normal page reload.

### WP 3.5.3: Package build artifacts

Create a `packaging/` folder. The owner reviews everything in it before anything runs on the server.

| File | Purpose |
| --- | --- |
| `build-package.mjs` | Cross-platform builder: runs the workspace build, esbuild-bundles the server, stages files, writes `.PKGINFO`/`.MTREE`, assembles a deterministic tar and compresses it with zstd. |
| `lib/tar.mjs` | Minimal ustar header writer and gzip mtree generator. No new runtime dependency. |
| `files/` | Installed payload: systemd units, `lifelogger` launcher, `lifelogger-update`, backup/restore scripts, sysusers and tmpfiles snippets, env template, install scriptlet and package README. |
| `PKGBUILD` | Reference for reproducing the same package with `makepkg` on a native Arch host. Not used for releases. |
| `test/` | Package metadata tests (vitest) and shell safety-gate tests. |
| `README.md` | Runbook: build, release, install, upgrade, rollback, restore, logs, server facts and troubleshooting. |

Package layout

```text
usr/bin/lifelogger                       launcher; forces APP_VERSION from the package
usr/bin/lifelogger-update                release updater with health check and rollback
usr/lib/lifelogger/server.js             esbuild bundle, no node_modules
usr/lib/lifelogger/version               pkgver, used by /health
usr/lib/lifelogger/web/                  built Vite app
usr/lib/lifelogger/backup.sh
usr/lib/lifelogger/restore.sh
usr/lib/systemd/system/lifelogger.service
usr/lib/systemd/system/lifelogger-backup.service
usr/lib/systemd/system/lifelogger-backup.timer
usr/lib/sysusers.d/lifelogger.conf
usr/lib/tmpfiles.d/lifelogger.conf
usr/share/doc/lifelogger/README
etc/lifelogger.env                       backup=, never replaced on upgrade
.INSTALL                                 creates account/dirs, prints next steps
.PKGINFO / .MTREE                        generated by the builder
```

Requirements

- `set -euo pipefail`, quoted variables and clean `shellcheck` in every installed shell script.
- `restore.sh` requires root and an explicit `--yes`.
- `lifelogger-update` validates `<x.y.z>`, verifies the release SHA-256, backs up the database, installs with `pacman -U`, enables the units, waits for `/health` to report the new version, and restores the previous package on failure. `--health-url` exists so the rollback drill can force a failure.
- All paths and commands are overridable by environment variables so the shell tests can use stubs.
- The archive has uid/gid 0, fixed mtime, modes 0755 for executables, 0600 for the env file and 0644 for everything else.

Acceptance

- `npm run build:package -- --version 0.3.5 --pkgrel 1` produces `lifelogger-0.3.5-1-x86_64.pkg.tar.zst` and a `.sha256` file.
- An independent libarchive reader (`tar -tvf`) lists the expected files with the expected modes.
- Package tests and shell safety tests pass; `shellcheck` is clean.

### WP 3.5.4: Server provisioning

Mostly run by the owner, with the agent providing exact commands and checking output.

1. Run `findmnt /`, `lsblk -f`, `cat /etc/os-release`, `uname -r` and `node -v`. The server is a persistent Arch archiso overlay, not an installed system; the owner accepted that risk in writing on 2026-10-26. The decision and mitigations are recorded in `packaging/README.md`.
2. Confirm SSH key login from the PC.
3. Confirm Node major 24 on the server (it is v24.22.1). No build happens there, so only the runtime matters.
4. Copy the package and its checksum to the server and verify with `sha256sum -c`.
5. Install with `pacman -U --noconfirm`, set `API_KEY` in `/etc/lifelogger.env`, then enable the service and the backup timer.

Acceptance

- `pacman -Qi lifelogger`, `pacman -Qkk lifelogger`, `systemctl is-active lifelogger` and `systemctl is-enabled lifelogger-backup.timer` all pass.
- After a reboot, the service is up and healthy within 2 minutes without anyone logging in.

### WP 3.5.5: First install and on-host verification

Tasks

- Tag `v0.3.5`, build the package on the PC from that tag, and upload the `.pkg.tar.zst` and `.sha256` to the GitHub release.
- Record the PC-side build duration and peak memory of `npm ci` plus the package build. No build runs on the server.
- Run the full test suite on the server from a fresh clone or a copied checkout.
- Run the benchmark harness on the server and save the result as `docs/benchmarks/increment-3.5-server-baseline.json`, including host details (CPU model, RAM, Node version, tag). Report each metric against its target and against the PC baseline. Any metric over target is a blocker; any metric with less than 5x headroom is flagged.
- Record the idle memory and CPU use of the running service.

Acceptance

- `/health` answers with `version: 0.3.5`, matching `/usr/lib/lifelogger/version` and `pacman -Q lifelogger`.
- All tests pass on the server, and all benchmark targets pass on the server.

### WP 3.5.6: Benchmark regression guard

Tasks

- Let the benchmark harness take an output path and a host label.
- Add a compare mode that reads a baseline JSON and fails if any metric is more than 3x slower than its baseline value.
- Document in the README how to run it on the PC and on the server.

Acceptance

- A test shows compare mode passes on the baseline itself and fails on a deliberately slowed copy.

### WP 3.5.7: Connectivity

Tasks

- Install Tailscale on the server, the phone and the PC, and record the server's tailnet name in the runbook.
- Use option A: HTTPS through `tailscale serve --bg 8080`. The service binds to `127.0.0.1`; Android needs no cleartext exemption.
- Make sure the Android app has a way to set the server address, and use it.
- End-to-end check: log a marker on the PC and see it on the phone after sync, then the reverse. Import an `.ics` file in the web app and see the suggestions on the phone.

Acceptance

- Sync works between the PC and the phone through the server with Wi-Fi off on the phone.

## 7. Reference snippets

Build on the PC:

```bash
git tag v0.3.5
npm ci
npm run build:package -- --version 0.3.5 --pkgrel 1
# attach dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst and its .sha256
# to the GitHub release v0.3.5
```

Install on the server:

```bash
scp lifelogger-0.3.5-1-x86_64.pkg.tar.zst* root@zeserver:/tmp/
ssh root@zeserver
cd /tmp && sha256sum -c lifelogger-0.3.5-1-x86_64.pkg.tar.zst.sha256
pacman -U --noconfirm lifelogger-0.3.5-1-x86_64.pkg.tar.zst
# set API_KEY in /etc/lifelogger.env
systemctl enable --now lifelogger.service lifelogger-backup.timer
curl -fsS http://127.0.0.1:8080/health
```

Upgrade from a GitHub release:

```bash
lifelogger-update 0.4.0
```

`/etc/lifelogger.env` template:

```text
DB_PATH=/var/lib/lifelogger/life-logger.sqlite
WEB_DIR=/usr/lib/lifelogger/web
HOST=127.0.0.1
PORT=8080
LOG_LEVEL=info
API_KEY=<generated on the server>
```

## 8. Quality gates

- [ ] A fresh clone from GitHub builds and passes all tests.
- [ ] No secrets, LAN or tailnet addresses, or absolute local paths in the repository or its history.
- [ ] `.gitattributes` keeps LF endings, and the scripts are executable in git.
- [ ] `/health` returns the version, schema version and sync protocol version, and is tested.
- [ ] Clean shutdown on `SIGTERM` is tested.
- [ ] Package metadata tests, shell safety tests and `shellcheck` pass.
- [ ] The package installs cleanly with `pacman -U` and passes `pacman -Qkk`.
- [ ] `backup=` preserves `/etc/lifelogger.env` across an upgrade.
- [ ] The service is enabled, survives a reboot and starts without a login.
- [ ] `lifelogger-update` health-checks and rolls back on failure.
- [ ] The rollback drill, restore drill and reboot drill passed.
- [ ] The daily backup timer runs, and a backup passes `PRAGMA integrity_check`.
- [ ] Tests and benchmarks pass on the server, and the baseline JSON is saved.
- [ ] The benchmark regression guard works.
- [ ] The PC and the phone sync through the server over Tailscale.
- [ ] Release `v0.3.5` with its package asset exists; prior increment tags stay as history.

## 9. Verification drills

1. **Rollback drill.** Run `lifelogger-update <version> --health-url http://127.0.0.1:1/health` after at least one successful install. The install succeeds, the health check fails, and the helper reinstalls the previous package. Confirm `/health` reports the old version and record the timing.
2. **Restore drill.** Take a backup, change some data, then restore the backup with `restore.sh --yes` against a scratch database path first. Confirm the restored data and `PRAGMA integrity_check`, and record the timing.
3. **Reboot drill.** Reboot the server and confirm the service and the backup timer come back without a login.
4. **Build drill.** Record the PC-side `npm ci` and package build time and peak memory. No build runs on the server.

## 10. Completion report

Use the same format as the earlier reports, plus a Server facts section containing:

- The output of `findmnt /` and `lsblk -f`.
- The Node versions on the PC and the server.
- A summary of the SSH and Tailscale setup, with addresses replaced by placeholders.
- The package build time, package size and checksum.
- The results and timings of the drills, and the idle resource use.

The benchmark table gets two columns, one for the PC and one for the server.

## 11. Risks and decisions to record

| Risk | Mitigation |
| --- | --- |
| The server runs a persistent archiso, not an installed Arch | Owner accepted the risk in writing; `packaging/README.md` records the evidence and mitigations |
| Hand-built package is not made by makepkg | Deterministic ustar/mtree writer; verified with libarchive (`tar -tvf`) and by installing it on the real host |
| Windows line endings break the shell scripts | `.gitattributes`, executable bits and `npm run shellcheck` |
| The native SQLite module fails on the old CPU | None needed: Node 24 ships `node:sqlite`, and the server's Node major matches the PC |
| Android blocks plain http | HTTPS through `tailscale serve`, with `HOST=127.0.0.1` |
| A bad release locks in a schema change | Additive-only migrations, pre-update backup and automatic package rollback |
| Backups on the same disk are lost with it | A periodic copy to the PC, noted in the runbook |
| Release upload needs credentials | PC prepares the asset; owner creates the release or authenticates `gh` |

Decisions to record in `packaging/README.md`: live vs installed OS, HTTPS vs cleartext, build on the PC, GitHub release asset vs pacman repository, and public repository.

## 12. After this increment

The 14-day dual-device dogfood clock should start once Increment 4 WP 4.1 (the Android `expo-sqlite` binding) and the Diagnostics extension are in. Until then, do the real logging on the PC and use the phone only to try things.
