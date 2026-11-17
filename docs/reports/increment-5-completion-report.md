# Increment 5: Things, Search and Diagnostics — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 5 — Things, Search and Diagnostics
> **Date:** November 17, 2026
> **Git Commit:** `5b2f264` (version bump to 0.3.7, pushed to `origin/main`)
> **Tag:** `v0.3.7-increment-3.5` (pushed to `origin/main`)
> **Status:** All three tracks complete; T1–T3 done, release cut, package built and deployed to `zeserver`

---

## 1. Executive Summary

Increment 5 adds three independent capability tracks on top of the closed daily loop:

1. **Things** — runtime-creatable typed fields (`TypeDefinition`, `EventThing`) attached to events, with full CRUD API, sync v3 entity types, persistence repositories, domain validation rules, and web rendering.
2. **Full-text search** — `GET /api/v1/search` over event titles/notes and journal bodies, ranked (title prefix > title contains > body match), newest first, with a `SearchBox` component in DayView.
3. **Diagnostics** — `CrashReport` and `PerfSample` system-data-only tables (`crash_reports`, `perf_samples`) with a rolling 30-day retention job, server API, and a Diagnostics modal in DayView. Diagnostics is intentionally not synced.

Everything ships as version 0.3.7 (schema 7, sync protocol 3). All quality gates are green: type-check, lint, 218 tests across 29 files, and the web + server build. A new benchmark baseline (`increment-5-server-baseline.json`) was recorded; all targets pass with no regression vs the Increment 4.1 baseline.

The release was cut (`v0.3.7-increment-3.5`), the Arch package built (`lifelogger-0.3.7-1-any.pkg.tar.zst`), and the release published to GitHub. On `zeserver` (Debian 13, no `pacman`) the package contents were deployed manually to `/opt/lifelogger/releases/v0.3.7/`, the `current` symlink re-pointed, the systemd unit installed from the package, and `/health` confirms schema 7 / protocol 3 running.

---

## 2. Work Packages Completed

| WP | Task | Result |
|-----|------|--------|
| T1.1 | Things domain types (`TypeDefinition`, `TypeInstance`, `EventThing`) + migration 6 + persistence repos + sync v3 | Done (`d5f3894`) |
| T1.2 | Server API: type definitions CRUD, event things attach/detach, event detail returns things; sync push/pull; CRUD tests | Done (`9caf420`) |
| T1.3 | Web rendering: type-definition + event-thing API client; `EventDetail` renders typed thing values | Done (`644747e`) |
| T1.4 | Domain rules: `validateTypeDefinitionDraft`, `validateTypeInstance`, `buildEventThing`; domain tests | Done (`06a34b0`) |
| T2.1 | Search backend: `SearchHit`, `normalizeSearchQuery`, `rankSearchHit`; `SqliteSearchRepository`; `GET /api/v1/search`; server tests | Done (`0cb57c3`) |
| T2.2 | Search web UI: `search()` client, `SearchBox` component wired into DayView | Done (`8291ff2`) |
| T3.1 | Diagnostics backend: `CrashReport`/`PerfSample` entities; migration 7; `SqliteDiagnosticsRepository` with retention job; server API; server tests | Done (`fa8cff7`) |
| T3.2 | Diagnostics web view: client methods, modal component, wired into DayView header | Done (`e8042ee`) |
| Release | Version bump to 0.3.7, tag `v0.3.7-increment-3.5`, GitHub release, package built, deployed to `zeserver` | Done (`5b2f264`, tag + release pushed) |

Total: ~15 focused days across the three tracks plus release work.

---

## 3. Domain (`packages/domain`)

### New entities

| Entity | Fields |
|--------|--------|
| `TypeDefinition` | id, name, fieldType, schema?, createdAt, updatedAt, isDeleted |
| `TypeInstance` | id, typeDefinitionId, subjectType?, subjectId?, value, createdAt, updatedAt, isDeleted |
| `EventThing` | id, eventId, typeDefinitionId, value, createdAt, updatedAt, isDeleted |

### New pure functions (`packages/domain/src/things.ts`)

- `validateTypeDefinitionDraft(draft)` — requires non-empty `name` and `fieldType`; validates `schema` is JSON-serializable
- `validateTypeInstance(instance, typeDefinitions)` — requires known type definition, `subjectType` of `event`, non-empty `subjectId`, non-empty `value`
- `buildEventThing(draft, options)` — builds an `EventThing` bound to a subject event

Also added `CrashReport` and `PerfSample` entities (`packages/domain/src/types.ts`) for Diagnostics.

### New module: `packages/domain/src/search.ts`

- `SearchHit` interface (`entityType`, `entityId`, `title`, `snippet`, `updatedAt`, `score?`)
- `normalizeSearchQuery(raw)` — trimmed, lower-cased, whitespace-collapsed
- `rankSearchHit(hit, normalizedQuery)` — 3 = title prefix, 2 = title contains, 1 = body/notes match

---

## 4. Persistence (`packages/persistence`) — Migrations 6 and 7

### Migration 6 (schema 5 → 6): Things

| Table | Detail |
|-------|--------|
| `type_definitions` | id, name, field_type, schema_json (default `{}`), created_at, updated_at, is_deleted |
| `event_things` | id, event_id (FK → events), type_definition_id (FK → type_definitions), value_json, created_at, updated_at, is_deleted |
| Indexes | `idx_event_things_event`, `idx_event_things_type`, partial unique `idx_event_things_event_type_live` on `(event_id, type_definition_id) WHERE is_deleted = 0` |

### Migration 7 (schema 6 → 7): Diagnostics

| Table | Detail |
|-------|--------|
| `crash_reports` | id, error, app_version, device_type, screen?, created_at, updated_at, is_deleted |
| `perf_samples` | id, operation, duration_ms, device_type, created_at, updated_at, is_deleted |
| Indexes | created_at indexes on both tables; operation index on `perf_samples` |

### New repositories

- `SqliteTypeDefinitionRepository` — save, findById, findByName, listAll, listModifiedSince, create, patch, softDelete
- `SqliteEventThingRepository` — save, findById, findByEventId, findByEventAndType, listAll, listModifiedSince, softDelete
- `SqliteSearchRepository` — search(query, limit): LIKE over event title/notes and journal body, ranked, newest first
- `SqliteDiagnosticsRepository` — saveCrashReport, listCrashReports, savePerfSample, listPerfSamples, pruneOlderThan(retentionDays)

---

## 5. API Additions (`/api/v1/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/type-definitions` | List live type definitions |
| POST | `/type-definitions` | Create type definition (409 on duplicate name) |
| PATCH | `/type-definitions/:id` | Edit name/fieldType/schema (omits unset fields) |
| DELETE | `/type-definitions/:id` | Soft delete |
| POST | `/events/:eventId/things` | Attach or update a typed value (creates if missing) |
| DELETE | `/events/:eventId/things/:typeDefinitionId` | Soft delete the event thing |
| GET | `/events/:id` | Now also returns live `things` |
| GET | `/search?q=&limit=` | Search events + journals, returns `{ query, hits }` |
| POST | `/diagnostics/crash-reports` | Record a crash report (201) |
| POST | `/diagnostics/perf-samples` | Record a perf sample (201) |
| GET | `/diagnostics/crash-reports` | List crash reports |
| GET | `/diagnostics/perf-samples` | List perf samples |
| POST | `/diagnostics/prune?retentionDays=` | Prune records older than window (default 30 days) |

`GET /health` now reports `schemaVersion: 7` and `syncProtocolVersion: 3`.

---

## 6. Sync (`packages/sync`)

- `SYNC_PROTOCOL_VERSION` bumped from 2 to 3
- New entity types: `type_definition`, `event_thing`
- Push: `type_definition` saved via `typeDefinitionRepo.save`; `event_thing` saved via `eventThingRepo.save`
- Pull: deltas from `listModifiedSince` for both new repos, merged into the sorted record stream
- Diagnostics (`crash_reports`, `perf_samples`) is intentionally **not** synced — stays on device/server

---

## 7. Web App (`apps/web`)

| Screen | Contents |
|--------|----------|
| Event detail | Now renders typed thing values with type-definition labels and key/value chips |
| DayView | New `SearchBox` above today's timeline; debounced search, event/journal result list, empty/no-match states; selecting an event opens its detail |
| DayView header | New "Diagnostics" button |
| Diagnostics modal | Crash reports list, perf samples list with average duration, sample-crash / sample-perf actions, retention prune button; notes that data is never synced and never contains life-log content |

Design: dark theme, no emojis, matches `docs/web-design-spec.md`.

---

## 8. Benchmark

New baseline `docs/benchmarks/increment-5-server-baseline.json` (host `pc`, Node v24.22.2). Added metric:

| Metric | Target | Result |
|--------|--------|--------|
| Search 1000 events | < 15 ms | ~0.97 ms — Pass |

All targets pass; comparison vs `increment-4.1-server-baseline.json` shows no regression (no metric over 3x).

---

## 9. Quality Gate Checklist

| Gate | Rule | Status |
|------|------|--------|
| Type-check | `tsc -b` clean | Pass |
| Lint | All workspaces lint clean | Pass |
| Tests | 29 files, 218 tests, all green | Pass |
| Build | server bundle + web vite build succeed | Pass |
| Benchmark | New baseline recorded; no regression vs 4.1 | Pass |
| Release | Tag `v0.3.7-increment-3.5` pushed; GitHub release created; package built | Pass |
| Deploy | Package deployed to `zeserver`; `/health` reports schema 7 / protocol 3 | Pass |

---

## 10. Files Changed

**New:**
- `packages/domain/src/things.ts` — Things domain rules
- `packages/domain/src/search.ts` — Search hit, normalization, ranking
- `packages/domain/test/things.test.ts` — Things rules tests
- `packages/persistence/src/sqlite/type-definition-repository.ts`
- `packages/persistence/src/sqlite/event-thing-repository.ts`
- `packages/persistence/src/sqlite/search-repository.ts`
- `packages/persistence/src/sqlite/diagnostics-repository.ts`
- `packages/persistence/test/sqlite-things.test.ts`
- `apps/server/test/things.test.ts`
- `apps/server/test/search.test.ts`
- `apps/server/test/diagnostics.test.ts`
- `apps/web/src/components/SearchBox.tsx`
- `apps/web/src/components/Diagnostics.tsx`

**Modified:**
- `packages/domain/src/types.ts` — Thing entities, CrashReport, PerfSample
- `packages/domain/src/index.ts` — exports things.js, search.js
- `packages/persistence/src/interfaces.ts` — new repository interfaces
- `packages/persistence/src/sqlite/migrations.ts` — Migrations 6 and 7
- `packages/persistence/src/index.ts` — new repo exports
- `packages/sync/src/protocol.ts` — SYNC_PROTOCOL_VERSION → 3, new entity types
- `apps/server/src/app.ts` — Things API, search endpoint, diagnostics endpoints, sync v3 handling
- `apps/web/src/api.ts` — Things client, search client, diagnostics client
- `apps/web/src/components/EventDetail.tsx` — renders things
- `apps/web/src/pages/DayView.tsx` — SearchBox + Diagnostics wiring
- `docs/changelog.md` — Increment 5 entries
- `package.json` — version 0.3.6 → 0.3.7
- `packaging/PKGBUILD` — pkgver 0.3.7
- `packaging/.SRCINFO` — regenerated

**Release artifacts:**
- Tag `v0.3.7-increment-3.5` on `origin/main`
- GitHub release `v0.3.7-increment-3.5` (package, checksum, PKGBUILD, SRCINFO)
- `packaging/lifelogger-0.3.7-1-any.pkg.tar.zst` + `.sha256`

---

## 11. Deploy Verification on `zeserver`

| Check | Result |
|-------|--------|
| OS | Debian GNU/Linux 13 (trixie) |
| Deploy method | Manual (no `pacman` on Debian); package extracted to `/opt/lifelogger/releases/v0.3.7/`, `current` symlink → v0.3.7 |
| Service | `lifelogger.service` installed from package, active + enabled |
| `GET /health` (HTTPS) | `{"status":"ok","database":"connected","version":"0.3.7","schemaVersion":7,"syncProtocolVersion":3}` |
| HTTPS URL | `https://zeserver.taile544af.ts.net/` (tailnet only) |
| Database | `/var/lib/lifelogger/life.db`, schema 7 |

Note: The `packaging/install-release.sh` script could not be used as-is because `zeserver` is Debian (no `pacman`). The package was deployed manually following the release layout. The script remains correct for Arch hosts.

---

## 12. Next Steps

Increment 5 is complete. Per the roadmap, the next increment returns to Phase B of the design doc (state of mind: `Dimension`, `Observation`, one-tap check-in, review step). The T5 deploy drill from Increment 4.1 remains pending on `zeserver` (user-run; SSH was unreachable from this environment during this increment) and should be completed when `zeserver` is reachable.

---
