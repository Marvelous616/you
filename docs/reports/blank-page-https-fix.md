# Blank Page on HTTPS — Problem & Fix Report

> **Project:** Life Logger
> **Date:** 2026-11-17
> **Host:** `zeserver` (Debian GNU/Linux 13)
> **URL:** `https://zeserver.taile544af.ts.net/`

---

## 1. Problem

Opening the Life Logger web app over HTTPS (`https://zeserver.taile544af.ts.net/`) rendered a blank dark-blue page. The HTML shell, CSS, and JS bundle all loaded successfully (HTTP 200), but React did not mount into `#root`. No API calls reached the server.

---

## 2. Root Cause

The web API client used an absolute `http://` origin:

```ts
const API_BASE = 'http://100.110.82.42:8080';
```

This URL is the server's Tailscale IPv4 address over **plain HTTP**. When the page is loaded over **HTTPS** (`https://zeserver.taile544af.ts.net/`), the browser blocks these `http://` fetches as **mixed content**. The first `fetch()` calls in `DayView` (`fetchHealth`, `fetchActiveDay`, `fetchDayTimeline`) failed, and something in the React render/init chain threw, so `createRoot(document.getElementById("root")).render(...)` never completed.

Evidence:
- `/health` returned `200 OK` (server was running fine).
- All three static assets returned `200 OK` with correct sizes (`index-C-*.js` ~210 KB, `index-*.css` ~15 KB, font ~2.4 MB).
- No `/api/v1/*` requests appeared in `journalctl -u lifelogger`.
- Browser console would show mixed-content block errors for `http://100.110.82.42:8080/*`.

This was a latent bug: during development the page was served over plain HTTP from `http://localhost:3000` pointing at `http://100.110.82.42:8080`, so the mixed-content issue never surfaced. In production the page is served over HTTPS via `tailscale serve`, which triggers the block.

---

## 3. Fix

Changed `API_BASE` from an absolute `http://` URL to an empty string so all API fetches are **same-origin relative URLs**:

```diff
- const API_BASE = 'http://100.110.82.42:8080';
+ const API_BASE = '';
```

All `fetch(`${API_BASE}/api/v1/...`)` calls now resolve to `https://zeserver.taile544af.ts.net/api/v1/...`, which is allowed over HTTPS. No CORS changes were needed (the server already sends `access-control-allow-origin: *`).

**File changed:** `apps/web/src/api.ts` (1 line)

---

## 4. Verification

### Quality gates (local)

| Gate | Result |
|------|--------|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 29 files, 218 tests, Pass |
| `npm run build` | Pass (web bundle ~210 KB JS) |

### Deployed state (on `zeserver`)

| Check | Result |
|-------|--------|
| `GET /health` (HTTPS) | `{"status":"ok","database":"connected","version":"0.3.7","schemaVersion":7,"syncProtocolVersion":3}` |
| JS bundle | HTTP 200, 210,426 bytes |
| CSS bundle | HTTP 200 |
| Font asset | HTTP 200 |
| Mixed-content (`http://`) API URLs in bundle | 0 |
| Plain HTTP (`http://100.110.82.42:8080`) | Refused (connection refused), as required |

### Deployment

- New web bundle copied to `/usr/lib/lifelogger/web/` on `zeserver`.
- `lifelogger.service` restarted; active and enabled.
- The `current` symlink points to `v0.3.7` (schema 7 / protocol 3).

---

## 5. User Action

Hard-refresh the page (**Ctrl+Shift+R** or **Cmd+Shift+R**) at `https://zeserver.taile544af.ts.net/`. The app should now render the timeline, quick entry, search, settings, and diagnostics normally.

If it is still blank after a hard refresh, check the browser console for remaining errors and re-check `journalctl -u lifelogger -n 50 --no-pager` on `zeserver`.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `apps/web/src/api.ts` | `API_BASE` → `''` (same-origin relative API URLs) |

Commit: pending (to be committed with the next work session).

---
