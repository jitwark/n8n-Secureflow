import { describe, expect, it } from 'vitest';
import {
  NOOP_ADMISSION_PINS,
  NOOP_ADMISSION_PINS_DIGEST,
  REVIEWED_SCOPED_AUTHORITY_DIGEST,
  computeNoopAdmissionPinsDigest,
  reviewedNoopAdmissionIsIntact,
  reviewedScopedAuthorityIsIntact,
} from './noop-admission-authority';
import { SCOPED_GMAIL_BUNDLE_DIGEST } from './generic-fallback';
import { REVIEWED_NOOP_CANDIDATE_BUNDLE } from './reviewed-noop-candidate';

describe('detached NoOp admission authority', () => {
  it('accepts the approved immutable candidate, receipt, and scoped bundle pins', () => {
    expect(computeNoopAdmissionPinsDigest()).toBe(NOOP_ADMISSION_PINS_DIGEST);
    expect(reviewedNoopAdmissionIsIntact()).toBe(true);
    expect(reviewedScopedAuthorityIsIntact(SCOPED_GMAIL_BUNDLE_DIGEST, REVIEWED_SCOPED_AUTHORITY_DIGEST)).toBe(true);
  });

  it.each([
    ['decision', { ...NOOP_ADMISSION_PINS, decision: 'PENDING' }],
    ['receipt bytes', { ...NOOP_ADMISSION_PINS, approvedReceiptSha256: '0'.repeat(64) }],
    ['manifest', { ...NOOP_ADMISSION_PINS, manifestDigest: '0'.repeat(64) }],
    ['evidence', { ...NOOP_ADMISSION_PINS, evidenceArtifactDigest: '0'.repeat(64) }],
    ['F1 receipt', { ...NOOP_ADMISSION_PINS, f1CohortReceiptSha256: '0'.repeat(64) }],
    ['candidate key', { ...NOOP_ADMISSION_PINS, candidateKey: 'n8n-nodes-base.noOp@2.0.0:ABSENT/ABSENT' }],
    ['source receipt set', { ...NOOP_ADMISSION_PINS, sourceReceiptDigests: ['malformed'] }],
  ] as const)('refuses changed %s pins', (_label, pins) => {
    expect(reviewedNoopAdmissionIsIntact(pins)).toBe(false);
  });

  it('refuses a changed candidate bundle and a mismatched Gmail aggregate input', () => {
    const changedBundle = {
      ...REVIEWED_NOOP_CANDIDATE_BUNDLE,
      digest: '0'.repeat(64),
    };
    expect(reviewedNoopAdmissionIsIntact(NOOP_ADMISSION_PINS, changedBundle)).toBe(false);
    expect(reviewedScopedAuthorityIsIntact('0'.repeat(64), REVIEWED_SCOPED_AUTHORITY_DIGEST)).toBe(false);
  });
});
