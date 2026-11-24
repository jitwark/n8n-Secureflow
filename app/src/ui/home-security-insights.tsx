import Link from 'next/link';
import v03Metrics from '../catalogue/v03-corpus-metrics.json';
import { CornerSquare } from './primitives/corner-square';

type RuleHighlight = {
  id: string;
  label: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  workflows: number;
  percent: number;
};

const SEV_COLOR: Record<RuleHighlight['severity'], string> = {
  CRITICAL: 'text-sev-critical',
  HIGH: 'text-sev-high',
  MEDIUM: 'text-sev-medium',
};

export function HomeSecurityInsights() {
  const { corpus, scannerPackage, profiles, comparison } = v03Metrics;
  const standard = profiles['standard@3.0.0'];
  const summary = standard.newV3RulesSummary;
  const completePct = ((standard.analysisStatus.COMPLETE / corpus.validWorkflows) * 100).toFixed(2);
  const critHighPct = ((standard.workflowsWithCriticalOrHigh / corpus.validWorkflows) * 100).toFixed(2);
  const fmt = (value: number) => value.toLocaleString('en-US');

  const topRules: RuleHighlight[] = [
    {
      id: 'UNAUTHENTICATED_TRIGGER_TO_SINK',
      label: 'Unauthenticated trigger reaching external sink',
      severity: 'CRITICAL',
      workflows: summary.UNAUTHENTICATED_TRIGGER_TO_SINK.triggeredWorkflows,
      percent: summary.UNAUTHENTICATED_TRIGGER_TO_SINK.workflowPercent,
    },
    {
      id: 'CROSS_NODE_TAINT_FLOW',
      label: 'Cross-node taint flows (TAINT_FLOW_TOTAL)',
      severity: 'HIGH',
      workflows: summary.TAINT_FLOW_TOTAL.triggeredWorkflows,
      percent: summary.TAINT_FLOW_TOTAL.workflowPercent,
    },
    {
      id: 'EXPRESSION_ENV_EXPOSURE',
      label: 'Expression environment / secret access',
      severity: 'HIGH',
      workflows: summary.EXPRESSION_ENV_EXPOSURE.triggeredWorkflows,
      percent: summary.EXPRESSION_ENV_EXPOSURE.workflowPercent,
    },
    {
      id: 'AI_AGENT_UNGATED_TOOL',
      label: 'AI agent connected to ungated tool',
      severity: 'MEDIUM',
      workflows: summary.AI_AGENT_UNGATED_TOOL.triggeredWorkflows,
      percent: summary.AI_AGENT_UNGATED_TOOL.workflowPercent,
    },
    {
      id: 'AGENT_EGRESS_UNRESTRICTED',
      label: 'Unrestricted AI agent HTTP egress',
      severity: 'HIGH',
      workflows: summary.AGENT_EGRESS_UNRESTRICTED.triggeredWorkflows,
      percent: summary.AGENT_EGRESS_UNRESTRICTED.workflowPercent,
    },
  ];

  const cards = [
    {
      label: 'Real-World Templates',
      value: fmt(corpus.validWorkflows),
      detail: `${fmt(corpus.totalNodes)} nodes · avg ${corpus.avgNodes}/workflow`,
    },
    {
      label: 'Findings Uplift',
      value: `+${comparison.findingsUpliftPercent}%`,
      detail: `${fmt(standard.totalFindings)} findings across ${fmt(standard.workflowsWithFindings)} workflows (vs ${fmt(comparison.totalFindingsBefore)})`,
    },
    {
      label: 'Critical / High Risk',
      value: fmt(standard.workflowsWithCriticalOrHigh),
      detail: `${critHighPct}% (+${comparison.criticalHighUpliftPercent}% vs ${fmt(comparison.criticalHighWorkflowsBefore)}) · ${fmt(standard.grades.CRITICAL)} CRITICAL + ${fmt(standard.grades.HIGH)} HIGH`,
    },
    {
      label: 'False Degraded Rate',
      value: '0%',
      detail: `${fmt(comparison.unmodeledCatalogueDegradedAfter)} of ${fmt(standard.unmodeledCatalogueWorkflows)} unmodelled workflows degraded · ${fmt(standard.analysisStatus.COMPLETE)} (${completePct}%) complete`,
    },
  ];

  return (
    <section aria-labelledby="v03-insights-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-hairline pb-3">
        <div>
          <p className="font-mono text-2xs font-bold uppercase tracking-wider text-accent-text">
            {scannerPackage} · standard@3.0.0 corpus benchmark
          </p>
          <h2 id="v03-insights-heading" className="mt-1 font-sans text-2xl font-bold tracking-tight text-ink">
            v0.3 Real-World Security Insights
          </h2>
          <p className="mt-1 max-w-[66ch] text-sm leading-6 text-ink-muted">
            Deterministic AST and taint analysis measured across {fmt(corpus.validWorkflows)} deduplicated
            community n8n workflows with zero false degradation on unmodelled nodes.
          </p>
        </div>
        <Link
          href="/scanner/"
          prefetch={false}
          className="flex min-h-11 shrink-0 items-center rounded-control font-mono text-xs font-bold text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-accent-border"
        >
          Run these rules locally
          <span aria-hidden="true" className="ml-1.5">→</span>
        </Link>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="relative flex min-w-0 flex-col justify-between gap-1.5 rounded-panel border border-hairline bg-panel p-5"
          >
            <CornerSquare position="top-left" size="sm" />
            <dt className="pl-2 font-mono text-2xs font-bold uppercase tracking-wider text-ink-muted">
              {card.label}
            </dt>
            <dd className="pt-1 font-sans text-3xl font-bold tabular-nums tracking-tight text-accent-text">
              {card.value}
            </dd>
            <dd className="font-mono text-2xs leading-5 text-ink-faint">
              {card.detail}
            </dd>
          </div>
        ))}
      </dl>

      <div className="rounded-panel border border-hairline bg-panel p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2.5">
          <h3 className="font-sans text-base font-bold text-ink">Top Detected v0.3 Risk Patterns</h3>
          <span className="font-mono text-2xs text-ink-faint">
            Down 100% unmodelled-only degraded · {fmt(standard.analysisStatus.COMPLETE)} complete
          </span>
        </div>
        <ul className="divide-y divide-hairline">
          {topRules.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className={`font-mono text-2xs font-bold ${SEV_COLOR[rule.severity]}`}>
                  {rule.severity}
                </span>
                <code className="min-w-0 break-all font-mono text-xs font-semibold text-ink">
                  {rule.id}
                </code>
                <span className="text-xs text-ink-muted">{rule.label}</span>
              </div>
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                {fmt(rule.workflows)} workflows ({rule.percent}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
