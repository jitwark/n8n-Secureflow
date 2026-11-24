import { describe, expect, it } from 'vitest';
import type { FindingV2 } from '../../../../contracts/scanner-v2-evidence';
import { scoreFindingsV2, type AssessmentV2 } from './scoring';

const digest = (hex: string): string => hex.repeat(64);
const base = (id: string, overrides: Partial<FindingV2> = {}): FindingV2 => ({
  findingId: digest(id), ruleId: 'RULE', ruleRevision: '1', effect: 'SCORING', severity: 'LOW', confidence: 'HIGH',
  evidenceClass: 'CAPABILITY', conclusion: 'OBSERVED', applicability: 'APPLICABLE', subject: { kind: 'WORKFLOW' },
  factRefs: [], traceRefs: [], remediationId: 'remediation', ...overrides,
});
const member = (id: string, pointer = '') => ({ pointer, occurrencePath: [], astNodeId: digest(id), span: null });
const sourceSubject = (id: string): FindingV2['subject'] => ({ kind: 'SOURCE', source: member(id) });
const nodeSubject = (id: string): FindingV2['subject'] => ({ kind: 'NODE', node: { ordinal: 0, source: member(id), identityDigest: digest(id) } });
const edgeSubject = (id: string): FindingV2['subject'] => ({ kind: 'EDGE', edge: {
  ordinal: 0, sourceLabel: 'source', connectionType: 'connect', sourcePort: 0, targetPort: 0, source: member(id), resolution: 'RESOLVED',
} });

const score = (findings: readonly FindingV2[], complexity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW'): AssessmentV2 => scoreFindingsV2(findings, complexity);

describe('scoreFindingsV2', () => {
  it.each([
    ['CRITICAL', 80, 'CRITICAL'],
    ['HIGH', 55, 'HIGH'],
    ['MEDIUM', 25, 'MEDIUM'],
    ['LOW', 6, 'LOW'],
    ['INFO', 1, 'LOW'],
  ] as const)('enforces monotonic floor and grade for a single %s finding', (severity, expectedScore, expectedGrade) => {
    const result = score([base('a', { severity })]);
    expect(result.score).toBe(expectedScore);
    expect(result.grade).toBe(expectedGrade);
  });

  it('uses severity weights when additive scores exceed severity floors', () => {
    expect(score([base('a', { ruleId: 'R1', severity: 'CRITICAL' }), base('b', { ruleId: 'R2', severity: 'HIGH' })]).score).toBe(90);
    expect(score([base('a', { ruleId: 'R1', severity: 'HIGH' }), base('b', { ruleId: 'R2', severity: 'HIGH' })]).score).toBe(70);
    expect(score([base('a', { ruleId: 'R1', severity: 'MEDIUM' }), base('b', { ruleId: 'R2', severity: 'MEDIUM' })]).score).toBe(36);
    expect(score([base('a', { ruleId: 'R1', severity: 'LOW' })]).score).toBe(6);
    expect(score([base('a', { ruleId: 'R1', severity: 'INFO' })]).score).toBe(1);
  });

  it('decays repeated eligible findings by rule and caps at twice the base weight', () => {
    const findings = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => base(id, { ruleId: 'REPEATED', severity: 'HIGH' }));
    expect(score(findings).score).toBe(70);
    expect(score(findings.slice(0, 1)).score).toBe(55);
  });

  it.each([
    ['LOW', 24, 'LOW'], ['LOW', 25, 'MEDIUM'], ['LOW', 54, 'MEDIUM'], ['LOW', 55, 'HIGH'],
    ['LOW', 79, 'HIGH'], ['LOW', 80, 'CRITICAL'], ['HIGH', 100, 'CRITICAL'],
  ] as const)('classifies boundary score %s', (_complexity, expectedScore, expectedGrade) => {
    const byRule = (id: string, severity: FindingV2['severity']) => base(id, { ruleId: `RULE_${id}`, severity });
    const cases: Record<number, FindingV2[]> = {
      24: ['a', 'b', 'c', 'd'].map((id) => byRule(id, 'LOW')),
      25: [byRule('a', 'MEDIUM'), byRule('b', 'LOW'), byRule('c', 'INFO')],
      54: ['a', 'b', 'c'].map((id) => byRule(id, 'MEDIUM')),
      55: [byRule('a', 'HIGH'), byRule('b', 'MEDIUM'), byRule('c', 'INFO'), byRule('d', 'INFO')],
      79: [byRule('a', 'HIGH'), byRule('b', 'MEDIUM'), byRule('c', 'MEDIUM'), byRule('d', 'LOW'), byRule('e', 'INFO'), byRule('f', 'INFO')],
      80: [byRule('a', 'CRITICAL'), byRule('b', 'MEDIUM'), byRule('c', 'LOW'), byRule('d', 'INFO')],
      100: [byRule('a', 'CRITICAL'), byRule('b', 'CRITICAL')],
    };
    const result = score(cases[expectedScore], _complexity);
    expect(result.score).toBe(expectedScore);
    expect(result.grade).toBe(expectedGrade);
  });

  it('rounds one time with halves toward positive infinity', () => {
    const findings = [base('a', { ruleId: 'RULE' }), base('b', { ruleId: 'RULE' })];
    expect(score(findings).score).toBe(8); // 6 + 6 * 25% = 7.5
  });

  it('adds complexity before applying floors, capping, and grading', () => {
    expect(score([base('a', { severity: 'HIGH' })], 'MEDIUM')).toMatchObject({ score: 55, grade: 'HIGH' });
    expect(score([base('a', { severity: 'CRITICAL' })], 'HIGH')).toMatchObject({ score: 80, grade: 'CRITICAL' });
    expect(score([base('a', { ruleId: 'R1', severity: 'MEDIUM' }), base('b', { ruleId: 'R2', severity: 'MEDIUM' })], 'MEDIUM').score).toBe(46);
    expect(score([base('a', { ruleId: 'R1', severity: 'HIGH' }), base('b', { ruleId: 'R2', severity: 'HIGH' })], 'MEDIUM')).toMatchObject({ score: 80, grade: 'CRITICAL' });
    expect(score([base('a', { severity: 'CRITICAL' }), base('b', { ruleId: 'OTHER', severity: 'HIGH' })], 'HIGH').score).toBe(100);
  });

  it.each([
    ['CRITICAL', [base('a', { ruleId: 'R1', severity: 'CRITICAL' }), base('b', { ruleId: 'R2', severity: 'MEDIUM' })], 80, 'CRITICAL'],
    ['CRITICAL', [base('a', { ruleId: 'R1', severity: 'CRITICAL' }), base('b', { ruleId: 'R2', severity: 'MEDIUM' }), base('c', { ruleId: 'R3', severity: 'LOW' })], 80, 'CRITICAL'],
    ['HIGH', [base('a', { ruleId: 'R1', severity: 'HIGH' }), base('b', { ruleId: 'R2', severity: 'MEDIUM' })], 55, 'HIGH'],
    ['MEDIUM', [base('a', { ruleId: 'R1', severity: 'MEDIUM' }), base('b', { ruleId: 'R2', severity: 'LOW' })], 25, 'MEDIUM'],
  ] as const)('lifts %s sub-floor additive combinations to monotonic floor', (_severity, findings, expectedScore, expectedGrade) => {
    const result = score(findings);
    expect(result.score).toBe(expectedScore);
    expect(result.grade).toBe(expectedGrade);
    expect(result.basisFindingIds).toHaveLength(findings.length);
  });

  it('preserves additive scores above severity floors, caps at 100, and aligns grade with score', () => {
    const score92 = score([
      base('a', { ruleId: 'R1', severity: 'CRITICAL' }),
      base('b', { ruleId: 'R2', severity: 'MEDIUM' }),
      base('c', { ruleId: 'R3', severity: 'MEDIUM' }),
      base('d', { ruleId: 'R4', severity: 'INFO' }),
    ]);
    expect(score92).toMatchObject({ score: 92, grade: 'CRITICAL' });

    const capped = score([
      base('a', { ruleId: 'R1', severity: 'CRITICAL' }),
      base('b', { ruleId: 'R2', severity: 'CRITICAL' }),
      base('c', { ruleId: 'R3', severity: 'LOW' }),
    ]);
    expect(capped).toMatchObject({ score: 100, grade: 'CRITICAL' });

    const contractGrade = (s: number) => (s >= 80 ? 'CRITICAL' : s >= 55 ? 'HIGH' : s >= 25 ? 'MEDIUM' : 'LOW');
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const) {
      const single = score([base('a', { severity })]);
      expect(single.grade).toBe(contractGrade(single.score));
    }
  });

  it('does not trigger severity floors for report-only, non-observed, or non-applicable findings', () => {
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM'] as const) {
      const excluded = [
        base('a', { ruleId: 'R1', severity, effect: 'REPORT_ONLY' }),
        base('b', { ruleId: 'R2', severity, conclusion: 'POTENTIAL' }),
        base('c', { ruleId: 'R3', severity, conclusion: 'UNKNOWN' }),
        base('d', { ruleId: 'R4', severity, applicability: 'NOT_APPLICABLE' }),
        base('e', { ruleId: 'R5', severity, applicability: 'UNKNOWN' }),
      ];
      expect(score(excluded)).toMatchObject({ score: 0, grade: 'LOW', basisFindingIds: [] });
      expect(score([...excluded, base('f', { ruleId: 'R6', severity: 'LOW' })])).toMatchObject({
        score: 6, grade: 'LOW', basisFindingIds: [digest('f')],
      });
    }

    const mediumWithExcludedCritical = score([
      base('a', { ruleId: 'R1', severity: 'CRITICAL', effect: 'REPORT_ONLY' }),
      base('b', { ruleId: 'R2', severity: 'CRITICAL', conclusion: 'POTENTIAL' }),
      base('c', { ruleId: 'R3', severity: 'CRITICAL', applicability: 'NOT_APPLICABLE' }),
      base('d', { ruleId: 'R4', severity: 'MEDIUM' }),
    ]);
    expect(mediumWithExcludedCritical).toMatchObject({ score: 25, grade: 'MEDIUM', basisFindingIds: [digest('d')] });
  });

  it('uses exclusion precedence and exhaustively partitions findings in canonical order', () => {
    const findings = [
      base('a', { ruleId: 'Z', effect: 'REPORT_ONLY', conclusion: 'POTENTIAL', applicability: 'NOT_APPLICABLE' }),
      base('b', { ruleId: 'A', applicability: 'NOT_APPLICABLE' }),
      base('c', { ruleId: 'B', conclusion: 'POTENTIAL' }),
      base('d', { ruleId: 'C', conclusion: 'UNKNOWN' }),
      base('e', { ruleId: 'D', applicability: 'UNKNOWN' }),
      base('f', { ruleId: 'E' }),
    ];
    const result = score(findings);
    expect(result.excludedReportOnlyFindingIds).toEqual([digest('a')]);
    expect(result.excludedNotApplicableFindingIds).toEqual([digest('b')]);
    expect(result.excludedUncertainFindingIds).toEqual([digest('c'), digest('d'), digest('e')]);
    expect(result.basisFindingIds).toEqual([digest('f')]);
    expect(result.unknownEvidenceCount).toBe(3);
    expect(new Set([...result.basisFindingIds, ...result.excludedReportOnlyFindingIds, ...result.excludedUncertainFindingIds, ...result.excludedNotApplicableFindingIds]).size).toBe(findings.length);
  });

  it('is permutation independent, confidence neutral, and does not mutate input', () => {
    const findings = [base('b', { ruleId: 'B', severity: 'HIGH', confidence: 'LOW' }), base('a', { ruleId: 'A', severity: 'LOW', confidence: 'HIGH' })];
    const before = JSON.stringify(findings);
    const first = score(findings);
    const second = score([...findings].reverse());
    expect(second).toEqual(first);
    expect(score([base('c', { confidence: 'HIGH' })]).score).toBe(score([base('d', { confidence: 'LOW' })]).score);
    expect(JSON.stringify(findings)).toBe(before);
  });

  it('never scores report-only, potential, unknown, or not-applicable findings', () => {
    expect(score([
      base('a', { effect: 'REPORT_ONLY' }), base('b', { conclusion: 'POTENTIAL' }), base('c', { conclusion: 'UNKNOWN' }), base('d', { applicability: 'NOT_APPLICABLE' }),
    ]).score).toBe(0);
  });

  it('rejects sparse, open, invalid, unsafe, and malformed-Unicode inputs', () => {
    const sparse = new Array(1) as unknown as readonly FindingV2[];
    expect(() => scoreFindingsV2(sparse, 'LOW')).toThrow();
    expect(() => scoreFindingsV2([base('a', { severity: 'BOGUS' as FindingV2['severity'] })], 'LOW')).toThrow();
    expect(() => scoreFindingsV2([{ ...base('a'), extra: true } as FindingV2], 'LOW')).toThrow();
    expect(() => scoreFindingsV2([{ ...base('a'), findingId: 'bad-id' }], 'LOW')).toThrow();
    expect(() => scoreFindingsV2([base('a')], 'BOGUS' as 'LOW')).toThrow();
    expect(() => scoreFindingsV2([base('a', { subject: { kind: 'NODE', node: { ordinal: Number.POSITIVE_INFINITY } } as never })], 'LOW')).toThrow();
    expect(() => scoreFindingsV2([base('a', { ruleId: 'RULE\uD800' })], 'LOW')).toThrow();
  });

  it('orders non-workflow subjects by canonical subject identity before finding ID', () => {
    const findings = [
      base('a', { ruleId: 'SAME', subject: sourceSubject('a') }),
      base('b', { ruleId: 'SAME', subject: nodeSubject('b') }),
      base('c', { ruleId: 'SAME', subject: edgeSubject('e') }),
    ];
    const result = score(findings);
    expect(result.basisFindingIds).toEqual([digest('c'), digest('b'), digest('a')]);
    expect(score([...findings].reverse())).toEqual(result);
  });
});
