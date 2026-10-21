'use strict';
/*
 * Backup calendar – pure logic without server or page (shared by both, tested in tests/lib.test.js).
 * Planned runs of Hostwerk's tasks (every schedule kind: every, daily, cron, after another task, at start) plus what
 * really happened (task runs, external backup, cloud backup, game server backups, restore probes) – per day.
 */
const DAY = 86400000;
const HOUR = 3600000;
const pad = (n) => String(n).padStart(2, '0');

/** Date as YYYY-MM-DD in local time (not UTC – otherwise late runs slip to the next day). */
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/*
 * Areas – what a backup protects. Each has its own colour and shape in the page (legend), and the status head shows
 * one light per area: db (databases), mc (Minecraft), project (project snapshots), offsite (external and cloud
 * backup), probe (restore probes), ext (sources of extensions, e.g. game servers), other (tasks of any other kind).
 */
const AREAS = ['db', 'mc', 'project', 'offsite', 'probe', 'ext', 'other'];
const ACTION_AREA = { 'db-backup': 'db', 'mc-backup': 'mc', snapshot: 'project', 'restore-probe': 'probe', 'machine-backup': 'offsite', game: 'ext' };
const KIND_AREA = { db: 'db', mc: 'mc', snapshot: 'project', offsite: 'offsite', cloud: 'offsite', probe: 'probe', game: 'ext', ext: 'ext', task: 'other' };
/** Area of a task (by its action). */
const taskArea = (t) => ACTION_AREA[(t && t.action && t.action.type) || ''] || 'other';
/** Area of a calendar entry or event (own area wins, then the kind). */
const areaOf = (x) => (x && AREAS.includes(x.area) ? x.area : KIND_AREA[(x && x.kind) || ''] || 'other');

/** Task actions that are backups by their nature (independent of the name). */
const BACKUP_ACTIONS = ['db-backup', 'mc-backup', 'snapshot', 'machine-backup', 'restore-probe'];

/**
 * Backup? The user's mark wins ("counts as a backup" on/off), then the kind of action, then the name.
 * marks = { taskId: true | false }
 */
function isBackup(t, marks) {
  if (marks && t && typeof marks[t.id] === 'boolean') return marks[t.id];
  const type = (t && t.action && t.action.type) || '';
  if (BACKUP_ACTIONS.includes(type)) return true;
  if (type === 'game' && /backup/i.test(JSON.stringify(t.action || {}))) return true;
  return /backup|sicherung|snapshot|dump|schnappschuss/i.test(`${type} ${(t && t.name) || ''} ${(t && t.actionLabel) || ''}`);
}

/* ---------------- Cron (same rules as Hostwerk's scheduler) ---------------- */
function cronField(expr, min, max) {
  const set = new Set();
  for (const part of String(expr).split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let [a, b] = range === '*' ? [min, max] : range.split('-').map(Number);
    if (b === undefined) b = stepS ? max : a;
    if (![a, b, step].every(Number.isFinite) || step < 1 || a < min || b > max) return null;
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
}
function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const c = { min: cronField(f[0], 0, 59), hour: cronField(f[1], 0, 23), dom: cronField(f[2], 1, 31), mon: cronField(f[3], 1, 12), dow: cronField(f[4].replace(/7/g, '0'), 0, 6), domAny: f[2] === '*', dowAny: f[4] === '*' };
  return Object.values(c).some((x) => x === null) ? null : c;
}
/** All cron times in [from, to) – day by day, only the hours/minutes the expression allows (fast). */
function cronRuns(expr, from, to, max = 40) {
  const c = parseCron(expr);
  const out = [];
  if (!c) return out;
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  const hours = [...c.hour].sort((a, b) => a - b);
  const mins = [...c.min].sort((a, b) => a - b);
  for (; d.getTime() < to && out.length < max; d.setDate(d.getDate() + 1)) {
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(d.getDay()) : c.dowAny ? c.dom.has(d.getDate()) : c.dom.has(d.getDate()) || c.dow.has(d.getDay());
    if (!c.mon.has(d.getMonth() + 1) || !dayOk) continue;
    for (const h of hours) for (const m of mins) {
      const x = new Date(d); x.setHours(h, m, 0, 0);
      if (x.getTime() >= from && x.getTime() < to && out.length < max) out.push(x.getTime());
    }
  }
  return out;
}

/**
 * Runs of a schedule in [from, to). every (minutes), daily (time, weekdays), cron (expression), after (after another
 * task – byId gives its runs), startup (only when Hostwerk starts: no fixed time).
 */
function runsBetween(t, from, to, max = 40, byId = null, depth = 0) {
  const s = t.schedule || {};
  const out = [];
  if (!t.enabled) return out;
  if (s.mode === 'daily') {
    const [h, m] = String(s.time || '04:00').split(':').map(Number);
    const days = Array.isArray(s.days) && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
    const d = new Date(from); d.setHours(0, 0, 0, 0);
    for (let i = 0; d.getTime() + i * DAY < to + DAY && out.length < max; i++) {
      const c = new Date(d); c.setDate(d.getDate() + i); c.setHours(h, m, 0, 0);
      if (c.getTime() >= from && c.getTime() < to && days.includes(c.getDay())) out.push(c.getTime());
    }
    return out;
  }
  if (s.mode === 'every') {
    const step = Math.max(1, Number(s.minutes) || 60) * 60000;
    let x = t.nextRun && t.nextRun >= from ? t.nextRun : from;
    while (x < to && out.length < max) { out.push(x); x += step; }
    return out;
  }
  if (s.mode === 'cron') return cronRuns(s.expr, from, to, max);
  if (s.mode === 'after' && byId && depth < 5) {
    // Right after the other task (estimated one minute later)
    const parent = byId.get(s.task);
    if (parent) return runsBetween(parent, from, to, max, byId, depth + 1).map((x) => x + 60000).filter((x) => x < to);
    return out;
  }
  if (s.mode === 'startup') return out;
  if (t.nextRun && t.nextRun >= from && t.nextRun < to) out.push(t.nextRun);
  return out;
}

/**
 * Runs of a schedule that is not a task: Hostwerk's nightly database/Minecraft backups, the external backup and the
 * restore probe have their own clock. plan = { enabled, everyHours, hour, last, slackHours }:
 *   with an hour (and a rhythm of a day or more) like the core's dueNightly: the first slot at that hour that lies at
 *   least (rhythm − slack) after the last run; overdue by more than rhythm + 6 h (PC was off) → right away.
 *   without an hour: last run + rhythm (overdue → right away).
 */
function planRuns(p, from, to, max = 40) {
  const out = [];
  if (!p || p.enabled === false) return out;
  const every = Math.max(1, Number(p.everyHours) || 24) * HOUR;
  const ref = Number(p.last) || 0;
  const hasHour = p.hour != null && p.hour !== '' && Number.isFinite(Number(p.hour)) && every >= DAY;
  if (hasHour) {
    const slack = (p.slackHours != null ? Number(p.slackHours) : 4) * HOUR;
    const slot = (earliest) => { const d = new Date(earliest); d.setMinutes(0, 0, 0); d.setHours(Number(p.hour)); if (d.getTime() < earliest) d.setDate(d.getDate() + 1); return d.getTime(); };
    let x = !ref ? slot(from) : from - ref > every + 6 * HOUR ? from : slot(Math.max(from, ref + every - slack));
    while (x < to && out.length < max) { out.push(x); x = slot(x + every - slack); }
    return out;
  }
  let x = ref ? Math.max(from, ref + every) : from;
  while (x < to && out.length < max) { out.push(x); x += every; }
  return out;
}

/** "When does it run?" for tasks without fixed times (shown below the calendar). */
function unscheduled(tasks, marks, { onlyBackups = true } = {}) {
  return (tasks || []).filter((t) => t.enabled && (!onlyBackups || isBackup(t, marks)) && t.schedule && t.schedule.mode === 'startup').map((t) => ({ id: t.id, name: t.name, mode: 'startup' }));
}

/**
 * Days with planned runs and what happened: [{ key, date, items: [{ t, id, name, backup, kind, area, status }] }]
 * status: planned | ok | error · kind: task | db | mc | snapshot | offsite | cloud | game | ext | probe · area: see AREAS
 * plans: schedules that are not tasks (see planRuns) – { id, kind, area, name, group, groupLabel, …plan }; planned
 * runs of the same group at the same time become one entry ("Restore probe: A, B").
 */
function calendar(tasks, from, days = 14, { onlyBackups = false, marks = null, events = [], plans = [], now = from } = {}) {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + days);
  const to = end.getTime();
  const out = [];
  for (let i = 0; i < days; i++) { const d = new Date(start); d.setDate(start.getDate() + i); out.push({ key: dayKey(d.getTime()), date: d.getTime(), items: [] }); }
  const byKey = new Map(out.map((d) => [d.key, d]));
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  for (const t of tasks || []) {
    const backup = isBackup(t, marks);
    if (onlyBackups && !backup) continue;
    for (const ts of runsBetween(t, Math.max(now, start.getTime()), to, 40, byId)) {
      const d = byKey.get(dayKey(ts));
      if (d) d.items.push({ t: ts, id: t.id, name: t.name, backup, kind: 'task', area: taskArea(t), status: 'planned', every: (t.schedule || {}).mode === 'every' });
    }
  }
  // Hostwerk's own schedules (nightly backups, external backup, restore probe) – always backups
  const groups = new Map();
  for (const p of plans || []) {
    for (const ts of planRuns(p, Math.max(now, start.getTime()), to)) {
      const d = byKey.get(dayKey(ts));
      if (!d) continue;
      const g = p.group ? `${p.group}@${ts}` : null;
      if (g && groups.has(g)) { const x = groups.get(g); x.names.push(p.name); x.name = `${p.groupLabel || p.group}: ${x.names.join(', ')}`; continue; }
      const x = { t: ts, id: p.id || null, name: p.group ? `${p.groupLabel || p.group}: ${p.name}` : p.name, names: [p.name], backup: true, kind: p.kind || 'task', area: areaOf(p), status: 'planned', plan: true };
      if (g) groups.set(g, x);
      d.items.push(x);
    }
  }
  // What really happened (past): task runs, external/cloud backup, game server backups, restore probes
  for (const e of events || []) {
    if (!e || !e.t || e.t < start.getTime() || e.t >= to) continue;
    if (onlyBackups && e.backup === false) continue;
    const d = byKey.get(dayKey(e.t));
    if (d) d.items.push({ t: e.t, id: e.id || null, name: e.name, backup: e.backup !== false, kind: e.kind || 'task', area: areaOf(e), status: e.ok === false ? 'error' : 'ok', error: e.error || null, run: e.run || null });
  }
  for (const d of out) d.items.sort((a, b) => a.t - b.t);
  return out;
}

/** Month grid (weeks from Monday) for the month of `ts`: [[{ key, date, inMonth }, …7], …] */
function monthGrid(ts) {
  const first = new Date(ts); first.setDate(1); first.setHours(0, 0, 0, 0);
  const startDow = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(first); start.setDate(1 - startDow);
  const weeks = [];
  const d = new Date(start);
  do {
    const w = [];
    for (let i = 0; i < 7; i++) { w.push({ key: dayKey(d.getTime()), date: d.getTime(), inMonth: d.getMonth() === first.getMonth() }); d.setDate(d.getDate() + 1); }
    weeks.push(w);
  } while (d.getMonth() === first.getMonth());
  return weeks;
}

/** Task runs from the history as events: [{ t, id, name, ok, error, backup, kind }] */
function taskEvents(tasks, histories, marks) {
  const out = [];
  for (const t of tasks || []) {
    const backup = isBackup(t, marks);
    for (const h of (histories && histories[t.id]) || []) out.push({ t: h.at, id: t.id, name: t.name, ok: h.status !== 'error', error: h.status === 'error' ? String(h.output || '').trim().split('\n').pop().slice(0, 200) : null, backup, kind: (t.action && t.action.type) === 'restore-probe' ? 'probe' : 'task', area: taskArea(t) });
  }
  return out;
}

/** Last results: failed first, then newest. */
function lastResults(tasks, { onlyBackups = false, limit = 8, marks = null } = {}) {
  return (tasks || []).filter((t) => t.lastRun && (!onlyBackups || isBackup(t, marks)))
    .map((t) => ({ id: t.id, name: t.name, t: t.lastRun, ok: t.lastStatus !== 'error', rate: t.successRate }))
    .sort((a, b) => (a.ok === b.ok ? b.t - a.t : a.ok ? 1 : -1)).slice(0, limit);
}

/** Next backup (for the tile). */
function nextBackup(tasks, now = Date.now(), marks = null) {
  let best = null;
  for (const t of tasks || []) { if (!isBackup(t, marks) || !t.enabled || !t.nextRun || t.nextRun < now) continue; if (!best || t.nextRun < best.t) best = { t: t.nextRun, name: t.name, id: t.id }; }
  return best;
}

/* ---------------- Page helpers (agenda, status head, failures, setup) ---------------- */

/**
 * Agenda instead of one tile per day: days with entries (and today) as they are, runs of empty days in between become
 * one gap ("Thu – Sun: nothing planned"). → [{ type: 'day', key, date, items } | { type: 'gap', key, from, to, count }]
 */
function agenda(days, today) {
  const out = [];
  let gap = null;
  for (const d of days || []) {
    if (d.items.length || d.key === today) {
      if (gap) { out.push(gap); gap = null; }
      out.push({ type: 'day', key: d.key, date: d.date, items: d.items });
    } else if (gap) { gap.to = d.date; gap.count++; } else gap = { type: 'gap', key: d.key, from: d.date, to: d.date, count: 1 };
  }
  if (gap) out.push(gap);
  return out;
}

/** Runs every few minutes of the same task on one day become one entry with a count (the agenda stays short). */
function collapseEvery(items) {
  const out = [];
  const seen = new Map();
  for (const x of items || []) {
    if (!x.every || x.status !== 'planned') { out.push(x); continue; }
    const k = x.id || x.name;
    if (seen.has(k)) { const y = seen.get(k); y.count++; y.until = x.t; continue; }
    const y = { ...x, count: 1, until: x.t };
    seen.set(k, y);
    out.push(y);
  }
  return out;
}

/**
 * Status head: how many runs are planned, the next backup and the last successful one. Restore probes check backups
 * but are none themselves – they count as planned, not as "next backup" or "last backup" (nextAny includes them).
 * areas (see areaStatus input) add backups that are no task run (nightly backups, manual backups, extension sources).
 */
function summary(days, { now = Date.now(), events = [], areas = [] } = {}) {
  let planned = 0; let next = null; let nextAny = null; let lastOk = null;
  for (const d of days || []) {
    for (const x of d.items) {
      if (x.status !== 'planned' || x.t < now) continue;
      planned++;
      if (!nextAny || x.t < nextAny.t) nextAny = x;
      if (areaOf(x) !== 'probe' && (!next || x.t < next.t)) next = x;
    }
  }
  for (const e of events || []) {
    if (!e || e.ok === false || e.backup === false || areaOf(e) === 'probe' || !e.t || e.t > now) continue;
    if (!lastOk || e.t > lastOk.t) lastOk = { t: e.t, name: e.name, area: areaOf(e) };
  }
  for (const a of areas || []) {
    if (!a || !a.last || a.area === 'probe' || a.last > now) continue;
    if (!lastOk || a.last > lastOk.t) lastOk = { t: a.last, name: a.name, area: a.area };
  }
  return { planned, next, nextAny, lastOk };
}

/**
 * Failures that still matter: errors of the last `days` days without a later success of the same thing (same kind
 * and task/name). Newest first.
 */
function failures(events, { now = Date.now(), days = 7 } = {}) {
  const since = now - days * DAY;
  const key = (e) => `${e.kind || 'task'}:${e.id || e.name}`;
  const lastOk = new Map();
  for (const e of events || []) if (e && e.ok !== false && e.t) lastOk.set(key(e), Math.max(lastOk.get(key(e)) || 0, e.t));
  const out = new Map();
  for (const e of events || []) {
    if (!e || e.ok !== false || !e.t || e.t < since || e.t > now) continue;
    if ((lastOk.get(key(e)) || 0) > e.t) continue;
    const k = key(e);
    if (!out.has(k) || out.get(k).t < e.t) out.set(k, { ...e, area: areaOf(e) });
  }
  return [...out.values()].sort((a, b) => b.t - a.t);
}

/** Order of the lights: the worst state of an area wins. */
const STATE_RANK = { error: 3, never: 2, stale: 1, ok: 0, off: -1 };
/**
 * Lights per area: entries = [{ area, svc, name, last, error, everyHours, off, run }] (one per database, server,
 * project, source …). State per entry: off (not set up, e.g. external backup – does not count for the overall state)
 * · error (last attempt failed) · never (no backup at all) · stale (older than staleDays, or twice its rhythm when
 * that is longer) · ok. → [{ area, state, entries, counts }] in AREAS order + overall state.
 */
function areaStatus(entries, { now = Date.now(), staleDays = 3 } = {}) {
  const by = new Map();
  for (const e of entries || []) {
    if (!e || !AREAS.includes(e.area)) continue;
    const limit = Math.max(staleDays * DAY, 2 * (Number(e.everyHours) || 0) * HOUR);
    const state = e.off ? 'off' : e.error ? 'error' : !e.last ? 'never' : now - e.last > limit ? 'stale' : 'ok';
    if (!by.has(e.area)) by.set(e.area, []);
    by.get(e.area).push({ ...e, state });
  }
  const areas = AREAS.filter((a) => by.has(a)).map((area) => {
    const list = by.get(area).sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || String(a.name).localeCompare(String(b.name)));
    const counts = { ok: 0, stale: 0, never: 0, error: 0, off: 0 };
    for (const e of list) counts[e.state]++;
    return { area, state: list[0].state, entries: list, counts };
  });
  const overall = areas.length ? areas.reduce((w, a) => (STATE_RANK[a.state] > STATE_RANK[w] ? a.state : w), 'ok') : 'none';
  return { areas, overall };
}

/**
 * Quick start templates: which tasks would "back up all databases every night" or "back up Minecraft worlds daily"
 * create? Only for databases/servers that are not covered yet (own backup task or Hostwerk's nightly backup).
 * targets = { dbs: [{ id, name, covered }], mcs: [{ id, name, covered }] } → [{ name, action, schedule }]
 */
const TEMPLATES = {
  'db-nightly': { list: 'dbs', type: 'db-backup', hour: 2, step: 5 },
  'mc-daily': { list: 'mcs', type: 'mc-backup', hour: 3, step: 10 },
};
function setupPlan(template, targets, { name = (x) => x.name } = {}) {
  const tpl = TEMPLATES[template];
  if (!tpl) return [];
  return ((targets && targets[tpl.list]) || []).filter((x) => x && x.id && !x.covered).slice(0, 24).map((x, i) => {
    // Staggered a few minutes apart, so the backups do not all start at once
    const m = tpl.hour * 60 + i * tpl.step;
    return { name: name(x), enabled: true, action: { type: tpl.type, target: x.id }, schedule: { mode: 'daily', time: `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`, days: [0, 1, 2, 3, 4, 5, 6] } };
  });
}

/**
 * Show the quick start instead of the status head? Only when nothing at all is set up: no backup task, no own
 * schedule (nightly backup, external backup, probe), nothing that was ever backed up and no history.
 */
function setupNeeded({ tasks = [], marks = null, plans = [], areas = [], events = [] } = {}) {
  return !tasks.some((t) => t.enabled && isBackup(t, marks)) && !plans.length && !areas.some((a) => a && (a.last || a.planned)) && !events.length;
}

/** Relative time for "2 hours ago" / "in 3 days": { unit: 'now' | 'min' | 'h' | 'd', n, past } */
function relTime(ts, now = Date.now()) {
  const diff = ts - now;
  const a = Math.abs(diff);
  const past = diff < 0;
  if (a < 60000) return { unit: 'now', n: 0, past };
  if (a < HOUR) return { unit: 'min', n: Math.max(1, Math.floor(a / 60000)), past };
  if (a < 36 * HOUR) return { unit: 'h', n: Math.round(a / HOUR), past };
  return { unit: 'd', n: Math.round(a / DAY), past };
}

/* ---------------- iCalendar (.ics) ---------------- */
const icsEsc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const icsTime = (ts) => { const d = new Date(ts); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
/** Fold lines longer than 75 octets (RFC 5545) – simple: by characters. */
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };

/** Calendar file with the planned runs (and past results) – for Outlook, Google, Apple, Thunderbird. */
function ics(days, { name = 'Hostwerk backups', now = Date.now(), minutes = 15 } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hostwerk//Backup calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`];
  for (const d of days || []) {
    for (const x of d.items) {
      if (x.every) continue; // runs every few minutes would flood the calendar
      const uid = `${x.kind}-${x.id || 'x'}-${x.t}@hostwerk`;
      const title = x.status === 'error' ? `✗ ${x.name}` : x.status === 'ok' ? `✓ ${x.name}` : x.name;
      lines.push('BEGIN:VEVENT', `UID:${icsEsc(uid)}`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(x.t)}`, `DTEND:${icsTime(x.t + minutes * 60000)}`, `SUMMARY:${icsEsc(title)}`);
      if (x.error) lines.push(`DESCRIPTION:${icsEsc(x.error)}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { DAY, HOUR, AREAS, dayKey, isBackup, BACKUP_ACTIONS, taskArea, areaOf, parseCron, cronRuns, runsBetween, planRuns, unscheduled, calendar, monthGrid, taskEvents, lastResults, nextBackup, agenda, collapseEvery, summary, failures, areaStatus, setupPlan, setupNeeded, TEMPLATES, relTime, ics };
