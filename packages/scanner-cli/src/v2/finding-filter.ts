import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FindingV2 } from '@hub/contracts/scanner-v2-evidence';
import type { ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import type { BatchItemV2, BatchResultV2 } from './batch-runner';
import type { ScanConfidenceV2, ScanSeverityV2 } from './contracts';
import type { ExitCodeV2 } from './exit-reducer';
import { isAdmittedRelativePath } from './path-admission';

const MAX_BASELINE_BYTES = 10_485_760;
const SEVERITY_RANK: Readonly<Record<ScanSeverityV2, number>> = Object.freeze({
  CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1,
});
const CONFIDENCE_RANK: Readonly<Record<ScanConfidenceV2, number>> = Object.freeze({
  HIGH: 3, MEDIUM: 2, LOW: 1,
});
const WEIGHT: Readonly<Record<ScanSeverityV2, number>> = Object.freeze({
  CRITICAL: 55, HIGH: 35, MEDIUM: 18, LOW: 6, INFO: 1,
});
const SEVERITY_FLOOR: Readonly<Record<ScanSeverityV2, number>> = Object.freeze({
  CRITICAL: 80, HIGH: 55, MEDIUM: 25, LOW: 0, INFO: 0,
});
const COMPLEXITY_WEIGHT: Readonly<Record<'LOW' | 'MEDIUM' | 'HIGH', number>> = Object.freeze({
  LOW: 0, MEDIUM: 10, HIGH: 20,
});

export type FindingFilterOptionsV2 = Readonly<{
  minSeverity?: ScanSeverityV2;
  minConfidence?: ScanConfidenceV2;
  baselineIds?: ReadonlySet<string>;
}>;

export type FilteredBatchResultV2 = Readonly<{
  batch: BatchResultV2;
  baselineSuppressed: number;
}>;

export type BaselineLoadResultV2 =
  | Readonly<{ ok: true; findingIds: ReadonlySet<string> }>
  | Readonly<{ ok: false; exitCode: ExitCodeV2; message: string }>;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function readBoundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

function extractBaselineIds(parsed: unknown): ReadonlySet<string> | undefined {
  if (!isPlain(parsed)) return undefined;
  const ids = new Set<string>();
  if (Object.prototype.hasOwnProperty.call(parsed, 'findingIds')) {
    if (!Array.isArray(parsed.findingIds)) return undefined;
    for (const entry of parsed.findingIds) {
      const id = readBoundedString(entry);
      if (id === undefined) return undefined;
      ids.add(id);
    }
    return ids;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'results')) {
    if (!Array.isArray(parsed.results)) return undefined;
    for (const item of parsed.results) {
      if (!isPlain(item) || item.ok === false || item.result === undefined) continue;
      if (!isPlain(item.result) || !Array.isArray(item.result.findings)) return undefined;
      for (const finding of item.result.findings) {
        if (!isPlain(finding)) return undefined;
        const id = readBoundedString(finding.findingId);
        if (id === undefined) return undefined;
        ids.add(id);
      }
    }
    return ids;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'findings')) {
    if (!Array.isArray(parsed.findings)) return undefined;
    for (const finding of parsed.findings) {
      if (!isPlain(finding)) return undefined;
      const id = readBoundedString(finding.findingId);
      if (id === undefined) return undefined;
      ids.add(id);
    }
    return ids;
  }
  return undefined;
}

/** Loads known finding fingerprints from a bounded, non-symlinked relative local JSON baseline. */
export async function loadBaselineFindingIdsV2(relativePath: string, baseDirectory: string): Promise<BaselineLoadResultV2> {
  if (!isAdmittedRelativePath(relativePath)) {
    return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline path is not admitted.' });
  }
  const target = resolve(baseDirectory, relativePath);
  const linkStat = await lstat(target).catch(() => undefined);
  if (linkStat === undefined) {
    return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file could not be read.' });
  }
  if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
    return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file is invalid.' });
  }
  const handle = await open(target, 'r').catch(() => undefined);
  if (handle === undefined) {
    return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file could not be read.' });
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BASELINE_BYTES) {
      return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file is invalid.' });
    }
    const bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
    const parsed: unknown = JSON.parse(text);
    const findingIds = extractBaselineIds(parsed);
    if (findingIds === undefined) {
      return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file is invalid.' });
    }
    return Object.freeze({ ok: true as const, findingIds });
  } catch {
    return Object.freeze({ ok: false as const, exitCode: 2 as const, message: 'Baseline file is invalid.' });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function recomputeAssessment(
  prior: ScannerResultV2['assessment'],
  findings: readonly FindingV2[],
  complexity: ScannerResultV2['workflow']['complexity'],
): ScannerResultV2['assessment'] {
  if (prior === null) return null;
  const basisFindingIds: string[] = [];
  const excludedReportOnlyFindingIds: string[] = [];
  const excludedUncertainFindingIds: string[] = [];
  const excludedNotApplicableFindingIds: string[] = [];
  const totals = new Map<string, { base: number; total: number }>();
  let floor = 0;
  for (const finding of findings) {
    if (finding.effect === 'REPORT_ONLY') excludedReportOnlyFindingIds.push(finding.findingId);
    else if (finding.applicability === 'NOT_APPLICABLE') excludedNotApplicableFindingIds.push(finding.findingId);
    else if (finding.applicability === 'UNKNOWN' || finding.conclusion === 'POTENTIAL' || finding.conclusion === 'UNKNOWN') {
      excludedUncertainFindingIds.push(finding.findingId);
    } else {
      basisFindingIds.push(finding.findingId);
      floor = Math.max(floor, SEVERITY_FLOOR[finding.severity]);
      const base = WEIGHT[finding.severity];
      const existing = totals.get(finding.ruleId);
      if (!existing) totals.set(finding.ruleId, { base, total: base });
      else existing.total = Math.min(existing.base * 2, existing.total + existing.base * 0.25);
    }
  }
  let sum = 0;
  for (const item of totals.values()) sum += item.total;
  const score = Math.max(floor, Math.floor(Math.min(100, sum + (COMPLEXITY_WEIGHT[complexity] ?? 0)) + 0.5));
  const grade: NonNullable<ScannerResultV2['assessment']>['grade'] =
    score >= 80 ? 'CRITICAL' : score >= 55 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW';
  return Object.freeze({
    score,
    grade,
    scoringPolicyVersion: prior.scoringPolicyVersion,
    basisFindingIds: Object.freeze(basisFindingIds) as string[],
    excludedReportOnlyFindingIds: Object.freeze(excludedReportOnlyFindingIds) as string[],
    excludedUncertainFindingIds: Object.freeze(excludedUncertainFindingIds) as string[],
    excludedNotApplicableFindingIds: Object.freeze(excludedNotApplicableFindingIds) as string[],
    unknownEvidenceCount: excludedUncertainFindingIds.length,
  });
}

/** Filters findings by severity/confidence/baseline while preserving contract-valid assessments. */
export function filterBatchResultV2(batch: BatchResultV2, options: FindingFilterOptionsV2 = {}): FilteredBatchResultV2 {
  if (!batch.ok) return Object.freeze({ batch, baselineSuppressed: 0 });
  const minSev = options.minSeverity ? SEVERITY_RANK[options.minSeverity] : 0;
  const minConf = options.minConfidence ? CONFIDENCE_RANK[options.minConfidence] : 0;
  const baseline = options.baselineIds;
  if (minSev === 0 && minConf === 0 && (baseline === undefined || baseline.size === 0)) {
    return Object.freeze({ batch, baselineSuppressed: 0 });
  }
  let baselineSuppressed = 0;
  let changed = false;
  const items: BatchItemV2[] = batch.items.map((item) => {
    if (item.status !== 'COMPLETED' || !item.result?.ok) return item;
    const result = item.result.result;
    const kept: FindingV2[] = [];
    for (const finding of result.findings) {
      if (minSev > 0 && SEVERITY_RANK[finding.severity] < minSev) continue;
      if (minConf > 0 && CONFIDENCE_RANK[finding.confidence] < minConf) continue;
      if (baseline?.has(finding.findingId)) {
        baselineSuppressed += 1;
        continue;
      }
      kept.push(finding);
    }
    if (kept.length === result.findings.length) return item;
    changed = true;
    const nextResult: ScannerResultV2 = Object.freeze({
      ...result,
      findings: Object.freeze(kept) as FindingV2[],
      assessment: recomputeAssessment(result.assessment, kept, result.workflow.complexity),
    });
    return Object.freeze({
      ...item,
      result: Object.freeze({ ok: true as const, result: nextResult }),
    });
  });
  if (!changed) return Object.freeze({ batch, baselineSuppressed });
  return Object.freeze({
    batch: Object.freeze({ ...batch, items: Object.freeze(items) }),
    baselineSuppressed,
  });
}
