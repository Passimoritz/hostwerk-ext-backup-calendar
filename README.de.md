![Sicherungs-Kalender](banner.svg)

# Sicherungs-Kalender

Alle geplanten Sicherungen als Kalender – und was davor passiert ist. Fehlschläge stehen oben.

[English](README.md) · Offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public)-Erweiterung (native Erweiterung, ab Hostwerk 2.11)

## Was sie kann

- Tage- oder Monatsansicht mit jeder geplanten Sicherung (täglich, alle paar Minuten, Cron, nach einer anderen Aufgabe; „beim Start“ steht darunter)
- Was passiert ist: Aufgabenläufe, externe Sicherung, Cloud-Sicherung (Erweiterung „Cloud-Sicherung“), Sicherungen der Spiele-Server (Erweiterung „Spiele-Server“), Wiederherstellungs-Proben
- Fehlschläge mit „Protokoll öffnen“ und „Erneut ausführen“, „Jetzt sichern“ für jede Sicherungs-Aufgabe
- Schalter „zählt als Sicherung“ je Aufgabe – für Aufgaben, die Hostwerk nicht an Art oder Namen erkennt
- Export als `.ics` und ein geheimer Abo-Link für Kalender-Apps
- Kachel für die Übersicht und ein Reiter im Sicherungsbereich von Hostwerk

## Daten

`data/backup-calendar.json` – deine Markierungen und der Abo-Link. Der Kalender selbst kommt aus Hostwerks Aufgaben und Sicherungen.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # Prüfung wie im Katalog (sdk/check.js)
```

Logik ohne Seite in `lib/calendar.js`, Server-Teil in `server/`, Quelltext der Oberfläche in `ui/src`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
