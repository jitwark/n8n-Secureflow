import type { NormalizedWorkflow, NormalizedWorkflowNode } from '../../workflow';
import { computeExecutionDominators, dominates } from '../../graph-dominators';
import type { ScanFinding } from '../../policy/policy';
import { nodeFinding } from '../../policy/policy-helpers';
import { collectUrlOutcome } from '../../policy/url-outcome';
import { buildAiCapabilityGraph } from './ai-capability-graph';
import { isCataloguedHumanGate } from './human-gate-catalog';

export type AiAgentEgressOptions = {
  approvedDomains?: readonly string[];
};

const MAX_PARAMETER_DEPTH = 64;
const URL_EGRESS_TOOL_TYPES = new Set([
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.httpRequestTool',
  '@n8n/n8n-nodes-langchain.toolHttpRequest',
  'n8n-nodes-base.webhook',
  '@n8n/n8n-nodes-langchain.toolMcp',
]);
const ARBITRARY_EGRESS_TOOL_TYPES = new Set([
  '@n8n/n8n-nodes-langchain.toolCode',
  'n8n-nodes-base.executeCommand',
  'n8n-nodes-base.ssh',
]);
const DESTINATION_KEY = /^(?:url|uri|endpoint|serverurl|baseurl|webhookurl|sseendpoint|proxy)$/i;
const DESTINATION_SUFFIX = /(?:Url|URI|Endpoint|URL)$/;
const IGNORED_TEXT_KEY = /^(?:toolDescription|description|displayName)$/i;

type ToolEgressAssessment = {
  egress: boolean;
  unrestricted: boolean;
  dynamicUrl: boolean;
};

export function evaluateAiAgentEgress(
  workflow: NormalizedWorkflow,
  options: AiAgentEgressOptions | undefined,
  maxFindings: number,
): ScanFinding[] {
  const agents = buildAiCapabilityGraph(workflow).agents.filter((entry) => entry.toolNodeIndexes.length > 0);
  if (agents.length === 0) return [];
  const approved = normalizeApprovedDomains(options?.approvedDomains);
  const gateIndexes = workflow.nodes.map((node, index) => (isCataloguedHumanGate(node) ? index : -1)).filter((index) => index >= 0);
  const dominators = gateIndexes.length === 0 ? undefined : computeExecutionDominators(workflow);
  const findings: ScanFinding[] = [];
  for (const entry of agents) {
    if (findings.length >= maxFindings) break;
    const agentNode = workflow.nodes[entry.nodeIndex];
    if (!agentNode) continue;
    const unrestrictedTypes: string[] = [];
    let dynamicUrl = false;
    for (const toolIndex of entry.toolNodeIndexes) {
      const toolNode = workflow.nodes[toolIndex];
      if (!toolNode) continue;
      const assessment = assessToolEgress(toolNode, approved);
      if (!assessment.egress || !assessment.unrestricted) continue;
      unrestrictedTypes.push(toolNode.type);
      dynamicUrl = dynamicUrl || assessment.dynamicUrl;
    }
    if (unrestrictedTypes.length === 0) continue;
    if (dominators && gateIndexes.some((gate) => dominates(dominators, gate, entry.nodeIndex))) continue;
    findings.push(egressFinding(agentNode, {
      toolCount: entry.toolNodeIndexes.length,
      egressToolTypes: [...new Set(unrestrictedTypes)].sort(),
      dynamicUrl,
      humanGatePresent: gateIndexes.length > 0,
      humanGateDominates: false,
    }));
  }
  return findings;
}

function assessToolEgress(node: NormalizedWorkflowNode, approved: ReadonlySet<string> | null): ToolEgressAssessment {
  if (ARBITRARY_EGRESS_TOOL_TYPES.has(node.type)) {
    return { egress: true, unrestricted: true, dynamicUrl: false };
  }
  if (!URL_EGRESS_TOOL_TYPES.has(node.type)) {
    return { egress: false, unrestricted: false, dynamicUrl: false };
  }
  const scan = scanDestinationParameters(node.parameters);
  if (scan.dynamicUrl || scan.unparseableDestination || approved === null || scan.urls.length === 0) {
    return { egress: true, unrestricted: true, dynamicUrl: scan.dynamicUrl };
  }
  const allApproved = scan.urls.every((url) => approved.has(url.hostname.toLowerCase().replace(/\.$/, '')));
  return { egress: true, unrestricted: !allApproved, dynamicUrl: false };
}

function scanDestinationParameters(parameters: Record<string, unknown>): {
  urls: URL[];
  dynamicUrl: boolean;
  unparseableDestination: boolean;
} {
  const urls: URL[] = [];
  let dynamicUrl = false;
  let unparseableDestination = false;
  const seen = new WeakSet<object>();
  const walk = (value: unknown, key: string | undefined, depth: number): void => {
    if (depth > MAX_PARAMETER_DEPTH) return;
    if (typeof value === 'string') {
      if (key && isDestinationKey(key)) {
        const outcome = collectUrlOutcome(value);
        if (outcome.state === 'UNKNOWN') { dynamicUrl = true; return; }
        if (outcome.state === 'FOUND') { urls.push(...outcome.urls); return; }
        if (value.trim().length > 0) {
          unparseableDestination = true;
          if (value.startsWith('=') || value.includes('{{') || /\$fromAI\b/i.test(value)) dynamicUrl = true;
        }
        return;
      }
      if (!key || !IGNORED_TEXT_KEY.test(key)) {
        const outcome = collectUrlOutcome(value);
        if (outcome.urls.length > 0) urls.push(...outcome.urls);
      }
      return;
    }
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) walk(child, key, depth + 1);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey, depth + 1);
  };
  walk(parameters, undefined, 0);
  return { urls, dynamicUrl, unparseableDestination };
}

function isDestinationKey(key: string): boolean {
  return DESTINATION_KEY.test(key) || DESTINATION_SUFFIX.test(key);
}

function normalizeApprovedDomains(domains: readonly string[] | undefined): ReadonlySet<string> | null {
  if (!domains || domains.length === 0) return null;
  const normalized = new Set<string>();
  for (const domain of domains) {
    const host = canonicalDomain(domain);
    if (host) normalized.add(host);
  }
  return normalized;
}

function canonicalDomain(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value || /[/:?#@\s]/.test(trimmed)) return undefined;
  try {
    const parsed = new URL(`http://${trimmed}`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined;
    return parsed.hostname.toLowerCase().replace(/\.$/, '') || undefined;
  } catch {
    return undefined;
  }
}

function egressFinding(node: NormalizedWorkflowNode, evidence: Record<string, unknown>): ScanFinding {
  return nodeFinding({
    policyId: 'AGENT_EGRESS_UNRESTRICTED',
    title: 'AI agent has unrestricted external egress capability',
    severity: 'HIGH',
    node,
    evidence,
    message: 'This AI agent can invoke external egress tools without static domain restrictions or a dominating human approval gate.',
    explanation: 'The agent is attached to external HTTP, webhook, code, or command tools whose destinations are dynamic or outside an approved domain allowlist, and no catalogued human approval node stands on every execution path into the agent (OWASP LLM06 Excessive Agency).',
    whyItMatters: 'Prompt injection or untrusted data can steer an autonomous agent to exfiltrate workflow data or trigger arbitrary outbound requests when tool egress is unconstrained.',
    possibleImpact: 'Sensitive workflow data could be sent to attacker-controlled endpoints, or unauthorized external actions could execute without human review.',
    remediation: 'Restrict agent HTTP tool URLs to an approved domain allowlist or place a catalogued human approval gate on every path into the agent.',
    remediationSteps: [
      'Constrain HTTP tool destinations to static URLs within an approved domain allowlist.',
      'Place a catalogued Wait (form) or sendAndWait approval node on every execution path into the agent.',
      'Remove arbitrary code, SSH, or command execution tools from autonomous agents where not strictly required.',
    ],
    confidence: 'MEDIUM',
  });
}
