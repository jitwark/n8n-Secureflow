import { analyzeAiAgentEgress, analyzeAiCapabilities } from '../analyzers/ai/ai-capability-analysis';
import { analyzeWorkflowJavaScript } from '../analyzers/code/javascript-analysis';
import { analyzeWorkflowPython } from '../analyzers/code/python-analysis';
import { evaluateExpressionSecurity } from '../analyzers/expression/expression-security';
import type { TaintAccessorV1, TaintOutcomeV1 } from '../analyzers/taint/scan-local-taint';
import { isUnsupportedTaintTriggerType } from '../analyzers/taint/taint-sources';
import type { FieldFlowAccessorV1 } from '../analyzers/taint/scan-local-workflow-flow-witnesses';
import { analyzeUnauthenticatedTriggerToSink } from '../policies/trigger-sink-policy';
import type { AnalysisDiagnosticV2 } from '../diagnostics/registry';
import type { AnalysisDiagnostic } from '../policy/policy';
import { adaptDiagnostic, admitCandidate, candidateFacts, candidateFinding, createDiagnostic, makeFact, unknownRuleDiagnostic } from './adapter-evidence';
import { toNativeWorkflow } from './adapter-workflow';
import { candidateTrace } from './candidate-trace';
import { fieldFlowCandidate } from './field-flow-candidate';
import {
  addUniqueTrace, buildWitnessTrace, canonicalRefs, failedTaint, findNode,
  findingsCandidate, hydrateContext, limitedDiagnostic, subjectDigest, uniqueDiagnostics,
} from './hardened-support';
import type { ProfileCapabilityV2, ProfileManifestV2 } from './profile-manifest';
import type { AnalyzerContextV2, CapabilityCandidateV2, FindingCandidateV2, SafeFactV2, TraceV2 } from './scheduler';

export type HardenedRunnerOptions = Readonly<{
  onRun?: () => void;
  getTaint?: TaintAccessorV1;
  getFieldFlow?: FieldFlowAccessorV1;
  manifest?: ProfileManifestV2;
  approvedDomains?: readonly string[];
  mergeLegacyTaint?: boolean;
}>;

const FAILED_TAINT_OUTCOME: TaintOutcomeV1 = Object.freeze({
  status: 'FAILED', findings: Object.freeze([]), diagnostics: Object.freeze([]),
});

export function taintOutcome(options: HardenedRunnerOptions): TaintOutcomeV1 {
  return options.getTaint?.() ?? FAILED_TAINT_OUTCOME;
}

function isV3Profile(capability: ProfileCapabilityV2, options: HardenedRunnerOptions): boolean {
  return capability.version === '3.0.0' || options.manifest?.version === '3.0.0';
}

function unmodeledTriggerNode(diagnostic: AnalysisDiagnostic, hydrated: AnalyzerContextV2) {
  if (diagnostic.code !== 'REQUIRED_STAGE_FAILURE') return undefined;
  const match = /^\/nodes\/(\d+)$/.exec(diagnostic.location?.path ?? '');
  if (!match) return undefined;
  const node = hydrated.workflow.nodes[Number(match[1])];
  return node !== undefined && isUnsupportedTaintTriggerType(node.type) ? node : undefined;
}

function adaptTaintDiagnostics(
  diagnostics: readonly AnalysisDiagnostic[],
  hydrated: AnalyzerContextV2,
  capability: ProfileCapabilityV2,
  translateUnmodeledTrigger: boolean,
): { adapted: AnalysisDiagnosticV2[]; omittedCount: number } {
  const adapted: AnalysisDiagnosticV2[] = [];
  let omittedCount = 0;
  for (const diagnostic of diagnostics) {
    const triggerNode = translateUnmodeledTrigger ? unmodeledTriggerNode(diagnostic, hydrated) : undefined;
    if (triggerNode !== undefined) {
      adapted.push(createDiagnostic('GENERIC_NODE_UNMODELED_CAPABILITY', capability.id, false, triggerNode.ref.source));
      continue;
    }
    adapted.push(adaptDiagnostic(diagnostic, hydrated, capability));
    omittedCount += 1;
  }
  return { adapted, omittedCount };
}

export function expressionCandidate(context: AnalyzerContextV2): CapabilityCandidateV2 {
  return evaluateExpressionSecurity(hydrateContext(context));
}

function numericTypeVersion(value: unknown): number | string | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const match = /^(\d+)(?:\.(\d+))?\.0$/.exec(value);
  if (!match) return value;
  return match[2] === '0' ? Number(match[1]) : Number(`${match[1]}.${match[2]}`);
}

export function codeCandidate(context: AnalyzerContextV2, capability: ProfileCapabilityV2, language: 'javascript' | 'python'): CapabilityCandidateV2 {
  const rawWorkflow = toNativeWorkflow(context);
  const workflow = {
    ...rawWorkflow,
    nodes: rawWorkflow.nodes.map((node) => {
      const version = numericTypeVersion(node.typeVersion);
      return version === undefined ? node : { ...node, typeVersion: version as unknown as typeof node.typeVersion };
    }),
  };
  const analysis = language === 'javascript' ? analyzeWorkflowJavaScript(workflow) : analyzeWorkflowPython(workflow);
  return findingsCandidate(analysis.findings, analysis.diagnostics, context, capability, workflow.nodes.length);
}

export function taintFacts(context: AnalyzerContextV2, capability: ProfileCapabilityV2, options: HardenedRunnerOptions): CapabilityCandidateV2 {
  const analysis = taintOutcome(options);
  if (analysis.status === 'FAILED') return failedTaint(context, capability);
  const hydrated = hydrateContext(context);
  const seen = hydrated.workflow.nodes.length;
  const { adapted: diagnostics, omittedCount } = adaptTaintDiagnostics(analysis.diagnostics, hydrated, capability, isV3Profile(capability, options));
  if (analysis.status === 'LIMITED') diagnostics.push(limitedDiagnostic(capability));
  const facts: SafeFactV2[] = [];
  for (const finding of analysis.findings) {
    if (!finding.policyId.startsWith('TAINTED_')) continue;
    const node = findNode(hydrated.workflow.nodes, finding.location.nodeId, finding.location.nodeName);
    if (node) candidateFacts(finding, node, facts);
  }
  const coverage = makeFact('dataflow.coverage.v1', { kind: 'WORKFLOW' }, {
    capabilityId: capability.id, coverageStatus: analysis.status === 'LIMITED' ? 'LIMITED' : 'COMPLETE',
    fieldsExamined: 0, knownFields: 0, knownEmptyFields: 0, unknownFields: 0, positiveFields: 0,
    emittedFlows: 0, suppressedFlows: 0, omittedAtoms: 0, omittedSanitizers: 0,
    unknownReasons: [], taintChannels: [], sinkChannels: [], edgeChannels: [],
    unmappedSources: 0, unmappedSinks: 0, unmappedPaths: 0, redactedPaths: 0, invalidTokens: 0, witnessUnavailable: 0, omittedTraceSteps: 0,
  });
  return admitCandidate({
    findings: [], diagnostics: uniqueDiagnostics(diagnostics), facts: [coverage, ...facts], traces: [],
    seen, analyzed: seen, skipped: 0, omitted: omittedCount + (analysis.status === 'LIMITED' ? 1 : 0),
  });
}

export function graphSemanticsCandidate(context: AnalyzerContextV2, capability: ProfileCapabilityV2, options: HardenedRunnerOptions): CapabilityCandidateV2 {
  const taint = taintOutcome(options);
  if (taint.status === 'FAILED') return failedTaint(context, capability);
  const hydrated = hydrateContext(context);
  const workflow = toNativeWorkflow(hydrated);
  const triggerSink = analyzeUnauthenticatedTriggerToSink(workflow);
  const facts: SafeFactV2[] = [];
  const { adapted: diagnostics, omittedCount } = adaptTaintDiagnostics(taint.diagnostics, hydrated, capability, isV3Profile(capability, options));
  const output: FindingCandidateV2[] = [];
  const traces: TraceV2[] = [];
  if (taint.status === 'LIMITED') diagnostics.push(limitedDiagnostic(capability));
  if (triggerSink.limitExceeded) diagnostics.push(createDiagnostic('GRAPH_ANALYSIS_DEGRADED', capability.id, capability.required));
  for (let index = 0; index < triggerSink.findings.length; index += 1) {
    const finding = triggerSink.findings[index]!;
    const witness = triggerSink.witnesses[index];
    const node = (witness ? hydrated.workflow.nodes[witness.sinkNodeIndex] : undefined)
      ?? findNode(hydrated.workflow.nodes, finding.location.nodeId, finding.location.nodeName);
    if (!node) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    const candidate = candidateFinding(finding, node, hydrated, capability, facts);
    if (!candidate) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    const trace = witness && witness.pathNodeIndexes.length > 0
      ? buildWitnessTrace(witness.pathNodeIndexes, hydrated, candidate.factRefs, hydrated.limits.maxTraceStepsPerFinding)
      : candidateTrace(finding, hydrated, candidate.factRefs, hydrated.limits.maxTraceStepsPerFinding);
    const enriched = addUniqueTrace(candidate, trace, traces);
    if (!output.some((prior) => prior.ruleId === enriched.ruleId && subjectDigest(prior.subject) === subjectDigest(enriched.subject) && canonicalRefs(prior.factRefs) === canonicalRefs(enriched.factRefs))) {
      output.push(enriched);
    }
  }
  const refs = new Set(output.flatMap((item) => item.factRefs));
  return admitCandidate({
    findings: output, diagnostics: uniqueDiagnostics(diagnostics), facts: facts.filter((fact) => refs.has(fact.factId)),
    traces, seen: workflow.nodes.length, analyzed: workflow.nodes.length, skipped: 0,
    omitted: omittedCount + (taint.status === 'LIMITED' ? 1 : 0) + (triggerSink.limitExceeded ? 1 : 0),
  });
}

export function taintIntegrityCandidate(context: AnalyzerContextV2, capability: ProfileCapabilityV2, options: HardenedRunnerOptions): CapabilityCandidateV2 {
  const base = fieldFlowCandidate(context, capability, options.getFieldFlow);
  if (options.mergeLegacyTaint === false || options.getFieldFlow === undefined || options.getTaint === undefined) return base;
  const taint = taintOutcome(options);
  if (taint.status === 'FAILED') return base;
  const hydrated = hydrateContext(context);
  const facts: SafeFactV2[] = [...base.facts];
  const output: FindingCandidateV2[] = [...base.findings];
  const traces: TraceV2[] = [...base.traces];
  const diagnostics: AnalysisDiagnosticV2[] = [...base.diagnostics];
  const covered = new Set(base.findings.map((item) => `${subjectDigest(item.subject)}:${item.ruleId}`));
  for (const finding of taint.findings) {
    if (!finding.policyId.startsWith('TAINTED_')) continue;
    const node = findNode(hydrated.workflow.nodes, finding.location.nodeId, finding.location.nodeName);
    if (!node) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    const key = `${node.ref.identityDigest}:${finding.policyId}`;
    if (covered.has(key)) continue;
    const candidate = candidateFinding(finding, node, hydrated, capability, facts);
    if (!candidate) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    covered.add(key);
    const trace = candidateTrace(finding, hydrated, candidate.factRefs, hydrated.limits.maxTraceStepsPerFinding);
    output.push(addUniqueTrace(candidate, trace, traces));
  }
  const { adapted: taintAdapted, omittedCount: taintOmitted } = adaptTaintDiagnostics(taint.diagnostics, hydrated, capability, isV3Profile(capability, options));
  diagnostics.push(...taintAdapted);
  let extraOmitted = taintOmitted;
  if (taint.status === 'LIMITED' && !diagnostics.some((item) => item.code === 'OPTIONAL_LIMIT_EXCEEDED' || item.code === 'GRAPH_ANALYSIS_DEGRADED')) {
    diagnostics.push(limitedDiagnostic(capability));
    extraOmitted += 1;
  }
  return admitCandidate({
    findings: output, diagnostics: uniqueDiagnostics(diagnostics), facts, traces,
    seen: base.seen, analyzed: base.analyzed, skipped: base.skipped, omitted: base.omitted + extraOmitted,
  });
}

export function agenticCandidate(context: AnalyzerContextV2, capability: ProfileCapabilityV2, options: HardenedRunnerOptions): CapabilityCandidateV2 {
  const taint = taintOutcome(options);
  if (taint.status === 'FAILED') return failedTaint(context, capability);
  const hydrated = hydrateContext(context);
  const workflow = toNativeWorkflow(hydrated);
  const ai = analyzeAiCapabilities(workflow, taint.propagation);
  const egressFindings = analyzeAiAgentEgress(workflow, options.approvedDomains && options.approvedDomains.length > 0 ? { approvedDomains: options.approvedDomains } : {});
  const { adapted: taintAdapted, omittedCount: taintOmitted } = adaptTaintDiagnostics(taint.diagnostics, hydrated, capability, isV3Profile(capability, options));
  const extra = taint.status === 'LIMITED' ? [...taintAdapted, limitedDiagnostic(capability)] : taintAdapted;
  const extraOmitted = taintOmitted + (taint.status === 'LIMITED' ? 1 : 0);
  return findingsCandidate(
    [...ai.findings, ...egressFindings],
    ai.diagnostics,
    hydrated, capability, workflow.nodes.length,
    extra, extraOmitted,
  );
}
