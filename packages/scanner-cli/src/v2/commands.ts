import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compareCanonicalStrings } from '@hub/contracts/stable-order';
import { canonicalizeJson } from '@hub/scanner-core/canonical-json';
import { ADMITTED_PROFILE_MANIFESTS_V2, ENGINE_BUILD_DIGEST_V2, STANDARD_PROFILE_MANIFEST, createAdmittedRuleView } from '@hub/scanner-core/v2';
import type { CliCommandV2 } from './arguments.js';
import {
  BUILTIN_LIMITS_AUTHORITY_V2,
  BUILTIN_RULESET_AUTHORITY_V2,
  BUILTIN_SEMANTICS_AUTHORITY_V2,
  CLI_TOOL_V2,
  loadExplicitConfig,
} from './config.js';
import { DEFAULT_PROFILE_V3, isAdmittedProfileSpecifierV2, resolveAdmittedProfileV2 } from './contracts.js';
import { RULE_EVIDENCE_V2, RULE_PROSE_V2, type ProseV2 } from './rule-metadata-v2.js';

type CliSeverityV2 = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
type CliConfidenceV2 = 'LOW' | 'MEDIUM' | 'HIGH';
type ToolV2 = Readonly<{ name: 'n8n-scan'; version: string; buildDigest: string }>;
type CapabilityV2 = Readonly<{ id: string; version: string; required: boolean; dependsOn: readonly string[]; ruleIds: readonly string[] }>;

export type CliRuleSummaryV2 = Readonly<{ ruleId: string; revision: string; effect: 'SCORING' | 'REPORT_ONLY'; severity: CliSeverityV2; confidence: CliConfidenceV2; capabilityId: string; evidenceSchemaId: string; remediationId: string; cweIds: readonly string[]; owaspAgenticIds: readonly string[] }>;
export type CliArtifactIdentityV2 = Readonly<{ profile: { id: string; version: string }; ruleset: { id: string; version: string; digest: string; signatureStatus: 'VERIFIED' | 'UNVERIFIED' }; semantics: { id: string; version: string; digest: string }; target: { schemaVersion: 'scanner-target-v3'; edition: 'UNKNOWN'; deployment: 'UNKNOWN'; role: 'UNKNOWN'; taskRunner: 'UNKNOWN'; communityPackages: readonly never[]; configuration: readonly never[]; contextDigest: string }; limits: { schemaVersion: 'scanner-limits-v2'; digest: string } }>;
export type CliRulesDocumentV2 = Readonly<{ schemaVersion: 'n8n-scan-rules-v2'; tool: ToolV2; artifacts: CliArtifactIdentityV2; rules: readonly CliRuleSummaryV2[] }>;
export type CliExplainDocumentV2 = Readonly<{ schemaVersion: 'n8n-scan-explain-v2'; tool: ToolV2; artifacts: CliArtifactIdentityV2; rule: CliRuleSummaryV2; prose: ProseV2; evidenceProperties: readonly string[]; provenance: { packDigest: string; semanticsDigest: string } }>;
export type CliProfileSummaryV2 = Readonly<{ id: string; version: string; admitted: boolean; advertised: boolean; digest: string; scoringPolicyVersion: string; capabilities: readonly CapabilityV2[] }>;
export type CliProfilesDocumentV2 = Readonly<{ schemaVersion: 'n8n-scan-profiles-v2'; tool: ToolV2; profiles: readonly CliProfileSummaryV2[] }>;
export type CliVersionDocumentV2 = Readonly<{ schemaVersion: 'n8n-scan-version-v2'; name: 'n8n-scan'; cliVersion: string; engine: { id: 'secureflow-scanner'; version: '2.0.0'; buildDigest: string }; resultSchemas: readonly ['scanner-result-v1', 'scanner-result-v2']; configSchema: 'n8n-scan-config-v2'; rulesetDigest: string; semanticsDigest: string; trustStoreDigest: string; mode: 'offline' }>;
export type CliConfigValidationDocumentV2 = Readonly<{ schemaVersion: 'n8n-scan-config-validation-v2'; valid: true; artifacts: CliArtifactIdentityV2 }>;
export type CliMetadataDocumentV2 = CliRulesDocumentV2 | CliExplainDocumentV2 | CliProfilesDocumentV2 | CliVersionDocumentV2 | CliConfigValidationDocumentV2;
export type CliCommandResultV2 = Readonly<{ ok: true; document: CliMetadataDocumentV2 } | { ok: true; command: Extract<CliCommandV2, { kind: 'scan' }> } | { ok: false; code: 'USAGE'; message: string }>;

const hash = (value: unknown): string => createHash('sha256').update(canonicalizeJson(value)).digest('hex');
const targetBody = Object.freeze({ schemaVersion: 'scanner-target-v3' as const, edition: 'UNKNOWN' as const, deployment: 'UNKNOWN' as const, role: 'UNKNOWN' as const, taskRunner: 'UNKNOWN' as const, communityPackages: Object.freeze([]), configuration: Object.freeze([]) });
const STANDARD_RULE_VIEW = createAdmittedRuleView(STANDARD_PROFILE_MANIFEST);
const ADMITTED_RULES = Object.freeze([...STANDARD_RULE_VIEW.rules.values()]);

function artifacts(profileSpecifier: string = DEFAULT_PROFILE_V3.id): CliArtifactIdentityV2 {
  const profile = resolveAdmittedProfileV2(profileSpecifier) ?? DEFAULT_PROFILE_V3;
  const target = Object.freeze({ ...targetBody, contextDigest: hash(targetBody) });
  return Object.freeze({
    profile: Object.freeze({ id: profile.id, version: profile.version }),
    ruleset: Object.freeze({ ...BUILTIN_RULESET_AUTHORITY_V2 }),
    semantics: Object.freeze({ ...BUILTIN_SEMANTICS_AUTHORITY_V2 }),
    target,
    limits: Object.freeze({ schemaVersion: 'scanner-limits-v2', digest: BUILTIN_LIMITS_AUTHORITY_V2.digest }),
  });
}

function ruleSummary(entry: (typeof ADMITTED_RULES)[number]): CliRuleSummaryV2 {
  return Object.freeze({
    ruleId: entry.ruleId,
    revision: entry.revision,
    effect: entry.effect,
    severity: entry.severity,
    confidence: entry.confidence,
    capabilityId: entry.capabilityId,
    evidenceSchemaId: entry.evidenceSchemaId,
    remediationId: entry.remediationId,
    cweIds: Object.freeze([...entry.cweIds].sort(compareCanonicalStrings)),
    owaspAgenticIds: Object.freeze([...entry.owaspAgenticIds].sort(compareCanonicalStrings)),
  });
}

export function rulesDocumentV2(): CliRulesDocumentV2 {
  return Object.freeze({ schemaVersion: 'n8n-scan-rules-v2', tool: CLI_TOOL_V2, artifacts: artifacts(), rules: Object.freeze(ADMITTED_RULES.map(ruleSummary)) });
}

export function explainDocumentV2(
  ruleId: string,
): Readonly<{ ok: true; document: CliExplainDocumentV2 } | { ok: false; code: 'USAGE'; message: string }> {
  const entry = STANDARD_RULE_VIEW.rules.get(ruleId);
  const prose = RULE_PROSE_V2[ruleId];
  if (!entry || !prose) return Object.freeze({ ok: false as const, code: 'USAGE', message: 'Unknown rule.' });
  return Object.freeze({
    ok: true as const,
    document: Object.freeze({
      schemaVersion: 'n8n-scan-explain-v2',
      tool: CLI_TOOL_V2,
      artifacts: artifacts(),
      rule: ruleSummary(entry),
      prose: Object.freeze({ ...prose, remediationSteps: Object.freeze([...prose.remediationSteps]) }),
      evidenceProperties: Object.freeze([...(RULE_EVIDENCE_V2[ruleId] ?? [])]),
      provenance: Object.freeze({ packDigest: BUILTIN_RULESET_AUTHORITY_V2.digest, semanticsDigest: BUILTIN_SEMANTICS_AUTHORITY_V2.digest }),
    }),
  });
}

export function profilesDocumentV2(): CliProfilesDocumentV2 {
  return Object.freeze({
    schemaVersion: 'n8n-scan-profiles-v2',
    tool: CLI_TOOL_V2,
    profiles: Object.freeze(
      ADMITTED_PROFILE_MANIFESTS_V2.map((manifest) =>
        Object.freeze({
          id: manifest.id,
          version: manifest.version,
          admitted: true,
          advertised: true,
          digest: manifest.digest,
          scoringPolicyVersion: manifest.scoringPolicyVersion,
          capabilities: Object.freeze(
            manifest.capabilities.map((item) =>
              Object.freeze({
                id: item.id,
                version: item.version,
                required: item.required,
                dependsOn: Object.freeze([...item.dependsOn]),
                ruleIds: Object.freeze([...item.ruleIds]),
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

export function versionDocumentV2(): CliVersionDocumentV2 {
  return Object.freeze({
    schemaVersion: 'n8n-scan-version-v2',
    name: 'n8n-scan',
    cliVersion: CLI_TOOL_V2.version,
    engine: Object.freeze({ id: 'secureflow-scanner', version: '2.0.0', buildDigest: ENGINE_BUILD_DIGEST_V2 }),
    resultSchemas: Object.freeze(['scanner-result-v1', 'scanner-result-v2']) as CliVersionDocumentV2['resultSchemas'],
    configSchema: 'n8n-scan-config-v2',
    rulesetDigest: BUILTIN_RULESET_AUTHORITY_V2.digest,
    semanticsDigest: BUILTIN_SEMANTICS_AUTHORITY_V2.digest,
    trustStoreDigest: hash({ schemaVersion: 'scanner-trust-store-v2', version: '2.0.0', keys: [] }),
    mode: 'offline',
  });
}

export function validateConfigDocumentV2(
  input: unknown,
  configDirectory?: string,
): Readonly<{ ok: true; document: CliConfigValidationDocumentV2 } | { ok: false; code: 'USAGE'; message: string }> {
  const result = loadExplicitConfig(input, { configDirectory });
  if (!result.ok) return Object.freeze({ ok: false, code: 'USAGE', message: 'Configuration is invalid.' });
  return Object.freeze({
    ok: true,
    document: Object.freeze({ schemaVersion: 'n8n-scan-config-validation-v2', valid: true, artifacts: artifacts(result.config.profile) }),
  });
}

export function isAdmittedConfigPathV2(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) return false;
  const normalized = path.replaceAll('\\', '/');
  if (/^(?:[a-z][a-z\d+.-]*:|\/|[a-z]:|\\\\)/i.test(normalized) || /(?:^|\/)\.\.(?:\/|$)/.test(normalized) || /(?:^|\/)%2e(?:%2e)?(?:\/|$)/i.test(normalized)) {
    return false;
  }
  return normalized.split('/').some((part) => part !== '' && part !== '.');
}

export function runCommandV2(command: CliCommandV2, configInput?: unknown, configDirectory?: string): CliCommandResultV2 {
  if (command.kind === 'scan') {
    return isAdmittedProfileSpecifierV2(command.profile)
      ? Object.freeze({ ok: true, command })
      : Object.freeze({ ok: false, code: 'USAGE', message: 'Profile is not admitted.' });
  }
  if (command.kind === 'fix') return Object.freeze({ ok: false, code: 'USAGE', message: 'Fix commands are not metadata commands.' });
  if (command.kind === 'rules') return Object.freeze({ ok: true, document: rulesDocumentV2() });
  if (command.kind === 'profiles') return Object.freeze({ ok: true, document: profilesDocumentV2() });
  if (command.kind === 'version') return Object.freeze({ ok: true, document: versionDocumentV2() });
  if (command.kind === 'explain') return explainDocumentV2(command.ruleId);
  if (!isAdmittedConfigPathV2(command.path)) return Object.freeze({ ok: false, code: 'USAGE', message: 'Configuration path is not admitted.' });
  let input = configInput;
  if (input === undefined) {
    try {
      input = readFileSync(command.path, 'utf8');
    } catch {
      return Object.freeze({ ok: false, code: 'USAGE', message: 'Configuration could not be read.' });
    }
  }
  return validateConfigDocumentV2(input, configDirectory);
}
