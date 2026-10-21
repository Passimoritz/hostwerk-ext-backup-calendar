import { useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarDays, ChevronLeft, ChevronRight, CloudOff, Download, Link2, Play, RotateCw, FileText, ListChecks, ShieldCheck } from 'lucide-react';
import { post, put, useApi, on } from '@hostwerk/api';
import { Btn, Empty, Loading, TileEmpty, InfoTip, Seg, Switch, Callout, toast, confirmDialog } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';
import L from '../../lib/calendar.js';
import './style.css';

/*
 * Backup calendar: planned backups of the coming days (week or month view) and what happened before – task runs, external
 * and cloud backup, game server backups, restore probes. Failures open the log or run again, "Back up now" runs a backup
 * task right away, a mark per task decides what counts as a backup, the calendar can be exported or subscribed to (.ics).
 * Dates follow Hostwerk's language (document language), not the system.
 */
const locale = () => (typeof document !== 'undefined' && document.documentElement.lang) || 'en';
const fmt = (ts, o) => new Date(ts).toLocaleString(locale(), o);
const time = (ts) => fmt(ts, { hour: '2-digit', minute: '2-digit' });
const KIND = { task: 'Task', offsite: 'External backup', cloud: 'Cloud backup', game: 'Game server', probe: 'Restore probe' };
const LIVE = ['tasks', 'job', 'backups', 'restore-probe', 'cloud-backup'];

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
const openLog = (id) => { location.hash = `/aufgaben?task=${encodeURIComponent(id)}`; };

/** One entry in a day: time, name, state; failed task runs can open their log or run again. */
function Item({ x, task, reload, full }) {
  const cls = x.status === 'error' ? 'err' : x.status === 'ok' ? 'ok' : x.backup ? 'plan' : '';
  return (
    <div className={`bc-run ${cls}`}>
      <span className="mono">{time(x.t)}</span>
      <span className="ellipsis grow" title={x.error || undefined}>{x.name}{full && x.kind !== 'task' ? <span className="muted"> · {t(KIND[x.kind])}</span> : null}</span>
      {full && x.status === 'error' && task && <>
        <button type="button" className="btn ghost xs icon" aria-label="Open log" title="Open log" onClick={() => openLog(task.id)}><FileText /></button>
        <button type="button" className="btn ghost xs icon" aria-label="Run again" title="Run again" onClick={() => runTask(task, reload)}><RotateCw /></button>
      </>}
    </div>
  );
}

function DayCard({ d, today, selected, onSelect, byId, reload }) {
  const failed = d.items.some((x) => x.status === 'error');
  return (
    <button type="button" className={`card card-pad bc-day ${d.key === today ? 'is-today' : ''} ${d.items.length ? '' : 'is-free'} ${selected ? 'is-selected' : ''} ${failed ? 'has-error' : ''}`} onClick={() => onSelect(d.key)} aria-pressed={selected}>
      <div className="bc-day-head"><b>{fmt(d.date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</b>{d.key === today && <span className="badge accent">today</span>}</div>
      {d.items.length ? d.items.slice(0, 6).map((x, i) => <Item key={i} x={x} task={byId.get(x.id)} reload={reload} />) : <div className="muted tiny">nothing planned</div>}
      {d.items.length > 6 && <div className="muted tiny">{t('+{n} more', { n: d.items.length - 6 })}</div>}
    </button>
  );
}

function MonthView({ month, setMonth, days, today, selected, onSelect }) {
  const grid = L.monthGrid(month);
  const byKey = new Map(days.map((d) => [d.key, d]));
  const shift = (n) => { const d = new Date(month); d.setDate(1); d.setMonth(d.getMonth() + n); setMonth(d.getTime()); };
  const names = Array.from({ length: 7 }, (_, i) => fmt(new Date(2024, 0, 1 + i).getTime(), { weekday: 'short' })); // 1.1.2024 was a Monday
  return (
    <div className="card bc-month">
      <div className="card-head">
        <button type="button" className="btn ghost xs icon" aria-label="Previous month" title="Previous month" onClick={() => shift(-1)}><ChevronLeft /></button>
        <h3 className="grow bc-center">{fmt(month, { month: 'long', year: 'numeric' })}</h3>
        <button type="button" className="btn ghost xs icon" aria-label="Next month" title="Next month" onClick={() => shift(1)}><ChevronRight /></button>
      </div>
      <div className="bc-grid" role="grid">
        {names.map((n) => <div key={n} className="bc-dow tiny muted" role="columnheader">{n}</div>)}
        {grid.flat().map((c) => {
          const d = byKey.get(c.key);
          const items = d ? d.items : [];
          const err = items.filter((x) => x.status === 'error').length;
          const ok = items.filter((x) => x.status === 'ok').length;
          const plan = items.filter((x) => x.status === 'planned').length;
          const label = [fmt(c.date, { day: 'numeric', month: 'long' }), plan && t('{n} planned', { n: plan }), ok && t('{n} done', { n: ok }), err && t('{n} failed', { n: err })].filter(Boolean).join(', ');
          return (
            <button key={c.key} type="button" role="gridcell" aria-label={label} title={label} aria-pressed={selected === c.key} className={`bc-cell ${c.inMonth ? '' : 'is-outside'} ${c.key === today ? 'is-today' : ''} ${selected === c.key ? 'is-selected' : ''}`} onClick={() => onSelect(c.key)}>
              <span className="bc-num">{new Date(c.date).getDate()}</span>
              <span className="bc-dots" aria-hidden="true">{err > 0 && <i className="bc-dot err" />}{ok > 0 && <i className="bc-dot ok" />}{plan > 0 && <i className="bc-dot plan" />}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Results({ list, byId, reload }) {
  if (!list.length) return <Empty icon={ListChecks} title="No results yet" text="As soon as a backup task has run, its result appears here." />;
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

/** Which tasks count as backups – automatic (kind/name) or set by hand. */
function Marks({ tasks, marks, setData }) {
  const set = async (id, value) => { try { setData(await put('/backup-calendar/marks', { id, value })); } catch (e) { toast.error(e); } };
  if (!tasks.length) return <div className="small muted">No tasks yet – create a backup under Tasks.</div>;
  return (
    <div className="stack bc-marks">
      {tasks.map((x) => {
        const auto = L.isBackup(x, null);
        const own = typeof marks[x.id] === 'boolean';
        return (
          <div key={x.id} className="row-tight">
            <span className="grow ellipsis small">{x.name} <span className="muted">· {x.actionLabel || (x.action && x.action.type)}</span></span>
            {own && <button type="button" className="btn ghost xs" onClick={() => set(x.id, null)}>automatic</button>}
            <Switch checked={L.isBackup(x, marks)} onChange={(v) => set(x.id, v === auto ? null : v)} label={t('“{name}” counts as a backup', { name: x.name })} />
          </div>
        );
      })}
    </div>
  );
}

function Calendar2({ embedded }) {
  const st = useCalendarData();
  const [view, setView] = useState('week');
  const [month, setMonth] = useState(() => Date.now());
  const [selected, setSelected] = useState(null);
  const d = st.data;
  const today = L.dayKey(Date.now());
  const derived = useMemo(() => {
    if (!d) return null;
    const { onlyBackups, days } = d.settings;
    const opts = { onlyBackups, marks: d.marks, events: d.events, now: Date.now() };
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const week = L.calendar(d.tasks, start.getTime(), days, opts);
    const g = L.monthGrid(month);
    const first = g[0][0].date;
    const monthDays = L.calendar(d.tasks, first, g.length * 7, opts);
    return { week, monthDays, results: L.lastResults(d.tasks, { onlyBackups, marks: d.marks }), backups: d.tasks.filter((x) => x.enabled && L.isBackup(x, d.marks)), startup: L.unscheduled(d.tasks, d.marks, { onlyBackups }), byId: new Map(d.tasks.map((x) => [x.id, x])) };
  }, [d, month]);
  if (!d && st.error) return <Empty icon={CloudOff} title="Could not load the backup calendar" text={st.error} action={<Btn icon={RotateCw} onClick={() => st.reload()}>Try again</Btn>} />;
  if (!d || !derived) return <Loading />;
  const days = view === 'week' ? derived.week : derived.monthDays;
  const sel = selected && days.find((x) => x.key === selected);
  const total = derived.week.reduce((n, x) => n + x.items.filter((i) => i.status === 'planned').length, 0);
  const icsUrl = `${location.origin}${d.ics}`;
  const exportIcs = () => {
    const from = new Date(); from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
    const list = L.calendar(d.tasks, from.getTime(), 90, { onlyBackups: d.settings.onlyBackups, marks: d.marks, events: d.events, now: Date.now() });
    const blob = new Blob([L.ics(list, { name: t('Hostwerk backups') })], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hostwerk-backups.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copyLink = () => { navigator.clipboard.writeText(icsUrl).then(() => toast.success('Link copied'), () => toast.error('Could not copy')); };
  const newLink = async () => {
    if (!(await confirmDialog({ title: 'New subscription link?', text: 'Calendars that use the old link stop updating.', confirm: 'New link' }))) return;
    try { st.setData(await post('/backup-calendar/ics-token')); toast.success('New link created'); } catch (e) { toast.error(e); }
  };
  return (
    <div className={`bc ${embedded ? 'bc-embedded' : ''}`}>
      {d && st.error && <Callout kind="warn" dismissible={false}>{t('Could not refresh: {error}', { error: st.error })}</Callout>}
      <div className="bc-bar">
        <p className="muted grow">{total ? t('{n} runs in the next {days} days', { n: total, days: d.settings.days }) : 'No runs planned – create a backup under Tasks.'}</p>
        <Seg value={view} onChange={setView} options={[{ id: 'week', label: 'Days' }, { id: 'month', label: 'Month' }]} />
        <Btn className="sm ghost" icon={Download} onClick={exportIcs}>Export (.ics)</Btn>
        <Btn className="sm ghost" icon={Link2} onClick={copyLink}>Subscribe</Btn>
        <InfoTip title="Subscribe to the calendar">Copy the link into Outlook, Google, Apple or Thunderbird (“subscribe to calendar” / “add from URL”). It works on this PC – from outside only through Hostwerk’s remote access. Anyone with the link sees the names of your backup tasks.<div className="bc-tip-action"><button type="button" className="btn xs ghost" onClick={newLink}>New link</button></div></InfoTip>
      </div>
      {view === 'week' ? (
        <div className="bc-cal">{derived.week.map((x) => <DayCard key={x.key} d={x} today={today} selected={selected === x.key} onSelect={(k) => setSelected(selected === k ? null : k)} byId={derived.byId} reload={st.reload} />)}</div>
      ) : <MonthView month={month} setMonth={setMonth} days={derived.monthDays} today={today} selected={selected} onSelect={(k) => setSelected(selected === k ? null : k)} />}
      {sel && (
        <div className="card bc-detail">
          <div className="card-head"><CalendarDays size={16} /><h3>{fmt(sel.date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3></div>
          <div className="card-body stack">{sel.items.length ? sel.items.map((x, i) => <Item key={i} x={x} task={derived.byId.get(x.id)} reload={st.reload} full />) : <div className="small muted">nothing planned</div>}</div>
        </div>
      )}
      {derived.startup.length > 0 && <div className="small muted bc-startup">{t('At every start of Hostwerk: {names}', { names: derived.startup.map((x) => x.name).join(', ') })}</div>}
      <div className="grid grid-2 bc-lower">
        <div className="card">
          <div className="card-head"><ShieldCheck size={16} /><h3>Back up now</h3><InfoTip title="Back up now">Runs a backup task right away. Quick access from anywhere: the extension “Quick tasks”.</InfoTip></div>
          <div className="card-body stack">
            {derived.backups.length ? derived.backups.map((x) => (
              <div key={x.id} className="row-tight">
                <span className="grow ellipsis small">{x.name}</span>
                <Btn className="xs" icon={Play} busy={x.running} disabled={x.running} onClick={() => runTask(x, st.reload)}>{x.running ? 'Running …' : 'Run now'}</Btn>
              </div>
            )) : <div className="small muted">No backup task yet – create one under Tasks.</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><ListChecks size={16} /><h3>Counts as a backup</h3><InfoTip title="Counts as a backup">Hostwerk recognises backups by the kind of task (database, Minecraft, snapshot …) and by the name. Set it here by hand for tasks with other names.</InfoTip></div>
          <div className="card-body"><Marks tasks={d.tasks} marks={d.marks} setData={st.setData} /></div>
        </div>
      </div>
      <h2 className="section-title">Last results</h2>
      <Results list={derived.results} byId={derived.byId} reload={st.reload} />
    </div>
  );
}

function BackupCalendarPage() {
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><Calendar /> Backup calendar</h1>
          <p>All scheduled backups of the coming days – and whether the last ones worked. Failures come first.</p>
        </div>
      </div>
      <Calendar2 />
    </div>
  );
}

/** Dashboard tile: next backup and the last failures. */
function BackupTile() {
  const st = useCalendarData();
  if (!st.data && st.error) return <TileEmpty icon={CloudOff} text={t('Could not load: {error}', { error: st.error })} action={t('Try again')} onClick={() => st.reload()} />;
  if (!st.data) return <div className="card-body"><div className="hw-skeleton bc-skel" /></div>;
  const d = st.data;
  const n = L.nextBackup(d.tasks, Date.now(), d.marks);
  const bad = L.lastResults(d.tasks, { onlyBackups: true, marks: d.marks }).filter((r) => !r.ok);
  if (!n && !bad.length) return <TileEmpty icon={Calendar} text="No backup planned" href="#/ext/backup-calendar" action={t('Open')} />;
  return (
    <a className="card-body stack bc-tile" href="#/ext/backup-calendar">
      <div className="muted small">Next backup</div>
      <div className="bc-next ellipsis">{n ? n.name : t('none planned')}</div>
      {n && <div className="small muted">{fmt(n.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
      {bad.length ? bad.slice(0, 3).map((r) => <div key={r.id} className="small row-tight"><span className="bc-dot err" aria-hidden="true" /><span className="ellipsis">{t('{name} failed', { name: r.name })}</span></div>) : <div className="small muted row-tight"><span className="bc-dot ok" aria-hidden="true" />Last backups successful</div>}
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
