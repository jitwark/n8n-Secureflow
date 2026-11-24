import type { FindingV2, SafeFactV2 } from '@hub/contracts/scanner-v2-evidence';
import { resolveAdmittedProfileManifest } from '../../capabilities/profile-manifest';
import { V1_EVIDENCE_PROJECTIONS, V1_RULE_REGISTRY, V1_RULE_TEMPLATES } from '../../compat/v1-registry';
import { SAFE_FACT_EVIDENCE_MAPPINGS_V2, TAINTED_RULE_SINK_CLASSES_V1, type SafeFactEvidenceMappingV2 } from '../../facts/safe-fact-registry';
import { createAdmittedRuleView } from '../../v2/admitted-registry';
import { inv } from './helpers';

export type SarifRuleProseV2 = Readonly<{
  title: string;
  explanation: string;
  remediation: string;
  message: string;
}>;

export type SarifRuleAuthorityV2 = Readonly<{
  ruleId: string;
  revision: string;
  capabilityId: string;
  effect: FindingV2['effect'];
  severity: FindingV2['severity'];
  confidence: FindingV2['confidence'];
  evidenceSchemaId: string;
  remediationId: string;
  evidenceClass: FindingV2['evidenceClass'];
}>;

export type SarifRuleLookupV2 = Readonly<{
  has(ruleId: string): boolean;
  get(ruleId: string): SarifRuleAuthorityV2 | undefined;
  checkFindingAuthority(finding: FindingV2, facts: ReadonlyMap<string, SafeFactV2>): void;
}>;

const V3_EXTRA_SARIF_META: ReadonlyArray<readonly [string, SarifRuleProseV2]> = [
  [
    'EXPRESSION_SANDBOX_ESCAPE',
    Object.freeze({
      title: 'Expression attempts to escape the n8n sandbox',
      message: 'This expression references code evaluation, constructor chains, or Node runtime internals.',
      explanation:
        'The expression analyzer detected dynamic evaluation, prototype or constructor-chain traversal, or module and process access inside an n8n expression parameter.',
      remediation: 'Remove dynamic evaluation, constructor escapes, and process or module access from n8n expressions.',
    }),
  ],
  [
    'EXPRESSION_ENV_EXPOSURE',
    Object.freeze({
      title: 'Expression accesses environment variables or runtime secrets',
      message: 'This expression reads $env, $secrets, or process environment variables directly.',
      explanation:
        'The expression analyzer found direct reads of $env, $secrets, or process.env inside an n8n expression parameter rather than managed credential references.',
      remediation: 'Use managed n8n credentials instead of reading $env, $secrets, or process.env in expressions.',
    }),
  ],
  [
    'AGENT_EGRESS_UNRESTRICTED',
    Object.freeze({
      title: 'AI agent has unrestricted external egress capability',
      message: 'This AI agent holds unconstrained HTTP or execution tools without strict egress bounds.',
      explanation:
        'The agentic-control analyzer determined that an autonomous AI agent is connected to external request or execution tools whose destinations are not restricted or human-gated.',
      remediation: 'Restrict agent HTTP tool URLs to an approved domain allowlist or add a human approval gate on every path.',
    }),
  ],
  [
    'UNAUTHENTICATED_TRIGGER_TO_SINK',
    Object.freeze({
      title: 'Unauthenticated external trigger reaches a privileged sink',
      message: 'An unauthenticated inbound trigger reaches a privileged sink without a human gate.',
      explanation:
        'Graph reachability analysis found an execution path from an unauthenticated webhook, form, or chat trigger to a command, SQL, file, code, agent, or HTTP sink with no dominating approval gate.',
      remediation: 'Require authentication on the external trigger or enforce a human-approval gate on every path before the sink.',
    }),
  ],
];

const ruleProseById: ReadonlyMap<string, SarifRuleProseV2> = new Map([
  ...V1_RULE_TEMPLATES.map((template): readonly [string, SarifRuleProseV2] => [
    template.ruleId,
    Object.freeze({
      title: template.title,
      explanation: template.explanation,
      remediation: template.remediation,
      message: template.message,
    }),
  ]),
  ...V3_EXTRA_SARIF_META,
]);

const mappingsByRuleId: ReadonlyMap<string, SafeFactEvidenceMappingV2> = new Map(
  SAFE_FACT_EVIDENCE_MAPPINGS_V2.map((mapping) => [mapping.ruleId, mapping]),
);

const v1ProjectionsByRuleId = new Map(
  V1_EVIDENCE_PROJECTIONS.map((projection) => [projection.ruleId, projection]),
);

const TAINT_V2_REQUIRED_PROPERTIES = ['flowKind', 'sink', 'parameterPath', 'referenceRoot', 'taintLabels'] as const;

const hasOwn = (record: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

export function getSarifRuleMeta(ruleId: string): SarifRuleProseV2 | undefined {
  return ruleProseById.get(ruleId);
}

function validateTaintFacts(finding: FindingV2, mapping: SafeFactEvidenceMappingV2, facts: readonly SafeFactV2[]): void {
  const expectedSink = TAINTED_RULE_SINK_CLASSES_V1[finding.ruleId];
  if (facts.some((fact) => fact.kind !== 'dataflow.summary.v3' && fact.kind !== 'dataflow.summary.v2')) return inv();
  const v3Facts = facts.filter((fact) => fact.kind === 'dataflow.summary.v3');
  const v2Facts = facts.filter((fact) => fact.kind === 'dataflow.summary.v2');
  if ((v3Facts.length > 0 && v2Facts.length > 0) || v3Facts.length > 1 || v2Facts.length > 1) return inv();
  if (v3Facts.length === 1) {
    const fact = v3Facts[0]!;
    const v3Props = mapping.factPropertiesByKind['dataflow.summary.v3'] ?? [];
    for (const propName of v3Props) {
      if (propName !== 'propertyPath' && !hasOwn(fact.properties, propName)) return inv();
    }
    if (expectedSink !== undefined && fact.properties.sinkClass !== expectedSink) return inv();
    return;
  }
  const v2Fact = v2Facts[0]!;
  for (const propName of TAINT_V2_REQUIRED_PROPERTIES) {
    if (!hasOwn(v2Fact.properties, propName)) return inv();
  }
  if (v2Fact.properties.flowKind !== 'TAINT_SINK') return inv();
  if (expectedSink !== undefined && v2Fact.properties.sink !== expectedSink) return inv();
}

function validateMappedFacts(finding: FindingV2, mapping: SafeFactEvidenceMappingV2, facts: readonly SafeFactV2[]): void {
  if (facts.some((fact) => !mapping.factKinds.includes(fact.kind))) return inv();
  const projection = v1ProjectionsByRuleId.get(finding.ruleId);
  for (const [factKind, propNames] of Object.entries(mapping.factPropertiesByKind)) {
    for (const propName of propNames) {
      const projProp = projection?.properties.find((item) => item.factKind === factKind && item.factProperty === propName);
      const required = projProp ? projProp.required : !(factKind === 'code.indicator.v2' && propName === 'member');
      const matches = facts.filter((fact) => fact.kind === factKind && hasOwn(fact.properties, propName));
      if (matches.length > 1 || (required && matches.length !== 1)) return inv();
    }
  }
  if (finding.ruleId === 'UNAUTHENTICATED_TRIGGER_TO_SINK' && facts.some((fact) => fact.properties.flowKind !== 'TRIGGER_SINK')) return inv();
  if ((finding.ruleId === 'EXPRESSION_SANDBOX_ESCAPE' || finding.ruleId === 'EXPRESSION_ENV_EXPOSURE')
    && facts.some((fact) => hasOwn(fact.properties, 'language') && fact.properties.language !== 'EXPRESSION')) return inv();
  if (finding.ruleId === 'JAVASCRIPT_DYNAMIC_EXECUTION'
    && facts.some((fact) => hasOwn(fact.properties, 'language') && fact.properties.language !== 'JAVASCRIPT')) return inv();
  if (finding.ruleId === 'PYTHON_DYNAMIC_EXECUTION'
    && facts.some((fact) => hasOwn(fact.properties, 'language') && fact.properties.language !== 'PYTHON')) return inv();
  if (finding.ruleId === 'AI_AGENT_UNGATED_TOOL'
    && facts.some((fact) => fact.kind === 'dataflow.summary.v2' && hasOwn(fact.properties, 'flowKind') && fact.properties.flowKind !== 'AGENT_INFLUENCE')) return inv();
  if (finding.ruleId === 'AGENT_EGRESS_UNRESTRICTED' && facts.some((fact) =>
    !Array.isArray(fact.properties.capabilities) || !fact.properties.capabilities.includes('AI_AGENT')
    || typeof fact.properties.toolCount !== 'number' || fact.properties.toolCount <= 0)) return inv();
}

function buildRuleMap(profile: Readonly<{ id: string; version: string }>): ReadonlyMap<string, SarifRuleAuthorityV2> {
  const manifest = resolveAdmittedProfileManifest(profile);
  const sourceRules = manifest !== undefined
    ? [...createAdmittedRuleView(manifest).rules.values()]
    : V1_RULE_REGISTRY;
  const entries = new Map<string, SarifRuleAuthorityV2>();
  for (const rule of sourceRules) {
    const mapping = mappingsByRuleId.get(rule.ruleId);
    if (!mapping) continue;
    entries.set(rule.ruleId, Object.freeze({
      ruleId: rule.ruleId,
      revision: rule.revision,
      capabilityId: rule.capabilityId,
      effect: rule.effect,
      severity: rule.severity,
      confidence: rule.confidence,
      evidenceSchemaId: rule.evidenceSchemaId,
      remediationId: rule.remediationId,
      evidenceClass: mapping.evidenceClass,
    }));
  }
  return entries;
}

export function sarifRuleLookupForProfile(profile: Readonly<{ id: string; version: string }>): SarifRuleLookupV2 {
  const rules = buildRuleMap(profile);
  return Object.freeze({
    has: (ruleId: string): boolean => rules.has(ruleId),
    get: (ruleId: string): SarifRuleAuthorityV2 | undefined => rules.get(ruleId),
    checkFindingAuthority(finding: FindingV2, facts: ReadonlyMap<string, SafeFactV2>): void {
      const rule = rules.get(finding.ruleId);
      const prose = getSarifRuleMeta(finding.ruleId);
      const mapping = mappingsByRuleId.get(finding.ruleId);
      if (!rule || !prose || !mapping) return inv();
      if (mapping.evidenceSchemaId !== rule.evidenceSchemaId
        || finding.ruleRevision !== rule.revision
        || finding.effect !== rule.effect
        || finding.severity !== rule.severity
        || finding.confidence !== rule.confidence
        || finding.remediationId !== rule.remediationId
        || finding.evidenceClass !== rule.evidenceClass) return inv();
      if (!finding.factRefs.length) return;
      const referenced = finding.factRefs.map((ref) => facts.get(ref));
      if (referenced.some((fact) => !fact)) return inv();
      const resolved = referenced as SafeFactV2[];
      if (mapping.evidenceSchemaId === 'v1.taint') {
        validateTaintFacts(finding, mapping, resolved);
        return;
      }
      validateMappedFacts(finding, mapping, resolved);
    },
  });
}
