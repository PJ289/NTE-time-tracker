# Neverness to Everness Playtime Tracker

A lightweight, automatic game time tracker for Neverness to Everness (NTE) that runs silently in the background and tracks your total playtime.

## Table of Contents

- [What It Does](#what-it-does)
- [How It Works](#how-it-works)
- [PC Client (Windows)](#pc-client-windows)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Batch scripts (`.bat`)](#batch-scripts-bat)
  - [Configure `.env.client`](#configure-envclient)
  - [Verify the installation](#verify-the-installation)
  - [Day-to-day usage](#day-to-day-usage)
  - [Testing manually](#testing-manually)
  - [Uninstalling](#uninstalling)
- [Server Mode](#server-mode)
  - [Quick start (Node.js)](#quick-start-nodejs)
  - [Docker](#docker-server)
  - [Environment variables (server)](#environment-variables-server)
  - [Device management](#device-management-server-dashboard)
  - [Legacy JSON migration](#legacy-json-migration)
- [Mobile dashboard (PWA)](#mobile-dashboard-pwa)
- [Android (Tasker)](#android-tasker)
- [Manual sessions](#manual-sessions)
- [Data Storage](#data-storage)
- [Troubleshooting](#troubleshooting)
- [Technical Details](#technical-details)
- [File Structure](#file-structure)
- [License](#license)

---

## What It Does

- **Automatic tracking**: Monitors the `HTGame.exe` process and automatically tracks how long you play
- **Live dashboard**: Opens a real-time dashboard in your browser when the game starts, with a live timer, session history, and "NOW PLAYING" banner — updates instantly via Server-Sent Events, no page reloads
- **Session notifications**: Shows a Windows toast notification when you close the game, displaying your session time and total playtime
- **Playtime log**: Generates a human-readable `playtime.txt` with sessions grouped by date
- **Crash recovery**: Safely handles unexpected shutdowns or crashes without losing your data
- **Zero maintenance**: Once installed, it runs automatically on login and requires no user interaction
- **Optional server sync**: Upload sessions to a central server (PC + Android) when `NTE_SERVER_URL` is configured
- **Mobile-friendly dashboard (PWA)**: Install the dashboard on your phone’s home screen — works with the [server](#server-mode) and the local PC dashboard at `127.0.0.1`

## How It Works

The tracker polls every 5 seconds to check if `HTGame.exe` is running. When the game starts, it begins timing the session and opens a dashboard at `http://127.0.0.1:27183`. When the game closes, it saves the session data and shows a notification with your playtime statistics.

- **Local-only mode** (default): All data stays on your PC in `%LOCALAPPDATA%\nte-tracker\`.
- **Client + server mode**: If you create `.env.client` with `NTE_SERVER_URL`, the PC still tracks locally but also syncs sessions to your server dashboard.

---

## PC Client (Windows)

> **New to this?** Follow the sections below in order. You do **not** need programming knowledge for a standard install.  
> **Only syncing with a server?** You still install the client first, then add [`.env.client`](#configure-envclient).

### Prerequisites

#### Install Node.js (one time)

Node.js runs the tracker in the background.

1. Go to [https://nodejs.org](https://nodejs.org).
2. Download the **LTS** version (green button on the left, `.msi` installer).
3. Run the installer → **Next** through every screen → keep defaults → **Install**.
4. If Windows asks to allow changes → **Yes** → **Finish**.

**(Optional) Verify:** press `Win + R`, type `cmd`, Enter, then:

```bash
node --version
```

You should see something like `v20.11.0`.

### Installation

#### 1. Download the project

1. On GitHub, click the green **`< > Code`** button → **Download ZIP**.
2. Extract the ZIP to a permanent folder, for example:
   ```
   C:\Users\<YourName>\Documents\nte-time-tracker
   ```
   Avoid **Desktop** or **Downloads** — Windows may clean those folders and break the scheduled task path.

3. Open the folder. You should see `setup.bat`, `tracker.js`, `launcher.vbs`, and this `README.md`.

#### 2. Run an installer `.bat`

| Script | What it does |
|--------|----------------|
| **`setup.bat`** (recommended) | Registers auto-start on login **and** starts the tracker immediately |
| **`install.bat`** | Registers auto-start only — does **not** start the tracker now |

**How to run (both scripts):**

1. **Right-click** `setup.bat` (or `install.bat`) → **Run as administrator**.
2. Click **Yes** when Windows asks for permission.
3. A console window appears briefly — that is normal.

**After `setup.bat`:** your browser should open `http://127.0.0.1:27183`. If not, open that URL manually.

**After `install.bat` only:** start the tracker by double-clicking `launcher.vbs`, or log out and back in.

The tracker is now registered as a Windows scheduled task named `NTETracker` and will start on every login.

#### 3. (Optional) Configure server sync

Only if you run the [server](#server-mode) and want this PC to upload sessions → see [Configure `.env.client`](#configure-envclient).

### Batch scripts (`.bat`)

All `.bat` files live in the **same folder** as `tracker.js` (your extracted project folder).

| File | Admin required? | Purpose |
|------|-----------------|--------|
| **`setup.bat`** | Yes | Create scheduled task + launch tracker now |
| **`install.bat`** | Yes | Create scheduled task only (no launch) |
| **`uninstall.bat`** | Yes | Remove scheduled task (keeps your playtime data) |
| **`sync.bat`** | No | Force a one-time sync to the server (needs `.env.client` with `NTE_SERVER_URL`) |

**Typical workflow**

```
First time on this PC     →  setup.bat (as administrator)
Want sync without reinstall →  edit .env.client, then sync.bat or restart tracker
Remove auto-start         →  uninstall.bat (as administrator)
```

**Manual start without reinstalling:** double-click `launcher.vbs` (runs silently, no console window).

### Configure `.env.client`

#### Do I need this file?

| Goal | Need `.env.client`? |
|------|---------------------|
| Track playtime only on this PC | **No** — skip this section |
| Send sessions to your [server](#server-mode) dashboard | **Yes** |

The tracker reads **`.env.client` first**, then `.env` if present. Variables are loaded from the project folder (next to `setup.bat`), not from `%LOCALAPPDATA%`.

#### Create the file (Windows)

1. Open your project folder in File Explorer (where `setup.bat` is).
2. Open **Notepad**.
3. Paste the template below and edit the values (see tables).
4. **File → Save As**
   - **File name:** `.env.client` (include the leading dot)
   - **Save as type:** **All Files (*.*)**
   - **Location:** the project folder (same folder as `setup.bat`)
5. Save. If you see `env.client.txt`, the type was wrong — fix the extension.
6. Restart the tracker: log off/on, or run `setup.bat` again, or end `node.exe` running `tracker.js` in Task Manager and double-click `launcher.vbs`.

#### Minimal template (server sync)

Replace `192.168.1.10` with your server’s LAN IP and match the port from your server `.env` (Docker default is **28183**).

```env
# Required for server sync
NTE_SERVER_URL=http://192.168.1.10:28183

# Optional — sensible defaults are applied if omitted
# NTE_DEVICE_NAME=My Gaming PC
# NTE_DEVICE_TYPE=pc
# NTE_DEVICE_AUTO_REGISTER=1
# NTE_SYNC_ON_START=1
# NTE_SYNC_ON_END=1
# NTE_LOCAL_DASHBOARD=1
```

On first successful sync, credentials are saved automatically to:

```
%LOCALAPPDATA%\nte-tracker\client.json
```

You usually **do not** need to edit `client.json` by hand.

#### Link this PC to existing “legacy” data on the server

If the server already imported old local JSON as **PC (Legacy)**, use a fixed device instead of auto-register:

1. Find the legacy device id in server logs: `Legacy device created: <deviceId>`
2. Create a token (replace placeholders):

   ```bash
   curl -X POST "http://<server-ip>:28183/api/devices/<deviceId>/token" -H "x-admin-token: <ADMIN_TOKEN>"
   ```

3. Add to `.env.client`:

   ```env
   NTE_SERVER_URL=http://192.168.1.10:28183
   NTE_DEVICE_ID=<deviceId>
   NTE_DEVICE_TOKEN=<token>
   NTE_DEVICE_AUTO_REGISTER=0
   ```

4. Run **`sync.bat`** or restart the tracker.

#### Client environment variables (reference)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NTE_SERVER_URL` | For sync | *(empty)* | Server base URL, e.g. `http://192.168.1.10:28183` (no trailing slash) |
| `NTE_DEVICE_NAME` | No | `<hostname> (PC)` | Label shown on the server dashboard |
| `NTE_DEVICE_TYPE` | No | `pc` | Device type sent to the server |
| `NTE_DEVICE_ID` | No | *(auto)* | Fixed device id (use with legacy / manual linking) |
| `NTE_DEVICE_TOKEN` | No | *(auto)* | Device token (pair with `NTE_DEVICE_ID`) |
| `NTE_DEVICE_IS_TEST` | No | `0` | Set to `1` to mark as test device |
| `NTE_DEVICE_AUTO_REGISTER` | No | `1` | `1` = register on first sync; `0` = use only `NTE_DEVICE_ID` + token |
| `NTE_SYNC_ON_START` | No | `1` | Sync when the tracker starts |
| `NTE_SYNC_ON_END` | No | `1` | Sync after each gaming session |
| `NTE_LOCAL_DASHBOARD` | No | `1` | `1` = keep local dashboard at `http://127.0.0.1:27183` |

Flags accept `1`, `true`, `yes`, or `y` (case-insensitive).

#### Other configuration (local playtime)

To add playtime from **before** you installed the tracker, edit `initialOffset` in `tracker.js` (seconds). See [Data Storage → Initial Offset](#initial-offset).

### Verify the installation

- Dashboard loads at [http://127.0.0.1:27183](http://127.0.0.1:27183) (zero sessions before first play is normal).
- **Task Manager** (`Ctrl + Shift + Esc`) → **Details** → look for `node.exe` running `tracker.js`.
- Launch NTE → **NOW PLAYING** appears on the dashboard → close the game → Windows toast with session time.

If using server sync: open the server dashboard and confirm your PC appears under **Devices** after a session or after running `sync.bat`.

### Day-to-day usage

- Runs silently in the background (no window).
- Dashboard opens when the game starts; notifications when you close the game.
- No daily interaction required.

### Testing manually

To see log output when something fails:

1. Open the project folder in File Explorer.
2. Click the address bar, type `cmd`, Enter.
3. Run:

   ```bash
   node tracker.js
   ```

Start/stop the game and watch the console. Close the window to stop the tracker.

Force server sync from the command line:

```bash
node tracker.js --sync
```

(or double-click **`sync.bat`**)

### Uninstalling

1. **Right-click** `uninstall.bat` → **Run as administrator**.
2. Playtime data in `%LOCALAPPDATA%\nte-tracker\` is **kept** for reinstall.

---

## Server Mode

Cross-platform mode with **SQLite** storage. One server can collect sessions from multiple PCs and Android devices.

### Quick start (Node.js)

```bash
npm install
node server.js
```

Dashboard: `http://0.0.0.0:28183` (or the port you configure).  
PC clients: set `NTE_SERVER_URL` in [`.env.client`](#configure-envclient) to `http://<server-lan-ip>:<port>`.

### Docker (Server)

Run the server in a container with SQLite data in `./data/nte.db`.

**Requirements:** Docker Engine and the [Compose plugin](https://docs.docker.com/compose/install/linux/).

**Published image:** [`pj289/nte-time-tracker-nte-server:latest`](https://hub.docker.com/r/pj289/nte-time-tracker-nte-server) on Docker Hub.

#### Quick start (recommended)

You need `docker-compose.yml`, `.env.example`, and a `.env` file:

```bash
cp .env.example .env
# Edit .env — set NTE_ADMIN_TOKEN to a long random value

docker compose pull
docker compose up -d
```

Open `http://<server-ip>:28183` (or your `NTE_PORT`).

**Configuration is not baked into the image.** Edit `.env` before start or when changing token/port. You do **not** need `.env` to pull the image — only to run the container.

Place `.env` or `.env.server` in the **same folder as `docker-compose.yml`**. The server also reads `.env.server` / `.env` from the data directory inside the container. Check `docker compose logs` for lines starting with `Env:` and `Config:`.

To change settings: edit `.env`, then `docker compose up -d`.

**Without a `.env` file:**

```bash
export NTE_ADMIN_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
```

**Data:** `./data/nte.db` (created on first run).

**Custom host path:**

```yaml
volumes:
  - /opt/nte-time-tracker:/data
```

The entrypoint creates the directory and sets ownership for the `node` user (UID 1000) when possible.

**Logs:** `docker compose logs -f`  
**Update image:** `docker compose pull && docker compose up -d`

#### Build from source (developers)

```bash
docker compose up --build -d
```

#### Publish a new image (maintainers)

Build and push for **amd64** (NAS/x86) and **arm64** (Apple Silicon) so `docker compose pull` works everywhere:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t pj289/nte-time-tracker-nte-server:latest --push .
```

### Environment variables (server)

Server reads `.env.server` (and falls back to `.env`).

| Variable | Default | Description |
|----------|---------|-------------|
| `NTE_PORT` / `PORT` | `27183` (Node) / `28183` (Compose) | HTTP port |
| `NTE_HOST` | `0.0.0.0` | Bind address |
| `NTE_DATA_DIR` | *(platform)* | SQLite directory |
| `NTE_ADMIN_TOKEN` | — | Admin token (recommended) |
| `NTE_MIN_SESSION_SECONDS` | `30` | Minimum session length |
| `NTE_MERGE_GAP_SECONDS` | `120` | Auto-merge gap between sessions |

### Device management (server dashboard)

Open the **Devices** tab and paste the admin token. You can:

- Create devices and generate tokens
- Rename/recolor devices, toggle test mode
- Rotate tokens
- Delete devices (reassign or delete sessions)

### Legacy JSON migration

On first startup (Windows server host only), the server **auto-imports** once from:

```
%LOCALAPPDATA%\nte-tracker\data.json
```

Imported sessions are assigned to a **PC (Legacy)** device. Link your PC client with [Link this PC to existing “legacy” data](#link-this-pc-to-existing-legacy-data-on-the-server).

---

## Mobile dashboard (PWA)

The dashboard (`dashboard.html`) is a **Progressive Web App (PWA)**. You can add it to your phone’s home screen and open it like a native app (standalone UI, dark theme, safe areas for notched phones).

It is served by:

| Host | URL (example) |
|------|----------------|
| **Server** | `http://<server-lan-ip>:28183` |
| **PC client** (while tracker runs) | `http://127.0.0.1:27183` on the same device only |

Live stats still use the network: **Server-Sent Events** (`/events`) and API calls are never cached. The service worker only caches the UI shell (HTML, CSS, JS, icons).

### Install on your phone

1. Connect the phone to the same network as the server (or use the PC’s local URL only on that PC).
2. Open the dashboard URL in the browser.
3. Install or add to home screen:
   - **Android (Chrome):** menu → **Install app** / **Add to Home screen**
   - **iOS (Safari):** Share → **Add to Home Screen**

After install, open the icon on your home screen. Tabs, calendar, devices, and live **NOW PLAYING** behave the same as in the browser.

### HTTPS and LAN access

| Context | Install / PWA notes |
|---------|---------------------|
| `http://127.0.0.1:27183` on the **same PC** | Secure context — full PWA support in Chrome |
| `http://<lan-ip>:28183` from your **phone** | Works in the browser; **Chrome on Android** may only show **Install app** over **HTTPS** (or use **Add to Home screen**, which still works on many devices) |
| **iOS Safari** | **Add to Home Screen** usually works over HTTP on your LAN |

For reliable **Install app** on Android when using a LAN IP, put the server behind HTTPS (reverse proxy, Tailscale, Cloudflare Tunnel, etc.).

### PWA files (reference)

| File | Role |
|------|------|
| `manifest.webmanifest` | App name, colors, `standalone` display, icons |
| `sw.js` | Service worker — caches UI; live routes stay network-only |
| `icons/icon-192.png`, `icons/icon-512.png` | Home-screen icons |

Served by `server.js` and by the PC client’s built-in HTTP server when the local dashboard is enabled.

---

## Android (Tasker)

See [TASKER_SETUP.md](TASKER_SETUP.md) for step-by-step Android setup.

---

## Manual sessions

Use the **Manual Session** panel in the **All Sessions** tab on the server dashboard. Manual sessions are tagged in the table.

---

## Data Storage

### PC client (local)

```
%LOCALAPPDATA%\nte-tracker\
├── data.json      # Sessions and total playtime
├── client.json    # Server device credentials (if sync enabled)
├── queue.json     # Pending uploads (if sync enabled)
└── playtime.txt   # Human-readable log (also in project folder when tracker runs)
```

Example full path: `C:\Users\<You>\AppData\Local\nte-tracker\data.json`

**Ways to check playtime**

1. Local dashboard: `http://127.0.0.1:27183` (while tracker is running)
2. `playtime.txt` in the project folder
3. Windows notification when closing the game
4. Open `data.json` → `totalSeconds` and `sessions`

### Server (SQLite)

```
<NTE_DATA_DIR>/nte.db
```

### Initial offset

Set `initialOffset` (seconds) in `tracker.js` for playtime before installing the tracker. Default: `0`.

---

## Troubleshooting

### Is the tracker running?

**Task Manager** → **Details** → `node.exe` with `tracker.js` in the command line.

Or:

```bash
schtasks /query /tn "NTETracker"
```

### Dashboard does not load

- Confirm the tracker is running (above).
- Open [http://127.0.0.1:27183](http://127.0.0.1:27183) manually.
- If the port is busy, the tracker may use the next port — check output from `node tracker.js`.

### Notifications do not appear

- Enable Windows notifications; disable Focus Assist blocking them.
- Test with `node tracker.js` and start/stop the game.

### Server sync does not work

- Confirm `.env.client` is in the **project folder** (next to `tracker.js`), not in AppData.
- Check `NTE_SERVER_URL` (correct IP, port, no trailing slash).
- Run `sync.bat` or `node tracker.js --sync` and read console errors.
- On the server: verify firewall allows the port; check `docker compose logs`.

### PWA does not install from the phone

- Confirm you can open the dashboard in the mobile browser first (same Wi‑Fi, correct IP and port, firewall open).
- On **Android Chrome** over `http://192.168.x.x`, use **Add to Home screen** if **Install app** is missing — or serve the dashboard over **HTTPS** (see [Mobile dashboard (PWA)](#mobile-dashboard-pwa)).
- On **iOS**, use **Safari** (not all in-app browsers offer Add to Home Screen).
- After updating the server, close the installed app and reopen it so the service worker can refresh.

### Game not detected

- Process must be `HTGame.exe`.
- Node.js must be on PATH.
- Run `node tracker.js` and watch logs.

### Reset or adjust playtime

1. Stop the tracker (`node.exe` or uninstall scheduled task temporarily).
2. Edit `%LOCALAPPDATA%\nte-tracker\data.json` → `totalSeconds`.
3. Start again via `launcher.vbs` or login.

---

## Technical Details

### Dependencies

**No npm packages** for the PC client — built-in Node.js modules only (`child_process`, `fs`, `path`, `http`).

### Resource usage (PC client)

- **Memory:** ~35 MB
- **CPU:** Negligible (5 s poll interval)
- **Disk:** &lt;1 MB typical
- **Network:** Local dashboard on `127.0.0.1` only; optional outbound sync if `NTE_SERVER_URL` is set

### Features

- Live dashboard (Server-Sent Events)
- PWA dashboard (manifest + service worker) for mobile home-screen install
- Interim saves every 60 s while playing
- Crash recovery on next startup
- Last 100 sessions in local JSON
- Silent launch via `launcher.vbs`

### Default settings (`tracker.js`)

| Setting | Value |
|---------|--------|
| Process | `HTGame.exe` |
| Poll interval | 5 s |
| Interim save | 60 s |
| Min session | 30 s |
| Dashboard port | 27183 |

---

## File Structure

```
nte-time-tracker/
├── tracker.js          # PC client (tracking + optional sync)
├── server.js           # Central server (optional)
├── dashboard.html/css/js
├── manifest.webmanifest
├── sw.js               # PWA service worker
├── icons/              # PWA icons (192, 512)
├── launcher.vbs        # Silent start (no console)
├── setup.bat           # Install + start now
├── install.bat         # Install only
├── uninstall.bat       # Remove scheduled task
├── sync.bat            # Force server sync
├── .env.client         # PC client config (you create this)
├── .env.example        # Docker / server example
├── docker-compose.yml
└── README.md
```

---

## License

Free to use and modify.
