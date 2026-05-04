/**
 * Neverness to Everness Game Time Tracker
 * Tracks game process runtime and maintains session history
 * Serves a live dashboard via local HTTP server with Server-Sent Events
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

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
  get dataDir() {
    return path.join(process.env.LOCALAPPDATA, this.appName);
  },
  get dataFile() {
    return path.join(this.dataDir, 'data.json');
  },
  get playtimeFile() {
    return path.join(this.dataDir, 'playtime.txt');
  }
};

// State variables
let isGameRunning = false;
let sessionStartTime = null;
let tickCount = 0;
let data = null; // loaded once, kept in memory
let dashboardOpened = false; // whether browser was opened this tracker run
let sseClients = []; // active SSE connections
const TICKS_PER_SAVE = CONFIG.interimSaveInterval / CONFIG.pollInterval; // 12 ticks

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
 * Opens the dashboard in the default browser (only once per tracker run)
 */
function openDashboard() {
  if (dashboardOpened) return;
  exec('start http://127.0.0.1:' + CONFIG.port, { windowsHide: true, shell: true });
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
    '/bg.png': { path: 'bg.png', type: 'image/png', encoding: null, cache: 'public, max-age=86400' }
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

// ── HTTP Server ──────────────────────────────────────────────────────────────

/**
 * Starts the local HTTP server for the dashboard
 */
function startServer() {
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
  broadcastSSE('shutdown', {});

  if (isGameRunning && sessionStartTime) {
    const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    if (sessionDuration >= CONFIG.minSessionDuration) {
      data.totalSeconds += sessionDuration;
      data.sessions.push({
        startTime: new Date(sessionStartTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: sessionDuration
      });
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
        data.totalSeconds += sessionDuration;
        data.sessions.push({
          startTime: new Date(sessionStartTime).toISOString(),
          endTime: new Date().toISOString(),
          duration: sessionDuration
        });
        saveData(false);

        log('Game stopped - session: ' + formatTime(sessionDuration) + ', total: ' + formatTime(data.totalSeconds));
        showNotification(sessionDuration, data.totalSeconds);
        writePlaytimeLog();
        broadcastSSE('session-end', {
          totalSeconds: data.totalSeconds,
          sessions: data.sessions,
          initialOffset: CONFIG.initialOffset
        });
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

log(CONFIG.gameName + ' Tracker started');
log('Process: ' + CONFIG.processName);
log('Poll interval: ' + CONFIG.pollInterval + 'ms');
log('Data file: ' + CONFIG.dataFile);

data = loadData();
log('Current total time: ' + formatTime(data.totalSeconds));
log('Sessions tracked: ' + data.sessions.length);

writePlaytimeLog();
log('Playtime log: ' + CONFIG.playtimeFile);

startServer();

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

setInterval(pollProcess, CONFIG.pollInterval);
log('Polling started');
