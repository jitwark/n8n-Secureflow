import {
  FIELD_FLOW_PROPERTY_TYPES_V1,
} from '@hub/contracts/scanner-v2-field-flow';
import {
  ADVISORY_APPLICABILITY_V3,
  ADVISORY_EVALUATION_V1,
  ADVISORY_PACKAGE_COVERAGE_V1,
} from '@hub/contracts/scanner-v2-advisory';

export type SafePropertyTypeV2 =
  | 'STRING' | 'INTEGER' | 'BOOLEAN' | 'NULLABLE_STRING' | 'STRING_LIST' | 'INTEGER_LIST';
export type SafeFactSchemaV2 = Readonly<{
  kind: string; ownerCapabilityId: string;
  properties: Readonly<Record<string, SafePropertyTypeV2>>;
  maxStringBytes: number; maxItems: number;
  sensitivity: 'PUBLIC_METADATA' | 'REDACTED_SECURITY';
}>;

const STRING_BYTES = 4_096;
const schema = (
  kind: string, ownerCapabilityId: string,
  properties: Record<string, SafePropertyTypeV2>,
  sensitivity: SafeFactSchemaV2['sensitivity'],
): SafeFactSchemaV2 => Object.freeze({
  kind, ownerCapabilityId, properties: Object.freeze(properties),
  maxStringBytes: STRING_BYTES, maxItems: kind.startsWith('advisory.') ? 1000 : STRING_BYTES, sensitivity,
});

export const SAFE_FACT_SCHEMAS_V2: readonly SafeFactSchemaV2[] = Object.freeze([
  schema('workflow.summary.v1', 'workflow-insights', { connectionCount: 'INTEGER' }, 'PUBLIC_METADATA'),
  schema('workflow.dependencies.v1', 'structural-policies', {
    totalNodes: 'INTEGER', reviewedNodes: 'INTEGER', assumedNodes: 'INTEGER', unknownNodes: 'INTEGER',
    credentialReferences: 'INTEGER', requiredCredentialSlots: 'INTEGER', configuredCredentialSlots: 'INTEGER',
    missingCredentialSlots: 'INTEGER', unknownCredentialSlots: 'INTEGER', environmentReferences: 'INTEGER',
    redactedIdentifiers: 'INTEGER', omittedIdentifiers: 'INTEGER',
  }, 'REDACTED_SECURITY'),
  schema('workflow.effects.v1', 'structural-policies', {
    totalNodes: 'INTEGER', reviewedNodes: 'INTEGER', assumedNodes: 'INTEGER', unknownNodes: 'INTEGER',
    effectCounts: 'INTEGER_LIST', disabledEffectNodes: 'INTEGER',
  }, 'REDACTED_SECURITY'),
  schema('workflow.structure.v1', 'structural-policies', {
    total: 'INTEGER', executable: 'INTEGER', disabled: 'INTEGER', inert: 'INTEGER', unresolved: 'INTEGER',
    vertices: 'INTEGER', edges: 'INTEGER', unresolvedEdges: 'INTEGER', parallelEdgeCount: 'INTEGER',
    weakComponents: 'INTEGER', structuralCycleRank: 'INTEGER',
  }, 'PUBLIC_METADATA'),
  schema('workflow.function.v1', 'workflow-insights', {
    basicPurpose: 'STRING', triggerDescription: 'STRING', dataFlowSummary: 'STRING',
    businessCategory: 'STRING', confidence: 'STRING',
  }, 'PUBLIC_METADATA'),
  schema('workflow.risk-summary.v1', 'workflow-insights', {
    topRisks: 'STRING_LIST', dataExposure: 'STRING', complexityDrivers: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
  schema('workflow.fingerprint.v1', 'source-normalization', { value: 'STRING' }, 'PUBLIC_METADATA'),
  schema('integration.v1', 'workflow-insights', {
    service: 'STRING', usage: 'STRING', nodeTypes: 'STRING_LIST', nodeCount: 'INTEGER', riskNotes: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
  schema('node.capability.v2', 'structural-policies', {
    nodeType: 'STRING', nodePackage: 'STRING', namespaceClass: 'STRING', capabilities: 'STRING_LIST',
    toolCount: 'INTEGER', contextCount: 'INTEGER',
  }, 'REDACTED_SECURITY'),
  schema('node.configuration.v2', 'structural-policies', {
    observation: 'STRING', header: 'NULLABLE_STRING', literalValue: 'BOOLEAN', parameterPath: 'STRING',
    secretKind: 'STRING', indicator: 'STRING', hasLiteralValue: 'BOOLEAN',
  }, 'REDACTED_SECURITY'),
  schema('code.indicator.v2', 'expression-security', {
    language: 'STRING', indicator: 'STRING', member: 'STRING', start: 'INTEGER', end: 'INTEGER', parseState: 'STRING',
  }, 'REDACTED_SECURITY'),
  schema('dataflow.summary.v2', 'graph-semantics', {
    flowKind: 'STRING', sink: 'STRING', parameterPath: 'STRING', referenceRoot: 'STRING', propertyPath: 'STRING',
    sourceNodeId: 'STRING', sourceNodeName: 'STRING', propertyPathComplete: 'BOOLEAN',
    humanGatePresent: 'BOOLEAN', humanGateDominates: 'BOOLEAN', taintLabels: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
  ...Object.entries(FIELD_FLOW_PROPERTY_TYPES_V1).map(([kind, properties]) => schema(kind, 'graph-semantics', properties, 'REDACTED_SECURITY')),
  schema('destination.v2', 'structural-policies', {
    parameterPath: 'STRING', scheme: 'STRING', hostname: 'NULLABLE_STRING', authorityState: 'STRING', valueMode: 'STRING',
  }, 'REDACTED_SECURITY'),
  schema('destination.v3', 'structural-policies', {
    parameterPath: 'STRING', scheme: 'STRING', hostname: 'NULLABLE_STRING', authorityState: 'STRING', valueMode: 'STRING',
    reason: 'STRING', omitted: 'INTEGER', inventoryStatus: 'STRING',
  }, 'REDACTED_SECURITY'),
  schema('destination.coverage.v1', 'structural-policies', {
    inventoryStatus: 'STRING', nodesExamined: 'INTEGER', pathsConfigured: 'INTEGER', recordsEmitted: 'INTEGER',
    errors: 'INTEGER', omitted: 'INTEGER', errorCodes: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
  schema('ingress.v2', 'structural-policies', {
    authentication: 'NULLABLE_STRING', authenticationState: 'STRING', legacyAuthenticated: 'BOOLEAN',
  }, 'REDACTED_SECURITY'),
  schema(ADVISORY_EVALUATION_V1, 'assessment', {
    evaluationState: 'STRING', evaluationReason: 'STRING', targetDigest: 'STRING',
    sourceId: 'NULLABLE_STRING', pinDigest: 'NULLABLE_STRING', coverageDigest: 'NULLABLE_STRING',
    rightsReceiptDigest: 'NULLABLE_STRING', provenanceReceiptDigest: 'NULLABLE_STRING',
    boundsDigest: 'NULLABLE_STRING', admissionReceiptDigest: 'NULLABLE_STRING',
    pinnedSnapshotSha256: 'NULLABLE_STRING', snapshotSha256: 'NULLABLE_STRING',
    capturedAt: 'NULLABLE_STRING', admittedAt: 'NULLABLE_STRING', evaluatedAt: 'NULLABLE_STRING',
    catalogueVersion: 'NULLABLE_STRING', catalogueDigest: 'NULLABLE_STRING', coverageClaimed: 'BOOLEAN',
    packagesRequested: 'INTEGER', packagesCovered: 'INTEGER', packageRowsOmitted: 'INTEGER',
    recordsExamined: 'INTEGER', recordsApplicable: 'INTEGER', recordsNotApplicable: 'INTEGER',
    recordsUnknown: 'INTEGER', omissionReasons: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
  schema(ADVISORY_PACKAGE_COVERAGE_V1, 'assessment', {
    packageName: 'STRING', packageVersion: 'NULLABLE_STRING', coverageState: 'STRING', coverageReason: 'STRING',
  }, 'REDACTED_SECURITY'),
  schema(ADVISORY_APPLICABILITY_V3, 'assessment', {
    advisoryId: 'STRING', packageName: 'STRING', installedVersion: 'NULLABLE_STRING', reviewState: 'STRING',
    applicability: 'STRING', rowReason: 'STRING', matchedPrerequisites: 'STRING_LIST', unknownPrerequisites: 'STRING_LIST',
  }, 'REDACTED_SECURITY'),
]);
