# Scanner release runbook

> **Current audit caution — 2026-10-26:** this runbook's verification date below is intentionally not advanced. The dated freshness gate fails, and the independent verification packet that raised it is no longer shipped in the working tree; check current staged build/seal/rollback commands before a new dated attestation. Do not run broad suites/builds in the evidence-bearing checkout; use an owned isolated candidate. Existing dated authorization language is historical; current owner instructions and actual release gates control publication scope.

> Status: prepared-only operational procedure; no release or deployment authorization
> Last verified: 2026-10-28
> Owner: Release owner with Scanner maintainer support
> Source of truth: [`package.json`](../../package.json), [`run-gates.mjs`](../../scripts/run-gates.mjs), and the [release assurance specification](../../openspec/changes/v0.3-lean-best-in-class-closure/specs/cli-mcp-packaging/spec.md)

Use this procedure to prepare evidence for a candidate. A green local command is necessary
engineering evidence only. The qualified v0.2.1 repository, npm archive, Action and both sites are already public; see [programme status](programme-status.md). This procedure governs a future candidate and does not authorize a new publication or qualify the in-progress UI overhaul.

## Release identities and rollback authority

- Native v1 remains the authoritative compatibility and rollback surface: `scanner-beta-1`,
  `scanner-result-v1`, `scanner-limits-v1`, and the existing v1 adapters/goldens.
- Explicit v2/v3 is a separate core candidate: `secureflow-scanner@3.0.0` with admitted
  `standard@3.0.0` (default) and `strict@3.0.0` (alias `ci`), alongside the retained
  `beta-default@2.0.0` and `beta-hardened@2.0.0`. All four are admitted and selectable. A release
  does not change public entry identity, rights, or catalogue output.
- Every candidate record must bind the exact source commit, scanner/profile/ruleset/semantic/limits
  identities, input or corpus manifest, artifact hashes, and a prior verified rollback target.
- A v2 result is never silently relabelled or downgraded into a fabricated v1 assessment. If a v2
  gate fails, disable v2 selection and keep the native v1 result authoritative.

## 1. Freeze and capture the candidate

1. Start from a clean, owner-selected commit. Record the output of `git rev-parse HEAD`, the Node/npm
   versions, package lock identity, and (for a corpus release) `data/manifest.json` and its SHA-256.
2. Record the engine, profile, ruleset, semantics, schema, limits, and build identities produced by
   the candidate. A digest-only change is not a same-version release.
3. Record the previous verified release and its immutable site/data hashes before changing a release
   pointer. Keep the v1 artifact available until all later gates and the owner decision are complete.
4. Do not acquire external content, modify rights metadata, or change `EntrySecurity` as an implicit
   part of scanner readiness. Those are separately owned release decisions.

## 2. Run local engineering gates first

Run the focused checks for the change, then the ordered core sequence. The core sequence builds the
export before its link gate:

```text
node scripts/check-specs.mjs
node scripts/check-doc-consistency.mjs
node scripts/check-scanner-doc-claims.mjs
git diff --check
node scripts/run-gates.mjs gates
```

After a successful build, `npm run check:links` may also be run directly to inspect the same export.

`npm run gates` is the ordered sequence in [`run-gates.mjs`](../../scripts/run-gates.mjs). It writes a
machine-readable `gate-summary-v1` to `pipeline/.work/gate-summary.json` by default. Preserve that
summary, command output, source commit, and generated identities as candidate evidence. Do not edit a
failed summary to make it pass; after a source change, start a new run and identity.

For a corpus-backed release, run the release sequence only after its input and rights decisions are
ready:

```text
node scripts/run-gates.mjs release
```

That sequence is the `gates` sequence plus `check:seo`; it does not add the corpus-integrity,
rights-invariant, corpus-privacy, data-sync, graph, catalogue-claim-freshness or legal-identity
checks that earlier revisions of this runbook listed, because those gates and the data exports they
guarded were retired in v0.3. Run an individual gate directly when a release scope needs it, for
example `node scripts/check-rights-invariant.mjs` or `node scripts/check-corpus-privacy.mjs`. A local
pass still does not prove C1L approval, independent review, or publication readiness.

## 3. Preserve failures and prepare rollback

On any failed local gate:

1. stop the sequence and retain the failed command, summary, logs, fixture, and exact source identity;
2. mark the candidate `NO-GO` or `PENDING`, depending on whether an owner must decide scope;
3. do not delete the failing artifact or replace the v1 release pointer; and
4. fix and rerun from a new candidate identity, without converting a missing result into a clean one.

For an explicitly authorized data promotion, restore the previous `data/` tree from git or a host
backup first, then copy the reviewed staging directory into place. **The `prepare:release-data`
script that once automated this was retired in v0.3** together with the export ceremony it staged:

```text
git -C . stash push -- data           # or restore from a host backup
git checkout <prior-commit> -- data   # rollback source
```

Use this only with a reviewed staging directory containing a manifest you can verify by hand. It is
not a rights decision and it does not publish data. Never overwrite the only copy of the prior
artifact.

### Staged-release and rollback tooling was retired in v0.3

Commit `9fc2789` once landed a staged-release family — a release stager, a staged-release verifier,
a pointer rollback, and a rollback rehearsal — that made release staging and pointer rollback
operational rather than fixture-only. **None of it ships in v0.3.** The `release:gates`,
`stage:release`, `verify:release`, `rollback:release` and `rehearse:release-rollback` scripts were
retired with the Excel/SQLite/PostgreSQL/CSV/NDJSON export ceremony, because the product they
staged no longer exists: there is one static export, one npm tarball, and no versioned-pointer
release tree to roll between.

The retirement does not make a rollback claim false or true — it removes the claim. What remains
authoritative:

- **The static export** is rebuilt from a clean tree and gated by `scripts/check-export-budget.mjs`
  (`< 35 MiB`, currently 33,723,431 bytes across 755 files) plus `scripts/check-bundle-budget.mjs`,
  which reads the route caps in `docs/perf/budgets.json`.
- **The npm tarball** is verified by `scripts/verify-packed-cli.mjs` and
  `scripts/check-scanner-reproducibility.mjs`, which perform isolated packs and compare every entry
  byte-for-byte.
- **Restoring a prior release** is now a host and git operation, not a repository script: check out
  the prior commit, rebuild, and redeploy. That is owner-controlled and is not rehearsed here.

The historical mechanics remain recoverable from git history at commit `9fc2789` if an operator
needs to read exactly what the retired scripts did.

### Retired-tooling limits that still describe the real boundary

The limits below were written against the retired tooling. They are kept because each one still
describes an unperformed step rather than a code defect:

1. **No rehearsal of a host rollback.** Nothing in this repository rehearses cache/range/416
   behaviour, the edge `X-Robots-Tag`, the noindex preview, or a deployed-tree digest sweep. Those
   remain unperformed until an operator runs them against a host.
2. **Edge header conflict on any staged snapshot.** `firebase.json` sets
   `X-Robots-Tag: index, follow` for `**`, so a noindex deploy must override edge headers.
3. **No content-addressed release identity.** The retired dataset stager declared a non-content-
   addressed `releaseId`; with the dataset exports retired there is no release record to address,
   and the v0.3 export is identified by its byte count and file count in `docs/perf/budgets.json`.
4. **Nothing release-shaped is reachable from `npm run gates`.** That is the design, not an
   omission: build and gate sequences must not be able to publish.
5. **Production deployment authority is the owner's.** An actual rollback requires an
   owner-controlled restore of the prior verified site artifact; no local script authorizes or
   performs a public deployment.

## 4. Obtain the non-local gates in order

After local evidence is complete, the release owner opens the separate review records. Each must name
an owner, scope, date, exact artifact identity, evidence digest, decision, residual risk, and rollback
target:

| Gate | Required disposition before GO |
| --- | --- |
| C1L rights/legal and provenance | Owner/legal record confirms operator, licence, attribution, redistribution, retention, and exclusions. |
| Independent security review | Named independent reviewer records scope and verdict; the current reviewer role is unstaffed. |
| Human calibration/adjudication | Holdout and differential evidence is reviewed; development calibration alone is insufficient. |
| Cross-platform/clean-install CI | Node/OS and package checks pass outside this local worktree. **Owner-authorized** on `ubuntu-latest`; the job is authored in this repository, and its result remains external. |
| SARIF and schema conformance | Official ingestion or equivalent owner-approved evidence exists; local JSON shape is not ingestion proof. |
| SBOM, checksums, provenance, reproducibility | Release artifacts have the required identity and attestation evidence. |
| Browser/deployment/TestSprite | Real browser, host, headers/cache/no-index, and TestSprite evidence exists where applicable. **TestSprite is deferred for this initial candidate by owner decision**; browser and host evidence is required regardless. |
| Publication and promotion | Separate owner GO authorizes npm, GitHub/Action/repository, MCP, and deployment actions. |

Until every required disposition is recorded, the candidate remains prepared-only. C1L, rights,
SARIF, provenance, TestSprite, deployment, publication, and merge are external gates and cannot be
inferred from `npm run gates` or from this document.

### Environment policy for cloud runners

Two gate families are environment-bound, and each carries an explicit policy rather than a silent
weakening — see [the deployment environment policy ADR](../decisions/ADR-deployment-environment-policy.md).

- **`check:published-secret-leak` is a local-only gate.** It needs the raw official template corpus,
  which is local-only and non-redistributable by legal design, so a cloud runner must not possess or
  receive it. The local release-gate run before tagging enforces it. Under CI, with the raw
  bodies absent, it exits 0 with a labelled skip stating that absence was **not** proven there — a
  reader can tell that apart from a pass. It stays in the `release` sequence so the deploy keeps one
  canonical step rather than regressing to an ad-hoc list. **Provision its input when you run it:**
  `OFFICIAL_BODIES_SNAPSHOT=<path-to-snapshot.json> node scripts/run-gates.mjs release`,
  or pass that path to the gate as `--snapshot`. Nothing in the runner provisions it, and the gate fails
  closed without it — correctly, but that makes this workflow unfollowable unless the variable is set.
- **The two micro-latency bounds carry a 2.0× CI tolerance.** The stage-35 vitest timeout is 10,000 ms
  under CI (5,000 ms locally) and the stage-36 main-thread gap bound is 150 ms under CI (75 ms
  locally), matching the policy the scanner v2 performance budget already applies to p95. The
  multiplier was raised from 1.5× because the measured stage-36 overshoot of 118.60 ms against 75 ms
  is 1.58×, which 1.5× (112.5 ms) did not cover. The applied bound and the multiplier are printed, so
  a tolerated pass cannot be read as a strict one.

A CI pass on either timing bound is a **tolerated** pass — it is **not** a comparable measurement. Only
the local quiet-host run is citable as assurance, and no p95 result is claimed from a shared runner.

## 5. Per-artifact assurance matrix

Each cell names the evidence required *before* that phase can be claimed, not evidence that exists
today. The npm package is released as `sfscanner`; no other artifact in this table is published,
attested, or prepared for publication: GitHub metadata for the repository name carried in the hub CI
header is a 404 without authentication, which cannot distinguish "private" from "absent". Requirement
vocabulary:

- `LOCAL` — produced in this repository by a named command and retained output; necessary, never sufficient.
- `EXTERNAL` — needs a host, runner, registry, or authenticated publication system; a local command cannot satisfy it.
- `OWNER` — a named owner decision is itself the gate. In the scanner change DAG these are the
  `CI_REQUIRED`/`OWNER_REQUIRED`/`LEGAL_REQUIRED`/`DEPLOYMENT_REQUIRED`/`HUMAN_REQUIRED` gates in
  the retired `world-class-scanner-cli` change DAG, retained in git history.
- `ABSENT` — the artifact or its evidence does not exist yet; absence is a state, never a pass.

| Artifact | Identity | SBOM / inventory | Provenance / attestation | Clean rebuild | Rollback |
| --- | --- | --- | --- | --- | --- |
| Static site (`app/out` export → Pages) | `LOCAL`: exact source commit, Node/npm/lockfile, retained gate summary, release section hashes | `ABSENT`: no site SBOM generator is wired into the gates | `EXTERNAL` + `OWNER`: the OIDC-backed Pages deployment is not a published attestation; requires a GitHub artifact attestation over the exported artifact's exact digest, unperformed | `LOCAL`: two clean builds of one commit must byte-match the export | `OWNER`: restore the prior release; pointer mechanics are rehearsed, production rollback stays owner-controlled |
| Catalogue / public dataset (`data/`, `app/public/data/`) | `LOCAL`: `data/manifest.json` digest plus per-entry source commit, path, and rights evidence | `ABSENT`: the required inventory is a dataset checksum manifest, not a software SBOM | `OWNER` + `LEGAL`: C1L rights and per-entry provenance; the internal `releaseId` is not content-addressed, and a GitHub artifact attestation over the dataset bundle digest requires an approved release object first | `LOCAL`: declared inputs plus a clean-room corpus repeat must match | `LOCAL` + `OWNER`: authorized staging backup first, then an owner-controlled pointer restore |
| npm tarball (`sfscanner`, `sfscanner@0.3.0`) | `PUBLISHED`: released as `sfscanner`; the pack is reproduced locally by `npm pack --workspace sfscanner` (1.07 MiB unpacked, 44 files) | `LOCAL`: `node scripts/generate-scanner-sbom.mjs` emits a real CycloneDX 1.5 document (108 components, 9 of them bundled/shipped, SPDX ids from the lockfile plus the workspace manifests), not a status stub; it is not yet attached to a release object | `ABSENT` + `OWNER`: npm provenance or a GitHub artifact attestation over the tarball's exact digest does not exist | `LOCAL`: `node scripts/check-scanner-reproducibility.mjs` performs two isolated packs and compares every entry byte-for-byte — identical (35 entries, sha256 `60ac42336826a39953c27e9edf6b8e7163d0987df01e16efa49450c22d8f2d77`) recorded against **revision `f908eb8`** with a clean tracked tree; the earlier pre-flip pack reproduced the sealed `9213511a…` exactly. Both packs run in one working tree (isolation by destination, not checkout), so the clean-clone property rests on the clean tree. A checksum is not a signature | `OWNER`: dist-tag or unpublish policy |
| GitHub Action (`.github/actions/scan/action.yml`, legacy `action.yml`) | `ABSENT`: unpublished; consumers pin a full SHA, so a published SHA becomes the identity | `ABSENT`: bundled action dependency SBOM required before publication | `ABSENT` + `OWNER`: build-provenance attestation over the action bundle's exact digest, unperformed, and repository visibility are owner actions | `ABSENT`: rebuild the bundle and byte-compare before publication | `OWNER`: consumers pin SHAs; reverting a release is an owner action |
| Rule packs (v2 builtin packs) | `LOCAL`: canonical pack bytes digest with `signatures: []` (WC-0701 `createPackDigest`) | `ABSENT`: the checksum/manifest inventory is prepared-only | `DEFERRED`: Ed25519 trust store and pack verification exist only as unwired post-v2 helpers (`trust-store.ts`, `verify-pack.ts`, `admit-pack.ts`); admission is reserved past v2, and external packs stay disabled — see [scanner-rule-pack-trust.md](../decisions/scanner-rule-pack-trust.md) and the Phase 7 boundary above | `LOCAL`: canonical bytes are stable under reconstruction (`pack-identity.test.ts`) | `LOCAL`: packs ship inside the package; rollback follows that package's row |
| Docs (`docs/**`, OpenSpec change proposals, generated references) | `LOCAL`: document set plus the source commit; generated references carry a source digest | Not applicable: documentation is not a packaged artifact | Not applicable: documents carry no attestation, and a review record is not a provenance statement | `LOCAL`: generated-reference parity must match committed sources | `LOCAL`: revert the documentation commit |

**Attestation mechanism and subject-digest check.** The chosen releasable objects — the static
export, the public dataset bundle, the npm tarball, and the Action bundle — require a GitHub artifact
attestation (build provenance) generated on the runner that built them, and verification of that
attestation against the object's exact digest. The official verification is
`gh attestation verify <path> -R <owner>/<repo>`, whose reported subject digest must equal the digest
recorded in the release record; an unverified attestation is not evidence, and a check that names a
different digest fails the gate (see the [GitHub artifact attestation
docs](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)).
Status: **unperformed** — no attestation exists, no subject digest is recorded, and the repository
identity and host credentials needed to verify are unsettled. Nothing in this section may be recorded
as completed from a local command, and no attestation may be generated for an object this repository
has not chosen to release.

Two rules keep this matrix honest:

1. **An attestation establishes provenance, not safety.** A signed statement says which source and
   builder produced a named artifact, and nothing about whether that artifact is safe, rights-clean,
   accurate, or independently reviewed. Provenance is the entry condition for the owner, legal, and
   review gates in section 4, never a substitute for them.
2. **Nothing here may be filled in from a passing local command.** A `LOCAL` cell is satisfied by
   retained command output and digests; `EXTERNAL` and `OWNER` cells need a named record with owner,
   date, scope, artifact digest, decision, residual risk, and rollback target. An artifact that was
   never built is recorded `ABSENT`, and no row is deleted to make the table look complete.

## 6. Record GO, promote, and retain evidence

A GO record must identify the exact candidate and prior v1 rollback target, link every local and
external gate, and state what was not in scope. If any required gate is `PENDING`, record `NO-GO` or
`CONDITIONAL` and do not promote. If GO is recorded, the owner—not an implementation agent—performs
the separately authorized pointer, deployment, or publication action. Retain the pre-promotion v1
artifact, candidate manifests, hashes, gate summary, review records, and any failed artifacts.

After promotion, compare the served identity with the approved record. A mismatch, failed health or
content check, rights concern, or v2 parity failure triggers the owner-controlled rollback to v1;
never manufacture a replacement assessment from partial v2 output.

## Non-claims

This runbook does not claim a public or production v2 release, GitHub/MCP publication, deployment,
external CI, independent security or legal/rights approval, official SARIF ingestion, TestSprite
coverage, full-corpus v2 rescan, signed manifest, SBOM/provenance, reproducibility, or production
deployment rollback (the staged pointer rehearsal that once evidenced this was retired with its
scripts, so production deployment rollback remains owner-controlled and unrehearsed). It is an
operational sequence for evidence and owner decisions.

Publication state is checked directly, not inferred: `sfscanner` is released on npm, and both
`jitwark/n8n-community` and `jitwark/n8n-Secureflow` report `PRIVATE` — repository visibility is a
separate decision from the package's. The `private: false` flag in
`packages/scanner-cli/package.json` is a packaging setting, and a local `npm pack` + tarball install
is a developer workflow, not evidence of the released artifact. Local installation, the relative-input
rule and a verified Windows example are in [cli-v2.md](cli-v2.md).
