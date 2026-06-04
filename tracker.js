/**
 * Neverness to Everness Game Time Tracker
 * Tracks game process runtime and maintains session history
 * Serves a live dashboard via local HTTP server with Server-Sent Events
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const APP_VERSION = (function () {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0';
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

loadEnvFile(path.join(__dirname, '.env.client'));
loadEnvFile(path.join(__dirname, '.env'));

function envFlag(name, defaultValue) {
  if (process.env[name] === undefined) return defaultValue;
  const value = String(process.env[name]).trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
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
 * Logs a message with timestamp
 */
function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log('[' + timestamp + '] ' + msg);
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

  if (process.env.NTE_DEVICE_ID && String(process.env.NTE_DEVICE_ID).trim()) {
    state.deviceId = String(process.env.NTE_DEVICE_ID).trim();
  }
  if (process.env.NTE_DEVICE_TOKEN && String(process.env.NTE_DEVICE_TOKEN).trim()) {
    state.deviceToken = String(process.env.NTE_DEVICE_TOKEN).trim();
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

async function ensureDeviceRegistered() {
  if (!IS_CLIENT_MODE) return false;
  if (clientState.deviceId && clientState.deviceToken) return true;
  if (!CONFIG.deviceAutoRegister) {
    log('Server sync disabled: missing device credentials');
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
    log('Device registration failed (' + res.status + ')');
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
  const res = await fetchJson(CONFIG.serverUrl + '/api/devices/' + clientState.deviceId + '/last', {
    method: 'GET',
    headers: buildAuthHeaders()
  });

  if (!res.ok || !res.json) {
    log('Failed to fetch last server timestamp (' + res.status + ')');
    return null;
  }

  return res.json.lastEndTime || null;
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

    const serverLastEndTime = await fetchLastServerEndTime();
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

    if (!res.ok) {
      log('Sync failed (' + res.status + ') for ' + combined.length + ' sessions');
      return;
    }

    const newLastEnd = getMaxEndTime(combined, syncCutoff);
    clientState.lastServerEndTime = newLastEnd;
    clientState.lastSyncTime = nowIso();
    saveClientState(clientState);
    pruneQueueAfter(newLastEnd);
    log('Sync ok (' + reason + '): ' + combined.length + ' sessions');
  } catch (err) {
    log('Sync error: ' + err.message);
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

/**
 * Shows a Windows toast notification when a newer tracker version is available.
 * Runs at most once per calendar day, stored in clientState.lastUpdateCheck.
 */
async function checkForUpdates() {
  if (!IS_CLIENT_MODE && typeof fetch !== 'function') return;
  if (typeof fetch !== 'function') return;
  try {
    if (!clientState) clientState = loadClientState();
    const todayKey = new Date().toISOString().slice(0, 10);
    if (clientState.lastUpdateCheck === todayKey) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let data;
    try {
      const res = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest', {
        headers: { 'User-Agent': 'nte-time-tracker/' + APP_VERSION, 'Accept': 'application/vnd.github+json' },
        signal: controller.signal
      });
      if (!res.ok) return;
      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const latestVersion = data && data.tag_name ? data.tag_name.replace(/^v/, '') : null;
    if (!latestVersion) return;

    clientState.lastUpdateCheck = todayKey;
    saveClientState(clientState);

    if (!semverGt(latestVersion, APP_VERSION)) return;

    const releaseUrl = data.html_url || ('https://github.com/' + GITHUB_REPO + '/releases/latest');
    const exeAsset = data.assets && data.assets.find(function (a) {
      return a.name && a.name.toLowerCase().endsWith('.exe');
    });
    _pendingUpdate = {
      version: latestVersion,
      downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
      releaseUrl: releaseUrl
    };
    log('Update available: v' + latestVersion + ' (current: v' + APP_VERSION + ')');

    const ps1Path = path.join(CONFIG.dataDir, 'update-notify.ps1');
    const ps1Content = [
      '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
      '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
      '$template = @"',
      '<toast>',
      '  <visual>',
      '    <binding template="ToastGeneric">',
      '      <text>NTE Tracker Update Available</text>',
      '      <text>New version: v' + latestVersion + ' (current: v' + APP_VERSION + ')</text>',
      '      <text>' + releaseUrl + '</text>',
      '    </binding>',
      '  </visual>',
      '  <audio silent="true"/>',
      '</toast>',
      '"@',
      '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
      '$xml.LoadXml($template)',
      '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + CONFIG.appName + "').Show($toast)"
    ].join('\n');

    fs.writeFileSync(ps1Path, ps1Content, 'utf8');
    exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true }, (err) => {
      if (err) log('Update notification error: ' + err.message);
      fs.unlink(ps1Path, () => {});
    });
  } catch (err) {
    log('Update check failed: ' + err.message);
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
    var fullPath = path.join(__dirname, f.path);
    try {
      var content = f.encoding ? fs.readFileSync(fullPath, f.encoding) : fs.readFileSync(fullPath);
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

const IS_SEA = (function () {
  const exe = process.execPath.toLowerCase();
  return !exe.endsWith('node.exe') && !exe.endsWith('node') && !exe.endsWith('node.exe"');
})();

const TRAY_ENABLED = IS_SEA || envFlag('NTE_TRAY', false);

const TRAY_CMD_FILE = path.join(os.tmpdir(), 'nte-tray-' + process.pid + '.cmd');
let _trayProcess = null;
let _trayInterval = null;
let _pendingUpdate = null; // { version, downloadUrl, releaseUrl }

function buildTrayScript() {
  const cmdFile = TRAY_CMD_FILE.replace(/\\/g, '\\\\');
  const exePath = process.execPath.replace(/\\/g, '\\\\');
  const dashboardUrl = 'http://127.0.0.1:' + CONFIG.port;

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
    'Add-MenuItem "-" ""',
    'Add-MenuItem "Edit Config (.env.client)" "edit-config"',
    'Add-MenuItem "Check for Update" "check-update"',
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
    '$tray.ShowBalloonTip(3000, "NTE Tracker", "Running v' + APP_VERSION + ' · Right-click for options", [System.Windows.Forms.ToolTipIcon]::None)',
    '',
    '[System.Windows.Forms.Application]::Run()',
    '',
    '$tray.Visible = $false',
    '$tray.Dispose()'
  ].join('\r\n');
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
    case 'edit-config': {
      const cfgPath = path.join(__dirname, '.env.client');
      if (!fs.existsSync(cfgPath)) {
        fs.writeFileSync(cfgPath, '# NTE Tracker client config\n# NTE_SERVER_URL=http://192.168.1.10:28183\n', 'utf8');
      }
      exec('notepad.exe "' + cfgPath + '"', { windowsHide: false });
      break;
    }
    case 'check-update':
      clientState = clientState || loadClientState();
      clientState.lastUpdateCheck = null;
      saveClientState(clientState);
      checkForUpdates().then(function () {
        if (!_pendingUpdate) notifyTray('No updates available (v' + APP_VERSION + ' is latest)');
      });
      break;
    case 'update-now':
      if (_pendingUpdate) performAutoUpdate(_pendingUpdate);
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
    const { spawn } = require('child_process');
    spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    handleShutdown();
  } catch (err) {
    log('Auto-update failed: ' + err.message);
    notifyTray('Update failed: ' + err.message);
  }
}

// ── Install / Uninstall ───────────────────────────────────────────────────────

function installStartupTask() {
  const exePath = IS_SEA ? process.execPath : null;
  const taskCmd = exePath
    ? '"' + exePath + '"'
    : 'wscript.exe "' + path.join(__dirname, 'launcher.vbs') + '"';

  const cmds = [
    'schtasks /create /tn "NTETracker" /tr ' + taskCmd + ' /sc onlogon /rl limited /f',
    'powershell -NoProfile -Command "Set-ScheduledTask -TaskName NTETracker -Settings ' +
      '(New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries)" >nul 2>&1'
  ];

  exec(cmds.join(' && '), { windowsHide: true, shell: true }, function (err) {
    if (err) {
      log('Install failed: ' + err.message);
      process.exit(1);
    }
    log('Installed as startup task (NTETracker)');
    log('It will start automatically at next login.');
    process.exit(0);
  });
}

function uninstallStartupTask() {
  exec('schtasks /delete /tn "NTETracker" /f', { windowsHide: true, shell: true }, function (err) {
    if (err) log('Uninstall warning: ' + err.message);
    else log('Startup task removed (NTETracker)');
    process.exit(0);
  });
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

log(CONFIG.gameName + ' Tracker started v' + APP_VERSION);
log('Process: ' + CONFIG.processName);
log('Poll interval: ' + CONFIG.pollInterval + 'ms');
log('Data file: ' + CONFIG.dataFile);
if (IS_SEA) log('Running as standalone .exe');
if (TRAY_ENABLED) log('Tray icon: enabled');

const args = process.argv.slice(2);
const syncOnly = args.includes('--sync');

if (args.includes('--install')) {
  installStartupTask();
  // installStartupTask calls process.exit — code below won't run
}
if (args.includes('--uninstall')) {
  uninstallStartupTask();
}

data = loadData();
log('Current total time: ' + formatTime(data.totalSeconds));
log('Sessions tracked: ' + data.sessions.length);

if (IS_CLIENT_MODE) {
  clientState = loadClientState();
  uploadQueue = loadQueue();
  if (CONFIG.syncOnStart && !syncOnly) syncWithServer('startup');
}

if (syncOnly) {
  if (!IS_CLIENT_MODE) {
    log('Sync skipped: NTE_SERVER_URL is not set');
    process.exit(0);
  } else {
    syncWithServer('manual')
      .then(function () { process.exit(0); })
      .catch(function () { process.exit(1); });
    return;
  }
}

writePlaytimeLog();
log('Playtime log: ' + CONFIG.playtimeFile);

checkForUpdates();

startServer();
startTrayIcon();

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

setInterval(pollProcess, CONFIG.pollInterval);
log('Polling started');
