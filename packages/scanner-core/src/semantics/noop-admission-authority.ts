import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalJsonBytes } from '../canonical-json';
import { admitScopedCatalogue } from './scoped-catalogue-admission';
import type { ScopedCatalogueBundleV1 } from './scoped-catalogue-schema';
import { REVIEWED_NOOP_CANDIDATE_BUNDLE } from './reviewed-noop-candidate';

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const APPROVED_GMAIL_AUTHORITY = Object.freeze({
  id: 'reviewed-gmail-message-v1',
  version: '1',
  digest: '2b21f771d2cf172e33e8f78e5d1deaaefc0a5e8ff45f7d9f252cb8ec321ad56a',
  sourceReceiptSha256: '2e8b7a2666cfc07c7609fdc9a2bdf01be291195a8b7da0af0f69836a180f8685',
  sourceReceiptCanonicalDigest: '965de9fabde482dd5a6bcc67299fce8c33232e78c9fdc70053ad588b0f62ba2a',
});

/** Public-safe digest pins only; no receipt bodies, local paths, or upstream source bytes. */
export const NOOP_ADMISSION_PINS = Object.freeze({
  schemaVersion: 'b1-noop-runtime-admission-v1',
  decision: 'APPROVED',
  approvedReceiptSha256: '67c56b00ecb34afee3e0c58b69286309f2c7d4be5f6d55c38e3da4bb752d10d1',
  canonicalReviewReceiptDigest: '36cfbd22e5335923106797ee20368c46f0c3fc79c09dfe2cea11034225128d72',
  manifestDigest: '60fdccd5f5f7148aadd7628915df8d6b712e1e3643e270ebe49d8dcb18d54a26',
  packetSha256: 'bd4ad8dcf252e9da18c503f396357fe25786905b1a810560f61474a20eadde4c',
  candidateKey: 'n8n-nodes-base.noOp@1.0.0:ABSENT/ABSENT',
  recordDigest: '7efb157da44e6cf48fe047dc0d80acf57983afc0741075eef1f3b813f6d35c24',
  evidenceArtifactDigest: 'e0d874ca809429cc829d4c512a71cdf3f5d9119e69041286cdd15bdbd5e8cfc4',
  evidenceDigest: 'a8a27318004cffa3a43214e6a2e7dd3db03ae7c076356fec4ce7a6d05b81eba7',
  fixtureDigest: '525df167406a2fb21d1278d570e25e177cd81c8690d4ee812353961d3e2edcb4',
  f1ProducerReceiptSha256: 'b220e2f736e1a84cdcab496e6acf0b05831c5f72373f8a48bdc2ebdbeac39535',
  f1CohortReceiptSha256: 'db78835bcea0edcbfd99c9cfb646d86706231598b8eda59e9f8a49d59e8620aa',
  f1ReviewArtifactSha256: '52d363e63b9f017f72f2356fa6585f160bd5042230876d87eb65219df7c3410f',
  scopedBundleDigest: 'a4feec7c2b83c997ed7ba618c6660315ee98cf32c494afab048badcae18f6ea5',
  sourceReceiptDigests: Object.freeze([
    '2e8b7a2666cfc07c7609fdc9a2bdf01be291195a8b7da0af0f69836a180f8685',
    '52d363e63b9f017f72f2356fa6585f160bd5042230876d87eb65219df7c3410f',
    'b220e2f736e1a84cdcab496e6acf0b05831c5f72373f8a48bdc2ebdbeac39535',
    'd150bb17b79af5796e61513a2fc95930f039171126afbdcf31e8002fffa263a3',
    'db78835bcea0edcbfd99c9cfb646d86706231598b8eda59e9f8a49d59e8620aa',
    'f4cfd59b8122e4426adc3fd81753b5baa99430a83ed9ac4f0607ad39bd62682e',
  ]),
});

export const NOOP_ADMISSION_PINS_DIGEST = 'de36a703762161789de074be2fca7572c158e3d10b8dd5f435903105e67ff421';
export const REVIEWED_SCOPED_AUTHORITY_DIGEST = '8e483456c9a8f941c2570cb5bae61acacbbf619bf3d2fc59af48770dc3cb93f4';

function digest(value: unknown): string {
  return bytesToHex(sha256(canonicalJsonBytes(value)));
}

export function noopCandidateRecordDigest(bundle: ScopedCatalogueBundleV1): string {
  const item = bundle.records[0];
  if (!item) return '';
  return digest({ record: { ...item.record, resourceScope: item.resourceScope, operationScope: item.operationScope }, resource: null });
}

export function computeNoopAdmissionPinsDigest(pins: unknown = NOOP_ADMISSION_PINS): string {
  return digest(pins);
}

export function computeReviewedScopedAuthorityDigest(input: Readonly<{
  gmail: typeof APPROVED_GMAIL_AUTHORITY;
  noopAdmissionDigest: string;
  noopBundleDigest: string;
}>): string {
  return digest({ schemaVersion: 'reviewed-scoped-semantics-authority-v2', ...input });
}

export function reviewedNoopAdmissionIsIntact(
  pins: unknown = NOOP_ADMISSION_PINS,
  bundle: unknown = REVIEWED_NOOP_CANDIDATE_BUNDLE,
): boolean {
  try {
    if (computeNoopAdmissionPinsDigest(pins) !== NOOP_ADMISSION_PINS_DIGEST) return false;
    const admitted = admitScopedCatalogue(bundle);
    const typedPins = pins as typeof NOOP_ADMISSION_PINS;
    const record = admitted.records[0];
    return typedPins.schemaVersion === 'b1-noop-runtime-admission-v1'
      && typedPins.decision === 'APPROVED'
      && Object.entries(typedPins).every(([key, value]) => key === 'schemaVersion' || key === 'decision' || key === 'candidateKey'
        ? true
        : Array.isArray(value) ? value.every((item) => typeof item === 'string' && HEX_SHA256.test(item))
          : typeof value === 'string' && HEX_SHA256.test(value))
      && typedPins.candidateKey === 'n8n-nodes-base.noOp@1.0.0:ABSENT/ABSENT'
      && typedPins.scopedBundleDigest === admitted.digest
      && admitted.digest === REVIEWED_NOOP_CANDIDATE_BUNDLE.digest
      && record !== undefined && noopCandidateRecordDigest(admitted) === typedPins.recordDigest
      && typedPins.sourceReceiptDigests.length === 6;
  } catch {
    return false;
  }
}

export function reviewedScopedAuthorityIsIntact(
  gmailDigest: string,
  expectedAggregateDigest: string = REVIEWED_SCOPED_AUTHORITY_DIGEST,
): boolean {
  try {
    return gmailDigest === APPROVED_GMAIL_AUTHORITY.digest
      && reviewedNoopAdmissionIsIntact()
      && computeReviewedScopedAuthorityDigest({
        gmail: APPROVED_GMAIL_AUTHORITY,
        noopAdmissionDigest: NOOP_ADMISSION_PINS_DIGEST,
        noopBundleDigest: NOOP_ADMISSION_PINS.scopedBundleDigest,
      }) === expectedAggregateDigest
      && expectedAggregateDigest === REVIEWED_SCOPED_AUTHORITY_DIGEST;
  } catch {
    return false;
  }
}

