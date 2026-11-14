# Website update — November 14, 2026

> Status: delivered and verified on Pages and Firebase
> Last verified: 2026-11-14
> Owner: single maintainer, @jitwark
> Source of truth: [canonical programme status](programme-status.md)

The separate [site-2026-11-08-ui release](https://github.com/jitwark/sfscanner/releases/tag/site-2026-11-08-ui) was published November14 from runtime source b325591234dcf7a0118be1f2642540b81c2fc21d. Both hosts serve the identical retained artifact. Full anonymous readback passed for15,198files/880,793,495bytes on each host;32distinct live cases per host are accepted across initial passes and reviewed targeted reruns. Original failures are preserved in the [delivery record](https://github.com/jitwark/sfscanner/releases/download/site-2026-11-08-ui/delivery-verification.json).

Pages workflow43612419389 completed successfully. Firebase version4d9e12fc6c14c403 passed its clean full content check and provider inventory; prior9ce8cdf3e9602a85 is the rollback version. The two additional provider paths are Firebase's normal initialization files. Header, root redirect and private-sidecar controls passed.

## Checks and retained artifact

- Hosted CI run `42495043219` passed 6/6 source and packed-package jobs across three operating systems.
- The fresh November 14 app check passed for 206 files and 1,525 tests, 0 skipped, plus type, lint
  and boundary checks.
- Build 6's 104 production browser checks (48 scanner, 38 catalogue, 18 UI) are a historical
  November 8 result, not a fresh November 14 check.
- The retained site archive SHA-256 is
  `10f4cb870f983a24119a493e8f0b0a02e4fcec5928ebc9ff3444d1dce918da12`; it contains 15,198 files
  and 880,793,495 bytes (tar size 892,387,840 bytes). Archive identity and contents are artifact
  facts, not host readback.

The old November 8 build-5 baseline is separately historical: 15,198 live files / 866,485,610 bytes,
86 production browser checks and 1,491 app tests. Those counts do not describe build 6 or the
November 14 fresh app check.

## UI scope and unchanged identities

The update puts the decision and next actions before detailed evidence; omits numeric grade/score
when unavailable; provides a specific workflow fix for each finding; removes the duplicate summary
report link while retaining the canvas handoff; fixes bookmark handling (six related tests), a
breadcrumb-prefetch 404 and actual child containment in the library.

Analytics removes both requested coverage sections and retains the unchanged November 7 snapshot:
11,464 total / 11,245 searchable. No new data or models were introduced. The immutable npm
`sfscanner@0.2.1` archive remains SHA-256
`0aff150fbbe9422d1106d66b7c245ba27be8f8cbaf7e162212dd3963bfc5afd7`; V4 dataset and published
V4/Action identities are unchanged.

The formal 95% reviewed-instance and 90% fully-modelled-workflow targets remain MISSED:
112/144,043 and 0/9,669. Programme completion percentage and ETA remain null. v0.3 semantic-model
work remains PLAN ONLY. Site publication does not change these product or programme limits.
