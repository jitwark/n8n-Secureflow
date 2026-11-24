import { parser } from '@lezer/python';
import type { NormalizedWorkflow, NormalizedWorkflowNode } from '../../workflow';
import type { AnalysisDiagnostic, ScanFinding } from '../../policy/policy';
import { selectExecutableCode } from './embedded-code-sources';
import { nodeFinding } from '../../policy/policy-helpers';

export const MAX_PYTHON_SOURCE_BYTES = 100_000;
export const MAX_PYTHON_CST_NODES = 10_000;
const MAX_FINDINGS_PER_SOURCE = 10;
const SUBPROCESS_METHODS = new Set(['run', 'Popen', 'call', 'check_call', 'check_output']);
type CallIndicator = { indicator: string; member?: string };
type Binding = { module: 'subprocess' | 'os' | 'importlib'; member?: string };
type BindingEvent = { at: number; binding: Binding | null };
type BindingScope = { from: number; to: number; parent?: BindingScope; children: BindingScope[]; bindings: Map<string, BindingEvent[]> };
type CstNode = { name: string; from: number; to: number; type: { isError: boolean }; firstChild: CstNode | null; nextSibling: CstNode | null };
export type PythonAnalysisResult = { findings: ScanFinding[]; diagnostics: AnalysisDiagnostic[] };

export function analyzeWorkflowPython(workflow: NormalizedWorkflow): PythonAnalysisResult { return workflow.nodes.reduce<PythonAnalysisResult>((result, node) => analyzeNode(node, result), { findings: [], diagnostics: [] }); }
function analyzeNode(node: NormalizedWorkflowNode, result: PythonAnalysisResult): PythonAnalysisResult {
  const selection = selectExecutableCode(node);
  // UNSUPPORTED_VARIANT is language-agnostic and reported once by the JavaScript analyzer.
  if (selection.kind === 'UNSUPPORTED_VARIANT' || selection.kind === 'NOT_A_CODE_NODE') return result;
  if (selection.language !== 'python') return result;
  if (selection.kind === 'SOURCE_UNAVAILABLE') return addDiagnostic(result, 'PYTHON_SOURCE_UNAVAILABLE', 'SOURCE', node);
  const source = selection.source;
  if (new TextEncoder().encode(source).length > MAX_PYTHON_SOURCE_BYTES) return addDiagnostic(result, 'ANALYSIS_LIMIT_EXCEEDED', 'LIMIT', node);
  try {
    const analysis = analyzeTree(parser.parse(source).cursor().node as unknown as CstNode, source, node);
    result.findings.push(...analysis.findings);
    if (analysis.parseFailed) return addDiagnostic(result, 'PYTHON_PARSE_FAILED', 'PARSER', node);
    return analysis.limitExceeded ? addDiagnostic(result, 'ANALYSIS_LIMIT_EXCEEDED', 'LIMIT', node) : result;
  } catch { return addDiagnostic(result, 'PYTHON_PARSE_FAILED', 'PARSER', node); }
}
function analyzeTree(root: CstNode, source: string, node: NormalizedWorkflowNode) {
  const findings: ScanFinding[] = [], bindings = collectBindings(root, source);
  const stack: Array<{ node: CstNode; skipMember?: boolean; skipVar?: boolean }> = [{ node: root }];
  let visited = 0, parseFailed = false, findingLimitExceeded = false;
  while (stack.length > 0) {
    const entry = stack.pop(); if (!entry) continue;
    const current = entry.node;
    visited += 1; if (visited > MAX_PYTHON_CST_NODES) return { findings, parseFailed, limitExceeded: true };
    if (current.type.isError) parseFailed = true;
    let indicator: CallIndicator | undefined;
    let matchedCall = false;
    if (current.name === 'CallExpression') {
      indicator = indicatorForCall(current, source, bindings);
      matchedCall = indicator !== undefined;
    } else if (current.name === 'MemberExpression' && !entry.skipMember) {
      indicator = indicatorForMember(current, source, bindings);
    } else if (current.name === 'VariableName' && !entry.skipVar) {
      indicator = indicatorForVar(current, source, bindings);
    }
    if (indicator) { if (findings.length < MAX_FINDINGS_PER_SOURCE) findings.push(createFinding(node, current, indicator)); else findingLimitExceeded = true; }
    pushChildren(stack, current, matchedCall);
  }
  return { findings, parseFailed, limitExceeded: findingLimitExceeded };
}
function pushChildren(stack: Array<{ node: CstNode; skipMember?: boolean; skipVar?: boolean }>, current: CstNode, matchedCall: boolean): void {
  const children = directChildren(current), skipVars = nonReadVariableIndices(current, children);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]!;
    const skipMember = current.name === 'CallExpression' && matchedCall && index === 0;
    const skipVar = skipVars.has(index) || (current.name === 'MemberExpression' && index === 0) || (current.name === 'CallExpression' && index === 0 && child.name === 'VariableName');
    stack.push({ node: child, ...(skipMember ? { skipMember: true } : {}), ...(skipVar ? { skipVar: true } : {}) });
  }
}
function nonReadVariableIndices(current: CstNode, children: CstNode[]): Set<number> {
  const skip = new Set<number>();
  if (current.name === 'ImportStatement' || current.name === 'DeleteStatement' || current.name === 'GlobalStatement' || current.name === 'NonlocalStatement') {
    children.forEach((_child, index) => skip.add(index));
    return skip;
  }
  if (current.name === 'FunctionDefinition' || current.name === 'ClassDefinition') {
    const nameIndex = children.findIndex((child) => child.name === 'VariableName');
    if (nameIndex >= 0) skip.add(nameIndex);
  } else if (current.name === 'AssignStatement') {
    const opIndex = children.findIndex((child) => child.name === 'AssignOp' || child.name === 'UpdateOp');
    for (let index = 0; index < (opIndex < 0 ? 1 : opIndex); index += 1) if (children[index]?.name === 'VariableName') skip.add(index);
  } else if (current.name === 'ForStatement') {
    const inIndex = children.findIndex((child) => child.name === 'in');
    for (let index = 0; index < inIndex; index += 1) if (children[index]?.name === 'VariableName') skip.add(index);
  } else if (current.name === 'ParamList') {
    children.forEach((child, index) => { if (child.name === 'VariableName' && children[index - 1]?.name !== 'AssignOp') skip.add(index); });
  } else if (current.name === 'ArgList') {
    children.forEach((child, index) => { if (child.name === 'VariableName' && children[index + 1]?.name === 'AssignOp') skip.add(index); });
  }
  children.forEach((child, index) => { if (child.name === 'VariableName' && children[index - 1]?.name === 'as') skip.add(index); });
  return skip;
}
function indicatorForVar(varNode: CstNode, source: string, bindings: BindingScope): CallIndicator | undefined {
  const binding = bindingAt(bindings, source.slice(varNode.from, varNode.to), varNode.from);
  return binding?.module === 'os' && binding.member === 'environ' ? { indicator: 'ENVIRONMENT_ACCESS', member: 'environ' } : undefined;
}
function indicatorForMember(memberNode: CstNode, source: string, bindings: BindingScope): CallIndicator | undefined {
  const [module, operator, property] = directChildren(memberNode);
  if (!module || !operator || module.name !== 'VariableName') return undefined;
  const binding = bindingAt(bindings, source.slice(module.from, module.to), module.from);
  if (binding?.module === 'os' && binding.member === 'environ') return { indicator: 'ENVIRONMENT_ACCESS', member: 'environ' };
  if (operator.name !== '.' || !property) return undefined;
  const member = source.slice(property.from, property.to), moduleName = resolveModuleName(module, source, bindings);
  return moduleName === 'os' && (member === 'environ' || member === 'getenv') ? { indicator: 'ENVIRONMENT_ACCESS', member } : undefined;
}
function indicatorForCall(call: CstNode, source: string, bindings: BindingScope): CallIndicator | undefined {
  const [callee, args] = directChildren(call); if (!callee || !args || args.name !== 'ArgList') return undefined;
  if (callee.name === 'VariableName') {
    const name = source.slice(callee.from, callee.to), binding = bindingAt(bindings, name, callee.from);
    if (binding === undefined) { if (name === 'eval') return { indicator: 'EVAL' }; if (name === 'exec') return { indicator: 'EXEC' }; if (name === '__import__') return { indicator: 'DYNAMIC_IMPORT' }; }
    if (binding?.module === 'importlib' && binding.member === 'import_module') return { indicator: 'DYNAMIC_IMPORT' };
    if (binding?.module === 'os' && (binding.member === 'getenv' || binding.member === 'environ')) return { indicator: 'ENVIRONMENT_ACCESS', member: binding.member };
    const importedMember = processBinding(binding); return importedMember ? { indicator: 'SHELL_SUBPROCESS', member: importedMember } : undefined;
  }
  const getattrMember = staticGetattrMember(callee, source, bindings);
  if (getattrMember === 'getenv' || getattrMember === 'environ') return { indicator: 'ENVIRONMENT_ACCESS', member: getattrMember };
  if (getattrMember) return { indicator: 'SHELL_SUBPROCESS', member: getattrMember };
  if (isDynamicImportMember(callee, source, bindings)) return { indicator: 'DYNAMIC_IMPORT' };
  const envMember = environmentCallMember(callee, source, bindings);
  if (envMember) return { indicator: 'ENVIRONMENT_ACCESS', member: envMember };
  const member = processMember(callee, source, bindings); return member ? { indicator: 'SHELL_SUBPROCESS', member } : undefined;
}
function environmentCallMember(callee: CstNode, source: string, bindings: BindingScope): string | undefined {
  if (callee.name !== 'MemberExpression') return undefined;
  const [module, operator, property] = directChildren(callee);
  if (!module || !operator || !property || operator.name !== '.' || module.name !== 'VariableName') return undefined;
  const binding = bindingAt(bindings, source.slice(module.from, module.to), module.from);
  if (binding?.module === 'os' && binding.member === 'environ') return 'environ';
  const member = source.slice(property.from, property.to), moduleName = resolveModuleName(module, source, bindings);
  return moduleName === 'os' && (member === 'getenv' || member === 'environ') ? member : undefined;
}
function processMember(callee: CstNode, source: string, bindings: BindingScope): string | undefined {
  if (callee.name !== 'MemberExpression') return undefined;
  const [module, , property] = directChildren(callee); if (!module || !property) return undefined;
  const member = source.slice(property.from, property.to), moduleName = resolveModuleName(module, source, bindings);
  if (moduleName === 'subprocess' && SUBPROCESS_METHODS.has(member)) return member;
  if (moduleName === 'os' && isOsProcessMember(member)) return member;
  return undefined;
}
function staticGetattrMember(callee: CstNode, source: string, bindings: BindingScope): string | undefined {
  if (callee.name !== 'CallExpression') return undefined;
  const [getattr, args] = directChildren(callee); if (!getattr || !args || getattr.name !== 'VariableName' || source.slice(getattr.from, getattr.to) !== 'getattr') return undefined;
  if (bindingAt(bindings, 'getattr', getattr.from) !== undefined) return undefined;
  const values = directChildren(args).filter((child) => child.name === 'VariableName' || child.name === 'String' || child.name === 'BinaryExpression'); if (values.length !== 2) return undefined;
  const moduleName = resolveModuleName(values[0], source, bindings), member = staticString(values[1], source);
  return member && ((moduleName === 'subprocess' && SUBPROCESS_METHODS.has(member)) || (moduleName === 'os' && (isOsProcessMember(member) || member === 'getenv' || member === 'environ'))) ? member : undefined;
}
function isDynamicImportMember(callee: CstNode, source: string, bindings: BindingScope): boolean {
  if (callee.name !== 'MemberExpression') return false;
  const [module, , property] = directChildren(callee); return !!module && !!property && source.slice(property.from, property.to) === 'import_module' && resolveModuleName(module, source, bindings) === 'importlib';
}
function resolveModuleName(node: CstNode, source: string, bindings: BindingScope): Binding['module'] | undefined {
  const name = source.slice(node.from, node.to), binding = bindingAt(bindings, name, node.from); if (binding === null || binding?.member) return undefined;
  return binding?.module ?? (name === 'subprocess' || name === 'os' || name === 'importlib' ? name : undefined);
}
function staticString(node: CstNode, source: string, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (node.name === 'String') { const raw = source.slice(node.from, node.to); return raw.length >= 2 && raw[0] === raw[raw.length - 1] ? raw.slice(1, -1) : undefined; }
  if (node.name !== 'BinaryExpression') return undefined;
  const [leftNode, operator, rightNode] = directChildren(node); if (!leftNode || !operator || !rightNode || operator.name !== 'ArithOp' || source.slice(operator.from, operator.to) !== '+') return undefined;
  const left = staticString(leftNode, source, depth + 1), right = staticString(rightNode, source, depth + 1); return left !== undefined && right !== undefined && left.length + right.length <= 256 ? left + right : undefined;
}
function processBinding(binding: Binding | null | undefined): string | undefined {
  if (!binding?.member) return undefined;
  return (binding.module === 'subprocess' && SUBPROCESS_METHODS.has(binding.member)) || (binding.module === 'os' && isOsProcessMember(binding.member)) ? binding.member : undefined;
}
function isOsProcessMember(member: string): boolean { return member === 'system' || member === 'popen' || /^(?:exec(?:l|le|lp|lpe|v|ve|vp|vpe)|spawn(?:l|le|lp|lpe|v|ve|vp|vpe)|posix_spawnp?)$/.test(member); }
function collectBindings(root: CstNode, source: string): BindingScope {
  const bindings: BindingScope = { from: root.from, to: root.to, bindings: new Map(), children: [] }, stack = [{ node: root, scope: bindings }]; let visited = 0;
  while (stack.length > 0 && visited <= MAX_PYTHON_CST_NODES) {
    const item = stack.pop(); if (!item) continue;
    const { node: current, scope } = item; visited += 1;
    if (current.name === 'FunctionDefinition' || current.name === 'ClassDefinition' || current.name === 'LambdaExpression') {
      if (current.name !== 'LambdaExpression') {
        const name = directChildren(current).find((child) => child.name === 'VariableName');
        if (name) addBinding(scope.bindings, source.slice(name.from, name.to), current.from, null);
      }
      const childScope: BindingScope = { from: current.from, to: current.to, parent: scope, bindings: new Map(), children: [] };
      scope.children.push(childScope);
      stack.push(...directChildren(current).reverse().map((node) => ({ node, scope: childScope })));
      continue;
    }
    if (current.name === 'ImportStatement') registerImport(current, source, scope.bindings);
    if (current.name === 'AssignStatement' || current.name === 'ForStatement' || current.name === 'ParamList' || current.name === 'WithStatement') {
      const children = directChildren(current);
      for (const index of nonReadVariableIndices(current, children)) { const child = children[index]; if (child?.name === 'VariableName') addBinding(scope.bindings, source.slice(child.from, child.to), current.from, null); }
    }
    stack.push(...directChildren(current).reverse().map((node) => ({ node, scope })));
  }
  return bindings;
}
function registerImport(statement: CstNode, source: string, bindings: Map<string, BindingEvent[]>): void {
  const children = directChildren(statement), keyword = children.findIndex((child) => child.name === 'import'); if (keyword < 0) return;
  const from = children.findIndex((child) => child.name === 'from'), importedModule = children[from + 1];
  if (importedModule?.name === 'VariableName') registerImportedNames(children.slice(keyword + 1), source, bindings, source.slice(importedModule.from, importedModule.to), statement.from); else registerImportedModules(children.slice(keyword + 1), source, bindings, statement.from);
}
function registerImportedModules(children: CstNode[], source: string, bindings: Map<string, BindingEvent[]>, at: number): void {
  for (let index = 0; index < children.length;) {
    if (children[index]?.name !== 'VariableName') { index += 1; continue; }
    const parts = [source.slice(children[index]!.from, children[index]!.to)]; index += 1;
    while (children[index]?.name === '.' && children[index + 1]?.name === 'VariableName') { parts.push(source.slice(children[index + 1]!.from, children[index + 1]!.to)); index += 2; }
    let local = parts[0]!, moduleName = parts[0]!;
    if (children[index]?.name === 'as' && children[index + 1]?.name === 'VariableName') { local = source.slice(children[index + 1]!.from, children[index + 1]!.to); moduleName = parts.join('.'); index += 2; }
    registerBinding(bindings, local, moduleName, undefined, at);
  }
}
function registerImportedNames(children: CstNode[], source: string, bindings: Map<string, BindingEvent[]>, moduleName: string, at: number): void {
  let imported: string | undefined;
  for (let index = 0; index < children.length; index += 1) { const child = children[index]; if (child.name !== 'VariableName') continue; const name = source.slice(child.from, child.to); if (children[index - 1]?.name === 'as') { if (imported) registerBinding(bindings, name, moduleName, imported, at); imported = undefined; } else if (imported) { registerBinding(bindings, imported, moduleName, imported, at); imported = name; } else imported = name; }
  if (imported) registerBinding(bindings, imported, moduleName, imported, at);
}
function registerBinding(bindings: Map<string, BindingEvent[]>, name: string, moduleName: string | undefined, imported: string | undefined, at: number): void {
  const supported = (moduleName === 'subprocess' || moduleName === 'os' || moduleName === 'importlib') && !(imported && moduleName === 'importlib' && imported !== 'import_module');
  addBinding(bindings, name, at, supported ? { module: moduleName as Binding['module'], ...(imported ? { member: imported } : {}) } : null);
}
function addBinding(bindings: Map<string, BindingEvent[]>, name: string, at: number, binding: Binding | null): void { const events = bindings.get(name) ?? []; events.push({ at, binding }); bindings.set(name, events); }
function bindingAt(root: BindingScope, name: string, at: number): Binding | null | undefined {
  let scope: BindingScope | undefined = scopeAt(root, at);
  while (scope) { const events = scope.bindings.get(name); let latest: Binding | null | undefined; for (const event of events ?? []) { if (event.at > at) break; latest = event.binding; } if (latest !== undefined) return latest; scope = scope.parent; }
  return undefined;
}
function scopeAt(scope: BindingScope, at: number): BindingScope { const child = scope.children.find(({ from, to }) => at >= from && at < to); return child ? scopeAt(child, at) : scope; }
function createFinding(node: NormalizedWorkflowNode, ast: CstNode, { indicator, member }: CallIndicator): ScanFinding {
  return nodeFinding({
    policyId: 'PYTHON_DYNAMIC_EXECUTION', title: 'Custom Python uses a dynamic execution primitive', severity: 'HIGH', node,
    evidence: { indicator, ...(member ? { member } : {}), start: ast.from, end: ast.to }, message: 'Custom Python uses a dynamic execution primitive.',
    explanation: 'The parser found a direct dynamic-code or shell-subprocess structure.',
    whyItMatters: 'Dynamic execution makes code review less reliable and may expand workflow runtime capabilities.',
    possibleImpact: 'Unsafe runtime configuration or untrusted input could lead to unexpected code or command execution.',
    remediation: 'Replace dynamic execution with reviewed static logic and avoid shell invocation from workflow code.',
    remediationSteps: ['Replace dynamic execution with reviewed static logic.', 'Use reviewed services instead of shell invocation from workflow code.'], confidence: 'MEDIUM',
  });
}
function directChildren(node: CstNode): CstNode[] { const children: CstNode[] = []; for (let child = node.firstChild; child; child = child.nextSibling) children.push(child); return children; }
function addDiagnostic(result: PythonAnalysisResult, code: AnalysisDiagnostic['code'], category: AnalysisDiagnostic['category'], node: NormalizedWorkflowNode): PythonAnalysisResult { result.diagnostics.push({ code, category, location: { path: node.sourcePath } }); return result; }
