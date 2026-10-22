## 2.1.2

- Page head like every Hostwerk page: one sentence under the title, the longer explanation behind ⓘ. / Seitenkopf wie jede Hostwerk-Seite: ein Satz unter dem Titel, die längere Erklärung hinter ⓘ.
- Area marks use the design scale instead of a fixed pixel rounding. / Bereichs-Markierungen nutzen die Design-Skala statt einer festen Pixel-Rundung.

## 2.1.1

- Lives where it belongs: Backups → Calendar – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: Sicherungen → Kalender – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

## 2.1.0

- Fixed: “No runs planned – create a backup under Tasks” appeared although backups were planned or had just run. The calendar now also plans Hostwerk’s own schedules (nightly backups of databases and Minecraft servers, external backup, restore probes), restore probes count as checks, not as backups, and the quick start only shows when nothing is set up at all. / Behoben: „Keine Termine geplant – lege unter ‚Aufgaben‘ eine Sicherung an“ stand da, obwohl Sicherungen geplant waren oder gerade gelaufen sind. Der Kalender plant jetzt auch Hostwerks eigene Zeitpläne (nächtliche Sicherungen der Datenbanken und Minecraft-Server, externe Sicherung, Wiederherstellungs-Proben), Proben zählen als Prüfung statt als Sicherung, und der Schnellstart erscheint nur, wenn wirklich nichts eingerichtet ist.
- New status head: last successful backup, next backup and one light per area (backed up, outdated, never backed up, failed, not set up); an opened area lists every database, server or source with “Back up now”. / Neuer Status-Kopf: letzte erfolgreiche Sicherung, nächste Sicherung und eine Ampel je Bereich (gesichert, veraltet, nie gesichert, fehlgeschlagen, nicht eingerichtet); ein aufgeklappter Bereich zeigt jede Datenbank, jeden Server und jede Quelle mit „Jetzt sichern“.
- Open failures at the top with “Log”, “Run again” or “Open” – also for nightly backups, external backup and probes. / Offene Fehlschläge ganz oben mit „Protokoll“, „Erneut ausführen“ oder „Öffnen“ – auch für nächtliche Sicherungen, externe Sicherung und Proben.
- Agenda instead of 14 equal tiles: empty days are folded into one line, names wrap instead of being cut off, runs every few minutes become one entry. Month view with a mark per area; colour and shape per area with a legend. / Ablauf statt 14 gleicher Kacheln: leere Tage stehen in einer Zeile, Namen brechen um statt abgeschnitten zu werden, Läufe alle paar Minuten werden ein Eintrag. Monatsansicht mit Markierung je Bereich; Farbe und Form je Bereich mit Legende.
- More history from Hostwerk’s backup centre: nightly and manual backups, project snapshots and sources of other extensions (without duplicates of task runs). / Mehr Verlauf aus Hostwerks Sicherungs-Zentrale: nächtliche und von Hand gestartete Sicherungen, Projekt-Schnappschüsse und Quellen anderer Erweiterungen (ohne doppelte Aufgabenläufe).
- Quick start instead of three empty cards: back up every database each night, Minecraft worlds daily, external backup – creates normal tasks after asking. / Schnellstart statt drei leerer Karten: alle Datenbanken jede Nacht, Minecraft-Welten täglich, externe Sicherung – legt nach Rückfrage ganz normale Aufgaben an.
- Export and subscription in one “Share” menu; explanations behind ⓘ; “counts as a backup” and the task results folded away. / Export und Abo in einem Menü „Teilen“; Erklärungen hinter ⓘ; „Zählt als Sicherung“ und die Ergebnisse der Aufgaben eingeklappt.

## 2.0.0

- Now a native extension: page, dashboard tile and a tab in Hostwerk’s backup area (Backups → Calendar), all drawn by Hostwerk; error state with “Try again”. / Jetzt eine native Erweiterung: Seite, Kachel und ein Reiter im Sicherungsbereich (Sicherungen → Kalender), alles von Hostwerk gezeichnet; Fehlerzustand mit „Erneut versuchen“.
- More sources: what happened before – task runs from the history, external backup, cloud backup, game server backups and restore probes. / Mehr Quellen: was davor passiert ist – Aufgabenläufe aus dem Verlauf, externe Sicherung, Cloud-Sicherung, Sicherungen der Spiele-Server und Wiederherstellungs-Proben.
- Every schedule kind: also cron, “after another task” and “at start”. / Alle Zeitplan-Arten: auch Cron, „nach einer anderen Aufgabe“ und „beim Start“.
- Switch “counts as a backup” per task for tasks with other names. / Schalter „zählt als Sicherung“ je Aufgabe für anders benannte Aufgaben.
- Failures can be clicked: open the log or run again; “Back up now” runs a backup task right away. / Fehlschläge sind anklickbar: Protokoll öffnen oder erneut ausführen; „Jetzt sichern“ startet eine Sicherungs-Aufgabe sofort.
- Month view with markers per day (planned, done, failed) and day details. / Monatsansicht mit Markierungen je Tag (geplant, erledigt, fehlgeschlagen) und Tagesdetails.
- Export as .ics and a secret subscription link for Outlook, Google, Apple and Thunderbird. / Export als .ics und ein geheimer Abo-Link für Outlook, Google, Apple und Thunderbird.
- German name “Sicherungs-Kalender” like Hostwerk’s area “Sicherungen”; dates in Hostwerk’s language; design scale; place in the sidebar under “System”; allowExtensions. / Deutscher Name „Sicherungs-Kalender“ passend zu Hostwerks Bereich „Sicherungen“; Datum in Hostwerk-Sprache; Design-Skala; Platz in der Seitenleiste unter „System“; allowExtensions.
- Needs Hostwerk 2.11. Release package contains everything except the repository tooling. / Braucht Hostwerk 2.11. Release-Paket enthält alles außer dem Repo-Werkzeug.

## 1.2.1

- Empty days marked with a dashed border instead of transparency – text keeps its contrast. / Leere Tage mit gestricheltem Rand statt Durchsichtigkeit – der Text bleibt kontrastreich.

## 1.2.0

- New animated icon and a banner for Hostwerk's new extension page, category “monitoring”. / Neues bewegtes Symbol und ein Banner für die neue Erweiterungsseite, Kategorie „monitoring“.

## 1.1.0

- Looks exactly like Hostwerk's own pages: uses Hostwerk's design classes (card, btn, badge …) from the SDK 2.2 design kit; Hostwerk draws the page header. / Sieht aus wie Hostwerks eigene Seiten: Hostwerks Design-Klassen aus dem Baukasten (SDK 2.2), Kopf zeichnet Hostwerk.

## 1.0.0

- First release / Erste Fassung.
