import type { ScannerLimitsV2 } from '@hub/contracts';
import { canonicalizeJson } from '../canonical-json';
import { SAFE_FACT_REGISTRY_V2 } from '../facts/safe-fact-registry';
import { readArrayItem, readArrayLength, readDenseArray } from '../facts/safe-fact-validator';
import type { CapabilityCandidateV2 } from './scheduler';

export type SafeFactScalarV2 = string | number | boolean | null;
export type SafeFactValueV2 = SafeFactScalarV2 | readonly SafeFactScalarV2[];
export type EvidenceBudgetV2 = { bytes: number; counts: [number, number, number, number]; maximum: number };
export type EvidenceCollectionV2 = Readonly<Pick<CapabilityCandidateV2, 'findings' | 'diagnostics' | 'facts' | 'traces'>>;

export class CandidateLimitExceededV2 extends TypeError {
  readonly observed: number;
  readonly maximum: number;
  constructor(observed: number, maximum: number) {
    super('Limit exceeded');
    this.observed = observed;
    this.maximum = maximum;
  }
}

export function limitExceeded(observed: number, maximum: number): never {
  throw new CandidateLimitExceededV2(observed > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : observed, maximum);
}

function fail(reason: 'UNSAFE_INPUT'): never { throw reason; }

function observedArrayLength(input: unknown): number | undefined {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'length');
  return descriptor !== undefined && 'value' in descriptor && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0 ? descriptor.value : undefined;
}

export function readBoundedLength(input: unknown, maximum: number, dense = true): number {
  const observed = observedArrayLength(input);
  if (observed !== undefined && observed > maximum) limitExceeded(observed, maximum);
  return readArrayLength(input, maximum, dense);
}

export function readBoundedArray(input: unknown, maximum: number): unknown[] {
  const observed = observedArrayLength(input);
  if (observed !== undefined && observed > maximum) limitExceeded(observed, maximum);
  return readDenseArray(input, maximum);
}

export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;
export const isSafeFactScalar = (value: unknown): value is SafeFactScalarV2 => value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
const scalarJson = (value: SafeFactScalarV2): string => canonicalizeJson(value);
const safeValueJson = (value: SafeFactValueV2): string => {
  if (isSafeFactScalar(value)) return scalarJson(value);
  const arrayValue: readonly SafeFactScalarV2[] = value;
  return `[${arrayValue.map((item) => scalarJson(item)).join(',')}]`;
};

export function canonicalBytes(value: SafeFactValueV2 | Readonly<Record<string, unknown>>): number {
  if (isSafeFactScalar(value)) return utf8Bytes(scalarJson(value));
  if (Array.isArray(value)) return utf8Bytes(safeValueJson(value as readonly SafeFactScalarV2[]));
  return utf8Bytes(canonicalizeJson(value));
}

const limitNumber = (input: object, key: string, minimum = 0): number => {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'number' || !Number.isSafeInteger(descriptor.value) || descriptor.value < minimum) fail('UNSAFE_INPUT');
  return descriptor.value;
};

export function snapshotLimits(input: unknown): ScannerLimitsV2 {
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) fail('UNSAFE_INPUT');
  const schema = Object.getOwnPropertyDescriptor(input, 'schemaVersion');
  if (!schema || !('value' in schema) || schema.value !== 'scanner-limits-v2') fail('UNSAFE_INPUT');
  const maxBytes = limitNumber(input, 'maxBytes'), maxNodes = limitNumber(input, 'maxNodes'), maxEdges = limitNumber(input, 'maxEdges');
  const maxConnectionDepth = limitNumber(input, 'maxConnectionDepth'), maxParameterDepth = limitNumber(input, 'maxParameterDepth'), maxParameterLeaves = limitNumber(input, 'maxParameterLeaves');
  const workerDeadlineMs = limitNumber(input, 'workerDeadlineMs'), maxSyntaxNodes = limitNumber(input, 'maxSyntaxNodes'), maxDocumentDepth = limitNumber(input, 'maxDocumentDepth');
  const maxMembersAndElements = limitNumber(input, 'maxMembersAndElements'), maxRawEdges = limitNumber(input, 'maxRawEdges'), maxDuplicateKeys = limitNumber(input, 'maxDuplicateKeys');
  const maxDiagnostics = limitNumber(input, 'maxDiagnostics', 1), maxStoredSourceSpans = limitNumber(input, 'maxStoredSourceSpans'), maxSourceWork = limitNumber(input, 'maxSourceWork');
  const maxExpressionTokens = limitNumber(input, 'maxExpressionTokens'), maxCodeSyntaxNodes = limitNumber(input, 'maxCodeSyntaxNodes'), maxGraphOperations = limitNumber(input, 'maxGraphOperations');
  const maxTaintStates = limitNumber(input, 'maxTaintStates'), maxTraceStepsPerFinding = limitNumber(input, 'maxTraceStepsPerFinding'), maxFindings = limitNumber(input, 'maxFindings');
  const maxRedactionPatches = limitNumber(input, 'maxRedactionPatches'), maxRedactedArtifactBytes = limitNumber(input, 'maxRedactedArtifactBytes'), maxEvidenceBytes = limitNumber(input, 'maxEvidenceBytes');
  const maxSerializedResultBytes = limitNumber(input, 'maxSerializedResultBytes'), maxRuleOperations = limitNumber(input, 'maxRuleOperations');
  return Object.freeze({ schemaVersion: 'scanner-limits-v2', maxBytes, maxNodes, maxEdges, maxConnectionDepth, maxParameterDepth, maxParameterLeaves, workerDeadlineMs, maxSyntaxNodes, maxDocumentDepth, maxMembersAndElements, maxRawEdges, maxDuplicateKeys, maxDiagnostics, maxStoredSourceSpans, maxSourceWork, maxExpressionTokens, maxCodeSyntaxNodes, maxGraphOperations, maxTaintStates, maxTraceStepsPerFinding, maxFindings, maxRedactionPatches, maxRedactedArtifactBytes, maxEvidenceBytes, maxSerializedResultBytes, maxRuleOperations });
}

export function evidenceBudget(maximum: number): EvidenceBudgetV2 {
  const bytes = utf8Length(canonicalizeJson({ findings: [], diagnostics: [], facts: [], traces: [] }));
  if (bytes > maximum) limitExceeded(bytes, maximum);
  return { bytes, counts: [0, 0, 0, 0], maximum };
}

export function chargeEvidence(budget: EvidenceBudgetV2, section: 0 | 1 | 2 | 3, value: Readonly<Record<string, unknown>>): void {
  budget.bytes += canonicalBytes(value) + (budget.counts[section] === 0 ? 0 : 1);
  budget.counts[section] += 1;
  if (budget.bytes > budget.maximum) limitExceeded(budget.bytes, budget.maximum);
}

export function sharedEvidence(value: EvidenceCollectionV2): number {
  return canonicalBytes({ findings: value.findings, diagnostics: value.diagnostics, facts: value.facts, traces: value.traces });
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

function jsonStringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
    else if (code <= 0x1f) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index += 1; }
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
  }
  return bytes;
}

function scalarLowerBound(value: unknown): number {
  if (typeof value === 'string') return jsonStringBytes(value);
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value).length : 1;
  return 0;
}

const structureFields: Readonly<Record<string, readonly string[]>> = {
  subject: ['kind', 'node', 'edge', 'source'], node: ['ordinal', 'source', 'explicitId', 'name', 'identityDigest'],
  edge: ['ordinal', 'sourceNode', 'sourceLabel', 'targetNode', 'targetLabel', 'connectionType', 'sourcePort', 'targetPort', 'source', 'resolution'],
  source: ['pointer', 'occurrencePath', 'astNodeId', 'span'], location: ['pointer', 'occurrencePath', 'astNodeId', 'span'],
  span: ['start', 'end'], start: ['line', 'column', 'utf16Offset', 'utf8ByteOffset'], end: ['line', 'column', 'utf16Offset', 'utf8ByteOffset'],
  finding: ['ruleId', 'evidenceClass', 'conclusion', 'applicability', 'subject', 'factRefs', 'traceRefs', 'remediationId'],
  trace: ['traceId', 'kind', 'steps'], step: ['ordinal', 'kind', 'subject', 'factRefs'],
  diagnostic: ['id', 'code', 'category', 'capabilityId', 'aggregateEffect', 'assessmentEligible', 'location', 'observed', 'maximum', 'omitted'],
};
const fieldShape = (key: string): readonly string[] => structureFields[key] ?? [];
const fit = (value: number, maximum: number): number => value > maximum ? limitExceeded(value, maximum) : value;
const PREFLIGHT_MAX_DEPTH = 512;
const PREFLIGHT_MAX_WORK = 1_000_000;
type PreflightFrame = { value: object; fields: readonly string[]; itemFields: readonly string[]; propertyFields: readonly string[]; index: number; length: number; present: number; array: boolean; depth: number };

function boundedValue(value: unknown, maximum: number, fields: readonly string[] = [], itemFields: readonly string[] = [], propertyFields: readonly string[] = [], cap = Number.MAX_SAFE_INTEGER): number {
  let total = 0; let work = 0; const active = new Set<object>(); const stack: Array<PreflightFrame | { leave: object }> = [];
  const add = (amount: number): void => { if (!Number.isSafeInteger(amount) || amount < 0) fail('LIMIT_EXCEEDED' as never); if (total > cap - amount) limitExceeded(total + amount, cap); total += amount; };
  const push = (next: unknown, nextFields: readonly string[], nextItems: readonly string[], nextProperties: readonly string[], depth: number): void => {
    const workCap = Math.min(PREFLIGHT_MAX_WORK, Math.max(1_024, maximum * 64));
    if (++work > workCap) limitExceeded(work, workCap); if (depth > PREFLIGHT_MAX_DEPTH) fail('UNSAFE_INPUT');
    if (isSafeFactScalar(next)) { add(scalarLowerBound(next)); return; }
    if (next === null || typeof next !== 'object') return; if (active.has(next)) fail('UNSAFE_INPUT'); active.add(next); add(2);
    if (Array.isArray(next)) { const length = readBoundedLength(next, maximum, false); stack.push({ leave: next }); stack.push({ value: next, fields: [], itemFields: nextItems, propertyFields: [], index: 0, length, present: 0, array: true, depth }); }
    else { stack.push({ leave: next }); stack.push({ value: next, fields: nextFields, itemFields: [], propertyFields: nextProperties, index: 0, length: nextFields.length, present: 0, array: false, depth }); }
  };
  push(value, fields, itemFields, propertyFields, 0);
  while (stack.length) {
    const frame = stack[stack.length - 1]; if ('leave' in frame) { stack.pop(); active.delete(frame.leave); continue; }
    if (frame.index >= frame.length) { stack.pop(); continue; }
    const index = frame.index++; if (frame.array) { add(index ? 1 : 0); push(readArrayItem(frame.value, index), frame.itemFields, [], [], frame.depth + 1); continue; }
    const key = frame.fields[index]; const descriptor = Object.getOwnPropertyDescriptor(frame.value, key); if (descriptor === undefined) continue; if (!('value' in descriptor)) fail('UNSAFE_INPUT'); add((frame.present ? 1 : 0) + jsonStringBytes(key) + 1); frame.present += 1; push(descriptor.value, key === 'properties' ? frame.propertyFields : fieldShape(key), key === 'steps' ? fieldShape('step') : [], [], frame.depth + 1);
  }
  return total;
}

function boundedItem(value: unknown, section: string, maximum: number, cap = Number.MAX_SAFE_INTEGER): number {
  if (section === 'facts') {
    const kind = Object.getOwnPropertyDescriptor(value as object, 'kind');
    const schema = kind && 'value' in kind && typeof kind.value === 'string' ? SAFE_FACT_REGISTRY_V2.schemas.find((item) => item.kind === kind.value) : undefined;
    return boundedValue(value, maximum, ['factId', 'kind', 'subject', 'properties'], [], schema ? Object.keys(schema.properties) : [], cap);
  }
  return boundedValue(value, maximum, fieldShape(section === 'findings' ? 'finding' : section === 'traces' ? 'trace' : 'diagnostic'), [], [], cap);
}

function preflightSection(input: unknown, section: string, maximum: number, cap: number): number {
  const length = readBoundedLength(input, maximum, false); let total = 0;
  for (let index = 0; index < length; index += 1) { const separator = index ? 1 : 0; total = fit(total + separator, cap); total += boundedItem(readArrayItem(input, index), section, maximum, cap - total); total = fit(total, cap); }
  return total;
}

export function preflightCandidate(input: unknown, limits: ScannerLimitsV2, budget: EvidenceBudgetV2): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('UNSAFE_INPUT');
  let minimum = 0;
  for (const section of ['findings', 'diagnostics', 'facts', 'traces']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, section);
    if (descriptor === undefined || !('value' in descriptor)) fail('UNSAFE_INPUT');
    const maximum = section === 'findings' ? limits.maxFindings : section === 'diagnostics' ? limits.maxDiagnostics : limits.maxMembersAndElements;
    minimum += preflightSection(descriptor.value, section, maximum, budget.maximum - budget.bytes - minimum);
    if (budget.bytes + minimum > budget.maximum) limitExceeded(budget.bytes + minimum, budget.maximum);
  }
}
