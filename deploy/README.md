# Life Logger deployment runbook

This folder is the complete server-side story: provisioning, systemd units, the
tag-triggered deploy, backups and restore. Read it before running anything on
the server. The owner reviews every file here first.

## Decisions to record before the first deploy

Fill these in as they are decided. They are repeated in the completion report.

| Decision | Value | Notes |
| --- | --- | --- |
| Server OS | Arch Linux archiso with persistence (risk accepted, see below) | `zeserver` boots the 2025-06-01 Arch ISO with `cow_label=SERVER_DATA`; `/` is an `airootfs` overlay whose writable layer lives on `/dev/sda2` (ext4, label `SERVER_DATA`). Not an installed system, but persistent across reboots. Kernel 7.2.6-arch2-1 at acceptance time. |
| Repository visibility | Public (owner-created) | `github.com/Marvelous616/you`. Private was recommended; the owner chose public, so the secret and absolute-path scans are mandatory and real credentials stay only in `/etc/lifelogger.env`. |
| Build location | Server first, PC fallback | A 3.8 GB Pentium may run out of memory during `npm ci` and the build. If it does, build on the PC and ship `node_modules` plus `dist` as the release artifact, and record why. |
| Device transport | A: HTTPS through Tailscale (recommended) | Preferred, and requires no cleartext build flag. Option B (cleartext) only if HTTPS is unavailable; record the change here if taken. |
| Node version | PC: v24.19.0, server: v24.22.1 | Same major (24); no change needed. |
| Live vs installed OS | **Live archiso with persistence — risk accepted 2026-10-26** | See "Accepted risk: persistent archiso server" below. |

### Accepted risk: persistent archiso server

The owner was shown the evidence below and chose, in writing on 2026-10-26, to run
Life Logger on the persistent archiso environment rather than reinstall Arch to
the internal disk. Reinstalling cannot be done over SSH because the running
overlay's writable layer is on the disk that would be formatted.

Evidence collected on `zeserver` (Tailscale MagicDNS, `root@zeserver`):

```text
/            airootfs  overlay  upperdir=/run/archiso/cowspace/persistent_/x86_64/upperdir
/run/archiso/cowspace  ext4  /dev/sda2  label SERVER_DATA
/dev/sda1    4G   vfat   ARCH_BOOT
loop0        854M squashfs /run/archiso/airootfs
kernel       7.2.6-arch2-1
cmdline      archisobasedir=arch archisosearchuuid=2025-06-01-09-10-39-00 copytoram=y cow_label=SERVER_DATA
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
2. **Keep the ISO and its boot entry.** Recovery depends on booting the same
   `archisosearchuuid=2025-06-01-09-10-39-00` with `cow_label=SERVER_DATA`.
   Copy the ISO somewhere off the machine and record its name and checksum here.
3. **Watch the overlay.** `df -h /` reports the writable layer. At acceptance:
   18 GiB of 114 GiB used, 91 GiB free. A full overlay breaks writes and the app.
4. **Off-machine copies.** Weekly copy of `/var/lib/lifelogger/backups`, `/etc`,
   and `pacman -Qqe` to the PC. The server has no second disk.
5. **No unattended kernel or security updates.** This is a home server on a
   tailnet, not an internet-facing host; the app still binds per `/etc/lifelogger.env`.

If the machine is ever reinstalled properly, `server-setup.sh` is idempotent and
the decision above can be replaced with the installed-system facts.


## Rules that keep releases safe

- **Migrations are additive within a release.** A release may add tables, columns
  and indexes. It must not drop or rewrite data that the previous release still
  needs. That is what makes rollback and a backup taken before deploy safe.
- **The database is backed up before `current` moves.** `deploy.sh` writes
  `/var/lib/lifelogger/backups/pre-<tag>.db` before switching the symlink.
- **A release is only live after `/health` passes.** A failed health check
  restores the previous symlink, version marker and service.
- **Secrets live in `/etc/lifelogger.env` only.** The repository never contains a
  password, private key, keystore or real API key.

## Paths

| Path | Purpose |
| --- | --- |
| `/opt/lifelogger/repo.git` | Bare git repository; push tags here. |
| `/opt/lifelogger/releases/<tag>` | One built release per tag, pruned to the last 5. |
| `/opt/lifelogger/current` | Symlink to the live release. |
| `/opt/lifelogger/version.env` | `APP_VERSION=<tag>`, written by `deploy.sh`. |
| `/opt/lifelogger/deploy.sh`, `backup.sh`, `restore.sh` | Installed copies of the scripts in this folder. |
| `/var/lib/lifelogger/life.db` | Live SQLite database (WAL mode). |
| `/var/lib/lifelogger/backups` | Daily and pre-deploy backups, 14-day retention. |
| `/etc/lifelogger.env` | Runtime settings and the API key, mode 0640. |
| `/etc/systemd/system/lifelogger.service` | The application service. |
| `/etc/systemd/system/lifelogger-backup.{service,timer}` | Daily backup. |

## First install

1. **Check what the server is actually running.**
   ```bash
   findmnt /
   lsblk -f
   cat /etc/os-release
   node -v
   ```
   If `/` is an overlay under `/run/archiso/cowspace`, stop and install Arch to
   the internal disk first.

2. **SSH keys, password login off.**
   ```bash
   # on the PC
   ssh-keygen -t ed25519 -C "life-logger-server"
   ssh-copy-id <user>@<server>

   # on the server
   sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
   sudo systemctl restart sshd
   ```

3. **Match Node.** Run `node -v` on the PC and the server. Install the same major
   version on the server if `pacman -S nodejs npm` does not provide it.

4. **Run the provisioning script from a checkout.**
   ```bash
   git clone <repository-url> ~/life-logger
   cd ~/life-logger
   sudo DEPLOY_USER="$USER" ./deploy/server-setup.sh
   ```
   The script is idempotent. It installs packages, creates the `lifelogger`
   service account, directories, zram swap, lid/sleep settings, units, a limited
   `sudoers` rule for service control, the bare repository and the hook. It also
   generates an API key in `/etc/lifelogger.env` the first time.

5. **Confirm the units.**
   ```bash
   systemctl is-enabled lifelogger.service lifelogger-backup.timer
   systemctl list-timers lifelogger-backup.timer
   ```

6. **Add the server remote and push.**
   ```bash
   # on the PC
   git remote add server <user>@<server>:/opt/lifelogger/repo.git
   git push server main
   git push server v0.3.5-increment-3.5
   ```
   Pushing the tag triggers `post-receive`, which runs `deploy.sh`.

7. **Verify.**
   ```bash
   curl -fsS http://<server>:8080/health
   curl -fsS http://<server>:8080/ | head
   sudo systemctl status lifelogger
   ```
   The web footer should show the same version as `/health`.

8. **Android.** Use the app's **Server Connection** card to set the server URL
   and the API key from `/etc/lifelogger.env`, then press **Save Connection**.
   The setting applies immediately and is kept for the current app session; the
   persistent settings store arrives with the `expo-sqlite` binding in
   Increment 4. For the emulator only, `http://10.0.2.2:4000` is the host alias.
   For a real phone, use the Tailscale name. The chosen HTTPS/cleartext decision
   above determines whether the URL starts with `https://` or `http://`; HTTPS
   through Tailscale is preferred.

### Connectivity through Tailscale

1. Install Tailscale on the server, the PC and the phone, and sign all three
   into the same tailnet:
   ```bash
   sudo pacman -S --needed tailscale
   sudo systemctl enable --now tailscaled
   sudo tailscale up
   tailscale status
   ```
2. Expose the service over HTTPS with a valid tailnet certificate:
   ```bash
   sudo tailscale serve --bg 8080
   tailscale serve status
   ```
   The app is then reachable at `https://<machine>.<tailnet>.ts.net`. With this
   option set `HOST=127.0.0.1` in `/etc/lifelogger.env` so only Tailscale can
   reach the service, and restart the service.
3. On the phone, open that HTTPS URL in the Server Connection card. Android
   blocks plain HTTP by default, which is why option A needs no app build flag.
4. Option B, only if HTTPS is unavailable: allow cleartext for the app through
   Expo build properties, use `http://<machine>.<tailnet>.ts.net:8080`, and
   record that decision in the table above.
5. End-to-end check: log a marker on the PC and pull it on the phone, then
   reverse. Import an `.ics` file and confirm the suggestions reach the phone.
   Repeat once with Wi-Fi off on the phone so the traffic proves the tailnet path
   rather than the LAN.

Do not forward port 8080 on the router. The service is for the tailnet only.

## Normal deploy

From the PC:

```bash
git tag v0.4.0-increment-4
git push server main --tags
```

The hook deploys only tags matching `v*`. Branch pushes and tag deletions are
ignored. Watch the push output; a failed health check makes the push fail and
the previous release comes back automatically.

Manual deploy (for example after re-running setup):

```bash
/opt/lifelogger/deploy.sh v0.4.0-increment-4
/opt/lifelogger/deploy.sh v0.4.0-increment-4 --dry-run
```

`deploy.sh` validates the tag against `^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$`,
takes an exclusive `flock`, builds in a private worktree, backs up the database,
moves `current`, restarts, health-checks for up to 10 seconds, rolls back on
failure and prunes releases beyond the last 5.

## Manual rollback

Automatic rollback happens when the health check fails. To roll back by hand:

```bash
ls -1dt /opt/lifelogger/releases/*
previous=/opt/lifelogger/releases/<previous-tag>
ln -sfn "$previous" /opt/lifelogger/current
printf 'APP_VERSION=%s\n' "$(basename "$previous")" > /opt/lifelogger/version.env
sudo systemctl restart lifelogger
curl -fsS http://127.0.0.1:8080/health
```

Do not delete the bad tag before the rollback; keep it for the report, then
delete it from the server remote:

```bash
git push server :refs/tags/<bad-tag>
```

## Restore

Always take a fresh backup before a restore. `restore.sh` refuses to run without
`--yes` and refuses a backup that fails `PRAGMA integrity_check`.

```bash
sudo /opt/lifelogger/backup.sh
sudo /opt/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
```

It stops the service, moves the live database to
`life.db.before-restore.<timestamp>`, removes stale `-wal`/`-shm` files, copies
the backup into place, starts the service and health-checks it. If the health
check fails, the script exits non-zero and points at `journalctl`.

For a **scratch restore drill**, restore to a temporary path first:

```bash
sudo DB_PATH=/tmp/life-logger-restore-drill.db \
  /opt/lifelogger/restore.sh /var/lib/lifelogger/backups/<file>.db --yes
sqlite3 /tmp/life-logger-restore-drill.db 'PRAGMA integrity_check;'
```

The service still stops and starts during this drill; it does not touch the
live database because `DB_PATH` is overridden.

## Backups

The timer runs daily at 03:30 with a 15-minute random delay and `Persistent=true`
(so a missed run catches up after boot). Each run:

1. Copies the live database with `sqlite3 .backup` (consistent while WAL is in use).
2. Runs `PRAGMA integrity_check` on the copy.
3. Keeps 14 days of `life-logger-*.db` files and exits non-zero on any failure.

```bash
sudo /opt/lifelogger/backup.sh
ls -lh /var/lib/lifelogger/backups
sqlite3 /var/lib/lifelogger/backups/<file>.db 'PRAGMA integrity_check;'
```

Backups on the same disk are lost with the disk. Copy them to the PC
periodically and record the date of the last copy:

```bash
scp '<user>@<server>:/var/lib/lifelogger/backups/*.db' ./backups/
```

## Logs and status

```bash
sudo systemctl status lifelogger
journalctl -u lifelogger -n 100 --no-pager
journalctl -u lifelogger -f
journalctl -u lifelogger-backup -n 50 --no-pager
systemctl list-timers lifelogger-backup.timer
curl -fsS http://127.0.0.1:8080/health
```

`/health` returns `status`, `version`, `schemaVersion`, `syncProtocolVersion`,
`database` and `timestamp`. It uses a direct `SELECT 1` probe and never scans
application tables. A failure returns HTTP 503.

## Upgrading Node

1. Check the PC version: `node -v`.
2. On the server: `sudo pacman -Syu nodejs npm` (or install the matching version).
3. `sudo /opt/lifelogger/deploy.sh <current-tag> --dry-run` is not a build test;
   instead run the test suite from a release checkout:
   ```bash
   cd /opt/lifelogger/releases/<tag>
   npm ci
   npm test
   ```
4. Deploy the next tag normally. Record both Node versions in the report.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `/health` returns 503 | `DB_PATH` in `/etc/lifelogger.env`, directory permissions, `journalctl -u lifelogger`. |
| Service will not start | `systemctl status lifelogger`, then `ls -l /opt/lifelogger/current`, `/opt/lifelogger/version.env`, and the Node path in the unit. |
| Push does not deploy | Tag must match `v*` and the regex above. Check `ls -l /opt/lifelogger/repo.git/hooks/post-receive` and run the deploy manually to see the error. |
| `deploy already running` | Another push is deploying. `flock` releases when the process exits; otherwise inspect `ps`. |
| Build runs out of memory | Confirm `zramctl` shows swap. Use the PC-build fallback and record the decision. Keep `MemoryMax=1G` on the service. |
| Native SQLite error | Node 24 ships `node:sqlite`; confirm the unit runs `/usr/bin/node` from the matched major version and that `node -e "require('node:sqlite')"` works. |
| Web shows an old version | Reload; `index.html` is `no-cache` and assets are hashed. Compare the footer with `/health`. |
| API returns 401 | The client's API key must equal `API_KEY` in `/etc/lifelogger.env`. |
| Phone cannot reach the server | Confirm Tailscale is up on both devices, the server address is set in the app, and the chosen HTTPS/cleartext option is built into the app. |
| Lock file after a crash | `flock` is advisory and released on process exit. Check `ps` before deleting `/opt/lifelogger/.deploy.lock`. |

## Verification drills

Record the date, result and timing for each.

1. **Rollback drill.** Push a throwaway tag whose build succeeds but health
   fails (for example, temporarily point `HEALTH_URL` at a bad path or start the
   service with a broken `DB_PATH`). Confirm the previous version returns.
2. **Restore drill.** Back up, change a marker, restore the backup with
   `restore.sh --yes`, confirm the data and `PRAGMA integrity_check`, and record
   the timing.
3. **Reboot drill.** `sudo reboot`, then confirm the service and backup timer
   return within 2 minutes without a login.
4. **Build drill.** Record `npm ci` plus build duration and peak memory, using
   `/usr/bin/time -v`, and the idle CPU/memory of the running service.
