# Increment 3.5: Repository, Server and Deployment

Life Logger · Specification v2 (packaging redo) · October 26, 2026 · Starts from `v0.3.5-increment-3.5`

> **Supersedes v1.** The `v0.3.5-increment-3.5` tag and release stay as history. This
> redo changes how the server is installed and upgraded, not what the product does.
> The tag-push deploy (`deploy.sh`, `post-receive`, release symlinks, building on the
> server) is removed. Pacman is the only install and upgrade mechanism.

## 1. Purpose and outcome

Increment 3 is engineering complete, published on GitHub and packaged. This
increment makes the server deployable from a package built on the development PC:
the artifact is published on GitHub, installed with `pacman -U`, and upgraded the
same way. It adds no product features.

When this increment is done:

- `packaging/` builds a real Arch package with `makepkg` on this PC, and the
  package contains the server, the built web app, the units, the service account,
  the backup timer and the backup/restore scripts.
- The package is published as a GitHub release asset with a `.sha256` and the
  `PKGBUILD`, and a fresh machine can install it with `pacman -U`.
- The server runs the same systemd service as before, with the database and
  `/etc/lifelogger.env` outside package ownership, so install, upgrade and
  removal never touch data or secrets.
- The release installer verifies the checksum, restarts the service, requires
  `/health` to report the new version and reinstalls the previous package when it
  does not.
- A migration path replaces the old `/opt/lifelogger` units without losing the
  existing API key.
- The build, install, upgrade, rollback, restore and reboot drills are recorded
  with real timings.

## 2. Context

| Item | Value |
| --- | --- |
| Code | TypeScript monorepo: `packages/domain`, `packages/persistence`, `packages/sync`, `apps/server` (Fastify, SQLite in WAL mode), `apps/web` (React, Vite), `apps/android` (Expo React Native) |
| State | `v0.3.5-increment-3.5` published; 154 tests in 23 files passing; Increment 3 benchmarks recorded on the PC |
| Development machine | Arch Linux PC, 24 cores, 15.7 GB RAM, Node v22.23.2 via nvm, kernel 7.2.11; `npm ci` and a full build take seconds |
| Build toolchain | `base-devel`, `git`, `nodejs` provider, `npm`; `makepkg`; esbuild (devDependency) |
| Server | Always-on Dell Inspiron 1545, hostname `zeserver`, Arch Linux from a persistent archiso, Pentium T4300 (2 cores), 3.78 GiB RAM, Node v24.22.1 |
| Access | SSH from the PC over Tailscale; the phone connects over Tailscale |
| Delivery | GitHub release assets, not a hosted pacman repository |
| Version | App `0.3.6`; tag `v0.3.6-increment-3.5`; package `lifelogger-0.3.6-1-any.pkg.tar.zst` |

Why `0.3.6` and not a moved `0.3.5` tag: the old tag and release are public. A
redo is a new release. The package version is the app version; the tag adds the
increment suffix.

Why the server is not the build host: it has 3.8 GB of RAM, two cores, no
`node_modules` cache and a boot chain that is not a normal installed system.
Compiling on the PC and shipping a 438 KB package is faster and leaves the server
with only `pacman` work.

## 3. Scope and non-goals

In scope: the package definition, the single-file server bundle, package-owned
units and scripts, the GitHub release, the server-side installer, migration from
the old deploy, the runbook, packaging tests, and on-host install/upgrade/
rollback/restore/reboot verification.

Out of scope, and not to be started here:

- Product features, schema changes and migrations.
- The Android `expo-sqlite` binding, Diagnostics, full-text search, things and
  dynamic types, and recurring-event expansion.
- Docker, a CI service, a hosted pacman repository and public internet exposure.
- Repairing the server kernel/module mismatch or installing Arch to the internal
  disk. The persistent archiso risk is accepted in writing.
- Building or running the full test suite on the server. The package is built and
  tested on the PC; the server install is verified by running the packaged
  artifact.

## 4. Ground rules for the agent

1. Do not guess names. Read the `package.json` scripts, the server entry point,
   the config and the existing units before referring to them.
2. Keep the 154 existing tests passing. New code gets tests; the packaging checks
   run in the package build.
3. No secrets, passwords, private keys, keystores or LAN addresses in the
   repository, the package or the release assets. Use placeholders and
   environment variables. The API key lives only in `/etc/lifelogger.env`.
4. Prefer boring tools: `makepkg`, `pacman`, systemd, git, bash and the SQLite
   CLI. esbuild is already part of the build and is used only to produce one
   runnable file instead of shipping `node_modules`.
5. Keep everything light. `/health` must not scan tables; the service keeps
   `MemoryMax=1G`; the server only downloads and installs.
6. No emojis in the UI.
7. Anything destructive on the server (deleting files, replacing the database,
   touching partitions or the boot chain) needs explicit owner confirmation
   first. Removing the old admin units during migration is part of the approved
   migration, and the old `/opt/lifelogger` tree is left in place until the
   install is verified.
8. Shell scripts are Linux-only, keep LF endings, and are executable in git. The
   package must not own `/etc/lifelogger.env` or `/var/lib/lifelogger`.
9. When a step needs the owner, stop and list exactly what the owner must run,
   then continue once the output is pasted back.
10. Build on the PC. The server never runs `npm ci`, Vite or `tsc`.

## 5. Who does what

| Task | Agent | Owner |
| --- | --- | --- |
| Repository hygiene, README, `.gitattributes`, secret scan | Done | Reviews |
| Config, `/health`, graceful shutdown, tests | Done | |
| Package definition, bundle, units, scripts, tests, runbook | Yes | Reviews |
| Build `makepkg` on the PC and verify the artifact | Yes | |
| Create the tag and GitHub release | Yes | Approves the release |
| Install, upgrade and rollback on the server | Provides commands; runs only with approval | Confirms destructive steps |
| Reboot and restore drills | Provides commands | Runs and confirms |
| Tailscale and Android verification | Provides commands | Runs |
| Benchmark baseline on the server (optional) | Provides commands | Runs |

## 6. Work packages

### WP 3.5.1: Repository and GitHub (done)

- Public repository at `github.com/Marvelous616/you`, `main` and the four
  historical tags, including `v0.3.5-increment-3.5`.
- No secrets or absolute local paths in the working tree or history; `.gitignore`
  covers `node_modules`, databases, `.env`, Expo output and signing material.
- `.gitattributes` keeps LF for shell scripts, units, `.install`, `PKGBUILD` and
  everything under `packaging/`.
- `README.md` documents requirements, build, test, package, run and layout.

Acceptance (met): a fresh clone builds and passes the suite; the scan reports no
secrets.

### WP 3.5.2: Runtime configuration and health (done)

- Every runtime setting comes from the environment: `DB_PATH`, `WEB_DIR`, `HOST`,
  `PORT`, `LOG_LEVEL` and `API_KEY`. Package defaults live in
  `/usr/lib/lifelogger/lifelogger.env`; `/etc/lifelogger.env` overrides them.
- The package unit loads `version.env` last, so `APP_VERSION` comes from the
  package and cannot be overridden by accident.
- `GET /health` is unauthenticated and returns `status`, `database`, `version`,
  `schemaVersion`, `syncProtocolVersion` and a timestamp. The probe is a
  single-row `SELECT 1`; the schema version is read once at startup.
- The built web app is served by the same process. `index.html` is `no-cache`,
  hashed assets are immutable, and unknown extension-less `GET` paths fall back
  to `index.html`.
- `SIGTERM`/`SIGINT` stop accepting requests, drain, checkpoint the WAL, close
  SQLite and exit 0.

Acceptance (met): server tests cover health, config, static serving, auth scoping
and shutdown; the packaged bundle serves `/health` and the web app.

### WP 3.5.3: Package and build artifacts

Replace the old `deploy/` tree with `packaging/`.

| File | Purpose |
| --- | --- |
| `PKGBUILD` | `lifelogger`, `arch=('any')`, builds from the pushed release tag. Runtime deps: `nodejs>=22.5`, `sqlite`. |
| `bundle-server.mjs` | esbuild bundle of `apps/server/dist/index.js` to one CommonJS file. CJS keeps Fastify's dynamic requires working; `import.meta.url` is replaced with the bundle location for `node:sqlite`. |
| `lifelogger.service` | Runs `/usr/bin/node /usr/lib/lifelogger/server.cjs` as `lifelogger`, loads package defaults, then `/etc/lifelogger.env`, then `version.env`; keeps the hardening and `MemoryMax=1G`. |
| `lifelogger-backup.service`, `.timer` | Runs the packaged backup script daily at 03:30 with jitter and persistence. |
| `lifelogger.sysusers`, `.tmpfiles` | Creates the service account and `/var/lib/lifelogger[/backups]`, mode 0750. |
| `lifelogger.env` | Package defaults: data path, web directory, loopback bind, port 8080. |
| `lifelogger-runner` | `/usr/bin/lifelogger` foreground wrapper. |
| `backup.sh`, `restore.sh` | Packaged at `/usr/lib/lifelogger/`; restore still requires `--yes`. |
| `lifelogger.install` | Post-install message only; it does not enable units. |
| `build.sh` | Validates version/tag, runs `makepkg`, writes `.sha256`, verifies the artifact. |
| `release.sh` | Checks `.SRCINFO`, pushes `main` and the annotated tag, builds, creates the GitHub release. |
| `install-release.sh` | Server-side download, checksum, `pacman -U`, restart, health, rollback; refuses while an admin unit shadows the package. |
| `test/` | Package-input and bundle checks; backup/restore/installer stub tests; built-package verification. |
| `README.md` | Build, publish, migrate, install, upgrade, rollback, restore, logs, drills, security and the accepted risk. |

Requirements:

- The package owns only `/usr/bin/lifelogger`, `/usr/lib/lifelogger`,
  `/usr/lib/systemd/system/lifelogger*`, `/usr/lib/sysusers.d/lifelogger.conf`,
  `/usr/lib/tmpfiles.d/lifelogger.conf` and `/usr/share/doc/lifelogger`.
  It must not own `/etc/lifelogger.env` or `/var/lib/lifelogger`.
- `npm ci --ignore-scripts`, `npm run build`, the full test suite, the Android
  typecheck and the packaging checks run inside `check()`.
- `build.sh` refuses a version/tag mismatch and refuses to build a tag that is not
  on `origin`. On this PC it passes `makepkg --nodeps` only after checking that
  the `node` on `PATH` is at least 22.5, because pacman's installed provider is an
  older LTS.
- Scripts use `set -euo pipefail`, quoted variables, overridable commands and
  paths, and `flock` around the installer.

Acceptance:

- `makepkg` produces `lifelogger-0.3.6-1-any.pkg.tar.zst`.
- `verify-package.sh` passes: file list, metadata, ownership boundaries and a
  smoke test of the extracted server.
- The bundle runs from a directory with no `node_modules` and answers `/health`.
- The packaging tests pass with stubs; the full suite still passes.

### WP 3.5.4: Publish and migrate

- Push `main`, tag `v0.3.6-increment-3.5` and publish a GitHub release with the
  package, `.sha256`, `PKGBUILD` and `SRCINFO` (a copy of the repository's
  `.SRCINFO`; GitHub renames leading-dot assets).
- Record the release URL, artifact size and checksum.
- Server migration, once:
  1. Disable and remove the old admin units in `/etc/systemd/system/` so the
     packaged units are visible.
  2. Keep `/etc/lifelogger.env`; change `WEB_DIR` to
     `/usr/lib/lifelogger/web`.
  3. Install with `pacman -U` or `install-release.sh`, then enable
     `lifelogger.service` and `lifelogger-backup.timer`.
- Leave `/opt/lifelogger` untouched until the package install is verified.

Acceptance:

- The release assets exist and the checksum matches.
- `/health` reports `0.3.6` and the web footer shows the same version.
- The service is enabled and the packaged unit, not the old one, is active.

### WP 3.5.5: On-host verification and drills

- Install the package on the server; confirm `/health`, the web app and the
  service account.
- Record install and upgrade timings, idle RSS and CPU of the service.
- Upgrade with `install-release.sh` and keep the previous package in
  `/var/cache/lifelogger`.
- Rollback drill: install a release whose health check fails (for example, a
  broken `WEB_DIR` through `/etc/lifelogger.env`), confirm the installer restores
  the cached package, and restore the configuration.
- Restore drill: take a backup, change data, restore with `--yes` against a
  scratch database first, check `PRAGMA integrity_check`.
- Reboot drill: confirm the service and the timer return without a login. Only
  after checking that the kernel on `sda1` and `/lib/modules` agree.
- Optional: run the benchmark harness from a checkout on the server and save
  `docs/benchmarks/increment-3.5-server-baseline.json`. This is not a gate for
  the packaging redo; the PC baseline remains the reference.

Acceptance:

- The service is healthy after install, upgrade and reboot.
- Rollback and restore drills pass and are timed.
- The report records the build host, the package numbers and the drill results.

### WP 3.5.6: Benchmark regression guard (done)

- `tools/bench` has `--output`, `--host-label`, `--compare` and `--help`.
- Compare mode fails when a shared metric exceeds 3x its baseline.
- Tests cover the compare pass/fail paths.
- Server baseline remains pending; the PC baseline is unchanged.

### WP 3.5.7: Connectivity (pending, owner)

- Tailscale is installed and up on the server, PC and phone.
- Preferred transport: HTTPS through `tailscale serve` with `HOST=127.0.0.1`.
- The Android **Server Connection** card holds the URL and API key for the
  session.
- End-to-end: log on the PC, see it on the phone, and the reverse, once with
  Wi-Fi off on the phone.

Acceptance: sync works all three ways through the tailnet.

## 7. Reference snippets

Package tree on the server:

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

PKGBUILD, reduced to the decisions that matter:

```bash
pkgname=lifelogger
pkgver=0.3.6
pkgrel=1
arch=('any')
depends=('nodejs>=22.5' 'sqlite')
makedepends=('git' 'nodejs' 'npm')
_tag="v${pkgver}-increment-3.5"
source=("$pkgname-$pkgver::git+https://github.com/Marvelous616/you.git#tag=${_tag}")
sha256sums=('SKIP')
```

The bundle step:

```bash
npm ci --no-audit --no-fund --ignore-scripts
npm run build
node packaging/bundle-server.mjs "$srcdir/build/server.cjs"
```

The installed unit env order:

```ini
EnvironmentFile=/usr/lib/lifelogger/lifelogger.env
EnvironmentFile=-/etc/lifelogger.env
EnvironmentFile=-/usr/lib/lifelogger/version.env
```

Build and publish:

```bash
packaging/build.sh      # builds the tag, writes the package and checksum
packaging/release.sh    # pushes the tag, builds, creates the GitHub release
```

Install and rollback on the server:

```bash
packaging/install-release.sh v0.3.6-increment-3.5
pacman -U /var/cache/lifelogger/lifelogger-<previous>-1-any.pkg.tar.zst
systemctl restart lifelogger.service
```

## 8. Quality gates

- [ ] A fresh clone builds and the 154 tests pass.
- [ ] No secrets or absolute local paths in the repository or history.
- [ ] `.gitattributes` keeps LF; scripts and the runner are executable in git.
- [ ] `/health` returns the version, schema version and sync protocol version,
      and the probe does not scan tables.
- [ ] Clean shutdown on `SIGTERM` is tested.
- [ ] Packaging checks pass: static inputs, bundle smoke test and stub tests.
- [ ] `shellcheck` is clean for the packaging scripts (or the report says why it
      could not run).
- [ ] `makepkg` produces the package, and `verify-package.sh` passes.
- [ ] The package does not own `/etc/lifelogger.env` or `/var/lib/lifelogger`.
- [ ] The GitHub release has the package, `.sha256`, `PKGBUILD` and `SRCINFO`.
- [ ] The server installs the package; the packaged unit is active and enabled.
- [ ] `/health` and the web footer report the packaged version.
- [ ] Upgrade and rollback drills pass; the previous package is cached.
- [ ] The restore drill passes with `PRAGMA integrity_check`.
- [ ] The service and backup timer return after a reboot without a login.
- [ ] The benchmark regression guard works on the PC.
- [ ] The report records the build host, artifact size, checksum and drill
      timings.
- [ ] The PC and phone sync through the server over Tailscale (owner, pending).

## 9. Verification drills

1. **Build drill.** Time `packaging/build.sh` on the PC. Record the duration,
   package size, checksum and the `makepkg` output summary.
2. **Install drill.** Install the artifact on the server from a clean data
   directory. Record the time to a healthy `/health` and the web footer version.
3. **Upgrade drill.** Install the next tag with `install-release.sh`. Confirm the
   previous package is in `/var/cache/lifelogger`.
4. **Rollback drill.** Point the unit at a broken `WEB_DIR` through a temporary
   override so health fails, run the installer, and confirm it reinstalls the
   cached package. Restore the override and record the timing.
5. **Restore drill.** Backup, change data, restore the backup with `--yes` against
   a scratch `DB_PATH` first, then the live database. Check the record and
   `PRAGMA integrity_check`.
6. **Reboot drill.** Reboot and confirm `lifelogger.service` and
   `lifelogger-backup.timer` are active without a login.

## 10. Completion report

Use the same format as the earlier reports, plus:

- A build-host section: OS, CPU, RAM, Node version, package size, checksum, build
  duration.
- A release section: tag, URL and asset list.
- The server facts and the migration steps actually used.
- The drill results and timings, including any that remain blocked.
- Explicit deviations from this spec and why.

The benchmark table keeps the PC column and marks the server column pending or
records it if the optional run happened.

## 11. Risks and decisions to record

| Risk | Mitigation |
| --- | --- |
| The server is a persistent archiso, not an installed system | Accepted in writing on 2026-10-26; no blind `pacman -Syu`, keep the ISO, watch overlay space, off-machine copies. |
| Running kernel and `/lib/modules` disagree | Do not reboot without checking; no zram-dependent design; the service is light. |
| The package is unsigned | Publish and verify a `.sha256`; download only from this repository; do not add third-party repos. |
| The build PC's pacman Node provider is older than 22.5 | `build.sh` checks the Node on `PATH` and uses `--nodeps` only in that case; the PKGBUILD still declares the real requirement. |
| Tag must exist before the package build | `release.sh` pushes `main` and the tag, then builds; a failed build leaves a tag without a release, fixed by moving the tag before publishing. |
| Fastify cannot be bundled to ESM | The bundle is CommonJS; `import.meta.url` is replaced for `node:sqlite`. |
| Old admin units shadow the packaged units | The installer refuses; the migration removes them explicitly. |
| The legacy env sets `WEB_DIR=apps/web/dist` | Migration sets `/usr/lib/lifelogger/web`; the unit's working directory is the package root. |
| Backups live on the same disk | Periodic copies to the PC, recorded in the runbook. |
| A bad release changes the schema | Additive migrations within a release; the installer rolls back the package; the backup is the real safety net. |

## 12. After this increment

The 14-day dual-device dogfood clock should start once Increment 4 WP 4.1 (the
Android `expo-sqlite` binding) and the Diagnostics extension are in. Until then,
do the real logging on the PC and use the phone only to try things.
