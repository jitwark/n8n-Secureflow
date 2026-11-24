import { describe, expect, it } from 'vitest';
import { createConfidentialityState, createIntegrityState } from '../analyzers/taint-v2/labels';
import { transferNodeV2 } from '../analyzers/taint-v2/transfer';
import type { TaintFactV2 } from '../analyzers/taint-v2/transfer';
import { parseSourceDocument } from '../source/source-parser';
import { normalizeSecurityWorkflow } from '../workflow-v2/normalize-security-workflow';
import { BUILTIN_SEMANTIC_CATALOGUE_V2 } from './builtin-catalogue';
import { resolveReviewedNoopCandidate, REVIEWED_NOOP_CANDIDATE_BUNDLE, type ReviewedNoopCandidateQuery } from './reviewed-noop-candidate';

const eligible = (patch: Partial<ReviewedNoopCandidateQuery> = {}): ReviewedNoopCandidateQuery => ({
  type: 'n8n-nodes-base.noOp', typeVersion: '1.0.0', scoringEligibility: 'ELIGIBLE', parameters: [], ...patch,
});

function normalizedNode(nodeSource: string): ReviewedNoopCandidateQuery {
  const workflow = `{"nodes":[${nodeSource}],"connections":{}}`;
  const parsed = parseSourceDocument(new TextEncoder().encode(workflow));
  if (!parsed.ok) throw new Error('NoOp workflow fixture must parse.');
  const normalized = normalizeSecurityWorkflow(parsed.document);
  if (!normalized.ok) throw new Error('NoOp workflow fixture must normalize.');
  const node = normalized.workflow.nodes[0];
  if (node === undefined) throw new Error('NoOp node must be present.');
  return { type: node.type, typeVersion: node.typeVersion, scoringEligibility: node.scoringEligibility,
    parameters: node.parameters.map(({ pointer, value }) => ({ pointer, value })) };
}
const normalizedCandidate = (parameters: string) => normalizedNode(
  `{"name":"NoOp","type":"n8n-nodes-base.noOp","typeVersion":1,"parameters":${parameters}}`);

describe('detached exact NoOp candidate', () => {
  it('uses the real workflow parser and normalizer for exact numeric version and selector absence', () => {
    expect(normalizedCandidate('{}')).toMatchObject({ typeVersion: '1.0.0', scoringEligibility: 'ELIGIBLE', parameters: [] });
    expect(resolveReviewedNoopCandidate(normalizedCandidate('{}'))?.semanticId).toBe('noop.passthrough');
  });

  it('refuses duplicate direct selector input after real normalization', () => {
    expect(resolveReviewedNoopCandidate(normalizedCandidate('{"resource":"file","resource":"folder"}'))).toBeNull();
  });

  it('refuses duplicate type or version members after real normalization', () => {
    for (const member of ['"type":"n8n-nodes-base.noOp"', '"typeVersion":1']) {
      const duplicate = member.startsWith('"type"') ? '"type":"n8n-nodes-base.noOp","type":"n8n-nodes-base.noOp"'
        : '"typeVersion":1,"typeVersion":1';
      const node = normalizedNode(`{"name":"NoOp","type":"n8n-nodes-base.noOp",${duplicate},"typeVersion":1,"parameters":{}}`);
      expect(node.scoringEligibility).toBe('INDETERMINATE');
      expect(resolveReviewedNoopCandidate(node)).toBeNull();
    }
  });

  it('accepts real nested options data without interpreting it as a direct selector', () => {
    const query = normalizedCandidate('{"options":{"resource":"file","operation":"read"}}');
    expect(query.parameters.map((field) => field.pointer)).toEqual(['/nodes/0/parameters/options']);
    expect(resolveReviewedNoopCandidate(query)?.semanticId).toBe('noop.passthrough');
  });

  it.each(['null', '[]', '1'])('refuses malformed parameter container %s after real normalization', (parameters) => {
    const query = normalizedCandidate(parameters);
    expect(query.scoringEligibility).toBe('INDETERMINATE');
    expect(resolveReviewedNoopCandidate(query)).toBeNull();
  });

  it.each(['{"resource":"file"}', '{"operation":"read"}'])('refuses real direct selector %s', (parameters) => {
    expect(resolveReviewedNoopCandidate(normalizedCandidate(parameters))).toBeNull();
  });

  it('admits only the exact legacy record at positively absent direct selectors', () => {
    const result = resolveReviewedNoopCandidate(eligible());
    const legacy = BUILTIN_SEMANTIC_CATALOGUE_V2.records.find((item) => item.semanticId === 'noop.passthrough');
    expect(REVIEWED_NOOP_CANDIDATE_BUNDLE.records[0]).toMatchObject({
      record: legacy, resourceScope: { kind: 'ABSENT' }, operationScope: { kind: 'ABSENT' },
    });
    expect(result).toEqual(legacy);
    expect(result).toMatchObject({ effects: [], endpoints: [], errorMode: 'UNKNOWN', retryMode: 'UNKNOWN' });
  });

  it.each([undefined, '', '1.0', '1.0.1', '1.0.0-beta.1', '2.0.0'])('refuses missing, malformed, or unsupported version %s', (typeVersion) => {
    expect(resolveReviewedNoopCandidate(eligible({ typeVersion }))).toBeNull();
  });

  it('refuses other types and ineligible nodes', () => {
    expect(resolveReviewedNoopCandidate(eligible({ type: 'n8n-nodes-base.set' }))).toBeNull();
    expect(resolveReviewedNoopCandidate(eligible({ scoringEligibility: 'INDETERMINATE' }))).toBeNull();
  });

  it.each(['', null, '={{ $json.resource }}', 'file'])('refuses present resource selector %s', (value) => {
    expect(resolveReviewedNoopCandidate(eligible({ parameters: [{ pointer: '/nodes/0/parameters/resource', value }] }))).toBeNull();
  });

  it.each(['', null, '={{ $json.operation }}', 'run'])('refuses present operation selector %s', (value) => {
    expect(resolveReviewedNoopCandidate(eligible({ parameters: [{ pointer: '/nodes/0/parameters/operation', value }] }))).toBeNull();
  });

  it('ignores unrelated nested parameter paths when direct selectors are absent', () => {
    expect(resolveReviewedNoopCandidate(eligible({ parameters: [{ pointer: '/nodes/0/parameters/options/resource', value: 'file' }] }))?.semanticId).toBe('noop.passthrough');
    expect(resolveReviewedNoopCandidate(eligible({ parameters: [{ pointer: '/nodes/0/parameters/options/operation', value: 'read' }] }))?.semanticId).toBe('noop.passthrough');
  });

  it('refuses duplicate direct selectors rather than choosing either value', () => {
    expect(resolveReviewedNoopCandidate(eligible({ parameters: [
      { pointer: '/nodes/0/parameters/operation', value: 'read' },
      { pointer: '/nodes/0/parameters/operation', value: 'write' },
    ] }))).toBeNull();
  });

  it('retains observed taint labels in existing transfer while reporting UNKNOWN', () => {
    const semantics = resolveReviewedNoopCandidate(eligible());
    const node = { ref: { ordinal: 1, identityDigest: 'noop-candidate' }, type: 'n8n-nodes-base.noOp',
      disabled: false, scoringEligibility: 'ELIGIBLE', parameters: [], credentials: [], settings: [] } as never;
    const incoming: TaintFactV2 = {
      key: { node: 0, field: '/secret/nested', port: 0, item: 0 },
      confidentiality: createConfidentialityState(['WEBHOOK_BODY']),
      integrity: createIntegrityState(['MODEL_OUTPUT']),
      trace: [],
    };
    const result = transferNodeV2({ node, semantics: semantics ?? undefined, incoming: [incoming] });
    expect(result.status).toBe('UNKNOWN');
    expect(result.facts[0]).toMatchObject({
      key: { field: '/secret/nested' },
      confidentiality: { labels: ['WEBHOOK_BODY'], unknown: true },
      integrity: { labels: ['MODEL_OUTPUT'], unknown: true },
    });
  });
});
