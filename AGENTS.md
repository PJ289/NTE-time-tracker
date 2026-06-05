# Agent Notes

## Windows `nte-tracker.exe` / Node SEA

- Do not convert the generated Node SEA executable to `IMAGE_SUBSYSTEM_WINDOWS_GUI`. In this project that made the SEA binary exit/crash at startup. Keep the executable as a console subsystem binary and let `tracker.js` relaunch itself hidden for normal `.exe` runs.
- Do not use `rcedit` for this build. It hung or failed when patching the SEA executable. Use the current `resedit`/`pe-library` approach in `build-exe.ps1` for icon resources.
- Do not add repo-local helper scripts for icon patching unless they are intentionally committed. Temporary JS used by the build should stay under `%TEMP%`.
- If Explorer still shows the Node icon after a successful build, first verify the executable resource (`IconGroupEntry`) and consider Windows icon cache/old file handle effects before changing the build again.
- Dashboard assets needed by the standalone executable must be listed in `sea-config.json` and read via `node:sea` assets; otherwise the `.exe` warns about missing `sw.js`, manifest, and icons when run outside the source tree.
- Do not launch tray GUI helpers with hidden PowerShell WinForms. `windowsHide` / `-WindowStyle Hidden` can hide the form itself. The current approach uses temporary HTA files launched with `mshta.exe` for logs/settings windows without a console.
- Do not use `exec('notepad.exe ...')` from tray actions; it can create a stray `cmd.exe` window and still fail to show Notepad from the hidden SEA process.
- `nte-tracker.exe` is expected to be around 80-90 MB because it embeds the Node runtime; do not chase size reductions unless changing packaging architecture.
