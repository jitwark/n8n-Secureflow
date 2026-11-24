#!/usr/bin/env node
import { Console } from 'node:console';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgumentsV2 } from './arguments.js';
import type { PublicRunResultV2 } from './cli-runner.js';
import { runCliV2Internal, type V2CliRunResult } from './cli-runner-internal.js';
import {
  ADMITTED_PROFILE_SPECIFIERS_V2, CLI_VERSION_V2, DEFAULT_PROFILE_V3,
  isAdmittedProfileSpecifierV2, isApprovedDomainV2, resolveAdmittedProfileV2,
  type ScanConfidenceV2, type ScanFailOnV2, type ScanFormatV2, type ScanSeverityV2,
} from './contracts.js';
import type { CliEnvelopeV2 } from './json-output.js';
import { resolveFindingTraces, sortFindingsDeterministic, subjectLocation } from './pretty-output.js';
import { getRuleProseV3 } from './rule-prose-v3.js';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
export const MCP_TOOL_NAME = 'n8n_scan';
export const MCP_MAX_LINE_BYTES = 1_048_576;

export type McpRequest = Readonly<{ jsonrpc: '2.0'; id?: string | number; method: string; params?: unknown }>;
export type McpResponse = Readonly<{ jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: Readonly<{ code: number; message: string }> }>;
type ToolCallArguments = Readonly<{
  inputs: readonly string[];
  format?: ScanFormatV2;
  failOn?: ScanFailOnV2;
  minSeverity?: ScanSeverityV2;
  minConfidence?: ScanConfidenceV2;
  profile?: string;
  approvedDomains?: readonly string[];
  include?: readonly string[];
  exclude?: readonly string[];
}>;
type HandlerOptions = Readonly<{ cwd?: string }>;

const FORMATS_V2 = Object.freeze(['json', 'ndjson', 'sarif', 'table', 'pretty', 'markdown'] as const);
const SEVERITIES_V2 = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const);
const CONFIDENCES_V2 = Object.freeze(['HIGH', 'MEDIUM', 'LOW'] as const);
const FAIL_ON_V2 = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'NONE'] as const);
const ALLOWED_ARGUMENTS: Record<string, true> = Object.freeze({
  inputs: true, format: true, failOn: true, minSeverity: true, minConfidence: true,
  profile: true, approvedDomains: true, include: true, exclude: true,
});

const TOOL = Object.freeze({
  name: MCP_TOOL_NAME,
  description: 'Scan local n8n workflow JSON offline with deterministic rules, taint dataflow analysis, and agentic safety checks.',
  inputSchema: Object.freeze({
    type: 'object', additionalProperties: false, required: ['inputs'],
    properties: Object.freeze({
      inputs: Object.freeze({ type: 'array', minItems: 1, items: Object.freeze({ type: 'string', minLength: 1, pattern: '^(?!-$)' }) }),
      format: Object.freeze({ type: 'string', enum: FORMATS_V2 }),
      failOn: Object.freeze({ type: 'string', enum: FAIL_ON_V2 }),
      minSeverity: Object.freeze({ type: 'string', enum: SEVERITIES_V2 }),
      minConfidence: Object.freeze({ type: 'string', enum: CONFIDENCES_V2 }),
      profile: Object.freeze({ type: 'string', enum: ADMITTED_PROFILE_SPECIFIERS_V2 }),
      approvedDomains: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string', minLength: 1, pattern: '^(?!-)' }) }),
      include: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string', minLength: 1, pattern: '^(?!-)' }) }),
      exclude: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string', minLength: 1, pattern: '^(?!-)' }) }),
    }),
  }),
});

const response = (id: string | number | null, result: unknown): McpResponse => Object.freeze({ jsonrpc: '2.0', id, result });
const error = (id: string | number | null, code: number, message: string): McpResponse => Object.freeze({ jsonrpc: '2.0', id, error: Object.freeze({ code, message }) });
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
const isAdmittedOptionValueArray = (value: unknown): value is string[] => isNonEmptyStringArray(value) && value.every((entry) => !entry.startsWith('-'));

function toolArguments(params: unknown): ToolCallArguments | null {
  if (!isRecord(params) || params.name !== MCP_TOOL_NAME || !isRecord(params.arguments)) return null;
  const values = params.arguments;
  if (Object.keys(values).some((key) => ALLOWED_ARGUMENTS[key] !== true)) return null;
  if (!isNonEmptyStringArray(values.inputs) || values.inputs.length === 0 || values.inputs.includes('-')) return null;
  if (values.format !== undefined && !(typeof values.format === 'string' && (FORMATS_V2 as readonly string[]).includes(values.format))) return null;
  if (values.failOn !== undefined && !(typeof values.failOn === 'string' && (FAIL_ON_V2 as readonly string[]).includes(values.failOn))) return null;
  if (values.minSeverity !== undefined && !(typeof values.minSeverity === 'string' && (SEVERITIES_V2 as readonly string[]).includes(values.minSeverity))) return null;
  if (values.minConfidence !== undefined && !(typeof values.minConfidence === 'string' && (CONFIDENCES_V2 as readonly string[]).includes(values.minConfidence))) return null;
  if (values.profile !== undefined && !isAdmittedProfileSpecifierV2(values.profile)) return null;
  if (values.approvedDomains !== undefined && (!isAdmittedOptionValueArray(values.approvedDomains) || !values.approvedDomains.every(isApprovedDomainV2) || values.approvedDomains.length > 1000)) return null;
  if (values.include !== undefined && !isAdmittedOptionValueArray(values.include)) return null;
  if (values.exclude !== undefined && !isAdmittedOptionValueArray(values.exclude)) return null;
  return values as ToolCallArguments;
}

async function executeMcpScan(argumentsValue: ToolCallArguments, options: HandlerOptions = {}): Promise<V2CliRunResult> {
  const format = argumentsValue.format ?? 'pretty';
  const profile = resolveAdmittedProfileV2(argumentsValue.profile ?? DEFAULT_PROFILE_V3.id) ?? DEFAULT_PROFILE_V3;
  const argv = ['--schema', 'v2', 'scan', '--format', format, '--profile', profile.id];
  if (format === 'pretty') argv.push('--no-color');
  if (argumentsValue.failOn) argv.push('--fail-on', argumentsValue.failOn);
  if (argumentsValue.minSeverity) argv.push('--min-severity', argumentsValue.minSeverity);
  if (argumentsValue.minConfidence) argv.push('--min-confidence', argumentsValue.minConfidence);
  for (const domain of argumentsValue.approvedDomains ?? []) argv.push('--approved-domain', domain);
  for (const input of argumentsValue.include ?? []) argv.push('--include', input);
  for (const input of argumentsValue.exclude ?? []) argv.push('--exclude', input);
  argv.push('--', ...argumentsValue.inputs);
  const parsed = parseArgumentsV2(argv);
  if (!parsed.ok || parsed.command.kind !== 'scan') return Object.freeze({ exitCode: 2, stdout: '', stderr: 'MCP scan arguments are invalid.\n' });
  return runCliV2Internal(parsed.command, { cwd: options.cwd });
}

export async function runMcpScan(argumentsValue: ToolCallArguments, options: HandlerOptions = {}): Promise<PublicRunResultV2> {
  const result = await executeMcpScan(argumentsValue, options);
  return Object.freeze({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, ...(result.document === undefined ? {} : { document: result.document }) });
}

function buildStructuredContent(exitCode: number, envelope?: CliEnvelopeV2): Readonly<Record<string, unknown>> {
  if (envelope === undefined) return Object.freeze({ exitCode });
  let topScore: number | undefined;
  let topGrade: string | undefined;
  const findings: Array<Readonly<Record<string, unknown>>> = [];
  for (const item of envelope.results) {
    if (!item.ok) continue;
    const assessment = item.result.assessment;
    if (assessment !== null && (topScore === undefined || assessment.score > topScore)) {
      topScore = assessment.score;
      topGrade = assessment.grade;
    }
    const tracesById = new Map(item.result.traces.map((trace) => [trace.traceId, trace]));
    for (const finding of sortFindingsDeterministic(item.result.findings)) {
      const loc = subjectLocation(finding.subject);
      findings.push(Object.freeze({
        input: item.input,
        findingId: finding.findingId,
        ruleId: finding.ruleId,
        severity: finding.severity,
        confidence: finding.confidence,
        effect: finding.effect,
        node: loc.label,
        pointer: loc.pointer,
        traces: resolveFindingTraces(finding, tracesById),
        remediation: getRuleProseV3(finding.ruleId).remediation,
      }));
    }
  }
  return Object.freeze({
    exitCode,
    profile: envelope.artifacts.profile,
    ...(topGrade === undefined ? {} : { grade: topGrade, score: topScore }),
    summary: envelope.summary,
    findings: Object.freeze(findings),
  });
}

export async function handleMcpRequest(request: unknown, options: HandlerOptions = {}): Promise<McpResponse | null> {
  if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return error(null, -32600, 'Invalid JSON-RPC request.');
  if (!Object.prototype.hasOwnProperty.call(request, 'id')) return null;
  const id = request.id;
  if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) return error(null, -32600, 'Invalid JSON-RPC request.');
  if (request.method === 'ping') return response(id, {});
  if (request.method === 'initialize') return response(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'n8n-secureflow-scanner', version: CLI_VERSION_V2 } });
  if (request.method === 'tools/list') return response(id, { tools: [TOOL] });
  if (request.method !== 'tools/call') return error(id, -32601, 'Method not found.');
  const argumentsValue = safeToolArguments(request.params);
  if (argumentsValue === null) return error(id, -32602, 'Invalid n8n_scan arguments.');
  try {
    const result = await executeMcpScan(argumentsValue, options);
    const text = result.stdout || result.stderr || JSON.stringify(result.document ?? {});
    return response(id, { content: [{ type: 'text', text }], isError: result.exitCode >= 2, structuredContent: buildStructuredContent(result.exitCode, result.envelope) });
  } catch {
    return error(id, -32603, 'MCP scan failed.');
  }
}

function safeToolArguments(params: unknown): ToolCallArguments | null {
  try { return toolArguments(params); } catch { return null; }
}

function divertConsoleToStderr(): () => void {
  const original = console;
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  return () => { globalThis.console = original; };
}

type LineEvent = Readonly<{ kind: 'line'; text: string }> | Readonly<{ kind: 'overflow' }>;

/** Linear byte reader: an over-limit line is discarded until newline, never retained. */
async function* boundedLines(input: NodeJS.ReadableStream, maxBytes: number): AsyncGenerator<LineEvent> {
  let chunks: Buffer[] = [];
  let length = 0;
  let overflow = false;
  let pendingCR = false;
  const append = (bytes: Buffer): void => {
    if (bytes.length === 0 || overflow) return;
    if (length + bytes.length > maxBytes) { overflow = true; chunks = []; length = 0; return; }
    chunks.push(bytes);
    length += bytes.length;
  };
  const take = (): LineEvent | undefined => {
    const wasOverflow = overflow;
    const text = wasOverflow || chunks.length === 0 ? undefined : Buffer.concat(chunks, length).toString('utf8');
    chunks = []; length = 0; overflow = false; pendingCR = false;
    if (wasOverflow) return { kind: 'overflow' };
    return text === undefined ? undefined : { kind: 'line', text };
  };
  for await (const raw of input as AsyncIterable<Buffer | string>) {
    const chunk = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      if (pendingCR) { if (index > start) append(Buffer.from('\r')); pendingCR = false; }
      const end = index > start && chunk[index - 1] === 0x0d ? index - 1 : index;
      append(chunk.subarray(start, end));
      const event = take();
      if (event) yield event;
      start = index + 1;
    }
    if (start < chunk.length) {
      const tail = chunk.subarray(start);
      if (pendingCR) { append(Buffer.from('\r')); pendingCR = false; }
      if (tail[tail.length - 1] === 0x0d) { append(tail.subarray(0, tail.length - 1)); pendingCR = true; } else append(tail);
    }
  }
  if (pendingCR) append(Buffer.from('\r'));
  const event = take();
  if (event) yield event;
}

export async function runMcpStdio(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const restoreConsole = divertConsoleToStderr();
  try {
    for await (const event of boundedLines(input, MCP_MAX_LINE_BYTES)) {
      if (event.kind === 'overflow') { output.write(`${JSON.stringify(error(null, -32700, 'Invalid JSON.'))}\n`); continue; }
      if (event.text.trim().length === 0) continue;
      let request: unknown;
      try { request = JSON.parse(event.text); } catch { output.write(`${JSON.stringify(error(null, -32700, 'Invalid JSON.'))}\n`); continue; }
      const result = await handleMcpRequest(request);
      if (result !== null) output.write(`${JSON.stringify(result)}\n`);
    }
  } finally {
    restoreConsole();
  }
}

function isMainEntry(): boolean {
  const candidate = process.argv[1];
  if (!candidate) return false;
  let resolved: string;
  try { resolved = realpathSync(candidate); } catch { return false; }
  return resolved === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainEntry()) await runMcpStdio();
