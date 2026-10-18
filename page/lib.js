/* BackupCalendar – pure logic without DOM, tested in tests/lib.test.js (node --test). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BackupCalendar = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const DAY = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  /** Datum als YYYY-MM-DD in Ortszeit (nicht UTC – sonst rutschen späte Termine auf den Folgetag). */
  function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  /** Sicherung? Art der Aktion oder Name. */
  function isBackup(t) { return /backup|sicherung|snapshot|dump/i.test(`${(t.action && t.action.type) || ''} ${t.name || ''} ${t.actionLabel || ''}`); }
  /** Termine eines Zeitplans im Zeitraum [from, to). Wie Hostwerks Planer: every (Minuten), daily (Uhrzeit, Wochentage); sonst nur nextRun. */
  function runsBetween(t, from, to, max = 40) {
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
    if (t.nextRun && t.nextRun >= from && t.nextRun < to) out.push(t.nextRun);
    return out;
  }
  /** Kalender: je Tag die Termine (sortiert), Sicherungen hervorgehoben. */
  function calendar(tasks, from, days = 14, { onlyBackups = false } = {}) {
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const to = start.getTime() + days * DAY;
    const out = [];
    for (let i = 0; i < days; i++) { const d = new Date(start); d.setDate(start.getDate() + i); out.push({ key: dayKey(d.getTime()), date: d.getTime(), items: [] }); }
    const byKey = new Map(out.map((d) => [d.key, d]));
    for (const t of tasks || []) {
      if (onlyBackups && !isBackup(t)) continue;
      for (const ts of runsBetween(t, Math.max(from, start.getTime()), to)) { const d = byKey.get(dayKey(ts)); if (d) d.items.push({ t: ts, id: t.id, name: t.name, backup: isBackup(t), every: (t.schedule || {}).mode === 'every' }); }
    }
    for (const d of out) d.items.sort((a, b) => a.t - b.t);
    return out;
  }
  /** Letzte Ergebnisse: fehlgeschlagene zuerst, dann neueste. */
  function lastResults(tasks, { onlyBackups = false, limit = 8 } = {}) {
    return (tasks || []).filter((t) => t.lastRun && (!onlyBackups || isBackup(t)))
      .map((t) => ({ id: t.id, name: t.name, t: t.lastRun, ok: t.lastStatus !== 'error', rate: t.successRate }))
      .sort((a, b) => (a.ok === b.ok ? b.t - a.t : a.ok ? 1 : -1)).slice(0, limit);
  }
  /** Nächste Sicherung (für die Kachel). */
  function nextBackup(tasks, now = Date.now()) {
    let best = null;
    for (const t of tasks || []) { if (!isBackup(t) || !t.enabled || !t.nextRun || t.nextRun < now) continue; if (!best || t.nextRun < best.t) best = { t: t.nextRun, name: t.name, id: t.id }; }
    return best;
  }
  return { dayKey, isBackup, runsBetween, calendar, lastResults, nextBackup };
}));
