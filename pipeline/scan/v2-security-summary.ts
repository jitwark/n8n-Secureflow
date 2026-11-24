import { LIMITS, type EntrySecurity, type PublicFinding, type Severity } from '@hub/contracts';
import type { ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import { V1_RULE_TEMPLATES } from '@hub/scanner-core/compat/v1-registry';
import { compareCanonicalStrings } from '@hub/contracts/stable-order';

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const PROSE: Record<string, (typeof V1_RULE_TEMPLATES)[number]> = Object.fromEntries(V1_RULE_TEMPLATES.map((template) => [template.ruleId, template]));
const V3_EXTRA_PROSE: Record<string, { title: string; why: string; fix: string }> = {
  EXPRESSION_SANDBOX_ESCAPE: {
    title: 'Expression attempts to escape the n8n sandbox',
    why: 'Dynamic evaluation, constructor-chain access, or Node process/module references inside expressions can break out into host or worker code execution.',
    fix: 'Remove eval(), Function(), constructor-chain calls, require(), and process references from n8n expressions.',
  },
  EXPRESSION_ENV_EXPOSURE: {
    title: 'Expression reads environment variables or secrets directly',
    why: 'Reading $env or $secrets directly in expressions can expose sensitive credentials in logs, HTTP requests, or downstream outputs.',
    fix: 'Use n8n built-in Credentials instead of reading $env or $secrets in expressions.',
  },
  AGENT_EGRESS_UNRESTRICTED: {
    title: 'AI agent can send data to unrestricted external endpoints',
    why: 'An AI agent with an unrestricted HTTP tool can be prompt-injected to exfiltrate workflow data or call internal SSRF targets.',
    fix: 'Restrict the HTTP tool to a fixed approved hostname and require human approval before egress.',
  },
  UNAUTHENTICATED_TRIGGER_TO_SINK: {
    title: 'Unauthenticated external trigger reaches a privileged sink',
    why: 'External callers can invoke high-privilege command, code, SQL, file-write, agent, or dynamic HTTP operations directly without authentication.',
    fix: 'Enable authentication on the external webhook, form, or chat trigger or enforce a human-approval gate before the sink.',
  },
};
const VALID_PROFILES = new Set<EntrySecurity['profile']>(['standard', 'strict', 'beta-default', 'beta-hardened']);

export function v2ResultToEntrySecurity(result: ScannerResultV2): EntrySecurity {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of result.findings) counts[finding.severity.toLowerCase() as keyof typeof counts] += 1;

  const findings: PublicFinding[] = result.findings
    .map((finding): PublicFinding => {
      const template = PROSE[finding.ruleId];
      const v3 = V3_EXTRA_PROSE[finding.ruleId];
      const candidateNode = finding.subject.kind === 'NODE' ? finding.subject.node.name : undefined;
      const node = candidateNode !== undefined && candidateNode.length <= 512 && !/[\u0000-\u001f\u007f]/.test(candidateNode)
        ? candidateNode : undefined;
      return {
        id: finding.ruleId,
        title: template?.title ?? v3?.title ?? finding.ruleId,
        severity: finding.severity,
        ...(node === undefined || node.trim().length === 0 ? {} : { node }),
        why: template?.whyItMatters ?? template?.explanation ?? v3?.why ?? '',
        fix: template?.remediation ?? v3?.fix ?? '',
      };
    })
    .sort((left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || compareCanonicalStrings(left.id, right.id))
    .slice(0, LIMITS.maxPublicFindings);

  const diagnosticCodes = [...new Set(result.analysis.diagnostics.map((diagnostic) => diagnostic.code))].sort(compareCanonicalStrings);
  const indeterminate = result.analysis.status === 'INDETERMINATE';
  const profileId = VALID_PROFILES.has(result.profile.id as EntrySecurity['profile'])
    ? (result.profile.id as EntrySecurity['profile'])
    : 'beta-default';
  return {
    schemaVersion: 'scanner-result-v2',
    grade: indeterminate ? 'UNKNOWN' : result.assessment?.grade ?? 'UNKNOWN',
    score: indeterminate ? 0 : result.assessment?.score ?? 0,
    counts,
    findings,
    hardenedExtra: 0,
    scannerVersion: result.engine.version,
    profile: profileId,
    analysisStatus: result.analysis.status,
    // The entry contract allows diagnostic codes only on a non-COMPLETE result; a COMPLETE scan
    // can still carry no-effect diagnostics, and those do not become a degraded marker.
    ...(result.analysis.status !== 'COMPLETE' && diagnosticCodes.length > 0 ? { analysisDiagnosticCodes: diagnosticCodes } : {}),
  };
}
