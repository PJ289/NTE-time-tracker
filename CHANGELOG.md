# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[2.1.0]: https://github.com/PJ289/NTE-time-tracker/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/PJ289/NTE-time-tracker/releases/tag/v2.0.0
