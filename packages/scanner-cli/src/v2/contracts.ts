import { createHash } from 'node:crypto';
import { canonicalizeJson } from '@hub/scanner-core/canonical-json';
export const SCAN_CONFIG_SCHEMA_V2 = 'n8n-scan-config-v2' as const;
export type ScanFormatV2 = 'json' | 'ndjson' | 'sarif' | 'table' | 'pretty' | 'markdown';
export type ScanSeverityV2 = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type ScanConfidenceV2 = 'HIGH' | 'MEDIUM' | 'LOW';
export type ScanFailOnV2 = ScanSeverityV2 | 'NONE';
export type AdmittedProfileIdV2 = 'standard' | 'strict' | 'beta-default' | 'beta-hardened';
export type AdmittedProfileEntryV2 = Readonly<{ id: AdmittedProfileIdV2; version: '2.0.0' | '3.0.0'; digest: string }>;
export type ScanConfigV2 = Readonly<{
  schemaVersion: typeof SCAN_CONFIG_SCHEMA_V2;
  format?: ScanFormatV2;
  profile?: string;
  output?: string;
  inputs?: readonly string[];
  configPath?: string;
  failOn?: ScanFailOnV2;
  minSeverity?: ScanSeverityV2;
  minConfidence?: ScanConfidenceV2;
  baseline?: string;
  requireComplete?: boolean;
  concurrency?: number;
  rules?: string;
  catalogue?: string;
  limits?: string;
  target?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  approvedDomains?: readonly string[];
  allowUnsignedDevelopmentRules?: boolean;
  noColor?: boolean;
}>;

export const ADMITTED_PROFILE_V2 = Object.freeze({ id: 'beta-default', version: '2.0.0', digest: '3ca5d69db2554383e22c44afe507cc98e381ea58a7e42aaac0ee8f7497fb4f44' } as const);
export const DEFAULT_PROFILE_V3 = Object.freeze({ id: 'standard', version: '3.0.0', digest: '92125186a718e17fe1d0d43def179c1d3c0f198214426c8c7718879bcdd20055' } as const);
export const ADMITTED_PROFILES_V2: readonly AdmittedProfileEntryV2[] = Object.freeze([
  DEFAULT_PROFILE_V3,
  Object.freeze({ id: 'strict', version: '3.0.0', digest: '23d6676bc0f6f5bf3c7586fb8bfd1cea663fdb4cbf4e3daa15b563b101b6941f' } as const),
  ADMITTED_PROFILE_V2,
  Object.freeze({ id: 'beta-hardened', version: '2.0.0', digest: 'c3f2f8b367f78f4e1e23df77226f6e286c05d5744552d8513e4de25239f8cf71' } as const),
]);

const PROFILE_SPECIFIER_MAP_V2: Readonly<Record<string, AdmittedProfileEntryV2>> = Object.freeze({
  standard: ADMITTED_PROFILES_V2[0]!,
  'standard@3.0.0': ADMITTED_PROFILES_V2[0]!,
  strict: ADMITTED_PROFILES_V2[1]!,
  'strict@3.0.0': ADMITTED_PROFILES_V2[1]!,
  ci: ADMITTED_PROFILES_V2[1]!,
  'beta-default': ADMITTED_PROFILES_V2[2]!,
  'beta-default@2.0.0': ADMITTED_PROFILES_V2[2]!,
  'beta-hardened': ADMITTED_PROFILES_V2[3]!,
  'beta-hardened@2.0.0': ADMITTED_PROFILES_V2[3]!,
});

/**
 * The profile spellings a caller may write, and the one place they are listed. Both the
 * config loader and the MCP tool read this, so a profile cannot be admitted on one
 * surface and refused on the other; bare ids, `ci`, and `id@version` pins resolve here.
 */
export const ADMITTED_PROFILE_SPECIFIERS_V2: readonly string[] = Object.freeze(Object.keys(PROFILE_SPECIFIER_MAP_V2));

export function resolveAdmittedProfileV2(value: unknown): AdmittedProfileEntryV2 | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFILE_SPECIFIER_MAP_V2, value)
    ? PROFILE_SPECIFIER_MAP_V2[value]
    : undefined;
}

export function isAdmittedProfileSpecifierV2(value: unknown): value is string {
  return resolveAdmittedProfileV2(value) !== undefined;
}
export const BUILTIN_AUTHORITIES_V2 = Object.freeze({
  profile: ADMITTED_PROFILE_V2,
  rules: Object.freeze({ id: 'scanner-core-builtins', version: '2.0.0', digest: '2fe4e21d885542c0716599c95f34abdc12eaa1ce652791d871a73521f5fc6257', signatureStatus: 'VERIFIED' as const }),
  semantics: Object.freeze({ id: 'scanner-core-builtins', version: '2.2.0', digest: '58419339dcf99ed398d2955282662e6f6d37208f62393cafb56818d4a38182d7' }),
  limits: Object.freeze({ schemaVersion: 'scanner-limits-v2' as const, digest: 'fca787753ca88f71cf0d174427f4ac730a7aef1c823aaf73aa1ea72af92b4077' }),
});
export const PROFILE_MANIFEST_DIGEST_V2 = ADMITTED_PROFILE_V2.digest;
export const BUILTIN_RULESET_AUTHORITY_V2 = BUILTIN_AUTHORITIES_V2.rules;
export const BUILTIN_SEMANTICS_AUTHORITY_V2 = BUILTIN_AUTHORITIES_V2.semantics;
export const BUILTIN_LIMITS_AUTHORITY_V2 = BUILTIN_AUTHORITIES_V2.limits;
export const RULE_PACK_DIGEST_V2 = BUILTIN_RULESET_AUTHORITY_V2.digest;
export const SEMANTIC_CATALOGUE_DIGEST_V2 = BUILTIN_SEMANTICS_AUTHORITY_V2.digest;
/** Detached literals: parity checks must detect drift rather than importing live core pins. */
export const BUILTIN_SCOPED_SEMANTICS_AUTHORITY_V2 = Object.freeze({
  id: 'reviewed-gmail-message+noop-b1-v1', version: '1',
  digest: '8e483456c9a8f941c2570cb5bae61acacbbf619bf3d2fc59af48770dc3cb93f4',
  gmailDigest: '2b21f771d2cf172e33e8f78e5d1deaaefc0a5e8ff45f7d9f252cb8ec321ad56a',
  sourceReceiptSha256: '2e8b7a2666cfc07c7609fdc9a2bdf01be291195a8b7da0af0f69836a180f8685',
  sourceReceiptCanonicalDigest: '965de9fabde482dd5a6bcc67299fce8c33232e78c9fdc70053ad588b0f62ba2a',
  noopAdmissionDigest: 'de36a703762161789de074be2fca7572c158e3d10b8dd5f435903105e67ff421',
  noopBundleDigest: 'a4feec7c2b83c997ed7ba618c6660315ee98cf32c494afab048badcae18f6ea5',
});

/**
 * One tool identity for every machine surface: the JSON/NDJSON scan envelopes and the
 * rules/explain/profiles metadata documents. The digest folds the admitted engine, profile,
 * ruleset, and semantics authorities, so a re-pin moves every surface together instead of
 * leaving a frozen literal behind on one of them.
 */
export const CLI_VERSION_V2 = '0.3.1' as const;
export type CliToolIdentityV2 = Readonly<{ name: 'n8n-scan'; version: string; buildDigest: string }>;
export const CLI_TOOL_V2: CliToolIdentityV2 = Object.freeze({
  name: 'n8n-scan',
  version: CLI_VERSION_V2,
  buildDigest: createHash('sha256').update(canonicalizeJson({
    engine: 'secureflow-scanner', version: '2.0.0', profile: ADMITTED_PROFILE_V2,
    ruleset: BUILTIN_RULESET_AUTHORITY_V2.digest, semantics: BUILTIN_SEMANTICS_AUTHORITY_V2.digest,
    scopedSemantics: BUILTIN_SCOPED_SEMANTICS_AUTHORITY_V2,
  })).digest('hex'),
});

export const DEFAULT_SCAN_CONFIG_V2: ScanConfigV2 = Object.freeze({
  schemaVersion: SCAN_CONFIG_SCHEMA_V2,
  format: 'json', profile: DEFAULT_PROFILE_V3.id, failOn: 'INFO', requireComplete: false, concurrency: 1,
  rules: 'builtin', catalogue: 'builtin', limits: 'builtin',
  include: Object.freeze(['**/*.json']), exclude: Object.freeze(['.git/**', 'node_modules/**']),
  approvedDomains: Object.freeze([]),
  allowUnsignedDevelopmentRules: false, noColor: false,
});

export const SCAN_CONFIG_V2_FIELDS = Object.freeze([
  'schemaVersion', 'format', 'profile', 'output', 'inputs', 'configPath', 'failOn', 'minSeverity', 'minConfidence', 'baseline',
  'requireComplete', 'concurrency', 'rules', 'catalogue', 'limits', 'target', 'include', 'exclude', 'approvedDomains',
  'allowUnsignedDevelopmentRules', 'noColor',
] as const);
export const SCAN_CONFIG_V2_MAX_STRING = 4096;
export const SCAN_CONFIG_V2_MAX_PATTERNS = 1024;
export const SCAN_CONFIG_V2_MAX_CONCURRENCY = 16;
export const SCAN_CONFIG_V2_MAX_DOMAINS = 1_000;
export const DOMAIN_V2 = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export function isApprovedDomainV2(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_V2.test(value);
}
