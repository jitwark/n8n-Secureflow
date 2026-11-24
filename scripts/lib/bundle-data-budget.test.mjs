import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { gzipSize, referencedDataFiles, stripPackSuffix } from './bundle-data-budget.mjs';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bundle-data-budget helpers', () => {
  it('measures pre-gzipped .gzbin artifacts directly without double-compressing', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'hub-budget-'));
    tempDirs.push(outDir);
    mkdirSync(join(outDir, 'data'), { recursive: true });
    const raw = Buffer.from(JSON.stringify({ ok: true, items: Array(40).fill('n8n') }), 'utf8');
    const gz = gzipSync(raw);
    writeFileSync(join(outDir, 'data', 'search-index.json.gzbin'), gz);
    writeFileSync(join(outDir, 'data', 'facets.json'), raw);

    expect(await gzipSize(outDir, 'search-index.json')).toBe(gz.length);
    expect(await gzipSize(outDir, 'facets.json')).toBe(gzipSync(raw).length);
    expect(await gzipSize(outDir, 'missing.json')).toBeNull();
  });

  it('collects both raw .json and packed .json.gzbin/.jsonl.gzbin /data/ chunk references', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'hub-chunks-'));
    tempDirs.push(outDir);
    mkdirSync(join(outDir, '_next', 'static', 'chunks'), { recursive: true });
    writeFileSync(
      join(outDir, '_next', 'static', 'chunks', 'app.js'),
      'const a="/data/search-index.json.gzbin";const b="/data/facets.json";const c="/data/details/slug-index.json.gzbin";',
    );

    const refs = await referencedDataFiles(outDir);
    expect(refs.sort()).toEqual([
      'details/slug-index.json.gzbin',
      'facets.json',
      'search-index.json.gzbin',
    ]);
    expect(stripPackSuffix('search-index.json.gzbin')).toBe('search-index.json');
  });
});
