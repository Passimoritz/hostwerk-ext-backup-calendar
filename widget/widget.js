// Backup-Kalender – Kachel: nächste Sicherung und letzte Fehlschläge.
const { html, t } = Hostwerk;
async function load() {
  const { list } = await Hostwerk.get('/tasks');
  const n = BackupCalendar.nextBackup(list);
  document.getElementById('next').textContent = n ? n.name : t('noneShort');
  document.getElementById('when').textContent = n ? new Date(n.t).toLocaleString(Hostwerk.lang === 'de' ? 'de-DE' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const bad = BackupCalendar.lastResults(list, { onlyBackups: true }).filter((r) => !r.ok);
  Hostwerk.render('#last', bad.length ? html`${bad.slice(0, 3).map((r) => html`<div class="hw-small"><span class="hw-dot hw-err"></span> ${r.name}</div>`)}` : html`<div class="hw-small hw-muted"><span class="hw-dot hw-ok"></span> ${t('allOk')}</div>`);
}
Hostwerk.ready().then(() => { load(); setInterval(load, 60000); });
