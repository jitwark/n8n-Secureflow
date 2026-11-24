import { parse, tokenizer } from 'acorn';
import type { AnalysisDiagnosticV2 } from '../../diagnostics/registry';
import { admitCandidate, createDiagnostic, makeFact } from '../../capabilities/adapter-evidence';
import type { AnalyzerContextV2, CapabilityCandidateV2, FindingCandidateV2, SafeFactV2 } from '../../capabilities/scheduler';
import type { SourceMemberRefV2 } from '../../source/source-types';
import type { SecurityNodeV2, SemanticFieldV2 } from '../../workflow-v2/security-workflow';
import { expressionIslands } from './expression-islands';
import {
  CONSTRUCTOR_NAME, ENV_ROOTS, EVAL_NAME, FUNCTION_NAME, GLOBAL_ROOTS, MODULES,
  PROCESS_NAME, PROCESS_SINKS, REQUIRE_NAME, hit,
  scanParsedExpressionAst, sortHits, type Ast, type ExpressionIndicatorHit,
} from './expression-escape-ast';

export type { ExpressionIndicatorHit, ExpressionIndicatorName, ExpressionRuleId } from './expression-escape-ast';
export type ExpressionIslandScanResult = Readonly<{ indicators: readonly ExpressionIndicatorHit[]; parseFailed: boolean; nodeLimited: boolean; tokenLimited: boolean }>;
type Token = { kind: 'ID' | 'STR' | 'PUNCT'; value: string; str?: string; start: number; end: number };

export const EXPRESSION_SECURITY_CAPABILITY_ID = 'expression-security';
export const MAX_EXPRESSION_SOURCE_BYTES = 100_000;
export const MAX_EXPRESSION_FINDINGS_PER_SOURCE = 10;

const DEFAULT_MAX_NODES = 250_000;
const DEFAULT_MAX_TOKENS = 100_000;
const CODE_NODE_TYPES = new Set(['n8n-nodes-base.code', 'n8n-nodes-base.function', 'n8n-nodes-base.functionItem']);
const REGEX_AFTER = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'new', 'in', 'of', 'yield', 'await', 'else', 'do']);

/** Scan one parameter string for expression sandbox escapes and env/secrets exposure. */
export function scanExpressionIslandsSecurity(text: string, maxNodes = DEFAULT_MAX_NODES, maxTokens = DEFAULT_MAX_TOKENS): ExpressionIslandScanResult {
  if (typeof text !== 'string' || text.length === 0 || !text.includes('{{')) {
    return Object.freeze({ indicators: Object.freeze([]), parseFailed: false, nodeLimited: false, tokenLimited: false });
  }
  const islands = expressionIslands(text, text.length);
  const indicators: ExpressionIndicatorHit[] = [];
  let parseFailed = islands.status === 'MALFORMED', nodeLimited = islands.status === 'LIMITED', tokenLimited = false;
  let remainingNodes = Math.max(0, maxNodes), remainingTokens = Math.max(0, maxTokens);
  for (const island of islands.islands) {
    const closed = island.endUtf16 - island.bodyEndUtf16 === 2;
    const scan = scanIsland(text.slice(island.bodyStartUtf16, island.bodyEndUtf16), island.bodyStartUtf16, !closed, remainingNodes, remainingTokens);
    remainingNodes = Math.max(0, remainingNodes - scan.visitedNodes);
    remainingTokens = Math.max(0, remainingTokens - scan.consumedTokens);
    if (scan.recovered) parseFailed = true;
    if (scan.nodeLimited) nodeLimited = true;
    if (scan.tokenLimited) tokenLimited = true;
    if (!scan.nodeLimited && !scan.tokenLimited) indicators.push(...scan.indicators);
  }
  return Object.freeze({ indicators: Object.freeze(sortHits(indicators).map((item) => Object.freeze({ ...item }))), parseFailed, nodeLimited, tokenLimited });
}

/** Evaluate expression sandbox escapes and env/secret exposure across all workflow node parameters. */
export function evaluateExpressionSecurity(context: AnalyzerContextV2): CapabilityCandidateV2 {
  const nodes = context.workflow.nodes;
  const facts: SafeFactV2[] = [], findings: FindingCandidateV2[] = [], diagnostics: AnalysisDiagnosticV2[] = [];
  const factIds = new Set<string>(), findingKeys = new Set<string>(), diagnosticIds = new Set<string>(), sourceCounts = new Map<string, number>();
  let omitted = 0, remainingTokens = context.limits.maxExpressionTokens, remainingNodes = context.limits.maxCodeSyntaxNodes, remainingWork = context.limits.maxSourceWork;
  const maxFindings = context.limits.maxFindings, perSourceCap = Math.min(MAX_EXPRESSION_FINDINGS_PER_SOURCE, maxFindings), encoder = new TextEncoder();

  const pushDiagnostic = (diagnostic: AnalysisDiagnosticV2): void => {
    if (diagnosticIds.has(diagnostic.id) || diagnostics.length >= context.limits.maxDiagnostics) return;
    diagnosticIds.add(diagnostic.id);
    diagnostics.push(diagnostic);
  };
  const recordOmission = (ref: SourceMemberRefV2, observed: number, maximum: number, count: number): void => {
    omitted += count;
    pushDiagnostic(createDiagnostic('OPTIONAL_LIMIT_EXCEEDED', EXPRESSION_SECURITY_CAPABILITY_ID, false, ref, { observed, maximum, omitted: count }));
  };

  for (const node of nodes) {
    for (const field of collectStringParameters(node, context.limits.maxParameterDepth, context.limits.maxParameterLeaves)) {
      if (!field.value.includes('{{')) continue;
      const ref = field.occurrences[0] ?? node.ref.source;
      const bytes = encoder.encode(field.value).length;
      if (bytes > MAX_EXPRESSION_SOURCE_BYTES) { recordOmission(ref, bytes, MAX_EXPRESSION_SOURCE_BYTES, 1); continue; }
      const workCap = Math.min(field.value.length, remainingWork);
      const islands = expressionIslands(field.value, workCap);
      remainingWork = Math.max(0, remainingWork - islands.work);
      if (islands.status === 'LIMITED') recordOmission(ref, field.value.length, workCap, 1);
      let parseFailed = false, limitHit = false, droppedHere = 0;

      for (const island of islands.islands) {
        const closed = island.endUtf16 - island.bodyEndUtf16 === 2;
        const scan = scanIsland(field.value.slice(island.bodyStartUtf16, island.bodyEndUtf16), island.bodyStartUtf16, !closed, remainingNodes, remainingTokens);
        remainingNodes = Math.max(0, remainingNodes - scan.visitedNodes);
        remainingTokens = Math.max(0, remainingTokens - scan.consumedTokens);
        if (scan.recovered) parseFailed = true;
        if (scan.nodeLimited || scan.tokenLimited) { limitHit = true; droppedHere += 1; continue; }
        for (const item of scan.indicators) {
          const sourceUsed = sourceCounts.get(ref.astNodeId) ?? 0;
          if (findings.length >= maxFindings || facts.length >= maxFindings || sourceUsed >= perSourceCap) { droppedHere += 1; continue; }
          const properties = { language: 'EXPRESSION', indicator: item.indicator, ...(item.member === undefined ? {} : { member: item.member }), start: item.start, end: item.end, parseState: item.parseState } as Record<string, string | number>;
          const fact = makeFact('code.indicator.v2', { kind: 'SOURCE', source: ref }, properties);
          const key = `${item.ruleId}:${fact.factId}`;
          if (findingKeys.has(key)) continue;
          findingKeys.add(key);
          if (!factIds.has(fact.factId)) { factIds.add(fact.factId); facts.push(fact); sourceCounts.set(ref.astNodeId, sourceUsed + 1); }
          findings.push({ ruleId: item.ruleId, evidenceClass: 'SUSPICIOUS_SYNTAX', conclusion: item.parseState === 'RECOVERED' ? 'POTENTIAL' : 'OBSERVED', applicability: 'APPLICABLE', subject: { kind: 'NODE', node: node.ref }, factRefs: [fact.factId], traceRefs: [], remediationId: 'r' });
        }
      }
      if (parseFailed) pushDiagnostic(createDiagnostic('EXPRESSION_PARSE_FAILED', EXPRESSION_SECURITY_CAPABILITY_ID, false, ref));
      if (limitHit || droppedHere > 0) { const count = Math.max(1, droppedHere); recordOmission(ref, count, limitHit ? 0 : perSourceCap, count); }
    }
  }
  return admitCandidate({ findings, diagnostics, facts, traces: [], seen: nodes.length, analyzed: nodes.length, skipped: 0, omitted });
}

function scanIsland(body: string, baseOffset: number, forceRecovered: boolean, maxNodes: number, maxTokens: number) {
  const tokens = countTokens(body, maxTokens);
  if (tokens.limited) return { indicators: [] as ExpressionIndicatorHit[], recovered: forceRecovered, nodeLimited: false, tokenLimited: true, visitedNodes: 0, consumedTokens: tokens.count };
  if (body.trim().length === 0) return { indicators: [] as ExpressionIndicatorHit[], recovered: forceRecovered, nodeLimited: false, tokenLimited: false, visitedNodes: 0, consumedTokens: tokens.count };
  const parsed = parseExpressionBody(body);
  if (parsed.root === undefined) return { indicators: recover(body, baseOffset), recovered: true, nodeLimited: false, tokenLimited: false, visitedNodes: 0, consumedTokens: tokens.count };
  const ast = scanParsedExpressionAst(parsed.root, baseOffset, parsed.offset, forceRecovered, maxNodes);
  return { indicators: ast.indicators, recovered: forceRecovered, nodeLimited: ast.nodeLimited, tokenLimited: false, visitedNodes: ast.visitedNodes, consumedTokens: tokens.count };
}

function countTokens(source: string, maxTokens: number): { count: number; limited: boolean } {
  let count = 0;
  try {
    const stream = tokenizer(source, { ecmaVersion: 'latest' });
    for (;;) { const t = stream.getToken(); if (t.type.label === 'eof') return { count, limited: false }; if (++count > maxTokens) return { count, limited: true }; }
  } catch { return maxTokens === 0 && source.trim().length > 0 ? { count: 1, limited: true } : { count, limited: false }; }
}

function parseExpressionBody(body: string): { root?: Ast; offset: number } {
  try { return { root: parse(`(${body})`, { ecmaVersion: 'latest' }) as unknown as Ast, offset: 1 }; } catch { /* fallback */ }
  try { return { root: parse(body, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }) as unknown as Ast, offset: 0 }; } catch { /* fallback */ }
  const prefix = 'async function __expr__() {\n';
  try { return { root: parse(`${prefix}${body}\n}`, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }) as unknown as Ast, offset: prefix.length }; } catch { return { offset: 0 }; }
}

function collectStringParameters(node: SecurityNodeV2, maxDepth: number, maxLeaves: number): Array<{ value: string; occurrences: readonly SourceMemberRefV2[] }> {
  const isCodeNode = CODE_NODE_TYPES.has(node.type);
  const stack: Array<{ field: SemanticFieldV2; depth: number }> = [];
  for (let i = node.parameters.length - 1; i >= 0; i -= 1) stack.push({ field: node.parameters[i]!, depth: 0 });
  const out: Array<{ value: string; occurrences: readonly SourceMemberRefV2[] }> = [];
  let visitedLeaves = 0;
  while (stack.length) {
    const { field, depth } = stack.pop()!;
    if (Array.isArray(field.value)) {
      if (depth >= maxDepth) continue;
      for (let i = field.value.length - 1; i >= 0; i -= 1) stack.push({ field: field.value[i]!, depth: depth + 1 });
      continue;
    }
    if (++visitedLeaves > maxLeaves) break;
    if (typeof field.value !== 'string') continue;
    if (isCodeNode && field.classification === 'CODE' && !field.value.startsWith('=')) continue;
    out.push({ value: field.value, occurrences: field.occurrences });
  }
  return out;
}

function recover(source: string, baseOffset: number): ExpressionIndicatorHit[] {
  const tokens = lex(source), out: ExpressionIndicatorHit[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1], next2 = tokens[i + 2];
    if (t.value === EVAL_NAME && next?.value === '(') out.push(hit('EXPRESSION_SANDBOX_ESCAPE', 'EVAL', EVAL_NAME, span(t.start, next2?.end ?? t.end + 1), baseOffset, 0, 'RECOVERED'));
    else if (t.value === FUNCTION_NAME && next?.value === '(') out.push(hit('EXPRESSION_SANDBOX_ESCAPE', 'FUNCTION_CONSTRUCTOR', FUNCTION_NAME, span(t.start, next2?.end ?? t.end + 1), baseOffset, 0, 'RECOVERED'));
    else if (t.value === REQUIRE_NAME && next?.value === '(') {
      const bare = next2?.kind === 'STR' && next2.str ? (next2.str.startsWith('node:') ? next2.str.slice(5) : next2.str) : undefined;
      const k = bare ? MODULES[bare] : undefined;
      out.push(hit('EXPRESSION_SANDBOX_ESCAPE', k ? `${k}_REQUIRE` : 'DYNAMIC_IMPORT', REQUIRE_NAME, span(t.start, next2?.end ?? t.end + 1), baseOffset, 0, 'RECOVERED'));
    } else if (t.value === CONSTRUCTOR_NAME && (next?.value === '.' || next?.value === '[') && (next2?.value === CONSTRUCTOR_NAME || next2?.str === CONSTRUCTOR_NAME)) {
      out.push(hit('EXPRESSION_SANDBOX_ESCAPE', 'FUNCTION_CONSTRUCTOR', CONSTRUCTOR_NAME, span(t.start, next2.end), baseOffset, 0, 'RECOVERED'));
    } else if ((t.value === 'this' || GLOBAL_ROOTS.has(t.value)) && next?.value === '.' && next2?.value === PROCESS_NAME) {
      out.push(hit('EXPRESSION_SANDBOX_ESCAPE', 'EXEC', PROCESS_NAME, span(t.start, next2.end), baseOffset, 0, 'RECOVERED'));
    } else if (t.value === PROCESS_NAME && next?.value === '.' && next2 && PROCESS_SINKS.has(next2.value)) {
      out.push(hit('EXPRESSION_SANDBOX_ESCAPE', 'EXEC', next2.value, span(t.start, next2.end), baseOffset, 0, 'RECOVERED'));
    } else if (ENV_ROOTS.has(t.value) && tokens[i - 1]?.value !== '.' && tokens[i - 1]?.value !== '?.') {
      out.push(hit('EXPRESSION_ENV_EXPOSURE', 'SECRET_ACCESS', t.value, span(t.start, t.end), baseOffset, 0, 'RECOVERED'));
    } else if (t.value === PROCESS_NAME && next?.value === '.' && next2?.value === 'env') {
      out.push(hit('EXPRESSION_ENV_EXPOSURE', 'ENVIRONMENT_ACCESS', 'env', span(t.start, next2.end), baseOffset, 0, 'RECOVERED'));
    }
  }
  return sortHits(out);
}

function lex(source: string): Token[] {
  const out: Token[] = []; let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { const nl = source.indexOf('\n', i + 2); i = nl < 0 ? source.length : nl + 1; continue; }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    if (ch === '/' && (out.length === 0 || '=([{,:;!&|?+-*%^~<>'.includes(out.at(-1)!.value) || REGEX_AFTER.has(out.at(-1)!.value))) { i = skipRegex(source, i); continue; }
    if (ch === "'" || ch === '"' || ch === '`') { const start = i++; while (i < source.length) { if (source[i] === '\\') { i += 2; continue; } if (source[i] === ch) { i += 1; break; } i += 1; } out.push({ kind: 'STR', value: 'STR', str: source.slice(start + 1, Math.max(start + 1, i - 1)), start, end: i }); continue; }
    if (ch === '?' && source[i + 1] === '.') { out.push({ kind: 'PUNCT', value: '?.', start: i, end: i + 2 }); i += 2; continue; }
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i));
    if (match) { out.push({ kind: 'ID', value: match[0], start: i, end: i + match[0].length }); i += match[0].length; continue; }
    out.push({ kind: 'PUNCT', value: ch, start: i, end: i + 1 }); i += 1;
  }
  return out;
}

function skipRegex(source: string, start: number): number { let i = start + 1, esc = false, cls = false; while (i < source.length) { const c = source[i]!; if (!esc && c === '[') cls = true; else if (!esc && c === ']') cls = false; else if (!esc && c === '/' && !cls) return i + 1; else if (c === '\n') return i; esc = !esc && c === '\\'; i += 1; } return source.length; }
function span(start: number, end: number): { start: number; end: number } { return { start, end }; }
