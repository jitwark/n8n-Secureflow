# Documentation index

> Status: current for the v0.3.0 lean closure
> Last verified: 2026-11-24
> Owner: single maintainer, @jitwark
> Source of truth: `STATUS.md` for current measured state, `docs/scanner/programme-status.md` for scanner delivery evidence

This index covers the documentation for the shipped `v0.3.0` product: the `@hub/scanner-core`
analysis core, the `sfscanner` CLI and `sfscanner-mcp` server, and the static workflow hub.
Current measured figures — corpus size, scan results, export footprint — belong to `STATUS.md`
and are bound to `data/stats.json`, `data/analytics.json`, and
`app/src/catalogue/v03-corpus-metrics.json`. Dated design documents describe their named
revisions and are not current claims.

## Start here

- [Project status](../STATUS.md): current measured state, bound to the data files.
- [Current plan](../PLAN.md): the v0.3 plan of record and its standing constraints.
- [Architecture](ARCHITECTURE.md): the static export and browser-local scanning model.
- [Scanner documentation](scanner/README.md): versioned contracts and technical references.
- [CLI guide](CLI.md): the published package, profiles, and supported commands.
- [Content contract](CONTENT-CONTRACT.md) and [security](SECURITY.md): provenance, rights, and
  trust boundaries.
- [Data availability](DATA-AVAILABILITY.md): what the site serves versus what is downloadable.
- [Printer-friendly policies](privacy.md), [sources](sources.md), [takedown](takedown.md).
- [Search quality](SEARCH-QUALITY.md): how query precision is defined and measured.
- [Performance budgets](perf/budgets.json): the byte and file ceilings the build enforces.

## What this documentation will not tell you

The catalogue is strictly link-only: no third-party workflow body is redistributed, so there is
nothing here that promises a bulk download of workflow bodies. Excel, SQLite, PostgreSQL, CSV,
and NDJSON public data exports were retired in v0.3 and have no replacement surface. Where a
retired export appears in a dated document, the document is recording history rather than
promising a format.

## Maintenance

`docs/DOCUMENTATION-MAINTENANCE.md` states how these documents are kept honest, and
`npm run check:docs` enforces the mechanical part of it: every prose figure that makes a corpus
claim is checked against the data files, every backticked source path must resolve, and every
local link must exist. A document that quotes a figure without a gate behind it should quote the
date and the command that produced the figure instead.

Private execution, audit, and recovery records are kept outside this index and outside this
repository.
