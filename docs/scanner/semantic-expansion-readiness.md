# Local source readiness for semantic expansion

The development command `node scripts/semantic-expansion-readiness.mjs` checks local files against the committed semantic source receipts. Use the project development runtime (Node22.17.0). It does not fetch packages, execute upstream code, modify models or admit semantics.

Supply an explicit package identity and local extracted package root for each package:

```powershell
node scripts/semantic-expansion-readiness.mjs --package n8n-nodes-base@2.15.1 D:/private-source/n8n-nodes-base
```

The path is illustrative: do not assume that directory exists. Repeat `--package <name>@<version> <root>` for additional receipt packages. Scoped package names include the scope as usual. Package release versions are distinct from workflow node `typeVersion`.

Readiness requires exact package name/version metadata plus every receipt-listed file's expected length and SHA256. Missing roots/files, identity mismatch and unsafe paths do not pass. The report binds the source receipt digest. Files must remain stable while checking; prepare immutable private source snapshots for subsequent review.

The command emits JSON. Exit0 means the listed file-byte checks passed; exit1 means source bytes are not ready; exit2 means invocation or receipt loading failed. No-input invocation is a useful fail-closed check and is expected to exit1.

`SOURCE_BYTES_VERIFIED` describes only receipt-listed file bytes. It does **not** prove:

- authentic npm tarball acquisition or integrity;
- a complete implementation/dependency closure;
- reviewed operations, dataflow, effects, authentication or sanitizers;
- independent semantic admission or higher measured workflow coverage.

The report keeps package authenticity, behavior review and semantic admission separate. Do not upload the private extracted source or raw workflows with the report. The public receipt's redistribution restrictions remain applicable.

Next steps are exact tarball verification, implementation-closure review, diagnostic cohort mapping and independent admission before any behavior batch can improve formal coverage. The published0.2.1package is unchanged by this developer tooling.
