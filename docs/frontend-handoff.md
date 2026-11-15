# Life Logger — Project State & Frontend Handoff

> **Audience:** Frontend developer joining the project  
> **Status:** Increment 3.9 complete (all 10 work packages done)  
> **Repository:** `github.com/Marvelous616/you` (branch: `main`)  
> **Date:** November 15, 2026

---

## 1. Project Vision (One Sentence)

Life Logger is a personal, self-hosted timeline system that records *what you did and what state you were in*. One person, one server, one database. A PC-first web app is the primary client; an Android companion (currently deleted) may return in Increment 4. No public internet exposure, no hosted AI, no multi-tenant concerns.

---

## 2. Current State — What's Built & Deployed

### Server (running on `zeserver`, Debian 13 trixie)

| Item | Value |
|------|-------|
| Host | `zeserver` (Dell Inspiron 1545, Pentium T4300, 3.78 GiB RAM) |
| OS | Debian GNU/Linux 13 (trixie), kernel 6.12.113+deb13-amd64 |
| Node.js | v24.22.1 |
| Service | `lifelogger.service` — active + enabled, bound to `127.0.0.1:8080` |
| HTTPS | `https://zeserver.taile544af.ts.net/` via `tailscale serve` (tailnet only) |
| Plain HTTP | Refused on port 8080 |
| Database | SQLite WAL at `/var/lib/lifelogger/life.db`, schema 3 |
| Version | `0.3.6` |
| Health check | `GET /health` → `{"status":"ok","database":"connected",...}` |

The server is installed via a **Debian-native deployment path** (not the retired Arch pacman package): a release tarball is unpacked into `/opt/lifelogger/releases/vX.Y.Z/`, a `current` symlink switches versions, and a `install-release.sh` script handles health-check-verified deploys with automatic rollback on failure.

### Web App (React + Vite)

| Item | Value |
|------|-------|
| Framework | React 18.3 + TypeScript + Vite 5 |
| Build tool | Vite (`npm run --workspace=@life-logger/web dev` / `build`) |
| Styling | Custom CSS-in-JS objects (`style={{...}}`) + design system CSS variables in `index.css` |
| Dev server | `http://localhost:3000` |
| Production build | `apps/web/dist/` (~168 KB JS gzipped, ~14 KB CSS gzipped) |
| API target | `http://100.110.82.42:8080` (server IP, hardcoded in `api.ts`) |

The web app is a **single-page day view** (`DayView`) with:
- Server status indicator (auto-polls `/health` every 15s)
- Day summary (wake/sleep times, coverage %, gap count, event count)
- Multi-lane visual timeline with gap highlighting
- Quick-entry capture with live parse preview
- Chronological event list
- Markers list
- Journal editor + entries
- Suggestions inbox (accept/reject/edit, ICS import)
- End-of-day review modal (fill gaps, write journal, record sleep, compute fidelity)

### Android App

**Deleted** in Increment 3.9. Source was removed from `apps/android/`. If needed for Increment 4, it would need to be rebuilt from scratch using `expo-sqlite` for durable local storage (the previous version used in-memory storage only, so data was lost on restart).

---

## 3. Architecture & Repository Layout

```
life-logger/                         # Monorepo (npm workspaces)
├── packages/
│   ├── domain/                      # Pure TS: entities, rules, parser, derived values (no I/O)
│   ├── persistence/                 # Repository interfaces + SQLite (WAL) implementations + contract tests
│   └── sync/                        # Outbox engine, push/pull protocol, cursor-based sync
├── apps/
│   ├── server/                      # Node.js + Fastify API (port 8080)
│   ├── web/                         # React + Vite web app (port 3000 dev)
│   └── android/                     # DELETED (was React Native/Expo)
├── tools/bench/                     # Benchmark harness + regression comparison
├── scripts/                         # Windows backup / DR helpers
├── packaging/
│   ├── debian/                      # Debian release tarballs + install script (current deploy path)
│   └── (legacy Arch PKGBUILD retired)
├── docs/
│   ├── web-design-spec.md           # Written frontend design spec (tokens, components, layouts)
│   ├── benchmarks/                  # Benchmark baseline JSON files
│   └── reports/                     # Increment completion reports
├── packaging/debian/                # Debian deploy: build-release.sh, install-release.sh, release tarballs
├── Increment 3.9 Fixes and Hardening.md
├── Life Logger Implementation Plan.md
├── life-logger-high-level-design(2).md
├── Step 1 - Walking Skeleton.md
├── Step 2 - Daily Loop.md
└── package.json                     # Root workspace config
```

**Key architectural rule:** The persistence interface is the only place that knows which database is in use. Everything above it (domain, sync, server, clients) is database-agnostic.

**Another key rule:** Automated sources (calendar, GPS, etc.) never write directly to the timeline. They propose `Suggestion` records into the inbox; only an explicit user accept creates an `Event`.

---

## 4. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Language | TypeScript everywhere | One language for domain, server, web |
| Domain | Plain TS package, no I/O | Testable without a database; shared by all clients |
| Server | Node.js + Fastify | Small, single process, easy to deploy |
| Database | SQLite in WAL mode | Single file, easy backup, swappable via contract suite |
| Web app | React 18 + Vite + TypeScript | Fast PC-first UI |
| Styling | Custom CSS variables + inline style objects | Restrained neutral dark theme, no emojis |
| Sync | Custom outbox + push/pull endpoints + cursor | Small, Last-Write-Wins per record |
| Tests | Vitest (unit + contract) | Same runner for every package |
| CI | GitHub Actions (type-check, lint, tests on push) | Catches breakage early |

---

## 5. Data Model (Key Entities for Frontend)

All entities live in `packages/domain/src/types.ts`. The most important ones for frontend work:

### Day
A logical day bounded by wake/sleep (not midnight).
```typescript
{ id, localDate, wakeAt?, sleepAt?, timezone, reviewStatus: 'unreviewed'|'in_progress'|'completed', fidelity: 'detailed'|'summary'|'skipped', createdAt, updatedAt, isDeleted }
```
- `fidelity` is **derived** from timeline coverage + journal presence (never user-set)
- `reviewStatus` transitions: unreviewed → in_progress → completed

### Event
Something done over an interval (or a point if no end).
```typescript
{ id, dayId, title, startAt, endAt?, startPrecision, endPrecision, source: 'live'|'backfill'|'prompted'|'imported', notes?, createdAt, updatedAt, isDeleted }
```
- Events may overlap arbitrarily; overlaps are derived, never stored
- Lane assignment for the timeline is computed (greedy interval coloring)

### Tag
Hierarchical tag tree (e.g. `work/coding`, `food/lunch`).
```typescript
{ id, name, path, color?, parentId? }
```
- One primary tag per event (via `EventTag.isPrimary`)

### Person / EventParticipant
People involved in events (role, medium, initiated_by).

### JournalEntry
Free-text reflection tied to a Day.

### Marker
One-tap "something happened now" timestamp with optional note.

### Capture
Raw quick-entry text before parsing; kept forever for re-parsing.

### Suggestion
Machine-proposed event awaiting accept/reject/edit.
```typescript
{ id, source: 'calendar'|'gps'|..., confidence, proposed: { title, startAt, endAt?, ... }, status: 'pending'|'accepted'|'rejected', externalId?, createdAt, updatedAt }
```

---

## 6. API Surface

All endpoints are under `/api/v1/`. The server also serves `/health` (unauthenticated) and static web files.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Server health: status, database, version, schemaVersion, syncProtocolVersion, timestamp |
| GET | `/api/v1/days/active?timezone=` | Yes (API key) | Get or create the active day for a timezone |
| GET | `/api/v1/days/:id/timeline` | Yes | Full day timeline: events, markers, tags, people, gaps, journal, coverage |
| PATCH | `/api/v1/days/:id` | Yes | Patch day (wakeAt, sleepAt, reviewStatus, timezone) |
| GET | `/api/v1/markers?dayId=` | Yes | List markers (optionally filtered by day) |
| POST | `/api/v1/events` | Yes | Create an event (+ tags, people, capture) |
| POST | `/api/v1/days/:id/journal` | Yes | Save a journal entry for a day |
| POST | `/api/v1/days/:id/review` | Yes | Complete end-of-day review (sleepAt, journalBody) → returns fidelity, coverage, gaps |
| GET | `/api/v1/suggestions?status=pending` | Yes | List pending suggestions |
| PATCH | `/api/v1/suggestions/:id` | Yes | Edit a suggestion (title, startAt, endAt overrides) |
| POST | `/api/v1/suggestions/:id/accept` | Yes | Accept a suggestion → creates an Event |
| POST | `/api/v1/suggestions/:id/reject` | Yes | Reject a suggestion |
| GET | `/api/v1/extensions` | Yes | List registered extensions (tags, dimensions, tables) |
| POST | `/api/v1/extensions/calendar/import` | Yes | Import .ics calendar text → returns suggestions |

**Auth:** Single-user API key via `Authorization: Bearer <key>` or `x-api-key` header. `/health` and static files are unauthenticated. The key lives in `/etc/lifelogger.env` on the server.

**CORS:** Enabled with `origin: '*'`.

---

## 7. Frontend Details — Current Web App

### Source Tree (`apps/web/src/`)

```
App.tsx                    # Shell: React.StrictMode > DayView
index.css                  # Design system: CSS custom properties (tokens)
main.tsx                   # ReactDOM entry point
pages/
  DayView.tsx              # Main page: data loading, layout, all event handlers
components/
  ServerStatus.tsx         # Server health indicator (polls /health every 15s, retry button)
  Timeline.tsx             # Visual timeline: lanes, gap blocks, event blocks, time axis
  QuickEntry.tsx           # Quick entry form with live parse preview + tag/people chips
  EventList.tsx            # Chronological event list with time + tags
  Markers.tsx              # Markers list with time + note + meta chips
  Journal.tsx              # Journal textarea + saved entries
  SuggestionCard.tsx       # Individual suggestion: accept/reject/edit, ICS import UI
  ReviewModal.tsx          # End-of-day review modal: gaps, journal, sleep, Done state
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/api.ts` | API client: all fetch functions, interfaces (DayTimeline, CreateEventInput, ReviewInput, etc.) |
| `apps/web/src/pages/DayView.tsx` | Main page: fetches active day + timeline + suggestions, handles all mutations |
| `apps/web/src/index.css` | Design system tokens (colors, spacing, typography, radius, shadows, transitions) |
| `apps/web/vite.config.ts` | Vite config: port 3000, React plugin (proxy removed — direct API calls) |
| `apps/web/index.html` | Minimal HTML with dark theme body styles |

### State Management

Simple React `useState` + `useCallback` in `DayView`. No Redux, no Zustand, no Context. Data is re-fetched (`loadData()`) after every mutation and on a 10-second interval.

### Known Gaps / TODOs in Frontend Code

- Clicking an event in the timeline or list does nothing (TODO placeholder for event detail view)
- Suggestion edit handler is a TODO placeholder
- No event detail screen
- No tag/people management screens
- No search
- No settings page
- No phone client (deleted)

---

## 8. Design System (for a New Frontend Dev)

All tokens are CSS custom properties in `apps/web/src/index.css`. Full spec is in `docs/web-design-spec.md`.

### Core Principles
1. **Dark by default** — dark background reduces glare at all hours
2. **Neutral accent** — indigo (`#818cf8`) is the only accent color, used sparingly
3. **No emojis** — text and system glyphs only
4. **Frictionless capture** — quick entry loads focused and ready to type
5. **Timeline first** — the day timeline is the central visual element
6. **No surprises** — empty states explain what to do; errors explain what happened

### Color Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--color-bg` | `#0f172a` | Page background |
| `--color-surface` | `#1e293b` | Cards, panels |
| `--color-surface-hover` | `#334155` | Hovered surfaces |
| `--color-border` | `#334155` | Borders, dividers |
| `--color-text-primary` | `#f8fafc` | Headlines |
| `--color-text-secondary` | `#cbd5e1` | Body text |
| `--color-text-muted` | `#94a3b8` | Captions, metadata |
| `--color-accent` | `#818cf8` | Primary buttons |
| `--color-accent-hover` | `#a5b4fc` | Primary button hover |
| `--color-accent-text` | `#1e1b4b` | Text on accent bg |
| `--color-success` | `#34d399` | Coverage fill, success |
| `--color-wake` | `#22d3ee` | Wake time badge |
| `--color-sleep` | `#c084fc` | Sleep time badge |

### Layout Shell

```
.shell (flex column, 100vh, overflow hidden)
├── .header (64px, brand + nav + server status)
├── .content (flex 1, overflow-y auto, max-width 960px centered, 24px padding)
│   └── cards stacked vertically
└── .footer (version info)
```

### Components (Patterns)

- **Card**: `--color-surface` bg, 1px border, `--radius-lg` (14px), 20px padding
- **Button**: `border-radius: --radius-md` (10px), font-weight 600, transitions on hover
- **Input/textarea**: `#0f172a` bg, `--color-border` border, focus shows `--color-accent` ring
- **Badge**: `--radius-full` (9999px), small caps, 0.65rem
- **Timeline**: absolute-positioned lanes, gap blocks, event blocks (34px height, computed left/width/top)
- **Timeline gaps**: `rgba(148,163,184,0.14)` bg, dashed borders

---

## 9. How to Run & Develop

### Prerequisites
- Node.js 22.5+ (v24 recommended)
- npm 10+

### Install
```bash
git clone https://github.com/Marvelous616/you.git
cd you
npm ci
```

### Develop (two terminals)
```bash
# Terminal 1: API server (runs on localhost:4000)
npm run --workspace=@life-logger/server dev

# Terminal 2: Web app (runs on localhost:3000)
npm run --workspace=@life-logger/web dev
```

The dev server proxies `/api` to `localhost:4000`. Note: `api.ts` currently has `API_BASE` hardcoded to the server IP (`http://100.110.82.42:8080`) — for local dev you may want to point it at `http://localhost:4000`.

### Test
```bash
npm test                    # All packages: 144 tests, 20 files
npm run typecheck           # TypeScript project build
npm run --workspace=@life-logger/web build   # Production web build
```

### Deploy (to the server)
```bash
# On the PC (builds tarball from release tag)
packaging/debian/build-release.sh

# On the server
packaging/debian/install-release.sh packaging/debian/releases/lifelogger-0.3.6.tar.gz
```

---

## 10. Deployment & Server Details

The server runs on `zeserver` (Debian 13). The deploy model is tarball-based:

1. **Build** on PC: `packaging/debian/build-release.sh` → creates `lifelogger-<version>.tar.gz`
2. **Transfer** tarball to server
3. **Install**: `packaging/debian/install-release.sh <tarball>` — unpacks, switches `current` symlink, restarts service, health-checks, rolls back on failure
4. **Database & config** live outside releases: `/var/lib/lifelogger/` (db + backups) and `/etc/lifelogger.env` (API key, overrides)

The systemd unit loads env in order: package defaults → `/etc/lifelogger.env` → `version.env`. `APP_VERSION` comes from `version.env` (written at build time) and cannot be overridden.

---

## 11. Roadmap — What's Done vs What's Pending

### Completed (Increments 1–3.9)
- Walking skeleton: marker save → sync → web timeline
- Daily loop: events, tags, people, quick-entry parser, journal, end-of-day review, gaps
- Suggestions + Calendar extension (ICS import)
- Packaging redo: Arch → Debian deployment
- HTTPS via tailscale serve
- Web frontend redesign with design spec
- All drills: upgrade, rollback, reboot, backup/restore, benchmark

### Pending (Increment 4 — "depth", ~15 focused days)

| Work Package | Description |
|--------------|-------------|
| Things & dynamic types | `TypeDefinition`, `TypeInstance`, `EventThing` — runtime-creatable typed fields on events/things/people |
| Full-text search | Search over event titles, notes, journals |
| Diagnostics extension | Crash reports, perf sampling, retention (own tables, never writes timeline events) |
| Android `expo-sqlite` binding | Durable local storage (rebuild the deleted Android app) |

### Increment 5 (outline)
- Remaining extensions (health tracker, todo list, GPS, relationships, analytics, etc.)
- Analytics dashboards
- Backfilling past days
- Management screens on Android (types, tags, modules)

---

## 12. Frontend-Specific Next Steps (Recommended)

If you're picking up frontend work, here's a suggested order:

1. **Event detail view** — Clicking an event in the timeline or list currently does nothing. Build a modal or detail page to view/edit an event (title, times, tags, people, notes, source).
2. **Suggestion edit** — The edit handler in `SuggestionCard.tsx` is a TODO placeholder. Wire it to `api.ts.editSuggestion()`.
3. **Settings page** — Server URL is hardcoded in `api.ts`. Add a settings UI to configure API base URL and API key at runtime (persisted to localStorage).
4. **Tag/people management** — Chips display but cannot be created or edited in the web app. Add a tags screen (hierarchical tree) and people screen.
5. **Search** — Full-text search over events, notes, journals.
6. **Mobile responsiveness** — Basic mobile tolerance exists but is not a dedicated layout. Consider a mobile-first review.

### Frontend Files to Start With

| File | What to look at |
|------|-----------------|
| `apps/web/src/index.css` | Design system — all your styling tokens |
| `apps/web/src/api.ts` | API client — all endpoints and types |
| `apps/web/src/pages/DayView.tsx` | Main page — state, data flow, all mutations |
| `apps/web/src/components/Timeline.tsx` | Visual timeline — lanes, gaps, event positioning |
| `apps/web/src/components/QuickEntry.tsx` | Quick entry — parse preview, chips |
| `docs/web-design-spec.md` | Full design spec — principles, tokens, layouts, extension slots |

---

## 13. Important Constraints (Read Before Coding)

- **No emojis** in the UI (project rule #6 from Increment 3.5 spec)
- **No hosted AI services** — all parsing is rule-based (regex/tokenizer)
- **Single user** — no multi-tenant auth, no registration flow
- **HTTPS only** for production; local dev can use HTTP
- **API key** lives in `/etc/lifelogger.env` on the server — never commit it
- **Suggestions never write directly to the timeline** — only accept creates an Event
- **One database, one server, one user** — keep it simple
- **Dark theme** — the app is used at all hours; light mode is not a priority

---

## 14. Useful Links

- Repository: `https://github.com/Marvelous616/you`
- Server (live): `https://zeserver.taile544af.ts.net/health`
- Increment 3.5 report: `docs/reports/increment-3.5-completion-report.md`
- Increment 3.9 report: `docs/reports/increment-3.9-completion-report.md`
- Web design spec: `docs/web-design-spec.md`
- High-level design: `life-logger-high-level-design(2).md`
- Implementation plan: `Life Logger Implementation Plan.md`
