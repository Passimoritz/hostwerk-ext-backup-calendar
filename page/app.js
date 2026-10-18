// Backup-Kalender – Seite. Daten: Hostwerks Aufgaben (read:tasks), Logik in lib.js.
const { html, t } = Hostwerk;
const L = BackupCalendar;

async function load() {
  const settings = await Hostwerk.settings.get();
  const onlyBackups = settings.onlyBackups !== false;
  const days = Number(settings.days) || 14;
  const { list } = await Hostwerk.get('/tasks');
  const cal = L.calendar(list, Date.now(), days, { onlyBackups });
  const total = cal.reduce((n, d) => n + d.items.length, 0);
  document.getElementById('sub').textContent = total ? t('summary', { n: total, days }) : t('none');
  const today = L.dayKey(Date.now());
  Hostwerk.render('#cal', html`${cal.map((d) => html`<div class="card card-pad day ${d.key === today ? 'today' : ''} ${d.items.length ? '' : 'empty'}">
    <div class="day-head"><b>${new Date(d.date).toLocaleDateString(Hostwerk.lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', day: '2-digit', month: '2-digit' })}</b>${d.key === today ? html`<span class="badge accent">${t('today')}</span>` : ''}</div>
    ${d.items.length ? d.items.slice(0, 6).map((x) => html`<div class="run ${x.backup ? 'backup' : ''}"><span class="mono">${Hostwerk.fmt.time(x.t)}</span><span class="ellipsis">${x.name}</span></div>`) : html`<div class="muted tiny">${t('free')}</div>`}
    ${d.items.length > 6 ? html`<div class="muted tiny">${t('more', { n: d.items.length - 6 })}</div>` : ''}
  </div>`)}`);
  const res = L.lastResults(list, { onlyBackups });
  Hostwerk.render('#results', res.length ? html`<table class="table"><thead><tr><th>${t('task')}</th><th>${t('when')}</th><th>${t('result')}</th></tr></thead><tbody>${res.map((r) => html`<tr><td>${r.name}</td><td class="muted">${new Date(r.t).toLocaleString(Hostwerk.lang === 'de' ? 'de-DE' : 'en-US')}</td><td><span class="badge ${r.ok ? 'ok' : 'err'}">${t(r.ok ? 'ok' : 'failed')}</span>${r.rate != null ? html` <span class="muted tiny">${t('rate', { n: r.rate })}</span>` : ''}</td></tr>`)}</tbody></table>` : html`<div class="empty">${t('noResults')}</div>`);
}

Hostwerk.ready().then(() => { load(); setInterval(load, 60000); Hostwerk.on('settings', load); Hostwerk.on('lang', load); });
