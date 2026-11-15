# Life Logger — Project State & Scope

> **Audience:** Anyone joining the project (frontend, backend, or general)  
> **Status:** Increment 3.9 complete (all 10 work packages done)  
> **Repository:** `github.com/Marvelous616/you` (branch: `main`)  
> **Date:** November 15, 2026

---

## 1. Project Vision (One Sentence)

Life Logger is a personal, self-hosted timeline system that records *what you did and what state you were in*. One person, one server, one database. No public internet exposure, no hosted AI, no multi-tenant concerns.

---

## 2. What's Built & Deployed

### Server (running on `zeserver`, Debian 13 trixie)

| Item | Value |
|------|-------|
| Host | `zeserver` (Dell Inspiron 1545, Pentium T4300, 3.78 GiB RAM) |
| OS | Debian GNU/Linux 13 (trixie), kernel 6.12.113+deb13-amd64 |
| Node.js | v24.22.1 |
| Service | `lifelogger.service` — active + enabled |
| Public URL | `https://zeserver.taile544af.ts.net/` via `tailscale serve` (tailnet only, HTTPS) |
| Plain HTTP | Refused on port 8080 (loopback bind only) |
| Database | SQLite WAL at `/var/lib/lifelogger/life.db`, schema 3 |
| Version | `0.3.6` |
| Health check | `GET /health` → `{"status":"ok","database":"connected",...}` |

The server is deployed via a **Debian-native tarball path**: a release tarball is unpacked into `/opt/lifelogger/releases/vX.Y.Z/`, a `current` symlink switches versions, and an install script health-checks and rolls back automatically on failure. The database (`/var/lib/lifelogger/`) and host config (`/etc/lifelogger.env`) live outside releases and are never touched by upgrades.

### Clients

| Client | Status |
|--------|--------|
| Web app | Built and served by the server (React + Vite) |
| Android app | **Deleted** in Increment 3.9. Source removed from `apps/android/`. Would need to be rebuilt for Increment 4 using `expo-sqlite` for durable local storage. |

---

## 3. Architecture & Repository Layout

```
life-logger/                         # Monorepo (npm workspaces)
├── packages/
│   ├── domain/                      # Pure TS: entities, rules, parser, derived values (no I/O)
│   ├── persistence/                 # Repository interfaces + SQLite (WAL) implementations + contract tests
│   └── sync/                        # Outbox engine, push/pull protocol, cursor-based sync
├── apps/
│   ├── server/                      # Node.js + Fastify API
│   ├── web/                         # React + Vite web app
│   └── android/                     # DELETED (was React Native/Expo)
├── tools/bench/                     # Benchmark harness + regression comparison
├── scripts/                         # Windows backup / DR helpers
├── packaging/
│   └── debian/                      # Debian release tarballs + install script (current deploy path)
├── docs/
│   ├── web-design-spec.md           # Written frontend design spec
│   ├── benchmarks/                  # Benchmark baseline JSON files
│   ├── frontend-handoff.md          # This document
│   └── reports/                     # Increment completion reports
├── packaging/debian/                # Debian deploy: build-release.sh, install-release.sh, release tarballs
├── Increment 3.9 Fixes and Hardening.md
├── Life Logger Implementation Plan.md
├── life-logger-high-level-design(2).md
├── Step 1 - Walking Skeleton.md
├── Step 2 - Daily Loop.md
└── package.json                     # Root workspace config
```

**Key architectural rule:** The persistence interface is the only place that knows which database is in use. Everything above it (domain, sync, server, clients) is database-agnostic and swappable.

**Another key rule:** Automated sources (calendar, GPS, etc.) never write directly to the timeline. They propose `Suggestion` records into the inbox; only an explicit user accept creates an `Event`.

---

## 4. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | TypeScript everywhere | One language for domain, server, web |
| Domain | Plain TS package, no I/O | Testable without a database; shared by all clients |
| Server | Node.js + Fastify | Small, single process, easy to deploy |
| Database | SQLite in WAL mode | Single file, easy backup, swappable via contract suite |
| Web app | React 18 + Vite + TypeScript | PC-first UI |
| Styling | Restrained neutral dark theme, no emojis | Project rule |
| Sync | Custom outbox + push/pull endpoints + cursor | Small, Last-Write-Wins per record |
| Tests | Vitest (unit + contract) | Same runner for every package |
| CI | GitHub Actions (type-check, lint, tests on push) | Catches breakage early |

---

## 5. Data Model (Key Entities)

All entities live in `packages/domain/src/types.ts`.

### Day
A logical day bounded by wake/sleep (not midnight).
- `id`, `localDate`, `wakeAt?`, `sleepAt?`, `timezone`, `reviewStatus` (`unreviewed`/`in_progress`/`completed`), `fidelity` (`detailed`/`summary`/`skipped`, **derived** from coverage + journal), `createdAt`, `updatedAt`, `isDeleted`

### Event
Something done over an interval (or a point if no end).
- `id`, `dayId`, `title`, `startAt`, `endAt?`, `startPrecision`, `endPrecision`, `source` (`live`/`backfill`/`prompted`/`imported`), `notes?`, `createdAt`, `updatedAt`, `isDeleted`
- Events may overlap arbitrarily; overlaps and lane assignment are **derived**, never stored

### Tag
Hierarchical tag tree (e.g. `work/coding`, `food/lunch`).
- `id`, `name`, `path`, `color?`, `parentId?`
- One primary tag per event (via `EventTag.isPrimary`)

### Person / EventParticipant
People involved in events (role, medium, initiated_by).

### JournalEntry
Free-text reflection tied to a Day.

### Marker
One-tap "something happened now" timestamp with optional note.

### Capture
Raw quick-entry text before parsing; kept forever for re-parsing.

### Suggestion
Machine-proposed event awaiting accept/reject/edit.
- `id`, `source` (`calendar`/`gps`/...), `confidence`, `proposed` (`{ title, startAt, endAt?, ... }`), `status` (`pending`/`accepted`/`rejected`), `externalId?`, `createdAt`, `updatedAt`
- Nothing automated writes straight into the timeline; accepting creates an `Event`

---

## 6. API Surface (Backend Contract)

All endpoints are under `/api/v1/`. The server also serves `/health` (unauthenticated) and static web files.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Server health |
| GET | `/api/v1/days/active?timezone=` | Yes | Get or create the active day for a timezone |
| GET | `/api/v1/days/:id/timeline` | Yes | Full day timeline |
| PATCH | `/api/v1/days/:id` | Yes | Patch day (wakeAt, sleepAt, reviewStatus, timezone) |
| GET | `/api/v1/markers?dayId=` | Yes | List markers |
| POST | `/api/v1/events` | Yes | Create an event (+ tags, people, capture) |
| POST | `/api/v1/days/:id/journal` | Yes | Save a journal entry |
| POST | `/api/v1/days/:id/review` | Yes | Complete end-of-day review |
| GET | `/api/v1/suggestions?status=pending` | Yes | List pending suggestions |
| PATCH | `/api/v1/suggestions/:id` | Yes | Edit a suggestion |
| POST | `/api/v1/suggestions/:id/accept` | Yes | Accept → creates an Event |
| POST | `/api/v1/suggestions/:id/reject` | Yes | Reject |
| GET | `/api/v1/extensions` | Yes | List registered extensions |
| POST | `/api/v1/extensions/calendar/import` | Yes | Import .ics → suggestions |

**Auth:** Single-user API key via `Authorization: Bearer <key>` or `x-api-key` header. `/health` and static files are unauthenticated.

**CORS:** Enabled with `origin: '*'`.

---

## 7. Deployment

The server runs on `zeserver` (Debian 13). Deploy model:

1. **Build** on PC: `packaging/debian/build-release.sh` → `lifelogger-<version>.tar.gz`
2. **Transfer** tarball to server
3. **Install**: `packaging/debian/install-release.sh <tarball>` — unpacks, switches `current` symlink, restarts service, health-checks, rolls back on failure
4. **Database & config** live outside releases: `/var/lib/lifelogger/` and `/etc/lifelogger.env`

The systemd unit loads env in order: package defaults → `/etc/lifelogger.env` → `version.env`. `APP_VERSION` comes from `version.env` (written at build time).

---

## 8. Roadmap — Done vs Pending

### Completed (Increments 1–3.9)

| Increment | Focus | Status |
|-----------|-------|--------|
| 1 | Walking skeleton: marker save → sync → web timeline | Done |
| 2 | Daily loop: events, tags, people, quick-entry, journal, end-of-day review, gaps | Done |
| 3 | Suggestions + Calendar extension (ICS import) | Done |
| 3.5 | Packaging redo: Arch → Debian deployment | Done |
| 3.9 | Fixes & hardening: HTTPS, off-machine backups, Debian deploy path, drills, web design spec | Done |

All drills passed: upgrade/rollback, reboot, backup/restore, benchmark regression guard.

### Pending (Increment 4 — "depth", ~15 focused days)

| Work Package | Description |
|--------------|-------------|
| Things & dynamic types | `TypeDefinition`, `TypeInstance`, `EventThing` — runtime-creatable typed fields |
| Full-text search | Search over event titles, notes, journals |
| Diagnostics extension | Crash reports, perf sampling, retention (own tables, never writes timeline) |
| Android `expo-sqlite` binding | Durable local storage for Android (rebuild deleted app) |

### Increment 5 (outline)
- Remaining extensions (health tracker, todo list, GPS, relationships, analytics, etc.)
- Analytics dashboards
- Backfilling past days
- Management screens on Android (types, tags, modules)

---

## 9. Frontend-Specific Scope (If Building a Client)

If you are building a frontend client (web or mobile), here is the contract surface you need to integrate against:

**Authentication:** API key in `Authorization: Bearer` or `x-api-key` header on all `/api/v1/` endpoints.

**Core data flow:**
1. Fetch active day: `GET /api/v1/days/active?timezone=<tz>`
2. Fetch timeline: `GET /api/v1/days/:id/timeline` (returns events, markers, tags, people, gaps, journal, coverage)
3. Create event: `POST /api/v1/events` (with optional tags, people, capture)
4. Patch day: `PATCH /api/v1/days/:id` (wakeAt, sleepAt, reviewStatus)
5. Complete review: `POST /api/v1/days/:id/review` (sleepAt, journalBody)
6. Sync suggestions: `GET /api/v1/suggestions?status=pending` → accept/reject/edit

**Design constraints (project rules):**
- No emojis in the UI
- Dark theme (app is used at all hours)
- No hosted AI services — all parsing is rule-based
- Single user — no multi-tenant auth or registration
- Suggestions never write directly to the timeline; only accept creates an Event
- HTTPS only in production

**Design spec:** `docs/web-design-spec.md` contains a written design spec (tokens, component rules, screen layouts, extension slots) for the web app. Phone screens are left out of that spec.

---

## 10. Constraints & Conventions (Read Before Coding)

- **No emojis** in the UI
- **No hosted AI services** — all parsing is rule-based (regex/tokenizer)
- **Single user** — no multi-tenant auth, no registration flow
- **HTTPS only** for production; local dev can use HTTP
- **API key** lives in `/etc/lifelogger.env` on the server — never commit it
- **Suggestions never write directly to the timeline** — only accept creates an Event
- **One database, one server, one user** — keep it simple
- **Dark theme** — the app is used at all hours; light mode is not a priority
- **Migrations only move forward** — a shipped migration is never edited
- **A task is done when** it is typed, has unit tests for any domain logic, passes CI, includes a migration if the schema changed, and is noted in a changelog

---

## 11. Useful Links

- Repository: `https://github.com/Marvelous616/you`
- Server (live): `https://zeserver.taile544af.ts.net/health`
- Increment 3.5 report: `docs/reports/increment-3.5-completion-report.md`
- Increment 3.9 report: `docs/reports/increment-3.9-completion-report.md`
- Web design spec: `docs/web-design-spec.md`
- High-level design: `life-logger-high-level-design(2).md`
- Implementation plan: `Life Logger Implementation Plan.md`
- Increment 3.9 spec: `Increment 3.9 Fixes and Hardening.md`
