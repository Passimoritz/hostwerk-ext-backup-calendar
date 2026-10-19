![Backup calendar](banner.svg)

# Backup calendar

All scheduled backups of the coming days as a calendar – and whether the last ones worked. Failures come first.

An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension.

## Features

- Calendar of the next 7, 14 or 28 days with every scheduled backup
- Latest results – failures first, with success rate
- Dashboard tile: next backup and recent failures

## Install

In Hostwerk: **Apps → Extensions → Marketplace** → “Backup calendar” → Install. Updates arrive automatically.

## Permissions

- Read scheduled tasks

Pages run isolated (own origin, no external scripts); anything that changes something asks you first.

## Development

```bash
node --test tests/*.test.js            # logic tests
node path/to/hostwerk-public/sdk/check.js . --strict   # same check as the catalog
```

The logic lives in `page/lib.js` (no DOM, tested), the page in `page/app.js`. A tag `vX.Y.Z` matching `manifest.json` publishes a release; the Hostwerk catalog picks it up.

Deutsch: [README.de.md](README.de.md) · License: MIT
