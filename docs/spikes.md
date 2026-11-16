# Life Logger — Research Spikes A–D

> Written during Increment 4.1 T6 from the existing reports. Half a page per spike. Where no source material exists, the spike is marked **not run** — no results are invented.

## Spike A — Android Offline Persistence & Background Sync

- **Source:** `docs/reports/increment-1-completion-report.md` (Spike A), `tasks/step-1-walking-skeleton.md` (Spike A), Increment 3.9 notes.
- **Research question:** Can the client store markers offline and queue them for sync without UI blocking?
- **Outcome:** Validated. Local store write measured at ~0.03 ms against the < 50 ms budget; outbox survived network disconnects.
- **Decision impact:** Confirmed Expo/React Native viability for an Android client (original Decision 20).
- **4.1 status:** Validated then set aside — the Android app source directory was removed in Increment 3.9 ("for now"). Rebuilding with `expo-sqlite` durable storage remains the leading candidate for a future increment.

## Spike B — SQLite Batch Ingest

- **Source:** `docs/reports/increment-1-completion-report.md` (Spike B), benchmark baselines in `docs/benchmarks/`.
- **Research question:** How does SQLite WAL mode handle batch sync pushes?
- **Outcome:** Validated. 5,000 synthetic records ingested in ~150–343 ms against a < 500 ms budget; zero read contention observed.
- **Decision impact:** Confirmed SQLite with WAL as primary store (original Decision 18).
- **4.1 status:** Still valid; re-measured in the Increment 4.1 benchmark run (batch ingest 5000 records: ~94–111 ms, target < 500 ms).

## Spike C — Logical Day Boundary & Time Handling

- **Source:** `docs/reports/increment-1-completion-report.md` (Spike C), `docs/reports/increment-3-completion-report.md`.
- **Research question:** Does the wake-to-sleep boundary survive midnight crossings and DST shifts?
- **Outcome:** Validated. Tested across the Autumn clock-back transition (`America/New_York`) and early-morning pre-sleep hours (01:45 AM).
- **Decision impact:** Confirmed wake-to-sleep logical Day boundary (original Decision 3).
- **4.1 status:** Unchanged; covered again by the wake/sleep template behavior tests added in Increment 4.1 T3.

## Spike D — Call-Log Access

- **Source:** `docs/reports/increment-3-completion-report.md`.
- **Research question:** Call-log access for suggestion sources.
- **Outcome:** Not run — skipped in Increment 3; the Calendar extension was chosen ahead of call logging.
- **Decision impact:** Calendar-first suggestion source retained; call logging remains a future consideration.
- **4.1 status:** Not run.
