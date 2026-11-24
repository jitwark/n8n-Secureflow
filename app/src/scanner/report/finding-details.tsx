import type { CanonicalScanFinding } from '@hub/scanner-core/policy';
import { evidenceEntries, remediationSteps, safeReportText } from './report-safe-content';

export function FindingDetails({ finding }: { finding: CanonicalScanFinding }) {
  const evidence = evidenceEntries(finding.evidence);
  const steps = remediationSteps(finding);

  return (
    <div className="mt-4 grid min-w-0 gap-4 border-t border-hairline pt-4 lg:grid-cols-2">
      <div className="min-w-0">
        <h4 className="font-mono text-2xs font-semibold uppercase tracking-wider text-ink-muted">Evidence</h4>
        {evidence.length > 0 ? <dl className="mt-2 space-y-2 text-sm">
          {evidence.map((entry) => <div key={entry.label} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(7rem,auto)_1fr] sm:gap-3">
            <dt className="font-mono text-xs text-ink-muted">{entry.label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere] text-ink">{entry.value}</dd>
          </div>)}
        </dl> : <p className="mt-2 text-sm leading-6 text-ink-muted">Evidence details are redacted or not safe to display.</p>}
      </div>

      <div className="min-w-0">
        <h4 className="font-mono text-2xs font-semibold uppercase tracking-wider text-ink-muted">Remediation</h4>
        <p className="mt-2 break-words text-sm leading-6 text-ink">{safeReportText(finding.remediation)}</p>
        {steps.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink-muted">
          {steps.map((step) => <li key={step} className="break-words">{step}</li>)}
        </ul> : null}
        {finding.remediationSteps.length > steps.length ? <p className="mt-2 text-xs text-ink-muted">
          {finding.remediationSteps.length - steps.length} additional remediation steps omitted.
        </p> : null}
      </div>
    </div>
  );
}
