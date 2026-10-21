'use strict';
/*
 * Backup calendar – server part (native extension, runs as part of Hostwerk).
 *   GET  /api/backup-calendar                → { tasks, events (what happened, last 62 days), marks, settings, ics }
 *   PUT  /api/backup-calendar/marks          { id, value: true | false | null } – "counts as a backup" per task
 *   POST /api/backup-calendar/ics-token      new subscription link (the old one stops working)
 *   GET  /api/backup-calendar/ics/<token>.ics  calendar to subscribe to (public route, secret link)
 * Sources besides Hostwerk's tasks: external backup (Live → Backups), cloud backup (extension "Cloud backup"),
 * game server backups (extension "Game servers") and restore probes.
 * Data: data/backup-calendar.json (marks, link token)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('../lib/calendar');

const PAST_DAYS = 62;

function createService(host) {
  const { ctx } = host;
  const file = path.join(ctx.paths.data, 'backup-calendar.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { marks: {}, token: null }; } };
  const write = (v) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(v, null, 1)); fs.renameSync(`${file}.tmp`, file); };
  const settings = () => {
    let s = {};
    try { s = ctx.extMarket.settingsFor(host.id) || {}; } catch { /* defaults */ }
    return { onlyBackups: s.onlyBackups !== false, days: Number(s.days) || 14 };
  };
  const tasks = () => { try { return ctx.scheduler.list().map((t) => ctx.scheduler.info(t)); } catch { return []; } };
  const safe = (fn) => { try { return fn() || []; } catch { return []; } };

  /** Everything that happened in the last weeks, from every source. */
  const events = (list, marks) => {
    const since = Date.now() - PAST_DAYS * L.DAY;
    const hist = {};
    for (const t of list) hist[t.id] = safe(() => ctx.scheduler.history(t.id)).filter((h) => h && h.at >= since);
    const out = L.taskEvents(list, hist, marks);
    // External backup (Live → Backups → external)
    for (const h of safe(() => (ctx.monitor && ctx.monitor.offsite && ctx.monitor.offsite.history) || [])) if (h.t >= since) out.push({ t: h.t, name: host.t('External backup'), ok: !!h.ok, error: h.error || null, kind: 'offsite' });
    // Cloud backup (extension "Cloud backup", service cloudBackup)
    for (const h of safe(() => (ctx.cloudBackup && ctx.cloudBackup.history ? ctx.cloudBackup.history() : []))) if (h.t >= since) out.push({ t: h.t, name: h.name || host.t('Cloud backup'), ok: h.ok !== false, error: h.error || null, kind: 'cloud' });
    // Game server backups (extension "Game servers", service games)
    for (const s of safe(() => (ctx.games && ctx.games.list ? ctx.games.list() : []))) {
      for (const b of safe(() => ctx.games.backups(s))) if (b.time >= since) out.push({ t: b.time, name: host.t('{name}: backup', { name: s.name }), ok: true, kind: 'game' });
    }
    // Restore probes: did the newest backup of each target restore? (one entry per target and run – the run of a
    // "restore probe" task is already in the task history, so its targets show up as details next to it)
    for (const x of safe(() => (ctx.restoreProbe ? ctx.restoreProbe.targets() : []))) {
      const r = x.last;
      if (r && r.at >= since) out.push({ t: r.at, name: host.t('Restore probe: {name}', { name: x.name }), ok: !!r.ok, error: r.ok ? null : r.error || null, kind: 'probe' });
    }
    return out.sort((a, b) => a.t - b.t);
  };

  const token = () => {
    const st = read();
    if (!st.token) { st.token = crypto.randomBytes(18).toString('hex'); write(st); }
    return st.token;
  };

  const state = () => {
    const st = read();
    const list = tasks();
    return { tasks: list, events: events(list, st.marks || {}), marks: st.marks || {}, settings: settings(), ics: `/api/backup-calendar/ics/${token()}.ics`, now: Date.now() };
  };

  const setMark = ({ id, value } = {}) => {
    if (!/^[\w-]{1,80}$/.test(String(id || ''))) throw host.error(400, 'Unknown task');
    const st = read();
    st.marks = st.marks || {};
    if (value === true || value === false) st.marks[id] = value; else delete st.marks[id];
    write(st);
    return state();
  };

  const newToken = () => { const st = read(); st.token = crypto.randomBytes(18).toString('hex'); write(st); return state(); };

  /** Calendar file: last 30 days (with results) and the next 60 days. */
  const icsFile = () => {
    const st = read();
    const list = tasks();
    const now = Date.now();
    const days = L.calendar(list, now - 30 * L.DAY, 90, { onlyBackups: settings().onlyBackups, marks: st.marks || {}, events: events(list, st.marks || {}), now });
    return L.ics(days, { name: host.t('Hostwerk backups'), now });
  };

  return { state, setMark, newToken, icsFile, token, events };
}

function activate(host) {
  const svc = createService(host);
  const r = host.router;
  r.get('/backup-calendar', (req, res) => res.json(svc.state()));
  r.put('/backup-calendar/marks', (req, res) => res.json(svc.setMark(req.body || {})));
  r.post('/backup-calendar/ics-token', (req, res) => res.json(svc.newToken()));
  // Public, but only with the secret link – calendar apps cannot log in
  host.publicRouter.get('/backup-calendar/ics/:file', (req, res) => {
    const m = /^([a-f0-9]{36})\.ics$/.exec(req.params.file || '');
    const want = Buffer.from(svc.token());
    const got = Buffer.from(m ? m[1] : '');
    if (!m || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(404).end();
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'no-store').send(svc.icsFile());
  });
}

module.exports = { activate, createService };
