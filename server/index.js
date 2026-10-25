'use strict';
/*
 * Backup calendar – server part (native extension, runs as part of Hostwerk).
 *   GET  /api/backup-calendar                → { tasks, events (what happened, last 62 days), plans (schedules that are
 *                                              no task), areas (lights per area), targets (quick start), marks, settings, ics }
 *   PUT  /api/backup-calendar/marks          { id, value: true | false | null } – "counts as a backup" per task
 *   POST /api/backup-calendar/ics-token      new subscription link (the old one stops working)
 *   GET  /api/backup-calendar/ics/<token>.ics  calendar to subscribe to (public route, secret link)
 * Sources besides Hostwerk's tasks: external backup (Live → Backups), cloud backup (extension "Cloud backup"),
 * game server backups (extension "Game servers"), restore probes and Hostwerk's backup centre (nightly backups of
 * databases and Minecraft servers, "Back up now", project snapshots, sources of other extensions).
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

  const enc = encodeURIComponent;
  const list = (fn) => safe(fn).filter(Boolean);
  const dbs = () => list(() => (ctx.dbm ? ctx.dbm.list() : []));
  const mcs = () => list(() => (ctx.minecraft ? ctx.minecraft.list() : []));
  /** Nightly backup of a database (core settings – read only, never create defaults). */
  const dbNightly = (id) => { try { return ((ctx.settings.get().backups || {})[id]) || null; } catch { return null; } };
  /** All stored backups of Hostwerk's backup centre (databases, Minecraft, snapshots, extension sources). */
  const centre = () => { try { return ctx.backupCenter && ctx.backupCenter.all ? ctx.backupCenter.all() : null; } catch { return null; } };
  /** "Back up now" for things that are no task: the same routes as Hostwerk's own buttons. */
  const RUN = {
    db: (id) => ({ path: `/dbs/${enc(id)}/backups`, body: {} }),
    mc: (id) => ({ path: `/mc/servers/${enc(id)}/backups`, body: {} }),
    snapshot: (id) => ({ path: `/projects/${enc(id)}/snapshots`, body: {} }),
  };
  const HREF = { db: (id) => `#/dbs/${id}`, mc: (id) => `#/mc/${id}/backups`, snapshot: (id) => `#/projects/${id}/snapshots` };
  const OFFSITE_RUN = { path: '/live/monitor/offsite/run', body: {} };
  const offsite = () => (ctx.monitor && ctx.monitor.offsite) || null;
  const cloudHistory = () => safe(() => (ctx.cloudBackup && ctx.cloudBackup.history ? ctx.cloudBackup.history() : []));
  const probeTargets = () => safe(() => (ctx.restoreProbe ? ctx.restoreProbe.targets() : []));
  /** Probe settings of the core (enabled, everyDays, hour) – read without side effects. */
  const probeCfg = () => { try { return ctx.settings.get().restoreProbe || { enabled: true, everyDays: 7, hour: 4 }; } catch { return null; } };

  /** Everything that happened in the last weeks, from every source. */
  const events = (tasksList, marks, c = centre()) => {
    const since = Date.now() - PAST_DAYS * L.DAY;
    const hist = {};
    for (const t of tasksList) hist[t.id] = safe(() => ctx.scheduler.history(t.id)).filter((h) => h && h.at >= since);
    const out = L.taskEvents(tasksList, hist, marks);
    // Backups that are no task run: Hostwerk's nightly backups, "Back up now", snapshots, sources of extensions. A run of a
    // backup task also leaves a file – that one is already in the task history (same target, within 15 minutes).
    const byTask = new Map(tasksList.map((x) => [x.id, x]));
    const taskRun = (kind, svc, t) => out.some((e) => { const x = byTask.get(e.id); return x && x.action && x.action.target === svc && L.taskArea(x) === L.areaOf({ kind }) && Math.abs(e.t - t) < 15 * 60000; });
    const extSources = new Set();
    for (const b of (c && c.items) || []) {
      if (!b || !b.t || b.t < since || !['db', 'mc', 'snapshot', 'ext'].includes(b.kind)) continue;
      if (b.kind === 'ext') extSources.add(b.source);
      if (b.kind !== 'ext' && taskRun(b.kind, b.svc, b.t)) continue;
      const name = b.kind === 'db' ? host.t('Database backup: {name}', { name: b.svcName }) : b.kind === 'mc' ? host.t('Minecraft backup: {name}', { name: b.svcName })
        : b.kind === 'snapshot' ? host.t('Snapshot: {name}', { name: b.svcName }) : b.sourceName && b.sourceName !== b.svcName ? `${b.sourceName}: ${b.svcName}` : b.svcName;
      out.push({ t: b.t, id: `${b.kind}:${b.kind === 'ext' ? `${b.source}:` : ''}${b.svc}`, name, ok: true, kind: b.kind, href: b.href || null, run: RUN[b.kind] ? RUN[b.kind](b.svc) : null });
    }
    // Failed nightly backups (no file then – Hostwerk keeps the error with the schedule)
    for (const d of dbs()) { const n = dbNightly(d.id); if (n && n.enabled && n.lastError && n.lastRun >= since) out.push({ t: n.lastRun, id: `db:${d.id}`, name: host.t('Database backup: {name}', { name: d.name }), ok: false, error: n.lastError, kind: 'db', href: HREF.db(d.id), run: RUN.db(d.id) }); }
    for (const s of mcs()) { const n = s.nightlyBackup; if (n && n.enabled && n.lastError && n.lastRun >= since) out.push({ t: n.lastRun, id: `mc:${s.id}`, name: host.t('Minecraft backup: {name}', { name: s.name }), ok: false, error: n.lastError, kind: 'mc', href: HREF.mc(s.id), run: RUN.mc(s.id) }); }
    // External backup (Live → Backups → external) – going to the cloud, the cloud backup reports the same runs itself
    const o = offsite() || {};
    const viaCloud = o.type === 'cloud' && ctx.cloudBackup && ctx.cloudBackup.history;
    if (!viaCloud) for (const h of safe(() => o.history || [])) if (h.t >= since) out.push({ t: h.t, id: 'offsite', name: host.t('External backup'), ok: !!h.ok, error: h.error || null, kind: 'offsite', href: '#/live/backups', run: OFFSITE_RUN });
    // Cloud backup (part “Cloud” of this extension since 3.0, service cloudBackup)
    for (const h of cloudHistory()) if (h.t >= since) out.push({ t: h.t, id: 'cloud', name: h.name || host.t('Cloud backup'), ok: h.ok !== false, error: h.error || null, kind: 'cloud', href: '#/sicherungen/x-backup-calendar-cloud' });
    // Game server backups (extension "Game servers", service games) – unless it already reports them to the backup centre
    if (!extSources.has('game-servers')) {
      for (const s of safe(() => (ctx.games && ctx.games.list ? ctx.games.list() : []))) {
        for (const b of safe(() => ctx.games.backups(s))) if (b.time >= since) out.push({ t: b.time, id: `game:${s.id || s.name}`, name: host.t('{name}: backup', { name: s.name }), ok: true, kind: 'game' });
      }
    }
    // Restore probes: did the newest backup of each target restore? (one entry per target and run – the run of a
    // "restore probe" task is already in the task history, so its targets show up as details next to it)
    for (const x of probeTargets()) {
      const r = x.last;
      if (r && r.at >= since) out.push({ t: r.at, id: `probe:${x.key || x.name}`, name: host.t('Restore probe: {name}', { name: x.name }), ok: !!r.ok, error: r.ok ? null : r.error || null, kind: 'probe', run: x.key ? { path: '/restore-probe/run', body: { key: x.key } } : null });
    }
    return out.sort((a, b) => a.t - b.t);
  };

  /**
   * Schedules that are no task: nightly database/Minecraft backups, external backup, restore probes. The calendar
   * computes their runs (L.planRuns); several databases at the same hour become one entry.
   */
  const plans = () => {
    const out = [];
    for (const d of dbs()) { const n = dbNightly(d.id); if (n && n.enabled) out.push({ id: `db:${d.id}`, kind: 'db', area: 'db', name: d.name, group: 'db-nightly', groupLabel: host.t('Nightly database backup'), everyHours: n.everyHours || 24, hour: n.hour, last: n.lastRun || n.since || null }); }
    for (const s of mcs()) { const n = s.nightlyBackup; if (n && n.enabled) out.push({ id: `mc:${s.id}`, kind: 'mc', area: 'mc', name: s.name, group: 'mc-nightly', groupLabel: host.t('Nightly Minecraft backup'), everyHours: n.everyHours || 24, hour: n.hour, last: n.lastRun || n.since || null }); }
    const o = offsite();
    if (o && o.enabled) out.push({ id: 'offsite', kind: 'offsite', area: 'offsite', name: host.t('External backup'), everyHours: o.everyHours || 24, last: o.lastRun || null });
    const pc = probeCfg();
    if (pc && pc.enabled) {
      for (const x of probeTargets()) out.push({ id: `probe:${x.key || x.name}`, kind: 'probe', area: 'probe', name: x.name, group: 'probe', groupLabel: host.t('Restore probe'), everyHours: (Number(pc.everyDays) || 7) * 24, hour: pc.hour ?? 4, slackHours: 1, last: x.last ? x.last.at : null });
    }
    return out;
  };

  /**
   * One entry per thing that should be backed up – for the lights in the status head (L.areaStatus): databases and
   * Minecraft servers (also without any backup = "never"), projects with snapshots, sources of extensions, external
   * and cloud backup, restore probes and backup tasks of any other kind. planned = something backs it up regularly.
   */
  const areas = (tasksList, marks, c = centre()) => {
    const out = [];
    const items = (c && c.items) || [];
    const newest = (match) => items.reduce((m, b) => (match(b) && b.t > m ? b.t : m), 0) || null;
    const taskFail = (type, id, last) => { const t = tasksList.find((x) => x.enabled && x.action && x.action.type === type && x.action.target === id && x.lastStatus === 'error' && x.lastRun > (last || 0)); return t ? host.t('Task “{name}” failed', { name: t.name }) : null; };
    const covered = (type, id, nightly) => !!(nightly && nightly.enabled) || tasksList.some((x) => x.enabled && x.action && x.action.type === type && x.action.target === id);
    const nightlyError = (n, last) => (n && n.enabled && n.lastError && n.lastRun > (last || 0) ? n.lastError : null);
    for (const d of dbs()) {
      const n = dbNightly(d.id);
      const last = newest((b) => b.kind === 'db' && b.svc === d.id) || safe(() => ctx.backup.list(d.id)).reduce((m, b) => Math.max(m, b.t || 0), 0) || null;
      out.push({ area: 'db', svc: d.id, name: d.name, last, error: nightlyError(n, last) || taskFail('db-backup', d.id, last), everyHours: n && n.enabled ? n.everyHours || 24 : null, planned: covered('db-backup', d.id, n), href: HREF.db(d.id), run: RUN.db(d.id) });
    }
    for (const s of mcs()) {
      const n = s.nightlyBackup;
      const last = newest((b) => b.kind === 'mc' && b.svc === s.id) || safe(() => ctx.minecraft.backups(s.id)).reduce((m, b) => Math.max(m, b.time || 0), 0) || null;
      out.push({ area: 'mc', svc: s.id, name: s.name, last, error: nightlyError(n, last) || taskFail('mc-backup', s.id, last), everyHours: n && n.enabled ? n.everyHours || 24 : null, planned: covered('mc-backup', s.id, n), href: HREF.mc(s.id), run: RUN.mc(s.id) });
    }
    const seen = new Set();
    for (const b of items) {
      if (b.kind !== 'snapshot' && b.kind !== 'ext') continue;
      const k = `${b.kind}:${b.source || ''}:${b.svc}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b.kind === 'snapshot'
        ? { area: 'project', svc: b.svc, name: b.svcName, last: newest((y) => y.kind === 'snapshot' && y.svc === b.svc), planned: tasksList.some((x) => x.enabled && x.action && x.action.type === 'snapshot' && x.action.target === b.svc), href: b.href || HREF.snapshot(b.svc), run: RUN.snapshot(b.svc) }
        : { area: 'ext', svc: `${b.source}:${b.svc}`, name: b.sourceName && b.sourceName !== b.svcName ? `${b.svcName} (${b.sourceName})` : b.svcName, last: newest((y) => y.kind === 'ext' && y.source === b.source && y.svc === b.svc), href: b.href || null });
    }
    const o = offsite();
    if (o) {
      const okRuns = (o.history || []).filter((h) => h && h.ok).map((h) => h.t);
      out.push(o.enabled
        ? { area: 'offsite', svc: 'offsite', name: host.t('External backup'), last: o.lastError ? Math.max(0, ...okRuns) || null : o.lastRun || null, error: o.lastError || null, everyHours: o.everyHours || 24, planned: true, href: '#/live/backups', run: OFFSITE_RUN }
        : { area: 'offsite', svc: 'offsite', name: host.t('External backup'), off: true, href: '#/live/backups' });
    }
    const cloud = cloudHistory().filter((h) => h && h.t).sort((a, b) => b.t - a.t);
    if (cloud.length) { const okC = cloud.find((h) => h.ok !== false); out.push({ area: 'offsite', svc: 'cloud', name: host.t('Cloud backup'), last: okC ? okC.t : null, error: cloud[0].ok === false ? cloud[0].error || host.t('failed') : null, planned: true, href: '#/sicherungen/x-backup-calendar-cloud' }); }
    const pc = probeCfg();
    if (pc && pc.enabled) {
      for (const x of probeTargets()) {
        const r = x.last;
        out.push({ area: 'probe', svc: x.key || x.name, name: x.name, last: r && r.ok ? r.at : null, error: r && !r.ok ? r.error || host.t('failed') : null, everyHours: (Number(pc.everyDays) || 7) * 24, planned: true, href: '#/sicherungen', run: x.key ? { path: '/restore-probe/run', body: { key: x.key } } : null });
      }
    }
    // Backup tasks of any other kind (own scripts, commands …): their last run counts
    for (const t of tasksList) {
      if (!t.enabled || L.taskArea(t) !== 'other' || !L.isBackup(t, marks)) continue;
      out.push({ area: 'other', svc: t.id, name: t.name, task: t.id, last: t.lastRun && t.lastStatus !== 'error' ? t.lastRun : null, error: t.lastStatus === 'error' ? host.t('Last run failed') : null, planned: true });
    }
    return out;
  };

  const token = () => {
    const st = read();
    if (!st.token) { st.token = crypto.randomBytes(18).toString('hex'); write(st); }
    return st.token;
  };

  /** Databases/servers for the quick start templates – covered = something backs them up already. */
  const targetsOf = (as) => {
    const pick = (area) => as.filter((a) => a.area === area).map((a) => ({ id: a.svc, name: a.name, covered: !!a.planned }));
    const o = offsite();
    return { dbs: pick('db'), mcs: pick('mc'), offsite: { available: !!o, enabled: !!(o && o.enabled) } };
  };

  const state = () => {
    const st = read();
    const list = tasks();
    const marks = st.marks || {};
    const c = centre();
    const as = areas(list, marks, c);
    return { tasks: list, events: events(list, marks, c), plans: plans(), areas: as, targets: targetsOf(as), marks, settings: settings(), ics: `/api/backup-calendar/ics/${token()}.ics`, now: Date.now() };
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
    const days = L.calendar(list, now - 30 * L.DAY, 90, { onlyBackups: settings().onlyBackups, marks: st.marks || {}, events: events(list, st.marks || {}), plans: plans(), now });
    return L.ics(days, { name: host.t('Hostwerk backups'), now });
  };

  return { state, setMark, newToken, icsFile, token, events, plans, areas };
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
  // 3.0: Teil „Cloud“ (bis 1.5 eigene Erweiterung „Cloud-Sicherung“) – Routen /cloud-backup/…, Dienst cloudBackup
  if (typeof host.core === 'function') require('./cloud').mount(host); // Tests mit nachgebautem Host: nur der Kalender
}

function deactivate() { require('./cloud').unmount(); }

module.exports = { activate, deactivate, createService };
