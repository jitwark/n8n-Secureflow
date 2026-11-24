import type { FindingV2, SafeFactV2 } from '@hub/contracts/scanner-v2-evidence';
import { validateScannerResultV2, type ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import type { NodeRefV2, SourceMemberRefV2, SubjectV2 } from '@hub/contracts/scanner-v2-source';
import type { ProjectionResult, ProjectionResultV1, V1Diagnostic, V1Finding, V1Location, V1ProjectionOptions } from '@hub/scanner-core/compat/v1-projector';
import { SUPPORTED_SCANNER_VERSIONS, V1_DIAGNOSTIC_CROSSWALK } from '@hub/scanner-core/compat/v1-registry';
import { RULE_EVIDENCE_PROJECTION_V3, RULE_PROSE_V3 } from './v3-rule-prose';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const ADMITTED_V3_PROFILES = new Set(['standard@3.0.0', 'strict@3.0.0', 'beta-hardened@2.0.0']);
type Plain = Record<string, unknown>;

function nodeUniqueness(findings: readonly FindingV2[]): { ids: Map<string, boolean>; names: Map<string, boolean> } {
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  for (const finding of findings) {
    if (finding.subject.kind !== 'NODE') continue;
    const node = finding.subject.node;
    if (node.explicitId) ids.set(node.explicitId, ids.has(node.explicitId) && ids.get(node.explicitId) !== node.identityDigest ? '' : node.identityDigest);
    if (node.name) names.set(node.name, names.has(node.name) && names.get(node.name) !== node.identityDigest ? '' : node.identityDigest);
  }
  return {
    ids: new Map([...ids].map(([key, value]) => [key, value !== ''])),
    names: new Map([...names].map(([key, value]) => [key, value !== ''])),
  };
}

function projectLocation(value: SubjectV2, ids: ReadonlyMap<string, boolean>, names: ReadonlyMap<string, boolean>, hasLeadingBom: boolean): V1Location {
  let ref: SourceMemberRefV2 | undefined;
  let node: NodeRefV2 | undefined;
  if (value.kind === 'NODE') { node = value.node; ref = node.source; }
  else if (value.kind === 'SOURCE') ref = value.source;
  else if (value.kind === 'EDGE') ref = value.edge.source;
  else return {};
  const location: Plain = {};
  if (node?.explicitId && ids.get(node.explicitId)) location.nodeId = node.explicitId;
  if (node?.name && names.get(node.name)) location.nodeName = node.name;
  if (ref.pointer) location.path = ref.pointer;
  if (ref.span) {
    const projectPos = (pos: NonNullable<SourceMemberRefV2['span']>['start']) => ({
      line: pos.line,
      column: pos.column + (hasLeadingBom && pos.line === 1 ? 1 : 0),
      offset: pos.utf16Offset + (hasLeadingBom ? 1 : 0),
    });
    location.sourceSpan = { start: projectPos(ref.span.start), end: projectPos(ref.span.end) };
  }
  return location as V1Location;
}

function provenanceNode(fact: SafeFactV2, facts: ReadonlyMap<string, SafeFactV2>): NodeRefV2 | undefined {
  const reference = fact.properties.sourceProvenanceFactId;
  if (typeof reference !== 'string') return undefined;
  const origin = facts.get(reference);
  return origin?.kind === 'dataflow.provenance.v1' && origin.subject.kind === 'NODE' ? origin.subject.node : undefined;
}

function buildEvidence(finding: FindingV2, facts: ReadonlyMap<string, SafeFactV2>): Plain {
  const spec = RULE_EVIDENCE_PROJECTION_V3.get(finding.ruleId);
  if (!spec) return {};
  const out: Plain = {};
  for (const item of spec) {
    const candidates = finding.factRefs.map((ref) => facts.get(ref)).filter((fact): fact is SafeFactV2 => Boolean(fact && fact.kind === item.factKind));
    if (candidates.length !== 1) continue;
    const fact = candidates[0]!;
    if (item.derive) {
      const node = provenanceNode(fact, facts);
      const derived = item.derive === 'PROVENANCE_SOURCE_NODE_ID' ? node?.explicitId : node?.name;
      if (derived !== undefined) out[item.v1Key] = derived;
      continue;
    }
    const value = fact.properties[item.factProperty];
    if (value === undefined) continue;
    if (item.v1Key === 'domain' && (fact.properties.authorityState !== 'KNOWN' || typeof value !== 'string')) continue;
    if (item.factKind === 'code.indicator.v2' && fact.properties.parseState === 'FAILED') continue;
    if (item.factKind === 'node.configuration.v2' && (
      (item.factProperty === 'header' && fact.properties.observation !== 'AUTH_HEADER') ||
      (item.factProperty === 'parameterPath' && fact.properties.observation !== 'SECRET_INDICATOR')
    )) continue;
    out[item.v1Key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function compareFinding(left: V1Finding, right: V1Finding): number {
  const rank = (value: V1Finding) => `${SEVERITIES.indexOf(value.severity as never)}|${value.policyId}|${value.policyEffect}|${value.confidence}|${JSON.stringify(value.location)}|${value.title}`;
  return rank(left).localeCompare(rank(right));
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function buildHumanSummary(
  profileId: string,
  workflow: Plain,
  fn: Plain,
  risk: Plain,
  counts: Record<string, number>,
  findings: readonly V1Finding[],
  integrations: readonly Plain[],
): Plain {
  const grade = String(risk.grade);
  const headline = counts.critical > 0 || grade === 'CRITICAL'
    ? 'This workflow has critical risk and needs immediate security review.'
    : grade === 'HIGH' ? 'This workflow is high risk and needs security review before production.'
      : grade === 'MEDIUM' ? 'This workflow is medium risk and should be reviewed before production.'
        : `This workflow is low risk based on the ${profileId} policy set.`;
  const verdict = grade === 'HIGH' || grade === 'CRITICAL'
    ? 'Do not move this workflow into production until the highlighted issues are reviewed and remediated.'
    : grade === 'MEDIUM'
      ? 'Review the highlighted issues before production use.'
      : 'No major security policy risks were detected. This is a scanner result, not a final production approval.';
  const services = integrations.filter((item) => !String(item.service).toLowerCase().includes('trigger')).slice(0, 3).map((item) => String(item.service));
  const overview = `${workflow.name ?? 'This workflow'} has ${workflow.nodeCount} ${Number(workflow.nodeCount) === 1 ? 'node' : 'nodes'}, ${workflow.triggerCount} ${Number(workflow.triggerCount) === 1 ? 'trigger' : 'triggers'}, and ${workflow.connectionCount} configured ${Number(workflow.connectionCount) === 1 ? 'connection' : 'connections'}. It ${services.length ? `uses ${formatList(services)}` : 'uses no recognized external service'}. ${fn.triggerDescription}`;
  const parts = [['critical', counts.critical], ['high', counts.high], ['medium', counts.medium], ['low', counts.low]].filter((entry) => Number(entry[1]) > 0).map((entry) => `${entry[1]} ${entry[0]}`);
  const actions = [...new Set(findings.flatMap((item) => [...item.remediationSteps]))].slice(0, 5);
  if (!actions.length) {
    actions.push(grade === 'LOW'
      ? 'Keep this workflow in normal review and re-scan it when nodes, credentials, or destinations change.'
      : 'Review the scanner findings before approving this workflow for production use.');
  }
  return {
    headline,
    verdict,
    plainLanguageOverview: overview,
    riskNarrative: `${parts.length ? `The scan found ${formatList(parts)}.` : 'The scan found no findings.'} ${risk.dataExposure}`,
    recommendedActions: actions,
    findingHighlights: findings.length
      ? findings.slice(0, 5).map((item) => `${item.severity}: ${item.title}${item.location.nodeName ? ` in ${item.location.nodeName}` : item.location.path ? ` at ${item.location.path}` : ''}.`)
      : [`No findings were returned by the ${profileId} policy set.`],
  };
}

export function projectV3ToReportShape(input: ScannerResultV2, options: V1ProjectionOptions = {}): ProjectionResult {
  const profileKey = `${input.profile?.id ?? ''}@${input.profile?.version ?? ''}`;
  if (!ADMITTED_V3_PROFILES.has(profileKey)) return { ok: false, code: 'PROJECTION_FAILED', reason: 'UNKNOWN_PROFILE' };
  if (input.engine?.id !== 'secureflow-scanner' || !SUPPORTED_SCANNER_VERSIONS.includes(input.engine.version as never)) {
    return { ok: false, code: 'PROJECTION_FAILED', reason: 'UNKNOWN_ENGINE' };
  }
  const checked = validateScannerResultV2(input);
  if (!checked.ok) return { ok: false, code: 'PROJECTION_FAILED', reason: 'INVALID_RESULT' };
  const result = checked.result;
  const hasLeadingBom = options.hasLeadingBom === true;
  const facts = new Map<string, SafeFactV2>(result.facts.map((fact) => [fact.factId, fact]));
  const summaryFact = result.facts.find((fact) => fact.kind === 'workflow.summary.v1' && fact.subject.kind === 'WORKFLOW');
  const functionFact = result.facts.find((fact) => fact.kind === 'workflow.function.v1' && fact.subject.kind === 'WORKFLOW');
  const riskFact = result.facts.find((fact) => fact.kind === 'workflow.risk-summary.v1' && fact.subject.kind === 'WORKFLOW');
  const workflowOut: Plain = {
    name: result.workflow.name,
    nodeCount: result.workflow.nodeCount,
    rawNodeCount: result.workflow.rawNodeCount,
    annotationNodeCount: result.workflow.annotationNodeCount,
    triggerCount: result.workflow.triggerCount,
    actionCount: result.workflow.actionCount,
    integrationCount: result.workflow.integrationCount,
    connectionCount: typeof summaryFact?.properties.connectionCount === 'number' ? summaryFact.properties.connectionCount : result.workflow.resolvedEdgeCount,
    payloadBytes: result.workflow.payloadBytes,
    complexity: result.workflow.complexity,
    isSubWorkflow: result.workflow.isSubWorkflow,
  };
  const functionSummary: Plain = {
    basicPurpose: String(functionFact?.properties.basicPurpose ?? 'Workflow automation'),
    triggerDescription: String(functionFact?.properties.triggerDescription ?? 'Trigger behavior analyzed statically.'),
    dataFlowSummary: String(functionFact?.properties.dataFlowSummary ?? 'Static workflow analysis.'),
    businessCategory: String(functionFact?.properties.businessCategory ?? 'General automation'),
    confidence: String(functionFact?.properties.confidence ?? 'MEDIUM'),
  };
  const integrations: Plain[] = result.facts
    .filter((fact) => fact.kind === 'integration.v1' && fact.subject.kind === 'WORKFLOW')
    .map((fact) => ({
      service: String(fact.properties.service ?? 'Unknown integration'),
      nodeTypes: Array.isArray(fact.properties.nodeTypes) ? [...(fact.properties.nodeTypes as string[])].sort() : [],
      nodeCount: Number(fact.properties.nodeCount ?? 0),
      usage: String(fact.properties.usage ?? ''),
      riskNotes: Array.isArray(fact.properties.riskNotes) ? [...(fact.properties.riskNotes as string[])] : [],
    }))
    .sort((left, right) => String(left.service).localeCompare(String(right.service)));
  const uniqueness = nodeUniqueness(result.findings);
  const findings: V1Finding[] = [];
  for (const item of result.findings) {
    const prose = RULE_PROSE_V3.get(item.ruleId);
    if (!prose) return { ok: false, code: 'PROJECTION_FAILED', reason: 'UNKNOWN_RULE' };
    findings.push({
      policyId: item.ruleId,
      policyEffect: item.effect === 'SCORING' ? 'LEGACY_SCORE' : 'REPORT_ONLY',
      severity: item.severity,
      confidence: item.confidence,
      location: projectLocation(item.subject, uniqueness.ids, uniqueness.names, hasLeadingBom),
      evidence: buildEvidence(item, facts),
      title: prose.title,
      message: prose.message,
      explanation: prose.explanation,
      whyItMatters: prose.whyItMatters,
      possibleImpact: prose.possibleImpact,
      remediation: prose.remediation,
      remediationSteps: [...prose.remediationSteps],
    });
  }
  findings.sort(compareFinding);
  const diagnostics: V1Diagnostic[] = [];
  for (const item of result.analysis.diagnostics) {
    const mapped = V1_DIAGNOSTIC_CROSSWALK.find((entry) => entry.v2Code === item.code);
    if (!mapped || item.aggregateEffect === 'NONE') continue;
    const location = item.location ? projectLocation({ kind: 'SOURCE', source: item.location }, uniqueness.ids, uniqueness.names, hasLeadingBom) : undefined;
    diagnostics.push({ code: mapped.v1Code, category: mapped.category, ...(location ? { location } : {}) });
  }
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const item of findings) counts[item.severity.toLowerCase()] = (counts[item.severity.toLowerCase()] ?? 0) + 1;
  const output: Plain = {
    schemaVersion: 'scanner-result-v1',
    scannerVersion: result.engine.version,
    policyProfile: result.profile.id,
    analysisStatus: result.analysis.status,
    analysisDiagnostics: diagnostics,
    workflow: workflowOut,
    functionSummary,
    integrations,
    findings,
  };
  if (result.analysis.status !== 'INDETERMINATE' && result.assessment !== null) {
    const topRisks = Array.isArray(riskFact?.properties.topRisks) ? [...(riskFact.properties.topRisks as string[])] : [];
    const dataExposure = String(riskFact?.properties.dataExposure ?? 'No external exposure was identified.');
    const complexityDrivers = Array.isArray(riskFact?.properties.complexityDrivers) ? [...(riskFact.properties.complexityDrivers as string[])] : [];
    output.riskAssessment = { score: result.assessment.score, grade: result.assessment.grade, topRisks, dataExposure, complexityDrivers };
    output.humanSummary = buildHumanSummary(result.profile.id, workflowOut, functionSummary, output.riskAssessment as Plain, counts, findings, integrations);
    output.summary = counts;
  }
  return { ok: true, result: output as ProjectionResultV1 };
}
