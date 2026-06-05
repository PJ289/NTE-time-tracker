# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.2.2] - 2026-06-05

### Added
- **Sync failure tray notifications (`.exe`)**: connection errors, auth failures (401), registration failures, and session upload errors show a tray balloon (same channel as update notices; 5-minute cooldown per error type to avoid spam).

### Changed
- **Auto-register policy (`.exe` / `tracker.js`)**: auto-register runs only when Device ID and token are both missing. Existing credentials in `client.json` or a full pair in `.env.client` skip registration; `.env.client` credentials also disable the auto-register flag at runtime.
- **401 sync errors**: the client no longer clears stored credentials and registers a new device on auth failure; fix the token or device on the server or in config instead.
- **Tray settings UI**: when Device ID and token are present, Auto-register is shown and saved as off.

### Fixed
- Auto-register could still run or replace credentials after a failed sync even when valid Device ID and token were already configured.
- **Config editor (tray)**: syntax error in the settings HTA `save()` function prevented the form from loading.
- **Tray HTA windows**: launch logs/settings with `cmd start mshta` (not `windowsHide` on `mshta.exe`, which hid both windows).
- **Post-update / restart**: empty console after auto-update; restart and post-update launch use hidden `Start-Process` / `spawnHiddenSea` instead of `start nte-tracker.exe`.

---

## [2.2.1] - 2026-06-05

### Added
- **Tray auto-start management (`.exe`)**: context menu shows **Install auto-start at login** or **Uninstall auto-start at login** depending on whether the `NTETracker` scheduled task exists; includes Yes/No confirmation and Administrator elevation (UAC) when required.
- **Update notifications**: automatic checks show a tray balloon when a newer release is found; **Check for Update** opens a Yes/No dialog to install; **Install update vX.Y.Z** appears in the tray menu while an update is pending (`pending-update.json`).
- **`NTE_UPDATE_DEV_BUILDS`**: optional `.env.client` flag to check GitHub **pre-releases** for `nte-tracker.exe` (dev builds such as `v2.3.0-dev`) instead of stable `/releases/latest` only.

### Changed
- **`nte-tracker.exe --install` / `--uninstall`**: prints status to the console in `.exe` mode; install no longer races with normal tracker startup; successful `--install` starts the tracker in the background immediately.
- **`install.bat`**: shows success/failure and pauses when using `nte-tracker.exe`.
- **CI — tracker EXE workflow**: uploads `nte-tracker.exe` with `gh release upload` and explicit job `contents: write` (replaces `softprops/action-gh-release`, which failed with `Resource not accessible by integration`).
- `package.json` version bumped to `2.2.1`.

### Fixed
- **`--install` appeared to do nothing**: maintenance commands (`--install`, `--uninstall`, `--sync`, `--install-tray`, `--uninstall-tray`) no longer fell through into full tracker startup before exiting.
- **Update check found a release but showed nothing**: Windows toast notifications were unreliable from the hidden process; replaced with tray balloon + dialog + dynamic menu item.
- **`.env.client` vs `client.json` credentials**: when both `NTE_DEVICE_ID` and `NTE_DEVICE_TOKEN` are set in `.env.client`, they now override and sync to `client.json` instead of mixing with auto-registered values; config GUI keeps token on save if the field was left unchanged.

---

## [2.2.0] - 2026-06-05

### Added
- **Standalone PC client (`nte-tracker.exe`)**: Node.js [Single Executable Application (SEA)](https://nodejs.org/api/single-executable-applications.html) build — no separate Node.js install required on the target PC.
- **System tray icon** (`.exe` mode, or `NTE_TRAY=1` with `node tracker.js`): right-click menu with Open Dashboard, Open Logs, Edit Config, Check for Update, Restart, and Close. Double-click opens the dashboard.
- **Tray GUI windows (HTA)**: **Open Logs** shows `%LOCALAPPDATA%\nte-tracker\tracker.log` in a dark viewer with auto-refresh; **Edit Config** opens a dark settings form for `.env.client` with brief descriptions and recommendations per option.
- **Auto-update (`.exe` only)**: when a newer GitHub Release includes an `nte-tracker.exe` asset, the client can download and replace itself via a helper batch script, then restart.
- **Startup install via executable**: `nte-tracker.exe --install` and `--uninstall` register or remove the `NTETracker` scheduled task (same task name as the legacy VBS flow).
- **File logging (`.exe` mode)**: tracker output is appended to `%LOCALAPPDATA%\nte-tracker\tracker.log` (viewable from the tray).
- **Local SEA build tooling**: `sea-config.json` and `build-exe.ps1` to compile `nte-tracker.exe` on a dev machine (Node.js 22+ recommended), including custom icon patching via `resedit`/`pe-library`.
- **CI — tracker EXE workflow**: `.github/workflows/build-tracker-exe.yml` builds `nte-tracker.exe` on `windows-latest` when a GitHub Release is **published**, and attaches it as a release asset. Can also be triggered manually from Actions (artifact only, or upload to a release).
- **Docker log timezone**: `tzdata` in the server image and `TZ` in `docker-compose.yml` (default `Europe/Madrid`; override via `.env`).

### Changed
- `install.bat`, `uninstall.bat`, and `restart.bat` detect `nte-tracker.exe` in the project folder and delegate to it; otherwise they fall back to the legacy `launcher.vbs` + `schtasks` flow.
- `stop-tracker.ps1` stops both `nte-tracker.exe` and `node tracker.js` instances for the project folder.
- **Log timestamps** use the PC or container local timezone instead of UTC (`tracker.js` and `server.js`).
- **Config GUI** pre-fills Device ID and token from `client.json` when they are not set in `.env.client` (credentials after auto-register live in AppData, not in the project folder).
- `sea-config.json` embeds dashboard assets (`sw.js`, manifest, icons) so the standalone `.exe` runs without missing-file warnings outside the source tree.
- `package.json` version bumped to `2.2.0`.

### Fixed
- **SEA / tray reliability**: background relaunch hides the console window without converting the binary to a Windows GUI subsystem (which crashed SEA startup); tray log/config actions use `mshta.exe` HTA windows instead of hidden PowerShell WinForms or `notepad.exe` (which failed from the hidden process).
- **Server sync auth (401)**: if stored credentials in `client.json` are rejected and auto-register is enabled (without fixed `.env.client` credentials), the client clears them and re-registers automatically.
- **Icon patching**: `rcedit` replaced with `resedit`/`pe-library` in `build-exe.ps1` (rcedit hung or failed on the SEA binary).

### Notes
- **Docker** images are still built automatically on push to `dev` / `main` — publishing a GitHub Release is **not** required for Docker.
- **EXE builds** require publishing a GitHub Release (or running the workflow manually). A push to `dev` or `main` alone does not produce `nte-tracker.exe`.
- The client's update check uses GitHub's `/releases/latest`, which returns only **stable** (non–pre-release) releases. Pre-releases must be downloaded manually from the Releases page.
- `nte-tracker.exe` is ~80–90 MB because it embeds the Node runtime.

---

## [2.1.0] - 2026-06-04

### Added
- **Version system**: `server.js` exposes `/api/version` endpoint with current version and latest GitHub release info (cached 24 h).
- **Dashboard version indicator**: footer now shows the running version; a badge appears when a newer release is available, linking to the GitHub release page.
- **PC tracker update check**: `tracker.js` checks for new releases once per day at startup and shows a Windows toast notification when a newer version is available.
- **CI/CD — GitHub Actions**: `.github/workflows/docker-publish.yml` builds and pushes Docker images automatically — pushes to `dev` → `:dev`, pushes to `main` → `:latest`, release tags → `:latest` + `:<version>`.
- **Anti-duplicate session logic (client)**: `tracker.js` now deduplicates sessions by time overlap before upload; queue is pruned using server-acknowledged end time; overlap-merging applied to sync candidates.
- **Anti-duplicate session logic (server)**: `server.js` detects and absorbs overlapping sessions for the same device before inserting; `mergeWithPreviousSession` extended to handle partial-overlap rewrites.
- **Dashboard immediate refresh**: all admin mutations (delete, edit, create, combine sessions; device edit/delete/token-rotate) now trigger a `GET /data` refresh immediately after the API call, without waiting for SSE.
- **Admin token guard**: attempting any admin action without a saved token now shows an `alert()` dialog directing the user to the Devices tab.
- **HTTPS / self-signed cert guidance**: README updated with a dedicated section explaining PC sync behaviour with local TLS certificates and the recommended split (HTTPS for mobile/PWA, HTTP direct for PC sync).

### Changed
- `package.json` version bumped from `2.0.0-dev` to `2.1.0`.
- Edit/Delete/Combine session buttons are no longer disabled when no admin token is set — they now trigger the token-required alert instead.
- `syncWithServer` uses the maximum of the server-reported end time and the locally cached last-sync time as the upload cutoff, preventing redundant re-uploads.

### Fixed
- Session queue was never pruned after a successful sync, causing the same sessions to be re-sent on every startup sync.
- `mergeWithPreviousSession` previously returned `null` (skip) when a new session started before the previous one ended, leaving overlapping entries; it now extends the existing session instead.

---

## [2.0.0] - 2026

### Added
- Full rewrite: server mode using SQLite (`better-sqlite3`) replaces the previous flat-JSON approach.
- Multi-device support: devices registered with tokens, sessions tagged by `device_id`.
- Admin token authentication for mutations (edit, delete, create sessions; device management).
- Server-Sent Events (SSE) for live dashboard updates.
- Session merge logic: consecutive sessions within a configurable gap (`NTE_MERGE_GAP_SECONDS`) are merged automatically.
- PC client sync mode: `tracker.js` uploads sessions to a remote server via `/api/sessions/bulk`.
- Android Tasker integration: profile and tasks for automatic session upload via `/api/sessions/queue`.
- PWA support: `manifest.webmanifest`, service worker (`sw.js`), installable from Android Chrome and iOS Safari.
- Docker Compose setup with `docker-entrypoint.sh` and published image on Docker Hub.
- Legacy JSON migration: existing `data.json` sessions imported as a "PC (Legacy)" device on first server start.
- Manual session creation from the dashboard.
- Session combine (merge two selected sessions) from the dashboard.
- Configurable server settings via admin panel (host, port, data dir, min session duration, merge gap).
- Share card (`/share`) as an SVG image with playtime stats.
- Calendar heatmap view and per-day session breakdown.
- Time heatmap widget showing play patterns by hour of day.
- Stats: total playtime, session count, days played, longest session, current streak, average session/day.
- Device management panel: edit name/type/color, rotate token, delete with reassign or full delete.

### Changed
- Data storage migrated from `data.json` to SQLite database (`nte.db`).
- Dashboard fully rebuilt in vanilla JS/CSS (no frameworks).

---

[2.2.1]: https://github.com/PJ289/NTE-time-tracker/releases/tag/v2.2.1
[2.2.0]: https://github.com/PJ289/NTE-time-tracker/releases/tag/v2.2.0
[2.1.0]: https://github.com/PJ289/NTE-time-tracker/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/PJ289/NTE-time-tracker/releases/tag/v2.0.0
