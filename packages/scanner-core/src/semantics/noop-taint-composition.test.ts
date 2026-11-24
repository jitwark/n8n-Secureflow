import { describe, expect, it } from 'vitest';
import { createConfidentialityState, createIntegrityState } from '../analyzers/taint-v2/labels';
import { runTaintWorklistV2, type TaintFactV2 } from '../analyzers/taint-v2/worklist';
import { parseSourceDocument } from '../source/source-parser';
import { scanWorkflowV2, scanWorkflowDormantHardenedV2 } from '../v2/scan-workflow';
import { normalizeSecurityWorkflow } from '../workflow-v2/normalize-security-workflow';

const bytes = (source: string) => new TextEncoder().encode(source);
const profile = { id: 'beta-default', version: '2.0.0' } as const;
const source = JSON.stringify({
  nodes: [
    { id: 'webhook', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, parameters: { httpMethod: 'POST', path: 'in' } },
    { id: 'noop-1', name: 'NoOp 1', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
    { id: 'noop-2', name: 'NoOp 2', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
  ],
  connections: {
    Webhook: { main: [[{ node: 'NoOp 1', type: 'main', index: 0 }]] },
    'NoOp 1': { main: [[{ node: 'NoOp 2', type: 'main', index: 0 }]] },
  },
});

function admittedProductionContext() {
  const parsed = parseSourceDocument(bytes(source));
  if (!parsed.ok) throw new Error(`source parse failed: ${parsed.code}`);
  const normalized = normalizeSecurityWorkflow(parsed.document);
  if (!normalized.ok) throw new Error(`workflow normalization failed: ${normalized.code}`);
  const dormant = scanWorkflowDormantHardenedV2({ bytes: bytes(source), profile });
  if (!dormant.ok) throw new Error(`production semantic admission failed: ${dormant.code}`);
  return { workflow: normalized.workflow, semantics: dormant.context.semantics.resolvedNodeSemantics };
}

describe('NoOp taint solver composition regression (does not assert public V2 solver activation)', () => {
  it('composes real production NoOp admission with the V2 worklist and retains dual labels under uncertainty', () => {
    const { workflow, semantics } = admittedProductionContext();
    const firstNoOp = workflow.nodes.find(({ ref }) => semantics.get(ref.identityDigest)?.semanticId === 'noop.passthrough');
    const secondNoOp = workflow.nodes.find(({ ref }) => ref.ordinal > (firstNoOp?.ref.ordinal ?? -1)
      && semantics.get(ref.identityDigest)?.semanticId === 'noop.passthrough');
    if (!firstNoOp || !secondNoOp) throw new Error('expected two NoOp nodes in the normalized production workflow');

    const firstSemantics = semantics.get(firstNoOp.ref.identityDigest);
    for (const node of [firstNoOp, secondNoOp]) {
      const admitted = semantics.get(node.ref.identityDigest);
      expect(admitted).toMatchObject({
        semanticId: 'noop.passthrough', effects: [], overwritePaths: [], errorMode: 'UNKNOWN', retryMode: 'UNKNOWN',
      });
      expect(admitted?.endpoints.some(({ direction }) => direction === 'SANITIZER')).toBe(false);
    }

    const seed: TaintFactV2 = {
      key: { node: firstNoOp.ref.ordinal, field: '/body', port: 0, item: 7 },
      confidentiality: createConfidentialityState(['WEBHOOK_BODY']),
      integrity: createIntegrityState(['MODEL_OUTPUT']),
      trace: [],
    };
    const result = runTaintWorklistV2({ workflow, semantics, seeds: [seed], maxTaintStates: 1_000 });
    expect(result.status).toBe('UNKNOWN');
    for (const ordinal of [firstNoOp.ref.ordinal, secondNoOp.ref.ordinal]) {
      expect(result.facts.find(({ key }) => key.node === ordinal && key.field === '/body' && key.item === 7)).toMatchObject({
        confidentiality: { labels: ['WEBHOOK_BODY'], unknown: true },
        integrity: { labels: ['MODEL_OUTPUT'], unknown: true },
      });
    }
    expect(result.facts.every(({ trace }) => trace.every(({ kind }) => kind !== 'SANITIZER'))).toBe(true);
  });

  it('reports the public scan independently without claiming it ran the V2 worklist', () => {
    const scanned = scanWorkflowV2({ bytes: bytes(source), profile });
    expect(scanned.ok).toBe(true);
    if (!scanned.ok) return;
    expect(scanned.result.schemaVersion).toBe('scanner-result-v2');
    expect(scanned.result.analysis.status).toBe('COMPLETE');
    expect(scanned.result.assessment).not.toBeNull();
    expect(scanned.result).not.toHaveProperty('taintWorklist');
  });
});
