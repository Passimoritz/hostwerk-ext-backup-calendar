# Backup-Kalender

Alle geplanten Sicherungen der nächsten Tage als Kalender – und ob die letzten geklappt haben. Fehlschläge stehen oben.

Eine offizielle Erweiterung für [Hostwerk](https://github.com/Passimoritz/hostwerk-public).

## Funktionen

- Kalender der nächsten 7, 14 oder 28 Tage mit allen geplanten Sicherungen
- Letzte Ergebnisse – Fehlschläge zuerst, mit Erfolgsquote
- Kachel für die Übersicht: nächste Sicherung und letzte Fehlschläge

## Installieren

In Hostwerk: **Apps → Erweiterungen → Marktplatz** → „Backup-Kalender“ → Installieren. Updates kommen von selbst.

## Rechte

- Aufgaben lesen

Seiten laufen abgeschottet (eigener Ursprung, keine fremden Skripte); alles, was etwas ändert, fragt vorher nach.

## Entwicklung

```bash
node --test tests/*.test.js            # Tests der Logik
node pfad/zu/hostwerk-public/sdk/check.js . --strict   # dieselbe Prüfung wie der Katalog
```

Die Logik steckt in `page/lib.js` (ohne DOM, getestet), die Seite in `page/app.js`. Ein Tag `vX.Y.Z` passend zu `manifest.json` veröffentlicht ein Release; der Hostwerk-Katalog übernimmt es.

English: [README.md](README.md) · Lizenz: MIT
