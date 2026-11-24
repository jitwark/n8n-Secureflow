import { decodeMaybeGzipBytes } from '../catalogue/gzip-fetch';
import type { Manifest } from '../catalogue/manifest';

export type ArtifactExpectation = { sha256: string; byteSize?: number };
export type ArtifactHashStatus = 'match' | 'mismatch';
export type ResolvedArtifact = {
  path: string;
  expectation?: ArtifactExpectation;
  entryCount?: number;
};
export type ResponseBytesPayload =
  | { rawBytes: Uint8Array; rawText?: undefined }
  | { rawBytes?: undefined; rawText: string };

let knownManifest: Manifest | undefined;
let knownManifestPromise: Promise<Manifest> | undefined;

export function setKnownManifest(manifest: Manifest | undefined, sourcePromise?: Promise<Manifest>): void {
  knownManifest = manifest;
  knownManifestPromise = manifest ? sourcePromise : undefined;
}

export function getKnownManifest(): Manifest | undefined {
  return knownManifest;
}

export function getCachedManifestForPromise(promise: Promise<Manifest>): Manifest | undefined {
  return knownManifestPromise === promise ? knownManifest : undefined;
}

/**
 * AUDIT-SEARCH-003. The single lookup every optional search artifact
 * (extended index, facets, semantic index) uses to find its manifest-bound
 * identity, mirroring the primary index's binding in
 * `searchReleaseIdentityFromManifest` (fetch-index.ts) without repeating it.
 *
 * Returns `undefined` — never throws — when `manifest` is absent (the caller
 * already tried and failed to load it) or simply has no entry for `path`.
 */
export function expectedArtifact(manifest: Manifest | undefined, path: string): ArtifactExpectation | undefined {
  const artifact = manifest?.artifacts.find((candidate) => candidate.path === path);
  return artifact ? { sha256: artifact.sha256, byteSize: artifact.byteSize } : undefined;
}

/** Resolves a search artifact in `manifest`, preferring `<basePath>.gzbin` and falling back to `<basePath>`. */
export function resolvePackedPath(manifest: Manifest | undefined, basePath: string): ResolvedArtifact {
  const packedPath = basePath.endsWith('.gzbin') ? basePath : `${basePath}.gzbin`;
  const candidates = packedPath === basePath ? [basePath] : [packedPath, basePath];
  for (const candidatePath of candidates) {
    const artifact = manifest?.artifacts.find((candidate) => candidate.path === candidatePath);
    if (artifact) {
      return {
        path: artifact.path,
        expectation: { sha256: artifact.sha256, byteSize: artifact.byteSize },
        ...(artifact.entryCount !== undefined ? { entryCount: artifact.entryCount } : {}),
      };
    }
  }
  return { path: basePath };
}

export async function decodeArtifactBytes(bytes: Uint8Array): Promise<string> {
  return decodeMaybeGzipBytes(bytes);
}

export async function readResponseBytes(response: {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
}): Promise<ResponseBytesPayload> {
  if (typeof response.arrayBuffer === 'function') {
    return { rawBytes: new Uint8Array(await response.arrayBuffer()) };
  }
  if (typeof response.text === 'function') {
    return { rawText: await response.text() };
  }
  throw new Error('Response body is unreadable');
}

export async function decodeResponsePayload(payload: ResponseBytesPayload): Promise<string> {
  return payload.rawBytes !== undefined
    ? decodeArtifactBytes(payload.rawBytes)
    : payload.rawText;
}

/**
 * Hashes `payload` (raw `Uint8Array` bytes or UTF-8 string) with `@noble/hashes`
 * and compares `byteSize` and `sha256` against `expected`.
 */
export async function verifyArtifactBytes(
  payload: string | Uint8Array,
  expected: ArtifactExpectation,
): Promise<ArtifactHashStatus> {
  const encoded = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  if (expected.byteSize !== undefined && encoded.byteLength !== expected.byteSize) return 'mismatch';
  const [{ sha256 }, { bytesToHex }] = await Promise.all([
    import('@noble/hashes/sha2.js'),
    import('@noble/hashes/utils.js'),
  ]);
  return bytesToHex(sha256(encoded)) === expected.sha256 ? 'match' : 'mismatch';
}
