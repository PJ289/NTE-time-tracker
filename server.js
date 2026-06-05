"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const APP_VERSION = (function () {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "0.0.0";
  } catch (e) {
    return "0.0.0";
  }
})();

const GITHUB_REPO = "PJ289/NTE-time-tracker";
let _latestVersionCache = null;
let _latestVersionCacheAt = 0;
const VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchLatestRelease() {
  if (_latestVersionCache && Date.now() - _latestVersionCacheAt < VERSION_CACHE_TTL_MS) {
    return _latestVersionCache;
  }
  try {
    const res = await fetch("https://api.github.com/repos/" + GITHUB_REPO + "/releases/latest", {
      headers: {
        "User-Agent": "nte-time-tracker/" + APP_VERSION,
        "Accept": "application/vnd.github+json"
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.tag_name) return null;
    _latestVersionCache = {
      tag: data.tag_name,
      version: data.tag_name.replace(/^v/, ""),
      url: data.html_url,
      prerelease: !!data.prerelease
    };
    _latestVersionCacheAt = Date.now();
    return _latestVersionCache;
  } catch (err) {
    return null;
  }
}

function semverGt(a, b) {
  const parse = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (err) {
    throw new Error("not readable (" + err.message + ")");
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let loaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (typeof existing === "string" && existing.length > 0) continue;
    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}

function getDataDir() {
  if (process.env.NTE_DATA_DIR) return process.env.NTE_DATA_DIR;
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "nte-tracker");
  return path.join(os.homedir(), ".nte-tracker");
}

function formatLocalDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds())
  );
}

function log(msg) {
  const timestamp = formatLocalDateTime(new Date());
  console.log("[" + timestamp + "] " + msg);
}

function tryLoadEnvFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    log("Env: " + label + " not found (" + filePath + ")");
    return false;
  }
  try {
    const count = loadEnvFile(filePath);
    log("Env: loaded " + label + " (" + filePath + ", " + count + " variable(s))");
    return true;
  } catch (err) {
    log("Env: " + label + " failed (" + filePath + "): " + err.message);
    return false;
  }
}

function bootstrapEnvFiles() {
  const appDir = __dirname;
  const dataDir = getDataDir();
  const candidates = [
    { filePath: path.join(appDir, ".env.server"), label: ".env.server (app dir)" },
    { filePath: path.join(appDir, ".env"), label: ".env (app dir)" },
    { filePath: path.join(dataDir, ".env.server"), label: ".env.server (data dir)" },
    { filePath: path.join(dataDir, ".env"), label: ".env (data dir)" }
  ];
  let anyLoaded = false;
  for (const item of candidates) {
    if (tryLoadEnvFile(item.filePath, item.label)) anyLoaded = true;
  }
  if (!anyLoaded) {
    log("Env: no .env / .env.server file loaded (using process environment only)");
  }
}

function logConfigStatus() {
  const token = CONFIG.adminToken;
  if (token) {
    log("Config: NTE_ADMIN_TOKEN is set (" + token.length + " characters)");
  } else {
    log("Config: NTE_ADMIN_TOKEN is NOT set — admin actions in the dashboard will fail");
    log("Config: set NTE_ADMIN_TOKEN in .env next to docker-compose.yml, or in " + DATA_DIR + "/.env.server");
  }
  log("Config: listening on " + CONFIG.host + ":" + CONFIG.port);
  log("Config: log timezone " + Intl.DateTimeFormat().resolvedOptions().timeZone);
}

bootstrapEnvFiles();

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "y";
  }
  return false;
}

const rawPort = parseInt(process.env.NTE_PORT || process.env.PORT || "27183", 10);
const rawMinSession = parseInt(process.env.NTE_MIN_SESSION_SECONDS || "30", 10);
const rawMergeGap = parseInt(process.env.NTE_MERGE_GAP_SECONDS || "120", 10);

const CONFIG = {
  gameName: "Neverness to Everness",
  appName: "nte-tracker",
  host: process.env.NTE_HOST || "0.0.0.0",
  port: Number.isNaN(rawPort) ? 27183 : rawPort,
  minSessionDuration: Number.isNaN(rawMinSession) ? 30 : rawMinSession,
  mergeGapSeconds: Number.isNaN(rawMergeGap) ? 120 : rawMergeGap,
  adminToken: process.env.NTE_ADMIN_TOKEN || "",
  maxBodyBytes: 1024 * 1024
};

const SCHEMA_VERSION = 2;

const DATA_DIR = getDataDir();
const DB_FILE = path.join(DATA_DIR, "nte.db");

let sseClients = [];
let configOverrides = null;

function logRequest(req, status, message) {
  const prefix = req.method + " " + req.url;
  if (message) log(prefix + " -> " + status + " (" + message + ")");
  else log(prefix + " -> " + status);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function pickDeviceColor(db) {
  const palette = [
    "#4db8ff",
    "#80d8ff",
    "#1976d2",
    "#26a69a",
    "#8bc34a",
    "#ffc107",
    "#ff7043",
    "#ab47bc",
    "#5c6bc0",
    "#ec407a"
  ];
  const used = db.prepare("SELECT color FROM devices").all().map(r => r.color);
  for (let i = 0; i < palette.length; i++) {
    if (!used.includes(palette[i])) return palette[i];
  }
  return "#" + crypto.randomBytes(3).toString("hex");
}

function initDb() {
  ensureDir(DATA_DIR);
  let db;
  try {
    db = new Database(DB_FILE);
  } catch (err) {
    if (err && err.code === "SQLITE_CANTOPEN") {
      log(
        "Cannot open SQLite database at " +
          DB_FILE +
          ". Ensure " +
          DATA_DIR +
          " exists and is writable by the container user (UID 1000 / node)."
      );
    }
    throw err;
  }
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const metaGet = db.prepare("SELECT value FROM meta WHERE key = ?");
  const metaSet = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

  const versionRow = metaGet.get("schema_version");
  if (!versionRow) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS devices (" +
        "id TEXT PRIMARY KEY, " +
        "name TEXT NOT NULL, " +
        "type TEXT NOT NULL, " +
        "color TEXT NOT NULL, " +
        "is_test INTEGER NOT NULL DEFAULT 0, " +
        "token_hash TEXT NOT NULL, " +
        "created_at TEXT NOT NULL, " +
        "updated_at TEXT NOT NULL, " +
        "last_seen TEXT" +
      ");" +
      "CREATE TABLE IF NOT EXISTS sessions (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "device_id TEXT NOT NULL, " +
        "start_time TEXT NOT NULL, " +
        "end_time TEXT NOT NULL, " +
        "duration INTEGER NOT NULL, " +
        "is_manual INTEGER NOT NULL DEFAULT 0, " +
        "created_at TEXT NOT NULL, " +
        "updated_at TEXT NOT NULL, " +
        "UNIQUE(device_id, start_time, end_time), " +
        "FOREIGN KEY (device_id) REFERENCES devices(id)" +
      ");" +
      "CREATE INDEX IF NOT EXISTS idx_sessions_device_time ON sessions(device_id, start_time);" +
      "CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);"
    );
    metaSet.run("schema_version", String(SCHEMA_VERSION));
  } else {
    const currentVersion = parseInt(versionRow.value, 10) || 1;
    if (currentVersion < 2) {
      migrateToV2(db);
      metaSet.run("schema_version", "2");
    }
  }

  migrateFromJsonIfNeeded(db, metaGet, metaSet);
  configOverrides = loadConfigOverrides(metaGet);

  return db;
}

function loadConfigOverrides(metaGet) {
  const row = metaGet.get("config_overrides");
  if (!row || !row.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (err) {
    log("Config overrides parse error: " + err.message);
    return {};
  }
}

function saveConfigOverrides(metaSet, overrides) {
  configOverrides = overrides || {};
  metaSet.run("config_overrides", JSON.stringify(configOverrides));
}

function getConfigValue(key, fallback) {
  if (!configOverrides) return fallback;
  if (typeof configOverrides[key] === "undefined") return fallback;
  return configOverrides[key];
}

function getMinSessionDuration() {
  const value = parseInt(getConfigValue("minSessionDuration", CONFIG.minSessionDuration), 10);
  return Number.isNaN(value) ? CONFIG.minSessionDuration : value;
}

function getMergeGapSeconds() {
  const value = parseInt(getConfigValue("mergeGapSeconds", CONFIG.mergeGapSeconds), 10);
  return Number.isNaN(value) ? CONFIG.mergeGapSeconds : value;
}

function getEffectiveConfig() {
  return {
    host: getConfigValue("host", CONFIG.host),
    port: getConfigValue("port", CONFIG.port),
    dataDir: getConfigValue("dataDir", DATA_DIR),
    minSessionDuration: getMinSessionDuration(),
    mergeGapSeconds: getMergeGapSeconds()
  };
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (seconds < 300) return hours + "h " + minutes + "m " + secs + "s";
  return hours + "h " + minutes + "m";
}

function migrateToV2(db) {
  try {
    db.exec("ALTER TABLE devices ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
  } catch (err) {
    log("Device is_test migration skipped: " + err.message);
  }
}

function migrateFromJsonIfNeeded(db, metaGet, metaSet) {
  const imported = metaGet.get("imported_json_v1");
  if (imported) return;

  const legacyPath = process.env.NTE_LEGACY_JSON || getLegacyJsonPath();
  if (!legacyPath || !fs.existsSync(legacyPath)) return;

  let legacyRaw;
  try {
    legacyRaw = fs.readFileSync(legacyPath, "utf8");
  } catch (err) {
    log("Legacy JSON read failed: " + err.message);
    return;
  }

  let legacy;
  try {
    legacy = JSON.parse(legacyRaw);
  } catch (err) {
    log("Legacy JSON parse failed: " + err.message);
    return;
  }

  const deviceId = ensureLegacyDevice(db, metaGet, metaSet);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO sessions (device_id, start_time, end_time, duration, is_manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  const tx = db.transaction((rows) => {
    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = normalizeLegacySession(rows[i]);
      if (!row) continue;
      const res = insert.run(deviceId, row.startTime, row.endTime, row.duration, 0, row.createdAt, row.updatedAt);
      if (res.changes > 0) count++;
    }
    return count;
  });

  const sessions = Array.isArray(legacy.sessions) ? legacy.sessions.slice() : [];
  if (legacy.activeSession) {
    const active = normalizeActiveSession(legacy.activeSession);
    if (active) sessions.push(active);
  }

  const inserted = tx(sessions);
  metaSet.run("imported_json_v1", nowIso());
  log("Legacy JSON import complete: " + inserted + " sessions from " + legacyPath);
}

function getLegacyJsonPath() {
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "nte-tracker", "data.json");
  }
  return null;
}

function ensureLegacyDevice(db, metaGet, metaSet) {
  const existing = metaGet.get("legacy_device_id");
  if (existing && existing.value) return existing.value;

  const id = generateId();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = nowIso();
  const color = pickDeviceColor(db);

  db.prepare(
    "INSERT INTO devices (id, name, type, color, is_test, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "PC (Legacy)", "pc", color, 0, tokenHash, now, now);

  metaSet.run("legacy_device_id", id);
  log("Legacy device created: " + id + " (token not exported)");
  return id;
}

function normalizeLegacySession(session) {
  if (!session || !session.startTime || !session.endTime) return null;
  const start = toIso(session.startTime);
  const end = toIso(session.endTime);
  if (!start || !end) return null;
  if (new Date(end).getTime() < new Date(start).getTime()) return null;
  const duration = session.duration ? Math.max(0, parseInt(session.duration, 10)) : Math.max(0, Math.floor((new Date(end) - new Date(start)) / 1000));
  return { startTime: start, endTime: end, duration: duration, createdAt: nowIso(), updatedAt: nowIso() };
}

function normalizeActiveSession(active) {
  if (!active || !active.startTime || !active.lastUpdateTime) return null;
  const start = toIso(active.startTime);
  const end = toIso(active.lastUpdateTime);
  if (!start || !end) return null;
  if (new Date(end).getTime() < new Date(start).getTime()) return null;
  const duration = active.duration ? Math.max(0, parseInt(active.duration, 10)) : Math.max(0, Math.floor((new Date(end) - new Date(start)) / 1000));
  return { startTime: start, endTime: end, duration: duration, createdAt: nowIso(), updatedAt: nowIso() };
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const d = new Date(num);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    }
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  return null;
}

function readJson(req, res) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > CONFIG.maxBodyBytes) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload too large");
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        resolve(null);
      }
    });
  });
}

function readText(req, res) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > CONFIG.maxBodyBytes) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload too large");
        req.destroy();
        resolve(null);
      }
    });
    req.on("end", () => resolve(body));
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
  res.end(JSON.stringify(data));
}

function authenticate(db, req) {
  const adminToken = req.headers["x-admin-token"];
  if (adminToken) {
    if (!CONFIG.adminToken) {
      logRequest(req, 503, "admin token not configured on server");
      return {
        ok: false,
        status: 503,
        error: "Admin token not configured on server (set NTE_ADMIN_TOKEN and restart)"
      };
    }
    if (adminToken !== CONFIG.adminToken) {
      logRequest(req, 401, "admin auth failed");
      return { ok: false, status: 401, error: "Invalid admin token" };
    }
    logRequest(req, 200, "admin auth");
    return { ok: true, isAdmin: true, deviceId: null };
  }

  const deviceId = req.headers["x-device-id"];
  const deviceToken = req.headers["x-device-token"];
  if (!deviceId || !deviceToken) return { ok: false, status: 401, error: "Missing device auth headers" };

  const hash = hashToken(String(deviceToken));
  const row = db.prepare("SELECT id FROM devices WHERE id = ? AND token_hash = ?").get(deviceId, hash);
  if (!row) return { ok: false, status: 401, error: "Invalid device token" };

  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(nowIso(), deviceId);
  return { ok: true, isAdmin: false, deviceId: deviceId };
}

function mergeDevices(db, targetDeviceId, sourceDeviceIds) {
  const target = db.prepare("SELECT id, last_seen AS lastSeen FROM devices WHERE id = ?").get(targetDeviceId);
  if (!target) return { error: "Target device not found", status: 404 };

  const uniqueSources = Array.from(new Set(sourceDeviceIds.map((id) => String(id).trim())))
    .filter((id) => id && id !== targetDeviceId);
  if (!uniqueSources.length) {
    return { error: "At least one source device required (different from target)", status: 400 };
  }

  for (let i = 0; i < uniqueSources.length; i++) {
    const sourceId = uniqueSources[i];
    const src = db.prepare("SELECT id FROM devices WHERE id = ?").get(sourceId);
    if (!src) return { error: "Source device not found: " + sourceId, status: 404 };
  }

  let moved = 0;
  let duplicatesRemoved = 0;
  let maxLastSeen = target.lastSeen || null;

  const tx = db.transaction(function () {
    for (let s = 0; s < uniqueSources.length; s++) {
      const sourceId = uniqueSources[s];
      const sourceDevice = db.prepare("SELECT last_seen AS lastSeen FROM devices WHERE id = ?").get(sourceId);
      if (sourceDevice && sourceDevice.lastSeen) {
        if (!maxLastSeen || new Date(sourceDevice.lastSeen) > new Date(maxLastSeen)) {
          maxLastSeen = sourceDevice.lastSeen;
        }
      }

      const sessions = db.prepare(
        "SELECT id, start_time AS startTime, end_time AS endTime FROM sessions WHERE device_id = ?"
      ).all(sourceId);

      for (let j = 0; j < sessions.length; j++) {
        const session = sessions[j];
        const dup = db.prepare(
          "SELECT id FROM sessions WHERE device_id = ? AND start_time = ? AND end_time = ?"
        ).get(targetDeviceId, session.startTime, session.endTime);

        if (dup) {
          db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
          duplicatesRemoved++;
        } else {
          db.prepare("UPDATE sessions SET device_id = ?, updated_at = ? WHERE id = ?").run(
            targetDeviceId,
            nowIso(),
            session.id
          );
          moved++;
        }
      }

      db.prepare("DELETE FROM devices WHERE id = ?").run(sourceId);
    }

    if (maxLastSeen) {
      db.prepare("UPDATE devices SET last_seen = ?, updated_at = ? WHERE id = ?").run(
        maxLastSeen,
        nowIso(),
        targetDeviceId
      );
    } else {
      db.prepare("UPDATE devices SET updated_at = ? WHERE id = ?").run(nowIso(), targetDeviceId);
    }
  });

  tx();

  return {
    ok: true,
    targetDeviceId: targetDeviceId,
    sourceDeviceIds: uniqueSources,
    moved: moved,
    duplicatesRemoved: duplicatesRemoved,
    sourcesRemoved: uniqueSources.length
  };
}

function getUnknownDeviceId(db, metaGet, metaSet) {
  const existing = metaGet.get("unknown_device_id");
  if (existing && existing.value) return existing.value;

  const id = generateId();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const now = nowIso();
  const color = "#666666";

  db.prepare(
    "INSERT INTO devices (id, name, type, color, is_test, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, "Unknown", "unknown", color, 0, tokenHash, now, now);

  metaSet.run("unknown_device_id", id);
  return id;
}

function getDashboardData(db) {
  const sessions = db.prepare(
    "SELECT s.id, s.start_time AS startTime, s.end_time AS endTime, s.duration, s.is_manual AS isManual, " +
    "s.device_id AS deviceId, d.name AS deviceName, d.color AS deviceColor, d.type AS deviceType, d.is_test AS deviceIsTest " +
    "FROM sessions s LEFT JOIN devices d ON d.id = s.device_id " +
    "ORDER BY s.start_time ASC"
  ).all();

  const totalRow = db.prepare("SELECT COALESCE(SUM(duration), 0) AS totalSeconds FROM sessions").get();
  const devices = db.prepare("SELECT id, name, type, color, is_test AS isTest, created_at AS createdAt, updated_at AS updatedAt, last_seen AS lastSeen FROM devices ORDER BY created_at ASC").all();

  return {
    gameName: CONFIG.gameName,
    totalSeconds: totalRow.totalSeconds || 0,
    sessions: sessions,
    devices: devices,
    initialOffset: 0,
    liveSession: null,
    lastUpdated: nowIso()
  };
}

function broadcastSSE(eventType, eventData) {
  const payload = "event: " + eventType + "\ndata: " + JSON.stringify(eventData) + "\n\n";
  sseClients = sseClients.filter((res) => {
    try {
      res.write(payload);
      return true;
    } catch (err) {
      return false;
    }
  });
}

function broadcastDataUpdate(db) {
  const payload = getDashboardData(db);
  broadcastSSE("data", payload);
}

function generateShareCard(db) {
  const totalRow = db.prepare("SELECT COALESCE(SUM(duration), 0) AS totalSeconds FROM sessions").get();
  const total = totalRow.totalSeconds || 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  const sessionCountRow = db.prepare("SELECT COUNT(1) AS count FROM sessions").get();
  const sessionCount = sessionCountRow.count || 0;

  const dayRows = db.prepare("SELECT DISTINCT date(start_time) AS day FROM sessions").all();
  const daysPlayed = dayRows.length;

  const longestRow = db.prepare("SELECT MAX(duration) AS maxDuration FROM sessions").get();
  const longest = longestRow.maxDuration || 0;

  const daySet = {};
  for (let i = 0; i < dayRows.length; i++) {
    const parts = String(dayRows[i].day).split("-");
    if (parts.length === 3) {
      daySet[parts[0] + "-" + parseInt(parts[1], 10) + "-" + parseInt(parts[2], 10)] = true;
    }
  }

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sortedDays = Object.keys(daySet).sort((a, b) => {
    const pa = a.split("-"), pb = b.split("-");
    return new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2]);
  });
  for (let i = 0; i < sortedDays.length; i++) {
    const parts = sortedDays[i].split("-");
    const gd = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    gd.setHours(0, 0, 0, 0);
    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (gd.getTime() === expected.getTime()) streak++;
    else break;
  }

  const weekBars = [];
  let maxDay = 1;
  for (let d = 6; d >= 0; d--) {
    const day = new Date(today);
    day.setDate(day.getDate() - d);
    const key = day.toISOString().slice(0, 10);
    const row = db.prepare("SELECT COALESCE(SUM(duration), 0) AS total FROM sessions WHERE date(start_time) = ?").get(key);
    const dayTotal = row.total || 0;
    if (dayTotal > maxDay) maxDay = dayTotal;
    weekBars.push({ label: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day.getDay()], value: dayTotal });
  }

  const barMaxH = 60;
  let barsXml = "";
  for (let i = 0; i < weekBars.length; i++) {
    const bh = weekBars[i].value > 0 ? Math.max(4, Math.round((weekBars[i].value / maxDay) * barMaxH)) : 0;
    const bx = 30 + i * 50;
    const by = 255 - bh;
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
    '<text x="330" y="112" text-anchor="middle" fill="#ccc" font-family="Segoe UI,sans-serif" font-size="14" font-weight="600">' + streak + '\ud83d\udd25</text>',
    '<text x="330" y="126" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.5">STREAK</text>',
    '',
    '<line x1="40" y1="140" x2="360" y2="140" stroke="#222" stroke-width="1"/>',
    '',
    '<text x="200" y="162" text-anchor="middle" fill="#555" font-family="Segoe UI,sans-serif" font-size="10" letter-spacing="0.5">LAST 7 DAYS</text>',
    '',
    barsXml,
    '',
    '</svg>'
  ].join("\n");
}

const STATIC_FILES = (function loadStaticFiles() {
  const files = {
    "/": { path: "dashboard.html", type: "text/html; charset=utf-8", encoding: "utf8" },
    "/dashboard.css": { path: "dashboard.css", type: "text/css; charset=utf-8", encoding: "utf8" },
    "/dashboard.js": { path: "dashboard.js", type: "application/javascript; charset=utf-8", encoding: "utf8" },
    "/sw.js": { path: "sw.js", type: "application/javascript; charset=utf-8", encoding: "utf8", cache: "no-cache" },
    "/manifest.webmanifest": { path: "manifest.webmanifest", type: "application/manifest+json; charset=utf-8", encoding: "utf8", cache: "public, max-age=86400" },
    "/favicon.ico": { path: "favicon.ico", type: "image/x-icon", encoding: null, cache: "public, max-age=86400" },
    "/bg.png": { path: "bg.png", type: "image/png", encoding: null, cache: "public, max-age=86400" },
    "/icons/icon-192.png": { path: "icons/icon-192.png", type: "image/png", encoding: null, cache: "public, max-age=86400" },
    "/icons/icon-512.png": { path: "icons/icon-512.png", type: "image/png", encoding: null, cache: "public, max-age=86400" }
  };
  const cache = {};
  for (const route in files) {
    const f = files[route];
    const fullPath = path.join(__dirname, f.path);
    try {
      const content = f.encoding ? fs.readFileSync(fullPath, f.encoding) : fs.readFileSync(fullPath);
      cache[route] = { content: content, type: f.type, cache: f.cache || null };
    } catch (err) {
      log("Warning: missing dashboard file: " + f.path + " (" + err.message + ")");
    }
  }
  return cache;
})();

function startServer(db) {
  const metaGet = db.prepare("SELECT value FROM meta WHERE key = ?");
  const metaSet = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;

    if (req.method === "GET" && pathname in STATIC_FILES) {
      const file = STATIC_FILES[pathname];
      const headers = { "Content-Type": file.type };
      if (file.cache) headers["Cache-Control"] = file.cache;
      res.writeHead(200, headers);
      res.end(file.content);
      return;
    }

    if (req.method === "GET" && pathname === "/data") {
      sendJson(res, 200, getDashboardData(db));
      logRequest(req, 200, "data");
      return;
    }

    if (req.method === "GET" && pathname === "/api/version") {
      const latest = await fetchLatestRelease();
      const latestVersion = latest ? latest.version : null;
      const updateAvailable = latestVersion ? semverGt(latestVersion, APP_VERSION) : false;
      sendJson(res, 200, {
        version: APP_VERSION,
        latestVersion: latestVersion,
        latestTag: latest ? latest.tag : null,
        updateAvailable: updateAvailable,
        releaseUrl: latest ? latest.url : null,
        prerelease: latest ? latest.prerelease : null
      });
      logRequest(req, 200, "version check");
      return;
    }

    if (req.method === "GET" && pathname === "/share") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
      res.end(generateShareCard(db));
      logRequest(req, 200, "share");
      return;
    }

    if (req.method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("event: init\ndata: " + JSON.stringify(getDashboardData(db)) + "\n\n");
      sseClients.push(res);
      const removeClient = () => {
        sseClients = sseClients.filter((c) => c !== res);
      };
      req.on("close", removeClient);
      req.on("error", removeClient);
      res.on("error", removeClient);
      return;
    }

    if (req.method === "POST" && pathname === "/api/devices/register") {
      const body = await readJson(req, res);
      if (!body) return;

      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "New Device";
      const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "unknown";
      const color = typeof body.color === "string" && body.color.trim() ? body.color.trim() : pickDeviceColor(db);
      const isTest = parseBool(body.isTest || body.is_test || body.test);

      const deviceId = generateId();
      const token = generateToken();
      const tokenHash = hashToken(token);
      const now = nowIso();

      db.prepare(
        "INSERT INTO devices (id, name, type, color, is_test, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(deviceId, name, type, color, isTest ? 1 : 0, tokenHash, now, now);

      sendJson(res, 201, {
        deviceId: deviceId,
        token: token,
        name: name,
        type: type,
        color: color,
        isTest: isTest
      });
      broadcastDataUpdate(db);
      logRequest(req, 201, "device registered " + deviceId);
      return;
    }

    if (pathname.startsWith("/api/")) {
      const auth = authenticate(db, req);
      if (!auth.ok) {
        sendJson(res, auth.status || 401, { error: auth.error || "Unauthorized" });
        logRequest(req, auth.status || 401, auth.error || "Unauthorized");
        return;
      }

      if (req.method === "GET" && pathname === "/api/config") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          logRequest(req, 403, "config");
          return;
        }
        sendJson(res, 200, { config: getEffectiveConfig(), overrides: configOverrides || {} });
        logRequest(req, 200, "config");
        return;
      }

      if (req.method === "PUT" && pathname === "/api/config") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          logRequest(req, 403, "config update");
          return;
        }
        const body = await readJson(req, res);
        if (!body || typeof body !== "object") {
          sendJson(res, 400, { error: "Invalid payload" });
          return;
        }
        const overrides = {
          host: body.host || CONFIG.host,
          port: parseInt(body.port, 10) || CONFIG.port,
          dataDir: body.dataDir || DATA_DIR,
          minSessionDuration: parseInt(body.minSessionDuration, 10) || CONFIG.minSessionDuration,
          mergeGapSeconds: parseInt(body.mergeGapSeconds, 10) || CONFIG.mergeGapSeconds
        };
        saveConfigOverrides(metaSet, overrides);
        sendJson(res, 200, { ok: true, config: getEffectiveConfig() });
        logRequest(req, 200, "config updated");
        return;
      }

      if (req.method === "GET" && pathname === "/api/devices") {
        const devices = db.prepare("SELECT id, name, type, color, is_test AS isTest, created_at AS createdAt, updated_at AS updatedAt, last_seen AS lastSeen FROM devices ORDER BY created_at ASC").all();
        sendJson(res, 200, { devices: devices });
        logRequest(req, 200, "devices list");
        return;
      }

      if (req.method === "POST" && pathname === "/api/devices/merge") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const body = await readJson(req, res);
        if (!body) return;

        const targetDeviceId = body.targetDeviceId || body.target;
        const sourceDeviceIds = body.sourceDeviceIds || body.sources;
        if (!targetDeviceId || typeof targetDeviceId !== "string" || !targetDeviceId.trim()) {
          sendJson(res, 400, { error: "targetDeviceId required" });
          return;
        }
        if (!Array.isArray(sourceDeviceIds) || !sourceDeviceIds.length) {
          sendJson(res, 400, { error: "sourceDeviceIds (non-empty array) required" });
          return;
        }

        const result = mergeDevices(db, targetDeviceId.trim(), sourceDeviceIds);
        if (result.error) {
          sendJson(res, result.status || 400, { error: result.error });
          return;
        }

        sendJson(res, 200, result);
        broadcastDataUpdate(db);
        logRequest(
          req,
          200,
          "devices merged target=" + targetDeviceId +
            " sources=" + result.sourcesRemoved +
            " moved=" + result.moved +
            " dupes=" + result.duplicatesRemoved
        );
        return;
      }

      const deviceLastMatch = pathname.match(/^\/api\/devices\/([^\/]+)\/last$/);
      if (req.method === "GET" && deviceLastMatch) {
        const deviceId = deviceLastMatch[1];
        if (!auth.isAdmin && auth.deviceId !== deviceId) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }
        const row = db.prepare("SELECT end_time AS endTime, start_time AS startTime FROM sessions WHERE device_id = ? ORDER BY end_time DESC LIMIT 1").get(deviceId);
        sendJson(res, 200, {
          deviceId: deviceId,
          lastEndTime: row ? row.endTime : null,
          lastStartTime: row ? row.startTime : null
        });
        logRequest(req, 200, "device last " + deviceId);
        return;
      }

      const deviceMatch = pathname.match(/^\/api\/devices\/([^\/]+)$/);
      const tokenMatch = pathname.match(/^\/api\/devices\/([^\/]+)\/token$/);

      if (tokenMatch && req.method === "POST") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const deviceId = tokenMatch[1];
        const token = generateToken();
        const tokenHash = hashToken(token);
        const result = db.prepare("UPDATE devices SET token_hash = ?, updated_at = ? WHERE id = ?").run(tokenHash, nowIso(), deviceId);
        if (result.changes === 0) {
          sendJson(res, 404, { error: "Device not found" });
          return;
        }
        sendJson(res, 200, { deviceId: deviceId, token: token });
        logRequest(req, 200, "device token rotated " + deviceId);
        return;
      }

      if (deviceMatch && req.method === "PATCH") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const deviceId = deviceMatch[1];
        const body = await readJson(req, res);
        if (!body) return;

        const fields = [];
        const values = [];
        if (typeof body.name === "string" && body.name.trim()) {
          fields.push("name = ?");
          values.push(body.name.trim());
        }
        if (typeof body.type === "string" && body.type.trim()) {
          fields.push("type = ?");
          values.push(body.type.trim());
        }
        if (typeof body.color === "string" && body.color.trim()) {
          fields.push("color = ?");
          values.push(body.color.trim());
        }
        if (typeof body.isTest !== "undefined" || typeof body.is_test !== "undefined" || typeof body.test !== "undefined") {
          const isTest = parseBool(body.isTest || body.is_test || body.test);
          fields.push("is_test = ?");
          values.push(isTest ? 1 : 0);
        }

        if (!fields.length) {
          sendJson(res, 400, { error: "No fields to update" });
          return;
        }

        fields.push("updated_at = ?");
        values.push(nowIso());
        values.push(deviceId);

        const sql = "UPDATE devices SET " + fields.join(", ") + " WHERE id = ?";
        const result = db.prepare(sql).run(values);
        if (result.changes === 0) {
          sendJson(res, 404, { error: "Device not found" });
          return;
        }

        sendJson(res, 200, { ok: true });
        broadcastDataUpdate(db);
        logRequest(req, 200, "device updated " + deviceId);
        return;
      }

      if (deviceMatch && req.method === "DELETE") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const deviceId = deviceMatch[1];
        const body = await readJson(req, res);
        const mode = body && body.mode ? body.mode : url.searchParams.get("mode") || "reassign";

        if (mode === "delete") {
          db.prepare("DELETE FROM sessions WHERE device_id = ?").run(deviceId);
          const resDel = db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
          if (resDel.changes === 0) {
            sendJson(res, 404, { error: "Device not found" });
            return;
          }
        } else {
          const unknownId = getUnknownDeviceId(db, metaGet, metaSet);
          db.prepare("UPDATE sessions SET device_id = ? WHERE device_id = ?").run(unknownId, deviceId);
          const resDel = db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
          if (resDel.changes === 0) {
            sendJson(res, 404, { error: "Device not found" });
            return;
          }
        }

        sendJson(res, 200, { ok: true, mode: mode });
        broadcastDataUpdate(db);
        logRequest(req, 200, "device deleted " + deviceId + " mode=" + mode);
        return;
      }

      if (req.method === "POST" && pathname === "/api/sessions/bulk") {
        const body = await readJson(req, res);
        if (!body) return;

        const deviceId = body.deviceId || auth.deviceId;
        if (!auth.isAdmin && auth.deviceId !== deviceId) {
          sendJson(res, 403, { error: "Forbidden" });
          return;
        }

        const sessions = Array.isArray(body.sessions) ? body.sessions : [];

        const tx = db.transaction((rows) => {
          const normalized = [];
          for (let i = 0; i < rows.length; i++) {
            const item = normalizeIncomingSession(rows[i]);
            if (item) normalized.push(item);
          }
          normalized.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

          let inserted = 0;
          let skipped = 0;
          let merged = 0;
          for (let i = 0; i < normalized.length; i++) {
            const result = insertSessionWithMerge(db, deviceId, normalized[i], false);
            inserted += result.inserted;
            merged += result.merged;
            skipped += result.skipped;
          }
          return { inserted: inserted, merged: merged, skipped: skipped };
        });

        const result = tx(sessions);
        sendJson(res, 200, result);
        if (result.inserted > 0 || result.merged > 0) broadcastDataUpdate(db);
        logRequest(req, 200, "bulk sessions device=" + deviceId + " inserted=" + result.inserted + " merged=" + result.merged + " skipped=" + result.skipped);
        return;
      }

      if (req.method === "POST" && pathname === "/api/sessions/queue") {
        const body = await readText(req, res);
        if (body === null) return;

        const deviceId = auth.deviceId;
        const lastRow = db.prepare(
          "SELECT end_time AS endTime FROM sessions WHERE device_id = ? ORDER BY end_time DESC LIMIT 1"
        ).get(deviceId);
        const lastMs = lastRow && lastRow.endTime ? new Date(lastRow.endTime).getTime() : 0;

        const lines = body.split(/\r?\n/);
        let inserted = 0;
        let merged = 0;
        let skipped = 0;
        let filtered = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split(",");
          if (parts.length < 2) {
            skipped++;
            continue;
          }
          const startMs = parseInt(parts[0], 10);
          const endMs = parseInt(parts[1], 10);
          if (!startMs || !endMs) {
            skipped++;
            continue;
          }
          if (lastMs && endMs <= lastMs) {
            filtered++;
            continue;
          }
          const normalized = normalizeIncomingSession({ startTime: startMs, endTime: endMs });
          if (!normalized) {
            skipped++;
            continue;
          }
          const result = insertSessionWithMerge(db, deviceId, normalized, false);
          inserted += result.inserted;
          merged += result.merged;
          skipped += result.skipped;
        }

        sendJson(res, 200, { inserted: inserted, merged: merged, skipped: skipped, filtered: filtered });
        if (inserted > 0 || merged > 0) broadcastDataUpdate(db);
        logRequest(req, 200, "queue sessions device=" + deviceId + " inserted=" + inserted + " merged=" + merged + " skipped=" + skipped + " filtered=" + filtered);
        return;
      }

      if (req.method === "POST" && pathname === "/api/sessions") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const body = await readJson(req, res);
        if (!body) return;
        const deviceId = body.deviceId || auth.deviceId;

        const normalized = normalizeIncomingSession(body);
        if (!normalized) {
          sendJson(res, 400, { error: "Invalid session payload" });
          return;
        }
        if (normalized.duration < getMinSessionDuration()) {
          sendJson(res, 400, { error: "Session too short" });
          return;
        }

        const isManual = body.isManual ? true : false;
        const result = insertSessionWithMerge(db, deviceId, normalized, isManual);
        if (result.inserted === 0 && result.merged === 0) {
          sendJson(res, 409, { error: "Duplicate session" });
          return;
        }

        sendJson(res, 201, { ok: true, merged: result.merged > 0 });
        broadcastDataUpdate(db);
        logRequest(req, 201, "session created device=" + deviceId + " merged=" + (result.merged > 0));
        return;
      }

      const sessionMatch = pathname.match(/^\/api\/sessions\/([^\/]+)$/);
      if (req.method === "POST" && pathname === "/api/sessions/merge") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const body = await readJson(req, res);
        if (!body || !Array.isArray(body.sessionIds) || body.sessionIds.length < 2) {
          sendJson(res, 400, { error: "sessionIds (2+) required" });
          return;
        }

        const ids = body.sessionIds.map((id) => String(id));
        const placeholders = ids.map(() => "?").join(",");
        const rows = db.prepare(
          "SELECT id, device_id AS deviceId, start_time AS startTime, end_time AS endTime, is_manual AS isManual FROM sessions WHERE id IN (" + placeholders + ")"
        ).all(ids);

        if (rows.length !== ids.length) {
          sendJson(res, 404, { error: "One or more sessions not found" });
          return;
        }

        const deviceId = rows[0].deviceId;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].deviceId !== deviceId) {
            sendJson(res, 400, { error: "Sessions must belong to the same device" });
            return;
          }
        }

        let minStart = rows[0].startTime;
        let maxEnd = rows[0].endTime;
        let isManual = rows[0].isManual ? 1 : 0;
        for (let i = 1; i < rows.length; i++) {
          if (new Date(rows[i].startTime) < new Date(minStart)) minStart = rows[i].startTime;
          if (new Date(rows[i].endTime) > new Date(maxEnd)) maxEnd = rows[i].endTime;
          if (rows[i].isManual) isManual = 1;
        }

        const duration = sessionDurationFromIso(minStart, maxEnd);
        const keepId = rows[0].id;
        const deleteIds = rows.slice(1).map((r) => r.id);

        db.prepare(
          "UPDATE sessions SET start_time = ?, end_time = ?, duration = ?, is_manual = ?, updated_at = ? WHERE id = ?"
        ).run(minStart, maxEnd, duration, isManual, nowIso(), keepId);

        const deletePlaceholders = deleteIds.map(() => "?").join(",");
        db.prepare("DELETE FROM sessions WHERE id IN (" + deletePlaceholders + ")").run(deleteIds);

        sendJson(res, 200, { ok: true, mergedId: keepId, removed: deleteIds.length });
        broadcastDataUpdate(db);
        logRequest(req, 200, "sessions merged keep=" + keepId + " removed=" + deleteIds.length);
        return;
      }

      if (sessionMatch && req.method === "PATCH") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const sessionId = sessionMatch[1];
        const body = await readJson(req, res);
        if (!body) return;

        const fields = [];
        const values = [];
        let startIso = null;
        let endIso = null;
        if (body.startTime || body.start) {
          startIso = toIso(body.startTime || body.start);
          if (!startIso) { sendJson(res, 400, { error: "Invalid startTime" }); return; }
          fields.push("start_time = ?");
          values.push(startIso);
        }
        if (body.endTime || body.end) {
          endIso = toIso(body.endTime || body.end);
          if (!endIso) { sendJson(res, 400, { error: "Invalid endTime" }); return; }
          fields.push("end_time = ?");
          values.push(endIso);
        }
        if (typeof body.duration !== "undefined") {
          const dur = Math.max(0, parseInt(body.duration, 10));
          if (isNaN(dur)) { sendJson(res, 400, { error: "Invalid duration" }); return; }
          fields.push("duration = ?");
          values.push(dur);
        }
        if (typeof body.isManual !== "undefined") {
          fields.push("is_manual = ?");
          values.push(body.isManual ? 1 : 0);
        }
        if (typeof body.deviceId === "string" && body.deviceId.trim()) {
          fields.push("device_id = ?");
          values.push(body.deviceId.trim());
        }

        if (!fields.length) {
          sendJson(res, 400, { error: "No fields to update" });
          return;
        }

        if ((startIso || endIso) && typeof body.duration === "undefined") {
          const row = db.prepare("SELECT start_time AS startTime, end_time AS endTime FROM sessions WHERE id = ?").get(sessionId);
          if (!row) { sendJson(res, 404, { error: "Session not found" }); return; }
          const newStart = startIso || row.startTime;
          const newEnd = endIso || row.endTime;
          const derivedDuration = sessionDurationFromIso(newStart, newEnd);
          fields.push("duration = ?");
          values.push(derivedDuration);
        }

        fields.push("updated_at = ?");
        values.push(nowIso());
        values.push(sessionId);

        const sql = "UPDATE sessions SET " + fields.join(", ") + " WHERE id = ?";
        const result = db.prepare(sql).run(values);
        if (result.changes === 0) {
          sendJson(res, 404, { error: "Session not found" });
          return;
        }

        sendJson(res, 200, { ok: true });
        broadcastDataUpdate(db);
        logRequest(req, 200, "session updated " + sessionId);
        return;
      }

      if (sessionMatch && req.method === "DELETE") {
        if (!auth.isAdmin) {
          sendJson(res, 403, { error: "Admin token required" });
          return;
        }
        const sessionId = sessionMatch[1];
        const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
        if (result.changes === 0) {
          sendJson(res, 404, { error: "Session not found" });
          return;
        }
        sendJson(res, 200, { ok: true });
        broadcastDataUpdate(db);
        logRequest(req, 200, "session deleted " + sessionId);
        return;
      }

      if (req.method === "GET" && pathname === "/api/sessions") {
        const deviceId = url.searchParams.get("deviceId");
        const limit = parseInt(url.searchParams.get("limit") || "0", 10);
        const offset = parseInt(url.searchParams.get("offset") || "0", 10);

        let sql = "SELECT id, device_id AS deviceId, start_time AS startTime, end_time AS endTime, duration, is_manual AS isManual, created_at AS createdAt, updated_at AS updatedAt FROM sessions";
        const values = [];
        if (deviceId) {
          sql += " WHERE device_id = ?";
          values.push(deviceId);
        }
        sql += " ORDER BY start_time ASC";
        if (limit > 0) sql += " LIMIT " + limit;
        if (offset > 0) sql += " OFFSET " + offset;

        const rows = db.prepare(sql).all(values);
        sendJson(res, 200, { sessions: rows });
        logRequest(req, 200, "sessions list");
        return;
      }

      sendJson(res, 404, { error: "Not found" });
      logRequest(req, 404, "api not found");
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
    logRequest(req, 404, "not found");
  });

  server.listen(CONFIG.port, CONFIG.host, () => {
    log("Server listening on http://" + CONFIG.host + ":" + CONFIG.port);
    log("Data dir: " + DATA_DIR);
    log("Database: " + DB_FILE);
    logConfigStatus();
  });

  server.on("error", (err) => {
    log("Server error: " + err.message);
  });
}

function normalizeIncomingSession(payload) {
  if (!payload) return null;
  const start = toIso(payload.startTime || payload.start);
  const end = toIso(payload.endTime || payload.end);
  if (!start || !end) return null;
  if (new Date(end).getTime() < new Date(start).getTime()) return null;

  let duration = payload.duration;
  if (typeof duration === "string" && duration.trim() !== "") duration = parseInt(duration, 10);
  if (typeof duration === "number" && !isNaN(duration)) {
    duration = Math.max(0, Math.floor(duration));
  } else {
    duration = Math.max(0, Math.floor((new Date(end) - new Date(start)) / 1000));
  }

  return {
    startTime: start,
    endTime: end,
    duration: duration
  };
}

function sessionDurationFromIso(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function findOverlappingSessions(db, deviceId, startIso, endIso) {
  return db.prepare(
    "SELECT id, start_time AS startTime, end_time AS endTime, is_manual AS isManual FROM sessions WHERE device_id = ? AND start_time < ? AND end_time > ? ORDER BY start_time ASC"
  ).all(deviceId, endIso, startIso);
}

function absorbOverlappingSessions(db, deviceId, session, isManual) {
  const overlaps = findOverlappingSessions(db, deviceId, session.startTime, session.endTime);
  if (!overlaps.length) return null;

  const startMs = new Date(session.startTime).getTime();
  const endMs = new Date(session.endTime).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return { inserted: 0, merged: 0, skipped: 1 };

  let unionStart = startMs;
  let unionEnd = endMs;
  let mergedManual = isManual ? 1 : 0;
  const ids = [];

  for (let i = 0; i < overlaps.length; i++) {
    const row = overlaps[i];
    const rowStart = new Date(row.startTime).getTime();
    const rowEnd = new Date(row.endTime).getTime();
    if (!isNaN(rowStart)) unionStart = Math.min(unionStart, rowStart);
    if (!isNaN(rowEnd)) unionEnd = Math.max(unionEnd, rowEnd);
    if (row.isManual) mergedManual = 1;
    ids.push(row.id);
  }

  const containedByExisting = overlaps.every(function (row) {
    const rowStart = new Date(row.startTime).getTime();
    const rowEnd = new Date(row.endTime).getTime();
    return !isNaN(rowStart) && !isNaN(rowEnd) && startMs >= rowStart && endMs <= rowEnd;
  });
  if (containedByExisting) return { inserted: 0, merged: 0, skipped: 1 };

  const newStartIso = new Date(unionStart).toISOString();
  const newEndIso = new Date(unionEnd).toISOString();
  const newDuration = sessionDurationFromIso(newStartIso, newEndIso);

  db.prepare(
    "UPDATE sessions SET start_time = ?, end_time = ?, duration = ?, is_manual = ?, updated_at = ? WHERE id = ?"
  ).run(newStartIso, newEndIso, newDuration, mergedManual, nowIso(), ids[0]);

  if (ids.length > 1) {
    const deleteStmt = db.prepare("DELETE FROM sessions WHERE id = ?");
    const tx = db.transaction(function (removeIds) {
      for (let j = 1; j < removeIds.length; j++) deleteStmt.run(removeIds[j]);
    });
    tx(ids);
  }

  return { inserted: 0, merged: 1, skipped: 0 };
}

function mergeWithPreviousSession(db, deviceId, session, isManual) {
  const mergeGapSeconds = getMergeGapSeconds();
  if (!mergeGapSeconds || mergeGapSeconds <= 0) return null;
  const last = db.prepare(
    "SELECT id, start_time AS startTime, end_time AS endTime, is_manual AS isManual FROM sessions WHERE device_id = ? ORDER BY end_time DESC LIMIT 1"
  ).get(deviceId);
  if (!last) return null;

  const lastEnd = new Date(last.endTime).getTime();
  const lastStart = new Date(last.startTime).getTime();
  const startMs = new Date(session.startTime).getTime();
  const endMs = new Date(session.endTime).getTime();
  if (isNaN(lastEnd) || isNaN(lastStart) || isNaN(startMs) || isNaN(endMs)) return null;

  if (startMs < lastEnd) {
    if (endMs <= lastEnd) return last.id;
    const newDuration = Math.max(0, Math.floor((endMs - lastStart) / 1000));
    const mergedIsManual = (last.isManual ? 1 : 0) || (isManual ? 1 : 0);
    db.prepare(
      "UPDATE sessions SET end_time = ?, duration = ?, is_manual = ?, updated_at = ? WHERE id = ?"
    ).run(new Date(endMs).toISOString(), newDuration, mergedIsManual, nowIso(), last.id);
    return last.id;
  }

  const gapSeconds = Math.floor((startMs - lastEnd) / 1000);
  if (gapSeconds > mergeGapSeconds) return null;

  const newStart = Math.min(lastStart, startMs);
  const newEnd = Math.max(lastEnd, endMs);
  const newDuration = Math.max(0, Math.floor((newEnd - newStart) / 1000));
  const mergedIsManual = (last.isManual ? 1 : 0) || (isManual ? 1 : 0);

  db.prepare(
    "UPDATE sessions SET start_time = ?, end_time = ?, duration = ?, is_manual = ?, updated_at = ? WHERE id = ?"
  ).run(new Date(newStart).toISOString(), new Date(newEnd).toISOString(), newDuration, mergedIsManual, nowIso(), last.id);

  return last.id;
}

function insertSessionWithMerge(db, deviceId, session, isManual) {
  if (!session || !deviceId) return { inserted: 0, merged: 0, skipped: 1 };
  if (session.duration < getMinSessionDuration()) return { inserted: 0, merged: 0, skipped: 1 };

  const overlapResult = absorbOverlappingSessions(db, deviceId, session, isManual);
  if (overlapResult) return overlapResult;

  const mergedId = mergeWithPreviousSession(db, deviceId, session, isManual);
  if (mergedId) return { inserted: 0, merged: 1, skipped: 0 };

  const insert = db.prepare(
    "INSERT OR IGNORE INTO sessions (device_id, start_time, end_time, duration, is_manual, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const res = insert.run(deviceId, session.startTime, session.endTime, session.duration, isManual ? 1 : 0, nowIso(), nowIso());
  if (res.changes > 0) return { inserted: 1, merged: 0, skipped: 0 };
  return { inserted: 0, merged: 0, skipped: 1 };
}

const db = initDb();
log(CONFIG.gameName + " Server started");
startServer(db);
