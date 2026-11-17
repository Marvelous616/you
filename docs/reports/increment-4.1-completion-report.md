# Increment 4.1: Completion and Hardening — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 4.1 — Completion and Hardening
> **Date:** November 16–17, 2026
> **Git Commit:** `9ec87b0` (pushed to `origin/main`; T6 docs at `70d78d5`)
> **Tag:** `v0.3.6-increment-3.5`
> **Status:** T1–T4 and T6 complete; T5 deploy drill pending (user-run, SSH to `zeserver` unreachable from this environment)

---

## 1. Executive Summary

Increment 4.1 hardens the closed daily loop from Increment 4. It adds case-insensitive global alias uniqueness with migration 5 (with a pre-check that aborts before mutating when duplicates exist), fixes several bugs surfaced by new domain tests (template log scoping, day-time optimistic concurrency, event PATCH `endAt`), extends the server benchmark with four new cases and records a new baseline, and updates reports, handoff, changelog and spikes docs.

Type-check, lint, tests and build are all green after the typecheck gate fixes (`9ec87b0`). The remaining item, T5 (deploy drill on `zeserver`), is user-run and could not be executed from this environment because SSH to `zeserver` times out.

Increment 5 (Things, full-text search, Diagnostics) begins next.

---

## 2. Work Packages Completed

| WP | Task | Result |
|-----|------|--------|
| T1 | Migration 5: alias uniqueness across all people (case-insensitive); repo conflict handling; 409 mapping; tests | Done (`c327bd3`) |
| T2 | Domain tests + bug fixes: `patchTemplate` null-clear, `defaultTemplateId` lowercase, `applyEventPatch` `endAt` | Done (`a2419a6`) |
| T3 | Template-log scoping fix; day-time optimistic-concurrency fix; log response day + previous times; `GET /suggestions/:id`; undo semantics; server tests | Done (`181b3d6`) |
| T4 | Benchmark: event patch, 1000-event timeline, tag rename 500 descendants, template log; new baseline `increment-4.1-server-baseline.json`; all 15 targets pass, no regression vs 3.9 | Done (`e50473e`) |
| T5 | Deploy drill on `zeserver` | Pending — user-run; SSH to `zeserver` unreachable from this environment |
| T6 | Report / handoff / changelog / spikes updates; `docs/changelog.md`, `docs/spikes.md` created | Done (`70d78d5`) |
| Gate fixes | events-PATCH scoping bug, timezone fix, unused imports/timestamp removals, persistence patch/repo fixes | Done (`9ec87b0`) |

Total: ~10 focused days across T1–T6 plus gate fixes.

---

## 3. Domain (`packages/domain`) — Tests and Fixes

Added domain-level tests covering templates and edits, which exposed and fixed three bugs:

| Bug | Fix |
|-----|-----|
| `patchTemplate` left fields unchanged when set to `null` | Null now clears the field |
| `defaultTemplateId` slugified before lowercasing, leaving uppercase fragments | Lowercased before slugifying |
| `applyEventPatch` compared `endAt` against the *new* start time instead of the event's existing one | Compared against existing `startAt` |

No new entities; all changes were to existing `Template`, `Tag`, `Person`, `Event` handling.

---

## 4. Persistence (`packages/persistence`) — Migration 5

| Change | Detail |
|--------|--------|
| `person_aliases` live alias uniqueness | Unique index on `LOWER(alias)` across **all** live people (case-insensitive, global) |
| Migration pre-check | Finds any live aliases that collide case-insensitively across people; aborts before applying if any exist, leaving the DB unchanged |

Migration 4 (from Increment 4) already created the `person_aliases` table; migration 5 adds the uniqueness constraint. Tested from empty DB and from a copy of the 3.9 production database.

---

## 5. API Additions (`/api/v1/`)

| Method | Endpoint | Added in |
|--------|----------|----------|
| GET | `/suggestions/:id` | T3 — fetch a single suggestion including `externalId` |

The `PATCH /suggestions/:id` endpoint already existed (Increment 4); the web app now uses it for edits.

Server fixes: events-PATCH scoping bug (`updated` referenced outside its `try`), timezone handling, persistence patch/repository fixes.

---

## 6. Sync (`packages/sync`)

- `SYNC_PROTOCOL_VERSION` remained 2 (unchanged in this increment)
- No new entity types; existing sync contract covered the fixed behaviors

---

## 7. Web App (`apps/web`)

No new screens in this increment. Existing screens (Event detail, Suggestion edit, Settings tags/people/templates, Today) all use the fixed behaviors (undo semantics, template log with previous wake/sleep times, suggestion `GET /:id`).

---

## 8. Benchmark

New cases added (`increment-4.1-server-baseline.json`, host `Dainsleif`, Node v24.22.2):

| Metric | Target | Result |
|--------|--------|--------|
| Single event patch | < 15 ms | Pass |
| Timeline load 1000 events | < 100 ms | Pass |
| Tag rename 500 descendants | < 100 ms | Pass |
| Template log flow | < 25 ms | Pass |

All 15 targets pass; no regression vs the Increment 3.9 server baseline. New baseline recorded at `docs/benchmarks/increment-4.1-server-baseline.json`.

---

## 9. Quality Gate Checklist

| Gate | Rule | Status |
|------|------|--------|
| CI | Type-check, lint, unit + contract tests green on every push | Pass (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green via `9ec87b0`) |
| Contract suite | Alias uniqueness, migration 4/5 cases included | Pass |
| Migration | Tested from empty DB and copy of the 3.9 production DB | Pass (migration 5) |
| Benchmark | Run at end; baseline recorded | Pass — `increment-4.1-server-baseline.json`, no regression vs 3.9 |
| Upgrade + rollback | Deploy drill on `zeserver` | Pending — user-run, SSH unreachable from this environment |
| Restore drill | Not required | N/A |
| Daily use | Deferred until features proven | Pending — deferred per Increment 4.1 decision |

Final suite: 195 tests across 24 files (25 files / 198 tests before the FK fix), type-check clean, lint clean, web build succeeds (~191 KB JS gzipped, ~14.41 kB CSS).

---

## 10. Files Changed

**New:**
- `docs/changelog.md` — incremental task-level changelog
- `docs/spikes.md` — spike records
- `packages/persistence/test/sqlite-things.test.ts` — Things persistence tests (added late as Increment 5 stage-1 prep; kept here as it was committed at the end of 4.1 work)

**Modified:**
- `packages/domain/src/edits.ts` — `patchTemplate` null-clear, `defaultTemplateId` lowercase
- `packages/domain/src/templates.ts` — `applyEventPatch` `endAt` fix
- `packages/domain/test/` — new template and edits domain tests
- `packages/persistence/src/sqlite/migrations.ts` — Migration 5
- `packages/persistence/src/sqlite/event-repository.ts` — patch/repo fixes
- `packages/persistence/src/sqlite/person-alias-repository.ts` — conflict handling, 409 mapping
- `packages/persistence/src/sqlite/template-repository.ts` — scoping fixes
- `packages/persistence/src/sqlite/day-repository.ts` — optimistic-concurrency fix
- `packages/persistence/src/index.ts` — new repo exports
- `packages/persistence/src/interfaces.ts` — new repo interfaces
- `apps/server/src/app.ts` — events-PATCH scoping fix, timezone fix, `GET /suggestions/:id`
- `apps/server/test/operations.test.ts` — schemaVersion 5
- `docs/reports/increment-4-completion-report.md` — corrected A6 (partly done)
- `docs/frontend-handoff.md` — version, schema, API surface, Android deletion note
- `docs/benchmarks/increment-4.1-server-baseline.json` — new baseline
- `docs/benchmarks/bench-current.json` — current baseline copy

---

## 11. Open Questions

1. Deploy drill T5 on `zeserver` — user-run; could not be executed from this environment (SSH times out). Needs to be run by the owner from a machine that can reach `zeserver`.
2. Daily use (14-day dogfood) — deferred until Increment 5 features are in.

---

## 12. Next Steps

Increment 4.1 is complete except for the user-run deploy drill. Begin Increment 5 (Things, full-text search, Diagnostics) per `Increment 5 - Things, Search and Diagnostics.md`, then return to T5 once `zeserver` is reachable.

---
