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
  if (!allSessions || !allSessions.length || !grouped || !grouped.length) return;

  var totalDur = allSessions.reduce(function(a, s) { return a + s.duration; }, 0);
  var avgSess = Math.floor(totalDur / allSessions.length);
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
  for (var i = 0; i < allSessions.length; i++) {
    if (allSessions[i].duration > longest) longest = allSessions[i].duration;
  }

  // This week vs last week
  var now = new Date();
  var startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  var startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
  var thisWeek = 0, lastWeek = 0;
  for (var i = 0; i < allSessions.length; i++) {
    var st = new Date(allSessions[i].startTime).getTime();
    if (st >= startOfWeek.getTime()) thisWeek += allSessions[i].duration;
    else if (st >= startOfLastWeek.getTime()) lastWeek += allSessions[i].duration;
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
  if (!allSessions || !allSessions.length) return;

  // Accumulate minutes per hour bucket
  var hours = new Array(24);
  for (var i = 0; i < 24; i++) hours[i] = 0;

  for (var i = 0; i < allSessions.length; i++) {
    var s = allSessions[i];
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
  container.appendChild(buildDayCard(grouped[played[selectedDateKey]], false));
}

// ── Day Card Builder ──────────────────────────────────────────────────────────

function buildDayCard(day, collapsible) {
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
  ["Start", "End", "Duration"].forEach(function(t) {
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
    tr.appendChild(createTd(fmtTime(sess.startTime)));
    tr.appendChild(createTd(fmtTime(sess.endTime)));
    tr.appendChild(createTd(fmt(sess.duration)));
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
    return;
  }

  var totalPages = Math.ceil(grouped.length / DAYS_PER_PAGE);
  if (allPage >= totalPages) allPage = totalPages - 1;
  if (allPage < 0) allPage = 0;

  var start = allPage * DAYS_PER_PAGE;
  var end = Math.min(start + DAYS_PER_PAGE, grouped.length);

  container.appendChild(buildPageNav(totalPages));
  for (var i = start; i < end; i++) {
    container.appendChild(buildDayCard(grouped[i], true));
  }
  container.appendChild(buildPageNav(totalPages));
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
  if (name === "all") renderAllSessions();
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

function applyData(DATA) {
  baseTotal = DATA.totalSeconds;
  allSessions = DATA.sessions;
  grouped = buildGrouped(DATA.sessions, DATA.initialOffset);

  document.getElementById("session-count").textContent = DATA.sessions.length;
  document.getElementById("days-count").textContent = grouped.length;
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
}

// ── Init ──────────────────────────────────────────────────────────────────────

fetch("/data")
  .then(function(r) { return r.json(); })
  .then(function(DATA) {
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    applyData(DATA);

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
      var d = JSON.parse(e.data);
      baseTotal = d.totalSeconds;
      hideLiveBanner();
      allSessions = d.sessions;
      grouped = buildGrouped(d.sessions, d.initialOffset);
      document.getElementById("session-count").textContent = d.sessions.length;
      document.getElementById("days-count").textContent = grouped.length;
      document.getElementById("last-updated").textContent =
        "Last updated: " + new Date().toLocaleString("en-US", {
          year: "numeric", month: "long", day: "numeric",
          hour: "2-digit", minute: "2-digit", hour12: false
        });
      updateTimes();
      computeStats();
      renderCalendar();
      renderCalDayView();
      if (activeTab === "all") renderAllSessions();
    });

    evtSource.addEventListener("init", function(e) {
      applyData(JSON.parse(e.data));
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
