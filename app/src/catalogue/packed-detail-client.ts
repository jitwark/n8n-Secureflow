import type { Entry } from '@hub/contracts';
import { parseEntryJson } from '@hub/contracts/entry-artifact';
import { fetchJsonMaybeGzip, fetchTextMaybeGzip } from './gzip-fetch';
import type { Manifest } from './manifest';
import { bucketForId, bucketTag } from './pack-bucket';
import { sitePath } from '../ui/site-url.mjs';

export type PackedDetailReason = 'not-found' | 'hash-mismatch' | 'malformed' | 'network' | 'aborted';
export type PackedDetailResult = { ok: true; entry: Entry } | { ok: false; reason: PackedDetailReason };

const slugIndexCache = new Map<string, Promise<Record<string, string>>>();
const detailPackCache = new Map<string, Promise<Map<string, string>>>();

export function clearPackedDetailCache(): void {
  slugIndexCache.clear();
  detailPackCache.clear();
}

export function hasPackedDetails(manifest: Manifest): boolean {
  return manifest.artifacts.some((item) => item.path.startsWith('details/pack-') && item.path.endsWith('.jsonl.gzbin'));
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function classifyError(cause: unknown): PackedDetailReason {
  if (isAbort(cause)) return 'aborted';
  if ((cause as { code?: string } | null)?.code === 'hash-mismatch') return 'hash-mismatch';
  return 'network';
}

async function resolveSlugId(slug: string, manifest: Manifest, signal?: AbortSignal): Promise<string | null> {
  const artifact = manifest.artifacts.find((item) => item.path === 'details/slug-index.json.gzbin');
  if (!artifact) return null;
  const key = `${manifest.schemaVersion}:${manifest.generatedAt}:${artifact.sha256}`;
  let pending = slugIndexCache.get(key);
  if (!pending) {
    pending = fetchJsonMaybeGzip<Record<string, string>>(sitePath(`/${['data', artifact.path].join('/')}`), {
      expectedSha256: artifact.sha256,
      signal,
    });
    slugIndexCache.set(key, pending);
    pending.catch(() => { if (slugIndexCache.get(key) === pending) slugIndexCache.delete(key); });
  }
  const map = await pending;
  return Object.hasOwn(map, slug) && typeof map[slug] === 'string' ? map[slug] : null;
}

async function loadBucketMap(bucket: string, sha256: string, manifest: Manifest, signal?: AbortSignal): Promise<Map<string, string>> {
  const path = `details/pack-${bucket}.jsonl.gzbin`;
  const key = `${manifest.schemaVersion}:${manifest.generatedAt}:${sha256}:${bucket}`;
  let pending = detailPackCache.get(key);
  if (!pending) {
    pending = fetchTextMaybeGzip(sitePath(`/data/${path}`), { expectedSha256: sha256, signal }).then((text) => {
      const map = new Map<string, string>();
      for (const line of text.split('\n')) {
        if (!line) continue;
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === 'string') map.set(parsed.id, line);
      }
      return map;
    });
    detailPackCache.set(key, pending);
    pending.catch(() => { if (detailPackCache.get(key) === pending) detailPackCache.delete(key); });
  }
  return pending;
}

export async function loadPackedEntryDetail(
  idOrSlug: string,
  isArtifactId: boolean,
  manifest: Manifest,
  signal?: AbortSignal,
): Promise<PackedDetailResult> {
  let resolvedId = isArtifactId ? idOrSlug : '';
  if (!isArtifactId) {
    try {
      const found = await resolveSlugId(idOrSlug, manifest, signal);
      if (!found) return { ok: false, reason: 'not-found' };
      resolvedId = found;
    } catch (cause) {
      return { ok: false, reason: classifyError(cause) };
    }
  }

  const bucket = bucketTag(bucketForId(resolvedId));
  const artifact = manifest.artifacts.find((item) => item.path === `details/pack-${bucket}.jsonl.gzbin`);
  if (!artifact) return { ok: false, reason: 'not-found' };

  let bucketMap: Map<string, string>;
  try {
    bucketMap = await loadBucketMap(bucket, artifact.sha256, manifest, signal);
  } catch (cause) {
    return { ok: false, reason: classifyError(cause) };
  }

  const line = bucketMap.get(resolvedId);
  if (!line) return { ok: false, reason: 'not-found' };
  try {
    const parsed = parseEntryJson(line);
    return parsed.id === resolvedId ? { ok: true, entry: parsed } : { ok: false, reason: 'malformed' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
