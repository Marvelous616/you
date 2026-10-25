# Life Logger

A personal, self-hosted system that records what you did and what state you were in, as an offline-first timeline of events and markers, enriched with context and free-text journaling.

## Monorepo Architecture

- [`packages/domain`](./packages/domain): Pure TypeScript domain entities (`Day`, `Marker`, `Event`, `Tag`, `Person`, `JournalEntry`, `Capture`, `Suggestion`), logical day resolution, timeline lanes and gap detection, derived day fidelity, deterministic quick-entry parsing, suggestion lifecycle rules, an ICS calendar parser, an extension registry, and Last-Write-Wins (LWW) conflict handling.
- [`packages/persistence`](./packages/persistence): Repository interfaces for days, markers, events, tags, people, journal entries, captures, suggestions and calendar metadata; SQLite (WAL mode) implementations; forward-only migrations and an engine-agnostic contract test suite.
- [`packages/sync`](./packages/sync): Outbox engine, batch push/pull protocol across all Daily Loop entity types plus suggestions, and cursor-based synchronization.
- [`apps/server`](./apps/server): Node.js + Fastify API service with single-user authentication, transactional sync ingestion, day timeline/gap endpoints, journal and end-of-day review endpoints, the suggestion inbox API, and the Calendar extension import endpoint.
- [`apps/web`](./apps/web): React + Vite web application with a multi-lane day timeline, gap detection, quick-entry capture, journal, end-of-day review modal, suggestion inbox, and `.ics` calendar import.
- [`apps/android`](./apps/android): React Native / Expo companion app featuring quick-entry parsing, one-tap offline marker capture (< 50ms), a mini day timeline, offline review, an offline suggestion inbox with ICS paste import, and automatic outbox synchronization.
- [`tools/bench`](./tools/bench): Synthetic dataset generator and benchmark harness.
- [`scripts/`](./scripts): Automated SQLite online backup and sandbox disaster recovery tests.

## Getting Started

### Prerequisites
- Node.js 22+ (built-in `node:sqlite` support)
- npm 9+

### Commands

```bash
# Install dependencies
npm install

# Build all TypeScript packages
npm run build

# Run unit tests and persistence contract test suite
npm test

# Run benchmark suite
npm run --workspace=@life-logger/bench bench

# Start backend server (port 4000)
npm run --workspace=@life-logger/server dev

# Start web client (port 3000)
npm run --workspace=@life-logger/web dev

# Create an online SQLite backup
powershell -File ./scripts/backup.ps1

# Test disaster recovery restore
powershell -File ./scripts/restore.ps1
```

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
