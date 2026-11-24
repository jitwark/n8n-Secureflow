import {
  V1_EVIDENCE_PROJECTIONS,
  V1_RULE_TEMPLATES,
  type V1EvidenceProperty,
} from '@hub/scanner-core/compat/v1-registry';

export type RuleProseV3 = Readonly<{
  title: string;
  message: string;
  explanation: string;
  whyItMatters: string;
  possibleImpact: string;
  remediation: string;
  remediationSteps: readonly string[];
}>;

const CODE_INDICATOR_PROPS: readonly V1EvidenceProperty[] = Object.freeze([
  Object.freeze({ v1Key: 'indicator', factKind: 'code.indicator.v2', factProperty: 'indicator', required: true }),
  Object.freeze({ v1Key: 'member', factKind: 'code.indicator.v2', factProperty: 'member', required: false }),
  Object.freeze({ v1Key: 'start', factKind: 'code.indicator.v2', factProperty: 'start', required: true }),
  Object.freeze({ v1Key: 'end', factKind: 'code.indicator.v2', factProperty: 'end', required: true }),
]);

const EXTRA_EVIDENCE_PROJECTIONS: ReadonlyArray<readonly [string, readonly V1EvidenceProperty[]]> = [
  ['EXPRESSION_SANDBOX_ESCAPE', CODE_INDICATOR_PROPS],
  ['EXPRESSION_ENV_EXPOSURE', CODE_INDICATOR_PROPS],
  [
    'AGENT_EGRESS_UNRESTRICTED',
    Object.freeze([
      Object.freeze({ v1Key: 'capabilities', factKind: 'node.capability.v2', factProperty: 'capabilities', required: false }),
      Object.freeze({ v1Key: 'toolCount', factKind: 'node.capability.v2', factProperty: 'toolCount', required: false }),
      Object.freeze({ v1Key: 'contextCount', factKind: 'node.capability.v2', factProperty: 'contextCount', required: false }),
    ]),
  ],
  [
    'UNAUTHENTICATED_TRIGGER_TO_SINK',
    Object.freeze([
      Object.freeze({ v1Key: 'flowKind', factKind: 'dataflow.summary.v2', factProperty: 'flowKind', required: false }),
      Object.freeze({ v1Key: 'sink', factKind: 'dataflow.summary.v2', factProperty: 'sink', required: false }),
      Object.freeze({ v1Key: 'sourceNodeId', factKind: 'dataflow.summary.v2', factProperty: 'sourceNodeId', required: false }),
      Object.freeze({ v1Key: 'sourceNodeName', factKind: 'dataflow.summary.v2', factProperty: 'sourceNodeName', required: false }),
      Object.freeze({ v1Key: 'taintLabels', factKind: 'dataflow.summary.v2', factProperty: 'taintLabels', required: false }),
      Object.freeze({ v1Key: 'humanGatePresent', factKind: 'dataflow.summary.v2', factProperty: 'humanGatePresent', required: false }),
      Object.freeze({ v1Key: 'humanGateDominates', factKind: 'dataflow.summary.v2', factProperty: 'humanGateDominates', required: false }),
    ]),
  ],
];

export const RULE_EVIDENCE_PROJECTION_V3: ReadonlyMap<string, readonly V1EvidenceProperty[]> = new Map([
  ...V1_EVIDENCE_PROJECTIONS.map((entry): readonly [string, readonly V1EvidenceProperty[]] => [
    entry.ruleId,
    entry.properties,
  ]),
  ...EXTRA_EVIDENCE_PROJECTIONS,
]);

const EXTRA_PROSE: ReadonlyArray<readonly [string, RuleProseV3]> = [
  [
    'EXPRESSION_SANDBOX_ESCAPE',
    Object.freeze({
      title: 'Expression attempts to escape the n8n sandbox',
      message: 'This expression references code evaluation, constructor chains, or Node runtime internals.',
      explanation:
        'The expression analyzer detected dynamic evaluation, prototype or constructor-chain traversal, or module and process access inside an n8n expression parameter.',
      whyItMatters:
        'Dynamic evaluation, constructor-chain access, or Node module and process references inside n8n expressions can break out of expression evaluation into arbitrary host or worker code execution.',
      possibleImpact:
        'A crafted workflow expression or upstream payload may execute arbitrary JavaScript in the n8n worker process outside normal expression sandboxing.',
      remediation: 'Remove dynamic evaluation, constructor escapes, and process or module access from n8n expressions.',
      remediationSteps: Object.freeze([
        'Remove eval(), Function(), constructor-chain calls, require(), and process references from {{ ... }} expressions.',
        'Use declarative n8n nodes (Edit Fields, Set, Item Lists) or reviewed Code nodes instead.',
      ]),
    }),
  ],
  [
    'EXPRESSION_ENV_EXPOSURE',
    Object.freeze({
      title: 'Expression accesses environment variables or runtime secrets',
      message: 'This expression reads $env, $secrets, or process environment variables directly.',
      explanation:
        'The expression analyzer found direct reads of $env, $secrets, or process.env inside an n8n expression parameter rather than managed credential references.',
      whyItMatters:
        'Reading $env, $secrets, or process.env directly inside expressions can expose runtime credentials or environment configuration through node outputs, logs, or outbound requests.',
      possibleImpact:
        'Runtime environment secrets may leak into execution history, HTTP payloads, logs, or downstream integrations.',
      remediation: 'Use managed n8n credentials instead of reading $env, $secrets, or process.env in expressions.',
      remediationSteps: Object.freeze([
        'Move credentials into n8n managed credential entries rather than referencing $env or $secrets in parameters.',
        'Ensure outbound requests and logs cannot reflect environment values.',
      ]),
    }),
  ],
  [
    'AGENT_EGRESS_UNRESTRICTED',
    Object.freeze({
      title: 'AI agent has unrestricted external egress capability',
      message: 'This AI agent holds unconstrained HTTP or execution tools without strict egress bounds.',
      explanation:
        'The agentic-control analyzer determined that an autonomous AI agent is connected to external request or execution tools whose destinations are not restricted or human-gated.',
      whyItMatters:
        'Prompt injection or untrusted input can steer an autonomous agent to exfiltrate workflow data or trigger arbitrary outbound requests when tool destinations are unconstrained.',
      possibleImpact:
        'An attacker influencing model context or tool arguments could exfiltrate data or probe internal services through agent-invoked tools.',
      remediation:
        'Restrict agent HTTP tool URLs to an approved domain allowlist or add a human approval gate on every path.',
      remediationSteps: Object.freeze([
        'Constrain HTTP tool destinations to static URLs within an approved domain allowlist.',
        'Place a Wait (form) or sendAndWait human approval gate on every execution path into the agent.',
        'Remove arbitrary code, SSH, or command execution tools from autonomous agents where not strictly required.',
      ]),
    }),
  ],
  [
    'UNAUTHENTICATED_TRIGGER_TO_SINK',
    Object.freeze({
      title: 'Unauthenticated external trigger reaches a privileged sink',
      message: 'An unauthenticated inbound trigger reaches a privileged sink without a human gate.',
      explanation:
        'Graph reachability analysis found an execution path from an unauthenticated webhook, form, or chat trigger to a command, SQL, file, code, agent, or HTTP sink with no dominating approval gate.',
      whyItMatters:
        'External callers can invoke high-privilege command, code, SQL, file-write, agent, or dynamic HTTP operations directly without authentication or human review.',
      possibleImpact:
        'Unauthenticated external callers may trigger sensitive side effects, execute privileged operations, or manipulate downstream services.',
      remediation:
        'Require authentication on the external trigger or enforce a human-approval gate on every path before the sink.',
      remediationSteps: Object.freeze([
        'Enable authentication (headerAuth, basicAuth, jwtAuth, or n8nUserAuth) on the external webhook, form, or chat trigger.',
        'Or place a Wait (form) or sendAndWait approval node on every execution path reaching the privileged sink.',
        'Restrict privileged sinks or replace dynamic expressions with validated allowlists.',
      ]),
    }),
  ],
];

export const RULE_PROSE_V3: ReadonlyMap<string, RuleProseV3> = new Map([
  ...V1_RULE_TEMPLATES.map((template): readonly [string, RuleProseV3] => [
    template.ruleId,
    Object.freeze({
      title: template.title,
      message: template.message,
      explanation: template.explanation,
      whyItMatters: template.whyItMatters,
      possibleImpact: template.possibleImpact,
      remediation: template.remediation,
      remediationSteps: Object.freeze([...template.remediationSteps]),
    }),
  ]),
  ...EXTRA_PROSE,
]);
