import type { RefObject } from 'react';
import type { ScanWorkflowResult } from '../engine';
import type { ScannerReportModelV2 } from '../scanner-v2-presentation';
import { scanAnalysisPresentation } from '../analysis-language';
import { getCoverageMeter } from '../report-v2/coverage-meter';
import { GradePill, isReportIncomplete } from './report-blocks';
import { remediationActions } from './report-safe-content';
import { CornerSquare } from '../../ui/primitives/corner-square';

type DecisionTone = Readonly<{
  section: string;
  corner: string;
  eyebrow: string;
  divider: string;
  tile: string;
  badge: string;
  link: string;
}>;

function decisionToneStyles(grade: string | undefined, incomplete: boolean): DecisionTone {
  if (incomplete || !grade) {
    return {
      section: 'border-hairline-strong bg-raised/50',
      corner: '!bg-ink-muted',
      eyebrow: 'text-ink-muted',
      divider: 'border-hairline',
      tile: 'border-hairline bg-panel/70',
      badge: 'border-hairline-strong bg-panel text-ink',
      link: 'text-accent-text',
    };
  }
  if (grade === 'CRITICAL') {
    return {
      section: 'border-sev-critical bg-sev-critical/10',
      corner: '!bg-sev-critical',
      eyebrow: 'text-sev-critical',
      divider: 'border-hairline-strong',
      tile: 'border-hairline bg-raised/70',
      badge: 'border-sev-critical bg-raised text-sev-critical',
      link: 'text-sev-critical',
    };
  }
  if (grade === 'HIGH') {
    return {
      section: 'border-sev-high bg-sev-high/10',
      corner: '!bg-sev-high',
      eyebrow: 'text-sev-high',
      divider: 'border-hairline-strong',
      tile: 'border-hairline bg-raised/70',
      badge: 'border-sev-high bg-raised text-sev-high',
      link: 'text-sev-high',
    };
  }
  if (grade === 'MEDIUM') {
    return {
      section: 'border-sev-medium bg-sev-medium/10',
      corner: '!bg-sev-medium',
      eyebrow: 'text-sev-medium',
      divider: 'border-hairline-strong',
      tile: 'border-hairline bg-raised/70',
      badge: 'border-sev-medium bg-raised text-sev-medium',
      link: 'text-sev-medium',
    };
  }
  return {
    section: 'border-accent-border/40 bg-accent-dim',
    corner: '',
    eyebrow: 'text-accent-text',
    divider: 'border-accent-border/25',
    tile: 'border-accent-border/25 bg-raised/60',
    badge: 'border-accent-border/40 bg-raised text-accent-text',
    link: 'text-accent-text',
  };
}

function openTechnicalDetailsSection(): void {
  const details = document.getElementById('scanner-technical-details');
  if (details instanceof HTMLDetailsElement) details.open = true;
}

function v2Model(scan: ScanWorkflowResult): ScannerReportModelV2 | undefined {
  const candidate = scan as unknown as Partial<ScannerReportModelV2>;
  return candidate.v2?.schemaVersion === 'scanner-result-v2' ? candidate as ScannerReportModelV2 : undefined;
}

function countLabel(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}
type ReportDecisionProps = {
  scan: ScanWorkflowResult;
  outcomeHeadingRef?: RefObject<HTMLHeadingElement | null>;
};

function outcomeHeadline(grade: string | undefined, incomplete: boolean, findingCount: number): string {
  if (incomplete || grade === undefined) return 'No risk decision is available.';
  if (findingCount === 0) {
    return 'No findings were returned. Review the analysis coverage and confirm your own credentials and expected destinations before import.';
  }
  if (grade === 'CRITICAL') return 'Do not import until these issues are understood.';
  if (grade === 'HIGH') return 'Review the high-risk findings before importing.';
  if (grade === 'MEDIUM') return 'Review the flagged configuration before importing.';
  return 'Review the findings before importing.';
}

/** Keeps the outcome, its distinct measures, and the first actions above the detailed evidence. */
export function ReportDecision({ scan, outcomeHeadingRef }: ReportDecisionProps) {
  const model = v2Model(scan);
  const presentation = scanAnalysisPresentation(scan);
  const assessment = model?.assessment ?? scan.riskAssessment;
  const gradeAvailable = presentation.assessmentAvailable && !isReportIncomplete(scan);
  const incomplete = !gradeAvailable;
  const showLimits = Boolean(model && model.v2.limits.usage.length > 0
    && (presentation.label === 'Partial analysis' || !presentation.assessmentAvailable));
  const actions = gradeAvailable ? remediationActions(scan).slice(0, 3) : [];
  const score = assessment && typeof assessment.score === 'number' ? assessment.score : undefined;
  const findingCount = scan.findings.length;
  const coverageMeter = getCoverageMeter(model);
  const tone = decisionToneStyles(assessment?.grade, incomplete);

  return (
    <section aria-labelledby="scanner-decision-heading" className={`relative min-w-0 rounded-panel border p-4 sm:p-5 ${tone.section}`}>
      <CornerSquare position="top-left" size="sm" className={tone.corner} />
      <div className="min-w-0 pl-2">
        <p className={`font-mono text-2xs font-semibold uppercase tracking-wider ${tone.eyebrow}`}>Outcome</p>
        <h2 ref={outcomeHeadingRef} tabIndex={outcomeHeadingRef ? -1 : undefined} id="scanner-decision-heading" className="mt-1 font-sans text-xl font-bold leading-7 text-ink focus:outline-none">
          Decision and next step
        </h2>
        <p className="mt-2 break-words font-sans text-lg font-semibold leading-7 text-ink">
          {outcomeHeadline(assessment?.grade, incomplete, findingCount)}
        </p>
        <p className="mt-1 break-words text-sm leading-6 text-ink-muted">{presentation.message}</p>
        {!incomplete ? <p className="mt-1 text-sm leading-6 text-ink-muted">
          This is an advisory decision from the local scanner, not proof of safe execution.
        </p> : null}
      </div>

      <dl className={`mt-4 grid grid-cols-1 gap-2 border-y py-3 sm:grid-cols-3 ${tone.divider}`}>
        <div className={`min-w-0 rounded-control border p-3 ${tone.tile}`}>
          <dt className="font-mono text-2xs font-semibold uppercase tracking-wider text-ink-muted">Risk grade</dt>
          <dd className="mt-2">{incomplete ? <span className="inline-flex rounded-control border border-sev-high bg-raised px-2.5 py-1 font-mono text-2xs font-semibold text-sev-high">No grade</span> : <GradePill grade={assessment!.grade} />}</dd>
        </div>
        <div className={`min-w-0 rounded-control border p-3 ${tone.tile}`}>
          <dt className="font-mono text-2xs font-semibold uppercase tracking-wider text-ink-muted">Risk score</dt>
          <dd className="mt-2 font-mono text-sm font-semibold text-ink">
            {!incomplete && score !== undefined
              ? <span aria-label={`Risk score: ${score} out of 100`}>{score}/100</span>
              : <span className="text-ink-muted">No score</span>}
          </dd>
        </div>
        <div className={`min-w-0 rounded-control border p-3 ${tone.tile}`}>
          <dt className="font-mono text-2xs font-semibold uppercase tracking-wider text-ink-muted">Analysis coverage</dt>
          <dd className="mt-2 text-sm font-semibold text-ink">
            <span>{presentation.label}</span>
            {coverageMeter ? <span className="mt-1 block font-mono text-xs font-normal text-ink-muted">{coverageMeter.label}</span> : null}
          </dd>
        </div>
      </dl>

      {actions.length > 0 ? <div className={`mt-4 border-t pt-3 ${tone.divider}`}>
        <h3 className="font-display text-base font-semibold text-ink">Start here</h3>
        <ol className="mt-2 space-y-2 text-sm leading-6 text-ink">
          {actions.map((action, index) => <li key={action} className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-2xs font-bold ${tone.badge}`}>{index + 1}</span>
            <span className="min-w-0 break-words"><span className="font-semibold">{index === 0 ? 'Recommended next step:' : 'Also review:'}</span> {action}</span>
          </li>)}
        </ol>
      </div> : null}

      {model && model.assessment && !incomplete ? <details className={`mt-4 border-t pt-3 ${tone.divider}`}>
        <summary className={`cursor-pointer font-mono text-xs font-semibold focus-visible:outline focus-visible:ring-2 focus-visible:ring-accent-border ${tone.link}`}>Assessment basis</summary>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          {countLabel(model.assessment.basisFindingIds.length, 'scoring finding')}; {countLabel(model.assessment.excludedReportOnlyFindingIds.length, 'report-only evidence item')} excluded from scoring; {countLabel(model.assessment.excludedNotApplicableFindingIds.length, 'not-applicable finding')} excluded; {countLabel(model.assessment.excludedUncertainFindingIds.length, 'uncertain finding')} excluded.
        </p>
      </details> : null}
      {showLimits && model ? <details className={`mt-2 border-t pt-3 ${tone.divider}`}>
        <summary className={`cursor-pointer font-mono text-xs font-semibold focus-visible:outline focus-visible:ring-2 focus-visible:ring-accent-border ${tone.link}`}>Coverage limits</summary>
        <p className="mt-2 text-sm font-semibold text-ink">{presentation.assessmentAvailable ? 'Analysis limits are recorded.' : 'Coverage is insufficient for a risk decision.'}</p>
        <ul aria-label="Decision coverage limits" className="mt-2 space-y-1 text-sm text-ink-muted">
          {model.v2.limits.usage.map((limit) => <li key={limit.id} className="break-words">
            <span className="font-mono text-ink">{limit.id}</span>: {limit.examined}/{limit.maximum} examined · {limit.omitted} omitted{limit.exhausted ? ' · limit exhausted' : ''}
          </li>)}
        </ul>
      </details> : null}
      <div className="mt-3 flex flex-wrap gap-x-4">
        {findingCount > 0 ? <a href="#scanner-findings-heading" className={`inline-flex min-h-11 items-center rounded-control px-2 text-sm font-semibold underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:ring-2 focus-visible:ring-accent-border ${tone.link}`}>Review findings</a> : null}
        {model ? <a href="#scanner-v2-coverage-heading" onClick={openTechnicalDetailsSection} className={`inline-flex min-h-11 items-center rounded-control px-2 text-sm font-semibold underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:ring-2 focus-visible:ring-accent-border ${tone.link}`}>See analysis coverage</a> : null}
      </div>
    </section>
  );
}
