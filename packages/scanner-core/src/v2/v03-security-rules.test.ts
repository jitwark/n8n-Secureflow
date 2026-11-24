import { describe, expect, it } from 'vitest';
import { scanWorkflowV2 } from './index';

const encode = (workflow: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify(workflow));
const STANDARD = { id: 'standard', version: '3.0.0' } as const;
const STRICT = { id: 'strict', version: '3.0.0' } as const;
const BETA_DEFAULT = { id: 'beta-default', version: '2.0.0' } as const;
const BETA_HARDENED = { id: 'beta-hardened', version: '2.0.0' } as const;

describe('v0.3 security rules and multi-profile closure', () => {
  it('flags CRITICAL expression sandbox escape with score >= 80 and ignores safe $json expressions', () => {
    const vulnerable = encode({
      nodes: [
        {
          id: 'set-escape',
          name: 'Escape',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          parameters: {
            value: "={{ (function(){ return this.process.mainModule.require('child_process').execSync('id') })() }}",
          },
        },
      ],
      connections: {},
    });
    const res = scanWorkflowV2({ bytes: vulnerable, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    const finding = res.result.findings.find((item) => item.ruleId === 'EXPRESSION_SANDBOX_ESCAPE');
    expect(finding).toMatchObject({
      ruleId: 'EXPRESSION_SANDBOX_ESCAPE',
      severity: 'CRITICAL',
      effect: 'SCORING',
      evidenceClass: 'SUSPICIOUS_SYNTAX',
      conclusion: 'OBSERVED',
    });
    expect(res.result.assessment?.score).toBeGreaterThanOrEqual(80);
    expect(['CRITICAL', 'HIGH']).toContain(res.result.assessment?.grade);

    const safe = encode({
      nodes: [{ id: 'safe', name: 'Safe', type: 'n8n-nodes-base.set', typeVersion: 3, parameters: { value: '={{ $json.name }}' } }],
      connections: {},
    });
    const safeRes = scanWorkflowV2({ bytes: safe, profile: STANDARD });
    expect(safeRes.ok).toBe(true);
    if (!safeRes.ok) throw new Error(safeRes.code);
    expect(safeRes.result.findings.some((item) => item.ruleId === 'EXPRESSION_SANDBOX_ESCAPE' || item.ruleId === 'EXPRESSION_ENV_EXPOSURE')).toBe(false);
    expect(safeRes.result.analysis.status).toBe('COMPLETE');
  });

  it('flags HIGH expression env/secret exposure without leaking raw secret names and supports malformed recovery', () => {
    const wf = encode({
      nodes: [
        {
          id: 'expr-env',
          name: 'Env',
          type: 'n8n-nodes-base.set',
          typeVersion: 3,
          parameters: {
            keyA: '={{ $env.AWS_SECRET_ACCESS_KEY }}',
            keyB: '={{ $secrets.stripe_live_secret_token }}',
            broken: '={{ eval($json.payload + }}',
          },
        },
      ],
      connections: {},
    });
    const res = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    expect(res.result.findings.filter((item) => item.ruleId === 'EXPRESSION_ENV_EXPOSURE')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'EXPRESSION_ENV_EXPOSURE', severity: 'HIGH', effect: 'SCORING' }),
      ]),
    );
    expect(res.result.findings.some((item) => item.ruleId === 'EXPRESSION_SANDBOX_ESCAPE' && item.conclusion === 'POTENTIAL' && item.effect === 'SCORING')).toBe(true);
    expect(JSON.stringify(res.result)).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(JSON.stringify(res.result)).not.toContain('stripe_live_secret_token');
  });

  it('promotes JavaScript and Python AST/CST findings (including Python os.getenv & os.environ) to SCORING in standard', () => {
    const wf = encode({
      nodes: [
        { id: 'js', name: 'JS', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return eval(input)' } },
        { id: 'py', name: 'PY', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { language: 'python', pythonCode: "from os import getenv\nimport os\na = getenv('SECRET')\nb = os.environ['TOKEN']" } },
      ],
      connections: {},
    });
    const res = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    expect(res.result.findings.some((item) => item.ruleId === 'JAVASCRIPT_DYNAMIC_EXECUTION' && item.effect === 'SCORING')).toBe(true);
    expect(res.result.findings.filter((item) => item.ruleId === 'PYTHON_DYNAMIC_EXECUTION' && item.effect === 'SCORING').length).toBeGreaterThanOrEqual(2);
  });

  it('detects multi-hop Webhook -> NoOp -> ExecuteCommand as both TAINTED_COMMAND and UNAUTHENTICATED_TRIGGER_TO_SINK with TraceV2', () => {
    const wf = encode({
      nodes: [
        { id: 'w1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, parameters: { path: 'run', httpMethod: 'POST' } },
        { id: 'n1', name: 'NoOp', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
        { id: 'e1', name: 'Exec', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, parameters: { command: '={{ $json.body.cmd }}' } },
      ],
      connections: {
        Webhook: { main: [[{ node: 'NoOp', type: 'main', index: 0 }]] },
        NoOp: { main: [[{ node: 'Exec', type: 'main', index: 0 }]] },
      },
    });
    const res = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    const tainted = res.result.findings.find((item) => item.ruleId === 'TAINTED_COMMAND');
    const triggerSink = res.result.findings.find((item) => item.ruleId === 'UNAUTHENTICATED_TRIGGER_TO_SINK');
    expect(tainted).toMatchObject({ ruleId: 'TAINTED_COMMAND', severity: 'CRITICAL', effect: 'SCORING' });
    expect(tainted?.traceRefs.length).toBeGreaterThan(0);
    expect(triggerSink).toMatchObject({ ruleId: 'UNAUTHENTICATED_TRIGGER_TO_SINK', severity: 'CRITICAL', effect: 'SCORING', evidenceClass: 'POTENTIAL_DATAFLOW' });
    expect(triggerSink?.traceRefs.length).toBeGreaterThan(0);
    expect(res.result.analysis.status).toBe('COMPLETE');
  });

  it('detects AGENT_EGRESS_UNRESTRICTED & AI_AGENT_UNGATED_TOOL and honors allowlisted domain + human gate suppression', () => {
    const wf = encode({
      nodes: [
        { id: 'w1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, parameters: { path: 'chat', httpMethod: 'POST' } },
        { id: 'a1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1, parameters: { text: '={{ $json.body.prompt }}' } },
        { id: 't1', name: 'Tool', type: 'n8n-nodes-base.httpRequestTool', typeVersion: 1, parameters: { url: '={{ $json.url }}' } },
      ],
      connections: {
        Webhook: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
        Tool: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] },
      },
    });
    const res = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    expect(res.result.findings.some((item) => item.ruleId === 'AGENT_EGRESS_UNRESTRICTED' && item.severity === 'HIGH' && item.effect === 'SCORING')).toBe(true);
    expect(res.result.findings.some((item) => item.ruleId === 'AI_AGENT_UNGATED_TOOL' && item.effect === 'SCORING')).toBe(true);

    const allowlisted = encode({
      nodes: [
        { id: 's1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} },
        { id: 'a1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1, parameters: {} },
        { id: 't1', name: 'Tool', type: 'n8n-nodes-base.httpRequestTool', typeVersion: 1, parameters: { url: 'https://api.trusted.example/v1/search' } },
      ],
      connections: {
        Start: { main: [[{ node: 'Agent', type: 'main', index: 0 }]] },
        Tool: { ai_tool: [[{ node: 'Agent', type: 'ai_tool', index: 0 }]] },
      },
    });
    const safeRes = scanWorkflowV2({ bytes: allowlisted, profile: STANDARD, approvedDomains: ['api.trusted.example'] });
    expect(safeRes.ok).toBe(true);
    if (!safeRes.ok) throw new Error(safeRes.code);
    expect(safeRes.result.findings.some((item) => item.ruleId === 'AGENT_EGRESS_UNRESTRICTED')).toBe(false);
  });

  it('keeps uncatalogued custom node multi-node topology COMPLETE in standard and preserves beta-default/beta-hardened/strict parity', () => {
    const wf = encode({
      nodes: [
        { id: 's1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} },
        { id: 'c1', name: 'Custom', type: '@acme/custom-node.enrich', typeVersion: 1, parameters: { value: '={{ $json.ok }}' } },
      ],
      connections: { Start: { main: [[{ node: 'Custom', type: 'main', index: 0 }]] } },
    });
    const std = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(std.ok).toBe(true);
    if (!std.ok) throw new Error(std.code);
    expect(std.result.analysis.status).toBe('COMPLETE');

    const exprWf = encode({
      nodes: [{ id: 's1', name: 'Set', type: 'n8n-nodes-base.set', typeVersion: 3, parameters: { v: '={{ $env.TOKEN }}' } }],
      connections: {},
    });
    const def = scanWorkflowV2({ bytes: exprWf, profile: BETA_DEFAULT });
    const hard = scanWorkflowV2({ bytes: exprWf, profile: BETA_HARDENED });
    const str = scanWorkflowV2({ bytes: exprWf, profile: STRICT });
    expect(def.ok && hard.ok && str.ok).toBe(true);
    if (!def.ok || !hard.ok || !str.ok) throw new Error('Expected admitted profile scans to succeed');
    expect(def.result.findings).toEqual([]);
    expect(hard.result.findings.some((item) => item.ruleId === 'EXPRESSION_ENV_EXPOSURE' && item.effect === 'REPORT_ONLY')).toBe(true);
    expect(str.result.findings.some((item) => item.ruleId === 'EXPRESSION_ENV_EXPOSURE' && item.effect === 'SCORING')).toBe(true);
  });

  it('scans gmailTrigger -> AI Agent, googleDriveTrigger -> HTTP, and errorTrigger -> Slack as COMPLETE without INDETERMINATE', () => {
    const gmailAgent = encode({
      nodes: [
        { id: 'gm1', name: 'Gmail Trigger', type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1, parameters: {} },
        { id: 'ag1', name: 'AI Agent', type: '@n8n/n8n-nodes-langchain.agent', typeVersion: 1, parameters: { text: '={{ $json.snippet }}' } },
        { id: 'tl1', name: 'Tool', type: 'n8n-nodes-base.httpRequestTool', typeVersion: 1, parameters: { url: '={{ $json.url }}' } },
      ],
      connections: {
        'Gmail Trigger': { main: [[{ node: 'AI Agent', type: 'main', index: 0 }]] },
        Tool: { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] },
      },
    });
    const gmRes = scanWorkflowV2({ bytes: gmailAgent, profile: STANDARD });
    expect(gmRes.ok).toBe(true);
    if (!gmRes.ok) throw new Error(gmRes.code);
    expect(gmRes.result.analysis.status).toBe('COMPLETE');
    expect(gmRes.result.assessment).not.toBeNull();
    expect(gmRes.result.findings.some((item) => item.ruleId === 'TAINTED_AI_PROMPT')).toBe(true);
    expect(gmRes.result.findings.some((item) => item.ruleId === 'AI_AGENT_UNGATED_TOOL')).toBe(true);

    const driveHttp = encode({
      nodes: [
        { id: 'gd1', name: 'Google Drive Trigger', type: 'n8n-nodes-base.googleDriveTrigger', typeVersion: 1, parameters: {} },
        { id: 'ht1', name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 1, parameters: { url: '={{ $json.webViewLink }}' } },
      ],
      connections: {
        'Google Drive Trigger': { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] },
      },
    });
    const gdRes = scanWorkflowV2({ bytes: driveHttp, profile: STANDARD });
    expect(gdRes.ok).toBe(true);
    if (!gdRes.ok) throw new Error(gdRes.code);
    expect(gdRes.result.analysis.status).toBe('COMPLETE');
    expect(gdRes.result.assessment).not.toBeNull();
    expect(gdRes.result.findings.some((item) => item.ruleId === 'TAINTED_REQUEST_URL')).toBe(true);

    const errorSlack = encode({
      nodes: [
        { id: 'er1', name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, parameters: {} },
        { id: 'sl1', name: 'Slack', type: 'n8n-nodes-base.slack', typeVersion: 1, parameters: { text: '={{ $json.execution.error.message }}' } },
      ],
      connections: {
        'Error Trigger': { main: [[{ node: 'Slack', type: 'main', index: 0 }]] },
      },
    });
    const erRes = scanWorkflowV2({ bytes: errorSlack, profile: STANDARD });
    expect(erRes.ok).toBe(true);
    if (!erRes.ok) throw new Error(erRes.code);
    expect(erRes.result.analysis.status).toBe('COMPLETE');
    expect(erRes.result.assessment).not.toBeNull();
    expect(erRes.result.analysis.diagnostics.some((diag) => diag.code === 'REQUIRED_STAGE_FAILURE')).toBe(false);
  });

  it('keeps unmodeled customTrigger -> ExecuteCommand COMPLETE with CRITICAL grade in standard while preserving beta-hardened INDETERMINATE', () => {
    const customTriggerWf = encode({
      nodes: [
        { id: 'ct1', name: 'Custom Trigger', type: 'n8n-nodes-community.brandNewCustomTrigger', typeVersion: 1, parameters: {} },
        { id: 'ex1', name: 'Execute Command', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, parameters: { command: '={{ $json.cmd }}' } },
      ],
      connections: {
        'Custom Trigger': { main: [[{ node: 'Execute Command', type: 'main', index: 0 }]] },
      },
    });
    const stdRes = scanWorkflowV2({ bytes: customTriggerWf, profile: STANDARD });
    expect(stdRes.ok).toBe(true);
    if (!stdRes.ok) throw new Error(stdRes.code);
    expect(stdRes.result.analysis.status).toBe('COMPLETE');
    expect(stdRes.result.assessment?.grade).toBe('CRITICAL');
    expect(stdRes.result.findings.some((item) => item.ruleId === 'N8N_EXECUTE_COMMAND' && item.severity === 'CRITICAL')).toBe(true);
    expect(stdRes.result.findings.some((item) => item.ruleId === 'UNKNOWN_NODE_PACKAGE')).toBe(true);
    expect(stdRes.result.analysis.diagnostics.some((diag) => diag.code === 'REQUIRED_STAGE_FAILURE')).toBe(false);
    expect(stdRes.result.analysis.diagnostics.some((diag) => diag.code === 'DEPENDENCY_UNAVAILABLE')).toBe(false);
    expect(stdRes.result.analysis.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'GENERIC_NODE_UNMODELED_CAPABILITY', capabilityId: 'graph-semantics', aggregateEffect: 'NONE', assessmentEligible: true }),
    ]));
    for (const capId of ['graph-semantics', 'taint-confidentiality', 'taint-integrity', 'agentic-control']) {
      expect(stdRes.result.analysis.capabilities.find((cap) => cap.id === capId)?.status).toBe('COMPLETED');
    }

    const strRes = scanWorkflowV2({ bytes: customTriggerWf, profile: STRICT });
    expect(strRes.ok).toBe(true);
    if (!strRes.ok) throw new Error(strRes.code);
    expect(strRes.result.analysis.status).toBe('COMPLETE');
    expect(strRes.result.assessment?.grade).toBe('CRITICAL');

    const hardRes = scanWorkflowV2({ bytes: customTriggerWf, profile: BETA_HARDENED });
    expect(hardRes.ok).toBe(true);
    if (!hardRes.ok) throw new Error(hardRes.code);
    expect(hardRes.result.analysis.status).toBe('INDETERMINATE');
    expect(hardRes.result.assessment).toBeNull();
    expect(hardRes.result.analysis.diagnostics.some((diag) => diag.code === 'REQUIRED_STAGE_FAILURE')).toBe(true);
  });

  it('scans workflows containing @n8n/n8n-nodes-langchain.textSplitterTokenSplitter as COMPLETE without workflow-insights failure', () => {
    const wf = encode({
      nodes: [
        { id: 'm1', name: 'Manual', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} },
        { id: 'ts1', name: 'Token Splitter', type: '@n8n/n8n-nodes-langchain.textSplitterTokenSplitter', typeVersion: 1, parameters: { chunkSize: 1000 } },
      ],
      connections: {},
    });
    const res = scanWorkflowV2({ bytes: wf, profile: STANDARD });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.code);
    expect(res.result.analysis.status).toBe('COMPLETE');
    expect(res.result.analysis.capabilities.find((cap) => cap.id === 'workflow-insights')?.status).toBe('COMPLETED');
  });
});
