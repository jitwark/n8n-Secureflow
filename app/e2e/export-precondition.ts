import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The single source for "is `app/out` a complete v0.3 static export?", used by
 * `playwright.config.ts` before any spec runs.
 *
 * Lives in TypeScript inside `app/` because Playwright loads its config as
 * CommonJS, which cannot use `import.meta` or import an `.mjs` sibling.
 */

/**
 * `scripts/pack-export-data.mjs` writes 64 FNV-1a `.jsonl.gzbin` bucket files
 * each for `data/details/` and `data/charts/`. A bare `next build` writes 0.
 * The floor of 32 catches any unpacked or partial build with wide margin.
 */
export const MIN_PACK_BUCKETS = 32;

const PACK_BUCKET_FILE = /^pack-\d+(?:\.jsonl)?\.gzbin$/;

/** Counts packed `.gzbin` bucket files inside `dir`. */
export function countGzbinPacks(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && PACK_BUCKET_FILE.test(entry.name)) count += 1;
  }
  return count;
}

/**
 * Returns a problem description naming the fix when `outDir` is not a complete
 * v0.3 packed export, or `null` when it is safe to serve. Only reads — never builds.
 */
export function describeIncompleteExport(outDir: string): string | null {
  if (!existsSync(outDir)) {
    return '[e2e] app/out is missing — there is no static export to serve. Playwright never builds it '
      + 'for you (a bare `next build` skips pruning and `.gzbin` packing). '
      + 'Fix: run `npm run build` from the repo root, then re-run Playwright.';
  }

  const viewHtml = path.join(outDir, 'w', 'view', 'index.html');
  if (!existsSync(viewHtml)) {
    return '[e2e] app/out/w/view/index.html is missing — the v0.3 workflow detail shell was not exported. '
      + 'Fix: run `npm run build` from the repo root, then re-run Playwright.';
  }

  const dataDir = path.join(outDir, 'data');
  const detailPacks = Math.max(
    countGzbinPacks(path.join(dataDir, 'details')),
    countGzbinPacks(path.join(dataDir, 'packs')),
  );
  const chartPacks = countGzbinPacks(path.join(dataDir, 'charts'));
  const missingIndexes = [
    'manifest.json',
    'facets.json',
    'search-index.json.gzbin',
    path.join('details', 'slug-index.json.gzbin'),
  ].filter((rel) => !existsSync(path.join(dataDir, rel)));

  if (detailPacks < MIN_PACK_BUCKETS || chartPacks < MIN_PACK_BUCKETS || missingIndexes.length > 0) {
    return `[e2e] app/out is missing packed v0.3 data artifacts (detail packs: ${detailPacks}, chart packs: ${chartPacks}, `
      + `floor: ${MIN_PACK_BUCKETS}; missing: ${missingIndexes.join(', ') || 'none'}). `
      + 'This is the signature of a bare `npx next build` without `scripts/pack-export-data.mjs`, '
      + 'which leaves raw unpacked data instead of the packed `.gzbin` export. '
      + 'Fix: run `npm run build` from the repo root, then re-run Playwright (or use `npm run test:e2e`).';
  }

  return null;
}

/** Throws `describeIncompleteExport`'s message when `outDir` is not a complete export. */
export function assertExportComplete(outDir: string): void {
  const problem = describeIncompleteExport(outDir);
  if (problem) throw new Error(problem);
}
