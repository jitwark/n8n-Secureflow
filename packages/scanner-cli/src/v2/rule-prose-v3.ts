import { V1_RULE_TEMPLATES } from '@hub/scanner-core/compat/v1-registry';

export type RuleProseV3 = Readonly<{
  ruleId: string;
  title: string;
  whyItMatters: string;
  remediation: string;
  remediationSteps: readonly string[];
}>;

const V3_EXTRA_PROSE: readonly RuleProseV3[] = [
  {
    ruleId: 'EXPRESSION_SANDBOX_ESCAPE',
    title: 'Expression attempts to escape the n8n sandbox',
    whyItMatters:
      'Dynamic evaluation, constructor-chain access, or Node module and process references inside n8n expressions can break out of expression evaluation into arbitrary host or worker code execution.',
    remediation: 'Remove dynamic evaluation, constructor escapes, and process or module access from n8n expressions.',
    remediationSteps: Object.freeze([
      'Remove eval(), Function(), constructor-chain calls, require(), and process references from {{ ... }} expressions.',
      'Use declarative n8n nodes (Edit Fields / Set / Item Lists) or reviewed Code nodes instead.',
    ]),
  },
  {
    ruleId: 'EXPRESSION_ENV_EXPOSURE',
    title: 'Expression accesses environment variables or runtime secrets',
    whyItMatters:
      'Reading $env, $secrets, or process.env directly inside expressions can expose runtime credentials or environment configuration through node outputs, logs, or outbound requests.',
    remediation: 'Use managed n8n credentials instead of reading $env, $secrets, or process.env in expressions.',
    remediationSteps: Object.freeze([
      'Move credentials into n8n managed credential entries rather than referencing $env or $secrets in parameters.',
      'Ensure outbound requests and logs cannot reflect environment values.',
    ]),
  },
  {
    ruleId: 'AGENT_EGRESS_UNRESTRICTED',
    title: 'AI agent has unrestricted external egress capability',
    whyItMatters:
      'Prompt injection or untrusted input can steer an autonomous agent to exfiltrate workflow data or trigger arbitrary outbound requests when tool destinations are unconstrained.',
    remediation: 'Restrict agent HTTP tool URLs to an approved domain allowlist or add a human approval gate on every path.',
    remediationSteps: Object.freeze([
      'Constrain HTTP tool destinations to static URLs within an approved domain allowlist.',
      'Place a Wait (form) or sendAndWait human approval gate on every execution path into the agent.',
      'Remove arbitrary code, SSH, or command execution tools from autonomous agents where not strictly required.',
    ]),
  },
  {
    ruleId: 'UNAUTHENTICATED_TRIGGER_TO_SINK',
    title: 'Unauthenticated external trigger reaches a privileged sink',
    whyItMatters:
      'External callers can invoke high-privilege command, code, SQL, file-write, agent, or dynamic HTTP operations directly without authentication or human review.',
    remediation: 'Require authentication on the external trigger or enforce a human-approval gate on every path before the sink.',
    remediationSteps: Object.freeze([
      'Enable authentication (headerAuth, basicAuth, jwtAuth, or n8nUserAuth) on the external webhook, form, or chat trigger.',
      'Or place a Wait (form) or sendAndWait approval node on every execution path reaching the privileged sink.',
      'Restrict privileged sinks or replace dynamic expressions with validated allowlists.',
    ]),
  },
];

const proseEntries: Array<[string, RuleProseV3]> = [
  ...V1_RULE_TEMPLATES.map((template): [string, RuleProseV3] => [
    template.ruleId,
    Object.freeze({
      ruleId: template.ruleId,
      title: template.title,
      whyItMatters: template.whyItMatters,
      remediation: template.remediation,
      remediationSteps: template.remediationSteps,
    }),
  ]),
  ...V3_EXTRA_PROSE.map((entry): [string, RuleProseV3] => [entry.ruleId, Object.freeze(entry)]),
];

export const RULE_PROSE_V3: Readonly<Record<string, RuleProseV3>> = Object.freeze(Object.fromEntries(proseEntries));

export function getRuleProseV3(ruleId: string): RuleProseV3 {
  return (
    RULE_PROSE_V3[ruleId] ??
    Object.freeze({
      ruleId,
      title: ruleId,
      whyItMatters: 'This rule flagged a potential security or configuration risk in the workflow.',
      remediation: 'Review the flagged node configuration and execution path before deploying to production.',
      remediationSteps: Object.freeze(['Inspect the flagged node parameters and restrict untrusted inputs or privileges.']),
    })
  );
}
