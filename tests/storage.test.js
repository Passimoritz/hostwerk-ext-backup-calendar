'use strict';
/* Data moves into host.dataDir once (so "Remove completely" removes it); hosts without dataDir keep the old places. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { storage } = require('../server/storage');

test('old data/backup-calendar.json and data/cloud-backup move into host.dataDir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcal-store-'));
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'cloud-backup'), { recursive: true });
  fs.writeFileSync(path.join(data, 'backup-calendar.json'), '{"marks":{"a":true},"token":"t"}');
  fs.writeFileSync(path.join(data, 'cloud-backup', 'rclone.conf'), '[hwc]');
  const dataDir = path.join(data, 'extensions', 'native', 'backup-calendar');
  fs.mkdirSync(dataDir, { recursive: true });
  const s = storage({ ctx: { paths: { data } }, dataDir });
  assert.strictEqual(s.calendar, path.join(dataDir, 'calendar.json'));
  assert.strictEqual(JSON.parse(fs.readFileSync(s.calendar, 'utf8')).token, 't');
  assert.strictEqual(fs.readFileSync(path.join(s.cloud, 'rclone.conf'), 'utf8'), '[hwc]');
  assert.ok(!fs.existsSync(path.join(data, 'backup-calendar.json')));
  assert.ok(!fs.existsSync(path.join(data, 'cloud-backup')));
  // A second call (cloud part, next start) changes nothing and never overwrites newer data with old leftovers
  fs.writeFileSync(path.join(data, 'backup-calendar.json'), '{"token":"old"}');
  storage({ ctx: { paths: { data } }, dataDir });
  assert.strictEqual(JSON.parse(fs.readFileSync(s.calendar, 'utf8')).token, 't');
});

test('hosts without dataDir keep the old places', () => {
  const s = storage({ ctx: { paths: { data: 'X' } } });
  assert.strictEqual(s.calendar, path.join('X', 'backup-calendar.json'));
  assert.strictEqual(s.cloud, path.join('X', 'cloud-backup'));
});
