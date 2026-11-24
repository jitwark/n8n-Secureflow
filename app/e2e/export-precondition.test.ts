import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_PACK_BUCKETS,
  assertExportComplete,
  countGzbinPacks,
  describeIncompleteExport,
} from './export-precondition';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type FakeExportOptions = {
  viewHtml?: boolean;
  detailPacks?: number;
  chartPacks?: number;
  slugIndex?: boolean;
  searchIndexGz?: boolean;
  facets?: boolean;
  manifest?: boolean;
  unpackedNextOnly?: boolean;
};

/** Builds a fake export matching either a complete v0.3 packed export or a bare `next build`. */
function fakeExport({
  viewHtml = true,
  detailPacks = MIN_PACK_BUCKETS,
  chartPacks = MIN_PACK_BUCKETS,
  slugIndex = true,
  searchIndexGz = true,
  facets = true,
  manifest = true,
  unpackedNextOnly = false,
}: FakeExportOptions = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'export-precondition-'));
  made.push(root);
  if (viewHtml) {
    mkdirSync(path.join(root, 'w', 'view'), { recursive: true });
    writeFileSync(path.join(root, 'w', 'view', 'index.html'), '<html></html>');
  }
  const dataDir = path.join(root, 'data');
  const detailsDir = path.join(dataDir, 'details');
  const chartsDir = path.join(dataDir, 'charts');
  mkdirSync(detailsDir, { recursive: true });
  mkdirSync(chartsDir, { recursive: true });

  for (let i = 0; i < detailPacks; i += 1) {
    writeFileSync(path.join(detailsDir, `pack-${String(i).padStart(2, '0')}.jsonl.gzbin`), 'gz');
  }
  for (let i = 0; i < chartPacks; i += 1) {
    writeFileSync(path.join(chartsDir, `pack-${String(i).padStart(2, '0')}.jsonl.gzbin`), 'gz');
  }
  if (slugIndex) writeFileSync(path.join(detailsDir, 'slug-index.json.gzbin'), 'gz');
  if (searchIndexGz) writeFileSync(path.join(dataDir, 'search-index.json.gzbin'), 'gz');
  if (facets) writeFileSync(path.join(dataDir, 'facets.json'), '{}');
  if (manifest) writeFileSync(path.join(dataDir, 'manifest.json'), '{}');

  if (unpackedNextOnly) {
    writeFileSync(path.join(dataDir, 'search-index.json'), '{}');
    writeFileSync(path.join(detailsDir, 'detail-0.jsonl'), '');
    writeFileSync(path.join(chartsDir, 'chart-0.jsonl'), '');
  }
  return root;
}

describe('export precondition', () => {
  it('counts .gzbin bucket packs while ignoring non-pack files', () => {
    const dir = fakeExport({ detailPacks: 5, chartPacks: 3, slugIndex: true });
    expect(countGzbinPacks(path.join(dir, 'data', 'details'))).toBe(5);
    expect(countGzbinPacks(path.join(dir, 'data', 'charts'))).toBe(3);
    expect(countGzbinPacks(path.join(dir, 'data', 'missing'))).toBe(0);
  });

  it('names `npm run build` when the export is missing entirely', () => {
    const problem = describeIncompleteExport(path.join(tmpdir(), 'export-precondition-absent'));
    expect(problem).toMatch(/app\/out is missing/);
    expect(problem).toMatch(/npm run build/);
  });

  it('rejects an export missing /w/view/index.html', () => {
    const problem = describeIncompleteExport(fakeExport({ viewHtml: false }));
    expect(problem).toMatch(/w\/view\/index\.html/);
    expect(problem).toMatch(/npm run build/);
  });

  it('recognises a Next-only build without packed .gzbin artifacts — the exact failure this exists to catch', () => {
    const problem = describeIncompleteExport(
      fakeExport({ detailPacks: 0, chartPacks: 0, slugIndex: false, searchIndexGz: false, unpackedNextOnly: true }),
    );
    expect(problem).toMatch(/packed/i);
    expect(problem).toMatch(/next build/);
    expect(problem).toMatch(/npm run build/);
  });

  it('accepts an export at the packed bucket floor with required packed indexes', () => {
    expect(describeIncompleteExport(fakeExport())).toBeNull();
  });

  it('rejects an export one detail or chart pack below the floor or missing packed indexes', () => {
    expect(describeIncompleteExport(fakeExport({ detailPacks: MIN_PACK_BUCKETS - 1 }))).not.toBeNull();
    expect(describeIncompleteExport(fakeExport({ chartPacks: MIN_PACK_BUCKETS - 1 }))).not.toBeNull();
    expect(describeIncompleteExport(fakeExport({ slugIndex: false }))).not.toBeNull();
    expect(describeIncompleteExport(fakeExport({ searchIndexGz: false }))).not.toBeNull();
    expect(describeIncompleteExport(fakeExport({ facets: false }))).not.toBeNull();
    expect(describeIncompleteExport(fakeExport({ manifest: false }))).not.toBeNull();
  });

  it('throws for an incomplete export and stays silent for a complete one', () => {
    expect(() => assertExportComplete(fakeExport({ detailPacks: 0, searchIndexGz: false }))).toThrow(/npm run build/);
    expect(() => assertExportComplete(fakeExport())).not.toThrow();
  });
});

/**
 * The precondition broke the entire E2E gate once by being unloadable rather than
 * wrong: `playwright.config.ts` is loaded as CommonJS, so `import.meta` is a
 * syntax error there and an `.mjs` sibling cannot be imported at all. Neither
 * fault was catchable by unit tests, because the config itself was never loaded
 * while Playwright was (correctly) forbidden.
 *
 * These assertions are cheap insurance against reintroducing either.
 */
describe('playwright config loadability', () => {
  const config = path.resolve(import.meta.dirname, '..', 'playwright.config.ts');

  async function configCode(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return (await readFile(config, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  it('never uses import.meta, which is a syntax error under CJS config loading', async () => {
    expect(await configCode()).not.toMatch(/import\.meta/);
  });

  it('never imports an .mjs module, which the CJS config loader cannot resolve', async () => {
    expect(await configCode()).not.toMatch(/from\s+['"][^'"]+\.mjs['"]/);
  });
});
