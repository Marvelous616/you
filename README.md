# Life Logger

A personal, self-hosted system that records what you did and what state you were in, as an offline-first timeline of events and markers, enriched with context and free-text journaling.

## Monorepo Architecture

- [`packages/domain`](./packages/domain): Pure TypeScript domain entities (`Day`, `Marker`, `Event`, `Tag`, `Person`, `JournalEntry`, `Capture`), logical day resolution, timeline lanes and gap detection, derived day fidelity, deterministic quick-entry parsing, and Last-Write-Wins (LWW) conflict handling.
- [`packages/persistence`](./packages/persistence): Repository interfaces for days, markers, events, tags, people, journal entries and captures; SQLite (WAL mode) implementations; forward-only migrations and an engine-agnostic contract test suite.
- [`packages/sync`](./packages/sync): Outbox engine, batch push/pull protocol across all Daily Loop entity types, and cursor-based synchronization.
- [`apps/server`](./apps/server): Node.js + Fastify API service with single-user authentication, transactional sync ingestion, day timeline/gap endpoints, journal and end-of-day review endpoints.
- [`apps/web`](./apps/web): React + Vite web application with a multi-lane day timeline, gap detection, quick-entry capture, journal, and end-of-day review modal.
- [`apps/android`](./apps/android): React Native / Expo companion app featuring quick-entry parsing, one-tap offline marker capture (< 50ms), a mini day timeline, offline review, and automatic outbox sync.
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
