# Life Logger — Changelog

Incremental, task-level entries. Format: date, increment, task, change, gate status.

## Increment 5 — Things, Search and Diagnostics

### T1 — Things typed dynamic events (2026-11-17)

- Added `TypeDefinition`, `TypeInstance` and `EventThing` domain entities; Things rules in `packages/domain/src/things.ts` (`validateTypeDefinitionDraft`, `validateTypeInstance`, `buildEventThing`).
- Added migration 6: `type_definitions` and `event_things` tables with foreign keys to events/type definitions and a partial unique index on live (event_id, type_definition_id) pairs.
- Added `SqliteTypeDefinitionRepository` and `SqliteEventThingRepository`; sync deltas via `listModifiedSince`.
- Sync protocol bumped to 3 with `type_definition` and `event_thing` entity types.
- Server API: `GET/POST/PATCH/DELETE /api/v1/type-definitions`, `POST /api/v1/events/:eventId/things`, `DELETE /api/v1/events/:eventId/things/:typeDefinitionId`, `GET /api/v1/events/:eventId` returns live things.
- Web: type definition + event thing API client methods; event detail renders typed thing values.
- Commits: `d5f3894` (stage 1), `9caf420` (stage 2), `644747e` (stage 3), `06a34b0` (stage 4).
- Gates: typecheck, lint, tests (209), build green.

## Increment 4.1 — Completion and Hardening

### T1 — Alias uniqueness (2026-11-17)

- Added migration 5: unique index on lowercase live alias across all people; pre-check aborts on cross-person duplicates (case-insensitive).
- `SqlitePersonAliasRepository.findByAlias` now matches case-insensitively; `save` throws on cross-person duplicate.
- `resolvePersonToken` accepts an aliases map; ambiguity detection kept for names.
- `PUT /api/v1/people/:id/aliases` maps conflict to 409.
- Tests: alias contract cases, migration 5 cases, domain token cases.

### T2 — Domain test coverage (2026-11-17)

- Added unit tests for `edits.ts` and `templates.ts`.
- Bug fixes exposed by tests: `patchTemplate` now clears fields set to `null`; `defaultTemplateId` lowercases before slugifying; `applyEventPatch` compares `endAt` against the event's existing `startAt`.

### T3 — Behaviors the report does not confirm (2026-11-17)

- Fixed template log scoping bug (`resolvedDayId` out of scope) and Day-time optimistic-concurrency skip (fresh `updatedAt` on overwrite).
- Template log response now includes the Day record plus previous wake/sleep times.
- Added `GET /api/v1/suggestions/:id`.
- Point events created by templates set `endPrecision: 'unknown'`.
- Undo semantics: soft-deleting a point event clears the anchored Day time; restoring re-applies it.

### T4 — Benchmark and budgets (2026-11-17)

- Added benchmark cases: single event patch, timeline load with 1,000 events, tag rename with 500 descendants, template log flow.
- New baseline: `docs/benchmarks/increment-4.1-server-baseline.json`. All 15 targets pass; no regression vs increment-3.9-server baseline.

### T5 — Deploy drill on `zeserver` (2026-11-17)

- Pending user-run drill: build release, install, confirm schema 5, roll back, reinstall.

### T6 — Docs and report corrections (2026-11-17)

- Corrected increment-4 completion report (A6 partly done, daily use deferred, alias uniqueness line, test count, benchmark status).
- Updated frontend handoff (version, schema, API surface, Android deletion note).

## Increment 4 — Close the Daily Loop (2026-11-16)

- Event edit/delete/restore, suggestion edit/accept, tag & people management, templates, web redesign. Committed as `6fbd03e`; report commit `922d5f4`.
- Migration 4 (schema 3 → 4): templates, template_tags, person_aliases; event/tag/person archive support.
- Sync protocol 2, new entity types.

## Increment 3.9 — Fixes and Hardening (2026-11-15)

- HTTPS via `tailscale serve`, off-machine backups, Debian deploy path, reboot/upgrade drills, benchmark, web design spec; daily use started then deferred in 4.1.
