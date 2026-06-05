# Neverness to Everness Playtime Tracker

A lightweight, automatic game time tracker for Neverness to Everness (NTE) that runs silently in the background and tracks your total playtime.

## Table of Contents

- [What It Does](#what-it-does)
- [How It Works](#how-it-works)
- [PC Client (Windows)](#pc-client-windows)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Standalone executable (`nte-tracker.exe`)](#standalone-executable-nte-trackerexe)
  - [System tray](#system-tray)
  - [Updates and releases](#updates-and-releases)
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
- [Changelog](CHANGELOG.md)

---

## What It Does

- **Automatic tracking**: Monitors the `HTGame.exe` process and automatically tracks how long you play
- **Live dashboard**: Opens a real-time dashboard in your browser when the game starts, with a live timer, session history, and "NOW PLAYING" banner — updates instantly via Server-Sent Events, no page reloads
- **Session notifications**: Shows a Windows toast notification when you close the game, displaying your session time and total playtime
- **Playtime log**: Generates a human-readable `playtime.txt` with sessions grouped by date
- **Crash recovery**: Safely handles unexpected shutdowns or crashes without losing your data
- **Zero maintenance**: Once installed, it runs automatically on login and requires no user interaction
- **Optional server sync**: Upload sessions to a central server (PC + Android) when `NTE_SERVER_URL` is configured
- **Standalone Windows executable**: Optional `nte-tracker.exe` build — runs without a separate Node.js install, with a system tray icon and one-click updates from GitHub Releases
- **Update notifications**: PC client checks GitHub once per day and shows a Windows toast when a newer stable release is available
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

You can run the PC client in one of two ways:

| Mode | Requires Node.js? | Best for |
|------|-------------------|----------|
| **Standalone `.exe`** (recommended) | No on the target PC | End users — download `nte-tracker.exe` from [GitHub Releases](https://github.com/PJ289/NTE-time-tracker/releases) |
| **Classic `tracker.js`** | Yes | Developers, or if you edit the source locally |

#### Install Node.js (classic mode only)

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

### Standalone executable (`nte-tracker.exe`)

The standalone build bundles Node.js and `tracker.js` into a single file. It is the recommended install path if you do not plan to edit the source.

#### Get the executable

1. Open [GitHub Releases](https://github.com/PJ289/NTE-time-tracker/releases).
2. Download **`nte-tracker.exe`** from the release you want (stable or pre-release).
3. Place it in a permanent folder together with **`.env.client`** (optional, for server sync), for example:
   ```
   C:\Users\<YourName>\Documents\nte-tracker\
   ├── nte-tracker.exe
   └── .env.client          # optional
   ```

> **Note:** The `.exe` is built by GitHub Actions when a release is **published** — a push to `dev` or `main` updates Docker images but does **not** produce the executable automatically. See [Updates and releases](#updates-and-releases).

#### Install auto-start

**Option A — from the executable (recommended):**

1. Open **Command Prompt as administrator** in the folder containing `nte-tracker.exe`.
2. Run:
   ```bat
   nte-tracker.exe --install
   ```
3. Log out and back in (or run `nte-tracker.exe` once to start immediately).

**Option B — using the batch helpers:**

If you also have `install.bat` / `setup.bat` from the repo in the same folder, they detect `nte-tracker.exe` and call `--install` for you (same as Option A).

#### Uninstall auto-start

```bat
nte-tracker.exe --uninstall
```

(or **`uninstall.bat`** as administrator — it delegates to the `.exe` when present)

Playtime data in `%LOCALAPPDATA%\nte-tracker\` is kept.

#### Build locally (developers)

Requires **Node.js 22+** on the build machine:

```powershell
.\build-exe.ps1
```

Output: `nte-tracker.exe` in the project root. Requires `npx` (for `@postject/cli`). On Windows, the Windows SDK `signtool` helps remove the Node binary signature before injection; without it, the script warns and may still work.

### System tray

When running as **`nte-tracker.exe`**, a tray icon appears in the notification area (PowerShell companion process — no extra npm packages).

| Action | How |
|--------|-----|
| Open dashboard | Double-click the icon, or **Open Dashboard** in the menu |
| View tracker log | **Open Logs** — dark log viewer with auto-refresh (`%LOCALAPPDATA%\nte-tracker\tracker.log`) |
| Edit server sync config | **Edit Config** — settings form for `.env.client` (creates the file if missing; shows Device ID/token from `client.json` when applicable) |
| Check for updates | **Check for Update** |
| Restart tracker | **Restart** |
| Exit | **Close** |

To enable the tray while developing with `node tracker.js`, set in `.env.client`:

```env
NTE_TRAY=1
```

### Updates and releases

#### What the client checks automatically

Once per day at startup, the tracker calls GitHub's **`/releases/latest`** API and compares versions. If a **newer stable release** is available:

- A **Windows toast** appears (script and `.exe` modes).
- In **`.exe` mode**, if the release includes an **`nte-tracker.exe` asset**, the tray can download and replace the running executable automatically (via **Check for Update** when an update is pending).

> **Pre-releases** (`This is a pre-release` on GitHub) are **not** returned by `/releases/latest`. To test a dev build, download `nte-tracker.exe` manually from that pre-release page.

#### How releases are published (maintainers)

| Trigger | Docker Hub | `nte-tracker.exe` |
|---------|------------|-------------------|
| Push to `dev` | `:dev` | — |
| Push to `main` | `:latest` | — |
| Git tag `vX.Y.Z` on `main` | `:latest` + `:X.Y.Z` | — |
| **Publish GitHub Release** | — | Built on `windows-latest`, uploaded as release asset |
| **Actions → Build Tracker EXE → Run workflow** | — | Artifact only (30 days); optional upload to a release |

**Typical dev workflow**

1. Merge or push to **`dev`** → Docker image **`pj289/nte-time-tracker-nte-server:dev`** is updated automatically.
2. Create a **Draft release** on GitHub from `dev`, tag e.g. **`v2.3.0-dev`**, mark **Pre-release**, publish → CI attaches **`nte-tracker.exe`**.
3. Test the downloaded `.exe` on a Windows PC.

**Stable release**

1. Merge `dev` → `main`, bump version in `package.json` (remove `-dev` suffix), update `CHANGELOG.md`.
2. Tag **`vX.Y.Z`** on `main` (e.g. **`v2.2.0`**) and publish a **normal** (non–pre-release) GitHub Release → Docker `:latest` + `:X.Y.Z`, and **`nte-tracker.exe`** for clients that use auto-update.

Workflow files: `.github/workflows/docker-publish.yml`, `.github/workflows/build-tracker-exe.yml`.

> **EXE upload failed with `Resource not accessible by integration`?** In the repo go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**, then re-run **Build Tracker EXE** (Actions tab → failed run → Re-run, or run manually with **Upload to latest release** checked).

### Batch scripts (`.bat`)

All `.bat` files live in the **same folder** as `tracker.js` or `nte-tracker.exe` (your project folder).

| File | Admin required? | Purpose |
|------|-----------------|--------|
| **`setup.bat`** | Yes | Create scheduled task + launch tracker now |
| **`install.bat`** | Yes | Create scheduled task only (no launch). Uses `nte-tracker.exe --install` if the `.exe` is present |
| **`uninstall.bat`** | Yes | Remove scheduled task (keeps your playtime data). Uses `nte-tracker.exe --uninstall` if present |
| **`sync.bat`** | No | Force a one-time sync to the server (needs `.env.client` with `NTE_SERVER_URL`) |
| **`restart.bat`** | No | Stop this project's tracker and start again. Starts `nte-tracker.exe` if present, else `launcher.vbs` |

**Typical workflow**

```
First time (ZIP + Node)     →  setup.bat (as administrator)
First time (.exe)           →  nte-tracker.exe --install (as administrator)
Changed tracker code/env    →  restart.bat
Want sync without reinstall →  edit .env.client, then sync.bat or restart.bat
Remove auto-start           →  uninstall.bat or nte-tracker.exe --uninstall (as administrator)
```

**Manual start without reinstalling:** double-click `nte-tracker.exe`, or `launcher.vbs` in classic mode (runs silently). If the tracker is already running, opening the dashboard again is enough.

### Restart the PC client (apply code or config changes)

After editing `tracker.js`, `.env.client`, or replacing `nte-tracker.exe`, run **`restart.bat`** (no administrator required):

1. Stops the tracker for **this folder only** (via `stop-tracker.ps1` — matches `node.exe … tracker.js` or `nte-tracker.exe` in this path).
2. Waits one second, then starts `nte-tracker.exe` if present, otherwise `launcher.vbs`.

Use this instead of ending every `node.exe` in Task Manager. Logging off also restarts the tracker if you use the scheduled task from `setup.bat` / `install.bat` / `--install`.

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
6. Restart the tracker: run **`restart.bat`**, or log off/on, or end the `node.exe` for this project's `tracker.js` in Task Manager and double-click `launcher.vbs`.

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

You usually **do not** need to edit `client.json` by hand. The tray **Edit Config** window shows these credentials when they are not set in `.env.client`.

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

4. Run **`sync.bat`** or **`restart.bat`**.

#### Client environment variables (reference)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NTE_SERVER_URL` | For sync | *(empty)* | Server base URL, e.g. `http://192.168.1.10:28183` (no trailing slash). HTTPS with a public/trusted cert is fine; see [PC sync and self-signed HTTPS](#pc-sync-and-self-signed-https) for local certs |
| `NTE_DEVICE_NAME` | No | `<hostname> (PC)` | Label shown on the server dashboard |
| `NTE_DEVICE_TYPE` | No | `pc` | Device type sent to the server |
| `NTE_DEVICE_ID` | No | *(auto)* | Fixed device id (use with legacy / manual linking) |
| `NTE_DEVICE_TOKEN` | No | *(auto)* | Device token (pair with `NTE_DEVICE_ID`) |
| `NTE_DEVICE_IS_TEST` | No | `0` | Set to `1` to mark as test device |
| `NTE_DEVICE_AUTO_REGISTER` | No | `1` | `1` = register on first sync; `0` = use only `NTE_DEVICE_ID` + token |
| `NTE_SYNC_ON_START` | No | `1` | Sync when the tracker starts |
| `NTE_SYNC_ON_END` | No | `1` | Sync after each gaming session |
| `NTE_LOCAL_DASHBOARD` | No | `1` | `1` = keep local dashboard at `http://127.0.0.1:27183` |
| `NTE_TRAY` | No | `0` | `1` = show system tray when running `node tracker.js` (always on for `nte-tracker.exe`) |
| `NTE_CONSOLE_LOG` | No | `0` | `1` = show a console window with live log output (useful for debugging; `.exe` logs to file by default) |

Flags accept `1`, `true`, `yes`, or `y` (case-insensitive).

#### Other configuration (local playtime)

To add playtime from **before** you installed the tracker, edit `initialOffset` in `tracker.js` (seconds). See [Data Storage → Initial Offset](#initial-offset).

### Verify the installation

- Dashboard loads at [http://127.0.0.1:27183](http://127.0.0.1:27183) (zero sessions before first play is normal).
- **Task Manager** → **Details** → `nte-tracker.exe`, or `node.exe` running `tracker.js` (classic mode).
- **`.exe` mode:** tray icon in the notification area; balloon on first start.
- Launch NTE → **NOW PLAYING** on the dashboard → close the game → Windows toast with session time.

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

1. **Right-click** `uninstall.bat` → **Run as administrator**, **or** run `nte-tracker.exe --uninstall` as administrator.
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
**Development image:** `pj289/nte-time-tracker-nte-server:dev` — built from the `dev` branch; may be unstable.

> **For CI/CD maintainers:** add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as secrets in the GitHub repo settings so the Actions workflow can push to Docker Hub automatically.

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

**Logs:** `docker compose logs -f` (timestamps use the container timezone; default `Europe/Madrid` via `TZ` in `docker-compose.yml`, override in `.env`)  
**Update image:** `docker compose pull && docker compose up -d`

#### Build from source (developers)

```bash
docker compose up --build -d
```

#### Branches, Docker tags, and releases

| Branch / trigger | Docker Hub tag | GitHub Release | `nte-tracker.exe` |
|-----------------|----------------|----------------|-------------------|
| Push to `main` | `:latest` | — | — |
| Push to `dev` | `:dev` | — | — |
| Git tag `vX.Y.Z` on `main` | `:latest` + `:X.Y.Z` | Stable release | Built when release is **published** |
| Publish pre-release on `dev` | *(already `:dev` from push)* | Pre-release | Built when release is **published** |

- **`latest`** — production-ready; use this in your `docker-compose.yml` (default).
- **`dev`** — current development builds; may contain unreleased features or bugs. To try it: change `image:` in `docker-compose.yml` to `pj289/nte-time-tracker-nte-server:dev`, then `docker compose pull && docker compose up -d`.

Docker images are published automatically by **GitHub Actions** (`.github/workflows/docker-publish.yml`) on push — no manual `docker buildx` needed.

The **Windows executable** is built separately when you **publish a GitHub Release** (`.github/workflows/build-tracker-exe.yml`). See [Updates and releases](#updates-and-releases) for the full maintainer workflow.

#### Publish a new image (maintainers)

Builds and pushes are handled by CI on push/tag. To publish manually for both **amd64** (NAS/x86) and **arm64** (Apple Silicon):

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
| `TZ` | `Europe/Madrid` (Compose) | IANA timezone for server log timestamps in Docker |

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

### Secure context for PWA install (Android Chrome)

Chrome on Android only offers the full **Install app** flow in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts): **HTTPS**, `localhost`, or `127.0.0.1`. A plain `http://192.168.x.x:28183` URL from your phone is **not** secure by default.

| Context | Install / PWA notes |
|---------|---------------------|
| `http://127.0.0.1:27183` on the **same PC** | Secure context — full PWA support in Chrome |
| `http://<lan-ip>:28183` from your **phone** | Browsing works; **Install app** may be missing unless you use one of the options below |
| **iOS Safari** | **Add to Home Screen** usually works over HTTP on your LAN (no extra setup) |

Pick **one** of these approaches for Android when using a LAN IP:

#### Option A: HTTP without HTTPS (Chrome flag, per device)

This treats your local HTTP origin as secure **only on that phone** (useful for home lab / testing).

1. On the Android phone, open **`chrome://flags`** in Chrome.
2. Search for **`Insecure origins treated as secure`**.
3. Set it to **Enabled**.
4. In the text field, add the **exact** dashboard URL, including protocol and port, for example:
   ```
   http://192.168.1.10:28183
   ```
   Multiple origins can be comma-separated if needed.
5. Tap **Relaunch** so Chrome restarts and applies the flag.
6. Open that URL again → menu → **Install app** / **Add to Home screen**.

**Notes:**

- The URL must match what you type in the address bar (same IP, port, and `http` vs `https`).
- The flag is per browser profile; reset or OS updates may clear it.
- This does **not** encrypt traffic — only for trusted home networks.

#### Option B: HTTPS locally (Nginx + self-signed certificate)

Put **Nginx** (or another reverse proxy) in front of the tracker server on port **28183**. Terminate TLS on the proxy; the Node server keeps listening on HTTP locally.

**1. Create a certificate (include your LAN IP in SAN)**

Replace `192.168.1.10` with your server’s IP. A cert without the correct **Subject Alternative Name (SAN)** will warn or fail when opening `https://192.168.1.10/`.

```bash
openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
  -keyout nte-dashboard.key \
  -out nte-dashboard.crt \
  -subj "/CN=NTE Dashboard" \
  -addext "subjectAltName=IP:192.168.1.10,DNS:nte-dashboard.local"
```

**2. Nginx site (example)**

Adjust paths, IP, and upstream port (`28183` is the default Docker/Compose port; Node-only server may use `27183`).

```nginx
server {
    listen 443 ssl;
    server_name 192.168.1.10;

    ssl_certificate     /etc/nginx/certs/nte-dashboard.crt;
    ssl_certificate_key /etc/nginx/certs/nte-dashboard.key;

    location / {
        proxy_pass http://127.0.0.1:28183;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for live dashboard (Server-Sent Events)
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

Enable the site, reload Nginx, and allow **443** (and keep **28183** only on localhost if you want TLS only via Nginx).

**3. On the phone**

1. Open `https://192.168.1.10/` (same host as in the cert SAN).
2. Accept the **certificate warning** (self-signed) — Advanced → Proceed, or install/trust the CA if you use your own PKI.
3. Confirm the dashboard loads, then **Install app** (if the CA is not trusted you need to do the same like [here](#option-a-http-without-https-chrome-flag-per-device)).

Important note: If the certificate is not trusted you need to enable "Trust any certificate" on Tasker. More info about that [here](TASKER_SETUP.md/#other-settings)

**4. PC client sync (optional)**

With a **public hostname and a trusted certificate** (Let’s Encrypt, Cloudflare, Tailscale Serve, etc.), set `NTE_SERVER_URL` to your HTTPS base URL — same as HTTP, no extra steps.

#### PC sync and self-signed HTTPS

This only applies to **local / homelab** setups (e.g. Nginx on port 443 with an auto-generated cert). Browsers and Tasker can be configured to accept that cert; the **Windows tracker** uses Node `fetch`, which **rejects** self-signed TLS unless the PC trusts the certificate (there is no “continue anyway” like in Chrome).

Typical split (recommended if you do not want to touch Windows trust stores):

- **Phone / PWA:** `https://<lan-ip>/` via Nginx (Option B above).
- **PC sync:** `NTE_SERVER_URL=http://<lan-ip>:28183` — direct to the Node server, bypassing Nginx.

If you still want PC sync through HTTPS with a self-signed cert: import the `.crt` into Windows **Trusted Root Certification Authorities**, or set `NODE_EXTRA_CA_CERTS` to the cert path in `start.bat` / `sync.bat`. Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0` except on isolated lab machines.

**Other HTTPS options:** Tailscale, Cloudflare Tunnel, or Let’s Encrypt on a public hostname avoid this issue entirely — any HTTPS URL the client trusts works for PWA install and sync.

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

To force a one-time upload of pending sessions on the phone, open and close the NTE game (details in TASKER_SETUP.md). On Windows, use **`sync.bat`** instead.

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

**Task Manager** → **Details** → look for **`nte-tracker.exe`**, or **`node.exe`** with `tracker.js` in the command line (classic mode).

Or:

```bash
schtasks /query /tn "NTETracker"
```

### Tray icon missing

- **`.exe` mode:** the icon should appear within a few seconds. Check hidden icons in the taskbar overflow (^).
- **Classic mode:** set `NTE_TRAY=1` in `.env.client` and restart.
- A brief PowerShell window may flash on first start — that is the tray companion process.

### Auto-update did not run

- Auto-replace only works in **`nte-tracker.exe`** mode, not with `node tracker.js`.
- GitHub **`/releases/latest`** ignores **pre-releases** — stable releases only trigger the daily check.
- The release must include an asset named like **`nte-tracker.exe`**.

### Dashboard does not load

- Confirm the tracker is running (above).
- Open [http://127.0.0.1:27183](http://127.0.0.1:27183) manually.
- If the port is busy, the tracker may use the next port — check output from `node tracker.js`.

### Notifications do not appear

- Enable Windows notifications; disable Focus Assist blocking them.
- Test with `node tracker.js` and start/stop the game.

### Server sync does not work

- Confirm `.env.client` is in the **project folder** (next to `tracker.js` or `nte-tracker.exe`), not in AppData.
- Device credentials after auto-register are in **`%LOCALAPPDATA%\nte-tracker\client.json`** — empty Device ID/token in **Edit Config** does not mean sync is disabled if that file exists.
- A **401** in the log usually means the server rejected the stored token (server recreated, URL changed, token rotated). With auto-register enabled, restart the tracker to re-register; or delete `client.json` and restart.
- Check `NTE_SERVER_URL` (correct IP, port, no trailing slash).
- If sync uses **HTTPS with a local self-signed cert**, Node may fail with certificate errors — use HTTP to the Node port or trust the cert on Windows ([PC sync and self-signed HTTPS](#pc-sync-and-self-signed-https)).
- Run `sync.bat` or `node tracker.js --sync` and read console errors.
- On the server: verify firewall allows the port; check `docker compose logs`.

### PWA does not install from the phone

- Confirm you can open the dashboard in the mobile browser first (same Wi‑Fi, correct IP and port, firewall open).
- On **Android Chrome** over `http://192.168.x.x`, **Install app** needs a secure context — use [Option A (Chrome flag)](#option-a-http-without-https-chrome-flag-per-device) or [Option B (HTTPS / Nginx)](#option-b-https-locally-nginx--self-signed-certificate), or **Add to Home screen** as a lighter fallback.
- If using **HTTPS** with a self-signed cert, open the site once and accept the warning; ensure the cert **SAN** includes your LAN IP.
- If live stats freeze behind Nginx, check `proxy_buffering off` and long `proxy_read_timeout` for `/events` (see [Option B](#option-b-https-locally-nginx--self-signed-certificate)).
- On **iOS**, use **Safari** (not all in-app browsers offer Add to Home Screen).
- After updating the server, close the installed app and reopen it so the service worker can refresh.

### Game not detected

- Process must be `HTGame.exe`.
- **Classic mode:** Node.js must be on PATH.
- Run `node tracker.js` (classic), use tray **Open Logs** (`.exe` mode), or read `%LOCALAPPDATA%\nte-tracker\tracker.log`.

### Reset or adjust playtime

1. Stop the tracker: `powershell -NoProfile -ExecutionPolicy Bypass -File stop-tracker.ps1`, or **`restart.bat`** if you will start it again right away.
2. Edit `%LOCALAPPDATA%\nte-tracker\data.json` → `totalSeconds`.
3. Start again via **`restart.bat`**, `nte-tracker.exe`, `launcher.vbs`, or login.

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
- Standalone `.exe` with system tray (SEA build), log viewer, and config editor
- Daily GitHub release check + Windows update toast; auto-update in `.exe` mode
- Local-time log timestamps on PC client and server
- Interim saves every 60 s while playing
- Crash recovery on next startup
- Last 100 sessions in local JSON
- Silent launch via `launcher.vbs` (classic) or `nte-tracker.exe` (standalone)

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
├── tracker.js          # PC client source (tracking + optional sync)
├── nte-tracker.exe       # Standalone PC client (build output — not in git)
├── build-exe.ps1         # Build nte-tracker.exe locally (Node SEA)
├── sea-config.json       # SEA configuration for build-exe.ps1
├── server.js             # Central server (optional)
├── dashboard.html/css/js
├── manifest.webmanifest
├── sw.js                 # PWA service worker
├── icons/                # PWA icons (192, 512)
├── launcher.vbs          # Silent start — classic mode (no console)
├── stop-tracker.ps1      # Stop only this project's tracker (used by restart.bat)
├── restart.bat           # Stop + start tracker (apply code/config changes)
├── setup.bat             # Install + start now
├── install.bat           # Install only (prefers nte-tracker.exe if present)
├── uninstall.bat         # Remove scheduled task (prefers nte-tracker.exe)
├── sync.bat              # Force server sync
├── .env.client           # PC client config (you create this)
├── .env.example          # Docker / server example
├── docker-compose.yml
├── CHANGELOG.md
├── .github/workflows/
│   ├── docker-publish.yml
│   └── build-tracker-exe.yml
├── LICENSE
├── NOTICE
└── README.md
```

---

## License

Licensed under the [MIT License](LICENSE).

- **Original tracker:** Copyright (c) 2026 Eliška Šindelářová (initial commit, 2026-05-04)
- **This fork:** Copyright (c) 2026 PJ289 — server mode, Docker, PWA, Tasker, and related work

See [NOTICE](NOTICE) for attribution details.
