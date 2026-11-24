import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalJsonBytes } from '../canonical-json';
import { BUILTIN_SEMANTIC_CATALOGUE_V2 } from './builtin-catalogue';
import { admitScopedCatalogue } from './scoped-catalogue-admission';
import type { ScopedCatalogueBundleV1 } from './scoped-catalogue-schema';
import { resolveScopedNodeSemantics, type ScopedKnown } from './scoped-catalogue-resolver';

const NODE_TYPE = 'n8n-nodes-base.noOp';
const NODE_VERSION = '1.0.0';
const directSelector = /^\/nodes\/(?:0|[1-9]\d*)\/parameters\/(resource|operation)$/;

export const NOOP_CANDIDATE_FIXTURE_VECTORS = Object.freeze([
  'exact-eligible-absent-absent', 'unsupported-or-malformed-version', 'ineligible-node',
  'present-empty-null-expression-or-value-selector', 'unrelated-nested-parameter-data',
  'duplicate-direct-selector', 'unknown-selector-or-unreadable-node',
  'legacy-error-and-retry-remain-unknown', 'existing-taint-transfer-retains-labels',
]);

const legacyRecord = BUILTIN_SEMANTIC_CATALOGUE_V2.records.find((item) => item.semanticId === 'noop.passthrough');
if (legacyRecord === undefined) throw new Error('The exact legacy NoOp record is unavailable.');

const scopedBody = Object.freeze({ schemaVersion: '1' as const, records: Object.freeze([Object.freeze({
  record: legacyRecord,
  resourceScope: Object.freeze({ kind: 'ABSENT' as const }),
  operationScope: Object.freeze({ kind: 'ABSENT' as const }),
})]), scopeReceipts: Object.freeze([]) });

export const REVIEWED_NOOP_CANDIDATE_BUNDLE: ScopedCatalogueBundleV1 = admitScopedCatalogue({
  ...scopedBody, digest: bytesToHex(sha256(canonicalJsonBytes(scopedBody))),
});

export type ReviewedNoopCandidateQuery = Readonly<{
  type: string;
  typeVersion?: string;
  scoringEligibility: 'ELIGIBLE' | 'INDETERMINATE';
  parameters: readonly Readonly<{ pointer: string; value: unknown }>[];
}>;

function directSelectorState(query: ReviewedNoopCandidateQuery, selector: 'resource' | 'operation'): ScopedKnown<string | null> {
  const fields = query.parameters.filter((field) => directSelector.exec(field.pointer)?.[1] === selector);
  if (fields.length !== 0) return { state: 'UNKNOWN', reason: fields.length > 1 ? 'DUPLICATE_SELECTOR' : 'SELECTOR_PRESENT' };
  return { state: 'KNOWN', value: null };
}

/** Pure resolver; any runtime caller must establish detached admission. */
export function resolveReviewedNoopCandidate(query: ReviewedNoopCandidateQuery) {
  if (query.type !== NODE_TYPE || query.typeVersion !== NODE_VERSION || query.scoringEligibility !== 'ELIGIBLE') return null;
  const resource = directSelectorState(query, 'resource');
  const operation = directSelectorState(query, 'operation');
  if (resource.state !== 'KNOWN' || operation.state !== 'KNOWN') return null;
  return resolveScopedNodeSemantics(REVIEWED_NOOP_CANDIDATE_BUNDLE, {
    nodeType: NODE_TYPE,
    version: { state: 'KNOWN', value: NODE_VERSION },
    resource,
    operation,
    capability: 'NODE_OBSERVED',
  });
}
