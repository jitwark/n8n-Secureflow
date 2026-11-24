import type { AnalysisDiagnostic, NormalizedWorkflow as PolicyNormalizedWorkflow, NormalizedWorkflowNode, ScanFinding, ScanPolicy } from '../policy/policy';
import { literalIslands } from '../policy/literal-islands';
import { hasWebhookAuthentication, nodeFinding } from '../policy/policy-helpers';
import { isCataloguedHumanGate } from '../analyzers/ai/human-gate-catalog';
import { redactText } from '../redaction/redaction';
import type { NormalizedWorkflow } from '../workflow';
import type { RawWorkflowEdge } from '../workflow-graph';

export const UNAUTHENTICATED_TRIGGER_TO_SINK_POLICY_ID = 'UNAUTHENTICATED_TRIGGER_TO_SINK';
export const MAX_TRIGGER_SINK_FINDINGS = 50;
const MAX_TRAVERSAL_STEPS = 200_000;
const MAX_PARAM_WALK_NODES = 1_000;
const MAX_PARAM_WALK_DEPTH = 16;

export type TriggerSinkCategory = 'COMMAND' | 'CODE' | 'SQL' | 'FILE_WRITE' | 'AI_AGENT' | 'HTTP_EGRESS';

export type TriggerSinkWitness = Readonly<{
  triggerNodeIndex: number; triggerNodeId: string; triggerNodeName: string; triggerType: string;
  sinkNodeIndex: number; sinkNodeId: string; sinkNodeName: string; sinkType: string;
  sinkCategory: TriggerSinkCategory;
  pathNodeIndexes: readonly number[]; pathNodeIds: readonly string[];
  hopCount: number; viaAgentTool: boolean; agentNodeIndex?: number;
}>;

export type TriggerToSinkAnalysisResult = Readonly<{
  findings: readonly ScanFinding[]; witnesses: readonly TriggerSinkWitness[]; limitExceeded: boolean;
}>;

const AGENT_NODE_TYPE = '@n8n/n8n-nodes-langchain.agent';
const FORM_AUTH_METHODS = new Set(['basicAuth', 'headerAuth', 'jwtAuth']);
const CHAT_AUTH_METHODS = new Set(['basicAuth', 'headerAuth', 'jwtAuth', 'n8nUserAuth']);
const COMMAND_SINK_TYPES = new Set(['n8n-nodes-base.executeCommand', 'n8n-nodes-base.ssh']);
const CODE_SINK_TYPES = new Set([
  'n8n-nodes-base.code', 'n8n-nodes-base.function', 'n8n-nodes-base.functionItem',
  '@n8n/n8n-nodes-langchain.code', '@n8n/n8n-nodes-langchain.toolCode',
]);
const SQL_SINK_TYPES = new Set([
  'n8n-nodes-base.postgres', 'n8n-nodes-base.mySql', 'n8n-nodes-base.mysql',
  'n8n-nodes-base.microsoftSql', 'n8n-nodes-base.mssql',
]);
const SQL_PRIVILEGED_OPERATIONS = new Set([
  '', 'query', 'executequery', 'rawquery', 'insert', 'update', 'delete', 'upsert', 'insertorupdate',
]);
const HTTP_EGRESS_TYPES = new Set([
  'n8n-nodes-base.httpRequest', 'n8n-nodes-base.httpRequestTool', '@n8n/n8n-nodes-langchain.toolHttpRequest',
]);
const HARMLESS_SQL_HEALTHCHECK = /^SELECT\s+(?:1|TRUE|NOW\(\)|CURRENT_TIMESTAMP)\s*;?$/i;

type QueueEntry = { nodeIndex: number; parentQueueIndex: number; hopCount: number; viaAgentTool: boolean; agentNodeIndex?: number };
type TraversalState = { totalSteps: number; limitExceeded: boolean };

export function analyzeUnauthenticatedTriggerToSink(
  workflow: NormalizedWorkflow | PolicyNormalizedWorkflow,
): TriggerToSinkAnalysisResult {
  if (!hasWorkflowGraph(workflow) || workflow.nodes.length === 0) {
    return { findings: [], witnesses: [], limitExceeded: false };
  }
  const nodes = workflow.nodes;
  const executionAdj = buildTargetBuckets(workflow.graph.views.execution, nodes.length, (e) => e.fromNodeIndex, (e) => e.toNodeIndex);
  const agentTools = buildTargetBuckets(workflow.graph.views.capability, nodes.length, (e) => e.toNodeIndex, (e) => e.fromNodeIndex);
  const witnesses: TriggerSinkWitness[] = [];
  const findings: ScanFinding[] = [];
  const state: TraversalState = { totalSteps: 0, limitExceeded: false };

  for (let triggerIndex = 0; triggerIndex < nodes.length && !state.limitExceeded; triggerIndex += 1) {
    const triggerNode = nodes[triggerIndex];
    if (!triggerNode || !isUnauthenticatedExternalTrigger(triggerNode)) continue;
    const visited = new Set<number>([triggerIndex]);
    const queue: QueueEntry[] = [{ nodeIndex: triggerIndex, parentQueueIndex: -1, hopCount: 0, viaAgentTool: false }];

    for (let head = 0; head < queue.length && !state.limitExceeded; head += 1) {
      if (!chargeStep(state)) break;
      const entry = queue[head]!;
      const currentNode = nodes[entry.nodeIndex];
      if (!currentNode) continue;

      if (entry.hopCount > 0) {
        const sinkCategory = classifyPrivilegedSink(currentNode, agentTools[entry.nodeIndex] ?? []);
        if (sinkCategory !== undefined) {
          if (findings.length >= MAX_TRIGGER_SINK_FINDINGS) { state.limitExceeded = true; break; }
          const witness = createWitness(nodes, triggerIndex, entry.nodeIndex, sinkCategory, reconstructPath(queue, head), entry);
          witnesses.push(witness);
          findings.push(createFinding(triggerNode, currentNode, witness));
        }
      }
      if (isCataloguedHumanGate(currentNode) || entry.viaAgentTool) continue;

      enqueueNeighbors(queue, visited, executionAdj[entry.nodeIndex] ?? [], head, entry.hopCount + 1, false, undefined, state);
      if (!state.limitExceeded && currentNode.type === AGENT_NODE_TYPE) {
        enqueueNeighbors(queue, visited, agentTools[entry.nodeIndex] ?? [], head, entry.hopCount + 1, true, entry.nodeIndex, state);
      }
    }
  }
  return { findings, witnesses, limitExceeded: state.limitExceeded || Boolean(workflow.graph.limitExceeded) };
}

export const unauthenticatedTriggerToSinkPolicy: ScanPolicy = {
  id: UNAUTHENTICATED_TRIGGER_TO_SINK_POLICY_ID,
  name: 'Unauthenticated trigger to privileged sink',
  description: 'Flags execution paths from unauthenticated external triggers to privileged sinks without human approval.',
  evaluate: (workflow) => [...analyzeUnauthenticatedTriggerToSink(workflow).findings],
  diagnose: (workflow) => (analyzeUnauthenticatedTriggerToSink(workflow).limitExceeded
    ? [{ code: 'ANALYSIS_LIMIT_EXCEEDED', category: 'LIMIT' } satisfies AnalysisDiagnostic]
    : []),
};

function chargeStep(state: TraversalState): boolean {
  state.totalSteps += 1;
  if (state.totalSteps > MAX_TRAVERSAL_STEPS) { state.limitExceeded = true; return false; }
  return true;
}

function enqueueNeighbors(
  queue: QueueEntry[], visited: Set<number>, targets: readonly number[],
  parentQueueIndex: number, hopCount: number, viaAgentTool: boolean, agentNodeIndex: number | undefined, state: TraversalState,
): void {
  for (const target of targets) {
    if (!chargeStep(state)) return;
    if (visited.has(target)) continue;
    visited.add(target);
    queue.push({ nodeIndex: target, parentQueueIndex, hopCount, viaAgentTool, ...(agentNodeIndex === undefined ? {} : { agentNodeIndex }) });
  }
}

function hasWorkflowGraph(workflow: NormalizedWorkflow | PolicyNormalizedWorkflow): workflow is NormalizedWorkflow {
  const candidate = workflow as Partial<NormalizedWorkflow>;
  return Array.isArray(candidate?.nodes) && Array.isArray(candidate.graph?.views?.execution) && Array.isArray(candidate.graph?.views?.capability);
}

function isUnauthenticatedExternalTrigger(node: NormalizedWorkflowNode): boolean {
  const parameters = isRecord(node.parameters) ? node.parameters : {};
  if (node.type === 'n8n-nodes-base.webhook') return !hasWebhookAuthentication(parameters);
  if (node.type === 'n8n-nodes-base.formTrigger') return !(typeof parameters.authentication === 'string' && FORM_AUTH_METHODS.has(parameters.authentication));
  if (node.type === '@n8n/n8n-nodes-langchain.chatTrigger') return !(typeof parameters.authentication === 'string' && CHAT_AUTH_METHODS.has(parameters.authentication));
  return false;
}

function classifyPrivilegedSink(node: NormalizedWorkflowNode, attachedTools: readonly number[]): TriggerSinkCategory | undefined {
  if (COMMAND_SINK_TYPES.has(node.type)) return 'COMMAND';
  if (CODE_SINK_TYPES.has(node.type)) return 'CODE';
  const parameters = isRecord(node.parameters) ? node.parameters : {};
  if (SQL_SINK_TYPES.has(node.type)) return isPrivilegedSqlNode(parameters) ? 'SQL' : undefined;
  if (node.type === 'n8n-nodes-base.writeBinaryFile') return 'FILE_WRITE';
  if (node.type === 'n8n-nodes-base.readWriteFile') {
    return typeof parameters.operation === 'string' && parameters.operation.trim().toLowerCase() === 'write' ? 'FILE_WRITE' : undefined;
  }
  if (node.type === AGENT_NODE_TYPE) return attachedTools.length > 0 ? 'AI_AGENT' : undefined;
  if (HTTP_EGRESS_TYPES.has(node.type)) return hasDynamicExpression(parameters) ? 'HTTP_EGRESS' : undefined;
  return undefined;
}

function isPrivilegedSqlNode(parameters: Record<string, unknown>): boolean {
  const op = typeof parameters.operation === 'string' ? parameters.operation.trim().toLowerCase() : '';
  const query = typeof parameters.query === 'string' ? parameters.query.trim() : undefined;
  if (query !== undefined && literalIslands(query).templated) return true;
  if (!SQL_PRIVILEGED_OPERATIONS.has(op)) return false;
  return !((op === '' || op.includes('query')) && query !== undefined && HARMLESS_SQL_HEALTHCHECK.test(query));
}

function hasDynamicExpression(root: unknown): boolean {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  for (let visited = 0; stack.length > 0 && visited < MAX_PARAM_WALK_NODES; visited += 1) {
    const { value, depth } = stack.pop()!;
    if (typeof value === 'string') { if (literalIslands(value).templated) return true; continue; }
    if (typeof value !== 'object' || value === null || depth >= MAX_PARAM_WALK_DEPTH || seen.has(value)) continue;
    seen.add(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) stack.push({ value: child, depth: depth + 1 });
  }
  return false;
}

function buildTargetBuckets(
  edges: readonly RawWorkflowEdge[], nodeCount: number,
  sourceOf: (edge: RawWorkflowEdge) => number, targetOf: (edge: RawWorkflowEdge) => number,
): number[][] {
  const buckets = Array.from({ length: nodeCount }, () => [] as number[]);
  for (const edge of edges) {
    const source = sourceOf(edge);
    const target = targetOf(edge);
    if (Number.isSafeInteger(source) && source >= 0 && source < nodeCount && Number.isSafeInteger(target) && target >= 0 && target < nodeCount) {
      buckets[source]!.push(target);
    }
  }
  return buckets.map((targets) => [...new Set(targets)].sort((left, right) => left - right));
}

function reconstructPath(queue: readonly QueueEntry[], endIndex: number): number[] {
  const path: number[] = [];
  for (let cursor = endIndex; cursor >= 0; cursor = queue[cursor]!.parentQueueIndex) path.push(queue[cursor]!.nodeIndex);
  return path.reverse();
}

function createWitness(
  nodes: readonly NormalizedWorkflowNode[], triggerIndex: number, sinkIndex: number,
  sinkCategory: TriggerSinkCategory, pathNodeIndexes: readonly number[], entry: QueueEntry,
): TriggerSinkWitness {
  const triggerNode = nodes[triggerIndex]!;
  const sinkNode = nodes[sinkIndex]!;
  return Object.freeze({
    triggerNodeIndex: triggerIndex, triggerNodeId: redactText(triggerNode.id), triggerNodeName: redactText(triggerNode.name), triggerType: triggerNode.type,
    sinkNodeIndex: sinkIndex, sinkNodeId: redactText(sinkNode.id), sinkNodeName: redactText(sinkNode.name), sinkType: sinkNode.type, sinkCategory,
    pathNodeIndexes: Object.freeze([...pathNodeIndexes]),
    pathNodeIds: Object.freeze(pathNodeIndexes.map((index) => redactText(nodes[index]!.id))),
    hopCount: entry.hopCount, viaAgentTool: entry.viaAgentTool,
    ...(entry.agentNodeIndex === undefined ? {} : { agentNodeIndex: entry.agentNodeIndex }),
  });
}

function createFinding(triggerNode: NormalizedWorkflowNode, sinkNode: NormalizedWorkflowNode, witness: TriggerSinkWitness): ScanFinding {
  const finding = nodeFinding({
    policyId: UNAUTHENTICATED_TRIGGER_TO_SINK_POLICY_ID,
    title: 'Unauthenticated external trigger reaches a privileged sink',
    severity: 'CRITICAL',
    node: sinkNode,
    evidence: {
      triggerNodeId: witness.triggerNodeId, triggerNodeName: witness.triggerNodeName, triggerType: witness.triggerType,
      sinkNodeId: witness.sinkNodeId, sinkNodeName: witness.sinkNodeName, sinkType: witness.sinkType,
      sinkCategory: witness.sinkCategory, pathNodeIds: [...witness.pathNodeIds], tracePath: [...witness.pathNodeIds],
      hopCount: witness.hopCount, viaAgentTool: witness.viaAgentTool,
    },
    message: `Unauthenticated ${triggerNode.type} reaches privileged ${sinkNode.type} in ${witness.hopCount} hop(s).`,
    explanation: 'An unauthenticated external trigger can reach a privileged execution, database, file write, agent tool, or dynamic HTTP egress node without a human-approval gate on all paths.',
    whyItMatters: 'External callers can invoke high-privilege operations directly without authentication or human review.',
    possibleImpact: 'Unauthenticated remote attackers may execute commands or code, modify databases or files, abuse agent tools, or trigger SSRF.',
    remediation: 'Require authentication on the external trigger or enforce a human-approval gate on every path before the sink.',
    remediationSteps: [
      'Enable authentication (headerAuth, basicAuth, jwtAuth, or n8nUserAuth) on the external trigger.',
      'Or place a Wait (form) / sendAndWait approval node on every execution path reaching the sink.',
      'Restrict privileged sinks or replace dynamic expressions with validated allowlists.',
    ],
    confidence: 'HIGH',
  });
  return { ...finding, location: { nodeId: witness.sinkNodeId, nodeName: witness.sinkNodeName } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
