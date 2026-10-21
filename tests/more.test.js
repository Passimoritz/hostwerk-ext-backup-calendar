'use strict';
/* Cron, "after" and "at start", marks, events from the history, month grid, iCalendar. */
const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/calendar.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 18, 12, 0); // Sunday

test('cron: day by day only at allowed times, like the scheduler', () => {
  const t = { enabled: true, schedule: { mode: 'cron', expr: '30 2 * * 1-5' } }; // Mon–Fri 02:30
  const runs = L.runsBetween(t, NOW, NOW + 7 * 86400000);
  assert.deepStrictEqual(runs.map((x) => new Date(x).getDay()), [1, 2, 3, 4, 5]);
  assert.ok(runs.every((x) => new Date(x).getHours() === 2 && new Date(x).getMinutes() === 30));
  assert.strictEqual(L.cronRuns('*/30 * * * *', NOW, NOW + 3600000).length, 2);
  assert.deepStrictEqual(L.cronRuns('broken', NOW, NOW + 86400000), []);
});

test('after another task and at start', () => {
  const parent = { id: 'p', enabled: true, schedule: { mode: 'daily', time: '03:00' } };
  const child = { id: 'c', name: 'Upload', enabled: true, schedule: { mode: 'after', task: 'p' } };
  const byId = new Map([['p', parent], ['c', child]]);
  const runs = L.runsBetween(child, NOW, NOW + 2 * 86400000, 40, byId);
  assert.strictEqual(runs.length, 2);
  assert.strictEqual(new Date(runs[0]).getMinutes(), 1, 'one minute after the other task');
  const start = { id: 's', name: 'Start backup', enabled: true, action: { type: 'db-backup' }, schedule: { mode: 'startup' } };
  assert.deepStrictEqual(L.runsBetween(start, NOW, NOW + 86400000), []);
  assert.deepStrictEqual(L.unscheduled([start], null), [{ id: 's', name: 'Start backup', mode: 'startup' }]);
});

test('counts as a backup: own mark beats kind and name', () => {
  const t = { id: 'x', name: 'Night run', action: { type: 'command' } };
  assert.ok(!L.isBackup(t));
  assert.ok(L.isBackup(t, { x: true }));
  assert.ok(!L.isBackup({ id: 'y', name: 'Backup', action: { type: 'db-backup' } }, { y: false }));
  assert.ok(L.isBackup({ id: 'm', name: 'PC', action: { type: 'machine-backup' } }), 'by kind of action');
});

test('what happened: task history, failures and other sources per day', () => {
  const tasks = [{ id: 'a', name: 'DB backup', enabled: true, action: { type: 'db-backup' }, schedule: { mode: 'daily', time: '03:00' } }];
  const ev = L.taskEvents(tasks, { a: [{ at: NOW - 86400000, status: 'ok' }, { at: NOW - 2 * 86400000, status: 'error', output: 'line 1\nDisk full' }] });
  assert.strictEqual(ev[1].error, 'Disk full');
  const events = [...ev, { t: NOW - 3600000, name: 'Cloud', ok: true, kind: 'cloud' }];
  const cal = L.calendar(tasks, NOW - 3 * 86400000, 5, { events, now: NOW });
  const flat = cal.flatMap((d) => d.items);
  assert.deepStrictEqual(flat.filter((x) => x.status !== 'planned').map((x) => [x.status, x.kind]), [['error', 'task'], ['ok', 'task'], ['ok', 'cloud']]);
  assert.ok(flat.some((x) => x.status === 'planned'), 'future runs stay planned');
  assert.ok(flat.filter((x) => x.status === 'planned').every((x) => x.t >= NOW), 'no planned runs in the past');
});

test('month grid starts on Monday and covers the whole month', () => {
  const g = L.monthGrid(NOW); // October 2026
  assert.ok(g.every((w) => w.length === 7));
  assert.strictEqual(new Date(g[0][0].date).getDay(), 1);
  assert.strictEqual(g.flat().filter((c) => c.inMonth).length, 31);
});

test('iCalendar file', () => {
  const days = [{ key: 'k', date: NOW, items: [{ t: NOW, id: 'a', name: 'DB; Backup, daily', kind: 'task', status: 'planned' }, { t: NOW, id: 'b', name: 'Every 5 min', kind: 'task', status: 'planned', every: true }, { t: NOW - 1, id: 'c', name: 'Fail', kind: 'task', status: 'error', error: 'Disk full' }] }];
  const f = L.ics(days, { now: NOW });
  assert.match(f, /^BEGIN:VCALENDAR\r\n/);
  assert.match(f, /SUMMARY:DB\\; Backup\\, daily/);
  assert.match(f, /SUMMARY:✗ Fail\r\nDESCRIPTION:Disk full/);
  assert.ok(!f.includes('Every 5 min'), 'runs every few minutes are left out');
  assert.strictEqual((f.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(f.endsWith('END:VCALENDAR\r\n'));
});
