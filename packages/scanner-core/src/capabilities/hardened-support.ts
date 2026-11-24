import type { AnalysisDiagnostic as NativeAnalysisDiagnostic, ScanFinding } from '../policy/policy';
import type { AnalysisDiagnosticV2 } from '../diagnostics/registry';
import { createCandidateTraceId } from '../result-v2/identities';
import type { SecurityNodeV2 } from '../workflow-v2/security-workflow';
import { adaptDiagnostic, admitCandidate, candidateFinding, createDiagnostic, unknownRuleDiagnostic } from './adapter-evidence';
import { candidateTrace } from './candidate-trace';
import type { ProfileCapabilityV2 } from './profile-manifest';
import type { AnalyzerContextV2, CapabilityCandidateV2, FindingCandidateV2, SafeFactV2, TraceV2 } from './scheduler';

export function hydrateContext(context: AnalyzerContextV2): AnalyzerContextV2 {
  const rawNodes = context.workflow.nodes;
  const nodes: SecurityNodeV2[] = [];
  for (let index = 0; index < rawNodes.length; index += 1) {
    const node = rawNodes[index]!;
    nodes.push({ ...node, ref: hydrateNodeRef(node.ref), parameters: hydrateFields(node.parameters) });
  }
  return { ...context, workflow: { ...context.workflow, nodes } };
}

function hydrateNodeRef(ref: SecurityNodeV2['ref']): SecurityNodeV2['ref'] {
  return { ...ref, source: hydrateSourceRef(ref.source) };
}

function hydrateSourceRef(source: SecurityNodeV2['ref']['source']): SecurityNodeV2['ref']['source'] {
  const occurrencePath = Array.prototype.slice.call(source.occurrencePath) as number[];
  const span = source.span === null ? null : { start: { ...source.span.start }, end: { ...source.span.end } };
  return { pointer: source.pointer, occurrencePath, astNodeId: source.astNodeId, span };
}

function hydrateFields(fields: SecurityNodeV2['parameters']): SecurityNodeV2['parameters'] {
  const output: SecurityNodeV2['parameters'][number][] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const occurrences = [];
    for (let occIndex = 0; occIndex < field.occurrences.length; occIndex += 1) occurrences.push(hydrateSourceRef(field.occurrences[occIndex]!));
    const value = Array.isArray(field.value) ? hydrateFields(field.value) : field.value;
    output.push({ ...field, value, occurrences });
  }
  return output;
}

export function failedTaint(context: AnalyzerContextV2, capability: ProfileCapabilityV2): CapabilityCandidateV2 {
  const seen = context.workflow.nodes.length;
  return admitCandidate({
    findings: [], facts: [], traces: [],
    diagnostics: [createDiagnostic('REQUIRED_CAPABILITY_FAILED', capability.id, capability.required)],
    seen, analyzed: seen, skipped: 0, omitted: 1,
  });
}

export function limitedDiagnostic(capability: ProfileCapabilityV2): AnalysisDiagnosticV2 {
  return createDiagnostic('OPTIONAL_LIMIT_EXCEEDED', capability.id, capability.required, undefined, { observed: 1, maximum: 0, omitted: 1 });
}

export function findingsCandidate(findings: readonly ScanFinding[], nativeDiagnostics: readonly NativeAnalysisDiagnostic[], context: AnalyzerContextV2, capability: ProfileCapabilityV2, seen: number, extra: readonly AnalysisDiagnosticV2[] = [], extraOmitted = extra.length): CapabilityCandidateV2 {
  const hydrated = hydrateContext(context);
  const facts: SafeFactV2[] = []; const diagnostics: AnalysisDiagnosticV2[] = [...extra]; const output: FindingCandidateV2[] = []; const traces: TraceV2[] = [];
  for (const finding of findings) {
    const node = findNode(hydrated.workflow.nodes, finding.location.nodeId, finding.location.nodeName);
    if (!node) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    const candidate = candidateFinding(finding, node, hydrated, capability, facts);
    if (!candidate) { diagnostics.push(unknownRuleDiagnostic(capability)); continue; }
    const trace = candidateTrace(finding, hydrated, candidate.factRefs, hydrated.limits.maxTraceStepsPerFinding);
    output.push(addUniqueTrace(candidate, trace, traces));
  }
  for (const diagnostic of nativeDiagnostics) diagnostics.push(adaptDiagnostic(diagnostic, hydrated, capability));
  const refs = new Set(output.flatMap((item) => item.factRefs));
  return admitCandidate({ findings: output, diagnostics: uniqueDiagnostics(diagnostics), facts: facts.filter((fact) => refs.has(fact.factId)), traces, seen, analyzed: seen, skipped: 0, omitted: nativeDiagnostics.length + extraOmitted });
}

export function addUniqueTrace(candidate: FindingCandidateV2, trace: TraceV2 | undefined, traces: TraceV2[]): FindingCandidateV2 {
  if (trace === undefined) return candidate;
  if (!traces.some((item) => item.traceId === trace.traceId)) traces.push(trace);
  return { ...candidate, traceRefs: [trace.traceId] };
}

export function buildWitnessTrace(pathNodeIndexes: readonly number[], context: AnalyzerContextV2, factRefs: readonly string[], maxSteps: number): TraceV2 | undefined {
  const ordered = pathNodeIndexes.slice(0, maxSteps);
  if (ordered.length === 0) return undefined;
  const steps = ordered.map((nodeIndex, stepIndex) => {
    const stepNode = context.workflow.nodes[nodeIndex];
    if (!stepNode) return undefined;
    const node = hydrateNodeRef(stepNode.ref);
    const kind = stepIndex === 0 ? 'SOURCE' as const : stepIndex === ordered.length - 1 ? 'SINK' as const : 'PROPAGATION' as const;
    return { ordinal: stepIndex, kind, subject: { kind: 'NODE' as const, node }, factRefs: stepIndex === ordered.length - 1 ? [...factRefs].sort() : [] };
  });
  if (steps.some((step) => step === undefined)) return undefined;
  const cleanSteps = steps as NonNullable<(typeof steps)[number]>[];
  return { traceId: createCandidateTraceId({ kind: 'CONTROL', steps: cleanSteps }), kind: 'CONTROL', steps: cleanSteps };
}

export function subjectDigest(subject: FindingCandidateV2['subject']): string {
  return subject.kind === 'NODE' ? subject.node.identityDigest : subject.kind === 'SOURCE' ? subject.source.astNodeId : subject.kind;
}

export function canonicalRefs(refs: readonly string[]): string {
  return [...refs].sort().join(',');
}

export function findNode(nodes: readonly SecurityNodeV2[], id: string | undefined, name: string | undefined): SecurityNodeV2 | undefined {
  if (id === undefined && name === undefined) return undefined;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]; if (node && ((id !== undefined && node.ref.explicitId === id) || (name !== undefined && node.ref.name === name))) return node;
  }
  return undefined;
}

export function uniqueDiagnostics(values: readonly AnalysisDiagnosticV2[]): AnalysisDiagnosticV2[] {
  const seen = new Set<string>(); const output: AnalysisDiagnosticV2[] = [];
  for (const value of values) if (!seen.has(value.id)) { seen.add(value.id); output.push(value); }
  return output;
}
