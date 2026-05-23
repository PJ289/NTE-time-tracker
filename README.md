# Neverness to Everness Playtime Tracker

A lightweight, automatic game time tracker for Neverness to Everness (NTE) that runs silently in the background and tracks your total playtime.

## What It Does

- **Automatic tracking**: Monitors the `HTGame.exe` process and automatically tracks how long you play
- **Live dashboard**: Opens a real-time dashboard in your browser when the game starts, with a live timer, session history, and "NOW PLAYING" banner — updates instantly via Server-Sent Events, no page reloads
- **Session notifications**: Shows a Windows toast notification when you close the game, displaying your session time and total playtime
- **Playtime log**: Generates a human-readable `playtime.txt` with sessions grouped by date
- **Crash recovery**: Safely handles unexpected shutdowns or crashes without losing your data
- **Zero maintenance**: Once installed, it runs automatically on login and requires no user interaction

## How It Works

The tracker polls every 5 seconds to check if `HTGame.exe` is running. When the game starts, it begins timing the session and opens a dashboard at `http://127.0.0.1:27183`. When the game closes, it saves the session data and shows a notification with your playtime statistics. All data is stored locally in JSON format.

## Server Mode (Experimental)

This repo now includes a **server-first** mode that is cross-platform and stores data in **SQLite**. The server can accept uploads from multiple devices (PC + Android) and serves the same dashboard UI.

### Quick Start

1. Install Node.js (same as above).
2. Install dependencies:

  ```bash
  npm install
  ```

3. Start the server:

  ```bash
  node server.js
  ```

The dashboard will be available on `http://0.0.0.0:28183` (or the port you set).

### Docker (Server)

Run the server in a container with SQLite data persisted on the host in `./data/nte.db`.

**Requirements:** Docker Engine and the [Compose plugin](https://docs.docker.com/compose/install/linux/) (typical on Linux servers).

**Published image:** [`pj289/nte-time-tracker-nte-server:latest`](https://hub.docker.com/r/pj289/nte-time-tracker-nte-server) on Docker Hub. `docker-compose.yml` uses this image by default — no local build required.

#### Quick start (recommended)

You only need `docker-compose.yml`, `.env.example`, and a `.env` file with your settings:

```bash
cp .env.example .env
# Edit .env — set NTE_ADMIN_TOKEN to a long random value

docker compose pull
docker compose up -d
```

Open the dashboard at `http://<server-ip>:28183` (or the port in `.env`).

**Configuration is not baked into the image.** Create or edit `.env` before starting (or when changing token/port). You do **not** need `.env` to pull or build the image — only when running the container.

Put `.env` or `.env.server` in the **same folder as `docker-compose.yml`** (recommended). The server also reads `.env.server` / `.env` from the data directory (e.g. `/opt/nte-time-tracker/.env.server` inside the container at `/data/.env.server`). On startup, check `docker compose logs` for lines starting with `Env:` and `Config:`.

To change settings later: edit `.env`, then `docker compose up -d` again.

**Without a `.env` file:**

```bash
export NTE_ADMIN_TOKEN="$(openssl rand -hex 32)"
docker compose up -d
```

**Data location:** `./data/nte.db` (created on first run).

**Custom host path (NAS / Dockage):** change only the left side of the volume mount; the path inside the container stays `/data`:

```yaml
volumes:
  - /opt/nte-time-tracker:/data
```

The image entrypoint creates the directory if needed and, when started as root, assigns ownership to the `node` user (UID 1000) so SQLite can write `nte.db`. You do not need to `chown` the folder manually in most setups. If your filesystem blocks `chown` on bind mounts, set host ownership to UID/GID `1000` instead.

**Logs:** `docker compose logs -f`

**Update to a newer published image:** `docker compose pull && docker compose up -d`

PC and Android clients should set `NTE_SERVER_URL` to `http://<host-ip>:28183` on your LAN.

#### Build from source (developers)

If you are hacking on the server code, build locally instead of pulling:

```bash
docker compose up --build -d
```

Compose builds from the `Dockerfile` and tags the result as `pj289/nte-time-tracker-nte-server:latest`.

#### Publish a new image (maintainers)

After building locally, tag the Compose image name and push (Docker Hub will not find a tag until you do this):

```bash
docker tag nte-time-tracker-nte-server:latest pj289/nte-time-tracker-nte-server:latest
docker push pj289/nte-time-tracker-nte-server:latest
```

### Environment Variables (Server)

Server reads `.env.server` (and falls back to `.env` if present).

- `NTE_PORT` or `PORT`: Server port (default: `27183`)
- `NTE_HOST`: Bind host (default: `0.0.0.0`)
- `NTE_DATA_DIR`: Where the SQLite DB is stored
- `NTE_ADMIN_TOKEN`: Admin token for device/session management (recommended)
- `NTE_MIN_SESSION_SECONDS`: Minimum session duration (default: `30`)
- `NTE_MERGE_GAP_SECONDS`: Auto-merge gap in seconds (default: `120`)

### PC Client Sync (Experimental)

You can keep the Windows tracker running locally and sync sessions to the server.

1. Set `NTE_SERVER_URL` in `.env.client`.
2. Start the tracker normally:

  ```bash
  node tracker.js
  ```

On first sync, the PC will **auto-register** as a device and store credentials in:

```
%LOCALAPPDATA%\nte-tracker\client.json
```

#### Link PC to Legacy Data

When the server imports legacy JSON, it creates a `PC (Legacy)` device and logs its id:

```
Legacy device created: <deviceId>
```

To make the PC client use that legacy device, generate a token for it (admin only):

```bash
curl -X POST "http://localhost:28183/api/devices/<deviceId>/token" -H "x-admin-token: <ADMIN_TOKEN>"
```

Then put the returned values in `.env.client`:

```
NTE_DEVICE_ID=<deviceId>
NTE_DEVICE_TOKEN=<token>
```

To force a manual sync at any time:

```bash
sync.bat
```

Useful client env variables:

- `NTE_SERVER_URL`: Server base URL (e.g. `http://192.168.1.10:27183`)
- `NTE_DEVICE_NAME`: Device label (default: `PC`)
- `NTE_DEVICE_TYPE`: Device type (default: `pc`)
- `NTE_DEVICE_IS_TEST`: `1` marks the device as test
- `NTE_DEVICE_AUTO_REGISTER`: `1` to auto-register device
- `NTE_SYNC_ON_START`: `1` to sync on startup
- `NTE_SYNC_ON_END`: `1` to sync after each session
- `NTE_LOCAL_DASHBOARD`: `1` to keep the local dashboard enabled

Client reads `.env.client` (and falls back to `.env` if present).

### Device Management (Server Dashboard)

Open the **Devices** tab and paste the admin token. From there you can:

- Create devices (and generate tokens)
- Rename/recolor devices, toggle test mode
- Rotate tokens
- Delete devices (with reassign or delete sessions)

### Tasker (Android)

See [TASKER_SETUP.md](TASKER_SETUP.md) for a step-by-step manual setup guide.

### Manual Sessions

Use the **Manual Session** panel in the **All Sessions** tab to add sessions for any device. Manual sessions are tagged in the table.

### Legacy JSON Migration

If you have existing data from the local tracker, the server will **auto-import** it once on startup (Windows only) from:

```
%LOCALAPPDATA%\nte-tracker\data.json
```

Imported sessions are assigned to a `PC (Legacy)` device.

## Installation

> New to this kind of thing? No worries — just follow the steps below in order. You do **not** need to know any programming.

### Step 1: Install Node.js

Node.js is the engine that runs the tracker in the background. You only have to install it once.

1. Go to [https://nodejs.org](https://nodejs.org).
2. Click the big green button for the **LTS** version (on the left). A `.msi` file will download.
3. Open the downloaded file. The installer will launch.
4. Click **Next** through every screen, accept the license, and keep all the default options. Click **Install** at the end.
5. Windows will ask *"Do you want to allow this app to make changes to your device?"* — click **Yes**.
6. When it says "Installation complete," click **Finish**. You're done — you don't need to open Node.js yourself; the tracker will use it automatically.

**(Optional) Check it worked:** press `Win + R`, type `cmd`, and press Enter. In the black window that opens, type:

```bash
node --version
```

If you see something like `v20.11.0`, Node.js is installed correctly.

### Step 2: Download the tracker

1. Go to this project's GitHub page (the page where you're reading this README).
2. Click the green **`< > Code`** button near the top.
3. In the menu that opens, click **Download ZIP**. A ZIP file will download (usually to your `Downloads` folder).
4. Open your `Downloads` folder and find the ZIP (something like `nte-tracker-main.zip`).
5. **Right-click** the ZIP → **Extract All…** → choose a location you'll remember, for example `C:\Users\<YourName>\Documents\nte-tracker`. Avoid putting it on the **Desktop** or leaving it inside **Downloads** — Windows sometimes cleans those folders automatically, which would break the tracker.
6. After extracting, open the new folder. You should see files like `setup.bat`, `tracker.js`, `launcher.vbs`, and this `README.md`.

### Step 3: Run the installer

1. In the extracted folder, find the file named **`setup.bat`**.
2. **Right-click** it and choose **Run as administrator**.
3. Windows will ask *"Do you want to allow this app to make changes to your device?"* — click **Yes**.
4. A black console window will flash open briefly and then close. That's normal — the installer is quick.
5. Your browser should automatically open the dashboard at [http://127.0.0.1:27183](http://127.0.0.1:27183). If it doesn't, open that link yourself in any browser.

That's it — the tracker is now installed and will start automatically every time you log in to Windows. You never have to touch it again.

> **Alternative:** if you'd rather not auto-start the tracker right now, run `install.bat` instead (same installation, no immediate launch). You can then start it manually any time by double-clicking `launcher.vbs`.

### Step 4: Verify it's working

- The dashboard at [http://127.0.0.1:27183](http://127.0.0.1:27183) should load. Before you've played, it will show zero sessions — that's fine.
- Open **Task Manager** (press `Ctrl + Shift + Esc`) → go to the **Details** tab → scroll down and look for `node.exe`. If it's there, the tracker is running.
- Launch Neverness to Everness. Within a few seconds, a **NOW PLAYING** banner appears on the dashboard and the timer starts ticking. When you close the game, a Windows notification pops up with your session time.

### (Optional) Editing configuration

If you want to adjust settings later (for example, setting an `initialOffset` for playtime you had before installing the tracker), open `tracker.js` in any text editor — **Notepad** works fine. If you'd like a nicer editor, install [Visual Studio Code](https://code.visualstudio.com), open it, and use **File → Open Folder…** to open the `nte-tracker` folder. See the [Configuration](#configuration) section below for what each setting does.

### Testing Manually

If something doesn't seem to work and you want to see what's happening, you can run the tracker by hand in a terminal with log output:

1. Open the extracted project folder in File Explorer.
2. Click the address bar at the top, type `cmd`, and press Enter — this opens a terminal already pointed at the folder.
3. Type the following and press Enter:

   ```bash
   node tracker.js
   ```

The tracker will run in that terminal and print log messages. Start and stop the game to verify it's detecting the process correctly. Close the terminal window to stop it.

### Uninstalling

Right-click `uninstall.bat` and **Run as administrator** to remove the automatic startup task. Your playtime data in `%LOCALAPPDATA%\nte-tracker\` is preserved in case you want to reinstall later.

## Usage

- **Background operation**: The tracker runs silently with no visible window
- **Live dashboard**: When the game starts, a dashboard opens at `http://127.0.0.1:27183` with real-time session info — the timer ticks live every second, no page refreshes needed
- **Automatic notifications**: When you close the game, a Windows toast notification appears showing:
  - Session time (how long you played this session)
  - Total time (your cumulative playtime)
- **No interaction needed**: Everything happens automatically

## Data Storage

### Location

All data is stored at:
```
%LOCALAPPDATA%\nte-tracker\data.json
```

Full path: `C:\Users\<YourUsername>\AppData\Local\nte-tracker\data.json`

### Checking Your Playtime

**Option 1**: Open `http://127.0.0.1:27183` in your browser (while the tracker is running) for the full dashboard

**Option 2**: Check `playtime.txt` in the project folder — a human-readable log grouped by date

**Option 3**: Look at the notification when you close the game

**Option 4**: Open `data.json` in a text editor to see:
- `totalSeconds`: Your total playtime in seconds
- `sessions`: Array of all your gaming sessions with timestamps
- `activeSession`: Present if a session is currently running (interim saves)

### Server Mode Data

When running `server.js`, data is stored in SQLite at:

```
<NTE_DATA_DIR>\nte.db
```

### Initial Offset

You can set an `initialOffset` (in seconds) in `tracker.js` if you want to account for playtime before the tracker was installed. Default is `0`.

## Troubleshooting

### How to check if the tracker is running

1. Open Task Manager (Ctrl + Shift + Esc)
2. Go to the **Details** tab
3. Look for `node.exe` with command line containing `tracker.js`

Alternatively, check if the scheduled task exists:
```bash
schtasks /query /tn "NTETracker"
```

### Dashboard doesn't load

- Make sure the tracker is running (see above)
- Try opening `http://127.0.0.1:27183` manually in your browser
- If the port is in use, the tracker will try the next port — check the log output for the actual URL

### Notifications don't appear

- Ensure Windows notifications are enabled for your system
- Check that Focus Assist is not blocking notifications
- Verify the tracker is running (see above)
- Test by manually running `node tracker.js` and starting/stopping the game

### Manually checking playtime

Open the data file at `%LOCALAPPDATA%\nte-tracker\data.json` and look at the `totalSeconds` field. Divide by 3600 to convert to hours.

### Resetting or adjusting playtime

1. Stop the tracker if it's running (close the node.exe process)
2. Edit `data.json` and modify the `totalSeconds` value
3. Restart the tracker

### The tracker isn't detecting the game

- Verify the game executable is named `HTGame.exe` (this is the actual NTE game process)
- Ensure Node.js is installed and in your system PATH
- Check the tracker logs if running manually with `node tracker.js`

## Technical Details

### Dependencies

**Zero external dependencies** - uses only built-in Node.js modules:
- `child_process`: Process monitoring via Windows `tasklist`
- `fs`: File system operations for data persistence
- `path`: Path handling
- `http`: Local dashboard server

### Resource Usage

- **Memory**: ~35MB RAM (minimal footprint)
- **CPU**: Negligible (polls every 5 seconds)
- **Disk**: <1MB (data file is typically a few KB)
- **Network**: Local only — the HTTP server binds to `127.0.0.1` and is not accessible from other machines

### Features

- **Live dashboard**: Real-time updates via Server-Sent Events (no page reloads)
- **Interim saves**: Every 60 seconds while playing (prevents data loss)
- **Crash recovery**: Automatically finalizes incomplete sessions on next startup
- **Session history**: Maintains last 100 sessions with timestamps
- **Silent operation**: No console window or UI (uses VBScript launcher)
- **Clean shutdown handling**: Properly saves data on system shutdown/restart

### Configuration

Default settings (in `tracker.js`):
- Process name: `HTGame.exe`
- Poll interval: 5 seconds
- Interim save: Every 60 seconds
- Initial offset: 0 (configurable)
- Max sessions: 100
- Dashboard port: 27183

## File Structure

```
nte-tracker/
├── tracker.js       # Main tracker script (includes HTTP server)
├── dashboard.html   # Dashboard page structure
├── dashboard.css    # Dashboard styles
├── dashboard.js     # Dashboard client-side logic
├── launcher.vbs     # Silent launcher (no console window)
├── setup.bat        # Installation + auto-launch (recommended)
├── install.bat      # Installation only (alternative)
├── uninstall.bat    # Uninstallation script
└── README.md        # This file
```

Data directory:

```
%LOCALAPPDATA%\nte-tracker/
├── data.json        # Playtime data and session history
└── playtime.txt     # Auto-generated human-readable playtime log
```

## License

Free to use and modify.
