import type { AnalysisDiagnosticV2, FindingV2, SafeFactV2, TraceV2 } from '@hub/contracts/scanner-v2-evidence';
import type { ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import type { SubjectV2 } from '@hub/contracts/scanner-v2-source';
import { redactText } from '@hub/scanner-core/redaction';
import { coverageOmissionsV2 } from '@hub/scanner-core/report/sarif-v2/output';
import type { BatchResultV2 } from './batch-runner';
import { DEFAULT_PROJECTION_OPTIONS, projectBatchV2, type ProjectedBatchV2, type ProjectionFormatV2, type ProjectionOptionsV2 } from './json-output';
import { getRuleProseV3 } from './rule-prose-v3';

export type HumanRenderOptionsV2 = Readonly<{
  projection?: ProjectionOptionsV2 | ProjectionFormatV2;
  noColor?: boolean;
  baselineSuppressed?: number;
}>;
export type ResolvedHumanOptionsV2 = Readonly<{
  projection: ProjectionOptionsV2 | ProjectionFormatV2;
  noColor: boolean;
  baselineSuppressed: number;
}>;
export type FindingGroupV2 = Readonly<{
  groupKey: string;
  nodeLabel: string;
  pointer: string;
  ordinal: number;
  findings: readonly FindingV2[];
}>;
export type SeveritySummaryV2 = Readonly<{ total: number; CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number; INFO: number }>;

type ProjectedItem = ProjectedBatchV2['items'][number];
const SEVERITY_ORDER: Readonly<Record<FindingV2['severity'], number>> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const ANSI_BADGE: Readonly<Record<string, string>> = {
  CRITICAL: '\u001b[1;31mCRITICAL\u001b[0m',
  HIGH: '\u001b[31mHIGH\u001b[0m',
  MEDIUM: '\u001b[33mMEDIUM\u001b[0m',
  LOW: '\u001b[36mLOW\u001b[0m',
  INFO: '\u001b[90mINFO\u001b[0m',
  INDETERMINATE: '\u001b[35mINDETERMINATE\u001b[0m',
};
const SHORT_SECRET_RE = /\b(?:sk|rk)[-_][A-Za-z0-9_-]{6,}\b|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?\b/gi;
const KV_SECRET_RE = /\b(?:api[_-]?key|password|secret|credential|authorization|bearer|token)\s*[:=]\s*[^\s,;'"`]+/gi;
const CONTROL_CHAR_MAP: Readonly<Record<string, string>> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };

export function resolveHumanOptions(options?: HumanRenderOptionsV2 | ProjectionOptionsV2 | ProjectionFormatV2): ResolvedHumanOptionsV2 {
  if (options === undefined) return { projection: DEFAULT_PROJECTION_OPTIONS, noColor: false, baselineSuppressed: 0 };
  if (typeof options === 'string') return { projection: options, noColor: false, baselineSuppressed: 0 };
  if ('format' in options && 'profile' in options && 'sources' in options) return { projection: options, noColor: false, baselineSuppressed: 0 };
  const human = options as HumanRenderOptionsV2;
  const suppressed = Number.isSafeInteger(human.baselineSuppressed) && (human.baselineSuppressed as number) > 0 ? (human.baselineSuppressed as number) : 0;
  return { projection: human.projection ?? DEFAULT_PROJECTION_OPTIONS, noColor: human.noColor === true, baselineSuppressed: suppressed };
}

export function sanitizeHumanText(value: string): string {
  const redacted = redactText(value).replace(SHORT_SECRET_RE, '[REDACTED]').replace(KV_SECRET_RE, '[REDACTED]');
  return redacted.replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => CONTROL_CHAR_MAP[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function summarizeSeverities(findings: readonly FindingV2[]): SeveritySummaryV2 {
  const counts = { total: findings.length, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return Object.freeze(counts);
}

export function formatSeveritySummary(counts: SeveritySummaryV2): string {
  const parts = [`${counts.CRITICAL} Critical`, `${counts.HIGH} High`, `${counts.MEDIUM} Medium`, `${counts.LOW} Low`];
  if (counts.INFO > 0) parts.push(`${counts.INFO} Info`);
  return parts.join(' · ');
}

export function describeCoveragePlainEnglish(result: ScannerResultV2): string {
  const statusLabel = result.analysis.status === 'COMPLETE' ? 'Complete' : result.analysis.status === 'DEGRADED' ? 'Partial' : 'Incomplete';
  const omissions = coverageOmissionsV2(result);
  const nodeCount = result.workflow.nodeCount;
  const partialCap = result.analysis.capabilities.some((c) => c.skipped > 0 || c.omitted > 0 || c.status !== 'COMPLETED');
  let inspected = '0/0 nodes inspected';
  if (nodeCount > 0) {
    const primary = result.analysis.capabilities.find((c) => c.id === 'structural-policies' || c.id === 'source-normalization');
    if (!partialCap && result.analysis.status === 'COMPLETE') inspected = `${nodeCount}/${nodeCount} nodes inspected`;
    else if (primary && primary.seen === nodeCount) inspected = `${primary.analyzed}/${nodeCount} nodes inspected`;
    else if (omissions.coverageSeen > 0) inspected = `${nodeCount} nodes (${omissions.coverageAnalyzed}/${omissions.coverageSeen} checks completed)`;
    else inspected = `${nodeCount} nodes inspected`;
  } else if (omissions.coverageSeen > 0) {
    inspected = `${omissions.coverageAnalyzed}/${omissions.coverageSeen} checks inspected`;
  }
  const notes = summarizeDiagnosticsPlainEnglish(result.analysis.diagnostics, omissions.omittedTotal);
  return `Analysis: ${statusLabel} · ${inspected}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`;
}

function summarizeDiagnosticsPlainEnglish(diagnostics: readonly AnalysisDiagnosticV2[], omittedTotal: number): string[] {
  const notes: string[] = [];
  const uncatalogued = diagnostics.filter((d) => d.code === 'SEMANTIC_CATALOGUE_MISS' || d.code === 'GENERIC_NODE_UNMODELED_CAPABILITY');
  if (uncatalogued.length > 0) {
    const pointers = new Set(uncatalogued.map((d) => d.location?.pointer).filter((p): p is string => typeof p === 'string' && p.length > 0));
    const count = pointers.size > 0 ? pointers.size : uncatalogued.length;
    notes.push(`${count} ${count === 1 ? 'node' : 'nodes'} evaluated using generic security rules (uncatalogued type)`);
  }
  const codes = new Set(diagnostics.map((d) => d.code));
  const has = (...target: readonly string[]) => target.some((code) => codes.has(code as AnalysisDiagnosticV2['code']));
  if (has('GRAPH_ENTRY_UNRESOLVED', 'GRAPH_WORK_LIMIT_EXCEEDED', 'GRAPH_ANALYSIS_DEGRADED', 'UNCLASSIFIED_CONNECTION_TYPE', 'MALFORMED_CONNECTION_INDEX')) notes.push('some execution paths could not be fully traced');
  if (has('EXPRESSION_PARSE_FAILED', 'JAVASCRIPT_PARSE_FAILED', 'PYTHON_PARSE_FAILED', 'PYTHON_PARSER_UNAVAILABLE', 'UNSUPPORTED_CODE_NODE_VARIANT', 'MALFORMED_NODE_PARAMETERS', 'DUPLICATE_METADATA_KEY', 'DUPLICATE_SECURITY_KEY')) notes.push('some expressions or code blocks could not be fully parsed');
  if (has('SOURCE_SPAN_UNAVAILABLE', 'JAVASCRIPT_SOURCE_UNAVAILABLE', 'PYTHON_SOURCE_UNAVAILABLE')) notes.push('source locations unavailable for some elements');
  if (omittedTotal > 0) notes.push(`${omittedTotal} item(s) omitted due to analysis limits`);
  else if (has('OPTIONAL_LIMIT_EXCEEDED', 'REQUIRED_LIMIT_EXCEEDED')) notes.push('analysis budget limit reached');
  if (has('DUPLICATE_FINDING_COLLAPSED')) notes.push('duplicate findings collapsed');
  if (has('POLICY_EXECUTION_FAILED', 'DEPENDENCY_UNAVAILABLE', 'UNKNOWN_REPORT_ONLY_RULE', 'UNKNOWN_SCORING_RULE', 'REQUIRED_CAPABILITY_FAILED', 'COMPATIBILITY_PROJECTION_LOSS', 'REQUIRED_STAGE_FAILURE')) notes.push('some policy checks could not complete');
  return notes;
}

export function subjectLocation(subject: SubjectV2): Readonly<{ groupKey: string; label: string; pointer: string; ordinal: number }> {
  if (subject.kind === 'NODE') {
    const label = sanitizeHumanText(subject.node.name ?? '') || `Node #${subject.node.ordinal}`;
    const pointer = sanitizeHumanText(subject.node.source.pointer || `/nodes/${subject.node.ordinal}`);
    return { groupKey: `node:${subject.node.ordinal}:${subject.node.identityDigest}`, label, pointer, ordinal: subject.node.ordinal };
  }
  if (subject.kind === 'EDGE') {
    const label = sanitizeHumanText(subject.edge.targetNode?.name ?? subject.edge.sourceLabel);
    return { groupKey: `edge:${subject.edge.ordinal}`, label, pointer: sanitizeHumanText(subject.edge.source.pointer || '/'), ordinal: 1_000_000 + subject.edge.ordinal };
  }
  if (subject.kind === 'SOURCE') {
    const pointer = sanitizeHumanText(subject.source.pointer || '/');
    return { groupKey: `source:${pointer}`, label: pointer, pointer, ordinal: 2_000_000 };
  }
  return { groupKey: 'workflow', label: 'Workflow', pointer: '/', ordinal: 3_000_000 };
}

export function sortFindingsDeterministic(findings: readonly FindingV2[]): readonly FindingV2[] {
  return [...findings].sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.ruleId.localeCompare(b.ruleId)
    || subjectLocation(a.subject).ordinal - subjectLocation(b.subject).ordinal
    || a.findingId.localeCompare(b.findingId)
  ));
}

export function groupFindingsByNode(findings: readonly FindingV2[]): readonly FindingGroupV2[] {
  const groups = new Map<string, { nodeLabel: string; pointer: string; ordinal: number; findings: FindingV2[] }>();
  for (const finding of sortFindingsDeterministic(findings)) {
    const loc = subjectLocation(finding.subject);
    const existing = groups.get(loc.groupKey);
    if (existing) existing.findings.push(finding);
    else groups.set(loc.groupKey, { nodeLabel: loc.label, pointer: loc.pointer, ordinal: loc.ordinal, findings: [finding] });
  }
  return [...groups.entries()]
    .map(([groupKey, entry]) => ({ groupKey, nodeLabel: entry.nodeLabel, pointer: entry.pointer, ordinal: entry.ordinal, findings: Object.freeze(entry.findings) }))
    .sort((a, b) => SEVERITY_ORDER[a.findings[0]!.severity] - SEVERITY_ORDER[b.findings[0]!.severity] || a.ordinal - b.ordinal || a.nodeLabel.localeCompare(b.nodeLabel) || a.groupKey.localeCompare(b.groupKey));
}

export function resolveFindingTraceSteps(finding: FindingV2, tracesById: ReadonlyMap<string, TraceV2>): readonly (readonly string[])[] {
  const rendered: string[][] = [];
  for (const traceId of [...finding.traceRefs].sort()) {
    const trace = tracesById.get(traceId);
    if (!trace || trace.steps.length === 0) continue;
    const labels: string[] = [];
    for (const step of [...trace.steps].sort((a, b) => a.ordinal - b.ordinal)) {
      const label = step.subject.kind === 'NODE'
        ? sanitizeHumanText(step.subject.node.name ?? step.subject.node.explicitId ?? step.subject.node.source.pointer)
        : subjectLocation(step.subject).label;
      if (label && labels.at(-1) !== label) labels.push(label);
    }
    if (labels.length > 0) rendered.push(labels);
  }
  return rendered;
}

export function resolveFindingTraces(finding: FindingV2, tracesById: ReadonlyMap<string, TraceV2>): readonly string[] {
  return resolveFindingTraceSteps(finding, tracesById).map((steps) => steps.join(' -> '));
}

export function formatFindingWhere(finding: FindingV2, factsById: ReadonlyMap<string, SafeFactV2>): string {
  const loc = subjectLocation(finding.subject);
  for (const ref of finding.factRefs) {
    const path = factsById.get(ref)?.properties.parameterPath;
    if (typeof path === 'string' && path.length > 0 && path !== loc.pointer) return `${loc.label} (${loc.pointer} · ${sanitizeHumanText(path)})`;
  }
  return `${loc.label} (${loc.pointer})`;
}

export function workflowDisplayTitle(result: ScannerResultV2, input: string): string {
  const cleanName = sanitizeHumanText(result.workflow.name ?? '');
  const cleanInput = sanitizeHumanText(input);
  return cleanName && cleanName !== cleanInput ? `${cleanName} (${cleanInput})` : cleanName || cleanInput;
}

export function renderPrettyV2(batch: BatchResultV2, options?: HumanRenderOptionsV2 | ProjectionOptionsV2 | ProjectionFormatV2): string {
  const resolved = resolveHumanOptions(options);
  if (batch.ok === false) return `Scan failed: ${sanitizeHumanText(batch.message)}\n`;
  const projected = projectBatchV2(batch, resolved.projection);
  if (projected.items.length === 0) return 'No workflows scanned.\n';
  const badge = (label: string): string => (resolved.noColor ? label : ANSI_BADGE[label] ?? label);
  const blocks = projected.items.map((item) => renderItemPretty(item, badge, resolved.baselineSuppressed));
  return `${blocks.join('\n\n')}\n`;
}

function renderItemPretty(item: ProjectedItem, badge: (label: string) => string, baselineSuppressed: number): string {
  if (!item.ok) return `${sanitizeHumanText(item.input)} — ${item.error.kind} (${sanitizeHumanText(item.error.code)}): ${sanitizeHumanText(item.error.message)}`;
  const { result } = item;
  const counts = summarizeSeverities(result.findings);
  const risk = result.assessment ? `${badge(result.assessment.grade)} (${result.assessment.score}/100)` : `${badge('INDETERMINATE')} (assessment unavailable)`;
  const lines = [
    `${workflowDisplayTitle(result, item.input)} — ${risk}`,
    `Profile: ${sanitizeHumanText(result.profile.id)} · Findings: ${counts.total} (${formatSeveritySummary(counts)})`,
    describeCoveragePlainEnglish(result),
  ];
  if (baselineSuppressed > 0) lines.push(`Baseline suppressed: ${baselineSuppressed} known finding(s)`);
  if (result.findings.length === 0) { lines.push('  No findings detected.'); return lines.join('\n'); }
  const tracesById = new Map(result.traces.map((t) => [t.traceId, t]));
  const factsById = new Map(result.facts.map((f) => [f.factId, f]));
  for (const group of groupFindingsByNode(result.findings)) {
    lines.push('', `  Node: ${group.nodeLabel} (${group.pointer})`);
    for (const finding of group.findings) {
      const prose = getRuleProseV3(finding.ruleId);
      lines.push(`    [${badge(finding.severity)} | ${finding.confidence}] ${sanitizeHumanText(finding.ruleId)} — ${sanitizeHumanText(prose.title)}`);
      lines.push(`      Where: ${formatFindingWhere(finding, factsById)}`);
      for (const tracePath of resolveFindingTraces(finding, tracesById)) lines.push(`      Trace: ${tracePath}`);
      lines.push(`      Why:   ${sanitizeHumanText(prose.whyItMatters)}`);
      lines.push(`      Fix:   ${sanitizeHumanText(prose.remediationSteps[0] ?? prose.remediation)}`);
    }
  }
  return lines.join('\n');
}
