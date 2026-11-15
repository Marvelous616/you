# Increment 3.5 — Android Deployment Report

> **Project:** Life Logger
> **Milestone:** Increment 3.5 — Repository, Server and Deployment (Arch package delivery)
> **Date:** November 15, 2026
> **Tag:** `v0.3.6-increment-3.5`
> **Package:** `lifelogger-0.3.6-1-any.pkg.tar.zst`

---

## 1. Server — zeserver (Debian 13 trixie)

### Deployment state

| Check | Result |
|-------|--------|
| Node.js | v24.22.1 installed from official binary (apt had only Node 20, too old for `node:sqlite`) |
| `lifelogger.service` | Active + enabled (PID 4192) |
| `lifelogger-backup.timer` | Active + enabled |
| `GET /health` | `{"status":"ok","database":"connected","version":"0.3.6","schemaVersion":3,"syncProtocolVersion":1}` |
| Web app at `/` | HTML served correctly |
| `PRAGMA integrity_check` | `ok` (12 tables) |
| Bind address | `0.0.0.0:8080` (changed from `127.0.0.1` so the phone can reach it over Tailscale) |
| `/etc/lifelogger.env` | Mode 0640, root:root — outside package ownership |
| `/var/lib/lifelogger` | Mode 0750, lifelogger:lifelogger — outside package ownership |
| Backups | 4 daily backups present, mode 600 |

### What was done on the server
1. Installed Node.js v24.22.1 binary from nodejs.org (Debian apt only had Node 20)
2. Copied the full package tree from the build PC: `server.cjs`, web app, env defaults, `version.env`, backup/restore scripts, runner, systemd units, sysusers/tmpfiles
3. Created `lifelogger` system user and `/var/lib/lifelogger` (mode 0750)
4. Installed systemd units, enabled service + backup timer, started the service
5. Changed `HOST=127.0.0.1` → `HOST=0.0.0.0` in `/etc/lifelogger.env` so the phone can reach the server over Tailscale
6. Verified `/health` responds on the Tailscale IP `100.110.82.42:8080`

### Remaining drills (owner-side)
- **True version upgrade + rollback** — needs a second release (Increment 4)
- **Reboot drill** — blocked: needs console access / boot media attachment

---

## 2. Android App — Samsung Galaxy S9 (SM-G965F, Android 10)

### Deployment state

| Check | Result |
|-------|--------|
| Package | `com.lifelogger.app` v0.1.0, installed via ADB |
| Build | Release APK (`assembleRelease`, 71 MB) with JS bundle embedded |
| Launches | Yes — `MainActivity` starts, `ReactNativeJS: Running "main"` confirmed in logcat |
| JS errors | None in logcat |
| Server URL baked in | `http://100.110.82.42:8080` (zeroserver over Tailscale) |
| Phone → server ping | OK (18–115 ms over Tailscale `tun1`) |
| Phone → server HTTP | OK — `GET /health` returns 200 with version `0.3.6` |
| Sync from app | **Still failing** — "network request failed" |

### What was done
1. `expo prebuild --platform android` generated the native Android project
2. Created `index.js` entry point (was missing; `package.json` `main` pointed to it)
3. `./gradlew assembleRelease` built a release APK with the JS bundle embedded
4. `adb install -r app-release.apk` installed on the Samsung S9
5. `adb shell am start -n com.lifelogger.app/com.lifelogger.app.MainActivity` launched the app
6. Changed default server URL in `App.tsx` from `http://10.0.2.2:4000` (emulator alias) to `http://100.110.82.42:8080` (Tailscale IP)
7. Rebuilt and reinstalled the release APK

### Root cause of sync failure (not yet fixed)

The phone's Android routing table does not have a route to the server's Tailscale IP (`100.110.82.42`) via `tun1`. Only `192.168.1.0/24 via wlan0` is routed. The Tailscale app on the phone (`com.tailscale.ipn`) shows "idle" — it is installed but not actively connected/routing.

**What the owner needs to do on the phone:**
1. Open the Tailscale app and connect (it's currently idle)
2. Confirm `ip route show` includes a route to `100.110.82.42/32 dev tun1`
3. Open Life Logger, go to **Server Connection**
4. Confirm URL is `http://100.110.82.42:8080` (already baked into the build)
5. Tap **Save Connection**, then **Sync Now**

### Possible secondary issue — Android cleartext traffic

The server serves plain HTTP (no TLS). Android 10 may block cleartext traffic unless `android:usesCleartextTraffic="true"` is set in `AndroidManifest.xml`. If sync still fails after Tailscale is connected, add:

```xml
<application
  android:usesCleartextTraffic="true"
  ...>
```

to `apps/android/android/app/src/main/AndroidManifest.xml` and rebuild.

### App code state (complete)

| Component | Status |
|-----------|--------|
| `App.tsx` (~1,570 lines) | Complete UI: quick entry, markers, timeline, e2e review, suggestions, ICS import, server config, sync |
| `local-store.ts` | `InMemoryMobileStorage` — all 10 tests pass, typecheck clean |
| `sync-client.ts` | Push/pull with outbox, cursor, API key header |
| Tests | 10/10 passing (`mobile-daily-loop`, `mobile-sync`, `mobile-suggestions`) |
| TypeScript | `tsc --noEmit` clean |

### Known gap — WP 4.1 (Increment 4)

`expo-sqlite` is declared in `package.json` but **not used**. `local-store.ts` is purely in-memory, so **all data is lost on app restart**. Binding `expo-sqlite` as the durable local store is the first work package of Increment 4 and blocks the 14-day dogfood clock.

---

## 3. Next Steps

1. **Owner:** Connect Tailscale on the phone, then run Sync Now in Life Logger
2. **If cleartext blocked:** Add `android:usesCleartextTraffic="true"` to `AndroidManifest.xml`, rebuild, reinstall
3. **Increment 4 WP 4.1:** Bind `expo-sqlite` in `local-store.ts` for durable Android storage
4. **Remaining 3.5 drills:** Version upgrade/rollback (needs second release), reboot drill (needs console access)