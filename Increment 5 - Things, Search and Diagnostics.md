# Increment 5: Things, Search and Diagnostics

*Follows Increment 4.1: Completion and Hardening (commit `9ec87b0`). Next increment in the roadmap: Phase B of the design doc (state of mind) comes later; this increment takes the "depth" items that were deferred.*

## 1. Why this increment exists

Increment 4 closed the daily loop. The Increment 4.1 completion report closed the loop on verification (T1–T6 done, deploy drill pending).

The Increment 4 outline called the remaining depth work **Increment 4, depth**: Things and dynamic types (TypeDefinition, TypeInstance, EventThing), full-text search, and the Diagnostics extension. The roadmap then split those into **Increment 5** ("everything else" in the plan's outline), with its migrations numbered to start at 6 (Migration 5 was consumed by Increment 4.1, task T1).

This increment exists so those three deferred capabilities are built, tested and documented one at a time.

## 2. Goal

Add three independent capability tracks on top of the closed daily loop:

1. **Things** — runtime-creatable typed fields (TypeDefinition, TypeInstance, EventThing).
2. **Full-text search** — search over event titles, notes and journal entries.
3. **Diagnostics** — crash capture, occasional load sampling, retention job.

Increment 5 is done when all three tracks have their domain, persistence, sync, API, web and test coverage, and the benchmark/regression gates still pass.

## 3. Using this doc with opencode

Same protocol as Increment 4.1: one task per session and branch, failing test first, then fix, then `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. A task is not done until all four pass.

## 4. Decisions needed first

| # | Decision | Proposal |
| - | --- | --- |
| D1 | Things storage shape | `TypeDefinition` rows plus `EventThing` rows linked to events, or a single JSON blob per event? Proposed: typed definitions in their own tables, thing instances linked to events (keeps sync and migrations first-class). |
| D2 | Search scope | Event titles + notes + journal bodies, ranked. Proposed: title prefix/body match via SQLite FTS or LIKE; decide FTS5 vs LIKE after a quick benchmark. |
| D3 | Diagnostics data retention | Raw diagnostics kept for a fixed window, then pruned; timeline tables never written. Proposed: 30 days retention. |
| D4 | Increments per track | One increment per track (Things, Search, Diagnostics) or one combined increment? Proposed: combined as written here, split later only if a track stalls. |

D1 needs migration 6; D2 and D3 need no new timeline tables (search may add an index).

## 5. Scope

**In scope**

- Things: entity types, migration, repositories, API, sync, web display, tests.
- Full-text search: API endpoint + web search UI over the existing timeline data.
- Diagnostics: capture hook, sampling, retention job, no writes to timeline tables.

**Out of scope**

- Phase B (state of mind: `Dimension`, `Observation`, check-ins).
- Analytics dashboards, backfilling, Android management screens (see plan section 9, Increment 5 outline).
- Anything that writes to the timeline from automated sources.

## 6. Tasks

### T1. Things: typed dynamic events (8 days)

- Add `TypeDefinition`, `TypeInstance`, `EventThing` domain entities and rules.
- Migration 6; repositories; sync entity types; API; web rendering; tests.

### T2. Full-text search (3 days)

- Search endpoint over events/notes/journals; web search box; tests; benchmark.

### T3. Diagnostics (4 days)

- Diagnostics capture, sampling, retention; tests; benchmark.

## 7. Quality gates and definition of done

- Type-check, lint, unit + contract tests green; migration 6 tested from empty DB and from the 5-database; benchmark regression; changelog entries; docs updated.

## 8. After this increment

With Increment 5 done, the "depth" items are complete and the roadmap returns to Phase B (state of mind) and the remaining "everything else" items.
