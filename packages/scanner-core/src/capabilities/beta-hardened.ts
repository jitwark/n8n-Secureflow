import type { TaintAccessorV1 } from '../analyzers/taint/scan-local-taint';
import type { FieldFlowAccessorV1 } from '../analyzers/taint/scan-local-workflow-flow-witnesses';
import { createBetaDefaultCapabilityRegistry, type BetaDefaultAdapterOptions } from './beta-default';
import { emptyCandidate } from './adapter-evidence';
import {
  agenticCandidate, codeCandidate, expressionCandidate, graphSemanticsCandidate,
  taintFacts, taintIntegrityCandidate,
} from './hardened-analyzers';
import { scheduleCapabilities, type AnalyzerContextV2, type CapabilityRegistryV2, type CapabilityScheduleV2, type CapabilitySpecV2 } from './scheduler';
import { BETA_HARDENED_PROFILE_MANIFEST, type ProfileCapabilityV2, type ProfileManifestV2 } from './profile-manifest';

export type BetaHardenedAdapterOptions = Readonly<BetaDefaultAdapterOptions & {
  onRun?: () => void;
  getTaint?: TaintAccessorV1;
  getFieldFlow?: FieldFlowAccessorV1;
  manifest?: ProfileManifestV2;
  approvedDomains?: readonly string[];
  mergeLegacyTaint?: boolean;
}>;

export function createBetaHardenedCapabilityRegistry(options: BetaHardenedAdapterOptions = {}): CapabilityRegistryV2 {
  const manifest = options.manifest ?? BETA_HARDENED_PROFILE_MANIFEST;
  const base = createBetaDefaultCapabilityRegistry(options.policies ? { policies: options.policies } : {});
  const specs = manifest.capabilities.map((capability): readonly [string, CapabilitySpecV2] => {
    const existing = base.get(capability.id);
    if (existing) return [capability.id, { ...capability, run: existing.run }];
    return [capability.id, hardenedSpec(capability, options)];
  });
  return new Map([...base, ...specs]);
}

export function scanHardenedCapabilitiesV2(context: AnalyzerContextV2, profile: ProfileManifestV2 = BETA_HARDENED_PROFILE_MANIFEST, registry: CapabilityRegistryV2 = createBetaHardenedCapabilityRegistry()): CapabilityScheduleV2 {
  return scheduleCapabilities(context, profile, registry);
}

export const BETA_HARDENED_CAPABILITY_REGISTRY = createBetaHardenedCapabilityRegistry();

function hardenedSpec(capability: ProfileCapabilityV2, options: BetaHardenedAdapterOptions): CapabilitySpecV2 {
  const run = capability.id === 'expression-security'
    ? (context: AnalyzerContextV2) => expressionCandidate(context)
    : capability.id === 'javascript-security'
      ? (context: AnalyzerContextV2) => codeCandidate(context, capability, 'javascript')
      : capability.id === 'python-security'
        ? (context: AnalyzerContextV2) => codeCandidate(context, capability, 'python')
        : capability.id === 'graph-semantics'
          ? (context: AnalyzerContextV2) => graphSemanticsCandidate(context, capability, options)
          : capability.id === 'taint-confidentiality'
            ? (context: AnalyzerContextV2) => taintFacts(context, capability, options)
            : capability.id === 'taint-integrity'
              ? (context: AnalyzerContextV2) => taintIntegrityCandidate(context, capability, options)
              : capability.id === 'agentic-control'
                ? (context: AnalyzerContextV2) => agenticCandidate(context, capability, options)
                : () => { options.onRun?.(); return emptyCandidate(1); };
  return { ...capability, run };
}
