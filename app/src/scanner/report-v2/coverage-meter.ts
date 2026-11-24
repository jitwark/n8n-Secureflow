import type { ScannerReportModelV2 } from '../scanner-v2-presentation';

export type NodeCoverageMeter = Readonly<{
  analyzed: number;
  total: number;
  percentage: number;
  label: string;
}>;

function validNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function getCoverageMeter(model?: ScannerReportModelV2): NodeCoverageMeter | undefined {
  if (!model?.v2) return undefined;
  const facts = Array.isArray(model.v2.facts) ? model.v2.facts : [];
  const dependencyFact = facts.find(
    (fact) => fact.kind === 'workflow.dependencies.v1' && fact.subject.kind === 'WORKFLOW',
  );
  if (dependencyFact) {
    const total = validNonNegativeInt(dependencyFact.properties.totalNodes);
    const reviewed = validNonNegativeInt(dependencyFact.properties.reviewedNodes);
    if (total !== undefined && reviewed !== undefined) {
      const analyzed = Math.min(reviewed, total);
      const percentage = total > 0 ? Math.round((analyzed / total) * 100) : 100;
      return Object.freeze({
        analyzed,
        total,
        percentage,
        label: `${analyzed}/${total} nodes deeply analyzed`,
      });
    }
  }

  const capabilities = Array.isArray(model.v2.analysis?.capabilities) ? model.v2.analysis.capabilities : [];
  const structuralCap = capabilities.find((cap) => cap.id === 'structural-policies');
  if (structuralCap && validNonNegativeInt(structuralCap.seen) !== undefined && validNonNegativeInt(structuralCap.analyzed) !== undefined) {
    const total = structuralCap.seen;
    const analyzed = Math.min(structuralCap.analyzed, total);
    const percentage = total > 0 ? Math.round((analyzed / total) * 100) : 100;
    return Object.freeze({
      analyzed,
      total,
      percentage,
      label: `${analyzed}/${total} nodes deeply analyzed`,
    });
  }

  return undefined;
}
