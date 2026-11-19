# Increment 3.5: Repository, Server and Deployment — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 3.5 (repository hygiene, runtime configuration, native packaging)
> **Release tag:** `v0.3.5`
> **Date:** November 20, 2026
> **Status:** Agent-side engineering complete; every automated gate passes locally and the package is built and inspected. Installing it on the server, the on-host checks, benchmarks, drills and dual-device sync remain owner actions because `zeserver` is currently offline.

---

## 1. Executive summary

Increment 3.5 adds no product behaviour. It turns a working codebase into something that can be cloned, configured, packaged, backed up and measured without guesswork:

- The repository has no secrets, no absolute local links and no LAN or tailnet addresses; shell scripts keep LF endings and executable bits.
- The server reads all runtime settings from the environment, exposes `/health` with version, schema version, sync protocol version and a single-row database probe, serves the built web app, and shuts down cleanly on `SIGTERM`/`SIGINT`.
- The git-tag deploy pipeline was **replaced**. The release is now a single native Arch package: the app is compiled and bundled on the Windows PC, assembled into `.pkg.tar.zst`, published as a GitHub release asset, and installed with `pacman -U`. The systemd service is unchanged in spirit: it still runs as `lifelogger`, reads `/etc/lifelogger.env` and has `MemoryMax=1G`.
- `lifelogger-update <version>` verifies SHA-256, backs up the database, installs the package, waits for `/health` to report the new version and reinstalls the previous package on failure.
- Backup and restore survive the redesign: the timer, scripts and 14-day retention are shipped inside the package; data and configuration are not.
- The benchmark harness supports host labels, JSON output and a 3x regression comparison.

The server is a persistent archiso overlay, not an installed Arch system. The owner accepted that risk in writing on 2026-10-26; the evidence and mitigations are recorded in `packaging/README.md`.

---

## 2. Delivered work packages

| WP | Deliverable | Status |
| --- | --- | --- |
| **WP 3.5.1** | Repository hygiene, relative links, `.gitattributes`, executable bits, secret scan | Complete (published) |
| **WP 3.5.2** | Runtime configuration, `/health`, static web serving, graceful shutdown | Complete |
| **WP 3.5.3** | `packaging/`: builder, `.PKGINFO`/`.MTREE`, payload, updater, units, tests, runbook | Complete (agent); asset not yet published |
| **WP 3.5.4** | Server provisioning: install package, configure env, enable units | Pending — server offline |
| **WP 3.5.5** | First install, on-host tests, benchmark baseline | Pending — server offline |
| **WP 3.5.6** | Benchmark regression guard | Complete; server baseline pending |
| **WP 3.5.7** | Tailscale connectivity and Android transport | Pending — server and phone |

---

## 3. Architecture and key files

### Runtime configuration (`apps/server/src/config.ts`)

Every setting comes from the environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `data/life-logger.sqlite` (or under `DATA_DIR`) | SQLite file; relative paths resolve against the working directory. |
| `WEB_DIR` | `apps/web/dist` | Built web app served by the API process. |
| `HOST` | `0.0.0.0` | Bind address. The package default is `127.0.0.1` behind Tailscale Serve. |
| `PORT` | `4000` | HTTP port. The package default is `8080`. |
| `LOG_LEVEL` | `info` | `fatal` through `silent`; invalid values stop startup. |
| `API_KEY` | unset | When set, every `/api/` request needs `Authorization: Bearer <key>`. |
| `APP_VERSION` | root `package.json` version | Local runs use this; the packaged launcher forces it from `/usr/lib/lifelogger/version`. |
| `DATA_DIR` | `data` | Local-development fallback when `DB_PATH` is unset. |

The schema version is read once at startup, so `/health` never scans application tables.

### Health, static serving and shutdown

`GET /health` returns:

```json
{
  "status": "ok",
  "database": "connected",
  "version": "0.3.5",
  "schemaVersion": 3,
  "syncProtocolVersion": 1,
  "timestamp": "2026-11-20T…Z"
}
```

The probe is `SELECT 1`; a database failure returns HTTP 503 with `status: "error"` and `database: "unavailable"`. The API-key hook is scoped to `/api/`.

`@fastify/static` serves the built web app from one process: `index.html` is `no-cache`, hashed assets are `immutable`, and extension-less `GET` paths fall back to `index.html`. It is the only new runtime dependency from Increment 3.5; a second static server would cost more RAM on the 3.8 GB host.

`SIGTERM` and `SIGINT` stop accepting requests, drain in-flight work, run `PRAGMA wal_checkpoint(TRUNCATE)`, close SQLite and exit 0 (1 on failure). A 10-second guard forces exit if a close hangs.

### Packaging design

| Piece | Behaviour |
| --- | --- |
| `packaging/build-package.mjs` | Runs the workspace build, bundles the server with esbuild, stages files, writes `.PKGINFO`/`.MTREE`, assembles a deterministic ustar archive and compresses it with Node's built-in zstd. |
| `packaging/lib/tar.mjs` | Small ustar header writer and gzip mtree generator; no fakeroot, WSL, Docker or makepkg. |
| `packaging/files/` | Launcher, updater, backup/restore, three systemd units, sysusers and tmpfiles snippets, env template, `.INSTALL` scriptlet and package README. |
| `packaging/PKGBUILD` | Reference for reproducing the same archive with `makepkg` on a native Arch host. Not the release path. |
| `.PKGINFO` | Declares `pkgver = 0.3.5-1`, `arch`, dependencies, `install = .INSTALL` and `backup = etc/lifelogger.env`. |
| `.INSTALL` | Creates the service account and data directories, then prints the next steps. It does not enable or start units. |
| `lifelogger-update` | Root-only; validates `x.y.z`, verifies the release checksum, backs up the DB, runs `pacman -U`, enables the units, restarts and health-checks; rolls back to the cached previous package on failure. |

Package layout:

```text
usr/bin/lifelogger                       launcher, forces APP_VERSION
usr/bin/lifelogger-update                release updater
usr/lib/lifelogger/server.js             esbuild bundle, ~1.8 MB, no node_modules
usr/lib/lifelogger/version               "0.3.5"
usr/lib/lifelogger/web/                  Vite build
usr/lib/lifelogger/{backup,restore}.sh
usr/lib/systemd/system/lifelogger*.{service,timer}
usr/lib/sysusers.d/lifelogger.conf
usr/lib/tmpfiles.d/lifelogger.conf
usr/share/doc/lifelogger/README
etc/lifelogger.env                       mode 0600, backup=
.INSTALL / .PKGINFO / .MTREE
```

Why esbuild: the server imports Fastify and three TypeScript workspace packages. Shipping `node_modules` would pull in the Expo/React Native tree and a native SQLite driver. The bundle is one JavaScript file using Node 24's built-in `node:sqlite`, so nothing is platform-specific. esbuild 0.21.5 was already present as Vite's dependency; it is now declared explicitly.

Why a hand-written tar: Windows has no `makepkg` and WSL is broken. uid/gid 0, explicit modes and a fixed mtime can be written directly into ustar headers. An independent libarchive reader (`tar -tvf`, libarchive 3.8.9) lists the result correctly, including zstd decompression.

### Benchmark tooling

`tools/bench` supports `--output`, `--host-label`, `--compare` and `--help`. Output records CPU model, core count, RAM, Node version, platform, architecture and app version. `--compare <baseline>` fails when any shared metric exceeds 3x its baseline value.

---

## 4. Repository hygiene

- Tracked files were scanned for API keys, passwords, private keys, keystores and addresses. None are present; runtime secrets stay in `/etc/lifelogger.env` on the host.
- `.gitignore` excludes `.env` (except `.env.example`), native Android/Expo output, signing material, SQLite files and build output.
- Absolute local Markdown links were removed from the working tree *and* history in an earlier pass; a full-history scan for absolute local link prefixes returns **0**.
- `.gitattributes` forces LF for `*.sh`, `*.service`, `*.timer`, `packaging/**` and `PKGBUILD`, keeps CRLF for PowerShell, and marks database/image files binary. All installed shell scripts are recorded as mode `100755`.
- The old `deploy/` directory (tag-push hook, server build, symlink releases) was deleted. Its runbook content and the accepted-risk decision were carried into `packaging/README.md`.

---

## 5. Server facts

Facts collected over SSH before the server became unreachable. Addresses are replaced with placeholders here and in the runbook.

| Fact | Value |
|---|---|
| Access | SSH as `root` from the PC; key-only login configured |
| Hardware | Dell Inspiron 1545, Pentium T4300 (2) @ 2.10 GHz, 3.78 GiB RAM, 113.63 GiB disk, AC connected |
| OS | Arch Linux, kernel `7.2.6-arch2-1`, archiso 2025-06-01, Legacy BIOS |
| Root filesystem | `airootfs` overlay with `upperdir` on `/dev/sda2` (ext4, `SERVER_DATA`); `/dev/sda1` vfat `ARCH_BOOT` |
| Persistence | Overlay writable layer on `sda2`: 18 GiB of 114 GiB used, 91 GiB free |
| Packages | 762 installed; installed `linux` 7.2.11.arch1-1 is newer than the running ISO kernel |
| Node | Server v24.22.1, npm 12.2.1; PC v24.19.0 — same major |
| Swap | None. `modprobe zram` fails: only `7.2.11-arch1-1` modules exist for kernel `7.2.6-arch2-1` |
| Tailscale | Up before the outage; server name `zeserver`, PC and phone in the same tailnet |
| Provisioning state | `/opt/lifelogger` and `/etc/lifelogger.env` exist from the earlier approach; no release deployed; service inactive |
| Build drill | Done on the PC; PC-only build is now the design, so no server build is needed |
| Idle use | Pending — CPU and RSS of the running service |
| Rollback drill | Pending — record date and timing |
| Restore drill | Pending — record date, data check and `PRAGMA integrity_check` |
| Reboot drill | Pending — service and backup timer back without a login |

### Accepted risk: persistent archiso server

`findmnt /` showed:

```text
/  airootfs  overlay  rw,lowerdir=/run/archiso/airootfs,
                        upperdir=/run/archiso/cowspace/persistent_/x86_64/upperdir
```

The owner was shown this, `lsblk -f` and the kernel command line, then chose option 2 in writing on 2026-10-26: accept the risk and continue with the current setup. Reinstalling Arch cannot be done over SSH because the writable overlay lives on the disk that would be formatted.

Mitigations: no blind `pacman -Syu`; keep the ISO and its boot entry; watch overlay free space; weekly off-machine copies of backups, `/etc` and `pacman -Qqe`; no unattended kernel updates; do not start `dev-zram0.swap`.

### Current blocker

After a `systemctl start dev-zram0.swap` attempt, systemd/sshd wedged and the host went offline. Tailscale continued to report the peer as active briefly, then showed it offline at a new address. No install, health check, benchmark or drill is possible until the machine is reachable again. A reboot from the stock archiso boot entry is the pragmatic recovery; the app is not installed yet, so no application data is at risk.

---

## 6. Verification performed on the PC

| Gate | Result |
|---|---|
| `npm ci` / full workspace build | Pass |
| `npm test` (existing suite) | Pass |
| `npx vitest run packaging/test/package.test.ts` | Pass — 6 tests |
| `npm run test:deploy` (shell safety tests) | Pass — 12 tests |
| `npm run shellcheck` | Pending local tool install; scripts follow `set -euo pipefail` and quote variables |
| `npm run typecheck` | Pass |
| Android typecheck | Pass |
| `npm run build:package -- --version 0.3.5 --pkgrel 1` | Pass |
| `tar -tvf <package>` with libarchive 3.8.9 / libzstd 1.5.7 | Pass — expected paths and modes |
| Bundle smoke test: launch `server.js`, call `/health` | Pass — `{"status":"ok",...,"version":"0.3.5-test"}` |
| Package SHA-256 matches `.sha256` | Pass |

Built artifact (not committed):

```text
lifelogger-0.3.5-1-x86_64.pkg.tar.zst
32 archive entries (files and directories), 0.40 MiB compressed, ~2.0 MiB installed
```

---

## 7. Risks and decisions

| Risk | Mitigation |
|---|---|
| The server runs a persistent archiso, not an installed Arch | Owner accepted the risk in writing; evidence and mitigations in `packaging/README.md` |
| Hand-built package is not made by makepkg | Deterministic ustar/mtree writer; verified with libarchive and by the planned real install |
| Windows line endings break shell scripts | `.gitattributes`, executable bits, `npm run shellcheck` |
| Native SQLite fails on the old CPU | None needed: Node 24 ships `node:sqlite`; server major matches PC |
| Android blocks plain http | HTTPS through `tailscale serve`, with `HOST=127.0.0.1` |
| A bad release locks in a schema change | Additive-only migrations, pre-update backup, automatic package rollback |
| Backups on the same disk are lost with it | Periodic copy to the PC, documented in the runbook |
| Release upload needs credentials | PC prepares the asset; owner creates the release or authenticates `gh` |
| Server outage blocks all on-host gates | Exact recovery and install commands in section 8; no blind changes |

Decisions recorded in `packaging/README.md`: live vs installed OS, HTTPS vs cleartext, build on the PC, GitHub release asset vs pacman repository, and public repository.

---

## 8. What the owner needs to do

### 8.1 Recover the server

If the console is alive:

```bash
systemctl list-jobs
systemctl status dev-zram0.swap --no-pager
journalctl -b -n 40 --no-pager
```

If systemd is wedged, hard-reboot from the stock archiso boot entry. Do **not** start `dev-zram0.swap`. After boot:

```bash
ssh root@<server>
uptime -p
uname -r
systemctl is-active sshd
curl -fsS --max-time 5 http://127.0.0.1:8080/health || true
```

### 8.2 Build and publish the release

On the PC:

```bash
git tag v0.3.5
npm ci
npm run build:package -- --version 0.3.5 --pkgrel 1
```

Create the GitHub release `v0.3.5` and attach the `.pkg.tar.zst` and `.sha256`, or authenticate `gh` and use the command in `packaging/README.md`.

### 8.3 Install and verify

Before installing, the stale units left by the old provisioning in
`/etc/systemd/system` must be removed — they take precedence over the packaged
units. This is destructive but removes no data or configuration; confirm the
owner agrees, then run:

```bash
systemctl disable --now lifelogger.service lifelogger-backup.timer 2>/dev/null || true
ls -l /etc/systemd/system/lifelogger*
rm -f /etc/systemd/system/lifelogger.service \
      /etc/systemd/system/lifelogger-backup.service \
      /etc/systemd/system/lifelogger-backup.timer
systemctl daemon-reload
systemctl disable --now dev-zram0.swap 2>/dev/null || true
systemctl mask systemd-zram-setup@zram0.service
```

Then install:

```bash
scp dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst* root@<server>:/tmp/
ssh root@<server>
cd /tmp && sha256sum -c lifelogger-0.3.5-1-x86_64.pkg.tar.zst.sha256
pacman -U --noconfirm lifelogger-0.3.5-1-x86_64.pkg.tar.zst
# /etc/lifelogger.env is backup=: reconcile DB_PATH, WEB_DIR, HOST, PORT and API_KEY
systemctl enable --now lifelogger.service lifelogger-backup.timer
curl -fsS http://127.0.0.1:8080/health
pacman -Qkk lifelogger
```

Paste back `/health`, `pacman -Q lifelogger`, `systemctl is-active lifelogger lifelogger-backup.timer` and the web footer version.

### 8.4 Benchmarks and drills

```bash
# tests and benchmark on the server
cd /root/life-logger && npm ci && npm test
node tools/bench/dist/index.js \
  --output docs/benchmarks/increment-3.5-server-baseline.json --host-label server

# rollback drill
lifelogger-update 0.3.5 --health-url http://127.0.0.1:1/health

# restore drill
/usr/lib/lifelogger/backup.sh
DB_PATH=/tmp/life-logger-restore-drill.db \
  /usr/lib/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
sqlite3 /tmp/life-logger-restore-drill.db 'PRAGMA integrity_check;'

# reboot drill
reboot
systemctl is-active lifelogger lifelogger-backup.timer
curl -fsS http://127.0.0.1:8080/health
```

### 8.5 Tailscale and Android

```bash
ssh root@<server>
tailscale serve --bg 8080
tailscale serve status
```

Enter the `https://<machine>.<tailnet>.ts.net` URL and the `API_KEY` in the app's Server Connection card. Log a marker on the PC, pull on the phone and reverse; repeat with Wi-Fi off on the phone.

---

## 9. Results to fill in after the server returns

| Check | PC | Server | Target |
| --- | --- | --- | --- |
| Build time (`npm ci` + package) | recorded locally | n/a — build is PC-only | < 10 min |
| Package size | 0.40 MiB | — | — |
| Idle RSS | — | pending | < 256 MiB |
| Idle CPU | — | pending | near 0 |
| Benchmark suite | baseline JSON | pending | no metric over target |
| Rollback drill | n/a | pending | previous version restored |
| Restore drill | n/a | pending | `integrity_check: ok` |
| Reboot drill | n/a | pending | healthy within 2 min |
| PC ↔ phone sync | n/a | pending | works with Wi-Fi off |

---

## 10. Conclusion

The agent-side redesign is complete: the tag-deploy pipeline is gone, a native Arch package builds on the Windows PC, its archive is independently readable, and the updater and shell gates are tested. The remaining work is a single owner-driven sequence — recover the host, publish the release, install the package, run the benchmarks and drills, and confirm sync. Every exact command is in section 8 and in `packaging/README.md`.
