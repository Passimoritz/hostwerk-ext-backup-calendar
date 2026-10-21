'use strict';
/* Server part with a simulated Hostwerk: sources, marks, subscription link. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, activate } = require('../server/index');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-bcal-'));
  const now = Date.now();
  const tasks = [
    { id: 'a', name: 'DB backup', enabled: true, action: { type: 'db-backup' }, schedule: { mode: 'daily', time: '03:00' }, lastRun: now - 3600000, lastStatus: 'error' },
    { id: 'b', name: 'Night run', enabled: true, action: { type: 'command' }, schedule: { mode: 'daily', time: '04:00' } },
  ];
  const host = {
    id: 'backup-calendar',
    ctx: {
      paths: { data: dir },
      extMarket: { settingsFor: () => ({ days: '7' }) },
      scheduler: { list: () => tasks, info: (t) => ({ ...t, actionLabel: t.action.type }), history: (id) => (id === 'a' ? [{ at: now - 3600000, status: 'error', output: 'Disk full' }, { at: now - 120 * 86400000, status: 'ok' }] : []) },
      monitor: { offsite: { history: [{ t: now - 7200000, ok: true }] } },
      cloudBackup: { history: () => [{ t: now - 5000, ok: false, error: 'Token expired' }] },
      games: { list: () => [{ id: 'g', name: 'Valheim' }], backups: () => [{ time: now - 86400000, file: 'x.tar.gz' }] },
      restoreProbe: { targets: () => [{ name: 'MariaDB', last: { at: now - 1000, ok: true } }, { name: 'Old', last: null }] },
    },
    t: (s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)) : s),
    error: (st, m) => Object.assign(new Error(m), { status: st }),
  };
  return { host, svc: createService(host), dir };
}

test('state brings tasks, events from every source and the settings', () => {
  const { svc } = setup();
  const st = svc.state();
  assert.strictEqual(st.settings.days, 7);
  assert.ok(st.settings.onlyBackups);
  assert.deepStrictEqual(st.events.map((e) => e.kind).sort(), ['cloud', 'game', 'offsite', 'probe', 'task']);
  assert.strictEqual(st.events.find((e) => e.kind === 'task').error, 'Disk full');
  assert.strictEqual(st.events.find((e) => e.kind === 'cloud').error, 'Token expired');
  assert.match(st.ics, /^\/api\/backup-calendar\/ics\/[a-f0-9]{36}\.ics$/);
});

test('marks and subscription link', () => {
  const { svc } = setup();
  assert.deepStrictEqual(svc.setMark({ id: 'b', value: true }).marks, { b: true });
  assert.deepStrictEqual(svc.setMark({ id: 'b', value: null }).marks, {});
  assert.throws(() => svc.setMark({ id: '../x' }), /Unknown task/);
  const before = svc.token();
  svc.newToken();
  assert.notStrictEqual(svc.token(), before);
  const f = svc.icsFile();
  assert.match(f, /BEGIN:VCALENDAR/);
  assert.match(f, /SUMMARY:✗ DB backup/);
});

test('public calendar route only with the right token', async () => {
  const { host, svc } = setup();
  const routes = {};
  const router = () => ({ get: (p, fn) => { routes[`GET ${p}`] = fn; }, put: () => {}, post: () => {} });
  activate({ ...host, router: router(), publicRouter: router() });
  const call = (file) => new Promise((resolve) => {
    const res = { code: 200, headers: {}, status(c) { this.code = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, end() { resolve(this); }, send(b) { this.body = b; resolve(this); } };
    routes['GET /backup-calendar/ics/:file']({ params: { file } }, res);
  });
  assert.strictEqual((await call(`${'0'.repeat(36)}.ics`)).code, 404);
  assert.strictEqual((await call('nope')).code, 404);
  const ok = await call(`${svc.token()}.ics`);
  assert.strictEqual(ok.code, 200);
  assert.match(ok.headers['Content-Type'], /text\/calendar/);
});
