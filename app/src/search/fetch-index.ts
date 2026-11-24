import { sitePath } from '../ui/site-url.mjs';
import { sha256HexBytes } from '../catalogue/gzip-fetch';
import { loadManifest, type Manifest } from '../catalogue/manifest';
import {
  decodeResponsePayload,
  getCachedManifestForPromise,
  readResponseBytes,
  resolvePackedPath,
  setKnownManifest,
  verifyArtifactBytes,
  type ResponseBytesPayload,
} from './artifact-integrity';
import { evictStaleArtifacts, getCachedIndex, setCachedIndex } from './index-cache';
import {
  SearchIndexError,
  searchReleaseIdentityFromManifest,
  type OptionalSearchPayloadResult,
  type SearchIndexFailureKind,
  type SearchReleaseIdentity,
  type VerifiedSearchIndex,
} from './fetch-index-helpers';

export {
  SearchIndexError,
  searchReleaseIdentityFromManifest,
  formatSearchReleaseIdentity,
  sameSearchReleaseIdentity,
  classifySearchError,
  type ProgressCallback,
  type SearchIndexFailureKind,
  type SearchReleaseIdentity,
  type VerifiedSearchIndex,
  type OptionalSearchPayloadFailureReason,
  type OptionalSearchPayloadResult,
} from './fetch-index-helpers';

async function parseIndex(text: string): Promise<string> {
  try {
    const { parseSearchIndexJson } = await import('@hub/contracts/search-index-artifact');
    parseSearchIndexJson(text);
    return text;
  } catch (cause) {
    if (cause instanceof SearchIndexError) throw cause;
    throw new SearchIndexError('malformed', 'Malformed search index', { cause });
  }
}

async function fetchSearchIndexPayload(
  report: (loaded: number, total: number) => void,
  artifactPath = 'search-index.json',
): Promise<ResponseBytesPayload> {
  if (typeof fetch !== 'function') throw new SearchIndexError('unavailable', 'Search index unavailable');
  let response: Response;
  try {
    response = await fetch(sitePath(`/data/${artifactPath}`));
  } catch (cause) {
    throw new SearchIndexError('unavailable', 'Search index unavailable', { cause });
  }
  if (!response.ok) throw new SearchIndexError('http', `${artifactPath} failed (${response.status})`);

  const total = Number(response.headers?.get('content-length') ?? 0);
  if (!response.body || total <= 0) {
    try {
      const payload = await readResponseBytes(response);
      report(total > 0 ? total : 1, total > 0 ? total : 1);
      return payload;
    } catch (cause) {
      throw new SearchIndexError('unavailable', 'Search index could not be read', { cause });
    }
  }

  try {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      report(loaded, total);
    }
    const rawBytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      rawBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { rawBytes };
  } catch (cause) {
    if (cause instanceof SearchIndexError) throw cause;
    throw new SearchIndexError('unavailable', 'Search index could not be read', { cause });
  }
}

/**
 * Streams `search-index.json` (or `.json.gzbin` when resolved from manifest),
 * reporting raw compressed or uncompressed bytes as they arrive.
 */
export async function fetchSearchIndex(
  report: (loaded: number, total: number) => void,
  artifactPath = 'search-index.json',
): Promise<string> {
  const payload = await fetchSearchIndexPayload(report, artifactPath);
  try {
    return await parseIndex(await decodeResponsePayload(payload));
  } catch (cause) {
    if (cause instanceof SearchIndexError) throw cause;
    throw new SearchIndexError('malformed', 'Malformed search index', { cause });
  }
}

async function withContentIdentity(
  identity: SearchReleaseIdentity,
  artifactPath: string,
  indexJson: string,
): Promise<SearchReleaseIdentity> {
  if (!artifactPath.endsWith('.gzbin')) return identity;
  const contentSha256 = await sha256HexBytes(new TextEncoder().encode(indexJson));
  return { ...identity, contentSha256 };
}

/** Loads the manifest and rejects an index that is not a byte-for-byte member of that release. */
export async function fetchSearchIndexWithRelease(report: (loaded: number, total: number) => void): Promise<VerifiedSearchIndex> {
  const manifestPromise = loadManifest();
  let manifest: Manifest;
  try {
    manifest = await manifestPromise;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const kind: SearchIndexFailureKind = /Malformed manifest|schemaVersion|unsupported/i.test(message)
      ? 'schema'
      : /Failed to load manifest: \d+/.test(message) ? 'http' : 'unavailable';
    throw new SearchIndexError(kind, 'Search release manifest unavailable', { cause });
  }
  setKnownManifest(manifest, manifestPromise);
  const resolved = resolvePackedPath(manifest, 'search-index.json');
  const identity = searchReleaseIdentityFromManifest(manifest);
  const cached = await getCachedIndex(identity.searchIndexSha256);
  if (cached) {
    report(1, 1);
    return { indexJson: cached, identity: await withContentIdentity(identity, resolved.path, cached) };
  }
  const payload = await fetchSearchIndexPayload(report, resolved.path);
  if (resolved.expectation && (await verifyArtifactBytes(payload.rawBytes ?? payload.rawText, resolved.expectation)) === 'mismatch') {
    throw new SearchIndexError('stale-release', 'Search index does not belong to the loaded release', undefined, identity);
  }
  let indexJson: string;
  try {
    indexJson = await parseIndex(await decodeResponsePayload(payload));
  } catch (cause) {
    if (cause instanceof SearchIndexError) throw cause;
    throw new SearchIndexError('malformed', 'Malformed search index', { cause });
  }
  const fullIdentity = await withContentIdentity(identity, resolved.path, indexJson);
  void setCachedIndex(identity.searchIndexSha256, indexJson);
  void evictStaleArtifacts(identity.searchIndexSha256);
  return { indexJson, identity: fullIdentity };
}

/**
 * The extended tier: everything beyond the content-indexed top 2,000.
 * Prefers `search-index-extended.json.gzbin` when listed in the manifest.
 */
export async function fetchExtendedIndex(): Promise<OptionalSearchPayloadResult> {
  try {
    if (typeof fetch !== 'function') return { ok: false, reason: 'unavailable', retryable: true };
    const manifestPromise = loadManifest();
    let manifest = getCachedManifestForPromise(manifestPromise);
    if (!manifest) {
      manifest = await manifestPromise.catch(() => undefined);
      if (manifest) setKnownManifest(manifest, manifestPromise);
    }
    const resolved = resolvePackedPath(manifest, 'search-index-extended.json');
    let response: Response;
    try {
      response = await fetch(sitePath(`/data/${resolved.path}`));
    } catch {
      return { ok: false, reason: 'unavailable', retryable: true };
    }
    if (response.status === 404) return { ok: false, reason: 'absent', retryable: false };
    if (!response.ok) return { ok: false, reason: 'http', retryable: response.status >= 500 };
    let payload: ResponseBytesPayload;
    try {
      payload = await readResponseBytes(response);
    } catch {
      return { ok: false, reason: 'unavailable', retryable: true };
    }
    if (resolved.expectation && (await verifyArtifactBytes(payload.rawBytes ?? payload.rawText, resolved.expectation)) === 'mismatch') {
      return { ok: false, reason: 'stale-release', retryable: true };
    }
    const text = await decodeResponsePayload(payload);
    const { parseSearchIndexJson } = await import('@hub/contracts/search-index-artifact');
    parseSearchIndexJson(text);
    return { ok: true, json: text };
  } catch {
    return { ok: false, reason: 'malformed', retryable: false };
  }
}
