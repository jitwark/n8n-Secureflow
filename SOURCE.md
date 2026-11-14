# Where this repository comes from

The standalone scanner, website and pipeline are developed in a private working repository and selected for publication by scripts/extract-public-repo.mjs. The extractor uses an explicit allowlist and content/privacy checks; private history is not pushed. Send contributions as pull requests here, as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Public release identity

| Scope | Qualified identity |
| --- | --- |
| Release | [v0.2.1](https://github.com/jitwark/sfscanner/releases/tag/v0.2.1), published November 8, 2026 |
| Product/tag commit | 6313d89097c09faad499f54deeee33c6571109d5 |
| Qualified Pages delivery commit for v0.2.1 | 1d9f4ad7dff09fd880c7397feeeecfb2893383ad |
| Deployed website runtime source | `b325591234dcf7a0118be1f2642540b81c2fc21d` |
| Site update artifact | [`site-2026-11-08-ui`](https://github.com/jitwark/sfscanner/releases/tag/site-2026-11-08-ui), published November 14, 2026 |
| Source count at the preceding documentation checkpoint | 2,198 selected source files; 2,199 tracked public files including accepted Action metadata, verified at 8e2a6f10b144d79cc147f09453f202deb0f39193 |

The immutable npm 0.2.1 archive and product/tag identity remain unchanged. The deployed site is bound to the website runtime revision above; later main updates contain documentation and browser-test synchronization changes. Both hosts serve the same verified archive: 15,198 files / 880,793,495 bytes. Each host has 32 accepted live cases, combining initial passes with reviewed targeted reruns; original failures remain retained.

The [delivery record](https://github.com/jitwark/sfscanner/releases/download/site-2026-11-08-ui/delivery-verification.json) preserves archive identity, Pages workflow43612419389, Firebase version4d9e12fc6c14c403 and rollback9ce8cdf3e9602a85. See [programme status](docs/scanner/programme-status.md) for current scope and measured limits.

## What is deliberately absent

- Private corpus bodies, generated native evidence and the local data/ and app/public/data/ build inputs. The [published V4 dataset](docs/DATA-AVAILABILITY.md) is a separate qualified link-only artifact with its own licence.
- Internal audit packets, unreleased decision inputs, private OpenSpec plans and session context. Public architecture decisions remain in [docs/decisions](docs/decisions/).
- Local agent/editor configuration, caches, secrets, capture-only fixtures and private Git history.

Run npm run gates:source and npm run test:source for the supported source-only CI path. A complete site build or corpus-dependent suite also needs the appropriate verified build inputs; absence of private input is not a reason to weaken source or privacy gates.

## Historical extraction note

The former September 5, 2026 extraction recorded upstream commit f8e871aef7b8a096e3d962bb04aa518ce191bba9 and 1,370 files. Those values describe that earlier extraction, not the November release or current main.
