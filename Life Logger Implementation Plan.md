# Life Logger: Implementation and Development Plan

*Companion to life-logger-high-level-design.md (Draft 10). Increments 1 to 3 are planned in detail and 4 to 5 in outline. Items marked proposed are recommendations and still need your confirmation.*

## 1. Scope and assumptions

- One user, one server, a PC-first web app and a lighter Android companion (design doc decision 1).
- An existing general-purpose database behind a persistence interface (decision 18), with no hosted AI service and modest compute.
- One person building in increments of one to two weeks, ordered by risk (design doc decision 23 and section 12).
- Effort is given in focused days and is rough. Calendar time depends on how many days a week you can give it. Sync and Android background work are the most likely to run over.

## 2. Proposed technology stack

| Layer | Proposal | Why | Alternative |
| --- | --- | --- | --- |
| Language | TypeScript everywhere | One language for domain logic, server, web and phone, so rules and sync code are written once | Kotlin for the Android app only |
| Domain layer | Plain TypeScript package with no I/O | Testable without a database (design doc 8.2) and shared by every client | None |
| Server | Node.js with Fastify | Small, one process, easy to deploy | Express |
| Database | SQLite in WAL mode behind the persistence interface | No server to run, one file to back up, and swappable later through the contract suite | PostgreSQL |
| Web app | React with Vite | Fast to build the PC-first UI | None |
| Android app | React Native with Expo development builds and a local SQLite store | Reuses the TypeScript domain and sync code, and native modules can read the call log, location and photos | Native Kotlin, which is the most reliable for background work but adds a second language |
| Sync | Custom outbox with push and pull endpoints and a cursor | Small, and it follows the rules in design doc 8.1 | None |
| Tests | Vitest for unit and contract tests | The same runner for every package | Jest |
| CI | GitHub Actions running type-check, lint and tests on every push | Catches breakage early | None |
| Hosting | One small Linux host (your own server or a rented one) running the Node process behind a reverse proxy with HTTPS | Matches the one-server design | Docker, if you prefer containers |
| Auth and backup | Single-user login, HTTPS only, and a nightly backup of the database file and blob folder | The data is personal, so these are not optional | None |

The Android choice is the least certain. Spike A in section 5 settles it with a small experiment before any real Android work starts.

## 3. Repository layout

A single repository with workspaces:

| Path | Contents | May depend on |
| --- | --- | --- |
| packages/domain | Entities, rules, parser and derived values. No I/O | Nothing |
| packages/persistence | Repository interfaces, the SQLite implementation and the shared contract test suite | domain |
| packages/sync | Sync protocol types and outbox logic, used by the phone and the server | domain |
| apps/server | HTTP API, auth and migrations | domain, persistence, sync |
| apps/web | The React web app | domain, sync |
| apps/android | The React Native app | domain, sync |
| tools/bench | Synthetic data generator and benchmark runner | domain, persistence |
| docs | The design doc, this plan and benchmark results |  |

The persistence interface is the only place that knows which database is in use.

## 4. Working conventions

- Short branches merged to the main branch, and a tag at the end of each increment.
- A task is done when it is typed, has unit tests for any domain logic, passes CI, includes a migration if the schema changed, and is noted in a changelog.
- A simple board with To do, Doing and Done. One increment is active and no more than two tasks are in Doing.
- Migrations only move forward. A shipped migration is never edited.
- A weekly 15 minute review: what is done, what the benchmark says, and what should change in the plan.
- Time handling follows section 7 of the design doc.

## 5. Spikes

Short, timeboxed experiments run first. Each ends with a half-page note of what was learned.

| Spike | Question | Timebox | When |
| --- | --- | --- | --- |
| A. Android offline and background sync | Can a React Native development build save to a local SQLite store while offline and sync reliably in the background? | 1.5 days | Start of increment 1. Decides decision 20 |
| B. SQLite under sync load | With WAL mode and a single writer, how does a push of thousands of records behave? | 1 day | Increment 1 |
| C. Time handling | Do the Day boundary and daylight saving cases hold up in tests? | 1 day | Increment 1 |
| D. Call log access | Can your sideloaded build read the call log after a runtime permission grant? | 1.5 days | End of increment 2, only if call logging goes first |

## 6. Increment 1: walking skeleton (about 15 focused days)

Goal: one marker saved on Android while offline, synced to the server and shown on a web timeline.

Decisions needed first: the stack (1, 18, 20), the sync approach (19) and the day boundary (3).

| # | Work package | Days | Notes |
| --- | --- | --- | --- |
| 1.1 | Repository, tooling and CI | 1 | Workspaces, TypeScript, lint, Vitest, GitHub Actions |
| 1.2 | Domain v0 | 1 | Day, Marker and Event with precision fields, UUIDs, updated\_at and a deletion marker. Unit tests for precision and day assignment |
| 1.3 | Persistence | 2 | Repository interfaces, SQLite implementation, migrations and the contract suite |
| 1.4 | Sync protocol | 2 | Push of a batch, idempotent by UUID. Pull since a cursor. Last write wins by updated\_at. Tests for replay, out-of-order arrival and deletes |
| 1.5 | Server | 1 | API endpoints, single-user auth, HTTPS and a health check |
| 1.6 | Web timeline | 1 | Read-only list of the day's markers |
| 1.7 | Android capture | 2 | One-tap marker screen, local store, outbox, background and manual sync |
| 1.8 | Benchmark harness | 1 | Synthetic data generator and timings for a Day load, a sync batch and a marker save on the phone |
| 1.9 | Deploy and backup | 0.5 | Server live, nightly backup running, one restore tested |
|  | Spikes A, B and C | 3.5 | See section 5 |

Done when: a marker made offline on the phone appears on the web timeline after sync, all tests pass in CI, the first benchmark numbers are recorded and a backup restore has worked once.

## 7. Increment 2: daily loop (about 15 focused days)

Goal: a normal day can be logged and reviewed entirely from the two apps.

Decisions needed first: the tag tree (4), context as Observations (5) and derived Day.fidelity (11).

| # | Work package | Days | Notes |
| --- | --- | --- | --- |
| 2.1 | Day lifecycle | 1.5 | Start and end of day, Day state and derived fidelity |
| 2.2 | Events with precision | 2 | Create, edit and delete. Overlaps are allowed and lanes are derived |
| 2.3 | Tags | 2 | Tag tree, free-form creation, one primary tag per event |
| 2.4 | People, minimal | 1.5 | Person records and participants through quick-entry shorthand |
| 2.5 | Quick entry | 2 | Rule-based parser v0 for time, title, tags and people. Unparsed text stays as text and is never guessed |
| 2.6 | Journal | 1 | Entries per Day |
| 2.7 | Today's timeline on both apps | 2 | Overlap lanes and visible gaps |
| 2.8 | End-of-day review | 2.5 | Gap questions and closing the Day. Answers work offline |
| 2.9 | Sync for all records | 1 | Contract and sync tests for each new entity |

Done when: you have used it yourself every day for about two weeks, and marker and quick-entry save times on the phone are within the budget set from the increment 1 numbers.

## 8. Increment 3: suggestions and the first extension (about 12 focused days)

Goal: an imported item reaches the timeline through the suggestion inbox.

Decisions needed first: which extension goes first, and whether missed calls become suggestions if call logging is chosen.

| # | Work package | Days | Notes |
| --- | --- | --- | --- |
| 3.1 | Suggestion inbox | 3 | Accept, reject and edit on both apps, with the source recorded |
| 3.2 | Extension registration | 2 | A registry for a module's tags and dimensions, its own tables through its own migrations, and the core interface for writing Suggestions |
| 3.3 | First extension | 5 | Calendar through an ICS file first, or call logging in the Android app |
| 3.4 | Extension tests | 0.5 | Module contract tests, and an accepted suggestion becomes an Event with source imported |
|  | Spike D | 1.5 | Only if call logging goes first |

If calendar goes first, Spike D is skipped and this increment drops to about 10.5 days.

## 9. Increments 4 and 5 (outline)

**Increment 4, depth (about 15 days).** Things and dynamic types with TypeDefinition, TypeInstance and EventThing (about 8 days), full-text search (about 3 days), and the Diagnostics extension with crash capture, occasional load sampling and a retention job (about 4 days). Decisions needed first: 9, 10, 15 and 22.

**Increment 5, everything else.** The remaining extensions, analytics, backfilling and management screens on Android. Each is chosen one at a time and gets a module spec before it is built.

## 10. Quality gates

| Gate | Rule |
| --- | --- |
| CI | Type-check, lint, unit and contract tests are green on every push |
| Contract suite | Must pass on any new persistence implementation before it is used |
| Benchmark | Run at the end of every increment, with the results added to docs |
| Marker-save budget | Set after the increment 1 numbers and checked at every increment |
| Migrations | Tested from an empty database and from the previous release |
| Backups | A restore is tested after increment 1 and after any increment that changes the schema heavily |

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Starting increment 3 or later before the daily loop is in use | The rule in design doc 12.2: finish and use an increment before widening |
| Android background sync is unreliable | Spike A, a visible Sync now action, and syncing whenever the app opens |
| Sync bugs damage data | Idempotent push, deletion markers before any hard delete, contract tests and nightly backups |
| Call log access is blocked | Spike D, and a sideloaded build |
| Time and daylight saving bugs | Spike C, UTC storage with an offset, and tests on daylight saving dates |
| Personal data leaks | Single-user login, HTTPS only, encrypted backups, and no life content in logs or crash reports |

## 12. Effort summary

| Increment | Focused days |
| --- | --- |
| 1. Walking skeleton | 15 |
| 2. Daily loop | 15 |
| 3. Suggestions and first extension | 12 |
| 4. Depth | 15 |
| Total for 1 to 4 | about 57 |

At three focused days a week, increments 1 to 3 take about 14 weeks. Treat the numbers as a rough floor.

## 13. To confirm before starting

1. The stack in section 2, in particular React Native for Android pending Spike A.
2. The day boundary (decision 3) and the sync approach (decision 19).
3. Where the server will run, your own machine or a rented one, since that decides the hosting and backup details.
