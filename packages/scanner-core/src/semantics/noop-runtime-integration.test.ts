import { describe, expect, it } from 'vitest';
import { parseSourceDocument } from '../source/source-parser';
import { scanWorkflowV2 } from '../v2';
import { scanWorkflowDormantHardenedV2 } from '../v2/scan-workflow';
import { normalizeSecurityWorkflow } from '../workflow-v2/normalize-security-workflow';
import { BUILTIN_SEMANTIC_CATALOGUE_V2 } from './builtin-catalogue';
import { GENERIC_FALLBACK_SEMANTIC_ID, resolveNodeSemanticsForScan } from './generic-fallback';
import { NOOP_ADMISSION_PINS, REVIEWED_SCOPED_AUTHORITY_DIGEST } from './noop-admission-authority';
import { REVIEWED_NOOP_CANDIDATE_BUNDLE } from './reviewed-noop-candidate';

const encoder = new TextEncoder();
const bytes = (source: string) => encoder.encode(source);
const source = (node: string) => `{"nodes":[${node}],"connections":{}}`;

function normalized(sourceText: string) {
  const parsed = parseSourceDocument(bytes(sourceText));
  if (!parsed.ok) throw new Error(parsed.code);
  const result = normalizeSecurityWorkflow(parsed.document);
  if (!result.ok) throw new Error(result.code);
  return result.workflow;
}

function noOpBody(parameters: string, version = '1'): string {
  return source(`{"id":"noop","name":"NoOp","type":"n8n-nodes-base.noOp","typeVersion":${version},"parameters":${parameters}}`);
}

describe('approved NoOp runtime wiring', () => {
  it.each(['01', '1.01'])('retains fail-closed production behavior for malformed version %s', (typeVersion) => {
    const input = noOpBody('{}', JSON.stringify(typeVersion));
    expect(scanWorkflowV2({ bytes: bytes(input), profile: { id: 'beta-default', version: '2.0.0' } }))
      .toMatchObject({ ok: false, code: 'SEMANTIC_CATALOGUE_INVALID' });
  });

  it('admits exact 1.0.0 with direct selectors absent through the real parser and normalizer', () => {
    const node = normalized(noOpBody('{"options":{"resource":"nested","operation":"nested"}}')).nodes[0]!;
    expect(node.typeVersion).toBe('1.0.0');
    expect(node.scoringEligibility).toBe('ELIGIBLE');
    expect(resolveNodeSemanticsForScan(BUILTIN_SEMANTIC_CATALOGUE_V2, node)).toMatchObject({
      origin: 'CATALOGUE',
      semantics: {
        semanticId: 'noop.passthrough', errorMode: 'UNKNOWN', retryMode: 'UNKNOWN',
      },
    });
  });

  it.each([
    ['direct resource present', noOpBody('{"resource":"main"}')],
    ['direct operation present', noOpBody('{"operation":"run"}')],
    ['both selectors present', noOpBody('{"resource":"main","operation":"run"}')],
    ['duplicate direct selector', source('{"id":"noop","name":"NoOp","type":"n8n-nodes-base.noOp","typeVersion":1,"parameters":{"resource":"main","resource":"main"}}')],
    ['unknown version', noOpBody('{}', '2')],
    ['malformed version', noOpBody('{}', 'true')],
    ['unreadable parameters', noOpBody('null')],
  ])('refuses reviewed resolution for %s', (_label, body) => {
    const workflow = normalized(body);
    const node = workflow.nodes[0]!;
    const result = resolveNodeSemanticsForScan(BUILTIN_SEMANTIC_CATALOGUE_V2, node);
    if (node.scoringEligibility === 'INDETERMINATE') {
      expect(result).toBeNull();
    } else {
      expect(result).toMatchObject({ origin: 'GENERIC_FALLBACK', semantics: { semanticId: GENERIC_FALLBACK_SEMANTIC_ID } });
    }
  });

  it('uses one admitted identity in public scan coverage and includes it in core authority', () => {
    const input = noOpBody('{"options":{"resource":"nested","operation":"nested"}}');
    const node = normalized(input).nodes[0]!;
    const resolution = resolveNodeSemanticsForScan(BUILTIN_SEMANTIC_CATALOGUE_V2, node);
    expect(resolution?.semantics).toEqual(REVIEWED_NOOP_CANDIDATE_BUNDLE.records[0]?.record);
    const scanned = scanWorkflowV2({ bytes: bytes(input), profile: { id: 'beta-default', version: '2.0.0' } });
    expect(scanned.ok).toBe(true);
    if (!scanned.ok) return;
    expect(scanned.result.analysis.diagnostics.filter(({ code }) => code === 'SEMANTIC_CATALOGUE_MISS')).toHaveLength(0);
    expect(scanned.result.analysis.diagnostics.filter(({ code }) => code === 'GENERIC_NODE_UNMODELED_CAPABILITY')).toHaveLength(0);
    expect(scanned.result.semantics.digest).not.toBe(NOOP_ADMISSION_PINS.scopedBundleDigest);
    expect(scanned.result.engine.buildDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(REVIEWED_SCOPED_AUTHORITY_DIGEST).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps production taint source labels and unknown NoOp modes while publishing scan assessment', () => {
    const input = JSON.stringify({ nodes: [
      { id: 'source', name: 'Source', type: 'n8n-nodes-base.webhook', typeVersion: 1, parameters: { httpMethod: 'POST', path: 'in' } },
      { id: 'noop', name: 'NoOp', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
      { id: 'sink', name: 'Sink', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, parameters: { command: '={{ $json.body.cmd }}' } },
    ], connections: {
      Source: { main: [[{ node: 'NoOp', type: 'main', index: 0 }]] },
      NoOp: { main: [[{ node: 'Sink', type: 'main', index: 0 }]] },
    } });
    const scanned = scanWorkflowV2({ bytes: bytes(input), profile: { id: 'beta-default', version: '2.0.0' } });
    const taint = scanWorkflowDormantHardenedV2({ bytes: bytes(input), profile: { id: 'beta-default', version: '2.0.0' } });
    expect(scanned.ok).toBe(true);
    expect(taint.ok).toBe(true);
    if (!scanned.ok || !taint.ok) return;

    expect(scanned.result.analysis.status).toBe('COMPLETE');
    expect(scanned.result.analysis.diagnostics.some(({ code }) => code === 'GRAPH_ANALYSIS_DEGRADED')).toBe(false);
    expect(scanned.result.assessment).not.toBeNull();
    const confidentiality = taint.byCapability.get('taint-confidentiality');
    const integrity = taint.byCapability.get('taint-integrity');
    const noop = taint.context.workflow.nodes.find(({ type }) => type === 'n8n-nodes-base.noOp');
    if (!noop) throw new Error('NoOp node missing from production taint workflow');
    const semantics = taint.context.semantics.resolvedNodeSemantics.get(noop.ref.identityDigest);
    expect(semantics).toMatchObject({ semanticId: 'noop.passthrough', effects: [], overwritePaths: [], errorMode: 'UNKNOWN', retryMode: 'UNKNOWN' });
    const taintFacts = [...(confidentiality?.facts ?? []), ...(integrity?.facts ?? [])];
    const sourceFact = taintFacts.find(({ properties }) => Array.isArray(properties.taintLabels));
    if (!sourceFact) throw new Error(`Production taint seam exposed no labelled fact: ${JSON.stringify({ confidentiality, integrity, analysis: scanned.result.analysis, facts: scanned.result.facts })}`);
    expect(sourceFact.properties.taintLabels).toEqual(expect.arrayContaining(['WEBHOOK_BODY']));
    const flowFacts = taintFacts.filter(({ kind }) => kind !== 'dataflow.coverage.v1');
    expect(JSON.stringify(flowFacts)).not.toMatch(/sanitiz|declass/i);
    for (const coverage of taintFacts.filter(({ kind }) => kind === 'dataflow.coverage.v1')) {
      expect(coverage.properties).toMatchObject({ omittedSanitizers: 0, suppressedFlows: 0 });
    }
  });

  it('keeps generic refusal uncertainty and coverage diagnostics for a readable NoOp miss', () => {
    const node = normalized(noOpBody('{"resource":"main"}')).nodes[0]!;
    const resolution = resolveNodeSemanticsForScan(BUILTIN_SEMANTIC_CATALOGUE_V2, node);
    expect(resolution).toMatchObject({
      origin: 'GENERIC_FALLBACK',
      semantics: { effects: ['READ_EXTERNAL', 'WRITE_EXTERNAL'], errorMode: 'UNKNOWN', retryMode: 'UNKNOWN' },
    });
  });
});
