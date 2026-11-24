# sfscanner 🔍

[![npm version](https://img.shields.io/npm/v/sfscanner.svg)](https://www.npmjs.com/package/sfscanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jitwark/n8n-Secureflow/blob/main/LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Package Size](https://img.shields.io/badge/unpacked-1.08%20MiB-0f766e.svg)](https://www.npmjs.com/package/sfscanner)

> **Licensing:** MIT for this package's code and scanner tooling. The catalogue dataset has separate Personal / Non-Commercial terms; see https://github.com/jitwark/n8n-Secureflow/blob/main/docs/LICENSING.md.

**Deterministic, 100% offline security & dataflow scanner for n8n workflows** — `pretty`, `markdown`, `table`, `json`, `ndjson`, or SARIF 2.1.0. Zero network calls, **1.08 MiB** unpacked, and your workflow JSON never leaves your machine.

> Released `sfscanner@0.3.1`. All four profiles — `standard@3.0.0` (default), `strict@3.0.0` (alias `ci`), `beta-default@2.0.0`, and `beta-hardened@2.0.0` — are admitted and selectable. Supply-chain opt-in reports canonical advisory state and unknown coverage when no snapshot is admitted. See the [CLI guide](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/cli-v2.md) for supported contracts and limits.

```bash
npx sfscanner scan my-workflow.json
```

> **🌐 Live Website & Browser Scanner:** Browse 11,464 community n8n workflows with interactive visual canvases, live `standard@3.0.0` security grades, and a zero-upload browser scanner at **<https://jitwark.github.io/n8n-Secureflow/>** · **GitHub:** <https://github.com/jitwark/n8n-Secureflow>

---

## ⚡ Quickstart

```bash
# One file, grouped human-readable traces and fixes
npx sfscanner scan workflow.json
npx sfscanner scan workflow.json --format markdown

# A directory, SARIF 2.1.0 for GitHub Code Scanning
npx sfscanner --schema v2 scan ./workflows --format sarif > results.sarif

# Stricter CI profile: same 21 rules, tighter scoring
npx sfscanner scan workflow.json --profile strict

# Pipe a workflow straight from clipboard or stdin
cat workflow.json | npx sfscanner scan -

# Triage large result sets or suppress accepted baseline findings
npx sfscanner scan ./workflows --format json --min-severity HIGH --min-confidence MEDIUM
npx sfscanner scan ./workflows --baseline prior-scan.json

# Inspect rules directly from the offline binary
npx sfscanner rules --format table
npx sfscanner explain N8N_EXECUTE_COMMAND
```

Node **20** or newer. The CLI is ESM-only and no CommonJS artifact is shipped (`require('sfscanner')` is not supported). `--schema v2` is optional and selects the same versioned grammar the default route uses.

---

## 🧠 Profiles

| Profile | Status | What it does |
| --- | --- | --- |
| `standard@3.0.0` | **default** | Full 21-rule suite: structural policies, cross-node taint flows, graph semantics, expression, JavaScript, Python, and AI agent analysis with monotonic severity scoring. |
| `strict@3.0.0` | admitted, alias `ci` | Same rules under stricter scoring thresholds — built for CI release gates. |
| `beta-default@2.0.0` | admitted | v2 structural baseline retained for parity and comparison. |
| `beta-hardened@2.0.0` | admitted, report-only | Advisory analyzers with `REPORT_ONLY` mappings: findings are visible and filterable without changing the legacy grade. |

Run `npx sfscanner profiles --format table` to read this directly from the binary.

---

## 🔎 What It Catches (21 Deterministic Rules)

Every finding carries a severity, confidence, CWE tag, node location, taint trace (where applicable), plain-English **Why**, and concrete **Fix** guidance:

| Rule | Severity | Confidence | CWE |
| --- | --- | --- | --- |
| `N8N_EXECUTE_COMMAND` | CRITICAL | HIGH | CWE-78 |
| `UNAUTHENTICATED_TRIGGER_TO_SINK` | CRITICAL | HIGH | CWE-306 |
| `TAINTED_COMMAND` | CRITICAL | MEDIUM | CWE-78 |
| `EXPRESSION_SANDBOX_ESCAPE` | CRITICAL | HIGH | CWE-94 |
| `RAW_AUTH_HEADER` | HIGH | MEDIUM | CWE-798, CWE-522 |
| `RAW_SECRET_INDICATOR` | HIGH | MEDIUM | CWE-798 |
| `EXPRESSION_ENV_EXPOSURE` | HIGH | HIGH | CWE-200 |
| `JAVASCRIPT_DYNAMIC_EXECUTION` | HIGH | HIGH | CWE-95 |
| `PYTHON_DYNAMIC_EXECUTION` | HIGH | MEDIUM | CWE-95 |
| `TAINTED_REQUEST_URL` | HIGH | MEDIUM | CWE-918 |
| `TAINTED_FILE_PATH` | HIGH | MEDIUM | CWE-22 |
| `TAINTED_SQL_QUERY` | HIGH | MEDIUM | CWE-89 |
| `TAINTED_CODE_INPUT` | HIGH | MEDIUM | CWE-94 |
| `AGENT_EGRESS_UNRESTRICTED` | HIGH | MEDIUM | CWE-918 |
| `WEBHOOK_EXPOSURE` | MEDIUM | MEDIUM | CWE-306 |
| `UNAPPROVED_DOMAIN` | MEDIUM | HIGH | — |
| `AI_AGENT_UNGATED_TOOL` | MEDIUM | LOW | CWE-269 |
| `TAINTED_AI_PROMPT` | MEDIUM | LOW | CWE-77 |
| `TAINTED_REQUEST_HEADER` | MEDIUM | MEDIUM | CWE-113 |
| `N8N_CODE_NODE` | LOW | HIGH | CWE-94 |
| `UNKNOWN_NODE_PACKAGE` | LOW | MEDIUM | CWE-1357 |

Full generated authority: [`docs/scanner/generated/rules.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/generated/rules.md).

---

## 📤 Output, Exit Codes & GitHub Actions

Formats: `pretty` (default on TTY), `markdown`, `table`, `json` (default for non-TTY), `ndjson`, `sarif`.

| Exit | Meaning |
| :---: | --- |
| `0` | Clean — nothing met `--fail-on`. |
| `1` | Findings at or above `--fail-on`, or a degraded result under `--require-complete`. |
| `2` | Usage, configuration, or admission error. |
| `3` | Malformed, failed, timed-out, or `INDETERMINATE` input. |
| `4` | Internal error or memory ceiling. |
| `130` | Interrupted or cancelled. |

`--fail-on <CRITICAL|HIGH|MEDIUM|LOW|INFO|NONE>` (Default: `INFO`; `NONE` exits 0 on findings). `--min-severity`, `--min-confidence`, and `--baseline` filter reported findings without changing `--fail-on`. Optional `--include-readiness` adds offline preflight checks to `json`, `ndjson`, or `table`. `--output` writes atomically via a same-directory temp file.

### ⚙️ GitHub Actions (SARIF Code Scanning)

```yaml
- name: Scan n8n workflows
  run: npx sfscanner --schema v2 scan ./workflows --profile strict --format sarif --output results.sarif --fail-on HIGH
- name: Upload SARIF
  if: always()
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

---

## 🤖 Offline MCP Server (`sfscanner-mcp`)

Ships `sfscanner-mcp`, a stdio JSON-RPC MCP server exposing `n8n_scan` so AI coding agents can scan local workflows before importing them:

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

`<npm-root>` is `npm root -g`. Accepts local file/directory `inputs` (stdin `-` is refused) plus optional `format`, `failOn`, `profile`, `include`, `exclude`. Invalid arguments return JSON-RPC `-32602`.

---

## 🛡️ Built-In Offline Boundaries

- **Zero network:** No HTTP, DNS, sockets, telemetry, or remote imports. `--rules`, `--catalogue`, and `--limits` accept only the embedded built-in authority (`--allow-unsigned-development-rules` is refused).
- **Bounded resources:** 1,536,000 bytes/file default, 5,000 nodes, 10,000 edges, 30s worker deadline.
- **Static & advisory:** Never executes workflow code; unmodeled node types are reported honestly as coverage facts rather than falsely degrading the scan.

---

## 📚 Documentation & Licence

- [`docs/scanner/cli-v2.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/cli-v2.md) · [`docs/scanner/generated/cli.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/generated/cli.md) · [`docs/scanner/limitations.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/limitations.md) · [`docs/scanner/threat-model.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/scanner/threat-model.md) · [`docs/LICENSING.md`](https://github.com/jitwark/n8n-Secureflow/blob/main/docs/LICENSING.md)

MIT for this package's code and scanner tooling. The catalogue dataset has separate Personal / Non-Commercial terms and is not shipped in this package.
