import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Clock, CloudOff, Database, ExternalLink, FileText, ListChecks, MinusCircle, Play, RotateCw, Share2, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { post, put, useApi, on } from '@hostwerk/api';
import { Btn, Empty, Loading, TileEmpty, InfoTip, Seg, Switch, Callout, toast, confirmDialog } from '@hostwerk/ui';
import { contextMenu } from '@hostwerk/kit';
import { t, pl } from '@hostwerk/i18n';
import L from '../../lib/calendar.js';
import './style.css';

/*
 * Backup calendar: first what matters – failures that are still open, then the status head (last successful backup,
 * next one, one light per area with "Back up now"), then the schedule as a short agenda (empty days folded into one
 * line) or as a month calendar with a mark per area. Sources: Hostwerk's tasks, the nightly backups of databases and
 * Minecraft servers, external and cloud backup, project snapshots, restore probes and sources of other extensions.
 * Without any backup a quick start offers ready-made tasks. Export and subscription (.ics) sit in a "Share" menu.
 * Dates follow Hostwerk's language (document language), not the system.
 */
const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
const fmt = (ts, o) => new Date(ts).toLocaleString(locale(), o);
const time = (ts) => fmt(ts, { hour: '2-digit', minute: '2-digit' });
const shortDay = (ts) => fmt(ts, { weekday: 'short', day: '2-digit', month: '2-digit' });
const LIVE = ['tasks', 'job', 'backups', 'restore-probe', 'cloud-backup'];
const AREA_LABEL = { db: 'Databases', mc: 'Minecraft', project: 'Projects', offsite: 'External', probe: 'Restore probes', ext: 'Extensions', other: 'Other tasks' };
const AREA_ONE = { db: 'Database', mc: 'Minecraft', project: 'Project', offsite: 'External', probe: 'Restore probe', ext: 'Extension', other: 'Task' };
const STATE_ICON = { ok: CheckCircle2, stale: Clock, never: CircleDashed, error: XCircle, off: MinusCircle };
const STATE_LABEL = { ok: 'backed up', stale: 'outdated', never: 'never backed up', error: 'failed', off: 'not set up' };

/** "2 hours ago" / "in 3 days" in Hostwerk's language (plural forms from locales/de.json). */
function ago(ts, now = Date.now()) {
  const r = L.relTime(ts, now);
  if (r.unit === 'now') return t('just now');
  if (r.unit === 'min') return pl(r.n, '{n} minute ago', '{n} minutes ago');
  if (r.unit === 'h') return pl(r.n, '{n} hour ago', '{n} hours ago');
  return pl(r.n, '{n} day ago', '{n} days ago');
}
function until(ts, now = Date.now()) {
  const r = L.relTime(ts, now);
  if (r.unit === 'now' || r.past) return t('now');
  if (r.unit === 'min') return pl(r.n, 'in {n} minute', 'in {n} minutes');
  if (r.unit === 'h') return pl(r.n, 'in {n} hour', 'in {n} hours');
  return pl(r.n, 'in {n} day', 'in {n} days');
}

function useCalendarData() {
  const st = useApi('/backup-calendar', [], { poll: true });
  const { reload } = st;
  useEffect(() => { const offs = LIVE.map((e) => on(e, () => reload({ silent: true }))); return () => offs.forEach((f) => f()); }, [reload]);
  return st;
}

const runTask = async (task, reload) => {
  if (!(await confirmDialog({ title: t('Run “{name}” now?', { name: task.name }), text: 'The task runs right away – the next planned run stays as it is.', confirm: 'Run now' }))) return;
  try { await post(`/tasks/${encodeURIComponent(task.id)}/run`); toast.success(t('“{name}” is running', { name: task.name })); if (reload) reload({ silent: true }); } catch (e) { toast.error(e); }
};
/** "Back up now" for things that are no task (database, Minecraft server, project, external backup, probe). */
const runPath = async (run, name, reload) => {
  try { await post(run.path, run.body || {}); toast.success(t('Backup of “{name}” started', { name })); if (reload) reload({ silent: true }); } catch (e) { toast.error(e); }
};
const openLog = (id) => { location.hash = `/aufgaben?task=${encodeURIComponent(id)}`; };

/** Colour and shape per area – the legend explains them, so colour is never the only hint. */
function Mark({ area, label }) {
  return <i className={`bc-mark area-${area}`} role={label ? 'img' : undefined} aria-label={label ? t(AREA_ONE[area] || 'Task') : undefined} aria-hidden={label ? undefined : 'true'} />;
}

function Legend({ areas }) {
  if (!areas.length) return null;
  return (
    <ul className="bc-legend" aria-label={t('Legend')}>
      {areas.map((a) => <li key={a}><Mark area={a} />{t(AREA_LABEL[a])}</li>)}
    </ul>
  );
}

/** Buttons of an entry that failed or can run: log and run again for tasks, "Back up now" and open for the rest. */
function Actions({ x, task, reload }) {
  return (
    <span className="bc-acts">
      {task && x.status === 'error' && <button type="button" className="btn ghost xs icon" aria-label="Open log" title="Open log" onClick={() => openLog(task.id)}><FileText /></button>}
      {task && x.status === 'error' && <button type="button" className="btn ghost xs icon" aria-label="Run again" title="Run again" onClick={() => runTask(task, reload)}><RotateCw /></button>}
      {!task && x.status === 'error' && x.run && <Btn className="ghost xs icon" icon={RotateCw} aria-label="Run again" title="Run again" onClick={() => runPath(x.run, x.name, reload)} />}
      {!task && x.status === 'error' && x.href && <a className="btn ghost xs icon" href={x.href} aria-label="Open" title="Open"><ExternalLink /></a>}
    </span>
  );
}

/** One entry of the agenda or day: time, mark, name (wraps, never cut off), state. */
function Row({ x, task, reload }) {
  const st = x.status === 'error' ? 'is-err' : x.status === 'ok' ? 'is-done' : 'is-plan';
  const when = x.count > 1 ? `${time(x.t)}–${time(x.until)}` : time(x.t);
  return (
    <li className={`bc-row ${st}`} data-row-menu={x.status === 'error' ? '' : undefined}>
      <span className="bc-time mono">{when}</span>
      <Mark area={L.areaOf(x)} label />
      <span className="bc-name">
        {x.name}
        {x.count > 1 && <span className="muted small"> · {pl(x.count, '{n} run', '{n} runs')}</span>}
        {x.error && <span className="bc-errtext small">{x.error}</span>}
      </span>
      {x.status === 'ok' && <span className="badge ok">done</span>}
      {x.status === 'error' && <span className="badge err">failed</span>}
      <Actions x={x} task={task} reload={reload} />
    </li>
  );
}

const dayTitle = (date, today) => {
  const k = L.dayKey(date);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const long = fmt(date, { weekday: 'long', day: 'numeric', month: 'long' });
  if (k === today) return t('Today · {date}', { date: long });
  if (k === L.dayKey(tomorrow.getTime())) return t('Tomorrow · {date}', { date: long });
  return long;
};

/** Agenda: days with entries, empty days folded into one line ("Thu 22.10. – Sun 25.10.: nothing planned"). */
function Agenda({ days, today, byId, reload }) {
  const list = L.agenda(days, today);
  return (
    <div className="bc-agenda">
      {list.map((g) => (g.type === 'gap' ? (
        <div key={g.key} className="bc-gap muted small">{t('{range}: nothing planned', { range: g.count > 1 ? `${shortDay(g.from)} – ${shortDay(g.to)}` : shortDay(g.from) })}</div>
      ) : (
        <section key={g.key} className={`bc-agday ${g.key === today ? 'is-today' : ''}`} aria-label={dayTitle(g.date, today)}>
          <h3 className="bc-agday-head">{dayTitle(g.date, today)}</h3>
          {g.items.length
            ? <ul className="bc-rows">{L.collapseEvery(g.items).map((x, i) => <Row key={`${x.t}-${i}`} x={x} task={byId.get(x.id)} reload={reload} />)}</ul>
            : <div className="muted small bc-none">Nothing more planned today</div>}
        </section>
      )))}
    </div>
  );
}

function MonthView({ month, setMonth, days, today, selected, onSelect }) {
  const grid = L.monthGrid(month);
  const byKey = new Map(days.map((d) => [d.key, d]));
  const shift = (n) => { const d = new Date(month); d.setDate(1); d.setMonth(d.getMonth() + n); setMonth(d.getTime()); };
  const names = Array.from({ length: 7 }, (_, i) => fmt(new Date(2024, 0, 1 + i).getTime(), { weekday: 'short' })); // 1.1.2024 was a Monday
  return (
    <div className="bc-month">
      <div className="bc-month-head">
        <button type="button" className="btn ghost sm icon" aria-label="Previous month" title="Previous month" onClick={() => shift(-1)}><ChevronLeft /></button>
        <h3 className="grow bc-center" aria-live="polite">{fmt(month, { month: 'long', year: 'numeric' })}</h3>
        <button type="button" className="btn ghost sm icon" aria-label="Next month" title="Next month" onClick={() => shift(1)}><ChevronRight /></button>
      </div>
      <div className="bc-grid" role="grid">
        {names.map((n) => <div key={n} className="bc-dow tiny muted" role="columnheader">{n}</div>)}
        {grid.flat().map((c) => {
          const items = (byKey.get(c.key) || { items: [] }).items;
          const err = items.filter((x) => x.status === 'error').length;
          const ok = items.filter((x) => x.status === 'ok').length;
          const plan = items.filter((x) => x.status === 'planned').length;
          const areas = [...new Set(items.map((x) => L.areaOf(x)))];
          const label = [fmt(c.date, { day: 'numeric', month: 'long' }), plan && t('{n} planned', { n: plan }), ok && t('{n} done', { n: ok }), err && t('{n} failed', { n: err })].filter(Boolean).join(', ');
          return (
            <button key={c.key} type="button" role="gridcell" aria-label={label} title={label} aria-pressed={selected === c.key} className={`bc-cell ${c.inMonth ? '' : 'is-outside'} ${c.key === today ? 'is-today' : ''} ${selected === c.key ? 'is-selected' : ''} ${err ? 'has-error' : ''}`} onClick={() => onSelect(c.key)}>
              <span className="bc-num">{new Date(c.date).getDate()}</span>
              <span className="bc-marks" aria-hidden="true">{areas.slice(0, 4).map((a) => <Mark key={a} area={a} />)}{areas.length > 4 && <span className="tiny">+</span>}{err > 0 && <AlertTriangle className="bc-cell-err" />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Open failures at the very top: what failed, why, and the way out (log, run again, open). */
function Failures({ list, byId, reload }) {
  if (!list.length) return null;
  return (
    <section className="card bc-fails" aria-labelledby="bc-fails-h">
      <div className="card-head"><XCircle size={16} className="bc-err-ico" /><h3 id="bc-fails-h">{pl(list.length, '{n} backup failed', '{n} backups failed')}</h3></div>
      <ul className="bc-rows card-body">
        {list.map((e) => {
          const x = { ...e, status: 'error' };
          const task = byId.get(e.id);
          return (
            <li key={`${e.kind}-${e.id || e.name}`} className="bc-row is-err" data-row-menu="">
              <span className="bc-time small">{ago(e.t)}</span>
              <Mark area={L.areaOf(e)} label />
              <span className="bc-name">{e.name}{e.error && <span className="bc-errtext small">{e.error}</span>}</span>
              <span className="bc-acts">
                {task && <Btn className="xs ghost" icon={FileText} onClick={() => openLog(task.id)}>Log</Btn>}
                {task && <Btn className="xs" icon={RotateCw} onClick={() => runTask(task, reload)}>Run again</Btn>}
                {!task && x.run && <Btn className="xs" icon={RotateCw} onClick={() => runPath(x.run, x.name, reload)}>Run again</Btn>}
                {!task && x.href && <a className="btn xs ghost" href={x.href}><ExternalLink />Open</a>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Create the tasks of a quick start template (after asking, with names and times). */
async function applyTemplate(id, targets, reload, only = null) {
  const scope = only ? { ...targets, dbs: (targets.dbs || []).filter((x) => x.id === only), mcs: (targets.mcs || []).filter((x) => x.id === only) } : targets;
  const list = L.setupPlan(id, scope, { name: (x) => t(id === 'db-nightly' ? 'Nightly backup: {name}' : 'Daily backup: {name}', { name: x.name }) });
  if (!list.length) { toast('Everything is covered already'); return; }
  const lines = list.map((b) => `${b.schedule.time} · ${b.name}`).join('\n');
  if (!(await confirmDialog({ title: pl(list.length, 'Create {n} backup task?', 'Create {n} backup tasks?'), text: `${t('They run every day and appear under “Tasks”, where you can change them.')}\n\n${lines}`, confirm: 'Create' }))) return;
  let made = 0;
  for (const b of list) { try { await post('/tasks', b); made++; } catch (e) { toast.error(e); break; } }
  if (made) toast.success(pl(made, '{n} backup task created', '{n} backup tasks created'));
  reload({ silent: true });
}

/** Quick start without any backup: up to three ready-made templates instead of empty cards. */
function Setup({ targets, reload }) {
  const dbs = (targets.dbs || []).filter((x) => !x.covered);
  const mcs = (targets.mcs || []).filter((x) => !x.covered);
  const off = targets.offsite || {};
  return (
    <section className="card bc-setup" aria-labelledby="bc-setup-h">
      <div className="card-head"><Sparkles size={16} /><h3 id="bc-setup-h">Set up backups</h3><InfoTip title="Set up backups">Each template creates normal tasks that you can change or delete any time under “Tasks”. Hostwerk recognises them as backups automatically.</InfoTip></div>
      <div className="card-body bc-tpls">
        <div className="bc-tpl">
          <Mark area="db" />
          <b>Back up every database each night</b>
          <span className="small muted">{dbs.length ? pl(dbs.length, '{n} database, from 02:00', '{n} databases, from 02:00') : t('No database without a backup')}</span>
          <Btn className="sm" icon={Database} disabled={!dbs.length} onClick={() => applyTemplate('db-nightly', targets, reload)}>Set up</Btn>
        </div>
        <div className="bc-tpl">
          <Mark area="mc" />
          <b>Back up Minecraft worlds daily</b>
          <span className="small muted">{mcs.length ? pl(mcs.length, '{n} server, from 03:00', '{n} servers, from 03:00') : t('No Minecraft server without a backup')}</span>
          <Btn className="sm" icon={ShieldCheck} disabled={!mcs.length} onClick={() => applyTemplate('mc-daily', targets, reload)}>Set up</Btn>
        </div>
        {off.available !== false && (
          <div className="bc-tpl">
            <Mark area="offsite" />
            <b>Keep a copy outside this PC</b>
            <span className="small muted">{off.enabled ? t('External backup is on') : t('External drive, NAS or server – protects against a broken disk')}</span>
            <a className="btn sm" href="#/live/backups"><ExternalLink />{off.enabled ? 'Open' : 'Set up'}</a>
          </div>
        )}
      </div>
    </section>
  );
}

/** One area of the status head opened up: every database/server/… with its last backup and "Back up now". */
function AreaDetail({ a, targets, byId, reload }) {
  return (
    <ul className="bc-rows bc-area-list" aria-label={t(AREA_LABEL[a.area])}>
      {a.entries.map((e) => {
        const Icon = STATE_ICON[e.state] || CircleDashed;
        const task = e.task ? byId.get(e.task) : null;
        const tpl = !e.planned && (a.area === 'db' || a.area === 'mc') ? (a.area === 'db' ? 'db-nightly' : 'mc-daily') : null;
        return (
          <li key={e.svc} className={`bc-row st-${e.state}`}>
            <Icon className="bc-st-ico" aria-hidden="true" />
            <span className="bc-name">
              {e.name}
              <span className="small muted bc-sub">{t(STATE_LABEL[e.state])}{e.last ? ` · ${t('last backup {when}', { when: ago(e.last) })}` : ''}{tpl ? ` · ${t('nothing planned')}` : ''}</span>
              {e.error && <span className="bc-errtext small">{e.error}</span>}
            </span>
            <span className="bc-acts">
              {tpl && <Btn className="xs ghost" icon={CalendarDays} onClick={() => applyTemplate(tpl, targets, reload, e.svc)}>Plan daily</Btn>}
              {task && <Btn className="xs" icon={Play} busy={task.running} disabled={task.running} onClick={() => runTask(task, reload)}>{task.running ? 'Running …' : 'Back up now'}</Btn>}
              {!task && e.run && <Btn className="xs" icon={Play} onClick={() => runPath(e.run, e.name, reload)}>{a.area === 'probe' ? 'Check now' : 'Back up now'}</Btn>}
              {e.off && <a className="btn xs" href={e.href}>Set up</a>}
              {!e.off && e.href && <a className="btn ghost xs icon" href={e.href} aria-label={t('Open “{name}”', { name: e.name })} title={t('Open “{name}”', { name: e.name })}><ExternalLink /></a>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Status head: last successful backup, the next one and one light per area – the real use of this page. */
function StatusHead({ sum, status, targets, byId, reload, onSetup }) {
  const [open, setOpen] = useState(null);
  const now = Date.now();
  const cur = status.areas.find((a) => a.area === open);
  const word = (a) => {
    const c = a.counts;
    if (a.state === 'error') return pl(c.error, '{n} failed', '{n} failed');
    if (a.state === 'never') return pl(c.never, '{n} never backed up', '{n} never backed up');
    if (a.state === 'stale') return pl(c.stale, '{n} outdated', '{n} outdated');
    if (a.state === 'off') return t('not set up');
    return a.area === 'probe' ? t('all restorable') : t('all backed up');
  };
  return (
    <section className="card bc-status" aria-labelledby="bc-status-h">
      <h2 id="bc-status-h" className="bc-sr">Status</h2>
      <div className="bc-facts">
        <div className="bc-fact">
          <span className="small muted">Last successful backup</span>
          <b className="bc-big">{sum.lastOk ? ago(sum.lastOk.t, now) : t('none yet')}</b>
          {sum.lastOk && <span className="small muted bc-sub">{sum.lastOk.name}</span>}
        </div>
        <div className="bc-fact">
          <span className="small muted">Next backup</span>
          <b className="bc-big">{sum.next ? until(sum.next.t, now) : t('none planned')}</b>
          {sum.next && <span className="small muted bc-sub">{`${fmt(sum.next.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${sum.next.name}`}</span>}
          {!sum.next && sum.nextAny && <span className="small muted bc-sub">{t('Next restore probe {when}', { when: until(sum.nextAny.t, now) })}</span>}
          {!sum.next && <button type="button" className="btn xs bc-fact-btn" onClick={onSetup}>Set up backups</button>}
        </div>
      </div>
      {status.areas.length > 0 && (
        <div className="bc-lights" role="group" aria-label={t('Backup state per area')}>
          {status.areas.map((a) => {
            const Icon = STATE_ICON[a.state] || CircleDashed;
            return (
              <button key={a.area} type="button" className={`bc-light st-${a.state} ${open === a.area ? 'is-selected' : ''}`} aria-expanded={open === a.area} aria-controls="bc-area-detail" onClick={() => setOpen(open === a.area ? null : a.area)}>
                <Mark area={a.area} />
                <span className="bc-light-txt"><b>{t(AREA_LABEL[a.area])}</b><span className="small"><Icon className="bc-st-ico" aria-hidden="true" />{word(a)}</span></span>
              </button>
            );
          })}
        </div>
      )}
      <div id="bc-area-detail">{cur && <AreaDetail a={cur} targets={targets} byId={byId} reload={reload} />}</div>
    </section>
  );
}

/** Which tasks count as backups – automatic (kind/name) or set by hand. */
function Marks({ tasks, marks, setData }) {
  const set = async (id, value) => { try { setData(await put('/backup-calendar/marks', { id, value })); } catch (e) { toast.error(e); } };
  if (!tasks.length) return <div className="small muted">No tasks yet – create a backup under Tasks.</div>;
  return (
    <div className="stack bc-marklist">
      {tasks.map((x) => {
        const auto = L.isBackup(x, null);
        const own = typeof marks[x.id] === 'boolean';
        return (
          <div key={x.id} className="row-tight">
            <span className="grow small bc-wrap">{x.name} <span className="muted">· {x.actionLabel || (x.action && x.action.type)}</span></span>
            {own && <button type="button" className="btn ghost xs" onClick={() => set(x.id, null)}>automatic</button>}
            <Switch checked={L.isBackup(x, marks)} onChange={(v) => set(x.id, v === auto ? null : v)} label={t('“{name}” counts as a backup', { name: x.name })} />
          </div>
        );
      })}
    </div>
  );
}

function Results({ list, byId, reload }) {
  return (
    <table className="table">
      <thead><tr><th>Task</th><th>When</th><th>Result</th><th><span className="bc-sr">Actions</span></th></tr></thead>
      <tbody>{list.map((r) => (
        <tr key={r.id}>
          <td>{r.name}</td>
          <td className="muted">{fmt(r.t, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td><span className={`badge ${r.ok ? 'ok' : 'err'}`}>{r.ok ? 'successful' : 'failed'}</span>{r.rate != null && <span className="muted tiny"> {t('{n} % successful', { n: r.rate })}</span>}</td>
          <td className="bc-actions">
            <button type="button" className="btn ghost xs icon" aria-label="Open log" title="Open log" onClick={() => openLog(r.id)}><FileText /></button>
            {byId.get(r.id) && <button type="button" className="btn ghost xs icon" aria-label={r.ok ? 'Run now' : 'Run again'} title={r.ok ? 'Run now' : 'Run again'} onClick={() => runTask(byId.get(r.id), reload)}><RotateCw /></button>}
          </td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Everything that is computed from the data: schedule, month, status head, failures. */
function derive(d, month) {
  const now = Date.now();
  const { onlyBackups, days } = d.settings;
  const opts = { onlyBackups, marks: d.marks, events: d.events, plans: d.plans || [], now };
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const range = L.calendar(d.tasks, start.getTime(), days, opts);
  const g = L.monthGrid(month);
  const monthDays = L.calendar(d.tasks, g[0][0].date, g.length * 7, opts);
  // The next backup may lie beyond the visible range (weekly probes, monthly cron) – look five weeks ahead
  const sum = L.summary(L.calendar(d.tasks, start.getTime(), 35, opts), { now, events: d.events, areas: d.areas || [] });
  const status = L.areaStatus(d.areas || [], { now });
  const fails = L.failures(d.events, { now });
  const used = new Set([...range, ...monthDays].flatMap((x) => x.items.map((i) => L.areaOf(i))));
  for (const a of status.areas) used.add(a.area);
  // Nothing set up yet: no backup task, no own schedule and nothing ever backed up
  const empty = L.setupNeeded({ tasks: d.tasks, marks: d.marks, plans: d.plans || [], areas: d.areas || [], events: d.events });
  const open = (d.targets && ((d.targets.dbs || []).some((x) => !x.covered) || (d.targets.mcs || []).some((x) => !x.covered))) || false;
  return { range, monthDays, sum, status, fails, empty, open, legend: L.AREAS.filter((a) => used.has(a)), results: L.lastResults(d.tasks, { onlyBackups, marks: d.marks }), startup: L.unscheduled(d.tasks, d.marks, { onlyBackups }), byId: new Map(d.tasks.map((x) => [x.id, x])) };
}

function Calendar2({ embedded }) {
  const st = useCalendarData();
  const [view, setView] = useState('agenda');
  const [month, setMonth] = useState(() => Date.now());
  const today = L.dayKey(Date.now());
  const [selected, setSelected] = useState(today);
  const [showSetup, setShowSetup] = useState(false);
  const d = st.data;
  const x = useMemo(() => (d ? derive(d, month) : null), [d, month]);
  if (!d && st.error) return <Empty icon={CloudOff} title="Could not load the backup calendar" text={st.error} action={<Btn icon={RotateCw} onClick={() => st.reload()}>Try again</Btn>} />;
  if (!d || !x) return <Loading />;
  const sel = x.monthDays.find((y) => y.key === selected);
  const icsUrl = `${location.origin}${d.ics}`;
  const exportIcs = () => {
    const from = new Date(); from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
    const list = L.calendar(d.tasks, from.getTime(), 90, { onlyBackups: d.settings.onlyBackups, marks: d.marks, events: d.events, plans: d.plans || [], now: Date.now() });
    const blob = new Blob([L.ics(list, { name: t('Hostwerk backups') })], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hostwerk-backups.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copyLink = () => { navigator.clipboard.writeText(icsUrl).then(() => toast.success('Link copied'), () => toast.error('Could not copy')); };
  const newLink = async () => {
    if (!(await confirmDialog({ title: 'New subscription link?', text: 'Calendars that use the old link stop updating.', confirm: 'New link' }))) return;
    try { st.setData(await post('/backup-calendar/ics-token')); toast.success('New link created'); } catch (e) { toast.error(e); }
  };
  // "Share" menu under the button (also by keyboard: the menu opens at the button, not at the mouse)
  const share = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, [
      { label: t('Export (.ics)'), icon: CalendarDays, onClick: exportIcs },
      { label: t('Copy subscription link'), icon: Share2, onClick: copyLink },
      '-',
      { label: t('New subscription link …'), icon: RotateCw, onClick: newLink },
    ]);
  };
  const setup = x.empty || showSetup;
  return (
    <div className={`bc ${embedded ? 'bc-embedded' : ''}`}>
      {st.error && <Callout kind="warn" dismissible={false}>{t('Could not refresh: {error}', { error: st.error })}</Callout>}
      <Failures list={x.fails} byId={x.byId} reload={st.reload} />
      {!x.empty && <StatusHead sum={x.sum} status={x.status} targets={d.targets || {}} byId={x.byId} reload={st.reload} onSetup={() => setShowSetup(true)} />}
      {setup && <Setup targets={d.targets || {}} reload={st.reload} />}
      {!setup && x.open && (
        <div className="bc-hint small">
          <Sparkles size={14} aria-hidden="true" />
          <span className="grow">Some databases or Minecraft servers have no planned backup.</span>
          <button type="button" className="btn xs" onClick={() => setShowSetup(true)}>Show templates</button>
        </div>
      )}
      <section className="card bc-plan" aria-labelledby="bc-plan-h">
        <div className="card-head bc-plan-head">
          <CalendarDays size={16} />
          <h3 id="bc-plan-h" className="grow">{view === 'agenda' ? t('Next {n} days', { n: d.settings.days }) : t('Month')}</h3>
          <Seg value={view} onChange={setView} options={[{ id: 'agenda', label: 'Agenda' }, { id: 'month', label: 'Month' }]} />
          <Btn className="sm ghost" icon={Share2} aria-haspopup="menu" onClick={share}>Share</Btn>
          <InfoTip pop title="Share the calendar">Export saves the next weeks as a .ics file. The subscription link keeps Outlook, Google, Apple or Thunderbird up to date (“subscribe to calendar” / “add from URL”). It works on this PC – from outside only through Hostwerk’s remote access. Anyone with the link sees the names of your backup tasks.</InfoTip>
        </div>
        <div className="card-body">
          {view === 'agenda'
            ? <Agenda days={x.range} today={today} byId={x.byId} reload={st.reload} />
            : <>
                <MonthView month={month} setMonth={setMonth} days={x.monthDays} today={today} selected={selected} onSelect={setSelected} />
                {sel && (
                  <section className="bc-agday" aria-label={dayTitle(sel.date, today)}>
                    <h3 className="bc-agday-head">{dayTitle(sel.date, today)}</h3>
                    {sel.items.length ? <ul className="bc-rows">{L.collapseEvery(sel.items).map((y, i) => <Row key={`${y.t}-${i}`} x={y} task={x.byId.get(y.id)} reload={st.reload} />)}</ul> : <div className="small muted bc-none">nothing planned</div>}
                  </section>
                )}
              </>}
          <Legend areas={x.legend} />
          {x.startup.length > 0 && <div className="small muted bc-startup">{t('At every start of Hostwerk: {names}', { names: x.startup.map((y) => y.name).join(', ') })}</div>}
        </div>
      </section>
      <details className="card bc-more">
        <summary><ListChecks size={16} aria-hidden="true" /><span>Which tasks count as backups</span></summary>
        <div className="card-body">
          <p className="small muted bc-p">Hostwerk recognises backups by the kind of task (database, Minecraft, snapshot …) and by the name. Set it here by hand for tasks with other names.</p>
          <Marks tasks={d.tasks} marks={d.marks} setData={st.setData} />
        </div>
      </details>
      {x.results.length > 0 && (
        <details className="card bc-more">
          <summary><FileText size={16} aria-hidden="true" /><span>Last task results</span></summary>
          <div className="card-body"><Results list={x.results} byId={x.byId} reload={st.reload} /></div>
        </details>
      )}
    </div>
  );
}

function BackupCalendarPage() {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><Calendar /> Backup calendar</h1>
          <InfoTip title="Backup calendar">All scheduled backups – tasks, nightly backups, external backup and restore probes – and whether the last ones worked. Failures come first.</InfoTip>
        </div>
      </div>
      <Calendar2 />
    </div>
  );
}

/** Dashboard tile: next backup, the last successful one and open failures. */
function BackupTile() {
  const st = useCalendarData();
  if (!st.data && st.error) return <TileEmpty icon={CloudOff} text={t('Could not load: {error}', { error: st.error })} action={t('Try again')} onClick={() => st.reload()} />;
  if (!st.data) return <div className="card-body"><div className="hw-skeleton bc-skel" /></div>;
  const d = st.data;
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const opts = { onlyBackups: true, marks: d.marks, events: d.events, plans: d.plans || [], now };
  const sum = L.summary(L.calendar(d.tasks, start.getTime(), 35, opts), { now, events: d.events, areas: d.areas || [] });
  const bad = L.failures(d.events, { now });
  if (!sum.next && !sum.lastOk && !bad.length) return <TileEmpty icon={Calendar} text="No backup planned" href="#/ext/backup-calendar" action={t('Set up')} />;
  return (
    <a className="card-body stack bc-tile" href="#/ext/backup-calendar">
      <div className="muted small">Next backup</div>
      <div className="bc-next bc-wrap">{sum.next ? sum.next.name : t('none planned')}</div>
      {sum.next && <div className="small muted">{`${fmt(sum.next.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${until(sum.next.t, now)}`}</div>}
      {sum.lastOk && <div className="small muted">{t('Last successful backup {when}', { when: ago(sum.lastOk.t, now) })}</div>}
      {bad.length ? bad.slice(0, 3).map((r) => <div key={`${r.kind}-${r.id || r.name}`} className="small row-tight"><XCircle className="bc-st-ico bc-err-ico" aria-hidden="true" /><span className="bc-wrap">{t('{name} failed', { name: r.name })}</span></div>) : <div className="small muted row-tight"><CheckCircle2 className="bc-st-ico bc-ok-ico" aria-hidden="true" />No open failures</div>}
    </a>
  );
}

export default {
  pages: { main: BackupCalendarPage },
  slots: {
    'dashboard.tiles': [{ id: 'next', title: 'Backups', icon: Calendar, size: 'third', Component: BackupTile }],
    // Tab in Hostwerk's backup area (#/sicherungen/x-backup-calendar-calendar)
    'backups.tabs': [{ id: 'calendar', title: 'Calendar', icon: Calendar, Component: () => <Calendar2 embedded /> }],
  },
};
