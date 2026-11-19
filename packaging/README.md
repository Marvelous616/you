# Life Logger packaging and server runbook

This folder is the complete server-side story: building an Arch package on the
workstation, publishing it, installing it, upgrading with rollback, backups and
restore. The owner reviews every file here before anything runs on the server.

## Decisions

| Decision | Value | Notes |
| --- | --- | --- |
| Server OS | Arch Linux archiso with persistence (risk accepted) | `zeserver` boots the 2025-06-01 Arch ISO with `cow_label=SERVER_DATA`; `/` is an `airootfs` overlay whose writable layer lives on `/dev/sda2` (ext4, label `SERVER_DATA`). Not an installed system, but persistent across reboots. |
| Live vs installed OS | **Live archiso with persistence — risk accepted by the owner on 2026-10-26** | See "Accepted risk" below. |
| Repository visibility | Public (owner-created) | `github.com/Marvelous616/you`. Private was recommended; the owner chose public, so secret and address scans are mandatory and real credentials stay only on the server. |
| Build location | **PC only** | The server is a 3.8 GB Pentium. Compilation, bundling and archive assembly all happen on the Windows PC; the server only runs `pacman -U`. |
| Distribution | GitHub Release asset per version | One `lifelogger-<ver>-<rel>-<arch>.pkg.tar.zst` and its `.sha256` per tag. A GitHub Pages pacman repository was considered and deferred; it would put binaries in git. |
| Version scheme | `pkgver=0.3.5`, `pkgrel=1`, tag `v0.3.5` | Earlier increment tags stay as history but no longer deploy. `pkgrel` covers packaging-only rebuilds. |
| Device transport | HTTPS through Tailscale | `HOST=127.0.0.1`, `tailscale serve --bg 8080`. No cleartext exemption in the Android app. |
| Node version | PC v24.19.0, server v24.22.1 | Same major. Only the runtime matters on the server; no build runs there. |
| Service account | `lifelogger` | Created by `sysusers.d`; SSH access on the host is root only at acceptance. |

### Accepted risk: persistent archiso server

The owner was shown the evidence below and chose, in writing on 2026-10-26, to run
Life Logger on the persistent archiso environment rather than reinstall Arch to
the internal disk. Reinstalling cannot be done over SSH because the running
overlay's writable layer is on the disk that would be formatted.

```text
/            airootfs  overlay  upperdir=/run/archiso/cowspace/persistent_/x86_64/upperdir
/run/archiso/cowspace  ext4  /dev/sda2  label SERVER_DATA
/dev/sda1    4G   vfat   ARCH_BOOT
loop0        854M squashfs /run/archiso/airootfs
kernel       7.2.6-arch2-1
firmware     Legacy BIOS (no /sys/firmware/efi)
fstab        empty
packages     762, including linux 7.2.11.arch1-1 (not the running kernel)
```

What this means in practice:

- Installed packages, `/etc`, `/home` and the database survive reboots, because the
  overlay's writable layer is the ext4 partition on `sda2`.
- The boot chain uses the **ISO's** kernel and initramfs on `sda1`, not the `linux`
  package's. The installed `linux` package is therefore not what boots the machine.
- There is no `fstab` and no installed bootloader configuration to rebuild; the
  machine is only recoverable through the archiso boot entry and the ISO.

Mitigations that go with the acceptance:

1. **No blind full upgrades.** `pacman -Syu` can pull a `linux` package whose
   modules no longer match the ISO kernel. Upgrade deliberately, reboot, and
   re-run `systemctl is-active lifelogger lifelogger-backup.timer` plus `/health`.
2. **Keep the ISO and its boot entry.** Recovery depends on the same archiso boot
   parameters. Keep an off-machine copy of the ISO and record its checksum.
3. **Watch the overlay.** `df -h /` reports the writable layer. At acceptance:
   18 GiB of 114 GiB used, 91 GiB free. A full overlay breaks writes and the app.
4. **Off-machine copies.** Weekly copy of `/var/lib/lifelogger/backups`, `/etc`,
   and `pacman -Qqe` to the PC. The server has no second disk.
5. **No unattended kernel or security updates.** This is a tailnet-only home
   server; the app still binds to loopback per `/etc/lifelogger.env`.
6. **Swap is not available.** `zram` cannot load: `/lib/modules` contains only
   `7.2.11-arch1-1`, while the running kernel is `7.2.6-arch2-1`. Do not start
   `dev-zram0.swap`; it wedges systemd. The package is built elsewhere, so the
   server does not need the extra memory for a build.

## Rules that keep releases safe

- **Migrations are additive within a release.** A release may add tables, columns
  and indexes. It must not drop or rewrite data that the previous release still
  needs. That is what makes rollback and a pre-update backup safe.
- **The database is backed up before an upgrade.** `lifelogger-update` calls
  `/usr/lib/lifelogger/backup.sh` before `pacman -U`.
- **A release is only live after `/health` passes.** `lifelogger-update` waits for
  the reported version to match, then records the installed package. A failed
  check reinstalls the previous package.
- **Secrets live in `/etc/lifelogger.env` only.** The package marks that file as
  `backup=`, so pacman never replaces it. The repository never contains a real
  API key, password, private key or keystore.
- **Data is not packaged.** `/var/lib/lifelogger` is created by `tmpfiles.d` and
  is never touched by `pacman -R`.

## Paths

| Path | Purpose |
| --- | --- |
| `/usr/lib/lifelogger/server.js` | Bundled Fastify server; no `node_modules` on the host. |
| `/usr/lib/lifelogger/web/` | Built web app served by the API process. |
| `/usr/lib/lifelogger/version` | Package version used by the launcher for `APP_VERSION`. |
| `/usr/bin/lifelogger` | Launcher used by the service unit. |
| `/usr/bin/lifelogger-update` | Release updater with health check and rollback. |
| `/var/lib/lifelogger/life-logger.sqlite` | Live SQLite database (WAL mode). |
| `/var/lib/lifelogger/backups` | Daily and pre-update backups, 14-day retention. |
| `/etc/lifelogger.env` | Runtime settings and API key, mode 0600, `backup=`. |
| `/etc/systemd/system/lifelogger.service` | Application service (installed from the package). |
| `/etc/systemd/system/lifelogger-backup.{service,timer}` | Daily backup. |
| `/var/cache/lifelogger/` | Downloaded packages and the `current` package marker. |

## Build on the PC

```bash
npm ci
npm run build:package -- --version 0.3.5 --pkgrel 1
```

The command builds all workspaces, bundles the server with esbuild, writes
`.PKGINFO`/`.MTREE`/`.INSTALL` and produces:

```text
dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst
dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst.sha256
dist/packages/lifelogger-0.3.5-1-x86_64.manifest.json
```

Inspect it before publishing:

```bash
tar -tvf dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst
```

Check that executables are `0755`, `/etc/lifelogger.env` is `0600`, and all other
files are `0644`. The manifest lists every path, mode and size. No WSL, Docker,
`fakeroot` or `makepkg` is needed: uid/gid 0, fixed mtime and modes are written
directly into the ustar headers, and Node's built-in zstd performs compression.

`packaging/PKGBUILD` reproduces the same result with `makepkg` on a native Arch
host. It is a reference, not the release path.

## Publish the release

The owner creates the GitHub release for tag `v0.3.5` and attaches both files, or
authenticates the `gh` CLI on the PC and runs:

```bash
gh release create v0.3.5 \
  dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst \
  dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst.sha256 \
  --title 'Life Logger 0.3.5' --generate-notes
```

Pushing the tag alone does **not** deploy anything.

## First install

1. **Check the host and the account.**
   ```bash
   ssh root@zeserver
   findmnt / && lsblk -f && uname -r && node -v
   ```

2. **Retire the old provisioning (destructive — owner confirmation required).**
   The earlier setup wrote units to `/etc/systemd/system`, which take precedence
   over the packaged units in `/usr/lib/systemd/system`. Confirm they are the old
   files, then remove only those units; no data or configuration is removed:
   ```bash
   systemctl stop lifelogger.service lifelogger-backup.timer 2>/dev/null || true
   systemctl disable lifelogger.service lifelogger-backup.timer 2>/dev/null || true
   ls -l /etc/systemd/system/lifelogger*
   rm -f /etc/systemd/system/lifelogger.service \
         /etc/systemd/system/lifelogger-backup.service \
         /etc/systemd/system/lifelogger-backup.timer
   systemctl daemon-reload
   # zram cannot load on this kernel and wedged systemd once; do not start it
   systemctl disable --now dev-zram0.swap 2>/dev/null || true
   systemctl mask systemd-zram-setup@zram0.service
   ```

3. **Copy and verify the package.**
   ```bash
   # on the PC
   scp dist/packages/lifelogger-0.3.5-1-x86_64.pkg.tar.zst* root@zeserver:/tmp/

   # on the server
   cd /tmp
   sha256sum -c lifelogger-0.3.5-1-x86_64.pkg.tar.zst.sha256
   ```

4. **Install and start.**
   ```bash
   pacman -U --noconfirm lifelogger-0.3.5-1-x86_64.pkg.tar.zst
   # /etc/lifelogger.env is a backup= file: reconcile it with the package default
   # (DB_PATH, WEB_DIR, HOST, PORT) and set API_KEY before starting.
   systemctl enable --now lifelogger.service lifelogger-backup.timer
   curl -fsS http://127.0.0.1:8080/health
   ```

5. **Verify the install.**
   ```bash
   pacman -Qi lifelogger
   pacman -Qkk lifelogger
   systemctl is-active lifelogger lifelogger-backup.timer
   cat /usr/lib/lifelogger/version
   ```

The web footer and `/health` must both show the version in `version`.

## Upgrade and rollback

From the server:

```bash
lifelogger-update 0.4.0
```

The helper downloads the release asset and checksum, verifies SHA-256, takes a
database backup, runs `pacman -U`, enables the units, restarts the service and
waits for `/health` to report the new version. On failure it reinstalls the
package named in `/var/cache/lifelogger/current`.

Inspect before upgrading:

```bash
lifelogger-update 0.4.0 --dry-run
```

Manual rollback to a cached package:

```bash
pacman -U --noconfirm /var/cache/lifelogger/lifelogger-<old-version>-1-x86_64.pkg.tar.zst
systemctl restart lifelogger.service
curl -fsS http://127.0.0.1:8080/health
```

Never delete cached packages until the new release has been healthy for a while.

## Connectivity through Tailscale

Tailscale is already installed and up on the server, the PC and the phone. Only
the HTTPS front and the app settings remain:

```bash
ssh root@zeserver
tailscale serve --bg 8080
tailscale serve status
```

The app is then reachable at `https://<machine>.<tailnet>.ts.net`. With option A
chosen, `HOST=127.0.0.1` stays in `/etc/lifelogger.env` so only Tailscale can
reach the service. In the app, use the **Server Connection** card to set that URL
and the `API_KEY` from the server, then press **Save Connection**. The setting
applies immediately and is kept for the current app session; the persistent
settings store arrives with the `expo-sqlite` binding in Increment 4.

End-to-end check: log a marker on the PC and pull on the phone, then reverse.
Import an `.ics` file and confirm the suggestions reach the phone. Repeat with
Wi-Fi off on the phone so the traffic proves the tailnet path. Do not forward
port 8080 on the router.

## Backups and restore

The timer runs daily at 03:30 with a 15-minute random delay and `Persistent=true`.
Each run copies the database with `sqlite3 .backup`, checks
`PRAGMA integrity_check` on the copy, and keeps 14 days of files.

```bash
/usr/lib/lifelogger/backup.sh
ls -lh /var/lib/lifelogger/backups
sqlite3 /var/lib/lifelogger/backups/<file>.db 'PRAGMA integrity_check;'
```

Restore requires root and an explicit `--yes`:

```bash
/usr/lib/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
```

For a scratch restore drill, override `DB_PATH` so the live database is untouched:

```bash
DB_PATH=/tmp/life-logger-restore-drill.db \
  /usr/lib/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
sqlite3 /tmp/life-logger-restore-drill.db 'PRAGMA integrity_check;'
```

Copy backups off the machine periodically:

```bash
scp 'root@<server>:/var/lib/lifelogger/backups/*.db' ./backups/
```

## Logs and status

```bash
systemctl status lifelogger
journalctl -u lifelogger -n 100 --no-pager
journalctl -u lifelogger -f
journalctl -u lifelogger-backup -n 50 --no-pager
systemctl list-timers lifelogger-backup.timer
curl -fsS http://127.0.0.1:8080/health
```

`/health` returns `status`, `version`, `schemaVersion`, `syncProtocolVersion`,
`database` and `timestamp`. It uses a direct `SELECT 1` probe and never scans
application tables. A failure returns HTTP 503.

## Verification drills

Record date, result and timing for each.

1. **Rollback drill.** After one successful install, run
   `lifelogger-update <version> --health-url http://127.0.0.1:1/health`. The
   package installs, the health check fails and the previous package returns.
   Confirm `/health` reports the old version.
2. **Restore drill.** Back up, change a marker, restore with `--yes`, confirm the
   data and `PRAGMA integrity_check`, and record the timing.
3. **Reboot drill.** `reboot`, then confirm the service and timer return within
   two minutes without a login. Do not start zram.
4. **Build drill.** Record PC-side `npm ci` and package build time and peak
   memory, plus the idle CPU and memory of the running service.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/health` returns 503 | `DB_PATH` in `/etc/lifelogger.env`, directory permissions, `journalctl -u lifelogger`. |
| Service will not start | `systemctl status lifelogger`, `journalctl -u lifelogger -n 100`, and `test -x /usr/bin/lifelogger`. |
| `pacman -Qkk` reports a changed env file | Expected: `/etc/lifelogger.env` is a `backup=` file. Compare it manually; do not overwrite it. |
| Web shows an old version | Reload: `index.html` is `no-cache` and assets are hashed. Compare footer with `/health`. |
| API returns 401 | The client's API key must equal `API_KEY` in `/etc/lifelogger.env`. |
| Phone cannot reach the server | Confirm Tailscale is up, `tailscale serve status` is set, and the app has the HTTPS URL. |
| Update rolled back | `journalctl -u lifelogger -n 100`, then retry with the previous version; keep the cached packages. |
| `systemctl` or `df` hangs | Do not start `dev-zram0.swap`; see "Accepted risk" above. Reboot from the stock archiso entry. |
