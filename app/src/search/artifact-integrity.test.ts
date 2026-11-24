// @vitest-environment jsdom
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  decodeArtifactBytes,
  expectedArtifact,
  resolvePackedPath,
  verifyArtifactBytes,
} from './artifact-integrity';
import type { Manifest } from '../catalogue/manifest';

function hash(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

function manifestWith(...artifacts: { path: string; byteSize: number; sha256: string; entryCount?: number }[]): Manifest {
  return {
    schemaVersion: 'manifest-v1',
    generatedAt: '2026-08-30T00:00:00.000Z',
    totalEntries: 0,
    catalogueShards: {},
    artifacts,
  };
}

/**
 * AUDIT-SEARCH-003. `expectedArtifact` is the single lookup every optional
 * search artifact (extended index, facets, semantic index) uses to find its
 * manifest-bound identity. It must degrade to "cannot verify" — not throw —
 * whenever the manifest is unavailable or simply has no entry for the path,
 * because those artifacts are optional and a verification gap must never
 * hard-block them; only `fetchSearchIndexWithRelease`'s primary-index path
 * treats manifest unavailability as fatal, and that binding lives in
 * fetch-index.ts, not here.
 */
describe('expectedArtifact', () => {
  it('returns the manifest sha256 and byteSize for a present artifact', () => {
    const manifest = manifestWith({ path: 'facets.json', byteSize: 42, sha256: 'a'.repeat(64) });
    expect(expectedArtifact(manifest, 'facets.json')).toEqual({ sha256: 'a'.repeat(64), byteSize: 42 });
  });

  it('returns undefined when the manifest has no entry for the path', () => {
    const manifest = manifestWith({ path: 'search-index.json', byteSize: 1, sha256: 'b'.repeat(64) });
    expect(expectedArtifact(manifest, 'facets.json')).toBeUndefined();
  });

  it('returns undefined when the manifest itself is unavailable', () => {
    expect(expectedArtifact(undefined, 'facets.json')).toBeUndefined();
  });
});

describe('verifyArtifactBytes', () => {
  it('reports a match when the hash and byte size agree', async () => {
    const text = '{"a":1}';
    await expect(verifyArtifactBytes(text, { sha256: hash(text), byteSize: text.length })).resolves.toBe('match');
  });

  it('reports a mismatch when the hash disagrees', async () => {
    const text = '{"a":1}';
    await expect(verifyArtifactBytes(text, { sha256: 'f'.repeat(64), byteSize: text.length })).resolves.toBe('mismatch');
  });

  it('fast-fails as a mismatch on byte size alone, without needing a matching hash', async () => {
    const text = '{"a":1}';
    // A byteSize that cannot possibly match `text` — the hash is irrelevant once size disagrees.
    await expect(verifyArtifactBytes(text, { sha256: hash(text), byteSize: text.length + 1 })).resolves.toBe('mismatch');
  });

  it('reports a match when no byteSize is supplied and the hash agrees', async () => {
    const text = '{"a":1}';
    await expect(verifyArtifactBytes(text, { sha256: hash(text) })).resolves.toBe('match');
  });

  it('verifies raw Uint8Array bytes directly without UTF-8 re-encoding', async () => {
    const gz = new Uint8Array(gzipSync(Buffer.from('{"a":1}', 'utf8')));
    const expectedSha = bytesToHex(sha256(gz));
    await expect(verifyArtifactBytes(gz, { sha256: expectedSha, byteSize: gz.byteLength })).resolves.toBe('match');
    await expect(verifyArtifactBytes(gz, { sha256: expectedSha, byteSize: gz.byteLength + 1 })).resolves.toBe('mismatch');
  });
});

describe('resolvePackedPath and decodeArtifactBytes', () => {
  it('prefers .json.gzbin over .json when both or .gzbin exist in manifest', () => {
    const manifest = manifestWith(
      { path: 'search-index.json', byteSize: 100, sha256: 'a'.repeat(64), entryCount: 10 },
      { path: 'search-index.json.gzbin', byteSize: 40, sha256: 'b'.repeat(64), entryCount: 10 },
    );
    expect(resolvePackedPath(manifest, 'search-index.json')).toEqual({
      path: 'search-index.json.gzbin',
      expectation: { sha256: 'b'.repeat(64), byteSize: 40 },
      entryCount: 10,
    });
  });

  it('falls back to .json when .gzbin is absent or manifest is unavailable', () => {
    const manifest = manifestWith({ path: 'search-index.json', byteSize: 100, sha256: 'a'.repeat(64), entryCount: 10 });
    expect(resolvePackedPath(manifest, 'search-index.json')).toEqual({
      path: 'search-index.json',
      expectation: { sha256: 'a'.repeat(64), byteSize: 100 },
      entryCount: 10,
    });
    expect(resolvePackedPath(undefined, 'search-index.json')).toEqual({ path: 'search-index.json' });
  });

  it('decompresses gzip magic-byte payloads and passes through plain UTF-8 bytes', async () => {
    const plain = '{"hello":"gzbin"}';
    const gz = new Uint8Array(gzipSync(Buffer.from(plain, 'utf8')));
    const raw = new TextEncoder().encode(plain);
    await expect(decodeArtifactBytes(gz)).resolves.toBe(plain);
    await expect(decodeArtifactBytes(raw)).resolves.toBe(plain);
  });
});
