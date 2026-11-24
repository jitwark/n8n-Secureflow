import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const DATA_BUDGET_MB = 2.5;
export const EAGER = [
  'search-index.json',   // the lexical index; warm-up fetches it on idle
  'facets.json',         // bitsets + ordinals; the worker needs both at init
];
export const DEFERRED = [
  // 1.59 MB gzip, larger than the primary index itself. Fetched on the first
  // tokenised query, not during warm-up.
  'semantic-index.json',
  'semantic-index.json.gzbin',
  // ~2.52 MB gzip: the entries beyond the content-indexed top tier.
  // Fetched once the primary index is answering, never before it.
  'search-index-extended.json',
  'search-index-extended.json.gzbin',
  // Per-page, and never on the search path.
  'manifest.json', 'stats.json', 'analytics.json',
];
export const DEFERRED_PREFIXES = ['charts/', 'details/', 'packs/', 'catalogue-'];

export function stripPackSuffix(relativePath) {
  return relativePath.endsWith('.gzbin') ? relativePath.slice(0, -'.gzbin'.length) : relativePath;
}

export async function gzipSize(outDir, relativePath) {
  for (const candidate of [`${relativePath}.gzbin`, relativePath]) {
    const bytes = await readFile(join(outDir, 'data', candidate)).catch(() => null);
    if (!bytes) continue;
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return isGzip ? bytes.length : gzipSync(bytes).length;
  }
  return null;
}

export async function referencedDataFiles(outDir) {
  const { readdir } = await import('node:fs/promises');
  const chunkDir = join(outDir, '_next', 'static', 'chunks');
  const names = await readdir(chunkDir).catch(() => []);
  const found = new Set();
  for (const name of names) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(join(chunkDir, name), 'utf8').catch(() => '');
    for (const match of source.matchAll(/\/data\/([A-Za-z0-9._/-]+\.(?:json|jsonl)(?:\.gzbin)?)/g)) {
      found.add(match[1]);
    }
  }
  return [...found];
}
