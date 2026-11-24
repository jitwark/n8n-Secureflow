# Offline scanner CLI

> Status: published `sfscanner@0.3.0`; the workspace adapter below routes to the versioned v2/v3 grammar
> Last verified: 2026-11-24
> Owner: n8n-Secureflow Community Maintainers
> Source of truth: `packages/scanner-cli/`, its `src/v2/help.ts` help authority, and `pipeline/cli/` for the workspace adapter

Install the published command with `npm install -g sfscanner@0.3.0`. See the
[package usage guide](../packages/scanner-cli/README.md) for the installed CLI/MCP interface and
[programme status](scanner/programme-status.md) for the release and coverage limits. The workspace
commands below remain the local adapter reference; they do not require a new npm publication.

The CLI runs the deterministic scanner locally. It does not upload workflow content or make a
network request during a scan. It accepts JSON files, recursive directories, or stdin and uses the
same parser, limits, and scanner result schema as the browser worker.

## Examples

The installed package is the command you want: `sfscanner`. The examples below use it directly.

```powershell
sfscanner scan workflow.json --format json
sfscanner --schema v2 scan workflows --format sarif --fail-on HIGH
Get-Content workflow.json -Raw | sfscanner scan - --format pretty
sfscanner scan workflow.json --profile strict
sfscanner rules
sfscanner explain N8N_EXECUTE_COMMAND
sfscanner version --format json
sfscanner --help
sfscanner --version
```

To run the same entry point from this checkout without installing anything, call the local adapter
directly. There is no `npm run scan:cli` alias; the script is `pipeline/cli/n8n-scan.ts`.

```powershell
npx tsx pipeline/cli/n8n-scan.ts scan workflow.json --format table
npx tsx pipeline/cli/n8n-scan.ts rules --format table
```

`pipeline/cli/n8n-scan.ts` is the workspace adapter. Everything after the script path is passed to
the CLI unchanged, so the options below apply identically to both forms.

## Surface parity marker

The compatibility vocabulary below is checked against the local `--help`, `scan --help`, the version
document the CLI emits, and the exit-code definitions by `scripts/check-cli-docs.mjs`. Keep it aligned
when the adapter changes; this is a documentation check, not a claim that the adapter is already a
standalone package.

The default entry point routes to the versioned **v2/v3** grammar, so every option the v2 parser
accepts is supported here by default. `--schema v2` is optional and selects the same grammar
explicitly; the marker exists so a recorded invocation states its grammar rather than inheriting it.

<!-- cli-docs:surface -->
### Commands

| Command | Meaning |
| --- | --- |
| `scan` | Scan workflow JSON from files, directories, or stdin. |
| `rules` | List scanner rules. |
| `explain` | Explain one scanner rule. |
| `version` | Print CLI and scanner versions. |

### Options

| Option | Meaning |
| --- | --- |
| `--help` | Show deterministic help for the selected command. |
| `--version` | Print the CLI version. |
| `--schema` | Select the versioned v2 grammar explicitly; it is the default route. |
| `--format` | Select `pretty`, `markdown`, `table`, `json`, `ndjson`, or `sarif` output. |
| `--output` | Write output atomically to a local path, or `-` for stdout. |
| `--profile` | Select an admitted profile: `standard` (default), `strict`/`ci`, `beta-default`, or `beta-hardened`. |
| `--fail-on` | Set the finding severity threshold; default `INFO`. |
| `--min-severity` | Filter reported findings to this severity or higher. |
| `--min-confidence` | Filter reported findings to this confidence or higher. |
| `--baseline` | Suppress finding IDs present in a prior JSON scan or baseline file. |
| `--require-complete` | Treat degraded analysis as a failure. |
| `--audit-supply-chain` | Emit canonical advisory status and request metadata; offline, with no admitted snapshot. |
| `--include-readiness` | Include the preflight readiness assessment in `json`, `ndjson`, or `table` output. |
| `--max-concurrency` | Bound concurrent inputs (1-16). |
| `--concurrency` | Equivalent spelling for max-concurrency. |
| `--timeout` | Set the hard per-scan limit in milliseconds (1-2147483647, `setTimeout`'s safe range). |
| `--config` | Load one explicit versioned config file. |
| `--rules` | Select the embedded built-in ruleset; the only admitted authority. |
| `--catalogue` | Select the embedded semantic catalogue. |
| `--limits` | Select embedded or local scanner limits. |
| `--target` | Load a local target context. |
| `--n8n-version` | Set the n8n version fact. |
| `--edition` | Set the deployment edition fact. |
| `--deployment` | Set the deployment fact. |
| `--role` | Set the operator role fact. |
| `--task-runner` | Set the task-runner fact. |
| `--community-package` | Record a community package in target context; repeatable. |
| `--configuration` | Record a configuration fact; repeatable. |
| `--approved-domain` | Allow a domain for `UNAPPROVED_DOMAIN`; repeat for multiple domains. |
| `--include` | Replace includes with a case-sensitive POSIX glob; repeatable. |
| `--exclude` | Replace excludes with a case-sensitive POSIX glob; repeatable. |
| `--allow-unsigned-development-rules` | Refused: external rule packs are not admitted, so no pack can be selected. |
| `--no-color` | Disable color in human-readable output. |
| `--json` | Emit machine-readable version metadata. |

### Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Scan completed under the threshold. |
| `1` | Findings meet `--fail-on`, or `--require-complete` rejected degraded analysis. |
| `2` | Usage or configuration failure. |
| `3` | Input or indeterminate scan failure. |
| `4` | Internal failure. |
| `130` | Interruption or cancellation. |
<!-- /cli-docs:surface -->

`--output report.json` writes through a temporary file and refuses to overwrite an input. JSON and
SARIF remain parseable when one file in a batch is malformed, oversized, or otherwise indeterminate;
diagnostics are represented in the result document or written to stderr. Results are sorted by
normalized path regardless of `--max-concurrency`.

`--help` prints the general command reference; `scan --help` prints the scan options. `--version`
prints the human-readable one-line version, while `version` emits the stable machine-readable
version document and `version --format table` emits the readable one. The current entry point
routes `version`, `rules`, and `explain` through the versioned grammar, which takes
`--format json|table`; the `version --json` spelling is still defined by the v1 command contract
below but is rejected with exit code 2 today.

Exit codes are stable: `0` means complete under the threshold, `1` means findings meet `--fail-on`
or `--require-complete` rejected a degraded analysis, `2` means usage/configuration failure, `3`
means an input or indeterminate scan, `4` means an internal failure, and `130` is reserved for
interruption.

## Profiles, limits, and scoring

`standard@3.0.0` is the default profile. `strict@3.0.0` is its stricter sibling, and `ci` is an
accepted alias for it: `standard@3.0.0 (default), strict@3.0.0 (alias: ci), beta-default@2.0.0, and
beta-hardened@2.0.0 are admitted and selectable.` `beta-default@2.0.0` applies the reviewed
structural policies used for the ordinary risk grade and is retained for parity; `beta-hardened@2.0.0`
adds the advisory source-span, JavaScript, Python, taint, and AI capability analyzers and is admitted
but report-only, so its findings do not silently change the legacy score. A profile is a policy
choice, not a promise that a workflow is safe.

Severity scoring in `standard@3.0.0` and `strict@3.0.0` is monotonic: adding a finding never lowers
the score. Unmodelled node types are recorded as catalogue coverage facts rather than as
`DEGRADED` analysis, so a workflow built entirely from node types the catalogue does not model
reports `COMPLETE`; degradation is reserved for genuinely lost optional work.

The shared scanner contract bounds one input at 1,536,000 UTF-8 bytes, 5,000 nodes, 10,000 graph
edges, depth 64 for connections and parameters, and 10,000 parameter leaves. The default worker
deadline is 30,000 ms; `--timeout` can impose a stricter per-input CLI deadline, up to
2,147,483,647 ms (`setTimeout`'s safe maximum — a larger value is rejected at parse time rather than
silently clamped to an effectively instant timeout). `--max-concurrency` is bounded separately, from
1 to 16. The code-analyzer definition caps each source at 100,000 bytes and ten findings. When a
limit is reached in a shipped path, the result carries an indeterminate/degraded diagnostic rather
than pretending that the scan was complete.

The grade is a triage signal. Severity weights are CRITICAL 55, HIGH 35, MEDIUM 18, LOW 6, and
INFO 1; repeated instances of the same policy are discounted, workflow size can add up to 20
points, and the total is capped at 100. `--fail-on HIGH` means "exit 1 when a HIGH or CRITICAL
finding is present"; it does not convert the report into a security certification.

## Output and CI examples

JSON uses the versioned `n8n-scan` envelope. SARIF uses SARIF 2.1.0 with deterministic rule
and result ordering. v1 attaches a physical location with a span when a node span exists and omits
the location otherwise; v2 emits physical locations when the subject has a span.
Validate locations with your SARIF consumer before enabling code-scanning upload; an upload without
resolvable physical locations is not a compatibility claim. Validate or archive the output as an
artifact rather than parsing table output:

```powershell
sfscanner scan workflow.json --format json --output scan.json --fail-on HIGH
if ($LASTEXITCODE -eq 1) { Write-Error 'Scanner threshold reached'; exit 1 }
if ($LASTEXITCODE -ge 2) { Write-Error 'Scanner could not produce a complete result'; exit $LASTEXITCODE }
```

For SARIF consumers:

```powershell
sfscanner --schema v2 scan workflows --format sarif --output scan.sarif --no-color
```

Versioned schema artifacts are committed under `pipeline/cli/schemas/`: `scanner-cli-v1.schema.json`
describes the JSON envelope and `emitted-sarif-2.1.0-profile.schema.json` describes the narrow SARIF
shape emitted by this adapter. Both are self-contained Draft 2020-12 documents with local `$ref`
links. The local contract validator remains the fail-closed runtime compatibility reference: it
checks required fields, outcome/status consistency, deterministic order, and SARIF references. The
SARIF file is intentionally not a complete external SARIF conformance schema, and neither artifact
claims that all findings are exhaustive.

## Configuration, approved domains, and privacy

The adapter has no implicit configuration file. Put options in the command line so a recorded CI
invocation is self-contained, or pass one explicit `--config` file. Repeat `--approved-domain` for
each exact host that the workflow is allowed to call; an expression-built or unresolved destination
remains only partly known. Use `--include` and `--exclude` to make directory selection explicit, and
keep `--output` outside the input tree when possible.

The scan path is local-only and does not upload workflow content. The CLI reads files or stdin,
parses them in memory, and emits redacted findings. It does not execute workflow code. This does
not make a workflow safe: rotate any exposed credential, review every finding, and treat missing
or degraded analysis as a reason to investigate. For false positives, retain the input locally,
record the policy ID and evidence, and report the smallest reproducible example through the
project's security or takedown contact process; never paste secrets into an issue.

The adapter is published. Its extracted package is `sfscanner`
(`packages/scanner-cli`), which declares the `sfscanner` and `sfscanner-mcp` bins, so
`npm install -g sfscanner` installs it.
