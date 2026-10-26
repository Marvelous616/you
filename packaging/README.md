# Life Logger package and server runbook

Life Logger ships as an Arch Linux package built on the development PC and
published as a GitHub release asset. The package owns the application, the
systemd units, the service account and the backup scripts. It never owns the
database or the host configuration.

```
GitHub release  ->  lifelogger-<version>-1-any.pkg.tar.zst  ->  pacman -U
```

The previous tag-push deploy (`deploy.sh`, `post-receive`, release symlinks) is
gone. Pacman is now the only install and upgrade mechanism.

## Decisions

| Decision | Value | Notes |
| --- | --- | --- |
| Server OS | Arch Linux archiso with persistence (risk accepted) | `zeserver` boots the 2025-06-01 Arch ISO with `cow_label=SERVER_DATA`; `/` is an `airootfs` overlay whose writable layer is `/dev/sda2` (ext4, `SERVER_DATA`). Persistent across reboots, not an installed system. Accepted by the owner in writing on 2026-10-26. |
| Repository visibility | Public | `github.com/Marvelous616/you`. Real credentials stay only in `/etc/lifelogger.env`. |
| Build location | Development PC | The 3.8 GB Pentium only downloads and installs the package. Compilation, tests and bundling happen on the PC. |
| Package source | Pushed release tag | `PKGBUILD` builds from `git+https://github.com/Marvelous616/you.git#tag=v<version>-increment-3.5`. |
| Runtime | Node.js >= 22.5 | The server runs v24.22.1. `node:sqlite` needs 22.5 or newer. |
| Device transport | HTTPS through Tailscale | Set `HOST=127.0.0.1` and use `tailscale serve --bg 8080`. |
| Data and config | Outside the package | `/var/lib/lifelogger` and `/etc/lifelogger.env` survive install, upgrade and removal. |

### Accepted risk: persistent archiso server

Reinstalling Arch to the internal disk cannot be done over SSH: the running
overlay's writable layer is on the disk that would be formatted. The owner was
shown the evidence below and chose, in writing, to keep the persistent archiso.

```text
/            airootfs  overlay  upperdir=/run/archiso/cowspace/persistent_/x86_64/upperdir
/run/archiso/cowspace  ext4  /dev/sda2  label SERVER_DATA
/dev/sda1    4G   vfat   ARCH_BOOT
loop0        854M squashfs /run/archiso/airootfs
firmware     Legacy BIOS (no /sys/firmware/efi)
fstab        empty
```

What this means in practice:

- Packages, `/etc`, `/home` and `/var/lib` survive reboots because the writable
  layer is the ext4 partition on `sda2`.
- The boot chain uses the kernel and initramfs on `sda1`; the installed `linux`
  package is not necessarily what boots.
- At acceptance the running kernel was `7.2.6-arch2-1`, while `/lib/modules`
  only contained `7.2.11-arch1-1`, so kernel modules such as `zram` could not
  load. Do not assume a reboot changes this.

Mitigations:

1. **No blind full upgrades.** Do not run `pacman -Syu` on this host. The package
   install is independent of the kernel; keep it that way.
2. **Keep the ISO and boot entry.** Recovery depends on booting the same
   `archisosearchuuid=2025-06-01-09-10-39-00` with `cow_label=SERVER_DATA`. Keep a
   copy of the ISO and its checksum off the machine.
3. **Watch the overlay.** `df -h /` reports the writable layer. A full overlay
   breaks writes.
4. **Off-machine copies.** Copy `/var/lib/lifelogger/backups`, `/etc` and
   `pacman -Qqe` to the PC periodically. The server has no second disk.
5. **No unattended kernel or security updates.** The host is on a tailnet, not
   the public internet.

## What the package installs

| Path | Purpose |
| --- | --- |
| `/usr/bin/lifelogger` | Foreground wrapper around the bundled server. |
| `/usr/lib/lifelogger/server.cjs` | esbuild bundle; no `node_modules` at runtime. |
| `/usr/lib/lifelogger/web/` | Built Vite app served by Fastify. |
| `/usr/lib/lifelogger/lifelogger.env` | Package defaults. |
| `/usr/lib/lifelogger/version.env` | `APP_VERSION=<version>` used by `/health` and the footer. |
| `/usr/lib/lifelogger/backup.sh`, `restore.sh` | Daily backup and destructive restore. |
| `/usr/lib/systemd/system/lifelogger.service` | Application service, runs as `lifelogger`. |
| `/usr/lib/systemd/system/lifelogger-backup.{service,timer}` | Daily backup at 03:30 with 14-day retention. |
| `/usr/lib/sysusers.d/lifelogger.conf` | Creates the `lifelogger` system account. |
| `/usr/lib/tmpfiles.d/lifelogger.conf` | Creates `/var/lib/lifelogger` and `backups/`, mode 0750. |

Not owned by the package, and never removed by it:

| Path | Purpose |
| --- | --- |
| `/var/lib/lifelogger/life.db` | Live SQLite database (WAL mode). |
| `/var/lib/lifelogger/backups/` | Backup copies. |
| `/etc/lifelogger.env` | Host overrides and `API_KEY`, mode 0640. |

The unit loads the package defaults first, then `/etc/lifelogger.env`, then
`version.env`. Later files win, so `APP_VERSION` cannot be overridden by accident.

## Build on the PC

Requirements: Arch Linux, `base-devel`, `git`, `nodejs` (>= 22.5), `npm`, and
network access for `npm ci`.

```bash
git clone https://github.com/Marvelous616/you.git
cd you
npm ci
npm run build
packaging/build.sh
```

`packaging/build.sh`:

1. Checks that `pkgver` in `packaging/PKGBUILD` matches `package.json`.
2. Refuses to build unless the release tag is on `origin` (the PKGBUILD builds
   from GitHub, not from the working tree).
3. Runs `makepkg --cleanbuild`, which installs dependencies, builds the
   workspaces, bundles the server, runs the tests and the packaging checks.
4. Writes `lifelogger-<version>-1-any.pkg.tar.zst` and its `.sha256`.
5. Runs `packaging/test/verify-package.sh`: file list, metadata, ownership
   boundaries and a health check against the extracted package.

Bump the version in `package.json` and `packaging/PKGBUILD`, regenerate
`packaging/.SRCINFO` (`cd packaging && makepkg --printsrcinfo > .SRCINFO`) and
commit both.

If pacman's `nodejs` provider on the build PC is older than 22.5 while a newer
Node is first on `PATH` (this PC uses nvm for that), `build.sh` checks the `PATH`
version and passes `--nodeps` to `makepkg`. The PKGBUILD still declares the real
requirement, `nodejs>=22.5`, so another builder resolves it normally.

## Publish to GitHub

```bash
packaging/release.sh
```

It requires a clean `main`, `gh` authentication and a matching `.SRCINFO`. It
pushes `main` and the annotated tag, builds the package from that tag, and creates
the GitHub release with the package, checksum, `PKGBUILD` and `SRCINFO` (a copy
of `packaging/.SRCINFO`, because GitHub renames assets whose names start with a
dot).

If the build fails after the tag is pushed, the tag exists without a release. Fix
the tree, move the tag (`git tag -f ... && git push --force origin <tag>`) and run
the script again. Do not attach a package built from a different commit.

## Server: migrate from the old tag deploy

The old provisioning left `/opt/lifelogger`, admin units in
`/etc/systemd/system/`, and `/etc/lifelogger.env`. Do this once, as root:

```bash
ssh root@zeserver

systemctl disable --now lifelogger.service lifelogger-backup.timer
rm /etc/systemd/system/lifelogger.service
rm /etc/systemd/system/lifelogger-backup.service
rm /etc/systemd/system/lifelogger-backup.timer
systemctl daemon-reload

# Keep the API key and database path; only WEB_DIR moves into the package.
cp -a /etc/lifelogger.env /etc/lifelogger.env.before-package
sed -i 's|^WEB_DIR=.*|WEB_DIR=/usr/lib/lifelogger/web|' /etc/lifelogger.env

tail -n +1 /etc/lifelogger.env   # confirm WEB_DIR, DB_PATH and API_KEY
```

`/opt/lifelogger` is no longer used. Do not delete it until the package install
has been verified; it holds no data (the database is in `/var/lib/lifelogger`).

## Install

Manual:

```bash
curl -fLO https://github.com/Marvelous616/you/releases/download/v0.3.6-increment-3.5/lifelogger-0.3.6-1-any.pkg.tar.zst
curl -fLO https://github.com/Marvelous616/you/releases/download/v0.3.6-increment-3.5/lifelogger-0.3.6-1-any.pkg.tar.zst.sha256
sha256sum -c lifelogger-0.3.6-1-any.pkg.tar.zst.sha256
pacman -U lifelogger-0.3.6-1-any.pkg.tar.zst
systemctl enable --now lifelogger.service lifelogger-backup.timer
systemctl status lifelogger --no-pager
curl -fsS http://127.0.0.1:8080/health
```

Or, from a checkout on the server (downloads, verifies, installs, restarts,
health-checks and rolls back automatically):

```bash
packaging/install-release.sh v0.3.6-increment-3.5
```

`install-release.sh` refuses to run while an admin unit shadows the packaged one,
never edits `/etc/lifelogger.env`, and keeps downloaded packages in
`/var/cache/lifelogger` for rollback.

## Upgrade and rollback

Upgrade is the same command with a newer tag. The previous package stays in the
cache.

```bash
packaging/install-release.sh v0.4.0-increment-4
```

Manual rollback:

```bash
pacman -Q lifelogger
ls -1t /var/cache/lifelogger/*.pkg.tar.zst
pacman -U /var/cache/lifelogger/lifelogger-<previous>-1-any.pkg.tar.zst
systemctl restart lifelogger.service
curl -fsS http://127.0.0.1:8080/health
```

Pacman does not restart services. After a manual `pacman -U`, always restart
`lifelogger.service` and check `/health`.

The database schema is additive within a release. A newer database may be read by
older code with a warning; a backup is the real safety net.

## Backups and restore

The timer runs daily and can be triggered manually:

```bash
systemctl start lifelogger-backup.service
journalctl -u lifelogger-backup.service -n 50 --no-pager
ls -lt /var/lib/lifelogger/backups | head
sqlite3 /var/lib/lifelogger/backups/<file>.db 'PRAGMA integrity_check;'
```

Restore is destructive and refuses to run without `--yes`:

```bash
systemctl start lifelogger-backup.service
/usr/lib/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
```

It verifies the backup, stops the service, moves the live database to
`life.db.before-restore.<timestamp>`, copies the backup, starts the service and
health-checks it. For a scratch drill, set `DB_PATH=/tmp/restore-drill.db` and use
`restore.sh` with that environment.

## Logs and troubleshooting

```bash
systemctl status lifelogger --no-pager
journalctl -u lifelogger -n 100 --no-pager
journalctl -u lifelogger-backup.service -n 50 --no-pager
pacman -Ql lifelogger
pacman -Qkk lifelogger
```

- **Service will not start:** `journalctl -u lifelogger -n 50`. Check
  `WEB_DIR=/usr/lib/lifelogger/web` and that `/var/lib/lifelogger` exists.
- **404 for the web app:** `WEB_DIR` is wrong; fix `/etc/lifelogger.env`.
- **401/403 from the phone:** the `API_KEY` in the app does not match
  `/etc/lifelogger.env`.
- **Port already in use:** the old unit may still be running; stop it and confirm
  `systemctl cat lifelogger` shows `/usr/lib/systemd/system/lifelogger.service`.
- **No backups:** `systemctl list-timers lifelogger-backup.timer`; the timer needs
  the service account and `/var/lib/lifelogger` to exist.

Do not run `pacman -Syu` on this host (see the accepted risk above).

## Verification drills

Record the date, duration and result in the completion report.

1. **Build:** time `packaging/build.sh` on the PC and record the artifact size and
   checksum.
2. **Install:** from a clean `/var/lib/lifelogger`, install the package, start it
   and confirm `/health` reports the packaged version and the web footer matches.
3. **Upgrade:** install the next tag with `install-release.sh`; confirm the
   previous package is in `/var/cache/lifelogger`.
4. **Rollback:** deliberately break a release (bad `WEB_DIR` or a health-check
   failure), confirm `install-release.sh` restores the cached package, and record
   the timing.
5. **Restore:** back up, change data, restore the backup with `--yes`, check
   `PRAGMA integrity_check` and the restored record. Use a scratch `DB_PATH`
   first.
6. **Reboot:** reboot and confirm the service and timer come back without a login.
   Only run this after checking that the kernel on `sda1` and `/lib/modules` agree.

## Security notes

- No secrets in the repository, the package or the release assets. The API key
  exists only in `/etc/lifelogger.env`.
- The package is unsigned. Verify the published `.sha256` before installing, and
  only download from this repository's releases.
- The service is unprivileged, has `ProtectSystem=strict`, `ProtectHome` and
  `MemoryMax=1G`, and can only write `/var/lib/lifelogger`.
- Keep `HOST` on loopback and expose it through Tailscale; do not forward the port
  on the router.
