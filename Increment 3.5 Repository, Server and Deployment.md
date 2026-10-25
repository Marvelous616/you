# Increment 3.5: Repository, Server and Deployment

Life Logger · Specification v1 · October 25, 2026 · Starts from `v0.3.0-increment-3`

## 1. Purpose and outcome

Increment 3 is engineering complete but exists only on the development PC. This increment puts it on GitHub and on the always-on home server, and makes every future increment reach the server by pushing a git tag. It adds no product features.

When this increment is done:

- The code is in a GitHub repository, and a fresh clone builds and passes all tests.
- The server runs Life Logger as a service that starts on boot and restarts on failure.
- Pushing a tag such as `v0.4.0-increment-4` builds, deploys and health-checks that release on the server, and rolls back automatically if the health check fails.
- The database is backed up daily, and a restore has been tested.
- The PC and the phone can both reach the server, and a change logged on one shows up on the other.
- The test suite and benchmarks have been run on the server hardware, so the performance targets are measured on the real host.

## 2. Context

| Item | Value |
| --- | --- |
| Code | TypeScript monorepo: `packages/domain`, `packages/persistence`, `packages/sync`, `apps/server` (Fastify, SQLite in WAL mode), `apps/web` (React, Vite), `apps/android` (Expo React Native) |
| State | Tagged `v0.3.0-increment-3` per the Increment 3 report, 132 tests passing, benchmarks recorded in `docs/benchmarks/increment-3-baseline.json` |
| Development machine | Windows PC (PowerShell) |
| Server | Always-on Dell Inspiron 1545 laptop, hostname `zeserver`, Arch Linux, Pentium T4300 (2 cores), about 3.8 GB RAM, no swap, on the home LAN |
| Access | SSH from the PC; the phone connects over Tailscale |

The server is a low-end machine. Anything this increment adds must be light on CPU and memory, and builds must not exhaust RAM.

## 3. Scope and non-goals

In scope: the GitHub push, runtime configuration, a health endpoint, deploy, backup and restore scripts, systemd units, server provisioning, connectivity from the PC and the phone, and on-host verification.

Out of scope, and not to be started here:

- Product features, schema changes and migrations.
- The Android `expo-sqlite` binding. It is still needed before the 14-day dual-device dogfood and is the first work package of Increment 4.
- The Diagnostics extension, full-text search, things and dynamic types, and recurring-event expansion.
- Docker, a CI service, and exposing the server to the public internet.

## 4. Ground rules for the agent

1. Do not guess names. Read the `package.json` scripts, the server entry point and the existing config before writing anything that refers to them, and use what you find.
2. Keep all 132 existing tests passing. New code gets tests.
3. No secrets, passwords, private keys, keystores or LAN addresses in the repository. Use placeholders and environment variables.
4. Prefer boring tools: bash, systemd, git and the SQLite CLI. Add a runtime dependency only if the existing stack cannot do the job, and say why in the report.
5. Keep everything light. `/health` must not scan tables, and scripts must work with 3.8 GB of RAM.
6. No emojis in the UI.
7. Anything destructive on the server (deleting files, replacing the database, touching partitions) needs explicit confirmation from the owner first.
8. Shell scripts are written for Linux. Add a `.gitattributes` so they keep LF line endings even though they are authored on Windows.
9. When a step needs the owner, stop and list exactly what the owner must run, then continue once the output is pasted back.

## 5. Who does what

| Task | Agent | Owner |
| --- | --- | --- |
| Repository hygiene, README, `.gitattributes`, secret scan | Yes | Reviews |
| Create the GitHub repository and push | Provides commands | Yes |
| Config, `/health`, graceful shutdown, tests | Yes |  |
| Scripts, units and runbook in `deploy/` | Yes | Reviews |
| Check live vs installed OS, reinstall if needed | Provides commands | Yes |
| SSH keys, Tailscale accounts | Provides commands | Yes |
| Commands on the server | Only over an SSH session the owner opens or approves | Otherwise runs them |
| Tag pushes that deploy |  | Yes |

## 6. Work packages

### WP 3.5.1: Repository and GitHub

Tasks

- Verify the release tag exists with `git tag -l` and points at the Increment 3 commit. Create it if it does not.
- Review `.gitignore`: `node_modules`, build output, `*.db`, `*.db-wal`, `*.db-shm`, `.env` files, Expo and Android build output, `*.jks` and `*.keystore`.
- Add `.gitattributes` forcing LF for `*.sh`, `deploy/**` and unit files, and mark the shell scripts executable in git with `git update-index --chmod=+x`.
- Scan the working tree and the full history for secrets and for absolute local paths. Replace absolute `file://` links in tracked docs with relative links.
- Add a `README.md`: what it is, requirements, install, test, build, run, environment variables, repository layout, and a link to `deploy/README.md`.
- Owner: create the GitHub repository (private recommended), add `origin`, and push `main` and all tags.

Acceptance

- `git ls-remote --tags origin` lists `v0.3.0-increment-3`.
- A fresh clone in an empty folder passes `npm ci`, the root build and the full test suite.
- No tracked file contains a secret or an absolute path on the PC.

### WP 3.5.2: Runtime configuration and health

Tasks

- Read every runtime setting from environment variables with documented defaults: database path, port, bind address, static web directory and log level. Commit an `.env.example`.
- Make the server serve the built web app if it does not already. `index.html` is sent with `no-cache` and hashed assets with long cache lifetimes, so a new release shows up on the next page load.
- Add `GET /health`, with no authentication, returning JSON with `status`, the app version (from the release tag or `package.json`), the schema version and the sync protocol version. It reads cached or pragma values only, and returns 503 if the database cannot be opened.
- Show the server version somewhere visible in the web UI (a footer or the settings screen), so a deploy can be confirmed by eye.
- Handle `SIGTERM` and `SIGINT`: stop accepting requests, finish in-flight ones, checkpoint the WAL, close SQLite and exit 0.
- On startup, log the version, the database path and the schema version. If the database schema is newer than the code, log a warning and keep running. This relies on the rule that migrations are additive within a release; record the rule in `deploy/README.md`.

Acceptance

- Tests cover `/health` (ok and failure), environment parsing and clean shutdown. All 132 earlier tests still pass.
- Deploying a trivial UI change makes the new version visible on a normal page reload.

### WP 3.5.3: Deploy artifacts

Create a `deploy/` folder. The owner reviews everything in it before it runs on the server.

| File | Purpose |
| --- | --- |
| `server-setup.sh` | One-time, idempotent provisioning for Arch: packages, the `lifelogger` user, directories, zram swap, lid and sleep settings, unit installation, bare repository and hook installation. Safe to run twice. |
| `lifelogger.service` | The systemd unit (reference in section 7). Reads settings from `/etc/lifelogger.env`. |
| `deploy.sh` | Builds a tag into its own release folder, backs up the database, switches the `current` symlink, restarts, health-checks, rolls back on failure and prunes old releases (keep the last 5). |
| `post-receive` | Git hook that runs `deploy.sh` for pushed tags matching `v*` and ignores everything else. |
| `backup.sh`, `lifelogger-backup.service`, `lifelogger-backup.timer` | Daily consistent backup with `sqlite3 .backup`, an integrity check on the copy, 14 days of retention, and a non-zero exit on any failure. |
| `restore.sh` | Stops the service, moves the live database aside, restores the chosen backup, removes stale `-wal` and `-shm` files, starts the service and health-checks. Requires a backup path and `--yes`. |
| `README.md` | Runbook: first install, normal deploy, rollback, restore, logs, upgrading Node, troubleshooting. |

Requirements for the scripts

- `set -euo pipefail`, quoted variables, and clean under `shellcheck` (or the report says why not).
- `deploy.sh` validates the tag against `^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$`, uses `flock` so two deploys cannot overlap, and supports `--dry-run`.
- Paths and the `systemctl` and `curl` commands are overridable by environment variables, so the scripts can be tested against a temporary directory with stubs.
- `deploy/test/` holds a bash test that proves a successful deploy switches the symlink, a failing health check rolls back, and a bad tag is rejected.

Acceptance

- The stub-based deploy tests pass and `shellcheck` is clean.
- Every script refuses to run destructive steps without its documented confirmation.

### WP 3.5.4: Server provisioning

Mostly run by the owner, with the agent providing the exact commands and checking the output.

Tasks

1. Run `findmnt /` and `lsblk -f`. The server's system information showed an `/run/archiso/cowspace` overlay, which means the live installer environment. If that is what this is, install Arch to the internal disk before continuing, or record a written decision to accept the risk. The runbook must say which was chosen and why.
2. Switch SSH to key login and disable password login.
3. Match the Node major version on the server to the PC (`node -v` on both, recorded in the report).
4. Run `deploy/server-setup.sh`.
5. Add the `server` remote on the PC.

Acceptance

- The `lifelogger` service and the backup timer are enabled.
- After a reboot, the service is up and healthy within 2 minutes without anyone logging in.

### WP 3.5.5: First deploy and on-host verification

Tasks

- Tag `v0.3.5-increment-3.5` and push it to the server remote.
- Record the build duration and the peak memory of `npm ci` plus the build on the server, for example with `/usr/bin/time -v`. If the build runs out of memory or takes more than 10 minutes, document the fallback of building on the PC and shipping the result.
- Run the full test suite on the server.
- Run the benchmark harness on the server and save the result as `docs/benchmarks/increment-3.5-server-baseline.json`, including host details (CPU model, RAM, Node version, tag). Report each metric against its target and against the PC baseline. Any metric over target is a blocker, and any metric with less than 5x headroom is flagged.
- Record the idle memory and CPU use of the running service.

Acceptance

- The service answers `/health` with the deployed version.
- All tests pass on the server, and all benchmark targets pass on the server.

### WP 3.5.6: Benchmark regression guard

Tasks

- Let the benchmark harness take an output path and a host label.
- Add a compare mode that reads a baseline JSON and fails if any metric is more than 3x slower than its baseline value.
- Document in the README how to run it on the PC and on the server.

Acceptance

- A test shows that compare mode passes on the baseline itself and fails on a deliberately slowed copy.

### WP 3.5.7: Connectivity

Tasks

- Give the server a stable address: a DHCP reservation or a stable hostname on the LAN.
- Install Tailscale on the server, the phone and the PC, and record the server's tailnet name.
- Android must reach the server over the tailnet. Android blocks plain http by default, so choose one of two options and record the decision in the runbook: A, HTTPS through Tailscale (recommended if available), or B, allow cleartext for the app through Expo build properties.
- Make sure the Android app has a way to set the server address, and use it.
- End-to-end check: log a marker on the PC and see it on the phone after sync, then the reverse. Import an `.ics` file in the web app and see the suggestions on the phone.

Acceptance

- Sync works between the PC and the phone through the server with Wi-Fi off on the phone.

## 7. Reference snippets

These are starting points. Adapt names and paths to what the repository actually uses.

`deploy/lifelogger.service`

```ini
[Unit]
Description=Life Logger
After=network-online.target

[Service]
User=lifelogger
WorkingDirectory=/opt/lifelogger/current
EnvironmentFile=/etc/lifelogger.env
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=always
MemoryMax=1G

[Install]
WantedBy=multi-user.target
```

`/etc/lifelogger.env` (variable names must match what WP 3.5.2 settles on)

```
DB_PATH=/var/lib/lifelogger/life.db
PORT=8080
HOST=0.0.0.0
```

`deploy/deploy.sh` outline

```bash
#!/usr/bin/env bash
set -euo pipefail
TAG="${1:?usage: deploy.sh <tag>}"
APP="${APP_ROOT:-/opt/lifelogger}"; DB="${DB_PATH:-/var/lib/lifelogger/life.db}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._-]+)?$ ]] || { echo "bad tag"; exit 2; }
exec 9>"$APP/.deploy.lock"; flock -n 9 || { echo "deploy already running"; exit 3; }
PREV="$(readlink "$APP/current" || true)"
git -C "$APP/repo.git" worktree add "$APP/releases/$TAG" "$TAG"
( cd "$APP/releases/$TAG" && npm ci && npm run build )
[ -f "$DB" ] && sqlite3 "$DB" ".backup '/var/lib/lifelogger/backups/pre-$TAG.db'"
ln -sfn "$APP/releases/$TAG" "$APP/current"
${SYSTEMCTL:-systemctl} restart lifelogger
for _ in $(seq 10); do sleep 1; ${CURL:-curl} -fs localhost:8080/health && exit 0; done
if [ -n "$PREV" ]; then ln -sfn "$PREV" "$APP/current"; ${SYSTEMCTL:-systemctl} restart lifelogger; fi
echo "health check failed, rolled back to ${PREV:-nothing}"; exit 1
```

`deploy/post-receive`

```bash
#!/usr/bin/env bash
unset GIT_DIR
while read -r _old _new ref; do
  case "$ref" in refs/tags/v*) /opt/lifelogger/deploy.sh "${ref#refs/tags/}" ;; esac
done
```

From the PC, a deploy is then:

```
git tag v0.4.0-increment-4
git push server main --tags
```

## 8. Quality gates

- [ ] A fresh clone from GitHub builds and passes all tests.
- [ ] No secrets or absolute local paths in the repository or its history.
- [ ] `.gitattributes` keeps LF endings, and the scripts are executable in git.
- [ ] `/health` returns the version, schema version and sync protocol version, and is tested.
- [ ] Clean shutdown on `SIGTERM` is tested.
- [ ] Deploy script tests pass with stubs, and `shellcheck` is clean.
- [ ] The service is enabled, survives a reboot and starts without a login.
- [ ] A tag push deploys and health-checks, and the new version shows in the web UI.
- [ ] The rollback drill and the restore drill passed.
- [ ] The daily backup timer runs, and a backup passes `PRAGMA integrity_check`.
- [ ] Tests and benchmarks pass on the server, and the baseline JSON is saved.
- [ ] The benchmark regression guard works.
- [ ] The PC and the phone sync through the server over Tailscale.
- [ ] Release tagged `v0.3.5-increment-3.5` and pushed.

## 9. Verification drills

1. **Rollback drill.** Push a throwaway tag whose build starts but fails `/health` (for example by forcing a 503 through an environment flag). Expect an automatic rollback with the previous version running. Delete the tag afterwards and record the timing.
2. **Restore drill.** Take a backup, change some data, then restore the backup with `restore.sh --yes` against a scratch database path first. Confirm the restored data and `PRAGMA integrity_check`, and record the timing.
3. **Reboot drill.** Reboot the server and confirm the service and the backup timer come back without a login.
4. **Build drill.** Record the `npm ci` and build time and the peak memory on the server.

## 10. Completion report

Use the same format as the earlier reports, plus a Server facts section containing:

- The output of `findmnt /` and `lsblk -f`.
- The Node versions on the PC and the server.
- A summary of the SSH and Tailscale setup.
- The results and timings of the drills.
- The build time and peak memory, and the idle resource use.

The benchmark table gets two columns, one for the PC and one for the server.

## 11. Risks and decisions to record

| Risk | Mitigation |
| --- | --- |
| The server is running the live installer | WP 3.5.4 step 1, with the decision recorded |
| Builds exhaust RAM on a 3.8 GB machine | zram swap, `MemoryMax` on the service, and the fallback of building on the PC |
| Windows line endings break the shell scripts | `.gitattributes` and an LF check in the quality gates |
| The native SQLite module fails to build or load on the old CPU | Install build tools, run the tests on the server before the first real deploy, and record the driver and Node version |
| Android blocks plain http | The WP 3.5.7 decision between HTTPS and cleartext |
| A bad release locks in a schema change | Additive-only migrations and a backup before every deploy |
| Backups on the same disk are lost with it | A periodic copy to the PC, noted in the runbook |

Decisions to record in `deploy/README.md`: live vs installed OS, HTTPS vs cleartext, build on the server vs on the PC, and private vs public repository.

## 12. After this increment

The 14-day dual-device dogfood clock should start once Increment 4 WP 4.1 (the Android `expo-sqlite` binding) and the Diagnostics extension are in. Until then, do the real logging on the PC and use the phone only to try things.
