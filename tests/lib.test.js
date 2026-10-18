const test = require('node:test');
const assert = require('node:assert');
const L = require('../page/lib.js');

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 18, 12, 0); // Sonntag

test('erkennt Sicherungen an Art und Name', () => {
  assert.ok(L.isBackup({ action: { type: 'db-backup' } }));
  assert.ok(L.isBackup({ name: 'Nächtliche Sicherung' }));
  assert.ok(!L.isBackup({ name: 'Shop erreichbar?', action: { type: 'url' } }));
});

test('täglich: nur ab jetzt und nur an erlaubten Wochentagen', () => {
  const t = { enabled: true, schedule: { mode: 'daily', time: '03:00', days: [1, 3] } }; // Mo, Mi
  const runs = L.runsBetween(t, NOW, NOW + 7 * 86400000);
  assert.deepStrictEqual(runs.map((x) => new Date(x).getDay()), [1, 3]);
  assert.ok(runs.every((x) => new Date(x).getHours() === 3));
});

test('alle N Minuten: ab nextRun, begrenzt', () => {
  const t = { enabled: true, schedule: { mode: 'every', minutes: 15 }, nextRun: NOW + 5 * 60000 };
  const runs = L.runsBetween(t, NOW, NOW + 3600000);
  assert.strictEqual(runs.length, 4);
  assert.strictEqual(runs[1] - runs[0], 15 * 60000);
});

test('ausgeschaltete Aufgaben erscheinen nicht', () => {
  assert.deepStrictEqual(L.runsBetween({ enabled: false, schedule: { mode: 'daily', time: '01:00' } }, NOW, NOW + 86400000 * 3), []);
});

test('Kalender: 14 Tage, Termine einsortiert, nur Sicherungen auf Wunsch', () => {
  const tasks = [
    { id: 'a', name: 'DB-Backup', enabled: true, action: { type: 'db-backup' }, schedule: { mode: 'daily', time: '03:00' } },
    { id: 'b', name: 'Ping', enabled: true, action: { type: 'url' }, schedule: { mode: 'daily', time: '08:00' } },
  ];
  const cal = L.calendar(tasks, NOW, 14, { onlyBackups: true });
  assert.strictEqual(cal.length, 14);
  assert.strictEqual(cal[0].items.length, 0, 'heute 03:00 ist schon vorbei');
  assert.strictEqual(cal[1].items.length, 1);
  assert.ok(cal.every((d) => d.items.every((x) => x.name === 'DB-Backup')));
  assert.strictEqual(L.calendar(tasks, NOW, 3)[1].items.length, 2);
});

test('Ergebnisse: Fehlschläge zuerst; nächste Sicherung', () => {
  const tasks = [
    { id: 'a', name: 'A-Backup', enabled: true, lastRun: NOW - 1000, lastStatus: 'ok', nextRun: NOW + 7200000, action: { type: 'db-backup' } },
    { id: 'b', name: 'B-Backup', enabled: true, lastRun: NOW - 99999, lastStatus: 'error', nextRun: NOW + 3600000, action: { type: 'mc-backup' } },
  ];
  assert.deepStrictEqual(L.lastResults(tasks).map((r) => r.id), ['b', 'a']);
  assert.strictEqual(L.nextBackup(tasks, NOW).id, 'b');
});
