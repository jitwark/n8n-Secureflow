# n8n-Secureflow 🛡️

[![npm version](https://img.shields.io/npm/v/sfscanner.svg)](https://www.npmjs.com/package/sfscanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Offline Deterministic](https://img.shields.io/badge/scanner-100%25%20offline%20%26%20deterministic-0f766e.svg)](docs/scanner/threat-model.md)

**`sfscanner` — a deterministic, 100% offline security scanner and interactive community workflow hub for n8n.**
Audit any n8n workflow JSON before you import or deploy it — in your browser, terminal, CI/CD pipeline, or AI coding agent — with zero uploads, zero accounts, and zero telemetry.

> Status: v0.3.1 — live `standard@3.0.0` catalogue, auto-loaded workflow canvases, and `sfscanner` on npm
> Last verified: 2026-11-24 (corpus rescan, static export budget, packed CLI contract, doc and source gates)
> Owner: single maintainer, [@jitwark](https://github.com/jitwark) (see `GOVERNANCE.md`)
> Source of truth: `app/src/catalogue/v03-corpus-metrics.json` for corpus benchmark figures, `data/analytics.json` for catalogue analytics, `docs/perf/budgets.json` for size budgets, and `docs/scanner/generated/` for generated rule/CLI references.

**🌐 Live Website & Browser Scanner:** [jitwark.github.io/n8n-Secureflow](https://jitwark.github.io/n8n-Secureflow/) · **📦 npm Package:** [npmjs.com/package/sfscanner](https://www.npmjs.com/package/sfscanner)

---

## 🌐 Explore the Website & Workflow Hub

You don't need to install anything to benefit from n8n-Secureflow. Visit **[jitwark.github.io/n8n-Secureflow](https://jitwark.github.io/n8n-Secureflow/)** for:

- **🔎 Instant Community Library (`/library/`):** Browse **11,245 searchable** community n8n workflows (`11,464` catalogued, strictly link-only) with fast direct-first search and filters for **integration** (OpenAI, Gmail, Slack, Google Sheets, Postgres, etc.), **trigger type**, **complexity**, and **live `standard@3.0.0` security grade**.
- **🗺️ Auto-Loaded Interactive Workflow Canvas (`/w/view/?id=...`):** Open any workflow page to inspect its live node-and-edge graph immediately — zoom, pan, fit-to-screen, jump to the trigger, toggle sticky notes, and click any node to inspect its connections without importing anything into n8n.
- **📝 Plain-English Workflow Pages:** Every workflow page gives normal users a readable summary of what the automation does, its integrations, complexity, and live `standard@3.0.0` security findings with clear **Why it matters** and **How to fix it** guidance, plus a verified permalink back to the original upstream source.
- **🛡️ Zero-Upload Browser Scanner (`/scanner/`):** Paste or drag-and-drop your own n8n workflow JSON to run the full `v0.3` engine locally inside a browser Web Worker — your workflow never leaves your device.
- **📊 Live Corpus Analytics (`/analytics/`):** Explore real breakdowns of triggers, top integrations, workflow size distributions, and live `standard@3.0.0` security risk grades across the entire catalogue.
- **⚡ Lightweight & Private:** Pure static site (**33.36 MiB** across 755 files using SHA-256-verified `.gzbin` buckets), dark/light themes, mobile-ready, zero cookies, and zero tracking.

---

## ✨ Three Products, One Shared Engine

| Product | Package | What You Get |
| --- | --- | --- |
| 🧠 Analysis core | `@hub/scanner-core` | Pure TypeScript deterministic engine with zero Node built-ins — identical results in browser, CLI, CI, and MCP. |
| ⌨️ CLI + MCP | `sfscanner` | `sfscanner` & `sfscanner-mcp` binaries on npm. **1.08 MiB** unpacked, 0 moderate+ audit vulnerabilities. |
| 🌐 Static hub | `@hub/app` | Fast Next.js static export (**33.36 MiB** across 755 files against a 35 MiB ceiling) with browser scanner + interactive canvases. |

---

## ⚡ Quickstart (CLI, CI & AI Agents)

```bash
# Scan one workflow locally with grouped, human-readable traces and fixes
npx sfscanner scan workflow.json

# Run the stricter release-gate profile and emit JSON or Markdown (great for PR comments)
npx sfscanner scan workflow.json --profile strict --format markdown

# Scan a directory and output SARIF 2.1.0 for GitHub Code Scanning
npx sfscanner --schema v2 scan .n8n --format sarif > results.sarif

# Triage large folders: filter by severity/confidence or suppress accepted baseline findings
npx sfscanner --schema v2 scan ./workflows --min-severity HIGH --min-confidence MEDIUM --baseline prior-scan.json

# Inspect all built-in rules directly from the binary
npx sfscanner rules --format table
npx sfscanner explain UNAUTHENTICATED_TRIGGER_TO_SINK
```

Node 20+ (ESM-only). Supported formats: `pretty` (default on TTY), `markdown`, `table`, `json`, `ndjson`, and `sarif`.

### 🤖 Use Offline from an AI Coding Agent (MCP)

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

Exposes `n8n_scan` over stdio so AI agents can audit local workflow JSON files before importing or editing them. Full CLI & MCP reference: [`packages/scanner-cli/README.md`](packages/scanner-cli/README.md).

---

## 🛡️ Why SecureFlow — What It Catches (and Its Honest Scope)

Most n8n security reviews either miss multi-node attack paths or rely on slow, non-deterministic LLM guesses that leak your private workflows to third-party APIs. **n8n-Secureflow solves both problems:**

### ✅ Key Capabilities & Real-World Perks

- **🔗 Cross-Node Taint & Attack-Path Tracing:** Follows untrusted input from webhooks, forms, chat, email, and external triggers all the way into privileged sinks (`Execute Command`, SQL queries, dynamic HTTP URLs/headers, file writes, Code nodes, and AI prompts) — reporting the exact hop-by-hop trace (e.g., `Webhook -> Set -> Exec`).
- **🚨 Unauthenticated Trigger-to-Sink Detection:** Automatically flags public webhooks, forms, or chat triggers that can invoke shell commands, SQL, code execution, or AI agent tools without authentication or a human-approval gate (`UNAUTHENTICATED_TRIGGER_TO_SINK`).
- **🤖 Modern AI Agent & LLM Guardrails:** Catches ungated AI agent tools (`AI_AGENT_UNGATED_TOOL`), prompt injection paths (`TAINTED_AI_PROMPT`), and unrestricted AI HTTP egress (`AGENT_EGRESS_UNRESTRICTED`).
- **🧪 Deep Expression, JavaScript & Python Inspection:** Parses n8n `{{ ... }}` expressions, JS AST, and Python CST to detect sandbox escapes (`EXPRESSION_SANDBOX_ESCAPE`), direct `$env` / `$secrets` leaks (`EXPRESSION_ENV_EXPOSURE`), and dynamic execution (`eval`, `Function`, `exec`, `os.environ`).
- **📈 Monotonic, Trustworthy Grading:** Adding a severe finding can never accidentally lower a workflow's risk score, and any `CRITICAL` finding guarantees a `CRITICAL` grade.
- **🔇 Zero False `DEGRADED` Noise:** Unmodeled community/long-tail nodes are reported cleanly as coverage facts instead of breaking the scan — eliminating **15,477** false `DEGRADED` warnings from v0.2.
- **🔒 100% Offline, Deterministic & Actionable:** Same bytes in, same bytes out. Every finding carries a CWE tag, confidence level, exact node location, plain-English **Why**, and concrete **Fix** steps — with zero network requests and zero credential leaks.
- **🧰 Built for Real Workflows:** Supports `--baseline` suppression, `--approved-domain` allowlists, atomic `--output` writes, SARIF 2.1.0 for GitHub Code Scanning, and `sfscanner-mcp` for AI agents.

Browse all 21 rules in [`docs/scanner/generated/rules.md`](docs/scanner/generated/rules.md).

### 🧭 Honest Static-Analysis Scope

Because `sfscanner` is deliberately **offline and static**, three boundaries apply by design:
- **Advisory triage, not a runtime proof:** It never executes workflows and cannot see your live n8n instance's credential scopes, VPN/reverse-proxy firewall, or runtime RBAC.
- **Offline namespace checks only:** `UNKNOWN_NODE_PACKAGE` flags non-official namespaces rather than querying a live reputation feed.
- **Read-only by design:** No auto-rewriting of your workflows, no telemetry, and no external rule packs.

Full details live in [`docs/scanner/limitations.md`](docs/scanner/limitations.md) and [`docs/scanner/threat-model.md`](docs/scanner/threat-model.md).

---

## 🧭 Profiles

| Profile | Status | What it does |
| --- | --- | --- |
| `standard@3.0.0` | **default** | Full 21-rule suite: structural policies, taint flows, graph semantics, expression, JavaScript, Python, and AI agent analysis with monotonic scoring. |
| `strict@3.0.0` | admitted, alias `ci` | Same 21 rules under stricter scoring thresholds — ideal for CI release gates. |
| `beta-default@2.0.0` | admitted | v2 structural baseline retained for parity and comparison. |
| `beta-hardened@2.0.0` | admitted, report-only | Advisory analyzers with `REPORT_ONLY` mappings — findings are visible and filterable but are **not admitted** into the risk score. |

---

## 📊 Real-World Findings: v0.3 Corpus Benchmark

Measured from `app/src/catalogue/v03-corpus-metrics.json` (`standard@3.0.0` across the 18,320-template deduplicated master corpus):

| Measured | Value |
| --- | ---: |
| Templates scanned | 18,320 |
| Nodes analysed | 298,708 |
| `COMPLETE` analysis | 15,220 (83.08%) |
| `DEGRADED` analysis | 1,285 (7.01%) |
| `INDETERMINATE` analysis | 1,798 (9.81%) |
| Degraded *solely* for an unmodeled trigger | **0** (down from 15,477) |
| Total findings raised | 63,064 across 14,037 templates |
| Templates graded High or Critical | 7,210 (39.36%) |

### 🎯 Top Rules Triggered

| Rule | Severity | Templates affected |
| --- | --- | ---: |
| `N8N_CODE_NODE` | LOW | 7,513 |
| `WEBHOOK_EXPOSURE` | MEDIUM | 4,771 |
| `UNAUTHENTICATED_TRIGGER_TO_SINK` | CRITICAL | 3,319 |
| `TAINTED_AI_PROMPT` | MEDIUM | 2,655 |
| `EXPRESSION_ENV_EXPOSURE` | HIGH | 2,202 |
| `TAINTED_REQUEST_URL` | HIGH | 2,174 |

### 📚 Shipped Catalogue Population

The static hub publishes **11,464** verified entries (**11,245 searchable**, **11,464 link-only**, **11,069 official**, **0 redistributable**). No workflow JSON bodies are hosted or redistributed — every entry links back to its upstream source ([`docs/LICENSING.md`](docs/LICENSING.md)).

---

## 🗂️ Repository Layout & Quality Gates

```text
app/         Next.js static hub: browser scanner, search worker, auto-loaded canvas, catalogue pages
packages/    scanner-core (pure engine) and scanner-cli (sfscanner + sfscanner-mcp npm package)
contracts/   versioned result, evidence, limits, and diagnostic contracts
pipeline/    acquire → rights → scan → derive → export
data/        packaged catalogue: stats, analytics, shards, indexes, manifest
scripts/     build pipeline, quality gates, generators, packed CLI verification
docs/        architecture, scanner reference, policies, decisions
```

Key verification gates:
```text
node scripts/check-cli-docs.mjs                  CLI documentation parity
node scripts/check-scanner-doc-claims.mjs        shipped-doc claim screening
node scripts/check-scanner-source-claims.mjs     doc links and generated-reference parity
node scripts/check-scanner-v2-docs.mjs           generated reference digests
node scripts/check-export-budget.mjs             static export size budget (< 35 MiB)
node scripts/check-doc-consistency.mjs           prose figures against committed data
node scripts/verify-packed-cli.mjs               packed npm tarball & offline isolation contract
```

---

## ⚖️ Licence

MIT for the code and scanner tooling. The catalogue dataset carries separate Personal / Non-Commercial terms and never redistributes workflow bodies — see [`docs/LICENSING.md`](docs/LICENSING.md). Workflow authors requesting corrections or removals can use the [Removal requests page](https://jitwark.github.io/n8n-Secureflow/takedown/) or [`SECURITY.md`](SECURITY.md).
