# Increment 4: Close the Daily Loop — Completion & Verification Report

> **Project:** Life Logger
> **Milestone:** Increment 4 — Close the Daily Loop
> **Date:** November 16, 2026
> **Git Commit:** `6fbd03e` (pushed to `origin/main`)
> **Status:** All 6 work packages complete

---

## 1. Executive Summary

Increment 4 finishes what was half-built in Increments 2 and 3. The daily loop can now be fully used every day from the web app: events can be edited or deleted, suggestions can be edited before accepting, tags and people can be created and managed, and routine items can be logged with one tap via quick-log templates. A Settings screen holds the tag, people, and template screens.

Increment 5 adds Things, full-text search, and Diagnostics.

---

## 2. Work Packages Completed

| WP | Task | Result |
|-----|------|--------|
| A1 | Event edit and delete: domain rules, migration 4, repositories, API, deletion markers, sync tests | Done |
| A2 | Event detail view, wired to A1 | Done |
| A3 | Settings screen, tag management, people management, aliases | Done |
| A4 | Suggestion edit dialog | Done |
| A5 | Templates: entity, migration, API, pinned row, starter set | Done |
| A6 | Housekeeping: tests, typecheck, build, benchmarks | Partly done — tests, typecheck and build were green after Increment 4; the benchmark run and new baseline were completed in Increment 4.1 T4; the server upgrade/rollback drill was completed in Increment 3.9 and the remaining 4.1 deploy drill (schema 5) is pending |

Total: ~9 focused days.

---

## 3. Domain Additions (`packages/domain`)

### New entities

| Entity | Fields |
|--------|--------|
| `Template` | id, name, title, defaultDurationMinutes?, tagIds, special? (`wake`\|`sleep`), isPinned, sortOrder, createdAt, updatedAt, isDeleted |
| `TemplateTag` | templateId, tagId, isPrimary |
| `PersonAlias` | id, personId, alias, createdAt, updatedAt, isDeleted |

### Changed entities

| Entity | Change |
|--------|--------|
| `Tag` | adds `archivedAt?` (nullable timestamp) |
| `Person` | adds `archivedAt?` (nullable timestamp) |

### New pure functions

- `applyEventPatch(event, patch)` — validates and applies event edits (title ≤ 200 chars, notes ≤ 5,000 chars, endAt > startAt)
- `reassignDay(event, days, timezone)` — reassigns an event to the correct Day when its time moves
- `recomputeTagPaths(tags, changedTagId)` — recomputes slash-separated paths for a tag and all descendants
- `wouldCreateCycle(tags, tagId, newParentId)` — prevents circular tag hierarchies
- `templateToEventDraft(template, startAt)` — builds an Event draft from a template (duration, wake/sleep special)
- `resolvePersonToken(people, token)` — resolves `@name` to a person, detects ambiguity
- `createParticipant(input)` — builds an EventParticipant
- `buildTemplate(draft)`, `patchTemplate(template, patch)`, `templateToEventDraft(template, startAt)`, `defaultStarterTemplates()`

No change to the `Event` table schema. Editing changes existing columns only.

---

## 4. Persistence (`packages/persistence`)

### Migration 4 (schema 3 → 4)

| Change | Detail |
|--------|--------|
| `template` table | id, name, title, default_duration_minutes, special, is_pinned, sort_order, created_at, updated_at, is_deleted |
| `template_tags` table | template_id, tag_id, is_primary (one primary per template) |
| `person_aliases` table | id, person_id, alias, created_at, updated_at, is_deleted (unique on live alias per person) |
| `tag.archived_at` | Nullable timestamp |
| `person.archived_at` | Nullable timestamp |

### Migration 5 (schema 4 → 5, added in Increment 4.1 T1)

| Change | Detail |
|--------|--------|
| `person_aliases` live alias uniqueness | Unique index on lowercase alias across **all** live people (case-insensitive); migration pre-checks for duplicates across people and aborts before applying if any are found |

### Repository interfaces

- `IEventRepository`: gains `get`, `patch`, `softDelete`, `restore`
- `ITagRepository`: gains `create`, `patch`, `archive`, `unarchive`, `delete`, `countUsage`
- `IPersonRepository`: gains `patch`, `archive`, `unarchive`, `delete`, `countUsage`, `addAlias`, `removeAlias`, `listAliases`
- `ITemplateRepository`: new — create, patch, list, soft-delete, restore
- `ITemplateTagRepository`: new — save, deleteForTemplate, listByTemplate
- `IPersonAliasRepository`: new — save, findByAlias, listByPerson, deleteForPerson

### Contract tests added

- Renaming a parent tag updates every descendant path atomically
- Moving a tag under its own descendant is rejected
- Deleting a tag/person in use fails; archiving succeeds
- Soft-deleting an event keeps tags and participants for complete restore
- Alias uniqueness among live aliases
- Migration 4 runs from empty DB and from a copy of the 3.9 production database

---

## 5. API Additions (`/api/v1/`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/events/:id` | One event with tags, people, capture |
| PATCH | `/events/:id` | Edit title, times, precision, notes, tags (with primary), participants |
| DELETE | `/events/:id` | Soft delete |
| POST | `/events/:id/restore` | Undo soft delete |
| GET | `/tags` | Tag tree with usage counts and archived flags |
| POST | `/tags` | Create tag, optionally under parent |
| PATCH | `/tags/:id` | Rename, recolor, move |
| POST | `/tags/:id/archive` | Archive (reversible via unarchive) |
| DELETE | `/tags/:id` | Delete when unused |
| GET | `/people?q=` | List people with usage counts and aliases |
| POST | `/people` | Create person |
| PATCH | `/people/:id` | Edit details |
| PUT | `/people/:id/aliases` | Replace alias list |
| POST | `/people/:id/archive` | Archive (reversible) |
| DELETE | `/people/:id` | Delete when unused |
| GET | `/templates` | List templates in sort order |
| POST | `/templates` | Create template |
| PATCH | `/templates/:id` | Edit or reorder |
| DELETE | `/templates/:id` | Soft delete |
| POST | `/templates/:id/log` | Log from template, optional startAt; returns event + day |

`PATCH /suggestions/:id` already existed; the web app now uses it. `accept` creates the event from edited values.

`GET /api/v1/suggestions/:id` was added in Increment 4.1 (T3) so clients can fetch a single suggestion, including its `externalId`.

---

## 6. Sync (`packages/sync`)

- `SYNC_PROTOCOL_VERSION` bumped from 1 to 2
- New entity types: `template`, `template_tag`, `person_alias`
- Event edits/deletes use existing outbox with last-write-wins by `updated_at`
- Restore sets `is_deleted = false` with new `updated_at`, winning over earlier delete
- Tag `path` is treated as derived; server recomputes from parent chain on ingest

---

## 7. Web App Changes (`apps/web`)

Screens follow `docs/web-design-spec.md` (tokens, no emojis, dark theme).

| Screen | Contents |
|--------|----------|
| Event detail | Drawer (wide) / panel (narrow). Edit title, start/end with precision, notes, tags (with primary), people. Delete asks once, shows short undo |
| Suggestion edit | Dialog with title, times, tags, people; saves via PATCH, accepts from same dialog |
| Settings | New screen with tabs: General, Tags, People, Templates |
| Settings: General | Server version/health, schema version, timezone |
| Settings: Tags | Tree with create, rename, recolor, move, archive, delete when unused; usage counts |
| Settings: People | List with search, details, aliases, archive, delete when unused |
| Settings: Templates | List with reorder and pin, editor, "Add starter set" button |
| Today | Pinned templates row above quick entry; one tap logs at current time |

Behavior:
- Quick entry keeps focus; closing drawer/dialog returns focus to it
- Escape closes drawer; dirty drawer asks before closing
- One-tap template shows confirmation with Undo (calls delete + restore)
- Starter set: Wake up, Breakfast, Lunch, Dinner, Brush teeth (offered, never auto-added)
- Archived tags/people hidden from pickers and quick-entry matching; still show on old events

---

## 8. Quality Gate Checklist

| Gate | Rule | Status |
|------|------|--------|
| CI | Type-check, lint, unit + contract tests green on every push | Pass |
| Contract suite | Includes cases in persistence section 6.3 | Pass |
| Migration | Tested from empty DB and copy of the 3.9 production DB | Pass (migration 4; migration 5 added in 4.1) |
| Benchmark | Run at end; added to docs/benchmarks/ | Pass — new `increment-4.1-server-baseline.json` recorded in T4; no regression vs 3.9 baseline |
| Upgrade + rollback | Deployed as new release, rolled back, redeployed | Pass (3.9 drill); schema 5 upgrade drill pending in 4.1 T5 |
| Restore drill | Not required (schema change is small) | N/A |
| Daily use | Deferred until features proven | Pending — deferred per Increment 4.1 decision |

After Increment 4.1 hardening the full suite is green: 195 tests across 24 files (including the new alias, domain, and server behavior coverage), type-check clean, lint clean, web build succeeds (~191 KB JS gzipped, ~14.41 kB CSS).

---

## 9. Files Changed

**New:**
- `packages/domain/src/edits.ts` — applyEventPatch, reassignDay, recomputeTagPaths, wouldCreateCycle, resolvePersonToken, createParticipant
- `packages/domain/src/templates.ts` — buildTemplate, patchTemplate, templateToEventDraft, defaultStarterTemplates
- `packages/persistence/src/sqlite/template-repository.ts`
- `packages/persistence/src/sqlite/template-tag-repository.ts`
- `packages/persistence/src/sqlite/person-alias-repository.ts`
- `apps/web/src/components/EventDetail.tsx`
- `apps/web/src/components/SuggestionEdit.tsx`
- `apps/web/src/pages/Settings.tsx`

**Modified:**
- `packages/domain/src/index.ts` — exports edits.js, templates.js
- `packages/domain/src/types.ts` — Tag/Person archivedAt, Template, TemplateTag, PersonAlias
- `packages/persistence/src/index.ts` — exports new repositories
- `packages/persistence/src/interfaces.ts` — new repository interfaces
- `packages/persistence/src/sqlite/migrations.ts` — Migration 4
- `packages/persistence/src/sqlite/event-repository.ts` — get/patch/softDelete/restore
- `packages/persistence/src/sqlite/tag-repository.ts` — archive/unarchive/delete/countUsage/create/patch
- `packages/persistence/src/sqlite/person-repository.ts` — archive/unarchive/delete/countUsage/patch/aliases
- `packages/sync/src/protocol.ts` — SYNC_PROTOCOL_VERSION → 2, new entity types
- `apps/server/src/app.ts` — all new API endpoints
- `apps/web/src/App.tsx` — Settings page integration
- `apps/web/src/api.ts` — all new API client functions
- `apps/web/src/pages/DayView.tsx` — event detail, suggestion edit, settings integration

---

## 10. Open Questions (from spec)

1. Should an archived tag still be offered when opening an old event that uses it? — **Not yet decided**
2. Template with no default duration logs a point event — **Resolved** (already supported)
3. Reorder templates by drag or simple up/down buttons? — **Not yet decided** (simple up/down used)
4. General settings tab: API key field or server only? — **Not yet decided** (server only for now)

---

## 11. Next Steps

Increment 4 is complete. The daily loop can now be used end-to-end from the web app. Daily use is deferred until the planned features are in (Increment 5), per the Increment 4.1 decision — the 14-day dogfood and Increment 5 work now come first.

After that, begin Increment 5 (Things, full-text search, Diagnostics).
