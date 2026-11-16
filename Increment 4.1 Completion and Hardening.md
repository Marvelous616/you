# Increment 4.1: Completion and Hardening

*Follows Increment 4: Close the Daily Loop (commit `6fbd03e`). Written to be handed to a coding agent in opencode, one task at a time. Web and server only. About 2 focused days. Items marked proposed still need your confirmation.*

## 1. Why this increment exists

The Increment 4 completion report shows the work is built and the 144 existing tests pass. It also shows gaps between the report and the spec:

- Work package A6 was meant to cover spike write-ups, a corrected handoff doc, budgets set from real numbers and a benchmark. The report's A6 covers tests, typecheck and build. The benchmark and the deploy drill are still pending.
- Alias uniqueness is per person in the report, but the spec says unique across all people.
- The report does not say how many tests were added for the new domain code and repositories.
- Three behaviors from the spec are not confirmed by the report: wake and sleep templates, the suggestion re-proposal rule after a delete, and quick-entry alias resolution.
- Three open questions are still unanswered.
- The report's Next Steps says daily use starts now, but you chose to defer it until the planned features are in.

This increment closes those gaps and nothing else, the same way 3.9 did for Increment 3.

## 2. Goal

Increment 4 is verified, not just built. Every behavior the spec promised has a test that proves it, the benchmark and the deploy drill have been run on `zeserver`, and the docs match the code.

## 3. Using this doc with opencode

### 3.1 Set up the rules once

opencode reads an `AGENTS.md` file at the repo root as standing instructions. Add or extend a section like this so every task starts with the project rules:

```
## Life Logger rules
- TypeScript everywhere. The domain package is pure: no I/O.
- Only the persistence package knows which database is used.
- Migrations only move forward. Never edit a shipped migration; add a new one.
- Automated sources only create Suggestions. Only accept creates an Event.
- No emojis in the UI. Dark theme. No hosted AI services.
- Single user. Do not add accounts, roles or multi-tenant code.
- A task is done when it is typed, has unit tests for domain logic, passes CI,
  includes a migration if the schema changed, and is noted in the changelog.
- Do not rename shipped tables or columns.
- Do not touch code outside the task's listed files unless a test requires it.
```

### 3.2 Run one task per session

1. Start a fresh session and a branch for each task (`git switch -c inc-4.1-t1`).
2. Paste the task from section 6 as the prompt, plus its acceptance criteria.
3. Ask the agent to write the failing test first, then the fix, then run the checks in 3.3.
4. Review the diff yourself before merging. Do not let the agent merge or push on its own.

### 3.3 Checks to run after every task

Use the repo's actual script names. If these differ, tell the agent to look them up in the root `package.json` first and not guess.

```
npm run typecheck
npm run lint
npm test
npm run build
```

A task is not done until all four pass.

## 4. Decisions needed first

| # | Decision | Proposal |
| --- | --- | --- |
| D1 | Alias uniqueness | Unique across all live people, compared without case (proposed), as the Increment 4 spec says. This needs migration 5 |
| D2 | Event with `endAt` equal to `startAt` | Keep it rejected, with the message "leave the end empty for a point event" (proposed). Update the spec to say `endAt` must be after `startAt` |
| D3 | Archived tag on an old event | Show it on the event and keep it removable. Offer it in pickers only when it is already on that event (proposed) |
| D4 | Template reordering | Keep the simple up and down buttons (proposed) |
| D5 | API key in the General settings tab | Server only, not shown in the web app (proposed) |
| D6 | Second wake or sleep tap on the same Day | The tap succeeds and replaces the time. The web app asks "Wake time is already 07:10. Replace?" before sending (proposed) |

D1 adds a migration, so Increment 5's migrations now start at 6. Update the Increment 5 doc when D1 is accepted.

## 5. Scope

**In scope**

- The six tasks in section 6.
- Doc corrections: the completion report, the handoff doc, the changelog.

**Out of scope**

- New features, new screens and new endpoints.
- Observations and state of mind, which are Phase B of the roadmap.
- Things, search and diagnostics, which are Increment 5.
- Merging tags and people.
- The Android app.

## 6. Tasks

Each task lists what to change, what proves it, and what the agent must not do. File paths come from the completion report. If a path does not exist, the agent should find the real one and say so.

### T1. Alias uniqueness (0.5 day)

**Change**

- Add migration 5 in `packages/persistence/src/sqlite/migrations.ts`. Before creating the index, the migration finds live aliases that collide across people, compared without case. If any exist, it stops with an error listing each alias and the people involved, and changes nothing.
- Add a unique index on the lowercase alias for rows where `is_deleted` is false, across all people.
- In `packages/persistence/src/sqlite/person-alias-repository.ts`, make `findByAlias` match without case and return a clear conflict error on a duplicate save.
- In `packages/domain/src/edits.ts`, make `resolvePersonToken` take the aliases as an argument and resolve a token against names and aliases. Keep ambiguity detection for names.
- In `apps/server/src/app.ts`, map the conflict error on `PUT /people/:id/aliases` to a 409 with the conflicting alias in the message.

**Acceptance**

- A contract test saves the same alias for two people and gets a conflict. The same alias differing only in case also conflicts.
- A deleted alias can be reused.
- A migration test runs migration 5 on an empty database, on a copy of the 3.9 production database, and on a database with a deliberate duplicate, which must fail with the listed names.
- A unit test shows quick entry resolving `@alias` to the right person, and returning an ambiguity for a name shared by two people.

**Do not** edit migration 4.

### T2. Domain test coverage (0.5 day)

**Change:** add unit tests in `packages/domain` for `edits.ts` and `templates.ts`. Do not change behavior except to fix a bug a test exposes, and list any such fix in the pull request.

**Acceptance:** the tests cover at least these cases.

- `applyEventPatch`: a title of 201 characters is rejected, notes of 5,001 characters are rejected, an empty title after trimming is rejected, and `endAt` equal to or before `startAt` is rejected with the D2 message.
- `applyEventPatch`: the event's `source` is unchanged by an edit, and removing the primary tag promotes the next tag or leaves none.
- `reassignDay`: an edit that crosses the logical day boundary moves the event to the correct Day. Include the daylight saving change dates for the Asia/Kolkata and one DST timezone.
- `recomputeTagPaths`: renaming a parent updates all descendants, including a three-level tree.
- `wouldCreateCycle`: moving a tag under itself and under its descendant is rejected, and a valid move is accepted.
- `templateToEventDraft`: a duration sets the end, no duration gives a point event, and a `wake` or `sleep` template ignores tags and duration and gives a point event.
- `defaultStarterTemplates`: returns the five starters with no duplicates.

The agent should print the number of tests added in the pull request description.

### T3. Behaviors the report does not confirm (0.5 day)

**Change:** add integration tests against the server in `apps/server`. Fix whatever they find.

**Acceptance**

- Deleting an event created from an accepted suggestion keeps the suggestion's `external_id`. Importing the same `.ics` file again does not propose that item. Restoring the event also leaves it unproposed.
- `POST /templates/:id/log` with a `wake` template creates a point event and sets the Day's `wakeAt` to the same instant. A `sleep` template does the same for `sleepAt`. The response contains both the event and the Day.
- A second wake log on the same Day succeeds and replaces `wakeAt` (D6). The web app shows the confirmation before sending.
- The undo after a one-tap template deletes the event it created, and restoring brings it back. For a `wake` template, undo also restores the Day's previous `wakeAt`.

The last point may need a small change: the log response should return the previous Day time so the client can undo it. If it does not today, add it.

### T4. Benchmark and budgets (0.5 day)

**Change:** run the harness in `tools/bench` and compare against the last baseline in `docs/benchmarks/`.

**Acceptance**

- A new baseline JSON file is committed in `docs/benchmarks/`.
- New cases are added: `PATCH /events/:id`, loading a timeline with 1,000 events, renaming a tag that has 500 descendants, and logging from a template.
- The regression comparison passes, or any regression is explained in the pull request.
- The marker-save and quick-entry budgets are set from the measured numbers, with the figures written in the report.

### T5. Deploy drill on `zeserver` (0.25 day)

This task is run by you, not the agent. The agent can prepare the commands.

1. Build the release with `packaging/debian/build-release.sh` and copy the tarball to the server.
2. Install it with `packaging/debian/install-release.sh <tarball>` and check `GET /health`.
3. Confirm the database is at schema 5 and that existing days, events and tags are intact.
4. Roll back to the previous release, check `/health` again, then install again.
5. Record versions, schema numbers and times in the report.

### T6. Docs and report corrections (0.25 day)

**Change**

- Correct `docs/reports/increment-4-completion-report.md`: mark A6 as partly done until T4 and T5 finish, replace "Daily use should start now" with "Daily use is deferred until the planned features are in", correct the alias uniqueness line after T1, and fill in the number of new tests.
- Update `docs/frontend-handoff.md`: version, schema number, the new API endpoints, the Increment 4 status, and the Android deletion note.
- Add changelog entries for every task.
- Write the spike A to D notes from the existing reports, half a page each, in `docs/`. If a spike has no source material, say "not run" and do not invent results.

**Acceptance:** the handoff doc and the report agree with the code and with each other, and no text in them contradicts the Increment 4 spec.

## 7. Quality gates and definition of done

| Gate | Rule |
| --- | --- |
| CI | Type-check, lint, unit and contract tests green on every push |
| New tests | Count reported, with every case in T1 to T3 present |
| Migration | Migration 5 tested as in T1 |
| Benchmark | New baseline committed, budgets set |
| Upgrade and rollback | T5 completed and recorded |
| Docs | T6 completed |
| Daily use | Still deferred, as decided |

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The agent edits migration 4 to add the index | The AGENTS.md rule, and a CI check that the migration 4 file is unchanged from commit `6fbd03e` |
| Migration 5 fails on production because of a duplicate alias | The pre-check lists duplicates and aborts before any change, and the T5 drill runs on a backup copy first |
| The agent changes behavior while adding tests | One task per branch, and a diff review before merge |
| The agent invents script names or file paths | Look them up in the repo first, as stated in section 3.3 and section 6 |
| Spike notes are invented | The "not run" rule in T6 |

## 9. Open questions

1. Do you want a CI check that fails if a shipped migration file changes?
2. Should the benchmark run automatically in CI, or stay a manual step before each release?

## 10. After this increment

With 4.1 done, Increment 4 is verified. The next work is Phase B of the roadmap (state of mind) or Increment 5 (Things, search and diagnostics). Increment 5's migrations start at 6 once D1 is accepted.
