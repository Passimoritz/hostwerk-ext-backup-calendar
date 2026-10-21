'use strict';
/* 2.1: schedules that are no task, status head, lights per area, agenda, failures, quick start. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/calendar.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 21, 21, 0); // Wednesday evening, after the restore probe at 20:30
const H = 3600000;

test('the contradiction from 2.0: a restore probe today and a nightly backup are no "nothing planned"', () => {
  // Today 20:30 the probe of "Firefight Testserver" ran; the server has Hostwerk's nightly backup at 03:00 (no task)
  const events = [{ t: at(2026, 10, 21, 20, 30), id: 'probe:mc:ff', name: 'Restore probe: Firefight Testserver', ok: true, kind: 'probe' }];
  const plans = [
    { id: 'mc:ff', kind: 'mc', area: 'mc', name: 'Firefight Testserver', group: 'mc-nightly', groupLabel: 'Nightly Minecraft backup', everyHours: 24, hour: 3, last: at(2026, 10, 21, 3, 2) },
    { id: 'probe:mc:ff', kind: 'probe', area: 'probe', name: 'Firefight Testserver', group: 'probe', groupLabel: 'Restore probe', everyHours: 168, hour: 4, slackHours: 1, last: at(2026, 10, 21, 20, 30) },
  ];
  const days = L.calendar([], at(2026, 10, 21), 14, { events, plans, now: NOW });
  const sum = L.summary(days, { now: NOW, events });
  assert.ok(sum.planned > 0, 'planned runs are counted, not only tasks');
  assert.strictEqual(sum.next.area, 'mc');
  assert.strictEqual(new Date(sum.next.t).getHours(), 3);
  assert.strictEqual(L.dayKey(sum.next.t), L.dayKey(at(2026, 10, 22)), 'tomorrow night');
  assert.strictEqual(days[0].items[0].status, 'ok', 'the probe of today stays visible as a result');
  assert.ok(!L.setupNeeded({ plans, events }), 'no quick start when something is set up');
  // Only the probe result, nothing planned: no "next backup", and a probe is no backup ("last successful backup")
  const only = L.summary(L.calendar([], at(2026, 10, 21), 14, { events, now: NOW }), { now: NOW, events });
  assert.strictEqual(only.next, null);
  assert.strictEqual(only.lastOk, null);
  assert.ok(!L.setupNeeded({ events }), 'with a history the page still shows its state, not the empty quick start');
  assert.ok(L.setupNeeded({}), 'really nothing → quick start');
});

test('planRuns: at the chosen hour like dueNightly, overdue right away, rhythm without hour', () => {
  const nightly = L.planRuns({ everyHours: 24, hour: 3, last: at(2026, 10, 21, 3, 0) }, NOW, NOW + 3 * 24 * H);
  assert.deepStrictEqual(nightly.map((x) => [new Date(x).getDate(), new Date(x).getHours()]), [[22, 3], [23, 3], [24, 3]]);
  const overdue = L.planRuns({ everyHours: 24, hour: 3, last: NOW - 3 * 24 * H }, NOW, NOW + 24 * H);
  assert.strictEqual(overdue[0], NOW, 'PC was off – Hostwerk catches up right away');
  const fresh = L.planRuns({ everyHours: 24, hour: 3 }, NOW, NOW + 24 * H);
  assert.strictEqual(new Date(fresh[0]).getHours(), 3);
  const offsite = L.planRuns({ everyHours: 12, last: NOW - 2 * H }, NOW, NOW + 30 * H);
  assert.deepStrictEqual(offsite, [NOW + 10 * H, NOW + 22 * H]);
  const weekly = L.planRuns({ everyHours: 168, hour: 4, slackHours: 1, last: at(2026, 10, 21, 4, 0) }, NOW, NOW + 14 * 24 * H);
  assert.deepStrictEqual(weekly.map((x) => new Date(x).getDate()), [28, 4]);
  assert.deepStrictEqual(L.planRuns({ enabled: false, everyHours: 24 }, NOW, NOW + 24 * H), []);
});

test('plans of one group at the same time become one entry; areas per entry', () => {
  const plans = ['A', 'B'].map((n) => ({ id: `db:${n}`, kind: 'db', area: 'db', name: n, group: 'db-nightly', groupLabel: 'Nightly database backup', everyHours: 24, hour: 2, last: at(2026, 10, 21, 2, 0) }));
  const tasks = [{ id: 't', name: 'Shop snapshot', enabled: true, action: { type: 'snapshot', target: 'p' }, schedule: { mode: 'daily', time: '05:00' } }];
  const days = L.calendar(tasks, at(2026, 10, 21), 2, { plans, now: NOW });
  const items = days[1].items;
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].name, 'Nightly database backup: A, B');
  assert.strictEqual(items[0].area, 'db');
  assert.strictEqual(items[1].area, 'project');
  assert.strictEqual(L.areaOf({ kind: 'cloud' }), 'offsite');
  assert.strictEqual(L.areaOf({ kind: 'game' }), 'ext');
  assert.strictEqual(L.taskArea({ action: { type: 'restore-probe' } }), 'probe');
});

test('agenda folds empty days into one line, today always stays', () => {
  const days = L.calendar([{ id: 'w', name: 'Weekly', enabled: true, action: { type: 'db-backup' }, schedule: { mode: 'cron', expr: '0 2 * * 1' } }], at(2026, 10, 21), 14, { now: NOW });
  const ag = L.agenda(days, L.dayKey(NOW));
  assert.deepStrictEqual(ag.map((g) => g.type), ['day', 'gap', 'day', 'gap', 'day', 'gap']);
  assert.strictEqual(ag[1].count, 4, 'Thu – Sun: nothing planned');
  assert.strictEqual(new Date(ag[2].date).getDay(), 1);
  assert.strictEqual(ag[0].items.length, 0, 'today without entries is still shown');
});

test('runs every few minutes become one entry with a count', () => {
  const items = [0, 1, 2].map((i) => ({ t: NOW + i * 900000, id: 'e', name: 'Ping backup', status: 'planned', every: true })).concat([{ t: NOW + 60000, id: 'x', name: 'Other', status: 'planned' }]);
  const c = L.collapseEvery(items);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].count, 3);
  assert.strictEqual(c[0].until, NOW + 1800000);
});

test('failures: only open ones (no later success), newest first', () => {
  const ev = [
    { t: NOW - 5 * H, id: 'a', name: 'DB', ok: false, kind: 'task', error: 'Disk full' },
    { t: NOW - 2 * H, id: 'a', name: 'DB', ok: true, kind: 'task' },
    { t: NOW - 3 * H, id: 'offsite', name: 'External backup', ok: false, kind: 'offsite', error: 'NAS offline' },
    { t: NOW - 1 * H, id: 'mc:ff', name: 'MC', ok: false, kind: 'mc', error: 'locked' },
    { t: NOW - 20 * 24 * H, id: 'old', name: 'Old', ok: false, kind: 'task' },
  ];
  assert.deepStrictEqual(L.failures(ev, { now: NOW }).map((e) => [e.id, e.area]), [['mc:ff', 'mc'], ['offsite', 'offsite']]);
});

test('lights per area: error > never > stale > ok, "not set up" does not count', () => {
  const s = L.areaStatus([
    { area: 'db', svc: 'a', name: 'Shop', last: NOW - 2 * H },
    { area: 'db', svc: 'b', name: 'Blog', last: null },
    { area: 'mc', svc: 'ff', name: 'Firefight', last: NOW - 5 * 24 * H },
    { area: 'mc', svc: 'lobby', name: 'Lobby', last: NOW - 10 * 24 * H, everyHours: 168 },
    { area: 'offsite', svc: 'offsite', name: 'External', off: true },
    { area: 'probe', svc: 'x', name: 'Shop', last: null, error: 'Import failed' },
  ], { now: NOW });
  assert.deepStrictEqual(s.areas.map((a) => [a.area, a.state]), [['db', 'never'], ['mc', 'stale'], ['offsite', 'off'], ['probe', 'error']]);
  assert.deepStrictEqual(s.areas[1].counts, { ok: 1, stale: 1, never: 0, error: 0, off: 0 }, 'weekly rhythm: 10 days is fine, 5 days daily is not');
  assert.strictEqual(s.areas[0].entries[0].name, 'Blog', 'worst first');
  assert.strictEqual(s.overall, 'error');
  assert.strictEqual(L.areaStatus([{ area: 'offsite', svc: 'o', off: true }], { now: NOW }).overall, 'ok');
  assert.strictEqual(L.areaStatus([], { now: NOW }).overall, 'none');
});

test('quick start: tasks only for uncovered databases/servers, a few minutes apart', () => {
  const targets = { dbs: [{ id: 'a', name: 'Shop', covered: false }, { id: 'b', name: 'Blog', covered: true }, { id: 'c', name: 'Wiki', covered: false }], mcs: [] };
  const list = L.setupPlan('db-nightly', targets, { name: (x) => `Nightly backup: ${x.name}` });
  assert.deepStrictEqual(list.map((b) => [b.name, b.action.type, b.action.target, b.schedule.time]), [['Nightly backup: Shop', 'db-backup', 'a', '02:00'], ['Nightly backup: Wiki', 'db-backup', 'c', '02:05']]);
  assert.strictEqual(list[0].schedule.mode, 'daily');
  assert.deepStrictEqual(L.setupPlan('mc-daily', targets), []);
  assert.deepStrictEqual(L.setupPlan('nope', targets), []);
});

test('relative time', () => {
  assert.deepStrictEqual(L.relTime(NOW - 30000, NOW), { unit: 'now', n: 0, past: true });
  assert.deepStrictEqual(L.relTime(NOW - 59.9 * 60000, NOW), { unit: 'min', n: 59, past: true });
  assert.deepStrictEqual(L.relTime(NOW + 6 * H, NOW), { unit: 'h', n: 6, past: false });
  assert.deepStrictEqual(L.relTime(NOW - 3 * 24 * H, NOW), { unit: 'd', n: 3, past: true });
});
