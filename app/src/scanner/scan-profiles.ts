export type ScanProfile = 'standard' | 'strict' | 'beta-default' | 'beta-hardened';

export const DEFAULT_SCAN_PROFILE: ScanProfile = 'standard';

export type ScanProfileRefV2 = Readonly<{ id: ScanProfile; version: '2.0.0' | '3.0.0' }>;

const V2_PROFILE_REFS: Readonly<Record<ScanProfile, ScanProfileRefV2>> = Object.freeze({
  standard: Object.freeze({ id: 'standard', version: '3.0.0' }),
  strict: Object.freeze({ id: 'strict', version: '3.0.0' }),
  'beta-default': Object.freeze({ id: 'beta-default', version: '2.0.0' }),
  'beta-hardened': Object.freeze({ id: 'beta-hardened', version: '2.0.0' }),
});

export function isScanProfile(value: unknown): value is ScanProfile {
  return value === 'standard' || value === 'strict' || value === 'beta-default' || value === 'beta-hardened';
}

export function resolveV2ProfileRef(profile: ScanProfile): ScanProfileRefV2 {
  return V2_PROFILE_REFS[profile];
}

export function resolveLegacyProfileId(profile: ScanProfile): 'beta-default' | 'beta-hardened' {
  return profile === 'beta-default' ? 'beta-default' : 'beta-hardened';
}
