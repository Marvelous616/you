# Life Logger

A personal, self-hosted system that records what you did and what state you were in, as an offline-first timeline of events and markers, enriched with context and free-text journaling.

Life Logger runs as a local web app on the PC, a React Native companion on Android, and a single-user Fastify service over SQLite. It is designed for one person, one database and no public internet exposure.

## Requirements

- Node.js 24 (tested with v24.19.0). Node 24 provides the built-in `node:sqlite` driver, so no native module build is required.
- npm 10 or newer.
- Linux with systemd for the always-on server. Development works on Windows, macOS or Linux.
- `bash` and `shellcheck` only if you want to run the deployment-script tests and lint locally.

## Install

```bash
git clone <repository-url> life-logger
cd life-logger
npm ci
```

`npm ci` installs every workspace: domain, persistence, sync, server, web, Android and the benchmark harness.

## Test

```bash
# Everything: domain, persistence, sync, server, Android logic and the bench CLI
npm test

# TypeScript project build (domain, persistence, sync, server and bench)
npm run typecheck

# Production build of the web app
npm run --workspace=@life-logger/web build

# Android type check
npm run --workspace=@life-logger/android exec tsc --noEmit

# Deployment scripts (bash, Linux or Git Bash)
npm run test:deploy
shellcheck deploy/*.sh deploy/post-receive deploy/test/*.sh
```

The server tests cover `/health` (ok and database failure), environment parsing, static web serving, API-key protection and graceful shutdown. The deploy test uses stubs for `systemctl`, `curl`, `sqlite3`, `git`, `npm`, `flock`, `ln` and `readlink`; it proves that a successful deploy moves the `current` pointer, that a failed health check rolls back, and that invalid tags are refused.

## Build

```bash
npm run build
npm run --workspace=@life-logger/web build
```

The server build outputs to `apps/server/dist`. The web build outputs to `apps/web/dist`, which the server serves directly.

## Run

Development, with two terminals:

```bash
# API on http://localhost:4000
npm run --workspace=@life-logger/server dev

# Web app on http://localhost:3000
npm run --workspace=@life-logger/web dev
```

Production-style local run:

```bash
cp .env.example .env
npm run build
npm run --workspace=@life-logger/web build
npm run --workspace=@life-logger/server start
# open http://localhost:4000
```

The server serves the built web app, falls back to `index.html` for client-side routes, and returns `no-cache` for `index.html` while hashed assets get a one-year immutable cache. The footer shows the version reported by `/health`.

Android companion:

```bash
npm run --workspace=@life-logger/android start
```

Set the server address in the app's connection settings. `http://10.0.2.2:4000` is the Android emulator alias for the development PC; a real phone needs the server's LAN or Tailscale name. See `deploy/README.md` for the HTTPS versus cleartext decision.

## Configuration

The server reads every setting from the environment. `.env.example` documents the same names. Development scripts load a root `.env` automatically through Node's `--env-file-if-exists`; the systemd unit loads `/etc/lifelogger.env` instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `data/life-logger.sqlite` | SQLite database file. Relative paths resolve from the working directory. |
| `WEB_DIR` | `apps/web/dist` | Built web app directory. Static serving is skipped if it is missing. |
| `HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` behind a local reverse proxy. |
| `PORT` | `4000` | HTTP port. The server deployment uses `8080`. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `API_KEY` | unset | When set, every `/api/` request needs `Authorization: Bearer <key>` or `x-api-key`. `/health` and static files stay open. |
| `APP_VERSION` | root `package.json` version | Release identifier shown by `/health` and in the footer. |
| `DATA_DIR` | unset | Legacy convenience fallback: `DB_PATH` becomes `<DATA_DIR>/life-logger.sqlite`. |

`GET /health` is unauthenticated and returns:

```json
{
  "status": "ok",
  "database": "connected",
  "version": "v0.3.5-increment-3.5",
  "schemaVersion": 3,
  "syncProtocolVersion": 1,
  "timestamp": "2026-10-25T00:00:00.000Z"
}
```

The probe is a single `SELECT 1`; it does not scan application tables. A database failure returns HTTP 503.

## Repository layout

- [`packages/domain`](./packages/domain): Pure TypeScript domain entities (`Day`, `Marker`, `Event`, `Tag`, `Person`, `JournalEntry`, `Capture`, `Suggestion`), logical day resolution, timeline lanes and gap detection, derived day fidelity, deterministic quick-entry parsing, suggestion lifecycle rules, an ICS calendar parser, an extension registry, and Last-Write-Wins (LWW) conflict handling.
- [`packages/persistence`](./packages/persistence): Repository interfaces for days, markers, events, tags, people, journal entries, captures, suggestions and calendar metadata; SQLite (WAL mode) implementations; forward-only migrations and an engine-agnostic contract test suite.
- [`packages/sync`](./packages/sync): Outbox engine, batch push/pull protocol across all Daily Loop entity types plus suggestions, cursor-based synchronization and the sync protocol version.
- [`apps/server`](./apps/server): Node.js + Fastify API service with single-user authentication, runtime configuration, health reporting, graceful shutdown, static web serving, transactional sync ingestion, day timeline/gap endpoints, journal and end-of-day review endpoints, the suggestion inbox API, and the Calendar extension import endpoint.
- [`apps/web`](./apps/web): React + Vite web application with a multi-lane day timeline, gap detection, quick-entry capture, journal, end-of-day review modal, suggestion inbox, `.ics` calendar import, and a version footer.
- [`apps/android`](./apps/android): React Native / Expo companion app featuring quick-entry parsing, one-tap offline marker capture (< 50ms), a mini day timeline, offline review, an offline suggestion inbox with ICS paste import, automatic outbox synchronization, and a configurable server address.
- [`tools/bench`](./tools/bench): Synthetic dataset generator, benchmark harness, regression comparison and JSON output.
- [`scripts/`](./scripts): Local Windows backup and sandbox disaster-recovery helpers.
- [`deploy/`](./deploy): Arch provisioning, systemd units, tag-triggered deploy, backup, restore and the server runbook.
- [`docs/benchmarks`](./docs/benchmarks): Recorded benchmark baselines.
- [`docs/reports`](./docs/reports): Increment completion reports.

## Suggestions and the Calendar extension

Automated sources never write directly to the timeline. They propose items into the suggestion inbox, and only an explicit accept action creates an `Event` with `source = imported`:

1. Import an `.ics` file from the web suggestion inbox, or paste calendar text into the Android app while offline.
2. Each calendar `VEVENT` becomes a pending suggestion with `approx` times until you confirm it. UIDs are hashed into stable suggestion IDs so re-importing the same file is idempotent.
3. Accept, edit or reject each suggestion. Rejected items stay in storage, so a later import does not propose the same calendar item again.
4. Accepted calendar events also record module-owned metadata in `calendar_items` (external UID, recurrence rule, organizer and attendees) keyed by `event_id`.

Relevant API surface:

```text
GET    /api/v1/suggestions?status=pending
PATCH  /api/v1/suggestions/:suggestionId
POST   /api/v1/suggestions/:suggestionId/accept
POST   /api/v1/suggestions/:suggestionId/reject
GET    /api/v1/extensions
POST   /api/v1/extensions/calendar/import
```

Suggestion records synchronize through the existing outbox using the `suggestion` entity type. Accepting on Android works offline; the created event, accepted suggestion, and calendar metadata are reconciled when the device next syncs.

## Benchmarks

Build the harness once, then run it with an explicit output path and host label:

```bash
npm run --workspace=@life-logger/bench build

# PC baseline
node tools/bench/dist/index.js \
  --output docs/benchmarks/increment-3.5-pc-baseline.json \
  --host-label pc

# Server baseline, run from a release checkout on the server
node tools/bench/dist/index.js \
  --output docs/benchmarks/increment-3.5-server-baseline.json \
  --host-label server

# Regression guard: fail if any metric is more than 3x its baseline
node tools/bench/dist/index.js \
  --output /tmp/life-logger-bench.json \
  --host-label pc \
  --compare docs/benchmarks/increment-3.5-pc-baseline.json
```

The harness records CPU model, core count, total memory, Node version, platform, architecture, host label and app version alongside the 11 metric values and their pass/fail targets. Compare mode only checks metrics present in both files, so adding a metric does not break an older baseline. Any metric above its target, or more than three times its baseline, exits non-zero. Use `--help` for all options.

## Deployment

The always-on server runs the same code as a systemd service behind a tag-triggered deploy:

```bash
git tag v0.4.0-increment-4
git push server main --tags
```

`deploy/README.md` is the runbook: first install, server preparation, normal deploy, manual and automatic rollback, restore, backups, logs, Node upgrades, troubleshooting and the verification drills. The deploy scripts are shellcheck-clean and use stubs in tests, so the first real run is not the first run.

Secrets, private keys, keystores and real LAN addresses are never committed. Server settings belong in `/etc/lifelogger.env`, which the provisioning script creates with a generated API key.
