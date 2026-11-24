# SecureFlow Hub 🛡️

[![npm version](https://img.shields.io/npm/v/sfscanner.svg)](https://www.npmjs.com/package/sfscanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Offline Deterministic](https://img.shields.io/badge/scanner-100%25%20offline%20%26%20deterministic-0f766e.svg)](docs/scanner/threat-model.md)

**`sfscanner` — a deterministic, offline security scanner for n8n workflows.** It ships three ways:
an analysis core, a CLI and MCP server you can run in a terminal or hand to an AI agent, and a static
workflow hub that catalogues what 18,320 scanned templates actually contain. The workflow you scan
never leaves your machine, and no scan makes a network request.

> Status: v0.3.0 lean closure — three shipped products; legacy data exports retired
> Last verified: 2026-11-24 (corpus scan, static export budget, packed CLI, doc and source gates)
> Owner: single maintainer, [@jitwark](https://github.com/jitwark) (see `GOVERNANCE.md`)
> Source of truth: `app/src/catalogue/v03-corpus-metrics.json` for every corpus figure, `docs/perf/budgets.json` for every size figure, and `docs/scanner/generated/` for the rule, limit, diagnostic and CLI reference.

**🌐 Live site & browser scanner:** [GitHub Pages](https://jitwark.github.io/sfscanner/) · [Firebase](https://n8n-enterprise-1.web.app/sfscanner/) · [npm (`sfscanner`)](https://www.npmjs.com/package/sfscanner)

---

## ✨ What this is

| Product | Package | Shape |
| --- | --- | --- |
| 🧠 Analysis core | `@hub/scanner-core` | Deterministic engine, versioned profiles, no Node built-ins. Projected into all three call sites, so the CLI, the MCP server and the browser worker run the *same* code. |
| ⌨️ CLI + MCP | `sfscanner` | Bins `sfscanner` and `sfscanner-mcp`. **1.07 MiB** unpacked. |
| 🌐 Static hub | `@hub/app` | Next.js static export: **32.16 MiB across 755 files** against a 35 MiB ceiling. |

Three properties are enforced by gates rather than promised by prose:

- 🔍 **Deterministic.** Same bytes in, same bytes out. No model in the loop, no `Date.now()` in a
  stage body, no randomised ordering feeding a hash.
- 🔒 **Offline by construction.** No HTTP, DNS, sockets, telemetry, or remote imports. Only the
  embedded built-in rules, catalogue and limits are admitted; external rule packs are refused.
- 🧾 **Honest about coverage.** A result is `COMPLETE`, `DEGRADED` or `INDETERMINATE`, and an
  indeterminate result carries no grade rather than a reassuring one.

---

## ⚡ Quickstart

```bash
# scan one workflow, human-readable
npx sfscanner scan workflow.json

# the stricter profile and a machine-readable format
npx sfscanner scan workflow.json --profile strict --format json

# a directory, SARIF for GitHub code scanning
npx sfscanner --schema v2 scan .n8n --format sarif > results.sarif

# triage: only HIGH and above, only findings you can rely on
npx sfscanner scan ./workflows --min-severity HIGH --min-confidence MEDIUM

# suppress findings you have already accepted
npx sfscanner scan ./workflows --baseline prior-scan.json

# read the rules from the binary, not from a page
npx sfscanner rules --format table
```

Node 20 or newer; the package is ESM-only. Published formats are `pretty`, `markdown`, `table`,
`json`, `ndjson` and `sarif`.

### 🤖 From an AI agent

```json
{
  "mcpServers": {
    "sfscanner": {
      "command": "node",
      "args": ["<npm-root>/sfscanner/dist/mcp.js"]
    }
  }
}
```

One tool, `n8n_scan`, over stdio. `<npm-root>` is `npm root -g`. It refuses stdin (the transport owns
it) and answers invalid arguments with `-32602` rather than guessing. Full interface:
[`packages/scanner-cli/README.md`](packages/scanner-cli/README.md).

---

## 🧭 Profiles

| Profile | Status | What it does |
| --- | --- | --- |
| `standard@3.0.0` | **default** | Full rule set: structural policies, taint flows, graph semantics, expression, JavaScript and Python analysis, with monotonic severity scoring. |
| `strict@3.0.0` | admitted, alias `ci` | The same rules under stricter scoring. Use it as a release gate. |
| `beta-default@2.0.0` | admitted | The v2 structural baseline, retained for parity and comparison. |
| `beta-hardened@2.0.0` | admitted, report-only | Advisory analyzers with `REPORT_ONLY` mappings. The findings are visible and filterable but are **not admitted** into the risk score, so a grade is identical to `beta-default`. |

`npx sfscanner profiles --format table` prints this from the binary.

---

## 📊 The v0.3 corpus scan, measured

Every figure below is read from `app/src/catalogue/v03-corpus-metrics.json`, which records one
`standard@3.0.0` pass over the deduplicated master corpus. These describe that scan — not the older
hosted pages, and not a safety verdict about anyone's automation.

| Measured | Value |
| --- | ---: |
| Templates scanned | 18,320 |
| Nodes analysed | 298,708 |
| `COMPLETE` analysis | 15,220 (83.08%) |
| `DEGRADED` analysis | 1,285 |
| `INDETERMINATE` analysis | 1,798 |
| Failed scans (reported, not hidden) | 17 |
| Degraded *solely* because a trigger was unmodeled | **0**, down from 15,477 |
| Findings raised | 63,064 |
| Templates with at least one finding | 14,037 |
| Templates graded High or Critical | 7,210 |
| Median score / p90 score | 28 / 100 |

The zero in that table is the headline. Under the v2 baseline, 15,477 templates were pushed to
`DEGRADED` simply because the catalogue did not model the trigger node they used — a coverage gap
reported as an analysis failure. v0.3 records it as a coverage fact with aggregate effect `NONE`
instead, so `DEGRADED` now means what it should: optional work was actually lost. That is why the
degraded count is worth reading.

The scanned corpus and the shipped catalogue are two different populations, and conflating them is
how a documentation figure goes wrong: the scan reads the 18,320-file deduplicated master, while the
hub publishes the 11,464 entries whose provenance and rights could be established. Neither number is
the other, and neither measures the other.

### 🎯 Where the findings are

| Rule | Severity | Templates affected |
| --- | --- | ---: |
| `N8N_CODE_NODE` | LOW | 7,513 |
| `WEBHOOK_EXPOSURE` | MEDIUM | 4,771 |
| `UNAUTHENTICATED_TRIGGER_TO_SINK` | CRITICAL | 3,319 |
| `TAINTED_AI_PROMPT` | MEDIUM | 2,655 |
| `EXPRESSION_ENV_EXPOSURE` | HIGH | 2,202 |
| `TAINTED_REQUEST_URL` | HIGH | 2,174 |

Three of the six are taint or graph findings, which is the substantive v0.3 change: the scanner now
follows untrusted input from a webhook or form trigger to the sink it reaches, instead of matching
node types in isolation. Taint flows in total affect 4,366 templates (23.83%).

### 📚 The catalogue it ships

The static hub carries 11,464 catalogued workflows: **11,464 link-only**, 11,069 official, 0
redistributable. Workflow bodies are never republished — the site serves metadata, provenance and a
reference. Details: [`docs/LICENSING.md`](docs/LICENSING.md).

---

## 📦 What changed in v0.3

- **Retired, not repaired:** the five public data export lines (Excel, SQLite, PostgreSQL, CSV and NDJSON), plus
  the 18-relation dataset ceremony and the formal 95%/90% node-modelling admission programme. Separate
  export pipelines that each needed their own qualification path were costing more than they returned.
- **Scanner core upgraded:** `standard@3.0.0` is the default and `strict@3.0.0` (`ci`) its stricter
  sibling. Scoring is monotonic, and unmodeled node types no longer degrade an analysis.
- **Export redesigned:** the per-entry `/w/<slug>/` detail route was removed in favour of a single
  client-resolved `/w/view/?id=...` route, with detail payloads, charts and previews packed into 132
  `.gzbin` buckets. The export is 32.16 MiB across 755 files, including 50 HTML documents, against a
  35 MiB budget. The budget is now `files: 1500` rather than `files: 18000`, so a return to
  per-entry pages would fail the gate instead of passing it silently.
- **Supply chain:** Next.js 16.4.6, with `npm audit --audit-level=moderate` reporting 0
  vulnerabilities.

See [`CHANGELOG.md`](CHANGELOG.md) for the full entry.

---

## 🧠 What it checks — and what it does not

21 rules across structural policies, taint integrity, graph semantics, expression security, agentic
control and JavaScript/Python analysis. Each carries a severity, a confidence and a CWE tag. The
generated reference is the authority, not any table in a README:
[`docs/scanner/generated/rules.md`](docs/scanner/generated/rules.md).

What it does **not** do:

- It is not a safety guarantee. A clean result means no catalogued evidence was found in the portion
  the profile could analyse — never that a workflow is safe to run.
- It never executes a workflow, expression, code node or command. A finding is a static-shape claim.
- It cannot see an n8n instance's credential store, its version, its deployment settings, or whether
  a shared credential is over-scoped. A single-workflow scanner structurally cannot.
- It does not check community-node reputation or maintain a known-malicious list; it has no network
  access to consult one.
- `UNKNOWN_NODE_PACKAGE` is a namespace check, not a reputation check.
- No auto-fix, no upload, no telemetry.

The honest limits are maintained in [`docs/scanner/limitations.md`](docs/scanner/limitations.md), and
the trust boundaries in [`docs/scanner/threat-model.md`](docs/scanner/threat-model.md).

---

## 🗂️ Repository layout

```
app/         the Next.js static hub: browser scanner, search worker, catalogue pages
packages/    scanner-core (the engine) and scanner-cli (the sfscanner + sfscanner-mcp package)
contracts/   versioned result, evidence, limits and diagnostic contracts
pipeline/    acquire → rights → scan → derive → export
data/        the packaged catalogue: stats, analytics, shards, indexes, manifest
scripts/     build steps, quality gates, generators, verification
docs/        architecture, scanner reference, policies, decisions
```

The static hub is `output: 'export'`: there is no server, no API route, no session and no database.
The browser scanner runs the same engine in a worker on your machine.

---

## ✅ Quality gates

Behavior that this README claims is checked by committed scripts, not by review:

```text
node scripts/check-cli-docs.mjs                  CLI documentation parity
node scripts/check-scanner-doc-claims.mjs        shipped-doc claim screening
node scripts/check-scanner-source-claims.mjs     doc links and generated-reference parity
node scripts/check-scanner-v2-docs.mjs           generated reference digests
node scripts/check-export-budget.mjs             export size budget
node scripts/check-doc-consistency.mjs           prose figures against the data
```

The export budget lives in [`docs/perf/budgets.json`](docs/perf/budgets.json) with its measurement
date and reasoning beside each number.

---

## 📚 Deep docs

- [`docs/scanner/architecture-v2.md`](docs/scanner/architecture-v2.md) — how versioned scanning works
- [`docs/scanner/cli-v2.md`](docs/scanner/cli-v2.md) — CLI admission, limits, exit codes
- [`docs/scanner/generated/cli.md`](docs/scanner/generated/cli.md) — generated option and limit reference
- [`docs/scanner/semantic-catalogue.md`](docs/scanner/semantic-catalogue.md) — modelled node types
- [`docs/scanner/limitations.md`](docs/scanner/limitations.md) — the honest limits
- [`docs/scanner/programme-status.md`](docs/scanner/programme-status.md) — delivery and coverage state
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — pipeline and site composition
- [`docs/scanner/release-runbook.md`](docs/scanner/release-runbook.md) — release procedure and non-claims

---

## ⚖️ Licence

MIT for the code and scanner tooling. The catalogue's contents are not the project's to relicense:
bodies are never redistributed, and the dataset terms are stated in
[`docs/LICENSING.md`](docs/LICENSING.md). If you are a workflow author and want an entry changed or
removed, see the contact and rights policies in [`SECURITY.md`](SECURITY.md) and
[`docs/LICENSING.md`](docs/LICENSING.md).
