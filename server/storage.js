'use strict';
/*
 * Where the extension keeps its data. Since 3.2 everything lives in host.dataDir (data/extensions/native/backup-calendar),
 * so "Remove completely" really removes it – rclone configuration with sealed credentials and the recovery key included.
 * Before, it was data/backup-calendar.json and data/cloud-backup/ (the latter inherited from the old "Cloud backup" extension);
 * both are moved over once. Hosts without dataDir (older Hostwerk, tests) keep the old places.
 */
const fs = require('fs');
const path = require('path');

/** Move a file or folder once; never overwrites what is already at the new place. */
function move(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  try { fs.renameSync(from, to); return true; } catch { /* another volume or locked – copy instead */ }
  try { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); return true; } catch { return false; }
}

/** { calendar: file with marks + link token, cloud: folder of the cloud part } – migrates old data on first use. */
function storage(host) {
  const data = host.ctx.paths.data;
  let dir = null;
  try { dir = host.dataDir || null; } catch { dir = null; }
  if (!dir) return { calendar: path.join(data, 'backup-calendar.json'), cloud: path.join(data, 'cloud-backup') };
  const out = { calendar: path.join(dir, 'calendar.json'), cloud: path.join(dir, 'cloud') };
  move(path.join(data, 'backup-calendar.json'), out.calendar);
  move(path.join(data, 'cloud-backup'), out.cloud);
  return out;
}

module.exports = { storage, move };
