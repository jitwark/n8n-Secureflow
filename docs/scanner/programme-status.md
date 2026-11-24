# Scanner implementation and verification status

## November 21, 2026 — internal first-batch measurement

The exact `n8n-nodes-base.noOp@1.0.0` candidate (`resource=ABSENT`, `operation=ABSENT`) has an accepted fixed retained-record projection/replay and diagnostic comparison. The bounded independent review of the actual measurement and compare-only repair is PASS in [FIXED-MEASUREMENT-FINAL-REVIEW.md](../audit/2026-11-14-semantic-expansion/FIXED-MEASUREMENT-FINAL-REVIEW.md). The original source-30 engine scan was reused; source-31 producer code corrected the classification of three `NO_SOURCE_BINDING` placeholder rows. The scan engine was not rerun, and no data was applied or published.

Formal reviewed executable coverage is 1,445/144,043 (1.0031726637%), versus the retained 112/144,043 baseline (0.0777545594%): a gain of 1,333. Fully modelled workflows remain 0/9,669. The original 95%/90% targets remain MISSED. The accepted NoOp scope is 1,333 executable instances across 855 workflows; three disabled instances are excluded. Error and retry behavior remain UNKNOWN.

The diagnostic comparison reports 22,499 known occurrences and 70 unavailable diagnostic arrays, so the population total is null. `DEGRADED` remains 10,119; status, assessment, finding and body-binding changes are all zero. Workflow association does not prove node-level causality. The public V2 scan does not activate the taint worklist.

This is internal qualification only. Published npm `0.2.1`, hosted UI/site, V4 dataset, Action and public `main` are unchanged. The bounded independent review passed. Canonical `CURRENT-STATE.json` and `BACKUP-RECEIPT.json` track the final recovery seal. Overall programme completion and ETA remain unknown. See the [qualification evidence index](../audit/2026-11-14-semantic-expansion/README.md) and [documentation closure report](../audit/2026-11-14-semantic-expansion/DOCS-CLOSURE-IMPLEMENTATION.md).

> Canonical public scanner and programme status. Last updated: November14,2026.
> Website implementation and delivery are complete for the requested UI update. v0.3 semantic-model implementation is in internal first-batch qualification; the independently admitted exact NoOp candidate has not changed published artifacts. Overall programme completion percentage and ETA remain null; original formal-coverage targets remain missed.

## Immutable product release and hosted baseline — November 8, 2026 (historical)

The qualified product release is tag
[`v0.2.1`](https://github.com/jitwark/n8n-Secureflow/releases/tag/v0.2.1), published November 8, 2026,
at product commit `6313d89097c09faad499f54deeee33c6571109d5`. The public documentation head
verified for this release is `8e2a6f10b144d79cc147f09453f202deb0f39193`.

The package `sfscanner@0.2.1` was published to npm with maintainer account `jitwarr` (distinct
from the GitHub owner `jitwark`). Its qualified tarball SHA-256 is
`0aff150fbbe9422d1106d66b7c245ba27be8f8cbaf7e162212dd3963bfc5afd7`; the anonymous registry
download matches the qualified archive.

The historical build5 site was deployed to [Pages](https://jitwark.github.io/n8n-Secureflow/) and [Firebase](https://jitwark.github.io/n8n-Secureflow/). That baseline qualified15,198files/866,485,610bytes,86productionbrowsercases,1,491app tests and14livecases per host. The newer website delivery above has its own artifact and acceptance.

The delivery revision `1d9f4ad7dff09fd880c7397feeeecfb2893383ad` passes all `6/6` hosted CI
jobs in run `42475593007`. The published Action commit
`827877bf7215c7119f33bd7967dcba0d531448e5` passed an actual pull-request scan and SARIF upload
in run `42424040201`.

The V4 dataset contains `18` NDJSON relations, SQLite schema version `3` and a `12`-sheet Excel
workbook. All five actual reopen checks qualified. All `11,464` catalogue records are link-only;
no raw workflow bodies are distributed.

## Website delivery — verified November14,2026

The separate [site-2026-11-08-ui release](https://github.com/jitwark/n8n-Secureflow/releases/tag/site-2026-11-08-ui) is bound to runtime source b325591234dcf7a0118be1f2642540b81c2fc21d. Source CI42495043219 passed all six source/packed-package jobs. Fresh app qualification passed206files/1,525tests with zero skips. Historical build6 production acceptance covers104cases (48scanner,38catalogue,18UI) on the unchanged artifact.

Both hosts serve the same verified archive: 15,198 files / 880,793,495 bytes. Each host has 32 accepted live cases, combining initial passes with reviewed targeted reruns; original failures remain retained. Pages workflow43612419389 passed its full anonymous check. Firebase version4d9e12fc6c14c403 passed its clean full readback; prior version9ce8cdf3e9602a85 is retained for rollback. Its provider inventory has15,200files:15,198application files and the two normal Firebase init files. Root302redirect, configured headers and private-sidecar absence passed.

Archive SHA-256: 10f4cb870f983a24119a493e8f0b0a02e4fcec5928ebc9ff3444d1dce918da12. The [delivery record](https://github.com/jitwark/n8n-Secureflow/releases/download/site-2026-11-08-ui/delivery-verification.json) includes accepted case coverage, original failed attempts and transport policy. A first Firebase transfer timed out and remained failed; clean attempt2 passed. Browser synchronization observes actual data/worker readiness while preserving visible results, cold-load cardinality, geometry and five-second post-readiness response checks.

The qualified data remains the November7 snapshot:11,464total,11,245searchable. [Website changes](website-update.md) preserve package, dataset, Action, scoring and raw contracts.

## Formal coverage baseline — November 7, 2026

The real frozen scan and retained-record replay completed in 1,378.05 seconds and
431.98 seconds respectively. Their formal coverage objects are byte-identical and conserve
the 11,464-row inventory; SHA-256:
`3dc4ddb8201abf3fcb2286b6bd69a53519039763602057c2afb4a12c18ef07b1`.

**The original programme's 95% reviewed-instance and 90% fully-modelled-workflow targets
were MISSED.** They are measured failures, not pending measurements or achieved targets.

| Formal coverage measure | Actual result | Target |
| --- | --- | --- |
| Reviewed executable instances | 112 / 144,043 (0.0777545594%) | >=95% — MISSED |
| Fully modelled workflows | 0 / 9,669 (0%) | >=90% — MISSED |

The reviewed executable scope is only exact `n8n-nodes-base.gmail` version `2.2.0`
(normalized node version 2.2), message resource, and nine literal operations:
`addLabels`, `delete`, `get`, `getAll`, `markAsRead`, `markAsUnread`,
`removeLabels`, `reply` and `send`. An absent resource uses the pinned message
default; unknown/dynamic selectors, other versions/resources and `sendAndWait` do not count.
There are 112 reviewed nodes across 67 workflows; none has every executable node reviewed.

The formal cohort contains 9,669 workflows with executable official-package nodes.
Its 1,795 exclusions are 1,671 community-package workflows, 54 invalid node identities,
67 source-unavailable and 3 missing inputs. There are zero unknown measurements,
malformed inputs or rejected inputs. The 52,222 reviewed inert nodes in the cohort
are counted separately from executable instances. `COMPLETE / FULL_COHORT` describes
measurement completion with explicit exclusions; it does not establish safety or complete
semantic understanding. The misses remain full-programme failures and first-release limitations.

The replayed candidate data contains 11,379 current results: 1,065 COMPLETE,
10,119 DEGRADED and 195 INDETERMINATE; 15 NO_RESULT, 3 UNSCANNED and
67 SOURCE_UNAVAILABLE rows complete the census. No historical verdict is carried into this
candidate. These result states measure execution/freshness, not reviewed semantic coverage.

Legacy type/version catalogue matching is separate: 1,107 observed types across
236,378 instances; 29 types catalogue-matched, 10 partly matched and 1,068 unmatched.
There are 187,474 matching instances. These counts describe resolver record matches,
including nodes outside the formal executable cohort; they do not demonstrate reviewed
resource/operation scopes or detection accuracy. The earlier 26 / 9 / 1,072 counts and
76.90%/79.31% descriptions below retain their dated meanings.

## Dataset and delivery qualification

The initial V4 export completed in 97.47 seconds; the canonical-metadata repair
was regenerated in 99.45 seconds. The repaired candidate is
`release-2026-11-07-9edb75aa0898`, format `public-data-model-v4`: 18 logical relations,
18 NDJSON relation files, SQLite and a 12-sheet Excel workbook.

**The repaired dataset passes all five actual reopening checks.** The original Excel
metadata ordering failure and subsequent test timeout remain preserved as failed
receipts. Canonical metadata serialization fixed the format mismatch; reusing the same
test's parsed workbook rows reduced repeated ZIP inflation without changing assertions
or its 60-second budget. The full five-case run completed in 94.41 seconds.

The actual NDJSON privacy sweep examined 2,935,097 string leaves with zero email/token/
private-IP/internal-host matches. Its captured zero-match baseline comparison passes.
This qualifies the dataset formats and configured privacy checks. A fresh Node 22
retained-record replay after the Excel repair completed in 402.40 seconds, preserving
all measurements, exclusions, inventory and runtime bindings; only the expected
producer-source hash changed. Subsequent source-binding replays preserve the same
measurements. The release-bound formal-coverage SHA-256 is
`5f11d613316bac019dc5275e7cd23431704823ebcdbab518ee5977b5d749e5a1`, with producer
`958e5efb5fc8b11bad741035be294eeb662db913bd7871d6b0dfc0a0a49e5ae5`.

Candidate identities from the actual export:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `public-release.json` | 1,598 | `0e103f9444d5b0ae0ad6dd9e9dceb4b8b8310fc1145582add28b77ab93c205f6` |
| `release.sqlite` | 236,318,720 | `5d8920cbb64f758753740efb9ccfb5a754e5489596bead6ece701f545fbce1a3` |
| `release.xlsx` | 39,089,573 | `0b0d6f46d2de10a1fe64ac159c7d7fab406ec16e116270f34c7830a3125af717` |
| `ndjson/public-release.json` | 3,058 | `b159c952786785e524f7ca0a2bec8e761fe6415fce692af7c8e736d28f3ebeee` |

Source manifest SHA-256:
`40177ed565aa1babb1004e5124c8a9b455f215ff8777bfb5f80b029401a74479`.
Corpus SHA-256:
`025e8707c8a9c93d99e6f191e9e23ec73403b7af0e2f419695857e32cd9ab634`.
Only the workbook and root manifest bytes changed during the export repair. The NDJSON
files, SQLite archive and sealed logical dataset identity match the preserved initial export.

The verified candidate is promoted into `data/` and `outputs/public-dataset/`. Every
promoted file matches its staged size/hash, and the prior local trees are preserved externally.
The `v0.2.1` release provides the qualified dataset ZIP, CLI archive, checksums, notices, SBOM
and release record. The retained package verification passes all `23` controls.

Website labels describe available evidence: model-only graded limitations may render
`Standard scan`; mixed or unknown limitations remain `Partial analysis`, and null
assessments never invent a grade. Completion does not establish safety or full semantic
coverage. The [v0.3 roadmap](v0.3-roadmap.md) is plan-only; no new models are included in
`0.2.1`. The measured scanner snapshot and exact retained-record replays remain preserved.

## Programme completion boundary

The November8 `0.2.1` baseline and the separately verified November14 website update both
have completed delivery. The original scanner programme retains the measured coverage gaps below.

- The formal reviewed-instance and fully-modelled-workflow targets were missed:
  `112 / 144,043` executable instances and `0 / 9,669` workflows.
- The top-20 formal missing types account for `95,746 / 143,931` missing instances
  (`66.522153%`), but that is backlog incidence, not achieved coverage.
- `19 / 20` top-20 types and `19 / 20` top-20 exact cohorts already resolve to legacy
  `MODELLED`; direct impact on current `DEGRADED` labels remains `UNKNOWN`.
- No prioritized v0.3 type is `LOCAL_SOURCE_READY`, and v0.3 has no actual admitted models.
- Overall programme completion is `null`. A future completion date and any coverage forecast
  remain unknown.

## Dated history — October 27–29, 2026

The following checkpoint text is retained as historical evidence, not current status. References
below to supporting material mean the retained local review record; excluded files are not linked
or named here.

**Latest Candidate8 status-only verification — October29:** the retained local review record covers
the report, source findings, candidate/requirements and public delivery. Candidate8is locally
staged; CLI readiness is integrated. Original product/quality acceptance and public delivery remain
open. Earlier review banners below are historical. No new plan or prompt.

**Current October29 review:** the retained local review record covers the report, plan and prompt.
Candidate6 completed9maintenance steps and staged locally; fresh live audit is clean. Exact
staged-output reopen proof is open because the fixed fixture differs. Unintegrated readiness/privacy
modules have reproduced defects. Original B1–B5,48criteria and quality admission remain. Public
surfaces have not been updated to this local work. Below is dated October27 evidence, not
current-action priority.

2026-10-27. This is the current scanner entrypoint; historical repository-status and plan-of-record
references govern execution. The retained local review record preserves the dated audit history.

- Prior exact-budget and SemVer boundary fixes are retained. The new source receipt hashes required
  production/configuration files, fails on missing/unreadable/symlinked paths including intermediate
  junctions, and validates previous-run identifiers before setup/acquisition. Repair evidence and
  independent review remain in the retained local review record.
- Filter now declares the single Main output supported by the pinned upstream V1/V2 implementations.
  Catalogue/CLI digest pins agree. All149receipt-listed file hashes verified; package-local static
  source closures improved. These remain limited models, not complete field/operation semantics.
  Semantic repair and fresh review remain in the retained local review record.
- Stored corpus evidence is pre-batch:181782/236378resolver-matched instances(76.90%), with136COMPLETE/11048DEGRADED/195INDETERMINATEamong11379storedCURRENTrows. The187474/236378(79.31%)number is a resolver projection over old inputs. It is not a new rescan or semantic-accuracy result. StoredCURRENTmust be re-adjudicated against the newly changed source/semantics identity.
- The original95%reviewed executable-instance and90%fully-modelled-workflow targets in the declared built-in supported cohort, authentic quality, resource, browser/CLI parity and release requirements remain open. No whole-scanner percentage or final ETA is established by this review.
- The real scanner-rescan is terminal: inventory, full regeneration, candidate-only data promotion and public export passed; release gates passed full source size (941 files) and specs (20 packages), then failed at four missing metadata fields in the frozen candidate status document. The live source metadata is repaired. No build, packed CLI, data commit, stage or final verification ran. This is a local preparation failure; the failed run and outputs are preserved. Fresh isolated candidate: 11,379 CURRENT / 15 NO_RESULT / 3 UNSCANNED / 67 SOURCE_UNAVAILABLE; among CURRENT, 1,225 COMPLETE / 9,959 DEGRADED / 195 INDETERMINATE. Its report measures 187,474 MODELLED / 236,378 observed instances (79.3111%). This is catalogue matching on that candidate, not detection accuracy, original supported-cohort acceptance or active-source data replacement. The related plan and start prompt remain in the retained local review record.
- Owner-authorized legacy sitemap retirement is documented in the retained local review record. This resolves the local owner decision; it does not prove a deployment or external withdrawal.

The narrower product direction is offline pre-import and CI review, followed by explicit target-version compatibility. COMPLETE describes the admitted analysis scope; it does not certify a safe or executable workflow. The supporting ecosystem research and demand limitations remain in the retained local review record.
