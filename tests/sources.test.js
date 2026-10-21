'use strict';
/* 2.1 server part: Hostwerk's own schedules (nightly backups, external backup, probes) and the backup centre. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService } = require('../server/index');
const L = require('../lib/calendar.js');

const H = 3600000;

function setup({ offsite = { enabled: false, history: [] }, tasks = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-bcal2-'));
  const now = Date.now();
  const settings = {
    backups: { shop: { enabled: true, everyHours: 24, hour: 3, lastRun: now - 30 * H, lastError: 'Access denied' }, blog: { enabled: false } },
    restoreProbe: { enabled: true, everyDays: 7, hour: 4 },
  };
  const host = {
    id: 'backup-calendar',
    ctx: {
      paths: { data: dir },
      settings: { get: () => settings },
      extMarket: { settingsFor: () => ({}) },
      scheduler: { list: () => tasks, info: (t) => t, history: (id) => (id === 'snap' ? [{ at: now - 2 * H, status: 'ok' }] : []) },
      dbm: { list: () => [{ id: 'shop', name: 'Shop' }, { id: 'blog', name: 'Blog' }] },
      backup: { list: () => [] },
      minecraft: { list: () => [{ id: 'ff', name: 'Firefight Testserver', nightlyBackup: { enabled: true, everyHours: 24, hour: 3, lastRun: now - 18 * H } }], backups: () => [] },
      monitor: { offsite },
      backupCenter: {
        all: () => ({
          items: [
            { kind: 'mc', svc: 'ff', svcName: 'Firefight Testserver', t: now - 18 * H, auto: true, href: '#/mc/ff/backups' },
            { kind: 'snapshot', svc: 'p1', svcName: 'Website', t: now - 2 * H + 60000, href: '#/projects/p1/snapshots' },
            { kind: 'ext', source: 'game-servers', sourceName: 'Game servers', svc: 'v', svcName: 'Valheim', t: now - 5 * H },
            { kind: 'time', svc: 'hostwerk', svcName: 'Hostwerk', t: now - H },
          ],
        }),
      },
      games: { list: () => [{ id: 'v', name: 'Valheim' }], backups: () => [{ time: now - 5 * H }] },
      restoreProbe: { targets: () => [{ key: 'mc:ff', name: 'Firefight Testserver', last: { at: now - H, ok: true } }] },
    },
    t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s),
    error: (st, m) => Object.assign(new Error(m), { status: st }),
  };
  return { svc: createService(host), now };
}

test('own schedules: nightly database/Minecraft backups and restore probes are planned (no task needed)', () => {
  const { svc } = setup();
  const st = svc.state();
  assert.deepStrictEqual(st.plans.map((p) => [p.id, p.group]), [['db:shop', 'db-nightly'], ['mc:ff', 'mc-nightly'], ['probe:mc:ff', 'probe']]);
  const days = L.calendar(st.tasks, Date.now(), 14, { plans: st.plans, events: st.events, now: Date.now() });
  const sum = L.summary(days, { now: Date.now(), events: st.events, areas: st.areas });
  assert.ok(sum.next, 'a next backup although there is no task');
  assert.ok(['db', 'mc'].includes(sum.next.area));
  assert.ok(!L.setupNeeded(st));
});

test('events from the backup centre: no duplicates of task runs or game servers, time machine left out, nightly errors', () => {
  const tasks = [{ id: 'snap', name: 'Website snapshot', enabled: true, action: { type: 'snapshot', target: 'p1' }, schedule: { mode: 'daily', time: '05:00' } }];
  const { svc } = setup({ tasks });
  const ev = svc.state().events;
  const kinds = ev.map((e) => e.kind);
  assert.ok(!kinds.includes('snapshot'), 'the snapshot file of the task run is already in the task history');
  assert.strictEqual(kinds.filter((k) => k === 'game').length, 0, 'game servers report to the backup centre – not twice');
  assert.strictEqual(kinds.filter((k) => k === 'ext').length, 1);
  assert.ok(!kinds.includes('time'));
  const mc = ev.find((e) => e.kind === 'mc');
  assert.deepStrictEqual([mc.name, mc.ok, mc.run.path], ['Minecraft backup: Firefight Testserver', true, '/mc/servers/ff/backups']);
  const dbErr = ev.find((e) => e.kind === 'db');
  assert.deepStrictEqual([dbErr.ok, dbErr.error, dbErr.run.path], [false, 'Access denied', '/dbs/shop/backups']);
  assert.ok(L.failures(ev).some((e) => e.id === 'db:shop'), 'the failed nightly backup is an open failure');
});

test('areas: never backed up, failed, not set up – and the quick start targets', () => {
  const { svc } = setup();
  const st = svc.state();
  const s = L.areaStatus(st.areas);
  const get = (area) => s.areas.find((a) => a.area === area);
  assert.strictEqual(get('db').state, 'error', 'Shop: nightly backup failed');
  assert.strictEqual(get('db').counts.never, 1, 'Blog: never backed up');
  assert.strictEqual(get('mc').state, 'ok');
  assert.strictEqual(get('offsite').state, 'off');
  assert.strictEqual(get('probe').state, 'ok');
  assert.strictEqual(get('ext').entries[0].name, 'Valheim (Game servers)');
  assert.deepStrictEqual(st.targets.dbs, [{ id: 'shop', name: 'Shop', covered: true }, { id: 'blog', name: 'Blog', covered: false }]);
  assert.deepStrictEqual(st.targets.offsite, { available: true, enabled: false });
  assert.deepStrictEqual(L.setupPlan('db-nightly', st.targets).map((b) => b.action.target), ['blog']);
});

test('external backup: planned by its rhythm, error shown with the last good run', () => {
  const now = Date.now();
  const { svc } = setup({ offsite: { enabled: true, everyHours: 12, lastRun: now - H, lastError: 'NAS offline', history: [{ t: now - 13 * H, ok: true }, { t: now - H, ok: false, error: 'NAS offline' }] } });
  const st = svc.state();
  const plan = st.plans.find((p) => p.id === 'offsite');
  assert.deepStrictEqual([plan.everyHours, plan.last], [12, now - H]);
  const area = st.areas.find((a) => a.area === 'offsite');
  assert.deepStrictEqual([area.last, area.error], [now - 13 * H, 'NAS offline']);
  assert.ok(st.events.some((e) => e.kind === 'offsite' && e.ok === false && e.run.path === '/live/monitor/offsite/run'));
  assert.match(svc.icsFile(), /SUMMARY:External backup/);
});
