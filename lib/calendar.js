'use strict';
/*
 * Backup calendar – pure logic without server or page (shared by both, tested in tests/lib.test.js).
 * Planned runs of Hostwerk's tasks (every schedule kind: every, daily, cron, after another task, at start) plus what
 * really happened (task runs, external backup, cloud backup, game server backups, restore probes) – per day.
 */
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** Date as YYYY-MM-DD in local time (not UTC – otherwise late runs slip to the next day). */
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

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

/** "When does it run?" for tasks without fixed times (shown below the calendar). */
function unscheduled(tasks, marks, { onlyBackups = true } = {}) {
  return (tasks || []).filter((t) => t.enabled && (!onlyBackups || isBackup(t, marks)) && t.schedule && t.schedule.mode === 'startup').map((t) => ({ id: t.id, name: t.name, mode: 'startup' }));
}

/**
 * Days with planned runs and what happened: [{ key, date, items: [{ t, id, name, backup, kind, status }] }]
 * status: planned | ok | error · kind: task | offsite | cloud | game | probe
 */
function calendar(tasks, from, days = 14, { onlyBackups = false, marks = null, events = [], now = from } = {}) {
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
      if (d) d.items.push({ t: ts, id: t.id, name: t.name, backup, kind: 'task', status: 'planned', every: (t.schedule || {}).mode === 'every' });
    }
  }
  // What really happened (past): task runs, external/cloud backup, game server backups, restore probes
  for (const e of events || []) {
    if (!e || !e.t || e.t < start.getTime() || e.t >= to) continue;
    if (onlyBackups && e.backup === false) continue;
    const d = byKey.get(dayKey(e.t));
    if (d) d.items.push({ t: e.t, id: e.id || null, name: e.name, backup: e.backup !== false, kind: e.kind || 'task', status: e.ok === false ? 'error' : 'ok', error: e.error || null });
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
    for (const h of (histories && histories[t.id]) || []) out.push({ t: h.at, id: t.id, name: t.name, ok: h.status !== 'error', error: h.status === 'error' ? String(h.output || '').trim().split('\n').pop().slice(0, 200) : null, backup, kind: (t.action && t.action.type) === 'restore-probe' ? 'probe' : 'task' });
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

module.exports = { DAY, dayKey, isBackup, BACKUP_ACTIONS, parseCron, cronRuns, runsBetween, unscheduled, calendar, monthGrid, taskEvents, lastResults, nextBackup, ics };
