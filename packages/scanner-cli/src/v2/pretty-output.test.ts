import { canonicalTargetFixture } from './canonical-target.test-helper';
import { notRequestedAdvisoryFixture } from '../../../../contracts/scanner-v2-advisory-fixture.test-helper';
import { describe, expect, it } from 'vitest';
import type { AnalysisDiagnosticV2, FindingV2, TraceV2 } from '@hub/contracts/scanner-v2-evidence';
import { validateScannerResultV2, type ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import type { SourceMemberRefV2, SubjectV2 } from '@hub/contracts/scanner-v2-source';
import type { BatchItemV2, BatchResultV2 } from './batch-runner';
import { DEFAULT_PROJECTION_OPTIONS } from './json-output';
import { renderPrettyV2 } from './pretty-output';
import { getRuleProseV3, RULE_PROSE_V3 } from './rule-prose-v3';

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
  effect: FindingV2['effect'] = 'SCORING',
): FindingV2 => ({
  findingId: (seq++).toString(16).padStart(64, '0'),
  ruleId,
  ruleRevision: '1',
  effect,
  severity,
  confidence,
  evidenceClass: ruleId.startsWith('TAINTED_') || ruleId === 'UNAUTHENTICATED_TRIGGER_TO_SINK' ? 'POTENTIAL_DATAFLOW' : 'CAPABILITY',
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
  const capOrder = ['source-normalization', 'structural-policies', 'graph-semantics', 'assessment'] as const;
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
  const score = overrides.assessment?.score ?? (findings.some((f) => f.severity === 'CRITICAL') ? 85 : findings.some((f) => f.severity === 'HIGH') ? 60 : 0);
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
      name: 'Order Processor',
      nodeCount: 14,
      rawNodeCount: 14,
      annotationNodeCount: 0,
      triggerCount: 1,
      actionCount: 13,
      integrationCount: 1,
      edgeCount: 13,
      resolvedEdgeCount: 13,
      payloadBytes: 100,
      complexity: 'MEDIUM',
      isSubWorkflow: false,
      ...overrides.workflow,
    },
    facts: [notRequestedAdvisoryFixture(canonicalTargetFixture().contextDigest), ...(overrides.facts ?? [])],
    traces: overrides.traces ?? [],
    findings,
    assessment: overrides.assessment === null ? null : {
      score,
      grade,
      scoringPolicyVersion: 'secureflow-risk-v2@2.0.0',
      basisFindingIds: findings.filter((f) => f.effect === 'SCORING').map((f) => f.findingId),
      excludedReportOnlyFindingIds: findings.filter((f) => f.effect === 'REPORT_ONLY').map((f) => f.findingId),
      excludedUncertainFindingIds: [],
      excludedNotApplicableFindingIds: [],
      unknownEvidenceCount: 0,
      ...overrides.assessment,
    },
    stats: { rejectedCandidates: 0, collapsedCandidates: 0, omittedFindings: 0, serializedBytes: 0, ...overrides.stats },
  });
};

const batch = (items: readonly BatchItemV2[]): BatchResultV2 => ({
  ok: true,
  items,
  cancelled: items.some((item) => item.status === 'CANCELLED'),
  completed: items.filter((item) => item.status === 'COMPLETED').length,
  failed: items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'CANCELLED').length,
  concurrency: 1,
});

describe('rule-prose-v3', () => {
  it('covers all 21 v1 + v3 rules with actionable guidance', () => {
    const expectedIds = [
      'N8N_EXECUTE_COMMAND', 'N8N_CODE_NODE', 'RAW_AUTH_HEADER', 'RAW_SECRET_INDICATOR',
      'UNAPPROVED_DOMAIN', 'UNKNOWN_NODE_PACKAGE', 'WEBHOOK_EXPOSURE',
      'JAVASCRIPT_DYNAMIC_EXECUTION', 'PYTHON_DYNAMIC_EXECUTION',
      'TAINTED_COMMAND', 'TAINTED_SQL_QUERY', 'TAINTED_REQUEST_URL', 'TAINTED_FILE_PATH',
      'TAINTED_CODE_INPUT', 'TAINTED_REQUEST_HEADER', 'TAINTED_AI_PROMPT', 'AI_AGENT_UNGATED_TOOL',
      'EXPRESSION_SANDBOX_ESCAPE', 'EXPRESSION_ENV_EXPOSURE', 'AGENT_EGRESS_UNRESTRICTED', 'UNAUTHENTICATED_TRIGGER_TO_SINK',
    ];
    expect(Object.keys(RULE_PROSE_V3)).toHaveLength(21);
    for (const id of expectedIds) {
      const prose = getRuleProseV3(id);
      expect(prose.ruleId).toBe(id);
      expect(prose.title.length).toBeGreaterThan(5);
      expect(prose.whyItMatters.length).toBeGreaterThan(10);
      expect(prose.remediation.length).toBeGreaterThan(10);
      expect(prose.remediationSteps.length).toBeGreaterThan(0);
    }
  });
});

describe('renderPrettyV2', () => {
  it('renders a clean 0-finding workflow with grade, severity counts, and plain-English coverage', () => {
    const clean = makeResult({ workflow: { name: 'Clean Flow', nodeCount: 14, rawNodeCount: 14, annotationNodeCount: 0, triggerCount: 1, actionCount: 13, integrationCount: 0, edgeCount: 13, resolvedEdgeCount: 13, payloadBytes: 100, complexity: 'LOW', isSubWorkflow: false } });
    const output = renderPrettyV2(batch([{ label: 'clean.json', status: 'COMPLETED', result: { ok: true, result: clean } }]), { noColor: true });

    expect(output).toContain('Clean Flow');
    expect(output).toContain('LOW (0/100)');
    expect(output).toContain('0 Critical');
    expect(output).toContain('Analysis: Complete');
    expect(output).toContain('14/14 nodes inspected');
    expect(output).toContain('No findings');
    expect(output).not.toContain('\u001b[');
  });

  it('renders critical workflow findings grouped by node with trace paths, Why, Fix, and uncatalogued plain-English coverage', () => {
    const traceId = digest('9');
    const trace: TraceV2 = {
      traceId,
      kind: 'INTEGRITY',
      steps: [
        { ordinal: 0, kind: 'SOURCE', subject: nodeSubject(0, 'Webhook', '/nodes/0'), factRefs: [] },
        { ordinal: 1, kind: 'PROPAGATION', subject: nodeSubject(1, 'NoOp', '/nodes/1'), factRefs: [] },
        { ordinal: 2, kind: 'SINK', subject: nodeSubject(2, 'Exec', '/nodes/2'), factRefs: [] },
      ],
    };
    const diagCatalogue: AnalysisDiagnosticV2 = {
      id: digest('7'),
      code: 'SEMANTIC_CATALOGUE_MISS',
      category: 'CATALOGUE',
      capabilityId: 'structural-policies',
      aggregateEffect: 'NONE',
      assessmentEligible: true,
      location: member('/nodes/1'),
    };
    const diagDegraded: AnalysisDiagnosticV2 = {
      id: digest('8'),
      code: 'GRAPH_ANALYSIS_DEGRADED',
      category: 'GRAPH',
      capabilityId: 'graph-semantics',
      aggregateEffect: 'DEGRADED',
      assessmentEligible: true,
    };
    const execSubject = nodeSubject(2, 'Exec', '/nodes/2');
    const webhookSubject = nodeSubject(0, 'Webhook', '/nodes/0');
    const findings: FindingV2[] = [
      makeFinding('WEBHOOK_EXPOSURE', 'MEDIUM', 'MEDIUM', webhookSubject),
      makeFinding('N8N_EXECUTE_COMMAND', 'CRITICAL', 'HIGH', execSubject),
      makeFinding('TAINTED_COMMAND', 'CRITICAL', 'HIGH', execSubject, [traceId]),
      makeFinding('EXPRESSION_ENV_EXPOSURE', 'HIGH', 'HIGH', execSubject),
    ];
    const crit = makeResult({
      workflow: { name: 'Webhook Runner', nodeCount: 3, rawNodeCount: 3, annotationNodeCount: 0, triggerCount: 1, actionCount: 2, integrationCount: 0, edgeCount: 2, resolvedEdgeCount: 2, payloadBytes: 250, complexity: 'MEDIUM', isSubWorkflow: false },
      traces: [trace],
      findings,
      analysis: {
        status: 'DEGRADED',
        capabilities: [
          { id: 'source-normalization', version: '2.0.0', required: true, status: 'COMPLETED', seen: 3, analyzed: 3, skipped: 0, omitted: 0, diagnosticIds: [] },
          { id: 'structural-policies', version: '2.0.0', required: true, status: 'COMPLETED', seen: 3, analyzed: 3, skipped: 0, omitted: 0, diagnosticIds: [diagCatalogue.id] },
          { id: 'graph-semantics', version: '2.0.0', required: false, status: 'DEGRADED', seen: 3, analyzed: 2, skipped: 1, omitted: 0, diagnosticIds: [diagDegraded.id] },
          { id: 'assessment', version: '2.0.0', required: true, status: 'COMPLETED', seen: 3, analyzed: 3, skipped: 0, omitted: 0, diagnosticIds: [] },
        ],
        diagnostics: [diagCatalogue, diagDegraded],
      },
    });

    const output = renderPrettyV2(
      batch([{ label: 'workflow.json', status: 'COMPLETED', result: { ok: true, result: crit } }]),
      { projection: DEFAULT_PROJECTION_OPTIONS, noColor: true, baselineSuppressed: 2 },
    );

    expect(output).toContain('CRITICAL (85/100)');
    expect(output).toContain('2 Critical · 1 High · 1 Medium');
    expect(output).toContain('[CRITICAL | HIGH] N8N_EXECUTE_COMMAND');
    expect(output).toContain('[CRITICAL | HIGH] TAINTED_COMMAND');
    expect(output).toContain('[HIGH | HIGH] EXPRESSION_ENV_EXPOSURE');
    expect(output).toContain('Where:');
    expect(output).toContain('Exec');
    expect(output).toContain('/nodes/2');
    expect(output).toContain('Trace:');
    expect(output).toContain('Webhook -> NoOp -> Exec');
    expect(output).toContain('Why:');
    expect(output).toContain('Fix:');
    expect(output).toContain('1 node evaluated using generic security rules (uncatalogued type)');
    expect(output).toContain('Baseline suppressed: 2 known finding(s)');
    expect(output).not.toContain('SEMANTIC_CATALOGUE_MISS');
    expect(output).not.toContain('GENERIC_NODE_UNMODELED_CAPABILITY');
    expect(output).not.toContain('GRAPH_ANALYSIS_DEGRADED');
    expect(output).not.toContain('\u001b[');
  });

  it('emits ANSI badges when color mode is enabled and suppresses all ANSI codes when noColor is true', () => {
    const f = makeFinding('N8N_EXECUTE_COMMAND', 'CRITICAL', 'HIGH', nodeSubject(0, 'Exec', '/nodes/0'));
    const res = makeResult({ findings: [f] });
    const b = batch([{ label: 'exec.json', status: 'COMPLETED', result: { ok: true, result: res } }]);

    const colored = renderPrettyV2(b);
    const plain = renderPrettyV2(b, { noColor: true });

    expect(colored).toContain('\u001b[');
    expect(colored).toContain('CRITICAL');
    expect(plain).not.toContain('\u001b[');
    expect(plain).toContain('CRITICAL (85/100)');
  });

  it('accepts ProjectionOptionsV2 or ProjectionFormatV2 directly and keeps formatter profile-agnostic', () => {
    const res = makeResult();
    const b = batch([{ label: 'flow.json', status: 'COMPLETED', result: { ok: true, result: res } }]);
    const fromFormat = renderPrettyV2(b, 'table');
    const fromOptions = renderPrettyV2(b, DEFAULT_PROJECTION_OPTIONS);

    expect(fromFormat).toContain('Order Processor');
    expect(fromOptions).toContain('beta-default');
  });

  it('escapes control characters, terminal ANSI sequences, and redacts secret-like patterns in hostile workflow inputs', () => {
    const c1Escape = '\u009b31mFAKE_INJECT';
    const ghCanary = ['ghp', '1234567890abcdef1234567890abcdef1234'].join('_');
    const dsn = ['postgres://', 'admin', ':', 'supersecret', '@db.internal:5432/prod'].join('');
    const hostileName = `Evil\nFlow\r\t${c1Escape} ${ghCanary}`;
    const hostileNode = `Node\n${dsn}`;
    const f = makeFinding('N8N_EXECUTE_COMMAND', 'CRITICAL', 'HIGH', nodeSubject(0, hostileNode, '/nodes/0'));
    const res = makeResult({
      workflow: { name: hostileName, nodeCount: 1, rawNodeCount: 1, annotationNodeCount: 0, triggerCount: 0, actionCount: 1, integrationCount: 0, edgeCount: 0, resolvedEdgeCount: 0, payloadBytes: 100, complexity: 'LOW', isSubWorkflow: false },
      findings: [f],
    });
    const b = batch([{ label: 'bad\u001b[31m\nlabel.json', status: 'COMPLETED', result: { ok: true, result: res } }]);

    const output = renderPrettyV2(b, { noColor: true });
    expect(output).not.toContain('\u001b[');
    expect(output).not.toContain('\u009b');
    expect(output).not.toContain('Evil\nFlow');
    expect(output).not.toContain(ghCanary);
    expect(output).not.toContain('supersecret');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('\\n');
    expect(output).toContain('\\u009b');
  });

  it('handles failed batches, empty batches, item errors, indeterminate results, parameterPath facts, and multiple uncatalogued nodes', () => {
    expect(renderPrettyV2({ ok: false, code: 'INVALID_CONFIG', message: 'Bad\nconfig' }, { noColor: true }))
      .toBe('Scan failed: Bad\\nconfig\n');
    expect(renderPrettyV2(batch([]), { noColor: true })).toBe('No workflows scanned.\n');

    const factId = digest('4');
    const finding = {
      ...makeFinding('UNAUTHENTICATED_TRIGGER_TO_SINK', 'CRITICAL', 'HIGH', nodeSubject(1, 'Exec', '/nodes/1')),
      factRefs: [factId],
    };
    const diagA: AnalysisDiagnosticV2 = {
      id: digest('5'),
      code: 'SEMANTIC_CATALOGUE_MISS',
      category: 'CATALOGUE',
      capabilityId: 'structural-policies',
      aggregateEffect: 'NONE',
      assessmentEligible: true,
      location: member('/nodes/1'),
    };
    const diagB: AnalysisDiagnosticV2 = {
      id: digest('6'),
      code: 'GENERIC_NODE_UNMODELED_CAPABILITY',
      category: 'CATALOGUE',
      capabilityId: 'structural-policies',
      aggregateEffect: 'NONE',
      assessmentEligible: true,
      location: member('/nodes/2'),
    };
    const diagParse: AnalysisDiagnosticV2 = {
      id: digest('7'),
      code: 'EXPRESSION_PARSE_FAILED',
      category: 'PARSER',
      capabilityId: 'structural-policies',
      aggregateEffect: 'INDETERMINATE',
      assessmentEligible: false,
      location: member('/nodes/1'),
    };
    const indeterminate = makeResult({
      workflow: { name: null, nodeCount: 3, rawNodeCount: 3, annotationNodeCount: 0, triggerCount: 1, actionCount: 2, integrationCount: 0, edgeCount: 2, resolvedEdgeCount: 2, payloadBytes: 150, complexity: 'LOW', isSubWorkflow: false },
      facts: [{
        factId,
        kind: 'node.configuration.v2',
        subject: nodeSubject(1, 'Exec', '/nodes/1'),
        properties: { parameterPath: '/parameters/command' },
      }],
      findings: [finding],
      assessment: null,
      analysis: {
        status: 'INDETERMINATE',
        capabilities: [
          { id: 'source-normalization', version: '2.0.0', required: true, status: 'COMPLETED', seen: 3, analyzed: 3, skipped: 0, omitted: 0, diagnosticIds: [] },
          { id: 'structural-policies', version: '2.0.0', required: true, status: 'FAILED', seen: 3, analyzed: 2, skipped: 1, omitted: 0, diagnosticIds: [diagA.id, diagB.id, diagParse.id] },
          { id: 'assessment', version: '2.0.0', required: true, status: 'SKIPPED', seen: 3, analyzed: 0, skipped: 3, omitted: 0, diagnosticIds: [] },
        ],
        diagnostics: [diagA, diagB, diagParse],
      },
    });
    const output = renderPrettyV2(batch([
      { label: 'broken.json', status: 'FAILED', error: { code: 'INVALID_JSON' } },
      { label: 'indet.json', status: 'COMPLETED', result: { ok: true, result: indeterminate } },
    ]), { noColor: true, baselineSuppressed: 0 });

    expect(output).toContain('broken.json — INPUT (INVALID_JSON): Input is not valid JSON.');
    expect(output).toContain('indet.json — INDETERMINATE (assessment unavailable)');
    expect(output).toContain('Exec (/nodes/1 · /parameters/command)');
    expect(output).toContain('2 nodes evaluated using generic security rules (uncatalogued type)');
    expect(output).toContain('some expressions or code blocks could not be fully parsed');
    expect(output).not.toContain('Baseline suppressed');
    expect(output).not.toContain('EXPRESSION_PARSE_FAILED');
    expect(output).not.toContain('SEMANTIC_CATALOGUE_MISS');
  });
});
