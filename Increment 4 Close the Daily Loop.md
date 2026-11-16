# Increment 4: Close the Daily Loop

*Companion to the Life Logger roadmap (Phase A), the implementation plan and the high-level design (Draft 10). Follows Increment 3.9, which is complete. Web and server only. Effort is in focused days and is rough. Items marked proposed still need your confirmation.*

## 1. Why this increment exists

The plan's Increments 2 and 3 promised a daily loop you can use every day. Going by the handoff doc and the web design spec, five pieces of that promise are still open:

- Events can be created but not edited or deleted. The API has `POST /events` and nothing else for events, though plan item 2.2 says create, edit and delete.
- Tags and people appear as chips but cannot be created or changed in the web app, though plan item 2.3 says free-form tag creation.
- Clicking an event does nothing. The event-detail slot in the design spec is a placeholder.
- A suggestion can be accepted or rejected but not edited first. The `PATCH /suggestions/:id` endpoint exists, but the web handler is a placeholder.
- The design's third input mode, one-tap quick-log templates, does not exist.

This increment finishes what is already half there, so a mistake made today can be fixed today. Real daily use is deferred until the planned features are in. Increment 5 adds Things, search and diagnostics.

## 2. Goal

You can fix any mistake from the web app: edit or delete an event, change a suggestion before accepting it, and create or change tags and people. You can log routine items with one tap.

## 3. Decisions needed first

| # | Decision | Proposal |
| --- | --- | --- |
| N1 | What deleting an event means | Soft delete with an `is_deleted` marker and a restore endpoint, never a hard delete (decided). This matches the existing deletion-marker rule |
| N2 | Deleting a tag | Allowed only when no event uses it. A tag in use can be archived, which hides it from pickers but keeps history (decided) |
| N3 | Merging duplicate tags and people | Out of scope. It belongs to design decision 12 (tag hygiene), which is still open (decided) |
| N4 | Deleting a person | The same rule as tags: delete only when unused, otherwise archive (decided) |
| N5 | Event edit history | Not kept, beyond a short undo after delete (decided). The design defers edit history apart from the sync minimum. Last write wins per record |
| N6 | Templates that set wake or sleep | A template can carry a `special` value of `wake` or `sleep`, which creates a point event and also sets the Day's time (decided) |
| N7 | Migration numbering | This increment adds migration 4. Things and search move to Increment 5, and its migrations start at 5 (proposed) |

## 4. Scope

**In scope**

- Event read, edit, delete and restore, in the API and the web app.
- Event detail view: title, times and precision, notes, tags (with the primary one), and people.
- Tag management: create, rename, recolor, move, archive and delete when unused.
- People management: create, edit, aliases, archive and delete when unused.
- Suggestion edit in the web app.
- Quick-log templates, with a starter set you can add with one click.
- A Settings screen that holds the tag, people and template screens.
- Housekeeping: spike write-ups, a corrected handoff doc, budgets set from real numbers, a benchmark run.

**Out of scope**

- Merging tags or people (N3).
- Edit history or undo beyond a short undo after delete (N5).
- Observations and state of mind, which are Phase B of the roadmap.
- Things, dynamic types, search and diagnostics, which are Increment 5.
- The Android app.

## 5. Domain additions (`packages/domain`)

The domain package stays pure TypeScript with no I/O.

### 5.1 New and changed entities

| Entity | Fields | Notes |
| --- | --- | --- |
| `Template` | `id`, `name`, `title`, `defaultDurationMinutes?`, `tagIds` (one flagged primary), `special?` (`wake`/`sleep`), `isPinned`, `sortOrder`, `createdAt`, `updatedAt`, `isDeleted` | Pre-fills a quick log |
| `PersonAlias` | `id`, `personId`, `alias`, `createdAt`, `updatedAt`, `isDeleted` | Lets quick entry resolve a nickname to one person |
| `Tag` (changed) | adds `archivedAt?` | Archived tags stay on old events |
| `Person` (changed) | adds `archivedAt?` | Same rule as tags |

No change to the `Event` table. Editing changes existing columns only.

### 5.2 Rules the domain package enforces

1. An event title is required after trimming and is at most 200 characters. Notes are at most 5,000 characters.
2. If `endAt` is set it is not before `startAt`.
3. Precision values stay `exact`, `approx` or `unknown`. Editing a time never raises its precision on its own, and an edit made by hand sets that time to `exact` only if you choose it.
4. An event keeps its original `source` (`live`, `backfill`, `prompted`, `imported`) when edited. The edit is not a new capture.
5. If an edit moves `startAt` into another logical Day, the event is reassigned using the existing day-assignment rule. Both Days' fidelity is derived again on read. Nothing is stored for overlaps, lanes or gaps.
6. An event has exactly one primary tag when it has any tag. Removing the primary tag promotes the next tag or leaves none.
7. A tag cannot become its own ancestor. A move that would create a cycle is rejected.
8. A tag's `path` is derived from its parent chain and name. Renaming or moving a tag recomputes the path of the tag and every descendant in one transaction.
9. A tag or person that any live event uses cannot be deleted, only archived.
10. A template with a `special` value ignores `tagIds` and duration. It always creates a point event with no end and also sets the Day's wake or sleep time.

### 5.3 Pure functions to add

- `applyEventPatch(event, patch)` returns the updated event or a list of validation errors.
- `reassignDay(event, days, timezone)` returns the Day an event belongs to after a time change.
- `recomputeTagPaths(tags, changedTagId)` returns the tags whose path changes.
- `wouldCreateCycle(tags, tagId, newParentId)` returns true or false.
- `templateToEventDraft(template, startAt)` returns the event to create, with the end set from the duration when there is one, or a point event when there is not.
- `resolvePersonToken(people, aliases, token)` returns a person, none, or an ambiguity.

## 6. Persistence (`packages/persistence`)

### 6.1 Migration 4 (schema 3 to 4)

A shipped migration is never edited, so this is a new forward-only migration.

| Change | Detail |
| --- | --- |
| `template` table | `id`, `name`, `title`, `default_duration_minutes`, `special`, `is_pinned`, `sort_order`, `created_at`, `updated_at`, `is_deleted` |
| `template_tag` table | `template_id`, `tag_id`, `is_primary`. One primary per template |
| `person_alias` table | `id`, `person_id`, `alias`, `created_at`, `updated_at`, `is_deleted`. Unique on live `alias` across people |
| `tag.archived_at` | Nullable timestamp |
| `person.archived_at` | Nullable timestamp |

### 6.2 Repository interfaces

- `EventRepository` gains `get`, `patch`, `softDelete` and `restore`.
- `TagRepository` gains `create`, `patch` (name, color, parent), `archive`, `unarchive`, `delete` and `countUsage`.
- `PersonRepository` gains `patch`, `archive`, `delete` and `countUsage`, plus alias methods.
- `TemplateRepository` is new, with the standard create, patch, list and soft-delete methods.

### 6.3 Contract tests to add

- Renaming a parent tag updates every descendant path atomically, and a failure leaves all paths unchanged.
- Moving a tag under its own descendant is rejected.
- Deleting a tag or person in use fails. Archiving succeeds and old events still read correctly.
- Soft-deleting an event removes it from timelines and keeps its tags and participants so a restore is complete.
- An alias is unique among live aliases.
- Migration 4 runs from an empty database and from a copy of the 3.9 production database.

## 7. API additions (`/api/v1/`)

All endpoints use the existing single-user API key. Validation errors return 400, a missing record 404, and a blocked delete or a tag cycle 409.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/events/:id` | One event with tags, people and capture |
| PATCH | `/events/:id` | Edit title, times, precision, notes, tags (with primary) and participants |
| DELETE | `/events/:id` | Soft delete |
| POST | `/events/:id/restore` | Undo a soft delete |
| GET | `/tags` | The tag tree, with usage counts and archived flags |
| POST | `/tags` | Create a tag, optionally under a parent |
| PATCH | `/tags/:id` | Rename, recolor or move |
| POST | `/tags/:id/archive` | Archive. `unarchive` reverses it |
| DELETE | `/tags/:id` | Delete when unused |
| GET | `/people?q=` | List people with usage counts and aliases |
| POST | `/people` | Create a person |
| PATCH | `/people/:id` | Edit details |
| PUT | `/people/:id/aliases` | Replace the alias list |
| POST | `/people/:id/archive` | Archive. `unarchive` reverses it |
| DELETE | `/people/:id` | Delete when unused |
| GET | `/templates` | List templates in sort order |
| POST | `/templates` | Create a template |
| PATCH | `/templates/:id` | Edit or reorder |
| DELETE | `/templates/:id` | Soft delete |
| POST | `/templates/:id/log` | Log from a template, with an optional `startAt`. Returns the new event, and the updated Day for `wake` and `sleep` |

`PATCH /suggestions/:id` already exists. The web app now uses it to change title, times, tags and people, and `accept` creates the event from the edited values. Responses of `GET /days/:id/timeline` do not change.

## 8. Sync (`packages/sync`)

- Event edits and deletes use the existing outbox, with last write wins by `updated_at`. A restore sets `is_deleted` to false with a new `updated_at`, so it wins over the earlier delete.
- `template`, `template_tag` and `person_alias` join the outbox and the pull protocol.
- A tag's `path` is treated as derived. On ingestion the server recomputes it from the parent chain and ignores the path sent by a client, so a rename arriving out of order cannot leave a stale path.
- Deleting an event that came from a suggestion keeps the suggestion's `external_id`, so the same calendar item is not proposed again.

## 9. Web app changes (`apps/web`)

The screens follow `docs/web-design-spec.md`: its tokens, no emojis, dark theme.

| Screen | Contents |
| --- | --- |
| Event detail | A drawer on wide screens and a full panel on narrow ones. Opens from a timeline block or an event row. Edit title, start and end with precision, notes, tags with a primary, and people. Delete asks once, then shows a short undo |
| Suggestion edit | A dialog with title, times, tags and people, saving through `PATCH` and accepting from the same dialog |
| Settings | A new screen with tabs: General, Tags, People, Templates |
| Settings: General | Server version and health, schema version and timezone. Nothing else yet |
| Settings: Tags | The tree, with create, rename, recolor, move, archive and delete when unused. Usage counts shown |
| Settings: People | List with search, details, aliases, archive and delete when unused |
| Settings: Templates | List with reorder and pin, an editor, and an "Add starter set" button |
| Today | A row of pinned templates above quick entry. One tap logs at the current time |

Behavior notes:

- Quick entry keeps its focus. Closing the drawer or a dialog returns focus to it.
- Escape closes the drawer. A dirty drawer asks before closing.
- A one-tap template shows a short confirmation with an Undo that calls delete and restore.
- The starter set is Wake up, Breakfast, Lunch, Dinner and Brush teeth. It is offered, never added without a click.
- Archived tags and people do not appear in pickers and quick-entry matching, but they still show on old events.

## 10. Work packages and schedule

| WP | Work | Days |
| --- | --- | --- |
| A1 | Event edit and delete: domain rules, migration 4 for archives, repositories, API, deletion markers and sync tests | 2 |
| A2 | Event detail view, wired to A1 | 2 |
| A3 | Settings screen, tag management and people management, with aliases | 2 |
| A4 | Suggestion edit dialog | 1 |
| A5 | Templates: entity, migration, API and pinned row, with the starter set | 1.5 |
| A6 | Housekeeping: spike write-ups, corrected handoff, budgets, benchmark | 0.5 |

The total is 9 days. A1 comes first because A2 and A4 depend on it. A3 and A5 are independent of A2 and can swap places if you prefer. A6 comes last so the budgets reflect the finished screens.

## 11. Quality gates and definition of done

A task is done when it is typed, has unit tests for any domain logic, passes CI, includes a migration if the schema changed, and is noted in a changelog. In addition:

| Gate | Rule |
| --- | --- |
| CI | Type-check, lint, unit and contract tests green on every push |
| Contract suite | Includes the cases in 6.3 |
| Migration | Tested from an empty database and from a copy of the 3.9 production database |
| Benchmark | Run at the end and added to `docs/benchmarks/`. Marker-save and quick-entry budgets are set from the measured numbers |
| Upgrade and rollback | Deployed as a new release with the install script, rolled back once, then deployed again |
| Restore drill | Not required, because the schema change is small. Run it anyway if anything in migration 4 grows |
| Daily use | Deferred. Daily use starts after the planned features are in, and budgets and notes are collected then |

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A tag rename leaves paths inconsistent | One transaction, server-side path recomputation on ingest, and a contract test |
| An edit moves an event across days and breaks review state | Day reassignment in the domain, derived fidelity, and tests on the day boundary and daylight saving dates |
| A delete loses data you wanted | Soft delete with restore and a visible undo |
| The drawer and dialogs slow down quick entry | The quick-entry focus rule and a benchmark check against the quick-entry budget |
| The increment grows into tag hygiene | Merge and alias cleanup stay out of scope (N3) |

## 13. Open questions

1. Should an archived tag still be offered when you open an old event that uses it?
2. Resolved: a template with no default duration logs a point event, which the model already supports as an event with no end.
3. Do you want to reorder templates by drag or with simple up and down buttons?
4. Should the General settings tab also hold the API key field, or stay on the server only?

## 14. After this increment

Phase B of the roadmap adds state of mind: the `Dimension` and `Observation` entities, a one-tap check-in, and a review step. Increment 5 (Things, search and diagnostics) follows, with its migrations numbered from 5.
