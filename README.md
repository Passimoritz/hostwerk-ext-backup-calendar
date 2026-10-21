![Backup calendar](banner.svg)

# Backup calendar

All planned backups as a calendar – and what happened before. Failures come first.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (native extension, Hostwerk 2.11 or newer)

## What it does

- Days or month view with every planned backup (daily, every few minutes, cron, after another task; “at start” is listed below)
- What happened: task runs, external backup, cloud backup (extension “Cloud backup”), game server backups (extension “Game servers”), restore probes
- Failures with “Open log” and “Run again”, “Back up now” for every backup task
- Switch “counts as a backup” per task – for tasks Hostwerk does not recognise by kind or name
- Export as `.ics` and a secret subscription link for calendar apps
- Dashboard tile and a tab in Hostwerk’s backup area

## Data

`data/backup-calendar.json` – your marks and the subscription link. The calendar itself comes from Hostwerk’s tasks and backups.

## Develop

```bash
node --test tests/*.test.js          # tests
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Logic without a page in `lib/calendar.js`, server part in `server/`, interface source in `ui/src`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
