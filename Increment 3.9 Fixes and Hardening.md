# Increment 3.9: Fixes and Hardening

*Companion to the Life Logger implementation plan and high-level design (Draft 10). Follows Increment 3.5, which closes with carried items. Effort is in focused days and is rough. Items marked proposed still need your confirmation.*

## 1. Why this increment exists

Increment 3.5 delivered the server but closed with open items and reports that no longer match reality. The Android client was deleted, so this increment covers only the server, the web app and the process around them.

Problems to fix:

- The server speaks plain HTTP on `0.0.0.0:8080` over Tailscale, though the plan required HTTPS only.
- The host is now a Debian machine, but the 3.5 report and the packaging describe an Arch archiso server and a pacman package that no longer apply.
- Backups sit on the same disk as the database.
- The upgrade, rollback and reboot drills were never run.
- The web UI follows no written design, which is why generated screens come out poor.

## 2. Goal

The server is reachable over HTTPS on the tailnet, a release can be deployed and rolled back on the Debian machine, backups exist off the machine, and the web UI has a written design spec to follow.

## 3. Decisions needed first

| # | Decision | Proposal |
| --- | --- | --- |
| 1 | Transport | HTTPS through `tailscale serve`, with the server bound to `127.0.0.1` (proposed) |
| 2 | How a release reaches the Debian server | A tarball with the server bundle, web build, systemd units and an install script, with a health check and rollback to the previous release (proposed). The Arch package and pacman installer are retired for this host |
| 3 | Clients | The web app is the only client for now. No phone client work is planned in this increment |
| 4 | Design | The canvas becomes the written spec for the web app. Phone screens are left out of it |

## 4. Scope

**In scope**

- HTTPS for the server.
- Backups copied off the machine, with a restore test from the copy.
- A deployment path for the Debian machine, with the upgrade, rollback and reboot drills.
- Service hardening.
- Corrected reports.
- A written design spec for the web app.
- A server benchmark baseline.

**Out of scope**

- Any phone client.
- Applying the design spec to the web app, which is a later increment.
- Increment 4 features: things and dynamic types, full-text search, Diagnostics.
- New core model entities such as Observations, Places or Attachments.

## 5. Work packages

Order: 3.9.1 to 3.9.3 first. 3.9.4 comes before 3.9.7. 3.9.6 can run alongside any of them.

| # | Work package | Days | Notes |
| --- | --- | --- | --- |
| 3.9.1 | Close 3.5 and correct the reports | 0.5 | Update the 3.5 completion report: the server is a Debian machine, not an Arch archiso host. Mark the Android deployment report as superseded because the app was deleted. List the carried items (section 8) |
| 3.9.2 | HTTPS | 0.5 | Enable HTTPS for the tailnet, run `tailscale serve --bg 8080`, set `HOST=127.0.0.1` in `/etc/lifelogger.env` and restart the service. Check the web app and `/health` from a second device. Update the runbook |
| 3.9.3 | Off-machine backups | 0.5 | Copy `/var/lib/lifelogger/backups` to the PC on a schedule. Restore one copy into a scratch database and run the integrity check |
| 3.9.4 | Debian deployment path | 1 | Replace the pacman install with a script for Debian: unpack a release tarball, switch a current link, restart the service, check `/health`, and roll back to the previous release if the check fails. Keep the database and `/etc/lifelogger.env` outside the release |
| 3.9.5 | Service hardening | 0.5 | Add `UMask=0077` to the unit so the database file is not world-readable. Recheck the sandbox settings and that `/api/` still needs the API key |
| 3.9.6 | Web design spec | 1 | Turn the design canvas into a markdown spec for the web app: tokens, component rules, a layout list per screen, the extension slots and a list of features not built yet. Drop the phone screens |
| 3.9.7 | Upgrade and rollback drill | 0.5 | Build the next tag, deploy it with 3.9.4, roll back, and check health and data |
| 3.9.8 | Reboot test | 0.5 | Reboot the Debian machine with console access to hand. Check that the service and backup timer start and `/health` is ok |
| 3.9.9 | Server benchmark baseline | 0.5 | Run `tools/bench` on the server against a scratch database, not the live one. Record `docs/benchmarks/increment-3.9-server-baseline.json` and compare it with the PC baseline using the 3x guard |
| 3.9.10 | Report and tag | 0.5 | Completion report with a "Verified on the server" section, and the tag `v0.3.9-increment-3.9` |
|  | Total | about 6 |  |

## 6. Verification on the server

Run these on the real server, not only in tests:

1. Open the HTTPS URL from a second device on the tailnet. The web app loads and `/health` shows the version, schema and sync protocol.
2. Try `http://<tailscale ip>:8080`. It must no longer answer.
3. Copy the backups off the machine and restore one into a scratch database. The integrity check returns ok.
4. Deploy the next release, confirm health, roll back, and confirm health and data again.
5. Reboot with console access. The service and backup timer come back and `/health` is ok.
6. Run the server benchmark against a scratch database and compare it with the PC baseline.

The increment does not close until all six pass.

## 7. Quality gates

| Gate | Rule |
| --- | --- |
| Verified on the server | The report states which checks ran on the server and which ran only in tests |
| Transport | No plain HTTP is reachable from the tailnet, and the server listens on loopback only |
| Backups | A copy exists off the machine and a restore from it passes the integrity check |
| Deploy | A deploy and a rollback both finish with a healthy `/health` |
| Existing suites | The 154 TypeScript tests, the typechecks and the web build stay green |
| Reports | The reports agree on the host operating system and the state of each drill |

## 8. Carried from Increment 3.5

| Item | State | Plan |
| --- | --- | --- |
| True upgrade and rollback drill | Never run | 3.9.7 |
| Reboot drill | The old blockers described the archiso host | 3.9.8, re-scoped for Debian |
| Server benchmark | Not run | 3.9.9 |
| `UMask=0077` in the unit | Not applied | 3.9.5 |
| Off-machine backups | Not done | 3.9.3 |
| Connectivity over the tailnet | Pending owner | Closed by 3.9.2 |

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Locking yourself out while changing the bind address | Keep a second SSH session open, test the HTTPS URL before binding to loopback, and note the old setting for rollback |
| HTTPS is off in the tailnet or `tailscale serve` is unavailable | Enable HTTPS in the admin settings first. A reverse proxy with a Tailscale certificate is the fallback |
| The reboot leaves the machine unreachable | Console access to hand, and the reboot test runs last |
| The deploy script behaves differently on the real server | Test it in a scratch directory first and keep the previous release until the new one is proven |
| The design spec drifts into feature work | The spec lists unbuilt features, and applying it to the web app is a later increment |
| The benchmark pollutes the live database | Run it against a scratch database |

## 10. Done when

The web app opens over HTTPS from a second device and plain HTTP no longer answers. A release deploys and rolls back on the Debian machine. A backup copy exists off the machine and restores cleanly. The machine reboots and the service comes back. The reports match reality and the design spec exists. After that, start the 14 day dogfood on the web app, and begin Increment 4 only once it is running.

## 11. To confirm before starting

1. `tailscale serve` as the transport in decision 1.
2. The tarball approach for deploying to Debian in decision 2.
3. Running the benchmark against a scratch database rather than the live one.
