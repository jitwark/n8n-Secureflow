import { canonicalTargetFixture } from './canonical-target.test-helper';
import { notRequestedAdvisoryFixture } from '../../../../contracts/scanner-v2-advisory-fixture.test-helper';
import { describe, expect, it } from 'vitest';
import type { AnalysisDiagnosticV2, FindingV2, TraceV2 } from '@hub/contracts/scanner-v2-evidence';
import { validateScannerResultV2, type ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import type { SourceMemberRefV2, SubjectV2 } from '@hub/contracts/scanner-v2-source';
import type { BatchItemV2, BatchResultV2 } from './batch-runner';
import { renderMarkdownV2 } from './markdown-output';

const digest = (ch: string): string => ch.repeat(64);
const member = (pointer = '/nodes/0'): SourceMemberRefV2 => ({
  pointer,
  occurrencePath: [0],
  astNodeId: digest('a'),
  span: null,
});
const nodeSubject = (ordinal: number, name: string, pointer = `/nodes/${ordinal}`): SubjectV2 => ({
  kind: 'NODE',
  node: { ordinal, source: member(pointer), identityDigest: digest(String((ordinal % 9) + 1)), name },
});
const checked = (value: ScannerResultV2): ScannerResultV2 => {
  const validation = validateScannerResultV2(value);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  return validation.result;
};

let seq = 1;
const makeFinding = (
  ruleId: string,
  severity: FindingV2['severity'],
  confidence: FindingV2['confidence'],
  subject: SubjectV2,
  traceRefs: readonly string[] = [],
): FindingV2 => ({
  findingId: (seq++).toString(16).padStart(64, '0'),
  ruleId,
  ruleRevision: '1',
  effect: 'SCORING',
  severity,
  confidence,
  evidenceClass: ruleId.startsWith('TAINTED_') ? 'POTENTIAL_DATAFLOW' : 'CAPABILITY',
  conclusion: 'OBSERVED',
  applicability: 'APPLICABLE',
  subject,
  factRefs: [],
  traceRefs,
  remediationId: 'r',
});

const makeResult = (overrides: Partial<ScannerResultV2> = {}): ScannerResultV2 => {
  const findings = overrides.findings ?? [];
  const diagnostics = overrides.analysis?.diagnostics ?? [];
  const capOrder = ['source-normalization', 'structural-policies', 'assessment'] as const;
  const capabilities = overrides.analysis?.capabilities ?? capOrder.map((id) => ({
    id,
    version: '2.0.0',
    required: true,
    status: 'COMPLETED' as const,
    seen: overrides.workflow?.nodeCount ?? 2,
    analyzed: overrides.workflow?.nodeCount ?? 2,
    skipped: 0,
    omitted: 0,
    diagnosticIds: diagnostics.filter((d) => d.capabilityId === id).map((d) => d.id),
  }));
  const score = overrides.assessment?.score ?? (findings.some((f) => f.severity === 'CRITICAL') ? 90 : 0);
  const grade: NonNullable<ScannerResultV2['assessment']>['grade'] = score >= 80 ? 'CRITICAL' : score >= 55 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return checked({
    schemaVersion: 'scanner-result-v2',
    engine: { id: 'secureflow-scanner', version: '2.0.0', buildDigest: digest('a') },
    input: { rawSha256: digest('b'), semanticSha256: digest('c'), ambiguitySha256: digest('d'), ambiguityCount: 0, utf8Bytes: 100 },
    profile: { id: 'beta-default', version: '2.0.0' },
    ruleset: { id: 'rules', version: '2.0.0', digest: digest('e'), signatureStatus: 'VERIFIED' },
    semantics: { id: 'semantics', version: '2.0.0', digest: digest('f') },
    target: canonicalTargetFixture(),
    limits: { schemaVersion: 'scanner-limits-v2', digest: digest('1'), usage: [] },
    analysis: { status: overrides.analysis?.status ?? 'COMPLETE', capabilities, diagnostics },
    workflow: {
      name: 'PR Workflow',
      nodeCount: 4,
      rawNodeCount: 4,
      annotationNodeCount: 0,
      triggerCount: 1,
      actionCount: 3,
      integrationCount: 1,
      edgeCount: 3,
      resolvedEdgeCount: 3,
      payloadBytes: 200,
      complexity: 'LOW',
      isSubWorkflow: false,
      ...overrides.workflow,
    },
    facts: [notRequestedAdvisoryFixture(canonicalTargetFixture().contextDigest)],
    traces: overrides.traces ?? [],
    findings,
    assessment: {
      score,
      grade,
      scoringPolicyVersion: 'secureflow-risk-v2@2.0.0',
      basisFindingIds: findings.map((f) => f.findingId),
      excludedReportOnlyFindingIds: [],
      excludedUncertainFindingIds: [],
      excludedNotApplicableFindingIds: [],
      unknownEvidenceCount: 0,
    },
    stats: { rejectedCandidates: 0, collapsedCandidates: 0, omittedFindings: 0, serializedBytes: 0 },
  });
};

const batch = (items: readonly BatchItemV2[]): BatchResultV2 => ({
  ok: true,
  items,
  cancelled: false,
  completed: items.filter((item) => item.status === 'COMPLETED').length,
  failed: items.filter((item) => item.status !== 'COMPLETED').length,
  concurrency: 1,
});

describe('renderMarkdownV2', () => {
  it('renders GitHub-flavored PR comment Markdown with summary table, findings table, and collapsible details', () => {
    const traceId = digest('5');
    const trace: TraceV2 = {
      traceId,
      kind: 'INTEGRITY',
      steps: [
        { ordinal: 0, kind: 'SOURCE', subject: nodeSubject(0, 'Webhook', '/nodes/0'), factRefs: [] },
        { ordinal: 1, kind: 'SINK', subject: nodeSubject(1, 'Shell', '/nodes/1'), factRefs: [] },
      ],
    };
    const diag: AnalysisDiagnosticV2 = {
      id: digest('6'),
      code: 'GENERIC_NODE_UNMODELED_CAPABILITY',
      category: 'CATALOGUE',
      capabilityId: 'structural-policies',
      aggregateEffect: 'NONE',
      assessmentEligible: true,
      location: member('/nodes/2'),
    };
    const f1 = makeFinding('TAINTED_COMMAND', 'CRITICAL', 'HIGH', nodeSubject(1, 'Shell', '/nodes/1'), [traceId]);
    const res = makeResult({
      traces: [trace],
      findings: [f1],
      analysis: {
        status: 'COMPLETE',
        capabilities: [
          { id: 'source-normalization', version: '2.0.0', required: true, status: 'COMPLETED', seen: 4, analyzed: 4, skipped: 0, omitted: 0, diagnosticIds: [] },
          { id: 'structural-policies', version: '2.0.0', required: true, status: 'COMPLETED', seen: 4, analyzed: 4, skipped: 0, omitted: 0, diagnosticIds: [diag.id] },
          { id: 'assessment', version: '2.0.0', required: true, status: 'COMPLETED', seen: 4, analyzed: 4, skipped: 0, omitted: 0, diagnosticIds: [] },
        ],
        diagnostics: [diag],
      },
    });

    const md = renderMarkdownV2(batch([{ label: 'pr.json', status: 'COMPLETED', result: { ok: true, result: res } }]), { baselineSuppressed: 1 });

    expect(md).toContain('## ');
    expect(md).toContain('CRITICAL (90/100)');
    expect(md).toContain('| Workflow |');
    expect(md).toContain('| Severity | Confidence | Rule | Node | Title |');
    expect(md).toContain('TAINTED_COMMAND');
    expect(md).toContain('<details>');
    expect(md).toContain('<summary>');
    expect(md).toContain('</details>');
    expect(md).toContain('Webhook -> Shell');
    expect(md).toContain('**Why:**');
    expect(md).toContain('**Fix:**');
    expect(md).toContain('Baseline suppressed: 1 known finding(s)');
    expect(md).toContain('1 node evaluated using generic security rules (uncatalogued type)');
    expect(md).not.toContain('GENERIC_NODE_UNMODELED_CAPABILITY');
    expect(md).not.toContain('\u001b[');
  });

  it('escapes Markdown table/HTML injection and redacts secrets', () => {
    const token = 'xoxb-1234567890-abcdef123456';
    const hostileName = 'Flow | <script>alert(1)</script> `backtick`';
    const hostileNode = `Node | <b>bold</b> ${token}`;
    const f = makeFinding('N8N_EXECUTE_COMMAND', 'CRITICAL', 'HIGH', nodeSubject(0, hostileNode, '/nodes/0'));
    const res = makeResult({
      workflow: { name: hostileName, nodeCount: 1, rawNodeCount: 1, annotationNodeCount: 0, triggerCount: 0, actionCount: 1, integrationCount: 0, edgeCount: 0, resolvedEdgeCount: 0, payloadBytes: 100, complexity: 'LOW', isSubWorkflow: false },
      findings: [f],
    });

    const md = renderMarkdownV2(batch([{ label: 'hostile.json', status: 'COMPLETED', result: { ok: true, result: res } }]));
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('<b>bold</b>');
    expect(md).not.toContain(token);
    expect(md).toContain('[REDACTED]');
    expect(md).toContain('&lt;script&gt;');
    expect(md).toContain('\\|');
  });

  it('renders clean summary for 0-finding workflows without collapsible finding sections', () => {
    const clean = makeResult();
    const md = renderMarkdownV2(batch([{ label: 'clean.json', status: 'COMPLETED', result: { ok: true, result: clean } }]));

    expect(md).toContain('LOW (0/100)');
    expect(md).toContain('No security findings detected');
    expect(md).not.toContain('<details>');
  });

  it('handles failed batches, empty batches, error items, and multi-node collapsible details ordering', () => {
    expect(renderMarkdownV2({ ok: false, code: 'CANCELLED', message: 'Cancelled' })).toContain('> **Scan failed:** Cancelled');
    expect(renderMarkdownV2(batch([]))).toContain('No workflows scanned.');

    const res = makeResult({
      findings: [
        makeFinding('WEBHOOK_EXPOSURE', 'MEDIUM', 'MEDIUM', nodeSubject(0, 'Webhook', '/nodes/0')),
        makeFinding('EXPRESSION_SANDBOX_ESCAPE', 'CRITICAL', 'HIGH', nodeSubject(1, 'SetNode', '/nodes/1')),
      ],
    });
    const md = renderMarkdownV2(batch([
      { label: 'bad.json', status: 'FAILED', error: { code: 'MALFORMED_WORKFLOW' } },
      { label: 'multi.json', status: 'COMPLETED', result: { ok: true, result: res } },
    ]));

    expect(md).toContain('> **INPUT (`MALFORMED_WORKFLOW`):** Input is not a valid workflow.');
    const critIdx = md.indexOf('<summary><strong>[CRITICAL]</strong> SetNode');
    const medIdx = md.indexOf('<summary><strong>[MEDIUM]</strong> Webhook');
    expect(critIdx).toBeGreaterThan(-1);
    expect(medIdx).toBeGreaterThan(critIdx);
  });
});
