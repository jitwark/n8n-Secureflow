import { describe, expect, it } from 'vitest';
import { parseWorkflowJson, type NormalizedWorkflow } from '../workflow';
import {
  analyzeUnauthenticatedTriggerToSink,
  unauthenticatedTriggerToSinkPolicy,
} from './trigger-sink-policy';

type RawNode = {
  id: string;
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
};

const mainEdge = (...targets: string[]) => ({
  main: [targets.map((node) => ({ node, type: 'main', index: 0 }))],
});

const toolEdge = (agentName: string) => ({
  ai_tool: [[{ node: agentName, type: 'ai_tool', index: 0 }]],
});

function buildWorkflow(nodes: RawNode[], connections: Record<string, unknown>): NormalizedWorkflow {
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    typeVersion: 1,
    parameters: node.parameters ?? {},
  }));
  const parsed = parseWorkflowJson(JSON.stringify({ nodes: normalizedNodes, connections }));
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.workflow;
}

describe('unauthenticatedTriggerToSinkPolicy (UNAUTHENTICATED_TRIGGER_TO_SINK)', () => {
  it('flags direct 1-hop unauthenticated Webhook -> ExecuteCommand with CRITICAL/HIGH metadata', () => {
    const workflow = buildWorkflow(
      [
        { id: 'wh-1', name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'run' } },
        { id: 'cmd-1', name: 'Exec', type: 'n8n-nodes-base.executeCommand', parameters: { command: 'id' } },
      ],
      { Webhook: mainEdge('Exec') },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      policyId: 'UNAUTHENTICATED_TRIGGER_TO_SINK',
      severity: 'CRITICAL',
      confidence: 'HIGH',
      location: { nodeId: 'cmd-1', nodeName: 'Exec' },
      message: 'Unauthenticated n8n-nodes-base.webhook reaches privileged n8n-nodes-base.executeCommand in 1 hop(s).',
      evidence: {
        triggerType: 'n8n-nodes-base.webhook',
        sinkType: 'n8n-nodes-base.executeCommand',
        sinkCategory: 'COMMAND',
        pathNodeIds: ['wh-1', 'cmd-1'],
        hopCount: 1,
      },
    });
    expect(findings[0]!.remediation.trim()).not.toBe('');
    expect(findings[0]!.remediationSteps.length).toBeGreaterThan(0);

    const analysis = analyzeUnauthenticatedTriggerToSink(workflow);
    expect(analysis.limitExceeded).toBe(false);
    expect(analysis.witnesses).toEqual([
      expect.objectContaining({
        triggerNodeIndex: 0,
        sinkNodeIndex: 1,
        triggerType: 'n8n-nodes-base.webhook',
        sinkType: 'n8n-nodes-base.executeCommand',
        sinkCategory: 'COMMAND',
        pathNodeIndexes: [0, 1],
        pathNodeIds: ['wh-1', 'cmd-1'],
        hopCount: 1,
      }),
    ]);
  });

  it('flags 4-node (3-hop) FormTrigger -> Set -> If -> Code across absent, none, and whitespace auth', () => {
    for (const authParams of [{}, { authentication: 'none' }, { authentication: '   ' }, { authentication: 'invalid' }]) {
      const workflow = buildWorkflow(
        [
          { id: 'form-1', name: 'Form', type: 'n8n-nodes-base.formTrigger', parameters: authParams },
          { id: 'set-1', name: 'Set', type: 'n8n-nodes-base.set' },
          { id: 'if-1', name: 'If', type: 'n8n-nodes-base.if' },
          { id: 'code-1', name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return items;' } },
        ],
        {
          Form: mainEdge('Set'),
          Set: mainEdge('If'),
          If: mainEdge('Code'),
        },
      );

      const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        policyId: 'UNAUTHENTICATED_TRIGGER_TO_SINK',
        severity: 'CRITICAL',
        confidence: 'HIGH',
        location: { nodeId: 'code-1', nodeName: 'Code' },
        message: 'Unauthenticated n8n-nodes-base.formTrigger reaches privileged n8n-nodes-base.code in 3 hop(s).',
        evidence: {
          triggerType: 'n8n-nodes-base.formTrigger',
          sinkType: 'n8n-nodes-base.code',
          sinkCategory: 'CODE',
          pathNodeIds: ['form-1', 'set-1', 'if-1', 'code-1'],
          hopCount: 3,
        },
      });
    }
  });

  it('flags ChatTrigger -> Agent -> ai_tool ExecuteCommand and dynamic HttpRequestTool', () => {
    const workflow = buildWorkflow(
      [
        { id: 'chat-1', name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger', parameters: { authentication: 'none' } },
        { id: 'agent-1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
        { id: 'exec-tool', name: 'ExecTool', type: 'n8n-nodes-base.executeCommand', parameters: { command: 'whoami' } },
        {
          id: 'http-tool',
          name: 'HttpTool',
          type: 'n8n-nodes-base.httpRequestTool',
          parameters: { url: "={{ $fromAI('url') }}" },
        },
      ],
      {
        Chat: mainEdge('Agent'),
        ExecTool: toolEdge('Agent'),
        HttpTool: toolEdge('Agent'),
      },
    );

    const analysis = analyzeUnauthenticatedTriggerToSink(workflow);
    expect(analysis.witnesses.map((w) => ({
      sinkId: w.sinkNodeId,
      sinkCategory: w.sinkCategory,
      hopCount: w.hopCount,
      pathNodeIds: w.pathNodeIds,
      viaAgentTool: Boolean(w.viaAgentTool),
    }))).toEqual([
      {
        sinkId: 'agent-1',
        sinkCategory: 'AI_AGENT',
        hopCount: 1,
        pathNodeIds: ['chat-1', 'agent-1'],
        viaAgentTool: false,
      },
      {
        sinkId: 'exec-tool',
        sinkCategory: 'COMMAND',
        hopCount: 2,
        pathNodeIds: ['chat-1', 'agent-1', 'exec-tool'],
        viaAgentTool: true,
      },
      {
        sinkId: 'http-tool',
        sinkCategory: 'HTTP_EGRESS',
        hopCount: 2,
        pathNodeIds: ['chat-1', 'agent-1', 'http-tool'],
        viaAgentTool: true,
      },
    ]);
  });

  it('flags Agent with a non-sink connected ai_tool', () => {
    const workflow = buildWorkflow(
      [
        { id: 'chat-1', name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
        { id: 'agent-1', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
        { id: 'wf-tool', name: 'SubTool', type: '@n8n/n8n-nodes-langchain.toolWorkflow' },
      ],
      {
        Chat: mainEdge('Agent'),
        SubTool: toolEdge('Agent'),
      },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      location: { nodeId: 'agent-1', nodeName: 'Agent' },
      evidence: { sinkCategory: 'AI_AGENT', hopCount: 1 },
    });
  });

  it.each([
    ['postgres executeQuery', 'n8n-nodes-base.postgres', { operation: 'executeQuery', query: 'SELECT * FROM users WHERE id = {{ $json.id }}' }],
    ['mySql insert', 'n8n-nodes-base.mySql', { operation: 'insert', table: 'users' }],
    ['microsoftSql unspecified', 'n8n-nodes-base.microsoftSql', { query: 'DELETE FROM audit' }],
    ['mssql delete', 'n8n-nodes-base.mssql', { operation: 'delete', table: 'sessions' }],
    ['postgres unspecified', 'n8n-nodes-base.postgres', {}],
  ])('flags SQL sink %s', (_label, nodeType, parameters) => {
    const workflow = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'db', name: 'Database', type: nodeType, parameters },
      ],
      { Webhook: mainEdge('Database') },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toMatchObject({ sinkType: nodeType, sinkCategory: 'SQL', hopCount: 1 });
  });

  it.each([
    ['ssh', 'n8n-nodes-base.ssh', { command: 'uptime' }, 'COMMAND'],
    ['function', 'n8n-nodes-base.function', { functionCode: 'return items;' }, 'CODE'],
    ['functionItem', 'n8n-nodes-base.functionItem', { functionCode: 'return item;' }, 'CODE'],
    ['langchain code', '@n8n/n8n-nodes-langchain.code', {}, 'CODE'],
    ['langchain toolCode', '@n8n/n8n-nodes-langchain.toolCode', {}, 'CODE'],
    ['readWriteFile write', 'n8n-nodes-base.readWriteFile', { operation: 'write', fileName: '/tmp/out' }, 'FILE_WRITE'],
    ['writeBinaryFile', 'n8n-nodes-base.writeBinaryFile', { fileName: '/tmp/bin' }, 'FILE_WRITE'],
    ['httpRequest dynamic url', 'n8n-nodes-base.httpRequest', { url: '=https://example.com/{{ $json.path }}' }, 'HTTP_EGRESS'],
    ['httpRequest dynamic body', 'n8n-nodes-base.httpRequest', { url: 'https://api.example.com', jsonBody: '={{ $json.data }}' }, 'HTTP_EGRESS'],
  ])('flags privileged sink %s', (_label, nodeType, parameters, expectedCategory) => {
    const workflow = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'sink', name: 'Sink', type: nodeType, parameters },
      ],
      { Webhook: mainEdge('Sink') },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toMatchObject({
      sinkType: nodeType,
      sinkCategory: expectedCategory,
      hopCount: 1,
    });
  });

  it('terminates cleanly on cyclic graphs and selects the shortest deterministic path', () => {
    const workflow = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'n1', name: 'Step1', type: 'n8n-nodes-base.set' },
        { id: 'n2', name: 'Step2', type: 'n8n-nodes-base.noOp' },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      {
        Webhook: mainEdge('Step1', 'Step2'),
        Step1: mainEdge('Step1', 'Step2'),
        Step2: mainEdge('Step1', 'Exec'),
      },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toMatchObject({
      pathNodeIds: ['wh', 'n2', 'cmd'],
      hopCount: 2,
    });
  });

  it('suppresses only when a catalogued human gate stands on every path from the trigger', () => {
    const gated = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'wait', name: 'Approval', type: 'n8n-nodes-base.wait', parameters: { resume: 'form' } },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      { Webhook: mainEdge('Approval'), Approval: mainEdge('Exec') },
    );
    expect(unauthenticatedTriggerToSinkPolicy.evaluate(gated)).toEqual([]);

    const slackGated = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'slack', name: 'SlackGate', type: 'n8n-nodes-base.slack', parameters: { operation: 'sendAndWait' } },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      { Webhook: mainEdge('SlackGate'), SlackGate: mainEdge('Exec') },
    );
    expect(unauthenticatedTriggerToSinkPolicy.evaluate(slackGated)).toEqual([]);

    const bypassed = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'wait', name: 'Approval', type: 'n8n-nodes-base.wait', parameters: { resume: 'form' } },
        { id: 'bypass', name: 'Bypass', type: 'n8n-nodes-base.noOp' },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      { Webhook: mainEdge('Approval', 'Bypass'), Approval: mainEdge('Exec'), Bypass: mainEdge('Exec') },
    );
    const bypassFindings = unauthenticatedTriggerToSinkPolicy.evaluate(bypassed);
    expect(bypassFindings).toHaveLength(1);
    expect(bypassFindings[0]!.evidence).toMatchObject({
      pathNodeIds: ['wh', 'bypass', 'cmd'],
      hopCount: 2,
    });
  });

  it('does not treat uncatalogued sendAndWait node as human-approval gate', () => {
    const workflow = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'fake', name: 'FakeGate', type: 'n8n-nodes-base.noOp', parameters: { operation: 'sendAndWait' } },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      { Webhook: mainEdge('FakeGate'), FakeGate: mainEdge('Exec') },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toMatchObject({ pathNodeIds: ['wh', 'fake', 'cmd'], hopCount: 2 });
  });

  it('still traverses execution edges through an Agent with 0 tools to reach downstream sinks', () => {
    const workflow = buildWorkflow(
      [
        { id: 'chat', name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
        { id: 'agent', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
        { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
      ],
      { Chat: mainEdge('Agent'), Agent: mainEdge('Exec') },
    );

    const findings = unauthenticatedTriggerToSinkPolicy.evaluate(workflow);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      location: { nodeId: 'cmd', nodeName: 'Exec' },
      evidence: { sinkCategory: 'COMMAND', pathNodeIds: ['chat', 'agent', 'cmd'], hopCount: 2 },
    });
  });

  it('terminates cleanly on cyclic graphs with no sink', () => {
    const workflow = buildWorkflow(
      [
        { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
        { id: 'a', name: 'A', type: 'n8n-nodes-base.set' },
        { id: 'b', name: 'B', type: 'n8n-nodes-base.noOp' },
      ],
      { Webhook: mainEdge('A'), A: mainEdge('B'), B: mainEdge('A') },
    );
    expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toEqual([]);
  });

  it('flags ChatTrigger with whitespace or unsupported authentication values', () => {
    for (const authParams of [{ authentication: '   ' }, { authentication: 'oauth2' }]) {
      const workflow = buildWorkflow(
        [
          { id: 'chat', name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger', parameters: authParams },
          { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
        ],
        { Chat: mainEdge('Exec') },
      );
      expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toHaveLength(1);
    }
  });

  describe('true negatives', () => {
    it.each([
      ['Webhook with headerAuth', 'n8n-nodes-base.webhook', { authentication: 'headerAuth' }],
      ['Webhook with basicAuth', 'n8n-nodes-base.webhook', { authentication: 'basicAuth' }],
      ['Webhook with jwtAuth', 'n8n-nodes-base.webhook', { authentication: 'jwtAuth' }],
      ['FormTrigger with basicAuth', 'n8n-nodes-base.formTrigger', { authentication: 'basicAuth' }],
      ['ChatTrigger with n8nUserAuth', '@n8n/n8n-nodes-langchain.chatTrigger', { authentication: 'n8nUserAuth' }],
      ['ChatTrigger with basicAuth', '@n8n/n8n-nodes-langchain.chatTrigger', { authentication: 'basicAuth' }],
      ['ChatTrigger with headerAuth', '@n8n/n8n-nodes-langchain.chatTrigger', { authentication: 'headerAuth' }],
      ['ChatTrigger with jwtAuth', '@n8n/n8n-nodes-langchain.chatTrigger', { authentication: 'jwtAuth' }],
      ['manualTrigger', 'n8n-nodes-base.manualTrigger', {}],
      ['scheduleTrigger', 'n8n-nodes-base.scheduleTrigger', {}],
      ['cron', 'n8n-nodes-base.cron', {}],
    ])('does not flag %s -> ExecuteCommand', (_label, triggerType, parameters) => {
      const workflow = buildWorkflow(
        [
          { id: 'trig', name: 'Trigger', type: triggerType, parameters },
          { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
        ],
        { Trigger: mainEdge('Exec') },
      );

      expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toEqual([]);
    });

    it('does not flag disconnected ExecuteCommand', () => {
      const workflow = buildWorkflow(
        [
          { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
          { id: 'cmd', name: 'Exec', type: 'n8n-nodes-base.executeCommand' },
        ],
        {},
      );
      expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toEqual([]);
    });

    it('does not flag ChatTrigger -> Agent with 0 connected tools (even with chat model context)', () => {
      const workflow = buildWorkflow(
        [
          { id: 'chat', name: 'Chat', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
          { id: 'agent', name: 'Agent', type: '@n8n/n8n-nodes-langchain.agent' },
          { id: 'llm', name: 'Model', type: '@n8n/n8n-nodes-langchain.lmChatOpenAi' },
        ],
        {
          Chat: mainEdge('Agent'),
          Model: { ai_languageModel: [[{ node: 'Agent', type: 'ai_languageModel', index: 0 }]] },
        },
      );
      expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toEqual([]);
    });

    it.each([
      ['static postgres SELECT 1 healthcheck', 'n8n-nodes-base.postgres', { operation: 'executeQuery', query: 'SELECT 1;' }],
      ['postgres structured select', 'n8n-nodes-base.postgres', { operation: 'select', table: 'items' }],
      ['readWriteFile read operation', 'n8n-nodes-base.readWriteFile', { operation: 'read', fileName: '/tmp/a' }],
      ['readWriteFile default operation', 'n8n-nodes-base.readWriteFile', { fileName: '/tmp/a' }],
      ['readBinaryFile', 'n8n-nodes-base.readBinaryFile', { filePath: '/tmp/a' }],
      ['static httpRequest', 'n8n-nodes-base.httpRequest', { url: 'https://api.example.com/health', method: 'GET' }],
      ['static httpRequestTool', 'n8n-nodes-base.httpRequestTool', { url: 'https://api.example.com/health' }],
    ])('does not flag benign node %s', (_label, nodeType, parameters) => {
      const workflow = buildWorkflow(
        [
          { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
          { id: 'node', name: 'Target', type: nodeType, parameters },
        ],
        { Webhook: mainEdge('Target') },
      );
      expect(unauthenticatedTriggerToSinkPolicy.evaluate(workflow)).toEqual([]);
    });

    it('handles partial workflows without graph without throwing', () => {
      const partial = {
        nodes: [{ id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {}, sourcePath: '/nodes/0' }],
      } as NormalizedWorkflow;
      expect(() => unauthenticatedTriggerToSinkPolicy.evaluate(partial)).not.toThrow();
      expect(unauthenticatedTriggerToSinkPolicy.evaluate(partial)).toEqual([]);
    });
  });

  it('produces deterministic byte-identical results regardless of connection order and redacts secrets', () => {
    const canary = ['ghp', '1234567890abcdef1234567890abcdef1234'].join('_');
    const whName = `Webhook ${canary}`;
    const nodes: RawNode[] = [
      { id: 'wh', name: whName, type: 'n8n-nodes-base.webhook' },
      { id: 'mid', name: 'Mid', type: 'n8n-nodes-base.noOp' },
      { id: 'sink-b', name: 'SinkB', type: 'n8n-nodes-base.code', parameters: { jsCode: canary } },
      { id: 'sink-a', name: 'SinkA', type: 'n8n-nodes-base.executeCommand', parameters: { command: `curl ${['https://', 'user', ':', canary, '@example.com'].join('')}` } },
    ];
    const w1 = buildWorkflow(nodes, {
      [whName]: mainEdge('SinkB', 'Mid', 'SinkA'),
      Mid: mainEdge('SinkA'),
    });
    const w2 = buildWorkflow(nodes, {
      Mid: mainEdge('SinkA'),
      [whName]: mainEdge('SinkA', 'Mid', 'SinkB'),
    });

    const r1 = JSON.stringify(analyzeUnauthenticatedTriggerToSink(w1));
    const r2 = JSON.stringify(analyzeUnauthenticatedTriggerToSink(w2));
    expect(r1).toBe(r2);
    expect(r1).not.toContain(canary);
    expect(JSON.parse(r1).findings).toHaveLength(2);
  });

  it('caps findings deterministically at 50 and reports ANALYSIS_LIMIT_EXCEEDED', () => {
    const nodes: RawNode[] = [
      { id: 'wh', name: 'Webhook', type: 'n8n-nodes-base.webhook' },
      ...Array.from({ length: 60 }, (_v, i) => ({
        id: `cmd-${i}`,
        name: `Cmd${i}`,
        type: 'n8n-nodes-base.executeCommand',
      })),
    ];
    const workflow = buildWorkflow(nodes, {
      Webhook: mainEdge(...Array.from({ length: 60 }, (_v, i) => `Cmd${i}`)),
    });

    const analysis = analyzeUnauthenticatedTriggerToSink(workflow);
    expect(analysis.findings).toHaveLength(50);
    expect(analysis.witnesses).toHaveLength(50);
    expect(analysis.limitExceeded).toBe(true);
    expect(unauthenticatedTriggerToSinkPolicy.diagnose?.(workflow)).toEqual([
      { code: 'ANALYSIS_LIMIT_EXCEEDED', category: 'LIMIT' },
    ]);
  });
});
