import type { BatchResultV2 } from './batch-runner';
import { projectBatchV2, type ProjectedBatchV2, type ProjectionFormatV2, type ProjectionOptionsV2 } from './json-output';
import {
  describeCoveragePlainEnglish,
  formatFindingWhere,
  formatSeveritySummary,
  groupFindingsByNode,
  resolveFindingTraceSteps,
  resolveHumanOptions,
  sanitizeHumanText,
  sortFindingsDeterministic,
  subjectLocation,
  summarizeSeverities,
  workflowDisplayTitle,
  type HumanRenderOptionsV2,
} from './pretty-output';
import { getRuleProseV3 } from './rule-prose-v3';

type ProjectedItem = ProjectedBatchV2['items'][number];

function escapeMd(value: string): string {
  return sanitizeHumanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('`', '\\`');
}

export function renderMarkdownV2(
  batch: BatchResultV2,
  options?: HumanRenderOptionsV2 | ProjectionOptionsV2 | ProjectionFormatV2,
): string {
  const resolved = resolveHumanOptions(options);
  if (batch.ok === false) return `## SecureFlow Security Scan\n\n> **Scan failed:** ${escapeMd(batch.message)}\n`;
  const projected = projectBatchV2(batch, resolved.projection);
  if (projected.items.length === 0) return '## SecureFlow Security Scan\n\nNo workflows scanned.\n';
  const sections = projected.items.map((item) => renderItemMarkdown(item, resolved.baselineSuppressed));
  return `## SecureFlow Security Scan\n\n${sections.join('\n\n')}\n`;
}

function renderItemMarkdown(item: ProjectedItem, baselineSuppressed: number): string {
  if (!item.ok) {
    return `### ${escapeMd(item.input)}\n\n> **${item.error.kind} (\`${escapeMd(item.error.code)}\`):** ${escapeMd(item.error.message)}`;
  }
  const { result } = item;
  const title = escapeMd(workflowDisplayTitle(result, item.input));
  const profile = escapeMd(result.profile.id);
  const risk = result.assessment ? `${result.assessment.grade} (${result.assessment.score}/100)` : 'INDETERMINATE';
  const counts = summarizeSeverities(result.findings);
  const coverage = escapeMd(describeCoveragePlainEnglish(result));
  const lines: string[] = [
    `### ${title} — **${risk}**`,
    '',
    '| Workflow | Profile | Risk | Findings | Coverage |',
    '| --- | --- | --- | --- | --- |',
    `| ${title} | \`${profile}\` | **${risk}** | ${counts.total} (${formatSeveritySummary(counts)}) | ${coverage} |`,
  ];
  if (baselineSuppressed > 0) lines.push('', `> Baseline suppressed: ${baselineSuppressed} known finding(s).`);
  if (result.findings.length === 0) {
    lines.push('', 'No security findings detected.');
    return lines.join('\n');
  }
  lines.push('', '| Severity | Confidence | Rule | Node | Title |', '| --- | --- | --- | --- | --- |');
  for (const finding of sortFindingsDeterministic(result.findings)) {
    const prose = getRuleProseV3(finding.ruleId);
    const nodeName = escapeMd(subjectLocation(finding.subject).label);
    lines.push(`| ${finding.severity} | ${finding.confidence} | \`${escapeMd(finding.ruleId)}\` | ${nodeName} | ${escapeMd(prose.title)} |`);
  }
  const tracesById = new Map(result.traces.map((t) => [t.traceId, t]));
  const factsById = new Map(result.facts.map((f) => [f.factId, f]));
  for (const group of groupFindingsByNode(result.findings)) {
    const topSeverity = group.findings[0]!.severity;
    const nodeLabel = escapeMd(group.nodeLabel);
    lines.push('', `<details>`, `<summary><strong>[${topSeverity}]</strong> ${nodeLabel} (${group.findings.length} finding${group.findings.length === 1 ? '' : 's'})</summary>`, '');
    for (const finding of group.findings) {
      const prose = getRuleProseV3(finding.ruleId);
      lines.push(`- **[${finding.severity} | ${finding.confidence}] \`${escapeMd(finding.ruleId)}\` — ${escapeMd(prose.title)}**`);
      lines.push(`  - **Where:** ${escapeMd(formatFindingWhere(finding, factsById))}`);
      for (const steps of resolveFindingTraceSteps(finding, tracesById)) {
        lines.push(`  - **Trace:** ${steps.map(escapeMd).join(' -> ')}`);
      }
      lines.push(`  - **Why:** ${escapeMd(prose.whyItMatters)}`);
      lines.push(`  - **Fix:** ${escapeMd(prose.remediation)}`);
      for (const step of prose.remediationSteps) lines.push(`    - ${escapeMd(step)}`);
    }
    lines.push('', '</details>');
  }
  return lines.join('\n');
}
