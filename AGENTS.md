# Agent Notes

## Windows `nte-tracker.exe` / Node SEA

- Do not convert the generated Node SEA executable to `IMAGE_SUBSYSTEM_WINDOWS_GUI`. In this project that made the SEA binary exit/crash at startup. Keep the executable as a console subsystem binary and let `tracker.js` relaunch itself hidden for normal `.exe` runs.
- Do not use `rcedit` for this build. It hung or failed when patching the SEA executable. Use the current `resedit`/`pe-library` approach in `build-exe.ps1` for icon resources.
- Do not add repo-local helper scripts for icon patching unless they are intentionally committed. Temporary JS used by the build should stay under `%TEMP%`.
- If Explorer still shows the Node icon after a successful build, first verify the executable resource (`IconGroupEntry`) and consider Windows icon cache/old file handle effects before changing the build again.
- Dashboard assets needed by the standalone executable must be listed in `sea-config.json` and read via `node:sea` assets; otherwise the `.exe` warns about missing `sw.js`, manifest, and icons when run outside the source tree.
- Do not launch tray GUI helpers with hidden PowerShell WinForms. `windowsHide` / `-WindowStyle Hidden` can hide the form itself. HTA logs/settings must not use `windowsHide: true` on `mshta.exe` directly (the window will not appear). Launch via `cmd /c start mshta.exe` with `windowsHide` only on `cmd.exe`.
- The current approach uses temporary HTA files under `%LOCALAPPDATA%\\nte-tracker\\` for logs/settings windows without a console on the tracker process.
- Do not use `exec('notepad.exe ...')` from tray actions; it can create a stray `cmd.exe` window and still fail to show Notepad from the hidden SEA process.
- `nte-tracker.exe` is expected to be around 80-90 MB because it embeds the Node runtime; do not chase size reductions unless changing packaging architecture.

## Releases: client (exe) vs server (Docker)

- Changes that affect the **PC client** (`tracker.js`, `sea-config.json`, `build-exe.ps1`, tray/install/update behavior, `.env.client` semantics) need a **new version** in `package.json`, a **`CHANGELOG.md` section** (e.g. `[2.2.2]`), and a **GitHub Release** with a rebuilt `nte-tracker.exe` asset so auto-update can pick it up.
- Changes that affect only the **server/dashboard** (`server.js`, `dashboard.js`, `dashboard.css`, Docker image) do **not** require an exe release; deploy with `docker compose pull` (or your registry workflow) on the host running the server.
- Do not fold unreleased client fixes into an already-shipped exe version string; bump the client version and document it before publishing.
