/**
 * NTE Playtime Tracker — Dashboard Client
 * Fetches session data from the local tracker server and renders the UI.
 * Real-time updates via Server-Sent Events (SSE).
 *
 * All data displayed originates from the local tracker's own data.json file.
 * No external or user-controlled input is rendered.
 */

// ── State ─────────────────────────────────────────────────────────────────────

var baseTotal, liveEpoch, liveStartISO, grouped, allSessions, timerID = null;
var calYear, calMonth, selectedDateKey = null;
var activeTab = "calendar", allPage = 0, DAYS_PER_PAGE = 5;
var allDevices = [], deviceIndex = {}, adminToken = "";
var filteredSessions = [], filteredTotalSeconds = 0, initialOffsetSeconds = 0;
var selectedDeviceId = "all";
var selectedSessionIds = {};
var editingSessionId = null;

var DEVICE_TYPE_OPTIONS = [
  { value: "pc", label: "PC" },
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "console", label: "Console" },
  { value: "server", label: "Server" },
  { value: "unknown", label: "Unknown" }
];

var PAGE_SIZE_OPTIONS = [3, 5, 7, 10, 15, 20];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  if (seconds < 300) return h + "h " + m + "m " + s + "s";
  return h + "h " + m + "m";
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function createEl(tag, className) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function createTd(text) {
  var td = document.createElement("td");
  td.textContent = text;
  return td;
}

function fillDeviceTypeSelect(selectEl, value) {
  if (!selectEl) return;
  selectEl.textContent = "";
  for (var i = 0; i < DEVICE_TYPE_OPTIONS.length; i++) {
    var opt = document.createElement("option");
    opt.value = DEVICE_TYPE_OPTIONS[i].value;
    opt.textContent = DEVICE_TYPE_OPTIONS[i].label;
    selectEl.appendChild(opt);
  }
  if (value) selectEl.value = value;
}

function toInputValue(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  var pad = function (n) { return n < 10 ? "0" + n : n; };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function fromInputValue(value) {
  if (!value) return null;
  var d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function updateFilterLabel() {
  var label = document.getElementById("device-filter-label");
  if (!label) return;
  if (!selectedDeviceId || selectedDeviceId === "all") {
    label.textContent = "All devices";
    return;
  }
  if (selectedDeviceId === "local") {
    label.textContent = "Local";
    return;
  }
  var device = deviceIndex[selectedDeviceId];
  label.textContent = device ? device.name : "Filtered";
}

function renderDeviceFilter() {
  var select = document.getElementById("device-filter");
  if (!select) return;
  select.textContent = "";

  var allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "All devices";
  select.appendChild(allOpt);

  if (allDevices && allDevices.length) {
    for (var i = 0; i < allDevices.length; i++) {
      var opt = document.createElement("option");
      opt.value = allDevices[i].id;
      opt.textContent = allDevices[i].name + (parseBool(allDevices[i].isTest) ? " (Test)" : "");
      select.appendChild(opt);
    }
  } else if (allSessions && allSessions.length) {
    var localOpt = document.createElement("option");
    localOpt.value = "local";
    localOpt.textContent = "Local";
    select.appendChild(localOpt);
  }

  if (!selectedDeviceId) selectedDeviceId = "all";
  var hasOption = false;
  for (var i = 0; i < select.options.length; i++) {
    if (select.options[i].value === selectedDeviceId) {
      hasOption = true;
      break;
    }
  }
  if (!hasOption) selectedDeviceId = "all";
  select.value = selectedDeviceId;
  updateFilterLabel();

  select.onchange = function () {
    selectedDeviceId = select.value;
    applyFilter();
    renderCalendar();
    renderCalDayView();
    computeStats();
    updateTimes();
    if (activeTab === "all") renderAllSessions();
    updateFilterLabel();
  };
}

function applyFilter() {
  var sessions = allSessions || [];
  if (selectedDeviceId && selectedDeviceId !== "all") {
    sessions = sessions.filter(function (s) {
      if (selectedDeviceId === "local") return !s.deviceId;
      return s.deviceId === selectedDeviceId;
    });
  }
  selectedSessionIds = {};
  filteredSessions = sessions;
  filteredTotalSeconds = sessions.reduce(function (sum, s) { return sum + s.duration; }, 0);
  var offset = (selectedDeviceId === "all") ? initialOffsetSeconds : 0;
  grouped = buildGrouped(filteredSessions, offset);
  baseTotal = filteredTotalSeconds + offset;
  document.getElementById("session-count").textContent = filteredSessions.length;
  document.getElementById("days-count").textContent = grouped.length;

  if (selectedDateKey) {
    var played = getPlayedDates();
    if (!(selectedDateKey in played)) selectedDateKey = null;
  }

  updateCombineButtonState();
}

function populateDeviceSelect(selectEl, includeAll) {
  if (!selectEl) return;
  selectEl.textContent = "";
  if (includeAll) {
    var allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All devices";
    selectEl.appendChild(allOpt);
  }
  for (var i = 0; i < allDevices.length; i++) {
    var opt = document.createElement("option");
    opt.value = allDevices[i].id;
    opt.textContent = allDevices[i].name;
    selectEl.appendChild(opt);
  }
}

function updateCombineStatus(message, isError) {
  var el = document.getElementById("combine-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#ff8a80" : "#6fcf97";
}

function updatePageSelect(totalPages) {
  var input = document.getElementById("page-select");
  if (!input) return;
  if (!totalPages || totalPages <= 0) {
    input.value = "";
    input.disabled = true;
    return;
  }
  input.disabled = false;
  input.min = 1;
  input.max = String(totalPages);
  if (allPage >= totalPages) allPage = totalPages - 1;
  if (allPage < 0) allPage = 0;
  input.value = String(allPage + 1);
}

function updatePageSizeSelect() {
  var select = document.getElementById("page-size");
  if (!select) return;
  select.textContent = "";
  for (var i = 0; i < PAGE_SIZE_OPTIONS.length; i++) {
    var option = document.createElement("option");
    option.value = String(PAGE_SIZE_OPTIONS[i]);
    option.textContent = String(PAGE_SIZE_OPTIONS[i]);
    select.appendChild(option);
  }
  select.value = String(DAYS_PER_PAGE);
}

function sessionDescription(session) {
  if (!session) return "";
  var start = session.startTime ? new Date(session.startTime) : null;
  var end = session.endTime ? new Date(session.endTime) : null;
  var dateStr = start && !isNaN(start.getTime())
    ? start.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "Unknown date";
  var startStr = start && !isNaN(start.getTime()) ? fmtTime(session.startTime) : "??:??";
  var endStr = end && !isNaN(end.getTime()) ? fmtTime(session.endTime) : "??:??";
  var device = resolveDevice(session);
  var deviceName = device && device.name ? device.name : "Unknown";
  return dateStr + " " + startStr + " - " + endStr + " (" + deviceName + ")";
}

function loadAdminToken() {
  try {
    adminToken = localStorage.getItem("nteAdminToken") || "";
  } catch (err) {
    adminToken = "";
  }
}

function saveAdminToken(token) {
  adminToken = token;
  try {
    if (token) localStorage.setItem("nteAdminToken", token);
    else localStorage.removeItem("nteAdminToken");
  } catch (err) {
    return;
  }
}

function buildDeviceIndex(devices) {
  var map = {};
  for (var i = 0; i < devices.length; i++) {
    map[devices[i].id] = devices[i];
  }
  return map;
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    var trimmed = value.trim().toLowerCase();
    return trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "y";
  }
  return false;
}

function apiRequest(path, method, body, requireAdmin) {
  var headers = { "Content-Type": "application/json" };
  if (requireAdmin) {
    if (!adminToken) return Promise.reject(new Error("Admin token required"));
    headers["x-admin-token"] = adminToken;
  }
  return fetch(path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  }).then(function (res) {
    return res.text().then(function (text) {
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
      return { ok: res.ok, status: res.status, json: json, text: text };
    });
  });
}

function setAdminStatus(message, isError) {
  var el = document.getElementById("admin-token-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#ff8a80" : "#6fcf97";
}

function formatLastSeen(iso) {
  if (!iso) return "Never";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "Never";
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function resolveDevice(session) {
  if (!session) return null;
  if (session.deviceId && deviceIndex[session.deviceId]) return deviceIndex[session.deviceId];
  if (session.deviceName || session.deviceColor) {
    return {
      name: session.deviceName || "Unknown",
      color: session.deviceColor || "#666666",
      type: session.deviceType || "unknown",
      isTest: parseBool(session.deviceIsTest)
    };
  }
  return { name: "Local", color: "#666666", type: "local", isTest: false };
}

function isDarkColor(color) {
  if (!color || color[0] !== "#" || (color.length !== 7 && color.length !== 4)) return false;
  var hex = color.length === 4
    ? color[1] + color[1] + color[2] + color[2] + color[3] + color[3]
    : color.slice(1);
  var r = parseInt(hex.slice(0, 2), 16);
  var g = parseInt(hex.slice(2, 4), 16);
  var b = parseInt(hex.slice(4, 6), 16);
  var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

function createDeviceTag(device) {
  var tag = createEl("span", "device-tag");
  var color = device && device.color ? device.color : "#3a3a3a";
  tag.style.setProperty("--device-color", color);
  tag.style.setProperty("--device-text", isDarkColor(color) ? "#f5f5f5" : "#111");
  var dot = createEl("span", "device-dot");
  tag.appendChild(dot);
  tag.appendChild(document.createTextNode(device && device.name ? device.name : "Unknown"));
  return tag;
}

// ── Data Grouping ─────────────────────────────────────────────────────────────

/** Groups flat session array into per-day objects with running totals. */
function buildGrouped(sessions, initialOffset) {
  var g = [], m = {};
  for (var i = 0; i < sessions.length; i++) {
    var s = sessions[i];
    var dt = new Date(s.startTime);
    var key = dt.getFullYear() + "-" + (dt.getMonth() + 1) + "-" + dt.getDate();
    var display = dt.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    });
    if (!(key in m)) {
      m[key] = g.length;
      g.push({ date: display, key: key, sessions: [], dayTotal: 0, runningTotal: 0 });
    }
    g[m[key]].sessions.push(s);
    g[m[key]].dayTotal += s.duration;
  }
  var rt = initialOffset;
  for (var i = 0; i < g.length; i++) {
    rt += g[i].dayTotal;
    g[i].runningTotal = rt;
  }
  g.reverse(); // newest first
  return g;
}

/** Returns { "YYYY-M-D": indexInGrouped } for dates with sessions. */
function getPlayedDates() {
  var map = {};
  if (!grouped) return map;
  for (var i = 0; i < grouped.length; i++) {
    map[grouped[i].key] = i;
  }
  return map;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function computeStats() {
  var el = document.getElementById("extra-stats");
  el.textContent = "";
  if (!filteredSessions || !filteredSessions.length || !grouped || !grouped.length) return;

  var totalDur = filteredSessions.reduce(function(a, s) { return a + s.duration; }, 0);
  var avgSess = Math.floor(totalDur / filteredSessions.length);
  var avgDay = Math.floor(totalDur / grouped.length);

  // Current streak — grouped is newest-first
  var streak = 0;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayKey = today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate();

  // Check if today is already in grouped or if a live session covers today
  var todayInGrouped = grouped.length > 0 && grouped[0].key === todayKey;
  var liveCoverToday = liveEpoch && !todayInGrouped;

  var streakDates = [];
  if (liveCoverToday) streakDates.push(todayKey);
  for (var i = 0; i < grouped.length; i++) streakDates.push(grouped[i].key);

  for (var i = 0; i < streakDates.length; i++) {
    var parts = streakDates[i].split("-");
    var gd = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    gd.setHours(0, 0, 0, 0);
    var expected = new Date(today);
    expected.setDate(expected.getDate() - i);
    if (gd.getTime() === expected.getTime()) streak++;
    else break;
  }

  // Best streak — walk oldest-first
  var bestStreak = 0, cur = 1;
  for (var i = grouped.length - 1; i > 0; i--) {
    var d1 = new Date(grouped[i].date);
    var d2 = new Date(grouped[i - 1].date);
    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);
    if ((d2 - d1) / 86400000 === 1) cur++;
    else { if (cur > bestStreak) bestStreak = cur; cur = 1; }
  }
  if (cur > bestStreak) bestStreak = cur;

  // Longest session
  var longest = 0;
  for (var i = 0; i < filteredSessions.length; i++) {
    if (filteredSessions[i].duration > longest) longest = filteredSessions[i].duration;
  }

  // This week vs last week
  var now = new Date();
  var startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  var startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
  var thisWeek = 0, lastWeek = 0;
  for (var i = 0; i < filteredSessions.length; i++) {
    var st = new Date(filteredSessions[i].startTime).getTime();
    if (st >= startOfWeek.getTime()) thisWeek += filteredSessions[i].duration;
    else if (st >= startOfLastWeek.getTime()) lastWeek += filteredSessions[i].duration;
  }
  var trend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);
  var trendStr = (trend > 0 ? "\u2191" + trend + "%" : trend < 0 ? "\u2193" + Math.abs(trend) + "%" : "\u2194");

  var stats = [
    { v: fmt(avgSess), l: "Avg Session" },
    { v: fmt(longest), l: "Longest" },
    { v: streak + (streak > 0 ? "\uD83D\uDD25" : ""), l: "Streak" },
    { v: bestStreak + "", l: "Best Streak" },
    { v: fmt(thisWeek), l: "This Week" },
    { v: trendStr, l: "vs Last Week" }
  ];

  for (var i = 0; i < stats.length; i++) {
    var div = createEl("div", "stat");
    var val = createEl("div", "stat-value"); val.textContent = stats[i].v;
    var lab = createEl("div", "stat-label"); lab.textContent = stats[i].l;
    div.appendChild(val);
    div.appendChild(lab);
    el.appendChild(div);
  }

  // Time-of-day heatmap
  renderTimeHeatmap();
}

// ── Time-of-Day Heatmap ──────────────────────────────────────────────────────

function renderTimeHeatmap() {
  var container = document.getElementById("time-heatmap");
  if (!container) return;
  container.textContent = "";
  if (!filteredSessions || !filteredSessions.length) return;

  // Accumulate minutes per hour bucket
  var hours = new Array(24);
  for (var i = 0; i < 24; i++) hours[i] = 0;

  for (var i = 0; i < filteredSessions.length; i++) {
    var s = filteredSessions[i];
    var start = new Date(s.startTime);
    var end = new Date(s.endTime);
    // Walk each minute of the session and bucket it
    var cursor = new Date(start);
    var remaining = s.duration;
    while (remaining > 0) {
      var h = cursor.getHours();
      var secsLeftInHour = 3600 - cursor.getMinutes() * 60 - cursor.getSeconds();
      var chunk = Math.min(remaining, secsLeftInHour);
      hours[h] += chunk;
      remaining -= chunk;
      cursor = new Date(cursor.getTime() + chunk * 1000);
    }
  }

  var max = 1;
  for (var i = 0; i < 24; i++) if (hours[i] > max) max = hours[i];

  var title = createEl("div", "heatmap-title");
  title.textContent = "Play Time by Hour";
  container.appendChild(title);

  var grid = createEl("div", "heatmap-grid");
  for (var i = 0; i < 24; i++) {
    var col = createEl("div", "heatmap-col");
    var bar = createEl("div", "heatmap-bar");
    var pct = hours[i] > 0 ? Math.max(4, Math.round((hours[i] / max) * 100)) : 0;
    bar.style.height = pct + "%";
    var intensity = hours[i] / max;
    if (intensity > 0.66) bar.className += " h3";
    else if (intensity > 0.33) bar.className += " h2";
    else if (intensity > 0) bar.className += " h1";
    col.appendChild(bar);

    var lbl = createEl("div", "heatmap-label");
    lbl.textContent = (i < 10 ? "0" : "") + i;
    col.appendChild(lbl);

    grid.appendChild(col);
  }
  container.appendChild(grid);
}

// ── Calendar ──────────────────────────────────────────────────────────────────

var MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December"
];

function renderCalendar() {
  var container = document.getElementById("calendar-widget");
  container.textContent = "";

  var played = getPlayedDates();
  var now = new Date();
  var todayKey = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();

  // Navigation
  var nav = createEl("div", "cal-nav");
  var prevBtn = document.createElement("button");
  prevBtn.textContent = "\u2190";
  prevBtn.onclick = function() {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  };
  var label = createEl("span", "cal-month-label");
  label.textContent = MONTH_NAMES[calMonth] + " " + calYear;
  var nextBtn = document.createElement("button");
  nextBtn.textContent = "\u2192";
  nextBtn.onclick = function() {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  };
  nav.appendChild(prevBtn);
  nav.appendChild(label);
  nav.appendChild(nextBtn);
  container.appendChild(nav);

  // Grid
  var grid = createEl("div", "cal-grid");
  ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(function(d) {
    var dow = createEl("div", "cal-dow");
    dow.textContent = d;
    grid.appendChild(dow);
  });

  var firstDay = new Date(calYear, calMonth, 1).getDay();
  var offset = (firstDay === 0) ? 6 : firstDay - 1;
  var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  for (var i = 0; i < offset; i++) {
    grid.appendChild(createEl("div", "cal-cell"));
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var cell = createEl("div", "cal-cell");
    var key = calYear + "-" + (calMonth + 1) + "-" + d;

    if (key === todayKey) cell.className += " today";
    if (key === selectedDateKey) cell.className += " selected";

    var num = document.createElement("span");
    num.textContent = d;
    cell.appendChild(num);

    if (key in played) {
      cell.className += " has-sessions";
      var dt = grouped[played[key]].dayTotal;
      var tier = dt < 3600 ? "t1" : dt < 10800 ? "t2" : dt < 21600 ? "t3" : "t4";
      var dot = createEl("span", "cal-dot " + tier);
      cell.appendChild(dot);
      cell.onclick = (function(k) {
        return function() {
          selectedDateKey = k;
          renderCalDayView();
          renderCalendar();
        };
      })(key);
    }

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}

/** Renders the single selected day's sessions under the calendar. */
function renderCalDayView() {
  var container = document.getElementById("cal-day-view");
  container.textContent = "";
  if (!selectedDateKey || !grouped) return;
  var played = getPlayedDates();
  if (!(selectedDateKey in played)) return;
  container.appendChild(buildDayCard(grouped[played[selectedDateKey]], false, false));
}

// ── Day Card Builder ──────────────────────────────────────────────────────────

function buildDayCard(day, collapsible, showActions) {
  var dayDiv = createEl("div", "day");

  // Header
  var hdr = createEl("div", "day-header" + (collapsible ? " clickable" : ""));
  var dateSpan = createEl("span", "day-date");
  if (collapsible) {
    var chev = createEl("span", "chevron open");
    chev.textContent = "\u25B6";
    dateSpan.appendChild(chev);
  }
  dateSpan.appendChild(document.createTextNode(day.date));

  var statsSpan = createEl("span", "day-stats");
  var sc = day.sessions.length;
  statsSpan.textContent =
    (sc > 1 ? sc + " sessions" : "1 session") +
    " \u00b7 " + fmt(day.dayTotal) +
    " \u00b7 Total: " + fmt(day.runningTotal);

  hdr.appendChild(dateSpan);
  hdr.appendChild(statsSpan);
  dayDiv.appendChild(hdr);

  // Body
  var body = createEl("div", "day-body open");
  var wrap = document.createElement("div");
  if (day.sessions.length > 5) wrap.className = "day-scroll";

  var tbl = document.createElement("table");
  var thead = document.createElement("thead");
  var thr = document.createElement("tr");
  var headers = showActions
    ? ["Select", "Start", "End", "Duration", "Device", "Actions"]
    : ["Start", "End", "Duration", "Device"];
  headers.forEach(function(t) {
    var col = document.createElement("th");
    col.textContent = t;
    thr.appendChild(col);
  });
  thead.appendChild(thr);
  tbl.appendChild(thead);

  var tbody = document.createElement("tbody");
  for (var j = 0; j < day.sessions.length; j++) {
    var sess = day.sessions[j];
    var tr = document.createElement("tr");
    if (showActions) {
      var selectTd = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = !sess.id;
      checkbox.checked = !!selectedSessionIds[sess.id];
      checkbox.onchange = function (id, cb) {
        return function () {
          if (!id) return;
          if (cb.checked) selectedSessionIds[id] = true;
          else delete selectedSessionIds[id];
          updateCombineButtonState();
        };
      }(sess.id, checkbox);
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
    }

    tr.appendChild(createTd(fmtTime(sess.startTime)));
    tr.appendChild(createTd(fmtTime(sess.endTime)));
    tr.appendChild(createTd(fmt(sess.duration)));
    var deviceTd = createEl("td", "device-cell");
    var deviceInfo = resolveDevice(sess);
    deviceTd.appendChild(createDeviceTag(deviceInfo));
    if (deviceInfo && deviceInfo.isTest) {
      var testBadge = createEl("span", "device-test-badge");
      testBadge.textContent = "TEST";
      deviceTd.appendChild(testBadge);
    }
    if (sess.isManual) {
      var manualBadge = createEl("span", "manual-tag");
      manualBadge.textContent = "MANUAL";
      deviceTd.appendChild(manualBadge);
    }
    tr.appendChild(deviceTd);
    if (showActions) {
      var actionsTd = document.createElement("td");
      var editBtn = createEl("button", "session-tool-btn");
      editBtn.textContent = "Edit";
      editBtn.disabled = !adminToken || !sess.id;
      editBtn.onclick = function (session) {
        return function () { openEditModal(session); };
      }(sess);

      var deleteBtn = createEl("button", "session-tool-btn danger");
      deleteBtn.textContent = "Delete";
      deleteBtn.disabled = !adminToken || !sess.id;
      deleteBtn.onclick = function (session) {
        return function () { deleteSession(session); };
      }(sess);

      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  body.appendChild(wrap);
  dayDiv.appendChild(body);

  if (collapsible) {
    hdr.onclick = function() {
      var b = hdr.nextElementSibling;
      var c = hdr.querySelector(".chevron");
      b.classList.toggle("open");
      c.classList.toggle("open");
    };
  }

  return dayDiv;
}

// ── All Sessions Tab ──────────────────────────────────────────────────────────

function renderAllSessions() {
  var container = document.getElementById("all-content");
  container.textContent = "";

  if (!grouped || !grouped.length) {
    container.textContent = "No sessions yet.";
    updateCombineButtonState();
    updatePageSelect(0);
    return;
  }

  var totalPages = Math.ceil(grouped.length / DAYS_PER_PAGE);
  if (allPage >= totalPages) allPage = totalPages - 1;
  if (allPage < 0) allPage = 0;

  updatePageSelect(totalPages);

  var start = allPage * DAYS_PER_PAGE;
  var end = Math.min(start + DAYS_PER_PAGE, grouped.length);

  container.appendChild(buildPageNav(totalPages));
  for (var i = start; i < end; i++) {
    container.appendChild(buildDayCard(grouped[i], true, true));
  }
  container.appendChild(buildPageNav(totalPages));
  updateCombineButtonState();
}

function buildPageNav(totalPages) {
  var nav = createEl("div", "page-nav");
  if (totalPages <= 1) return nav;

  var prev = createEl("button", "page-btn");
  prev.textContent = "\u2190";
  prev.disabled = allPage === 0;
  prev.onclick = function() { allPage--; renderAllSessions(); };
  nav.appendChild(prev);

  for (var p = 0; p < totalPages; p++) {
    if (totalPages > 7 && p > 1 && p < totalPages - 2 && Math.abs(p - allPage) > 1) {
      if (p === 2 || p === totalPages - 3) {
        var dots = createEl("span", "page-ellipsis");
        dots.textContent = "\u2026";
        nav.appendChild(dots);
      }
      continue;
    }
    var btn = createEl("button", "page-btn" + (p === allPage ? " active" : ""));
    btn.textContent = p + 1;
    btn.onclick = (function(pg) {
      return function() { allPage = pg; renderAllSessions(); };
    })(p);
    nav.appendChild(btn);
  }

  var next = createEl("button", "page-btn");
  next.textContent = "\u2192";
  next.disabled = allPage >= totalPages - 1;
  next.onclick = function() { allPage++; renderAllSessions(); };
  nav.appendChild(next);

  return nav;
}

// ── Device Management ───────────────────────────────────────────────────────

function buildDeviceRow(device) {
  var isTest = parseBool(device.isTest || device.is_test);

  var row = createEl("div", "device-row");
  var main = createEl("div", "device-row-main");

  var swatch = createEl("div", "device-color-swatch");
  swatch.style.background = device.color || "#666666";
  main.appendChild(swatch);

  var info = createEl("div", "device-info");
  var name = createEl("div", "device-name");
  name.textContent = device.name || "Unnamed";
  if (isTest) {
    var testBadge = createEl("span", "device-test-badge");
    testBadge.textContent = "TEST";
    name.appendChild(testBadge);
  }
  var meta = createEl("div", "device-meta");
  var lastSeen = formatLastSeen(device.lastSeen || device.last_seen);
  meta.textContent = "Type: " + (device.type || "unknown") + " \u00b7 Last seen: " + lastSeen + " \u00b7 ID: " + device.id;
  info.appendChild(name);
  info.appendChild(meta);
  main.appendChild(info);

  var actions = createEl("div", "device-actions");
  var editBtn = createEl("button", "device-action-btn");
  editBtn.textContent = "Edit";
  editBtn.disabled = !adminToken;
  actions.appendChild(editBtn);

  var rotateBtn = createEl("button", "device-action-btn");
  rotateBtn.textContent = "Rotate Token";
  rotateBtn.disabled = !adminToken;
  actions.appendChild(rotateBtn);
  main.appendChild(actions);

  row.appendChild(main);

  var edit = createEl("div", "device-edit");
  var grid = createEl("div", "device-edit-grid");

  var nameWrap = createEl("div", "device-edit-field");
  var nameLbl = document.createElement("label");
  nameLbl.textContent = "Name";
  var nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = device.name || "";
  nameWrap.appendChild(nameLbl);
  nameWrap.appendChild(nameInput);

  var typeWrap = createEl("div", "device-edit-field");
  var typeLbl = document.createElement("label");
  typeLbl.textContent = "Type";
  var typeInput = document.createElement("select");
  fillDeviceTypeSelect(typeInput, device.type || "unknown");
  typeWrap.appendChild(typeLbl);
  typeWrap.appendChild(typeInput);

  var colorWrap = createEl("div", "device-edit-field");
  var colorLbl = document.createElement("label");
  colorLbl.textContent = "Color";
  var colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = device.color || "#666666";
  colorWrap.appendChild(colorLbl);
  colorWrap.appendChild(colorInput);

  var testWrap = createEl("div", "device-edit-field");
  var testLbl = document.createElement("label");
  testLbl.textContent = "Test Device";
  var testInput = document.createElement("input");
  testInput.type = "checkbox";
  testInput.checked = isTest;
  testWrap.appendChild(testLbl);
  testWrap.appendChild(testInput);

  grid.appendChild(nameWrap);
  grid.appendChild(typeWrap);
  grid.appendChild(colorWrap);
  grid.appendChild(testWrap);
  edit.appendChild(grid);

  var editActions = createEl("div", "device-edit-actions");
  var saveBtn = createEl("button", "device-action-btn");
  saveBtn.textContent = "Save";
  var cancelBtn = createEl("button", "device-action-btn");
  cancelBtn.textContent = "Cancel";
  var deleteReassign = createEl("button", "device-action-btn danger");
  deleteReassign.textContent = "Delete (Reassign)";
  var deleteAll = createEl("button", "device-action-btn danger");
  deleteAll.textContent = "Delete + Sessions";

  editActions.appendChild(saveBtn);
  editActions.appendChild(cancelBtn);
  editActions.appendChild(deleteReassign);
  editActions.appendChild(deleteAll);
  edit.appendChild(editActions);
  row.appendChild(edit);

  var tokenNotice = createEl("div", "device-token");
  tokenNotice.style.display = "none";
  row.appendChild(tokenNotice);

  editBtn.onclick = function () {
    if (!adminToken) {
      setAdminStatus("Admin token required", true);
      return;
    }
    edit.classList.toggle("open");
  };

  cancelBtn.onclick = function () {
    edit.classList.remove("open");
  };

  saveBtn.onclick = function () {
    var payload = {
      name: nameInput.value.trim(),
      type: typeInput.value.trim(),
      color: colorInput.value.trim(),
      isTest: testInput.checked
    };

    apiRequest("/api/devices/" + device.id, "PATCH", payload, true)
      .then(function (res) {
        if (!res.ok) throw new Error((res.json && res.json.error) || "Update failed");
        setAdminStatus("Device updated", false);
        edit.classList.remove("open");
      })
      .catch(function (err) {
        setAdminStatus(err.message, true);
      });
  };

  deleteReassign.onclick = function () {
    if (!confirm("WARNING: This will delete the device and reassign its sessions to Unknown. Continue?")) return;
    apiRequest("/api/devices/" + device.id + "?mode=reassign", "DELETE", null, true)
      .then(function (res) {
        if (!res.ok) throw new Error((res.json && res.json.error) || "Delete failed");
        setAdminStatus("Device deleted (reassigned)", false);
      })
      .catch(function (err) {
        setAdminStatus(err.message, true);
      });
  };

  deleteAll.onclick = function () {
    if (!confirm("WARNING: This will delete the device and ALL its sessions. This cannot be undone. Continue?")) return;
    apiRequest("/api/devices/" + device.id + "?mode=delete", "DELETE", null, true)
      .then(function (res) {
        if (!res.ok) throw new Error((res.json && res.json.error) || "Delete failed");
        setAdminStatus("Device and sessions deleted", false);
      })
      .catch(function (err) {
        setAdminStatus(err.message, true);
      });
  };

  rotateBtn.onclick = function () {
    if (!adminToken) {
      setAdminStatus("Admin token required", true);
      return;
    }
    if (!confirm("Rotate token for this device? Old token will stop working.")) return;
    apiRequest("/api/devices/" + device.id + "/token", "POST", {}, true)
      .then(function (res) {
        if (!res.ok) throw new Error((res.json && res.json.error) || "Token rotation failed");
        tokenNotice.textContent = "New token: " + res.json.token;
        tokenNotice.style.display = "block";
        setAdminStatus("Token rotated", false);
      })
      .catch(function (err) {
        setAdminStatus(err.message, true);
      });
  };

  return row;
}

function renderDevices() {
  var list = document.getElementById("device-list");
  if (!list) return;
  list.textContent = "";

  if (!allDevices || !allDevices.length) {
    list.textContent = "No devices yet.";
    return;
  }

  for (var i = 0; i < allDevices.length; i++) {
    list.appendChild(buildDeviceRow(allDevices[i]));
  }
}

// ── Sessions: Combine + Edit ───────────────────────────────────────────────

function updateCombineButtonState() {
  var btn = document.getElementById("combine-btn");
  var count = Object.keys(selectedSessionIds).length;
  if (btn) btn.disabled = !adminToken || count !== 2;
  if (count === 0) updateCombineStatus("", false);
  else updateCombineStatus(count + " selected", false);
}

function clearSelection() {
  selectedSessionIds = {};
  updateCombineButtonState();
  if (activeTab === "all") renderAllSessions();
}

function combineSelectedSessions() {
  var ids = Object.keys(selectedSessionIds);
  if (ids.length !== 2) {
    updateCombineStatus("Select exactly 2 sessions", true);
    return;
  }
  if (!adminToken) {
    updateCombineStatus("Admin token required", true);
    return;
  }
  apiRequest("/api/sessions/merge", "POST", { sessionIds: ids }, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Merge failed");
      updateCombineStatus("Sessions merged", false);
      clearSelection();
    })
    .catch(function (err) {
      updateCombineStatus(err.message, true);
    });
}

function deleteSession(session) {
  if (!session || !session.id) return;
  if (!adminToken) {
    updateCombineStatus("Admin token required", true);
    return;
  }
  var message = "WARNING: Delete session " + sessionDescription(session) + "?";
  if (!confirm(message)) return;
  apiRequest("/api/sessions/" + session.id, "DELETE", null, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Delete failed");
      updateCombineStatus("Session deleted", false);
    })
    .catch(function (err) {
      updateCombineStatus(err.message, true);
    });
}

function openEditModal(session) {
  if (!session || !session.id) return;
  if (!adminToken) {
    updateCombineStatus("Admin token required", true);
    return;
  }
  editingSessionId = session.id;

  var modal = document.getElementById("session-modal");
  var startInput = document.getElementById("edit-start");
  var endInput = document.getElementById("edit-end");
  var deviceSelect = document.getElementById("edit-device");
  var manualInput = document.getElementById("edit-manual");
  var status = document.getElementById("edit-status");

  if (status) status.textContent = "";
  if (startInput) startInput.value = toInputValue(session.startTime);
  if (endInput) endInput.value = toInputValue(session.endTime);
  populateDeviceSelect(deviceSelect, false);
  if (deviceSelect) deviceSelect.value = session.deviceId || (allDevices[0] ? allDevices[0].id : "");
  if (manualInput) manualInput.checked = !!session.isManual;
  if (modal) modal.classList.add("open");
}

function closeEditModal() {
  var modal = document.getElementById("session-modal");
  if (modal) modal.classList.remove("open");
  editingSessionId = null;
}

function saveEditSession() {
  if (!editingSessionId) return;
  if (!adminToken) {
    updateCombineStatus("Admin token required", true);
    return;
  }
  var startInput = document.getElementById("edit-start");
  var endInput = document.getElementById("edit-end");
  var deviceSelect = document.getElementById("edit-device");
  var manualInput = document.getElementById("edit-manual");
  var status = document.getElementById("edit-status");

  var startIso = fromInputValue(startInput ? startInput.value : "");
  var endIso = fromInputValue(endInput ? endInput.value : "");
  if (!startIso || !endIso) {
    if (status) status.textContent = "Invalid start/end";
    return;
  }

  var payload = {
    startTime: startIso,
    endTime: endIso,
    deviceId: deviceSelect ? deviceSelect.value : null,
    isManual: manualInput ? manualInput.checked : false
  };

  apiRequest("/api/sessions/" + editingSessionId, "PATCH", payload, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Update failed");
      if (status) status.textContent = "Saved";
      closeEditModal();
    })
    .catch(function (err) {
      if (status) status.textContent = err.message;
    });
}

function deleteEditSession() {
  if (!editingSessionId) return;
  var session = null;
  for (var i = 0; i < allSessions.length; i++) {
    if (String(allSessions[i].id) === String(editingSessionId)) {
      session = allSessions[i];
      break;
    }
  }
  var message = "WARNING: Delete session " + (session ? sessionDescription(session) : String(editingSessionId)) + "?";
  if (!confirm(message)) return;
  apiRequest("/api/sessions/" + editingSessionId, "DELETE", null, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Delete failed");
      closeEditModal();
    })
    .catch(function (err) {
      var status = document.getElementById("edit-status");
      if (status) status.textContent = err.message;
    });
}

// ── Tab Switching ─────────────────────────────────────────────────────────────

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab-btn").forEach(function(b) {
    b.className = b.getAttribute("data-tab") === name ? "tab-btn active" : "tab-btn";
  });
  document.getElementById("tab-calendar").className =
    name === "calendar" ? "tab-content active" : "tab-content";
  document.getElementById("tab-all").className =
    name === "all" ? "tab-content active" : "tab-content";
  document.getElementById("tab-devices").className =
    name === "devices" ? "tab-content active" : "tab-content";
  document.getElementById("tab-config").className =
    name === "config" ? "tab-content active" : "tab-content";
  if (name === "all") renderAllSessions();
  if (name === "devices") renderDevices();
  if (name === "config") loadServerConfig();
}

// ── Live Timer & Banner ───────────────────────────────────────────────────────

function updateTimes() {
  var liveSec = liveEpoch ? Math.floor((Date.now() - liveEpoch) / 1000) : 0;
  var total = baseTotal + liveSec;
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);

  // Build total time display using DOM (only static numeric values from local tracker data)
  var ttEl = document.getElementById("total-time");
  ttEl.textContent = "";
  ttEl.appendChild(document.createTextNode(h));
  var hUnit = createEl("span", "unit"); hUnit.textContent = "h"; ttEl.appendChild(hUnit);
  ttEl.appendChild(document.createTextNode(" " + m));
  var mUnit = createEl("span", "unit"); mUnit.textContent = "m"; ttEl.appendChild(mUnit);

  var el = document.getElementById("live-session-time");
  if (el && liveEpoch) {
    el.textContent = "Started " + fmtTime(liveStartISO) + " \u00b7 Session: " + fmt(liveSec);
  }
}

// ── Server Config (Admin) ──────────────────────────────────────────────────

function setConfigStatus(message, isError) {
  var el = document.getElementById("config-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#ff8a80" : "#6fcf97";
}

function fillConfigFields(config) {
  if (!config) return;
  var host = document.getElementById("config-host");
  var port = document.getElementById("config-port");
  var dataDir = document.getElementById("config-data-dir");
  var minSession = document.getElementById("config-min-session");
  var mergeGap = document.getElementById("config-merge-gap");
  if (host) host.value = config.host || "";
  if (port) port.value = config.port || "";
  if (dataDir) dataDir.value = config.dataDir || "";
  if (minSession) minSession.value = config.minSessionDuration || "";
  if (mergeGap) mergeGap.value = config.mergeGapSeconds || "";
}

function loadServerConfig() {
  if (!adminToken) {
    setConfigStatus("Admin token required", true);
    return;
  }
  apiRequest("/api/config", "GET", null, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Load failed");
      fillConfigFields(res.json.config);
      setConfigStatus("Loaded", false);
    })
    .catch(function (err) {
      setConfigStatus(err.message, true);
    });
}

function saveServerConfig() {
  if (!adminToken) {
    setConfigStatus("Admin token required", true);
    return;
  }
  var payload = {
    host: document.getElementById("config-host").value.trim(),
    port: document.getElementById("config-port").value.trim(),
    dataDir: document.getElementById("config-data-dir").value.trim(),
    minSessionDuration: document.getElementById("config-min-session").value.trim(),
    mergeGapSeconds: document.getElementById("config-merge-gap").value.trim()
  };
  apiRequest("/api/config", "PUT", payload, true)
    .then(function (res) {
      if (!res.ok) throw new Error((res.json && res.json.error) || "Save failed");
      fillConfigFields(res.json.config);
      setConfigStatus("Saved (restart may be required)", false);
    })
    .catch(function (err) {
      setConfigStatus(err.message, true);
    });
}

function showLiveBanner(startTime) {
  liveStartISO = new Date(startTime).toISOString();
  liveEpoch = new Date(startTime).getTime();

  var lb = document.getElementById("live-banner");
  lb.textContent = "";

  var d = createEl("div", "live-banner");
  var dot = createEl("div", "live-dot"); d.appendChild(dot);
  var lbl = createEl("span", "live-label"); lbl.textContent = "NOW PLAYING"; d.appendChild(lbl);
  var info = createEl("span", "live-info"); info.id = "live-session-time";
  d.appendChild(info);
  lb.appendChild(d);

  if (!timerID) timerID = setInterval(updateTimes, 1000);
}

function hideLiveBanner() {
  liveEpoch = 0;
  liveStartISO = null;
  document.getElementById("live-banner").textContent = "";
  if (timerID) { clearInterval(timerID); timerID = null; }
}

// ── Main Data Apply ───────────────────────────────────────────────────────────

function normalizeData(DATA) {
  if (!DATA || typeof DATA !== "object") DATA = {};
  if (!Array.isArray(DATA.sessions)) DATA.sessions = [];
  if (!Array.isArray(DATA.devices)) DATA.devices = [];
  if (typeof DATA.totalSeconds !== "number") DATA.totalSeconds = 0;
  if (typeof DATA.initialOffset !== "number") DATA.initialOffset = 0;
  if (!("liveSession" in DATA)) DATA.liveSession = null;
  if (!DATA.lastUpdated) DATA.lastUpdated = new Date().toISOString();
  return DATA;
}

function applyData(DATA) {
  DATA = normalizeData(DATA);
  allSessions = DATA.sessions;
  allDevices = DATA.devices || [];
  deviceIndex = buildDeviceIndex(allDevices);
  initialOffsetSeconds = DATA.initialOffset || 0;
  populateDeviceSelect(document.getElementById("manual-device"), false);
  populateDeviceSelect(document.getElementById("edit-device"), false);
  var manualSelect = document.getElementById("manual-device");
  if (manualSelect && manualSelect.options.length > 0 && !manualSelect.value) {
    manualSelect.value = manualSelect.options[0].value;
  }
  renderDeviceFilter();
  applyFilter();
  document.getElementById("last-updated").textContent =
    "Last updated: " + new Date(DATA.lastUpdated).toLocaleString("en-US", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false
    });

  if (DATA.liveSession) showLiveBanner(DATA.liveSession.startTime);
  else hideLiveBanner();

  if (!selectedDateKey) {
    var n = new Date();
    selectedDateKey = n.getFullYear() + "-" + (n.getMonth() + 1) + "-" + n.getDate();
  }

  updateTimes();
  computeStats();
  renderCalendar();
  renderCalDayView();
  if (activeTab === "all") renderAllSessions();
  if (activeTab === "devices") renderDevices();
}

// ── Init ──────────────────────────────────────────────────────────────────────

fetch("/data")
  .then(function(r) { return r.json(); })
  .then(function(DATA) {
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    applyData(normalizeData(DATA));

    loadAdminToken();
    var adminInput = document.getElementById("admin-token");
    var adminSave = document.getElementById("admin-token-save");
    var adminClear = document.getElementById("admin-token-clear");
    if (adminInput) adminInput.value = adminToken;
    if (adminSave) {
      adminSave.onclick = function () {
        var value = adminInput ? adminInput.value.trim() : "";
        saveAdminToken(value);
        setAdminStatus(value ? "Token saved" : "Token cleared", false);
        renderDevices();
        updateCombineButtonState();
        if (activeTab === "all") renderAllSessions();
        if (value) loadServerConfig();
      };
    }
    if (adminClear) {
      adminClear.onclick = function () {
        if (adminInput) adminInput.value = "";
        saveAdminToken("");
        setAdminStatus("Token cleared", false);
        renderDevices();
        updateCombineButtonState();
        if (activeTab === "all") renderAllSessions();
        setConfigStatus("", false);
      };
    }

    if (activeTab === "all") renderAllSessions();
    if (activeTab === "devices") renderDevices();

    if (adminToken) loadServerConfig();

    var createType = document.getElementById("device-create-type");
    fillDeviceTypeSelect(createType, "pc");
    var createBtn = document.getElementById("device-create-btn");
    if (createBtn) {
      createBtn.onclick = function () {
        if (!adminToken) {
          setAdminStatus("Admin token required", true);
          return;
        }
        var name = document.getElementById("device-create-name");
        var color = document.getElementById("device-create-color");
        var testFlag = document.getElementById("device-create-test");
        var typeSelect = document.getElementById("device-create-type");
        var status = document.getElementById("device-create-status");

        var payload = {
          name: name && name.value.trim() ? name.value.trim() : "New Device",
          type: typeSelect ? typeSelect.value : "unknown",
          color: color ? color.value : "#4db8ff",
          isTest: testFlag ? testFlag.checked : false
        };

        apiRequest("/api/devices/register", "POST", payload, true)
          .then(function (res) {
            if (!res.ok) throw new Error((res.json && res.json.error) || "Create failed");
            if (status) status.textContent = "Created. Token: " + res.json.token;
          })
          .catch(function (err) {
            if (status) status.textContent = err.message;
          });
      };
    }

    var manualSave = document.getElementById("manual-save");
    if (manualSave) {
      manualSave.onclick = function () {
        if (!adminToken) {
          updateCombineStatus("Admin token required", true);
          return;
        }
        var startInput = document.getElementById("manual-start");
        var endInput = document.getElementById("manual-end");
        var deviceSelect = document.getElementById("manual-device");
        var manualFlag = document.getElementById("manual-flag");
        var status = document.getElementById("manual-status");

        var startIso = fromInputValue(startInput ? startInput.value : "");
        var endIso = fromInputValue(endInput ? endInput.value : "");
        if (!startIso || !endIso) {
          if (status) status.textContent = "Invalid start/end";
          return;
        }
        if (!deviceSelect || !deviceSelect.value) {
          if (status) status.textContent = "Select a device";
          return;
        }

        var payload = {
          startTime: startIso,
          endTime: endIso,
          deviceId: deviceSelect.value,
          isManual: manualFlag ? manualFlag.checked : true
        };

        apiRequest("/api/sessions", "POST", payload, true)
          .then(function (res) {
            if (!res.ok) throw new Error((res.json && res.json.error) || "Create failed");
            if (status) status.textContent = res.json && res.json.merged ? "Merged into previous" : "Session added";
            if (startInput) startInput.value = "";
            if (endInput) endInput.value = "";
          })
          .catch(function (err) {
            if (status) status.textContent = err.message;
          });
      };
    }

    var combineBtn = document.getElementById("combine-btn");
    if (combineBtn) combineBtn.onclick = combineSelectedSessions;
    var clearBtn = document.getElementById("clear-selection");
    if (clearBtn) clearBtn.onclick = clearSelection;

    updatePageSizeSelect();
    var pageSelect = document.getElementById("page-select");
    if (pageSelect) {
      var commitPage = function () {
        var max = parseInt(pageSelect.max || "1", 10) || 1;
        var value = parseInt(pageSelect.value || "1", 10) || 1;
        if (value < 1) value = 1;
        if (value > max) value = max;
        allPage = value - 1;
        pageSelect.value = String(value);
        renderAllSessions();
      };
      pageSelect.onchange = commitPage;
      pageSelect.onblur = commitPage;
    }
    var pageSizeSelect = document.getElementById("page-size");
    if (pageSizeSelect) {
      pageSizeSelect.onchange = function () {
        var value = parseInt(pageSizeSelect.value, 10);
        if (!isNaN(value) && value > 0) {
          DAYS_PER_PAGE = value;
          allPage = 0;
          renderAllSessions();
        }
      };
    }

    var configLoad = document.getElementById("config-load");
    var configSave = document.getElementById("config-save");
    if (configLoad) configLoad.onclick = loadServerConfig;
    if (configSave) configSave.onclick = saveServerConfig;

    var editCancel = document.getElementById("edit-cancel");
    if (editCancel) editCancel.onclick = closeEditModal;
    var editSave = document.getElementById("edit-save");
    if (editSave) editSave.onclick = saveEditSession;
    var editDelete = document.getElementById("edit-delete");
    if (editDelete) editDelete.onclick = deleteEditSession;
    var modal = document.getElementById("session-modal");
    if (modal) {
      modal.onclick = function (event) {
        if (event.target === modal) closeEditModal();
      };
    }

    document.querySelectorAll(".tab-btn").forEach(function(b) {
      b.onclick = function() { switchTab(b.getAttribute("data-tab")); };
    });

    var evtSource = new EventSource("/events");
    document.getElementById("status").textContent = "";

    evtSource.addEventListener("session-start", function(e) {
      var d = JSON.parse(e.data);
      showLiveBanner(d.startTime);
      updateTimes();
    });

    evtSource.addEventListener("session-end", function(e) {
      applyData(normalizeData(JSON.parse(e.data)));
    });

    evtSource.addEventListener("data", function(e) {
      applyData(normalizeData(JSON.parse(e.data)));
    });

    evtSource.addEventListener("init", function(e) {
      applyData(normalizeData(JSON.parse(e.data)));
    });

    evtSource.addEventListener("shutdown", function() {
      var s = document.getElementById("status");
      s.textContent = "Tracker stopped";
      s.className = "status-bar offline";
    });

    evtSource.onerror = function() {
      var s = document.getElementById("status");
      s.textContent = "Reconnecting...";
      s.className = "status-bar offline";
    };

    evtSource.onopen = function() {
      document.getElementById("status").textContent = "";
      document.getElementById("status").className = "status-bar";
    };
  });
