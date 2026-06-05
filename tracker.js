/**
 * Neverness to Everness Game Time Tracker
 * Tracks game process runtime and maintains session history
 * Serves a live dashboard via local HTTP server with Server-Sent Events
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const IS_SEA = (function () {
  const exe = process.execPath.toLowerCase();
  return !exe.endsWith('node.exe') && !exe.endsWith('node') && !exe.endsWith('node.exe"');
})();

/** Folder for .env.client and optional sidecar files; exe directory in SEA mode. */
const APP_ROOT = IS_SEA ? path.dirname(process.execPath) : __dirname;

function readBundledFile(relativePath, encoding) {
  const key = relativePath.replace(/\\/g, '/');
  if (IS_SEA) {
    try {
      const { getAsset } = require('node:sea');
      if (encoding) return getAsset(key, encoding);
      return getAsset(key);
    } catch (e) {
      // fall through to filesystem
    }
  }
  const fullPath = path.join(APP_ROOT, relativePath);
  return encoding ? fs.readFileSync(fullPath, encoding) : fs.readFileSync(fullPath);
}

const APP_VERSION = (function () {
  try {
    return JSON.parse(readBundledFile('package.json', 'utf8')).version || '0.0.0';
  } catch (e) {
    return '0.0.0';
  }
})();

const GITHUB_REPO = 'PJ289/NTE-time-tracker';

function semverGt(a, b) {
  const parse = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(APP_ROOT, '.env.client'));
loadEnvFile(path.join(APP_ROOT, '.env'));

function envFlag(name, defaultValue) {
  if (process.env[name] === undefined) return defaultValue;
  const value = String(process.env[name]).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
}

function maybeRelaunchSeaInBackground() {
  if (!IS_SEA || !process.platform.startsWith('win')) return;
  if (process.env.NTE_SEA_BACKGROUND === '1') return;
  if (envFlag('NTE_CONSOLE_LOG', false)) return;

  const args = process.argv.slice(2);
  if (args.includes('--install') || args.includes('--uninstall') || args.includes('--sync') ||
      args.includes('--install-tray') || args.includes('--uninstall-tray')) return;

  const childEnv = Object.assign({}, process.env, { NTE_SEA_BACKGROUND: '1' });
  spawn(process.execPath, args, {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: childEnv
  }).unref();
  process.exit(0);
}

maybeRelaunchSeaInBackground();

const CLI_ARGS = process.argv.slice(2);
const CLI_INSTALL = CLI_ARGS.includes('--install');
const CLI_INSTALL_TRAY = CLI_ARGS.includes('--install-tray');
const CLI_UNINSTALL = CLI_ARGS.includes('--uninstall');
const CLI_UNINSTALL_TRAY = CLI_ARGS.includes('--uninstall-tray');
const CLI_SYNC_ONLY = CLI_ARGS.includes('--sync');
const CLI_MAINTENANCE = CLI_INSTALL || CLI_INSTALL_TRAY || CLI_UNINSTALL || CLI_UNINSTALL_TRAY || CLI_SYNC_ONLY;

function launchTrackerInBackground() {
  if (!IS_SEA || !process.platform.startsWith('win')) return;
  const childEnv = Object.assign({}, process.env, { NTE_SEA_BACKGROUND: '1' });
  spawn(process.execPath, [], {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: childEnv
  }).unref();
}

function normalizeServerUrl(url) {
  if (!url) return '';
  return String(url).replace(/\/+$/, '');
}

const rawQueueLimit = parseInt(process.env.NTE_QUEUE_LIMIT || '500', 10);
const rawSyncTimeout = parseInt(process.env.NTE_SYNC_TIMEOUT_MS || '8000', 10);

// Configuration
const CONFIG = {
  gameName: 'Neverness to Everness',
  appName: 'nte-tracker',
  processName: 'HTGame.exe',
  pollInterval: 5000,
  interimSaveInterval: 60000, // 60 seconds
  minSessionDuration: 30, // seconds — sessions shorter than this are discarded
  initialOffset: 0,
  maxSessions: 100,
  port: 27183,
  serverUrl: normalizeServerUrl(process.env.NTE_SERVER_URL),
  deviceName: process.env.NTE_DEVICE_NAME || (os.hostname() + ' (PC)'),
  deviceType: process.env.NTE_DEVICE_TYPE || 'pc',
  deviceIsTest: envFlag('NTE_DEVICE_IS_TEST', false),
  deviceAutoRegister: envFlag('NTE_DEVICE_AUTO_REGISTER', true),
  syncOnStart: envFlag('NTE_SYNC_ON_START', true),
  syncOnEnd: envFlag('NTE_SYNC_ON_END', true),
  localDashboardEnabled: envFlag('NTE_LOCAL_DASHBOARD', true),
  updateDevBuilds: envFlag('NTE_UPDATE_DEV_BUILDS', false),
  syncTimeoutMs: Number.isNaN(rawSyncTimeout) ? 8000 : rawSyncTimeout,
  queueLimit: Number.isNaN(rawQueueLimit) ? 500 : rawQueueLimit,
  get dataDir() {
    if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, this.appName);
    return path.join(os.homedir(), '.' + this.appName);
  },
  get dataFile() {
    return path.join(this.dataDir, 'data.json');
  },
  get playtimeFile() {
    return path.join(this.dataDir, 'playtime.txt');
  },
  get clientStateFile() {
    return path.join(this.dataDir, 'client.json');
  },
  get queueFile() {
    return path.join(this.dataDir, 'queue.json');
  }
};

// State variables
let isGameRunning = false;
let sessionStartTime = null;
let tickCount = 0;
let data = null; // loaded once, kept in memory
let dashboardOpened = false; // whether browser was opened this tracker run
let sseClients = []; // active SSE connections
let clientState = null;
let uploadQueue = [];
let syncInProgress = false;
let syncRequested = false;
const TICKS_PER_SAVE = CONFIG.interimSaveInterval / CONFIG.pollInterval; // 12 ticks
const IS_CLIENT_MODE = Boolean(CONFIG.serverUrl);

/**
 * Formats seconds into "Xh Ym" format
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (seconds < 300) return hours + 'h ' + minutes + 'm ' + secs + 's';
  return hours + 'h ' + minutes + 'm';
}

/**
 * Formats a date/time in the PC's local timezone (for logs and UI).
 */
function formatLocalDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds())
  );
}

function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * Logs a message with timestamp
 */
function log(msg) {
  const timestamp = formatLocalDateTime(new Date());
  const line = '[' + timestamp + '] ' + msg;
  const showConsole = !IS_SEA || envFlag('NTE_CONSOLE_LOG', false) || CLI_MAINTENANCE;
  if (showConsole) console.log(line);
  if (IS_SEA) {
    try {
      ensureDataDirectory();
      fs.appendFileSync(path.join(CONFIG.dataDir, 'tracker.log'), line + '\n', 'utf8');
    } catch (e) {
      if (showConsole) console.error('Log write failed: ' + e.message);
    }
  }
}

/**
 * Ensures data directory exists
 */
function ensureDataDirectory() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    log('Created data directory: ' + CONFIG.dataDir);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Loads data from JSON file (called once at startup)
 */
function loadData() {
  ensureDataDirectory();

  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const rawData = fs.readFileSync(CONFIG.dataFile, 'utf8');
      const parsed = JSON.parse(rawData);

      // Crash recovery: finalize any active session from a previous unclean shutdown
      if (parsed.activeSession) {
        log('Detected active session from previous run - finalizing');
        const sessionDuration = parsed.activeSession.duration;
        parsed.totalSeconds += sessionDuration;
        parsed.sessions.push({
          startTime: parsed.activeSession.startTime,
          endTime: parsed.activeSession.lastUpdateTime,
          duration: sessionDuration
        });
        delete parsed.activeSession;
      }

      return parsed;
    }
  } catch (err) {
    log('Error loading data (starting fresh): ' + err.message);
  }

  return {
    version: '1.0',
    totalSeconds: CONFIG.initialOffset,
    sessions: [],
    lastSaveTime: new Date().toISOString()
  };
}

/**
 * Saves the in-memory data to JSON file
 */
function saveData(isActiveSession = false) {
  ensureDataDirectory();

  const dataToSave = { ...data };
  dataToSave.lastSaveTime = new Date().toISOString();

  if (isActiveSession && sessionStartTime) {
    const currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    dataToSave.activeSession = {
      startTime: new Date(sessionStartTime).toISOString(),
      lastUpdateTime: new Date().toISOString(),
      duration: currentDuration
    };
  } else {
    delete dataToSave.activeSession;
  }

  if (dataToSave.sessions.length > CONFIG.maxSessions) {
    dataToSave.sessions = dataToSave.sessions.slice(-CONFIG.maxSessions);
  }

  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(dataToSave, null, 2), 'utf8');
}

function loadClientState() {
  ensureDataDirectory();
  const fallback = {
    deviceId: null,
    deviceToken: null,
    lastServerEndTime: null,
    lastSyncTime: null
  };
  const state = readJsonFile(CONFIG.clientStateFile, fallback) || fallback;

  if (state.deviceId) state.deviceId = String(state.deviceId).trim();
  if (state.deviceToken) state.deviceToken = String(state.deviceToken).trim();

  const envId = process.env.NTE_DEVICE_ID && String(process.env.NTE_DEVICE_ID).trim();
  const envToken = process.env.NTE_DEVICE_TOKEN && String(process.env.NTE_DEVICE_TOKEN).trim();

  if (envId && envToken) {
    const changed = state.deviceId !== envId || state.deviceToken !== envToken;
    state.deviceId = envId;
    state.deviceToken = envToken;
    saveClientState(state);
    if (changed) {
      log('Using device credentials from .env.client (synced to client.json)');
    }
    return state;
  }

  if (envId || envToken) {
    state.deviceId = envId || null;
    state.deviceToken = envToken || null;
    log('Warning: set both NTE_DEVICE_ID and NTE_DEVICE_TOKEN in .env.client — not mixing with client.json');
    return state;
  }

  return state;
}

function saveClientState(state) {
  ensureDataDirectory();
  writeJsonFile(CONFIG.clientStateFile, state);
}

function loadQueue() {
  ensureDataDirectory();
  const items = readJsonFile(CONFIG.queueFile, []);
  return Array.isArray(items) ? items : [];
}

function saveQueue(queue) {
  ensureDataDirectory();
  if (queue.length > CONFIG.queueLimit) {
    queue = queue.slice(-CONFIG.queueLimit);
  }
  writeJsonFile(CONFIG.queueFile, queue);
  uploadQueue = queue;
}

function sessionKey(session) {
  return session.startTime + '|' + session.endTime;
}

function enqueueSession(session) {
  if (!session || !session.startTime || !session.endTime) return;
  const key = sessionKey(session);
  const range = sessionRangeMs(session);
  for (let i = 0; i < uploadQueue.length; i++) {
    if (sessionKey(uploadQueue[i]) === key) return;
    if (range) {
      const existingRange = sessionRangeMs(uploadQueue[i]);
      if (existingRange && sessionsOverlapMs(existingRange, range)) return;
    }
  }
  uploadQueue.push({
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration
  });
  saveQueue(uploadQueue);
}

function sessionRangeMs(session) {
  const start = new Date(session.startTime).getTime();
  const end = new Date(session.endTime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  return { start: start, end: end };
}

function sessionsOverlapMs(a, b) {
  return a.start < b.end && a.end > b.start;
}

function dedupeSessions(list) {
  const map = new Map();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || !item.startTime || !item.endTime) continue;
    const key = sessionKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function dedupeSessionsOverlap(list) {
  const exact = dedupeSessions(list);
  const sorted = exact.slice().sort(function (a, b) {
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });
  const merged = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const range = sessionRangeMs(item);
    if (!range) continue;
    if (!merged.length) {
      merged.push({
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.duration
      });
      continue;
    }
    const last = merged[merged.length - 1];
    const lastRange = sessionRangeMs(last);
    if (!lastRange || !sessionsOverlapMs(lastRange, range)) {
      merged.push({
        startTime: item.startTime,
        endTime: item.endTime,
        duration: item.duration
      });
      continue;
    }
    const unionStart = Math.min(lastRange.start, range.start);
    const unionEnd = Math.max(lastRange.end, range.end);
    last.startTime = new Date(unionStart).toISOString();
    last.endTime = new Date(unionEnd).toISOString();
    last.duration = Math.max(0, Math.floor((unionEnd - unionStart) / 1000));
  }
  return merged;
}

function resolveSyncCutoff(serverLast, clientLast) {
  const candidates = [serverLast, clientLast].filter(Boolean);
  if (!candidates.length) return null;
  let max = null;
  for (let i = 0; i < candidates.length; i++) {
    const ms = new Date(candidates[i]).getTime();
    if (isNaN(ms)) continue;
    if (max === null || ms > max) max = ms;
  }
  return max === null ? null : new Date(max).toISOString();
}

function pruneQueueAfter(endCutoff) {
  if (!endCutoff) return;
  uploadQueue = filterSessionsAfter(uploadQueue, endCutoff);
  saveQueue(uploadQueue);
}

/**
 * Checks if the game process is running (async to avoid blocking the event loop)
 */
function checkProcessRunning(callback) {
  exec(
    'tasklist /FI "IMAGENAME eq ' + CONFIG.processName + '" /FO CSV /NH',
    { encoding: 'utf8', windowsHide: true },
    function (err, stdout) {
      if (err) {
        log('Error checking process: ' + err.message);
        callback(false);
      } else {
        callback(stdout.includes('"' + CONFIG.processName + '"'));
      }
    }
  );
}

async function fetchJson(url, options) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API not available (requires Node 18+)');
  }
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, CONFIG.syncTimeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      json = null;
    }
    return { ok: res.ok, status: res.status, json: json, text: text };
  } finally {
    clearTimeout(timeout);
  }
}

function hasDeviceCredentials(state) {
  const s = state || clientState;
  return Boolean(s && s.deviceId && s.deviceToken);
}

function isAutoRegisterAllowed() {
  if (!CONFIG.deviceAutoRegister) return false;
  if (hasEnvDeviceCredentials()) return false;
  if (hasDeviceCredentials(clientState)) return false;
  return true;
}

function applyDeviceCredentialPolicy() {
  if (hasEnvDeviceCredentials()) {
    CONFIG.deviceAutoRegister = false;
  }
}

async function ensureDeviceRegistered() {
  if (!IS_CLIENT_MODE) return false;
  if (hasDeviceCredentials(clientState)) {
    return true;
  }
  if (!isAutoRegisterAllowed()) {
    reportClientSyncError(
      'Server sync disabled: missing device credentials (auto-register not used when credentials already exist or are set in .env.client)',
      'no-credentials'
    );
    return false;
  }

  const payload = {
    name: CONFIG.deviceName,
    type: CONFIG.deviceType,
    isTest: CONFIG.deviceIsTest
  };

  const res = await fetchJson(CONFIG.serverUrl + '/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok || !res.json || !res.json.deviceId || !res.json.token) {
    reportClientSyncError('Device registration failed (' + res.status + ')', 'register-' + (res.status || 0));
    return false;
  }

  clientState.deviceId = res.json.deviceId;
  clientState.deviceToken = res.json.token;
  clientState.lastSyncTime = nowIso();
  saveClientState(clientState);
  log('Device registered: ' + clientState.deviceId);
  return true;
}

function buildAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-device-id': clientState.deviceId,
    'x-device-token': clientState.deviceToken
  };
}

function hasEnvDeviceCredentials() {
  const envId = process.env.NTE_DEVICE_ID && String(process.env.NTE_DEVICE_ID).trim();
  const envToken = process.env.NTE_DEVICE_TOKEN && String(process.env.NTE_DEVICE_TOKEN).trim();
  return Boolean(envId && envToken);
}

function getMaxEndTime(sessions, fallback) {
  let max = null;
  for (let i = 0; i < sessions.length; i++) {
    const endTime = new Date(sessions[i].endTime).getTime();
    if (!isNaN(endTime) && (max === null || endTime > max)) {
      max = endTime;
    }
  }
  if (max === null) return fallback || null;
  return new Date(max).toISOString();
}

function filterSessionsAfter(sessions, lastEndTime) {
  if (!lastEndTime) return sessions.slice();
  const last = new Date(lastEndTime).getTime();
  if (isNaN(last)) return sessions.slice();
  return sessions.filter(function (s) {
    const endTime = new Date(s.endTime).getTime();
    return !isNaN(endTime) && endTime > last;
  });
}

async function fetchLastServerEndTime() {
  if (!clientState.deviceId || !clientState.deviceToken) {
    return { lastEndTime: null, status: 0 };
  }

  const res = await fetchJson(
    CONFIG.serverUrl + '/api/devices/' + encodeURIComponent(clientState.deviceId) + '/last',
    {
      method: 'GET',
      headers: buildAuthHeaders()
    }
  );

  if (!res.ok || !res.json) {
    return { lastEndTime: null, status: res.status || 0, failed: true };
  }

  return { lastEndTime: res.json.lastEndTime || null, status: res.status, failed: false };
}

async function syncWithServer(reason) {
  if (!IS_CLIENT_MODE) return;
  if (syncInProgress) {
    syncRequested = true;
    return;
  }

  syncInProgress = true;
  try {
    if (!clientState) clientState = loadClientState();
    if (!uploadQueue || !Array.isArray(uploadQueue)) uploadQueue = loadQueue();

    const ready = await ensureDeviceRegistered();
    if (!ready) return;

    let lastFetch = await fetchLastServerEndTime();
    if (lastFetch.status === 401) {
      reportClientSyncError(
        'Server auth failed (401); verify Device ID and token. Auto-register will not replace existing credentials.',
        'auth'
      );
      return;
    }

    if (lastFetch.failed && lastFetch.status !== 401) {
      const lastKey = lastFetch.status >= 400 ? 'last-' + lastFetch.status : 'last-invalid';
      const lastMsg = lastFetch.status >= 400
        ? 'Failed to read server state (' + lastFetch.status + ').'
        : 'Invalid server response when reading sync state.';
      reportClientSyncError(lastMsg, lastKey);
    }

    const serverLastEndTime = lastFetch.lastEndTime;
    const syncCutoff = resolveSyncCutoff(serverLastEndTime, clientState.lastServerEndTime);
    const queueCandidates = filterSessionsAfter(uploadQueue, syncCutoff);
    const localCandidates = filterSessionsAfter(data.sessions || [], syncCutoff);
    const combined = dedupeSessionsOverlap(queueCandidates.concat(localCandidates));

    if (!combined.length) {
      if (syncCutoff) {
        clientState.lastServerEndTime = syncCutoff;
        clientState.lastSyncTime = nowIso();
        saveClientState(clientState);
        pruneQueueAfter(syncCutoff);
      }
      return;
    }

    const payload = {
      deviceId: clientState.deviceId,
      sessions: combined.map(function (s) {
        return {
          startTime: s.startTime,
          endTime: s.endTime,
          duration: s.duration
        };
      })
    };

    const res = await fetchJson(CONFIG.serverUrl + '/api/sessions/bulk', {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: JSON.stringify(payload)
    });

    if (res.status === 401) {
      reportClientSyncError(
        'Sync auth failed (401); verify Device ID and token. Auto-register will not replace existing credentials.',
        'auth'
      );
      return;
    }

    if (!res.ok) {
      reportClientSyncError(
        'Sync failed (' + res.status + ') for ' + combined.length + ' session(s).',
        'bulk-' + res.status
      );
      return;
    }

    const newLastEnd = getMaxEndTime(combined, syncCutoff);
    clientState.lastServerEndTime = newLastEnd;
    clientState.lastSyncTime = nowIso();
    saveClientState(clientState);
    pruneQueueAfter(newLastEnd);
    log('Sync ok (' + reason + '): ' + combined.length + ' sessions');
  } catch (err) {
    const isTimeout = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)));
    reportClientSyncError(
      isTimeout
        ? 'Cannot reach server (timeout). Check NTE_SERVER_URL and network.'
        : 'Cannot connect to server: ' + (err && err.message ? err.message : 'unknown error'),
      isTimeout ? 'timeout' : 'network'
    );
  } finally {
    syncInProgress = false;
    if (syncRequested) {
      syncRequested = false;
      syncWithServer('queued');
    }
  }
}

/**
 * Shows Windows toast notification
 */
function showNotification(sessionSeconds, totalSeconds) {
  const sessionTime = formatTime(sessionSeconds);
  const totalTime = formatTime(totalSeconds);

  const ps1Path = path.join(CONFIG.dataDir, 'notify.ps1');
  const ps1Content = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '',
    '$template = @"',
    '<toast>',
    '  <visual>',
    '    <binding template="ToastGeneric">',
    '      <text>' + CONFIG.gameName + '</text>',
    '      <text>Session: ' + sessionTime + '</text>',
    '      <text>Total playtime: ' + totalTime + '</text>',
    '    </binding>',
    '  </visual>',
    '  <audio silent="true"/>',
    '</toast>',
    '"@',
    '',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml($template)',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + CONFIG.appName + "').Show($toast)"
  ].join('\n');

  fs.writeFileSync(ps1Path, ps1Content, 'utf8');
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true }, (err) => {
    if (err) log('Notification error: ' + err.message);
    fs.unlink(ps1Path, () => {});
  });
}

const PENDING_UPDATE_FILE = function () {
  return path.join(CONFIG.dataDir, 'pending-update.json');
};
const TRAY_BALLOON_FILE = function () {
  return path.join(CONFIG.dataDir, 'tray-balloon.txt');
};

function loadPendingUpdateFromDisk() {
  try {
    if (!fs.existsSync(PENDING_UPDATE_FILE())) return null;
    const parsed = JSON.parse(fs.readFileSync(PENDING_UPDATE_FILE(), 'utf8'));
    if (!parsed || !parsed.version) return null;
    if (!semverGt(parsed.version, APP_VERSION)) {
      clearPendingUpdate();
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function setPendingUpdate(info) {
  _pendingUpdate = info;
  ensureDataDirectory();
  fs.writeFileSync(PENDING_UPDATE_FILE(), JSON.stringify(info, null, 2), 'utf8');
}

function clearPendingUpdate() {
  _pendingUpdate = null;
  try {
    if (fs.existsSync(PENDING_UPDATE_FILE())) fs.unlinkSync(PENDING_UPDATE_FILE());
  } catch (err) {
    // ignore
  }
}

function signalTrayBalloon(message) {
  if (!TRAY_ENABLED || !process.platform.startsWith('win')) return;
  try {
    ensureDataDirectory();
    fs.writeFileSync(TRAY_BALLOON_FILE(), message, 'utf8');
  } catch (err) {
    log('Tray balloon signal failed: ' + err.message);
  }
}

const CLIENT_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
let _clientNotifyAt = 0;
let _clientNotifyKey = '';

function notifyClientIssue(message, key) {
  if (!IS_CLIENT_MODE || !process.platform.startsWith('win')) return;
  const notifyKey = key || message;
  const now = Date.now();
  if (notifyKey === _clientNotifyKey && now - _clientNotifyAt < CLIENT_NOTIFY_COOLDOWN_MS) return;
  _clientNotifyKey = notifyKey;
  _clientNotifyAt = now;

  const text = message.length > 220 ? message.slice(0, 217) + '...' : message;
  if (TRAY_ENABLED) {
    signalTrayBalloon('Sync error: ' + text);
  } else {
    notifyTray('Sync error: ' + text);
  }
}

function reportClientSyncError(message, key) {
  log(message);
  notifyClientIssue(message, key);
}

function showYesNoDialog(message) {
  if (!process.platform.startsWith('win')) return false;
  const { execSync } = require('child_process');
  ensureDataDirectory();
  const ps1Path = path.join(CONFIG.dataDir, 'yesno.ps1');
  const ps1 = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$msg = ' + JSON.stringify(message),
    '$r = [System.Windows.Forms.MessageBox]::Show($msg, "NTE Tracker", "YesNo", "Question")',
    'if ($r -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 }',
    'exit 1'
  ].join('\r\n');
  try {
    fs.writeFileSync(ps1Path, ps1, 'utf8');
    execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true, shell: true });
    return true;
  } catch (err) {
    return false;
  }
}

function promptInstallUpdate(updateInfo) {
  if (!updateInfo) return;
  const canAuto = IS_SEA && updateInfo.downloadUrl;
  const label = updateInfo.prerelease ? 'dev pre-release ' : '';
  const msg = canAuto
    ? (label + 'Version v' + updateInfo.version + ' is available (current v' + APP_VERSION + ').\n\n' +
      'Download and install now? The tracker will restart.')
    : (label + 'Version v' + updateInfo.version + ' is available (current v' + APP_VERSION + ').\n\n' +
      'Open the release page in your browser?');
  if (showYesNoDialog(msg)) {
    performAutoUpdate(updateInfo);
  }
}

function notifyUpdateFound(updateInfo, manual) {
  if (manual) {
    promptInstallUpdate(updateInfo);
    return;
  }
  const channel = updateInfo.prerelease ? 'dev pre-release ' : '';
  signalTrayBalloon(
    'Update ' + channel + 'v' + updateInfo.version + ' available (current v' + APP_VERSION + '). ' +
    'Right-click the tray icon and choose Install update.'
  );
}

function releaseToUpdateInfo(release) {
  if (!release || !release.tag_name) return null;
  const version = String(release.tag_name).replace(/^v/, '');
  const exeAsset = release.assets && release.assets.find(function (a) {
    return a.name && a.name.toLowerCase().endsWith('.exe');
  });
  return {
    version: version,
    downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
    releaseUrl: release.html_url || ('https://github.com/' + GITHUB_REPO + '/releases/tag/' + release.tag_name),
    prerelease: !!release.prerelease
  };
}

/**
 * Fetches the newest applicable GitHub release (stable latest, or newest pre-release when dev updates enabled).
 */
async function fetchLatestGithubRelease(signal) {
  const headers = {
    'User-Agent': 'nte-time-tracker/' + APP_VERSION,
    'Accept': 'application/vnd.github+json'
  };
  const base = 'https://api.github.com/repos/' + GITHUB_REPO;

  if (!CONFIG.updateDevBuilds) {
    const res = await fetch(base + '/releases/latest', { headers: headers, signal: signal });
    if (!res.ok) return null;
    return releaseToUpdateInfo(await res.json());
  }

  const res = await fetch(base + '/releases?per_page=30', { headers: headers, signal: signal });
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list)) return null;

  let best = null;
  for (let i = 0; i < list.length; i++) {
    const rel = list[i];
    if (!rel || !rel.prerelease) continue;
    const info = releaseToUpdateInfo(rel);
    if (!info || !info.downloadUrl) continue;
    if (!semverGt(info.version, APP_VERSION)) continue;
    if (!best || semverGt(info.version, best.version)) best = info;
  }
  return best;
}

/**
 * Checks GitHub releases for a newer tracker version.
 * Stable channel uses /releases/latest; dev channel uses the newest pre-release with nte-tracker.exe.
 * Automatic checks run at most once per calendar day (clientState.lastUpdateCheck).
 * Returns true when a newer version is available.
 */
async function checkForUpdates(options) {
  options = options || {};
  const manual = !!options.manual;

  if (typeof fetch !== 'function') {
    if (manual) showWindowsMessageBox('Update check is not available in this environment.', 'warning');
    return false;
  }

  try {
    if (!clientState) clientState = loadClientState();
    const todayKey = localDateKey(new Date());
    if (!manual && clientState.lastUpdateCheck === todayKey) {
      const cached = loadPendingUpdateFromDisk();
      if (cached) {
        _pendingUpdate = cached;
        return true;
      }
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let updateInfo;
    try {
      updateInfo = await fetchLatestGithubRelease(controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    if (!updateInfo) {
      if (manual) {
        const hint = CONFIG.updateDevBuilds
          ? 'No newer dev pre-release with nte-tracker.exe was found.'
          : 'Could not read the latest stable release.';
        showWindowsMessageBox('Update check failed. ' + hint, 'warning');
      }
      return false;
    }

    if (!manual) {
      clientState.lastUpdateCheck = todayKey;
      saveClientState(clientState);
    }

    if (!semverGt(updateInfo.version, APP_VERSION)) {
      clearPendingUpdate();
      const channel = CONFIG.updateDevBuilds ? 'dev pre-release ' : '';
      if (manual) {
        showWindowsMessageBox(
          'No updates available. You are on the latest ' + channel + 'version (v' + APP_VERSION + ').',
          'info'
        );
      }
      return false;
    }

    if (!updateInfo.downloadUrl && CONFIG.updateDevBuilds) {
      if (manual) {
        showWindowsMessageBox(
          'A newer pre-release exists (v' + updateInfo.version + ') but has no nte-tracker.exe asset yet.',
          'warning'
        );
      }
      return false;
    }

    setPendingUpdate(updateInfo);
    const channelLabel = updateInfo.prerelease ? 'dev pre-release ' : '';
    log('Update available: ' + channelLabel + 'v' + updateInfo.version + ' (current: v' + APP_VERSION + ')');
    notifyUpdateFound(updateInfo, manual);
    return true;
  } catch (err) {
    log('Update check failed: ' + err.message);
    if (manual) showWindowsMessageBox('Update check failed: ' + err.message, 'error');
    return false;
  }
}

/**
 * Opens the dashboard in the default browser (only once per tracker run)
 */
function openDashboard() {
  if (dashboardOpened) return;
  var url = null;
  if (CONFIG.localDashboardEnabled) url = 'http://127.0.0.1:' + CONFIG.port;
  else if (CONFIG.serverUrl) url = CONFIG.serverUrl;
  if (!url) return;
  exec('start ' + url, { windowsHide: true, shell: true });
  dashboardOpened = true;
  log('Opened dashboard in browser');
}

function jsLiteral(value) {
  return JSON.stringify(String(value));
}

function launchHtaGui(fileName, htmlContent) {
  ensureDataDirectory();
  const htaPath = path.join(CONFIG.dataDir, fileName);
  fs.writeFileSync(htaPath, htmlContent, 'utf8');
  const child = spawn('mshta.exe', [htaPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.on('error', (err) => log('GUI launch error (' + fileName + '): ' + err.message));
  child.unref();
}

function openLogsWindow() {
  ensureDataDirectory();
  const logPath = path.join(CONFIG.dataDir, 'tracker.log');
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');

  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta http-equiv="x-ua-compatible" content="IE=11">',
    '<title>NTE Tracker Logs</title>',
    '<hta:application id="nteLogs" applicationname="NTE Tracker Logs" border="thin" caption="yes" maximizebutton="yes" minimizebutton="yes" sysmenu="yes" scroll="no" singleinstance="no" />',
    '<style>',
    'body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#111;color:#e8e8e8;}',
    '#bar{height:44px;padding:8px 12px;background:#1a1a1a;border-bottom:1px solid #2a2a2a;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;}',
    '#status{font-size:12px;color:#888;}',
    'button{height:28px;margin-right:8px;background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:4px;padding:0 12px;cursor:pointer;}',
    'button:hover{background:#333;}',
    '#log{position:absolute;left:0;right:0;top:44px;bottom:0;width:100%;height:calc(100% - 44px);box-sizing:border-box;background:#0b0b0b;color:#c8c8c8;border:0;padding:10px;font-family:Consolas,monospace;font-size:12px;white-space:pre;overflow:scroll;}',
    '</style>',
    '<script language="javascript">',
    'var logPath=' + jsLiteral(logPath) + ';',
    'var refreshTimer=null;',
    'function readUtf8(path){try{var s=new ActiveXObject("ADODB.Stream");s.Type=2;s.Charset="utf-8";s.Open();s.LoadFromFile(path);var t=s.ReadText();s.Close();return t;}catch(e){return "Unable to read log: "+e.message;}}',
    'function refreshLog(){var el=document.getElementById("log");el.value=readUtf8(logPath);el.scrollTop=el.scrollHeight;var st=document.getElementById("status");if(st){var d=new Date();st.innerText="Auto-refresh every 2s | Last update "+d.toLocaleTimeString();}}',
    'function openLocation(){new ActiveXObject("WScript.Shell").Run("explorer.exe /select,\\"" + logPath + "\\"",1,false);}',
    'window.onload=function(){window.resizeTo(920,680);refreshLog();refreshTimer=window.setInterval(refreshLog,2000);window.focus();};',
    'window.onbeforeunload=function(){if(refreshTimer){window.clearInterval(refreshTimer);}};',
    '</script>',
    '</head>',
    '<body>',
    '<div id="bar"><div><button onclick="refreshLog()">Refresh now</button><button onclick="openLocation()">Open file location</button></div><div id="status">Auto-refresh every 2s</div></div>',
    '<textarea id="log" readonly></textarea>',
    '</body>',
    '</html>'
  ].join('\r\n');

  launchHtaGui('logs-viewer.hta', html);
}

function openConfigWindow() {
  const cfgPath = path.join(APP_ROOT, '.env.client');
  const clientJsonPath = CONFIG.clientStateFile;
  if (!fs.existsSync(cfgPath)) {
    fs.writeFileSync(cfgPath, '# NTE Tracker client config\r\n# NTE_SERVER_URL=http://192.168.1.10:28183\r\n', 'utf8');
  }

  const knownKeys = [
    'NTE_SERVER_URL',
    'NTE_DEVICE_NAME',
    'NTE_DEVICE_TYPE',
    'NTE_DEVICE_ID',
    'NTE_DEVICE_TOKEN',
    'NTE_DEVICE_IS_TEST',
    'NTE_DEVICE_AUTO_REGISTER',
    'NTE_SYNC_ON_START',
    'NTE_SYNC_ON_END',
    'NTE_LOCAL_DASHBOARD',
    'NTE_TRAY',
    'NTE_CONSOLE_LOG',
    'NTE_UPDATE_DEV_BUILDS'
  ];

  const fields = [
    ['Server URL', 'NTE_SERVER_URL', 'text', 'Base URL of your server, e.g. http://192.168.1.10:28183. No trailing slash. Use HTTP for local sync unless this PC trusts your HTTPS certificate.'],
    ['Device name', 'NTE_DEVICE_NAME', 'text', 'Label shown on the server dashboard. Leave empty to use your PC hostname.'],
    ['Device type', 'NTE_DEVICE_TYPE', 'text', 'Category sent to the server. Usually leave as pc.'],
    ['Device ID', 'NTE_DEVICE_ID', 'text', 'Fixed device ID from the server. If both ID and token are set here, they override client.json on restart (recommended for legacy/manual linking).'],
    ['Device token', 'NTE_DEVICE_TOKEN', 'text', 'Device token paired with Device ID. Save both fields; empty token field keeps the value loaded when the form opened. Overrides client.json on restart.']
  ];
  const checks = [
    ['Mark as test device', 'NTE_DEVICE_IS_TEST', false, 'Sessions appear as test data on the server. Use only for experiments.'],
    ['Auto-register device', 'NTE_DEVICE_AUTO_REGISTER', true, 'Register this PC only when Device ID and token are empty. Ignored if credentials exist in .env.client or client.json. Turn off when using a fixed device.'],
    ['Sync on startup', 'NTE_SYNC_ON_START', true, 'Upload pending sessions when the tracker starts. Recommended when server sync is enabled.'],
    ['Sync after session', 'NTE_SYNC_ON_END', true, 'Upload after each gaming session ends. Recommended for near real-time server updates.'],
    ['Local dashboard', 'NTE_LOCAL_DASHBOARD', true, 'Keep http://127.0.0.1:27183 on this PC. Disable if you only use the remote server dashboard.'],
    ['Tray in node mode', 'NTE_TRAY', false, 'Show the tray icon when running with node tracker.js. Always enabled for nte-tracker.exe.'],
    ['Console debug logs', 'NTE_CONSOLE_LOG', false, 'Show a console window with live output. Useful for debugging only.'],
    ['Dev pre-release updates', 'NTE_UPDATE_DEV_BUILDS', false, 'Check GitHub pre-releases for nte-tracker.exe instead of stable /releases/latest only. Enable to auto-update from dev builds (e.g. v2.3.0-dev).']
  ];

  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta http-equiv="x-ua-compatible" content="IE=11">',
    '<title>NTE Tracker Settings</title>',
    '<hta:application id="nteSettings" applicationname="NTE Tracker Settings" border="thin" caption="yes" maximizebutton="no" minimizebutton="yes" sysmenu="yes" scroll="yes" singleinstance="no" />',
    '<style>',
    'body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#111;color:#e8e8e8;}',
    '.wrap{padding:16px 18px 18px 18px;}',
    'h1{font-size:18px;margin:0 0 6px 0;color:#fff;}',
    '.intro{color:#888;font-size:12px;margin:0 0 16px 0;}',
    '.field{margin:0 0 14px 0;padding-bottom:12px;border-bottom:1px solid #222;}',
    '.row{display:flex;align-items:center;margin:0 0 4px 0;}',
    '.row label{width:180px;font-weight:600;color:#ddd;}',
    'input[type=text],input[type=password]{flex:1;padding:7px 8px;background:#1a1a1a;color:#eee;border:1px solid #333;border-radius:4px;}',
    'input[type=text]:focus,input[type=password]:focus{outline:none;border-color:#4db8ff;}',
    '.check .row{align-items:flex-start;}',
    '.check label{width:auto;font-weight:600;color:#ddd;}',
    '.help{color:#888;font-size:12px;line-height:1.45;margin:0 0 0 180px;}',
    '.check .help{margin-left:24px;}',
    '.actions{margin-top:18px;text-align:right;padding-top:12px;border-top:1px solid #222;}',
    'button{padding:7px 14px;margin-left:8px;background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:4px;cursor:pointer;}',
    'button:hover{background:#333;}',
    'button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}',
    'button.primary:hover{background:#1d4ed8;}',
    '.hint{color:#777;font-size:12px;margin-top:12px;}',
    '</style>',
    '<script language="javascript">',
    'var cfgPath=' + jsLiteral(cfgPath) + ';',
    'var clientJsonPath=' + jsLiteral(clientJsonPath) + ';',
    'var knownKeys=' + JSON.stringify(knownKeys) + ';',
    'var fields=' + JSON.stringify(fields) + ';',
    'var checks=' + JSON.stringify(checks) + ';',
    'var values={}; var extras=[]; var loadedCredentials={id:"",token:""};',
    'function readUtf8(path){try{var s=new ActiveXObject("ADODB.Stream");s.Type=2;s.Charset="utf-8";s.Open();s.LoadFromFile(path);var t=s.ReadText();s.Close();return t;}catch(e){return "";}}',
    'function writeUtf8(path,text){var s=new ActiveXObject("ADODB.Stream");s.Type=2;s.Charset="utf-8";s.Open();s.WriteText(text);s.SaveToFile(path,2);s.Close();}',
    'function isTrue(v){v=String(v||"").toLowerCase();return v==="1"||v==="true"||v==="yes"||v==="y";}',
    'function parseEnv(){var raw=readUtf8(cfgPath);var lines=raw.split(/\\r?\\n/);for(var i=0;i<lines.length;i++){var line=lines[i];var t=line.replace(/^\\s+|\\s+$/g,"");if(!t||t.charAt(0)==="#"||line.indexOf("=")<0){extras.push(line);continue;}var idx=line.indexOf("=");var k=line.substring(0,idx).replace(/^\\s+|\\s+$/g,"");var v=line.substring(idx+1).replace(/^\\s+|\\s+$/g,"");if(v.length>=2&&((v.charAt(0)==="\\""&&v.charAt(v.length-1)==="\\"")||(v.charAt(0)==="\\\'"&&v.charAt(v.length-1)==="\\\'")))v=v.substring(1,v.length-1);if(knownKeys.indexOf(k)>=0)values[k]=v;else extras.push(line);}}',
    'function readClientJson(){try{var raw=readUtf8(clientJsonPath);if(!raw)return null;return JSON.parse(raw);}catch(e){return null;}}',
    'function applyClientJsonFallback(){var cj=readClientJson();if(!cj)return;if(!values.NTE_DEVICE_ID&&cj.deviceId)values.NTE_DEVICE_ID=String(cj.deviceId);if(!values.NTE_DEVICE_TOKEN&&cj.deviceToken)values.NTE_DEVICE_TOKEN=String(cj.deviceToken);loadedCredentials.id=values.NTE_DEVICE_ID||"";loadedCredentials.token=values.NTE_DEVICE_TOKEN||"";}',
    'function build(){parseEnv();applyClientJsonFallback();var root=document.getElementById("fields");for(var i=0;i<fields.length;i++){var f=fields[i];var block=document.createElement("div");block.className="field";block.innerHTML="<div class=\\"row\\"><label for=\\""+f[1]+"\\">"+f[0]+"</label><input id=\\""+f[1]+"\\" type=\\""+f[2]+"\\" /></div><div class=\\"help\\">"+f[3]+"</div>";root.appendChild(block);document.getElementById(f[1]).value=values[f[1]]||"";}var hasCreds=Boolean((values.NTE_DEVICE_ID||loadedCredentials.id)&&(values.NTE_DEVICE_TOKEN||loadedCredentials.token));for(var j=0;j<checks.length;j++){var c=checks[j];var block2=document.createElement("div");block2.className="field check";block2.innerHTML="<div class=\\"row\\"><label><input id=\\""+c[1]+"\\" type=\\"checkbox\\" /> "+c[0]+"</label></div><div class=\\"help\\">"+c[3]+"</div>";root.appendChild(block2);var checked=values.hasOwnProperty(c[1])?isTrue(values[c[1]]):c[2];if(c[1]==="NTE_DEVICE_AUTO_REGISTER"&&hasCreds)checked=false;document.getElementById(c[1]).checked=checked;}window.resizeTo(760,680);window.focus();}',
    'function save(){var lines=["# NTE Tracker client config","# Generated by tray settings UI"];for(var i=0;i<fields.length;i++){var f=fields[i];var v=document.getElementById(f[1]).value.replace(/^\\s+|\\s+$/g,"");if(f[1]==="NTE_DEVICE_ID"&&!v&&loadedCredentials.id)v=loadedCredentials.id;if(f[1]==="NTE_DEVICE_TOKEN"&&!v&&loadedCredentials.token)v=loadedCredentials.token;if(v)lines.push(f[1]+"="+v);}var savedId=(document.getElementById("NTE_DEVICE_ID")&&document.getElementById("NTE_DEVICE_ID").value.replace(/^\\s+|\\s+$/g,""))||loadedCredentials.id;var savedTok=(document.getElementById("NTE_DEVICE_TOKEN")&&document.getElementById("NTE_DEVICE_TOKEN").value.replace(/^\\s+|\\s+$/g,""))||loadedCredentials.token;for(var j=0;j<checks.length;j++){var c=checks[j];var checked=document.getElementById(c[1]).checked;if(c[1]==="NTE_DEVICE_AUTO_REGISTER"&&savedId&&savedTok)checked=false;lines.push(c[1]+"="+(checked?"1":"0"));}lines.push("");for(var k=0;k<extras.length;k++){var line=extras[k];var t=line.replace(/^\\s+|\\s+$/g,"");if(!t||t.charAt(0)==="#"||line.indexOf("=")<0)continue;var key=line.substring(0,line.indexOf("=")).replace(/^\\s+|\\s+$/g,"");if(knownKeys.indexOf(key)<0)lines.push(line);}writeUtf8(cfgPath,lines.join("\\r\\n"));var msg="Settings saved. Restart the tracker to apply changes.";if(savedId&&savedTok)msg+="\\n\\nDevice ID/token in .env.client override client.json on restart. Auto-register is off while both are set.";}alert(msg);window.close();}',
    '</script>',
    '</head>',
    '<body onload="build()">',
    '<div class="wrap">',
    '<h1>NTE Tracker Settings</h1>',
    '<p class="intro">Edit .env.client options below. Changes apply after restarting the tracker.</p>',
    '<div id="fields"></div>',
    '<div class="hint">Tip: auto-register stores credentials in client.json only. To use a fixed device, set Device ID + token here and disable Auto-register, then restart. .env.client wins over client.json when both ID and token are set.</div>',
    '<div class="actions"><button class="primary" onclick="save()">Save</button><button onclick="window.close()">Cancel</button></div>',
    '</div>',
    '</body>',
    '</html>'
  ].join('\r\n');

  launchHtaGui('config-editor.hta', html);
}

/**
 * Regenerates the human-readable playtime log from session history
 */
function writePlaytimeLog() {
  const lines = ['=== ' + CONFIG.gameName + ' - Playtime Log ===', ''];

  const sessionsByDate = new Map();
  for (const session of data.sessions) {
    const start = new Date(session.startTime);
    const dateKey = start.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    if (!sessionsByDate.has(dateKey)) sessionsByDate.set(dateKey, []);
    sessionsByDate.get(dateKey).push(session);
  }

  let runningTotal = CONFIG.initialOffset;
  for (const [dateStr, sessions] of sessionsByDate) {
    lines.push(dateStr);
    for (const session of sessions) {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);
      const startTime = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      runningTotal += session.duration;
      lines.push('  Session: ' + startTime + ' - ' + endTime + ' (' + formatTime(session.duration) + ')');
    }
    lines.push('  Total: ' + formatTime(runningTotal));
    lines.push('');
  }

  try {
    ensureDataDirectory();
    fs.writeFileSync(CONFIG.playtimeFile, lines.join('\n'), 'utf8');
  } catch (e) {
    log('Error writing playtime log: ' + e.message);
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────────

/**
 * Broadcasts a Server-Sent Event to all connected clients
 */
function broadcastSSE(eventType, eventData) {
  const payload = 'event: ' + eventType + '\ndata: ' + JSON.stringify(eventData) + '\n\n';
  sseClients = sseClients.filter(function (res) {
    try { res.write(payload); return true; }
    catch (e) { return false; }
  });
}

/**
 * Returns a snapshot of the current tracker state for the dashboard
 */
function getDashboardData() {
  var liveSession = null;
  if (isGameRunning && sessionStartTime) {
    liveSession = {
      duration: Math.floor((Date.now() - sessionStartTime) / 1000),
      startTime: sessionStartTime
    };
  }
  return {
    gameName: CONFIG.gameName,
    totalSeconds: data.totalSeconds,
    sessions: data.sessions,
    initialOffset: CONFIG.initialOffset,
    liveSession: liveSession,
    lastUpdated: new Date().toISOString()
  };
}

// Dashboard static files cached in memory at startup
var STATIC_FILES = {};
(function loadStaticFiles() {
  var files = {
    '/': { path: 'dashboard.html', type: 'text/html; charset=utf-8', encoding: 'utf8' },
    '/dashboard.css': { path: 'dashboard.css', type: 'text/css; charset=utf-8', encoding: 'utf8' },
    '/dashboard.js': { path: 'dashboard.js', type: 'application/javascript; charset=utf-8', encoding: 'utf8' },
    '/sw.js': { path: 'sw.js', type: 'application/javascript; charset=utf-8', encoding: 'utf8', cache: 'no-cache' },
    '/manifest.webmanifest': { path: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', encoding: 'utf8', cache: 'public, max-age=86400' },
    '/favicon.ico': { path: 'favicon.ico', type: 'image/x-icon', encoding: null, cache: 'public, max-age=86400' },
    '/bg.png': { path: 'bg.png', type: 'image/png', encoding: null, cache: 'public, max-age=86400' },
    '/icons/icon-192.png': { path: 'icons/icon-192.png', type: 'image/png', encoding: null, cache: 'public, max-age=86400' },
    '/icons/icon-512.png': { path: 'icons/icon-512.png', type: 'image/png', encoding: null, cache: 'public, max-age=86400' }
  };
  for (var route in files) {
    var f = files[route];
    try {
      var content = f.encoding ? readBundledFile(f.path, f.encoding) : readBundledFile(f.path, null);
      STATIC_FILES[route] = { content: content, type: f.type };
      if (f.cache) STATIC_FILES[route].cache = f.cache;
    } catch (e) {
      log('Warning: missing dashboard file: ' + f.path + ' — dashboard may not render correctly');
    }
  }
})();

// ── Shareable Stats Card ─────────────────────────────────────────────────────

function generateShareCard() {
  var total = data.totalSeconds;
  var hours = Math.floor(total / 3600);
  var minutes = Math.floor((total % 3600) / 60);
  var sessionCount = data.sessions.length;

  // Compute days played
  var daySet = {};
  for (var i = 0; i < data.sessions.length; i++) {
    var d = new Date(data.sessions[i].startTime);
    daySet[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = true;
  }
  var daysPlayed = Object.keys(daySet).length;

  // Longest session
  var longest = 0;
  for (var i = 0; i < data.sessions.length; i++) {
    if (data.sessions[i].duration > longest) longest = data.sessions[i].duration;
  }

  // Current streak
  var streak = 0;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var sortedDays = Object.keys(daySet).sort(function (a, b) {
    var pa = a.split('-'), pb = b.split('-');
    return new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2]);
  });
  for (var i = 0; i < sortedDays.length; i++) {
    var parts = sortedDays[i].split('-');
    var gd = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    gd.setHours(0, 0, 0, 0);
    var expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (gd.getTime() === expected.getTime()) streak++;
    else break;
  }

  // Weekly playtime bars (last 7 days)
  var weekBars = [];
  var maxDay = 1;
  for (var d = 6; d >= 0; d--) {
    var day = new Date(today);
    day.setDate(day.getDate() - d);
    var key = day.getFullYear() + '-' + (day.getMonth() + 1) + '-' + day.getDate();
    var dayTotal = 0;
    for (var j = 0; j < data.sessions.length; j++) {
      var sd = new Date(data.sessions[j].startTime);
      var sk = sd.getFullYear() + '-' + (sd.getMonth() + 1) + '-' + sd.getDate();
      if (sk === key) dayTotal += data.sessions[j].duration;
    }
    if (dayTotal > maxDay) maxDay = dayTotal;
    weekBars.push({ label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day.getDay()], value: dayTotal });
  }

  var barMaxH = 60;
  var barsXml = '';
  for (var i = 0; i < weekBars.length; i++) {
    var bh = weekBars[i].value > 0 ? Math.max(4, Math.round((weekBars[i].value / maxDay) * barMaxH)) : 0;
    var bx = 30 + i * 50;
    var by = 255 - bh;
    if (bh > 0) {
      barsXml += '<rect x="' + bx + '" y="' + by + '" width="30" height="' + bh + '" rx="3" fill="#4db8ff" opacity="0.8"/>';
    }
    barsXml += '<text x="' + (bx + 15) + '" y="272" text-anchor="middle" fill="#666" font-size="10">' + weekBars[i].label + '</text>';
  }

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="290" viewBox="0 0 400 290">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0f0f0f"/></linearGradient></defs>',
    '<rect width="400" height="290" rx="16" fill="url(#bg)"/>',
    '<rect x="0.5" y="0.5" width="399" height="289" rx="16" fill="none" stroke="#2a2a2a"/>',
    '',
    '<text x="200" y="32" text-anchor="middle" fill="#666" font-family="Segoe UI,sans-serif" font-size="11" letter-spacing="1.5">' + CONFIG.gameName.toUpperCase() + '</text>',
    '',
    '<text x="200" y="72" text-anchor="middle" fill="#fff" font-family="Segoe UI,sans-serif" font-size="38" font-weight="700">' + hours + '<tspan fill="#555" font-size="18" font-weight="400">h </tspan>' + minutes + '<tspan fill="#555" font-size="18" font-weight="400">m</tspan></text>',
    '',
    '<line x1="40" y1="88" x2="360" y2="88" stroke="#222" stroke-width="1"/>',
    '',
    '<text x="80" y="112" text-anchor="middle" fill="#ccc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="600">' + sessionCount + '</text>',
    '<text x="80" y="126" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.5">SESSIONS</text>',
    '',
    '<text x="170" y="112" text-anchor="middle" fill="#ccc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="600">' + daysPlayed + '</text>',
    '<text x="170" y="126" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.5">DAYS</text>',
    '',
    '<text x="250" y="112" text-anchor="middle" fill="#ccc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="600">' + formatTime(longest) + '</text>',
    '<text x="250" y="126" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.5">LONGEST</text>',
    '',
    '<text x="330" y="112" text-anchor="middle" fill="#ccc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="600">' + streak + '\uD83D\uDD25</text>',
    '<text x="330" y="126" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.5">STREAK</text>',
    '',
    '<line x1="40" y1="140" x2="360" y2="140" stroke="#222" stroke-width="1"/>',
    '',
    '<text x="200" y="162" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="10" letter-spacing="0.5">LAST 7 DAYS</text>',
    '',
    barsXml,
    '',
    '</svg>'
  ].join('\n');
}

// ── Tray Icon (SEA / Windows) ─────────────────────────────────────────────────

const TRAY_ENABLED = IS_SEA || envFlag('NTE_TRAY', false);

const TRAY_CMD_FILE = path.join(os.tmpdir(), 'nte-tray-' + process.pid + '.cmd');
let _trayProcess = null;
let _trayInterval = null;
let _pendingUpdate = null; // { version, downloadUrl, releaseUrl }

function buildTrayScript() {
  const cmdFile = TRAY_CMD_FILE.replace(/\\/g, '\\\\');
  const exePath = process.execPath.replace(/\\/g, '\\\\');
  const exePathLiteral = process.execPath.replace(/'/g, "''");
  const dashboardUrl = 'http://127.0.0.1:' + CONFIG.port;

  const pendingFileLiteral = path.join(CONFIG.dataDir, 'pending-update.json').replace(/'/g, "''");
  const balloonFileLiteral = path.join(CONFIG.dataDir, 'tray-balloon.txt').replace(/'/g, "''");

  const updateMenuPs = [
    '',
    '$pendingFile = \'' + pendingFileLiteral + '\'',
    '$balloonFile = \'' + balloonFileLiteral + '\'',
    '',
    '$updateItem = New-Object System.Windows.Forms.ToolStripMenuItem',
    '$updateItem.Visible = $false',
    '$menu.Items.Add($updateItem) | Out-Null',
    '',
    'function Update-UpdateMenuItem {',
    '    if ((Test-Path $pendingFile) -and ((Get-Item $pendingFile).Length -gt 2)) {',
    '        try {',
    '            $u = Get-Content $pendingFile -Raw | ConvertFrom-Json',
    '            if ($u.version) {',
    '                if ($u.prerelease) { $updateItem.Text = "Install dev update v$($u.version)" }',
    '                else { $updateItem.Text = "Install update v$($u.version)" }',
    '                $updateItem.Visible = $true',
    '                return',
    '            }',
    '        } catch {}',
    '    }',
    '    $updateItem.Visible = $false',
    '}',
    '',
    '$updateItem.Add_Click({',
    '    [System.IO.File]::WriteAllText($cmdFile, "update-now")',
    '})',
    '',
    '$balloonTimer = New-Object System.Windows.Forms.Timer',
    '$balloonTimer.Interval = 1500',
    '$script:balloonShown = $false',
    '$balloonTimer.Add_Tick({',
    '    if ($script:balloonShown) { return }',
    '    if (-not (Test-Path $balloonFile)) { return }',
    '    $text = (Get-Content $balloonFile -Raw).Trim()',
    '    if (-not $text) { return }',
    '    Remove-Item $balloonFile -Force -ErrorAction SilentlyContinue',
    '    $script:balloonShown = $true',
    '    $tray.ShowBalloonTip(8000, "NTE Tracker", $text, [System.Windows.Forms.ToolTipIcon]::Info)',
    '})',
    '$balloonTimer.Start()',
    ''
  ];

  const startupMenuPs = IS_SEA ? [
    '',
    'function Test-StartupInstalled {',
    '    schtasks /query /tn "NTETracker" 2>$null | Out-Null',
    '    return ($LASTEXITCODE -eq 0)',
    '}',
    '',
    '$startupItem = New-Object System.Windows.Forms.ToolStripMenuItem',
    '$menu.Items.Add($startupItem) | Out-Null',
    '',
    'function Update-StartupMenuItem {',
    '    if (Test-StartupInstalled) {',
    '        $startupItem.Text = "Uninstall auto-start at login"',
    '    } else {',
    '        $startupItem.Text = "Install auto-start at login"',
    '    }',
    '}',
    '',
    '$exeElevate = \'' + exePathLiteral + '\'',
    '',
    '$startupItem.Add_Click({',
    '    if (Test-StartupInstalled) {',
    '        $msg = "Remove NTE Tracker from automatic startup when you log in?" + [Environment]::NewLine + [Environment]::NewLine +',
    '            "The tracker will keep running until you choose Close."',
    '        $r = [System.Windows.Forms.MessageBox]::Show($msg, "NTE Tracker", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)',
    '        if ($r -ne [System.Windows.Forms.DialogResult]::Yes) { return }',
    '        try {',
    '            $p = Start-Process -FilePath $exeElevate -ArgumentList "--uninstall-tray" -Verb RunAs -Wait -PassThru',
    '            if ($p.ExitCode -ne 0) {',
    '                [System.Windows.Forms.MessageBox]::Show("Could not remove auto-start. Try again as Administrator.", "NTE Tracker", "OK", "Warning") | Out-Null',
    '            }',
    '        } catch {',
    '            [System.Windows.Forms.MessageBox]::Show("Administrator permission is required to change auto-start.", "NTE Tracker", "OK", "Warning") | Out-Null',
    '        }',
    '        Update-StartupMenuItem',
    '    } else {',
    '        $msg = "Install NTE Tracker to start automatically when you log in?" + [Environment]::NewLine + [Environment]::NewLine +',
    '            "Administrator permission will be requested."',
    '        $r = [System.Windows.Forms.MessageBox]::Show($msg, "NTE Tracker", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)',
    '        if ($r -ne [System.Windows.Forms.DialogResult]::Yes) { return }',
    '        try {',
    '            $p = Start-Process -FilePath $exeElevate -ArgumentList "--install-tray" -Verb RunAs -Wait -PassThru',
    '            if ($p.ExitCode -ne 0) {',
    '                [System.Windows.Forms.MessageBox]::Show("Could not install auto-start. Try again as Administrator.", "NTE Tracker", "OK", "Warning") | Out-Null',
    '            }',
    '        } catch {',
    '            [System.Windows.Forms.MessageBox]::Show("Administrator permission is required to install auto-start.", "NTE Tracker", "OK", "Warning") | Out-Null',
    '        }',
    '        Update-StartupMenuItem',
    '    }',
    '})',
    ''
  ] : [];

  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '',
    '$cmdFile = "' + cmdFile + '"',
    '$dashUrl = "' + dashboardUrl + '"',
    '',
    '# Delete stale command file',
    'if (Test-Path $cmdFile) { Remove-Item $cmdFile -Force }',
    '',
    '$tray = New-Object System.Windows.Forms.NotifyIcon',
    '$tray.Text = "NTE Tracker v' + APP_VERSION + '"',
    '$tray.Visible = $true',
    '',
    '# Icon: try to extract from the exe, fall back to system icon',
    'try {',
    '    $tray.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon("' + exePath + '")',
    '} catch {',
    '    $tray.Icon = [System.Drawing.SystemIcons]::Application',
    '}',
    '',
    '$menu = New-Object System.Windows.Forms.ContextMenuStrip',
    '',
    'function Add-MenuItem($text, $cmd) {',
    '    if ($text -eq "-") {',
    '        $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null',
    '        return',
    '    }',
    '    $mi = New-Object System.Windows.Forms.ToolStripMenuItem($text)',
    '    $c = $cmd; $cf = $cmdFile',
    '    $mi.Add_Click([scriptblock]::Create("[System.IO.File]::WriteAllText(`"$cf`", `"$c`")"))',
    '    $menu.Items.Add($mi) | Out-Null',
    '}',
    '',
    'Add-MenuItem "Open Dashboard" "open-dashboard"',
    'Add-MenuItem "Open Logs" "open-logs"',
    'Add-MenuItem "-" ""',
    'Add-MenuItem "Edit Config (.env.client)" "edit-config"',
    'Add-MenuItem "Check for Update" "check-update"',
  ].concat(updateMenuPs).concat([
    'Add-MenuItem "-" ""',
  ]).concat(startupMenuPs).concat([
    '$menu.add_Opening({',
    '    Update-UpdateMenuItem',
    '    if (Get-Command Update-StartupMenuItem -ErrorAction SilentlyContinue) { Update-StartupMenuItem }',
    '})',
    '',
    'Add-MenuItem "-" ""',
    'Add-MenuItem "Restart" "restart"',
    'Add-MenuItem "Close" "close"',
    '',
    '$tray.ContextMenuStrip = $menu',
    '$tray.add_DoubleClick({',
    '    [System.IO.File]::WriteAllText($cmdFile, "open-dashboard")',
    '})',
    '',
    '# Show balloon on start',
    '$tray.ShowBalloonTip(3000, "NTE Tracker", "Running v' + APP_VERSION + ' - Right-click for options", [System.Windows.Forms.ToolTipIcon]::None)',
    '',
    '[System.Windows.Forms.Application]::Run()',
    '',
    '$tray.Visible = $false',
    '$tray.Dispose()'
  ]).join('\r\n');
}

function startTrayIcon() {
  if (!TRAY_ENABLED) return;
  if (!process.platform.startsWith('win')) return;

  const { spawn } = require('child_process');
  const script = buildTrayScript();
  _trayProcess = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { windowsHide: true, stdio: 'ignore', detached: false });

  _trayProcess.on('error', (err) => log('Tray error: ' + err.message));
  _trayProcess.on('exit', (code) => {
    if (code !== 0) log('Tray process exited with code ' + code);
    _trayProcess = null;
  });

  _trayInterval = setInterval(pollTrayCommand, 1000);
  log('Tray icon started');
}

function stopTrayIcon() {
  if (_trayInterval) { clearInterval(_trayInterval); _trayInterval = null; }
  if (_trayProcess) { try { _trayProcess.kill(); } catch (e) {} _trayProcess = null; }
  try { if (fs.existsSync(TRAY_CMD_FILE)) fs.unlinkSync(TRAY_CMD_FILE); } catch (e) {}
}

function pollTrayCommand() {
  try {
    if (!fs.existsSync(TRAY_CMD_FILE)) return;
    const cmd = fs.readFileSync(TRAY_CMD_FILE, 'utf8').trim();
    fs.unlinkSync(TRAY_CMD_FILE);
    if (cmd) handleTrayCommand(cmd);
  } catch (e) {}
}

function handleTrayCommand(cmd) {
  log('Tray command: ' + cmd);
  switch (cmd) {
    case 'open-dashboard':
      dashboardOpened = false;
      openDashboard();
      break;
    case 'open-logs': {
      openLogsWindow();
      break;
    }
    case 'edit-config': {
      openConfigWindow();
      break;
    }
    case 'check-update':
      checkForUpdates({ manual: true });
      break;
    case 'update-now':
      _pendingUpdate = _pendingUpdate || loadPendingUpdateFromDisk();
      if (_pendingUpdate) {
        promptInstallUpdate(_pendingUpdate);
      } else {
        showWindowsMessageBox('No pending update. Use Check for Update first.', 'info');
      }
      break;
    case 'restart':
      restartTracker();
      break;
    case 'close':
      handleShutdown();
      break;
  }
}

function notifyTray(message) {
  if (!_trayProcess) return;
  const ps1Path = path.join(CONFIG.dataDir, 'tray-msg.ps1');
  const ps1 = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$ni = New-Object System.Windows.Forms.NotifyIcon',
    '$ni.Icon = [System.Drawing.SystemIcons]::Information',
    '$ni.Visible = $true',
    '$ni.ShowBalloonTip(4000, "NTE Tracker", "' + message.replace(/"/g, "'") + '", [System.Windows.Forms.ToolTipIcon]::None)',
    'Start-Sleep -Seconds 5',
    '$ni.Visible = $false',
    '$ni.Dispose()'
  ].join('\r\n');
  fs.writeFileSync(ps1Path, ps1, 'utf8');
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true }, () => {
    try { fs.unlinkSync(ps1Path); } catch (e) {}
  });
}

function restartTracker() {
  if (!IS_SEA) {
    log('Restart only supported when running as .exe');
    return;
  }
  log('Restarting tracker...');
  const { spawn } = require('child_process');
  spawn(process.execPath, process.argv.slice(1), {
    detached: true, stdio: 'ignore'
  }).unref();
  handleShutdown();
}

async function performAutoUpdate(updateInfo) {
  if (!IS_SEA) {
    log('Auto-update only supported when running as .exe. Visit: ' + updateInfo.releaseUrl);
    exec('start ' + updateInfo.releaseUrl, { windowsHide: true, shell: true });
    return;
  }
  if (!updateInfo.downloadUrl) {
    exec('start ' + updateInfo.releaseUrl, { windowsHide: true, shell: true });
    return;
  }

  log('Downloading update v' + updateInfo.version + '...');
  notifyTray('Downloading update v' + updateInfo.version + '...');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch(updateInfo.downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error('Download failed: ' + res.status);

    const tmpExe = path.join(os.tmpdir(), 'nte-tracker-update.exe');
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpExe, buf);

    const currentExe = process.execPath;
    const batPath = path.join(os.tmpdir(), 'nte-update-' + Date.now() + '.bat');
    const bat = [
      '@echo off',
      'timeout /t 3 /nobreak >nul',
      'copy /y "' + tmpExe + '" "' + currentExe + '"',
      'if errorlevel 1 (',
      '  echo Update failed: could not replace exe',
      '  pause',
      '  goto :eof',
      ')',
      'start "" "' + currentExe + '"',
      'del "' + tmpExe + '"',
      'del "%~f0"'
    ].join('\r\n');
    fs.writeFileSync(batPath, bat, 'ascii');

    log('Update downloaded. Launching helper and exiting...');
    clearPendingUpdate();
    const { spawn } = require('child_process');
    spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    handleShutdown();
  } catch (err) {
    log('Auto-update failed: ' + err.message);
    showWindowsMessageBox('Update failed: ' + err.message, 'error');
  }
}

// ── Install / Uninstall ───────────────────────────────────────────────────────

function isStartupTaskInstalled() {
  const { execSync } = require('child_process');
  try {
    execSync('schtasks /query /tn "NTETracker"', { shell: true, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

function showWindowsMessageBox(message, icon) {
  if (!process.platform.startsWith('win')) return;
  const { execSync } = require('child_process');
  ensureDataDirectory();
  const ps1Path = path.join(CONFIG.dataDir, 'msgbox.ps1');
  const iconName = icon === 'error' ? 'Error' : icon === 'warning' ? 'Warning' : 'Information';
  const ps1 = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$msg = ' + JSON.stringify(message),
    '[void][System.Windows.Forms.MessageBox]::Show($msg, "NTE Tracker", "OK", "' + iconName + '")'
  ].join('\r\n');
  try {
    fs.writeFileSync(ps1Path, ps1, 'utf8');
    execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true, shell: true });
  } catch (err) {
    // ignore UI errors
  }
}

function installStartupTask(options) {
  options = options || {};
  const exitProcess = options.exitProcess !== false;
  const spawnBackground = !!options.spawnBackground;
  const showDialog = !!options.showDialog;

  const { execSync } = require('child_process');
  const exePath = IS_SEA ? process.execPath : null;
  const taskCmd = exePath
    ? '"' + exePath + '"'
    : 'wscript.exe "' + path.join(APP_ROOT, 'launcher.vbs') + '"';

  const cmds = [
    'schtasks /create /tn "NTETracker" /tr ' + taskCmd + ' /sc onlogon /rl limited /f',
    'powershell -NoProfile -Command "Set-ScheduledTask -TaskName NTETracker -Settings ' +
      '(New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1'
  ];

  log('Installing NTE Tracker startup task (NTETracker)...');
  try {
    execSync(cmds.join(' && '), { shell: true, windowsHide: true, stdio: 'pipe' });
    log('Installed as startup task (NTETracker)');
    log('It will start automatically at next login.');
    if (showDialog) {
      showWindowsMessageBox('Auto-start installed. NTE Tracker will run when you log in.', 'info');
    }
    if (spawnBackground) {
      log('Starting tracker now...');
      launchTrackerInBackground();
      log('Tracker started in the background. Check the tray icon in the notification area.');
    }
    if (exitProcess) process.exit(0);
    return true;
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    log('Install failed: ' + detail);
    if (showDialog) {
      showWindowsMessageBox('Could not install auto-start.\n\n' + detail, 'error');
    } else {
      log('Tip: open Command Prompt as Administrator and run: nte-tracker.exe --install');
    }
    if (exitProcess) process.exit(1);
    return false;
  }
}

function uninstallStartupTask(options) {
  options = options || {};
  const exitProcess = options.exitProcess !== false;
  const showDialog = !!options.showDialog;

  const { execSync } = require('child_process');
  log('Removing NTE Tracker startup task (NTETracker)...');
  try {
    execSync('schtasks /delete /tn "NTETracker" /f', { shell: true, windowsHide: true, stdio: 'pipe' });
    log('Startup task removed (NTETracker)');
    if (showDialog) {
      showWindowsMessageBox('Auto-start removed. NTE Tracker will not start at login.', 'info');
    }
    if (exitProcess) process.exit(0);
    return true;
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim() : err.message;
    log('Uninstall warning: ' + detail);
    if (showDialog) {
      showWindowsMessageBox('Could not remove auto-start.\n\n' + detail, 'warning');
      if (exitProcess) process.exit(1);
      return false;
    }
    if (exitProcess) process.exit(0);
    return false;
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

/**
 * Starts the local HTTP server for the dashboard
 */
function startServer() {
  if (!CONFIG.localDashboardEnabled) {
    log('Local dashboard disabled');
    return;
  }
  var server = http.createServer(function (req, res) {
    // Serve static dashboard files
    if (req.method === 'GET' && req.url in STATIC_FILES) {
      var file = STATIC_FILES[req.url];
      var headers = { 'Content-Type': file.type };
      if (file.cache) headers['Cache-Control'] = file.cache;
      res.writeHead(200, headers);
      res.end(file.content);
    }
    else if (req.method === 'GET' && req.url === '/share') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      res.end(generateShareCard());
    }
    else if (req.method === 'GET' && req.url === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(getDashboardData()));
    }
    else if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('event: init\ndata: ' + JSON.stringify(getDashboardData()) + '\n\n');
      sseClients.push(res);
      var removeClient = function () {
        sseClients = sseClients.filter(function (c) { return c !== res; });
      };
      req.on('close', removeClient);
      req.on('error', removeClient);
      res.on('error', removeClient);
    }
    else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(CONFIG.port, '127.0.0.1', function () {
    log('Dashboard: http://127.0.0.1:' + CONFIG.port);
  });

  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      log('Port ' + CONFIG.port + ' already in use — another instance is likely running. Exiting.');
      process.exit(0);
    } else {
      log('Server error: ' + err.message);
    }
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Handles graceful shutdown
 */
function handleShutdown() {
  log('Shutting down gracefully...');
  stopTrayIcon();
  broadcastSSE('shutdown', {});

  if (isGameRunning && sessionStartTime) {
    const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    if (sessionDuration >= CONFIG.minSessionDuration) {
      const session = {
        startTime: new Date(sessionStartTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: sessionDuration
      };
      data.totalSeconds += sessionDuration;
      data.sessions.push(session);
      enqueueSession(session);
      log('Saved active session: ' + formatTime(sessionDuration));
    }
  }

  saveData(false);
  writePlaytimeLog();
  log('Shutdown complete');
  process.exit(0);
}

/**
 * Main polling loop (async process detection)
 */
function pollProcess() {
  checkProcessRunning(function (currentlyRunning) {
    // Game just started
    if (currentlyRunning && !isGameRunning) {
      isGameRunning = true;
      sessionStartTime = Date.now();
      tickCount = 0;
      log('Game started - session begin');
      broadcastSSE('session-start', { startTime: sessionStartTime });
      openDashboard();
    }
    // Game just stopped
    else if (!currentlyRunning && isGameRunning) {
      isGameRunning = false;
      const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);

      if (sessionDuration >= CONFIG.minSessionDuration) {
        const session = {
          startTime: new Date(sessionStartTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: sessionDuration
        };
        data.totalSeconds += sessionDuration;
        data.sessions.push(session);
        enqueueSession(session);
        saveData(false);

        log('Game stopped - session: ' + formatTime(sessionDuration) + ', total: ' + formatTime(data.totalSeconds));
        showNotification(sessionDuration, data.totalSeconds);
        writePlaytimeLog();
        broadcastSSE('session-end', {
          totalSeconds: data.totalSeconds,
          sessions: data.sessions,
          initialOffset: CONFIG.initialOffset
        });

        if (CONFIG.syncOnEnd) syncWithServer('session-end');
      } else {
        log('Game stopped - session too short (' + sessionDuration + 's), discarded');
        broadcastSSE('session-end', {
          totalSeconds: data.totalSeconds,
          sessions: data.sessions,
          initialOffset: CONFIG.initialOffset
        });
      }

      sessionStartTime = null;
      tickCount = 0;
    }
    // Game still running - interim save
    else if (currentlyRunning && isGameRunning) {
      tickCount++;
      if (tickCount >= TICKS_PER_SAVE) {
        var currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
        saveData(true);
        log('Interim save - session: ' + formatTime(currentDuration));
        tickCount = 0;
      }
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (CLI_INSTALL) {
  installStartupTask({ exitProcess: true, spawnBackground: IS_SEA });
} else if (CLI_INSTALL_TRAY) {
  installStartupTask({ exitProcess: true, spawnBackground: false, showDialog: true });
} else if (CLI_UNINSTALL) {
  uninstallStartupTask({ exitProcess: true });
} else if (CLI_UNINSTALL_TRAY) {
  uninstallStartupTask({ exitProcess: true, showDialog: true });
} else {
  log(CONFIG.gameName + ' Tracker started v' + APP_VERSION);
  log('Process: ' + CONFIG.processName);
  log('Poll interval: ' + CONFIG.pollInterval + 'ms');
  log('Data file: ' + CONFIG.dataFile);
  if (IS_SEA) log('Running as standalone .exe');
  if (IS_SEA) log('Log file: ' + path.join(CONFIG.dataDir, 'tracker.log'));
  if (TRAY_ENABLED) log('Tray icon: enabled');

  data = loadData();
  log('Current total time: ' + formatTime(data.totalSeconds));
  log('Sessions tracked: ' + data.sessions.length);

  if (IS_CLIENT_MODE) {
    clientState = loadClientState();
    applyDeviceCredentialPolicy();
    uploadQueue = loadQueue();
    if (CONFIG.syncOnStart && !CLI_SYNC_ONLY) syncWithServer('startup');
  }

  if (CLI_SYNC_ONLY) {
    if (!IS_CLIENT_MODE) {
      log('Sync skipped: NTE_SERVER_URL is not set');
      process.exit(0);
    } else {
      syncWithServer('manual')
        .then(function () { process.exit(0); })
        .catch(function () { process.exit(1); });
    }
  } else {
    writePlaytimeLog();
    log('Playtime log: ' + CONFIG.playtimeFile);

    _pendingUpdate = loadPendingUpdateFromDisk();

    startServer();
    startTrayIcon();
    checkForUpdates();

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

    setInterval(pollProcess, CONFIG.pollInterval);
    log('Polling started');
  }
}
