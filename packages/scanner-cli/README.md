# sfscanner 🔍

[![npm version](https://img.shields.io/npm/v/sfscanner.svg)](https://www.npmjs.com/package/sfscanner)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/jitwark/sfscanner/blob/main/LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Package Size](https://img.shields.io/badge/unpacked-1.07%20MiB-0f766e.svg)](https://www.npmjs.com/package/sfscanner)

**Deterministic, offline security scanning for n8n workflows** — `pretty`, `markdown`, `table`, `json`, `ndjson`, or SARIF 2.1.0. Zero network calls, **1.07 MiB** unpacked, and your workflow JSON never leaves your machine.

> **Licensing:** MIT for this package's code and scanner tooling. The catalogue dataset has separate Personal / Non-Commercial terms; see https://github.com/jitwark/sfscanner/blob/main/docs/LICENSING.md.

> Released `sfscanner@0.3.0`. All four profiles — `standard@3.0.0` (default), `strict@3.0.0` (alias `ci`), `beta-default@2.0.0`, and `beta-hardened@2.0.0` — are admitted and selectable. Supply-chain opt-in reports canonical advisory state and unknown coverage when no snapshot is admitted. See the [CLI guide](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/cli-v2.md) for supported contracts and limits.
```bash
npx sfscanner scan my-workflow.json
```

> This package is the scanner. The workflow **catalogue** — 11,464 public n8n workflows, their
> provenance and how much of each one the scanner could actually read — lives on the website:
> <https://jitwark.github.io/sfscanner/>.

---

## ⚡ Quickstart

```bash
# one file, human-readable
npx sfscanner scan workflow.json
npx sfscanner scan workflow.json --format markdown

# a directory, SARIF for GitHub code scanning
npx sfscanner --schema v2 scan ./workflows --format sarif > results.sarif

# the stricter profile: same rules, tighter scoring
npx sfscanner scan workflow.json --profile strict

# pipe a workflow straight from a clipboard or curl
cat workflow.json | npx sfscanner scan -

# triage a large result set
npx sfscanner scan ./workflows --format json --min-severity HIGH --min-confidence MEDIUM

# suppress findings you have already accepted
npx sfscanner scan ./workflows --baseline prior-scan.json

# see the rules, then read one in full
npx sfscanner rules --format table
npx sfscanner explain N8N_EXECUTE_COMMAND
```

Node **20** or newer. The CLI is ESM-only and no CommonJS artifact is shipped; `require('sfscanner')` is not supported. `--schema v2` is optional and selects the same grammar the default route already uses — include it when a recorded invocation should state its grammar rather than inherit it.

---

## 🧠 Profiles

| Profile | Status | What it does |
| --- | --- | --- |
| `standard@3.0.0` | **default** | Full rule set: structural policies, taint flows, graph semantics, expression, JavaScript and Python analysis. Monotonic severity scoring. |
| `strict@3.0.0` | admitted, alias `ci` | The same rules under stricter scoring. Use it for a release gate. |
| `beta-default@2.0.0` | admitted | The v2 structural baseline, retained for parity and comparison. |
| `beta-hardened@2.0.0` | admitted, report-only | The advisory analyzers with `REPORT_ONLY` mappings: findings are visible and filterable but do not change a grade. |

Run `npx sfscanner profiles --format table` to read this from the binary rather than from this page.

---

## 🔎 What it actually checks

21 rules across four capabilities. Every row carries a severity, a confidence and a CWE: these are
deterministic pattern, dataflow and configuration matches, **not** a safety guarantee, and not a
verdict about whether a workflow is safe to run.

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

The generated reference is the authority, not this table:
[`docs/scanner/generated/rules.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/generated/rules.md).

**What "clean" means.** A `COMPLETE` result with no findings means the selected profile found no
catalogued evidence in the portion of the workflow it could analyze — not that the workflow is safe.
An unmodeled node type is reported as a catalogue-coverage fact with aggregate effect `NONE`, so it
no longer degrades the analysis: in the v0.3 corpus scan, **0** workflows were degraded solely
because an unmodeled trigger was present, down from 15,477 under `beta-default@2.0.0`.

---

## 📤 Output and exit codes

Formats: `pretty` (default on a TTY), `markdown`, `table`, `json`, `ndjson`, `sarif`. JSON is the
default for non-TTY and for metadata commands. SARIF is 2.1.0 with CWE tags and stable finding
fingerprints, so GitHub, GitLab and VS Code can read it directly.

| Exit | Meaning |
| :---: | --- |
| `0` | Clean — nothing met the `--fail-on` threshold. |
| `1` | Findings at or above `--fail-on`, or a degraded result under `--require-complete`. |
| `2` | Usage, configuration, or admission error — no machine envelope is emitted. |
| `3` | Malformed input, a failed/timed-out input, or an `INDETERMINATE` result — unless a finding at/above `--fail-on` already decided exit 1. |
| `4` | Internal error or a memory ceiling. |
| `130` | Interrupted or cancelled. |

`--fail-on <CRITICAL|HIGH|MEDIUM|LOW|INFO|NONE>` (Default: `INFO`; `NONE` exits 0 on findings).
`--min-severity`, `--min-confidence` and `--baseline` filter what is *reported* without changing the
threshold that decides the exit code — the two are deliberately separate questions.

Optional readiness assessment: `--include-readiness` (default `false`) extends `json`, `ndjson`, or `table` output with offline preflight checks (completeness status, declared credentials, integrations, and subworkflows). SARIF format combined with `--include-readiness` is rejected.

`--output` writes through a same-directory temporary file and atomically replaces the destination; a
failed write or a cancellation preserves the prior file.

### ⚙️ GitHub Actions (SARIF code scanning)

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

## 🤖 MCP server

The package ships `sfscanner-mcp` — a stdio JSON-RPC MCP server with **one** tool, `n8n_scan`. It
scans local workflow files with the same engine and returns the same structured output, so an agent
can read a workflow before it imports it.

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

`<npm-root>` is `npm root -g`. The single tool takes `inputs` (local paths; stdin `-` is refused
because the transport owns stdin), plus optional `format`, `failOn`, `profile`, `include`, `exclude`.
Invalid arguments answer JSON-RPC `-32602` without running a scan.

---

## 🛡️ Limits, honestly

- **Offline by construction.** No HTTP, DNS, socket, telemetry, or remote import. `--rules`,
  `--catalogue` and `--limits` accept only the embedded builtin authority; external rule packs are
  not admitted, and `--allow-unsigned-development-rules` is refused because it has nothing it could
  admit.
- Inputs are bounded: 1,536,000 bytes per file by default, 5,000 nodes, 10,000 edges, 10,000
  parameter leaves, a 30 s worker deadline, and a validated `--limits` document can tighten or raise
  the byte ceiling.
- The scan runs in a worker; if the worker cannot be terminated the item is reported `FAILED` rather
  than "probably fine".
- No analyzer executes the workflow. Findings are static-shape claims: evidence that a pattern
  exists, never proof that a branch runs or that an exploit succeeds.
- Node types the scanner does not model are reported as **unknown**, not as safe. Version ranges are
  matched as catalogued; there is no nearest-neighbour guess.

---

## 📚 Documentation

- [`docs/scanner/cli-v2.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/cli-v2.md) — v2/v3 admission rules and Windows example
- [`docs/scanner/generated/cli.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/generated/cli.md) — generated option, limit and exit reference
- [`docs/scanner/limitations.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/limitations.md) — what the scanner does not do
- [`docs/scanner/threat-model.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/threat-model.md) — trust boundaries
- [`docs/scanner/rule-reference.md`](https://github.com/jitwark/sfscanner/blob/main/docs/scanner/rule-reference.md) — every rule and remediation
- [`docs/LICENSING.md`](https://github.com/jitwark/sfscanner/blob/main/docs/LICENSING.md) — licence terms

---

## ⚖️ Licence

MIT for this package's code and scanner tooling. The catalogue dataset has separate Personal /
Non-Commercial terms; see https://github.com/jitwark/sfscanner/blob/main/docs/LICENSING.md.
The dataset is not shipped in this package. A finding tells you what to read before importing a
workflow; it does not make one safe.
