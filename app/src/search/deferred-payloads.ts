import { fetchExtendedIndex, type OptionalSearchPayloadResult } from './fetch-index';
import { couldUseSemanticVectors, reportRankingImproved } from './semantic-vectors';
import {
  decodeResponsePayload,
  getKnownManifest,
  readResponseBytes,
  resolvePackedPath,
  setKnownManifest,
} from './artifact-integrity';
import { sitePath } from '../ui/site-url.mjs';

/**
 * Optional search payload scheduling. The factory owns lifecycle state so tests
 * can inject adapters; the exports at the bottom preserve the browser singleton.
 */
export type PayloadTarget = {
  deliverExtended: (indexJson: string) => boolean;
  deliverSemantic: (semanticIndexJson: string) => boolean;
  version: () => number;
};

type DeferredResponse = {
  ok: boolean;
  status?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};
type SemanticHashCheck = 'match' | 'mismatch' | 'unverifiable';
type DeferredAdapters = {
  fetch?: (input: string) => Promise<DeferredResponse>;
  fetchExtended?: () => Promise<OptionalSearchPayloadResult>;
  now?: () => number;
  validateSemanticIndex?: (json: string) => void | Promise<void>;
  verifySemanticIndexHash?: (json: string) => Promise<SemanticHashCheck>;
};

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
const SEMANTIC_INDEX_PATH = 'semantic-index.json';

const defaultFetch = (input: string): Promise<DeferredResponse> => {
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
  return fetch(input);
};

const defaultValidateSemanticIndex = async (json: string): Promise<void> => {
  const { parseSemanticIndexJson } = await import('@hub/contracts/semantic-index-artifact');
  parseSemanticIndexJson(json);
};

/**
 * AUDIT-SEARCH-003: schema-valid alone accepts a stale semantic index served
 * from a mismatched CDN edge or cache. Binds it to the manifest's sha256,
 * degrading to `'unverifiable'` (accept unverified) whenever the manifest is
 * unreachable or has no entry for this artifact.
 */
const defaultVerifySemanticIndexHash = async (
  payload: string | Uint8Array,
  artifactPath = SEMANTIC_INDEX_PATH,
): Promise<SemanticHashCheck> => {
  const [{ loadManifest }, { expectedArtifact, getCachedManifestForPromise, setKnownManifest: cacheManifest, verifyArtifactBytes }] = await Promise.all([
    import('../catalogue/manifest'),
    import('./artifact-integrity'),
  ]);
  const manifestPromise = loadManifest();
  const manifest = getCachedManifestForPromise(manifestPromise) ?? (await manifestPromise.catch(() => undefined));
  if (manifest) cacheManifest(manifest, manifestPromise);
  const expected = expectedArtifact(manifest, artifactPath);
  if (!expected) return 'unverifiable';
  return verifyArtifactBytes(payload, expected);
};

export function createDeferredPayloadController(adapters: DeferredAdapters = {}) {
  const readFetch = adapters.fetch ?? defaultFetch;
  const readExtended = adapters.fetchExtended ?? fetchExtendedIndex;
  const readNow = adapters.now ?? (() => Date.now());
  const validateSemanticIndex = adapters.validateSemanticIndex ?? defaultValidateSemanticIndex;
  const customVerifySemanticIndexHash = adapters.verifySemanticIndexHash;
  let target: PayloadTarget | null = null;
  let extendedRequested = false;
  let semanticRequested = false;
  let extendedRetryAt = 0;
  let semanticRetryAt = 0;
  let extendedRetryAttempt = 0;
  let semanticRetryAttempt = 0;
  let generation = 0;

  const retryAllowed = (retryAt: number) => readNow() >= retryAt;
  const scheduleRetry = (kind: 'extended' | 'semantic') => {
    const attempt = kind === 'extended' ? extendedRetryAttempt++ : semanticRetryAttempt++;
    const retryAt = readNow() + RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
    if (kind === 'extended') extendedRetryAt = retryAt;
    else semanticRetryAt = retryAt;
  };
  const clearRetry = (kind: 'extended' | 'semantic') => {
    if (kind === 'extended') { extendedRetryAt = 0; extendedRetryAttempt = 0; }
    else { semanticRetryAt = 0; semanticRetryAttempt = 0; }
  };

  function configure(next: PayloadTarget): void { target = next; }

  function requestExtendedTier(): void {
    if (extendedRequested || !target || !retryAllowed(extendedRetryAt)) return;
    extendedRequested = true;
    const handle = target;
    const version = handle.version();
    const requestGeneration = generation;
    let pending: Promise<OptionalSearchPayloadResult>;
    try {
      pending = readExtended();
    } catch {
      extendedRequested = false;
      scheduleRetry('extended');
      return;
    }
    void pending.then((result) => {
      if (generation !== requestGeneration || handle.version() !== version) return;
      if (!result.ok) {
        if (result.retryable) { extendedRequested = false; scheduleRetry('extended'); }
        return;
      }
      clearRetry('extended');
      if (handle.deliverExtended(result.json)) reportRankingImproved();
    }).catch(() => {
      if (generation === requestGeneration && handle.version() === version) {
        extendedRequested = false;
        scheduleRetry('extended');
      }
    });
  }

  function requestSemanticVectorsFor(query: string): void {
    if (semanticRequested || !target || !couldUseSemanticVectors(query) || !retryAllowed(semanticRetryAt)) return;
    semanticRequested = true;
    const handle = target;
    const version = handle.version();
    const requestGeneration = generation;
    void (async () => {
      try {
        const resolved = resolvePackedPath(getKnownManifest(), SEMANTIC_INDEX_PATH);
        const response = await readFetch(sitePath(`/data/${resolved.path}`));
        if (generation !== requestGeneration || handle.version() !== version) return;
        if (response.status === 404) return;
        if (!response.ok) {
          if ((response.status ?? 0) >= 500) { semanticRequested = false; scheduleRetry('semantic'); }
          return;
        }
        const payload = await readResponseBytes(response);
        if (generation !== requestGeneration || handle.version() !== version) return;
        if (!customVerifySemanticIndexHash) {
          const hashCheck = await defaultVerifySemanticIndexHash(payload.rawBytes ?? payload.rawText, resolved.path);
          if (hashCheck === 'mismatch') {
            if (generation === requestGeneration && handle.version() === version) {
              semanticRequested = false;
              scheduleRetry('semantic');
            }
            return;
          }
          if (generation !== requestGeneration || handle.version() !== version) return;
        }
        let json: string;
        try {
          json = await decodeResponsePayload(payload);
          await validateSemanticIndex(json);
        } catch {
          return;
        }
        if (generation !== requestGeneration || handle.version() !== version) return;
        if (customVerifySemanticIndexHash) {
          const hashCheck = await customVerifySemanticIndexHash(json);
          if (hashCheck === 'mismatch') {
            if (generation === requestGeneration && handle.version() === version) {
              semanticRequested = false;
              scheduleRetry('semantic');
            }
            return;
          }
          if (generation !== requestGeneration || handle.version() !== version) return;
        }
        clearRetry('semantic');
        if (handle.deliverSemantic(json)) reportRankingImproved();
      } catch {
        if (generation === requestGeneration && handle.version() === version) {
          semanticRequested = false;
          scheduleRetry('semantic');
        }
      }
    })();
  }

  function reset(): void {
    generation += 1;
    extendedRequested = false;
    semanticRequested = false;
    setKnownManifest(undefined);
    clearRetry('extended');
    clearRetry('semantic');
  }

  return { configure, reset, requestExtendedTier, requestSemanticVectorsFor };
}

const singleton = createDeferredPayloadController();

export const configureDeferredPayloads = singleton.configure;
export const resetDeferredPayloads = singleton.reset;
export const requestExtendedTier = singleton.requestExtendedTier;
export const requestSemanticVectorsFor = singleton.requestSemanticVectorsFor;
