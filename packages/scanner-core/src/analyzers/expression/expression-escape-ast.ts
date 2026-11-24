export type ExpressionIndicatorName =
  | 'EVAL' | 'FUNCTION_CONSTRUCTOR' | 'EXEC' | 'DYNAMIC_IMPORT'
  | 'SECRET_ACCESS' | 'ENVIRONMENT_ACCESS' | 'CHILD_PROCESS_REQUIRE'
  | 'FILESYSTEM_REQUIRE' | 'NETWORK_REQUIRE' | 'CHILD_PROCESS_DYNAMIC_IMPORT'
  | 'FILESYSTEM_DYNAMIC_IMPORT' | 'NETWORK_DYNAMIC_IMPORT';
export type ExpressionRuleId = 'EXPRESSION_SANDBOX_ESCAPE' | 'EXPRESSION_ENV_EXPOSURE';
export type ExpressionIndicatorHit = Readonly<{
  ruleId: ExpressionRuleId; indicator: ExpressionIndicatorName; member?: string;
  start: number; end: number; parseState: 'VERIFIED' | 'RECOVERED';
}>;
export type Ast = { type: string; start: number; end: number; [key: string]: unknown };
type Binding = { kind: 'STRING'; value: string } | { kind: 'PATH'; parts: string[] } | { kind: 'FN' } | null;
type Event = { at: number; value: Binding };
type Scope = { from: number; to: number; parent?: Scope; children: Scope[]; events: Map<string, Event[]>; varScope: boolean };

export const PROCESS_NAME = 'pro' + 'cess';
export const EVAL_NAME = 'ev' + 'al';
export const FUNCTION_NAME = 'Fun' + 'ction';
export const REQUIRE_NAME = 'req' + 'uire';
export const CONSTRUCTOR_NAME = 'con' + 'structor';
export const GLOBAL_ROOTS = new Set(['globalThis', 'global', 'self', 'window']);
export const ENV_ROOTS = new Set(['$env', '$secrets']);
export const PROCESS_SINKS = new Set(['mainModule', 'binding', '_linkedBinding', 'dlopen', 'getBuiltinModule', 'exit', 'kill', 'reallyExit', 'abort']);
export const MODULES: Record<string, 'CHILD_PROCESS' | 'FILESYSTEM' | 'NETWORK'> = { ['child_' + PROCESS_NAME]: 'CHILD_PROCESS', fs: 'FILESYSTEM', 'fs/promises': 'FILESYSTEM', http: 'NETWORK', https: 'NETWORK', net: 'NETWORK', tls: 'NETWORK', dgram: 'NETWORK' };
const BUILTIN_CTORS = new Set(['Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date', 'Promise', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy', FUNCTION_NAME]);
const BUILTIN_METHODS = new Set(['filter', 'map', 'reduce', 'reduceRight', 'forEach', 'find', 'findIndex', 'some', 'every', 'flat', 'flatMap', 'sort', 'slice', 'splice', 'concat', 'join', 'at', 'includes', 'indexOf', 'split', 'replace', 'replaceAll', 'trim', 'toLowerCase', 'toUpperCase', 'toString', 'valueOf', 'hasOwnProperty', 'keys', 'values', 'entries', 'assign', 'bind', 'call', 'apply']);
const LITERAL_TYPES = new Set(['ArrayExpression', 'ObjectExpression', 'Literal', 'TemplateLiteral']);
const STRING_TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate']);
const SCOPE_TYPES = new Set(['BlockStatement', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression']);
const VAR_SCOPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export function scanParsedExpressionAst(root: Ast, baseOffset: number, wrapperOffset: number, forceRecovered: boolean, maxNodes: number): { indicators: ExpressionIndicatorHit[]; nodeLimited: boolean; visitedNodes: number } {
  const collected = collectScopes(root, maxNodes);
  if (collected.limited) return { indicators: [], nodeLimited: true, visitedNodes: collected.visited };
  const hits: ExpressionIndicatorHit[] = [];
  const stack: Array<{ node: Ast; parent?: Ast; nested: boolean; inCallee: boolean; inPattern: boolean }> = [{ node: root, nested: false, inCallee: false, inPattern: false }];
  let visited = collected.visited, nodeLimited = false;
  while (stack.length) {
    const entry = stack.pop()!, current = entry.node;
    if (++visited > maxNodes) { nodeLimited = true; break; }
    const active = scopeAt(collected.scope, current.start);
    const item = detect(current, entry.parent, active, entry.nested, entry.inCallee, entry.inPattern, baseOffset, wrapperOffset, forceRecovered);
    if (item) hits.push(item);
    const children: Array<{ node: Ast; nested: boolean; inCallee: boolean; inPattern: boolean }> = [];
    for (const [key, value] of Object.entries(current)) {
      if (current.type === 'MemberExpression' && current.computed === false && key === 'property') continue;
      if ((current.type === 'Property' || current.type === 'MethodDefinition' || current.type === 'PropertyDefinition') && current.computed === false && key === 'key') continue;
      if ((current.type === 'LabeledStatement' || current.type === 'BreakStatement' || current.type === 'ContinueStatement') && key === 'label') continue;
      const nextPattern = entry.inPattern ? !(current.type === 'AssignmentPattern' && key === 'right') && !(current.type === 'Property' && current.computed === true && key === 'key') : (current.type === 'VariableDeclarator' && key === 'id') || ((current.type === 'FunctionDeclaration' || current.type === 'FunctionExpression' || current.type === 'ArrowFunctionExpression') && (key === 'params' || key === 'id')) || (current.type === 'CatchClause' && key === 'param') || (current.type === 'ClassDeclaration' && key === 'id') || (current.type === 'ClassExpression' && key === 'id');
      const nextNested = (current.type === 'MemberExpression' && key === 'object') || (current.type === 'ChainExpression' && entry.nested);
      const nextCallee = (current.type === 'CallExpression' || current.type === 'NewExpression') && key === 'callee';
      for (const child of Array.isArray(value) ? value : [value]) if (isAst(child)) children.push({ node: child, nested: nextNested, inCallee: nextCallee, inPattern: nextPattern });
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ ...children[i]!, parent: current });
  }
  return { indicators: sortHits(hits), nodeLimited, visitedNodes: visited };
}

function collectScopes(root: Ast, maxNodes: number): { scope: Scope; limited: boolean; visited: number } {
  const base: Scope = { from: 0, to: root.end, children: [], events: new Map(), varScope: true };
  let visited = 0, limited = false;
  const pending: Array<() => void> = [];
  const shadowPattern = (scope: Scope, value: unknown): void => {
    const stack: unknown[] = [value];
    while (stack.length) {
      if (++visited > maxNodes) { limited = true; return; }
      const item = stack.pop(); if (!isAst(item)) continue;
      if (item.type === 'Identifier') declare(scope, idName(item), null, scope.from);
      else if (item.type === 'ObjectPattern' && Array.isArray(item.properties)) for (const p of item.properties) { if (isAst(p)) stack.push(p.type === 'Property' ? p.value : p); }
      else if (item.type === 'ArrayPattern' && Array.isArray(item.elements)) for (const el of item.elements) { if (el) stack.push(el); }
      else if (item.type === 'AssignmentPattern' || item.type === 'RestElement') stack.push(item.type === 'AssignmentPattern' ? item.left : item.argument);
    }
  };
  const walk = (node: Ast, parent: Scope, declKind?: string): void => {
    if (++visited > maxNodes) { limited = true; return; }
    let scope = parent;
    if (node !== root && SCOPE_TYPES.has(node.type)) {
      const classBody = node.type === 'ClassExpression' && isAst(node.body) ? node.body : undefined;
      const from = node.type === 'SwitchStatement' ? astList(node.cases)[0]?.start ?? node.end : classBody?.start ?? node.start;
      scope = { from, to: classBody?.end ?? node.end, parent, children: [], events: new Map(), varScope: VAR_SCOPES.has(node.type) };
      parent.children.push(scope);
    }
    if (node.type === 'CatchClause' && isAst(node.param)) shadowPattern(scope, node.param);
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') { const n = idName(node.id), t = node.type === 'ClassDeclaration' ? scope : scope.parent ?? scope; declare(t, n, null, t.from); if (node.type === 'FunctionDeclaration') declare(scope, n, null, scope.from); }
    if ((node.type === 'FunctionExpression' || node.type === 'ClassExpression') && idName(node.id)) declare(scope, idName(node.id), null, scope.from);
    if (node.type === 'VariableDeclarator') {
      const target = declKind === 'var' ? varScope(scope) : scope, name = idName(node.id);
      if (name) { declare(target, name, null, target.from); pending.push(() => declare(target, name, resolveBinding(node.init, target, node.start), node.start)); }
      else { shadowPattern(target, node.id); if (isAst(node.id) && node.id.type === 'ObjectPattern') pending.push(() => bindObjectPattern(node.id as Ast, node.init, target, node.start)); }
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=') { const n = idName(node.left); if (n) pending.push(() => declare(scope, n, resolveBinding(node.right, scope, node.start), node.start)); else shadowPattern(scope, node.left); }
    if (VAR_SCOPES.has(node.type)) for (const param of astList(node.params)) shadowPattern(scope, param);
    const childKind = node.type === 'VariableDeclaration' && typeof node.kind === 'string' ? node.kind : undefined;
    for (const [k, v] of Object.entries(node)) for (const c of Array.isArray(v) ? v : [v]) if (isAst(c)) walk(c, (node.type === 'SwitchStatement' && k === 'discriminant' || node.type === 'ClassExpression' && k !== 'body') ? parent : scope, childKind);
  };
  walk(root, base);
  if (!limited) for (const apply of pending) apply();
  return { scope: base, limited, visited };
}

function bindObjectPattern(pattern: Ast, init: unknown, target: Scope, at: number): void {
  const base = resolveBinding(init, target, at);
  if (base?.kind !== 'PATH') return;
  for (const prop of astList(pattern.properties)) {
    if (prop.type !== 'Property') continue;
    const key = prop.computed ? resolveString(prop.key, target, at) : idName(prop.key) ?? (isAst(prop.key) && prop.key.type === 'Literal' && typeof prop.key.value === 'string' ? prop.key.value : undefined);
    const local = idName(prop.value);
    if (key && local) declare(target, local, { kind: 'PATH', parts: [...base.parts, key] }, at);
  }
}

function resolveBinding(value: unknown, scope: Scope, at: number, depth = 0): Binding {
  if (depth > 32 || !isAst(value)) return null;
  if (value.type === 'ChainExpression' || value.type === 'AwaitExpression') return resolveBinding(value.type === 'ChainExpression' ? value.expression : value.argument, scope, at, depth + 1);
  if (value.type === 'SequenceExpression') { const items = astList(value.expressions); return items.length ? resolveBinding(items[items.length - 1], scope, at, depth + 1) : null; }
  if (value.type === 'Literal' && typeof value.value === 'string') return { kind: 'STRING', value: value.value };
  if (value.type === 'TemplateLiteral') return resolveTemplate(value, scope, at, depth + 1);
  if (value.type === 'BinaryExpression' && value.operator === '+') { const l = resolveBinding(value.left, scope, at, depth + 1), r = resolveBinding(value.right, scope, at, depth + 1); return l?.kind === 'STRING' && r?.kind === 'STRING' ? { kind: 'STRING', value: l.value + r.value } : null; }
  if (value.type === 'ThisExpression') return { kind: 'PATH', parts: ['this'] };
  if (value.type === 'MetaProperty') return { kind: 'PATH', parts: ['import', 'meta'] };
  if (value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression' || value.type === 'ClassExpression') return { kind: 'FN' };
  if (value.type === 'Identifier') { const n = idName(value)!; const f = lookup(scope, n, at); return f === undefined ? { kind: 'PATH', parts: [n] } : f; }
  if (value.type === 'MemberExpression') return resolveMember(value, scope, at, depth + 1);
  if (value.type === 'CallExpression') return resolveCall(value, scope, at, depth + 1);
  return null;
}

function resolveTemplate(node: Ast, scope: Scope, at: number, depth: number): Binding {
  const quasis = astList(node.quasis), exprs = astList(node.expressions);
  let out = '';
  for (let i = 0; i < quasis.length; i += 1) {
    const cooked = (quasis[i]?.value as { cooked?: unknown } | undefined)?.cooked;
    if (typeof cooked !== 'string') return null;
    out += cooked;
    if (i < exprs.length) { const p = resolveBinding(exprs[i], scope, at, depth + 1); if (p?.kind !== 'STRING') return null; out += p.value; }
  }
  return { kind: 'STRING', value: out };
}

function resolveMember(node: Ast, scope: Scope, at: number, depth: number): Binding {
  const obj = resolveBinding(node.object, scope, at, depth + 1);
  const prop = node.computed ? resolveString(node.property, scope, at, depth + 1) : idName(node.property);
  if (prop === undefined) return null;
  if (obj?.kind === 'FN') return prop === CONSTRUCTOR_NAME ? { kind: 'PATH', parts: ['__FN__', CONSTRUCTOR_NAME] } : ['bind', 'call', 'apply'].includes(prop) ? { kind: 'FN' } : null;
  const recv = unwrapAst(node.object);
  if (BUILTIN_METHODS.has(prop) && (LITERAL_TYPES.has(recv?.type ?? '') || (obj?.kind === 'PATH' && BUILTIN_CTORS.has(obj.parts[0]!)))) return { kind: 'FN' };
  if (obj === null) return prop === CONSTRUCTOR_NAME ? { kind: 'PATH', parts: ['__ANY__', CONSTRUCTOR_NAME] } : null;
  const base = obj.kind === 'STRING' ? [obj.value] : obj.parts;
  if (base.length === 1 && (base[0] === 'this' || GLOBAL_ROOTS.has(base[0]!)) && GLOBAL_ROOTS.has(prop)) return { kind: 'PATH', parts: [prop] };
  return { kind: 'PATH', parts: [...base, prop] };
}

function resolveCall(node: Ast, scope: Scope, at: number, depth: number): Binding {
  const callee = unwrapAst(node.callee);
  if (callee && (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression')) {
    const inner = scopeAt(scope, callee.start);
    if (callee.type === 'ArrowFunctionExpression' && callee.expression === true) return resolveBinding(callee.body, inner, callee.start, depth + 1);
    const stmts = isAst(callee.body) && callee.body.type === 'BlockStatement' ? astList(callee.body.body) : [];
    if (stmts.length === 1 && stmts[0]?.type === 'ReturnStatement') return resolveBinding(stmts[0].argument, inner, stmts[0].start, depth + 1);
  }
  const calleeBinding = resolveBinding(node.callee, scope, at, depth + 1);
  if (calleeBinding?.kind === 'FN') return { kind: 'FN' };
  const cp = pathOf(calleeBinding);
  if (cp.length === 2 && cp[0] === 'Reflect' && cp[1] === 'get') {
    const args = astList(node.arguments), prop = resolveString(args[1], scope, at, depth + 1);
    if (prop !== undefined) return resolveMember({ type: 'MemberExpression', start: node.start, end: node.end, object: args[0], property: { type: 'Literal', start: node.start, end: node.end, value: prop }, computed: true }, scope, at, depth + 1);
  }
  return null;
}

function detect(node: Ast, parent: Ast | undefined, scope: Scope, nested: boolean, inCallee: boolean, inPattern: boolean, base: number, off: number, recovered: boolean): ExpressionIndicatorHit | undefined {
  if (inPattern) return undefined;
  const ps = recovered ? 'RECOVERED' : 'VERIFIED';
  if (node.type === 'ImportExpression') {
    const mod = resolveString(node.source, scope, node.start), bare = mod?.startsWith('node:') ? mod.slice(5) : mod, k = bare ? MODULES[bare] : undefined;
    return hit('EXPRESSION_SANDBOX_ESCAPE', k ? `${k}_DYNAMIC_IMPORT` : 'DYNAMIC_IMPORT', undefined, node, base, off, ps);
  }
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    const cp = pathOf(resolveBinding(node.callee, scope, node.start)), args = astList(node.arguments);
    if (isCtorEscape(cp)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'FUNCTION_CONSTRUCTOR', CONSTRUCTOR_NAME, node, base, off, ps);
    if (isRequirePath(cp)) {
      const mod = resolveString(args[0], scope, node.start), bare = mod?.startsWith('node:') ? mod.slice(5) : mod, k = bare ? MODULES[bare] : undefined;
      return hit('EXPRESSION_SANDBOX_ESCAPE', k ? `${k}_REQUIRE` : 'DYNAMIC_IMPORT', REQUIRE_NAME, node, base, off, ps);
    }
    if (isGlobalOrBare(cp, EVAL_NAME)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'EVAL', EVAL_NAME, node, base, off, ps);
    if (isGlobalOrBare(cp, FUNCTION_NAME)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'FUNCTION_CONSTRUCTOR', FUNCTION_NAME, node, base, off, ps);
    if (cp.length === 2 && cp[0] === 'Reflect' && (cp[1] === 'construct' || cp[1] === 'apply')) {
      const target = pathOf(resolveBinding(args[0], scope, node.start));
      if (isGlobalOrBare(target, FUNCTION_NAME) || isGlobalOrBare(target, EVAL_NAME)) return hit('EXPRESSION_SANDBOX_ESCAPE', target.at(-1) === EVAL_NAME ? 'EVAL' : 'FUNCTION_CONSTRUCTOR', target.at(-1), node, base, off, ps);
    }
    if (cp.length === 2 && cp[0] === 'Reflect' && cp[1] === 'get') return detectParts(pathOf(resolveCall(node, scope, node.start, 0)), node, parent, scope, nested, inCallee, base, off, ps);
    if (cp.length === 1 && STRING_TIMERS.has(cp[0]!) && resolveString(args[0], scope, node.start) !== undefined) return hit('EXPRESSION_SANDBOX_ESCAPE', 'EVAL', cp[0], node, base, off, ps);
    return undefined;
  }
  if (node.type === 'MemberExpression') {
    const direct = detectParts(pathOf(resolveBinding(node, scope, node.start)), node, parent, scope, nested, inCallee, base, off, ps);
    if (direct || nested) return direct;
    const env = envTarget(node, scope);
    return env === '$env' || env === '$secrets' ? hit('EXPRESSION_ENV_EXPOSURE', 'SECRET_ACCESS', env, node, base, off, ps) : env === 'env' ? hit('EXPRESSION_ENV_EXPOSURE', 'ENVIRONMENT_ACCESS', 'env', node, base, off, ps) : undefined;
  }
  if (node.type === 'Identifier' && !nested) {
    const parts = pathOf(resolveBinding(node, scope, node.start));
    if (parts.length === 1 && ENV_ROOTS.has(parts[0]!)) return hit('EXPRESSION_ENV_EXPOSURE', 'SECRET_ACCESS', parts[0], node, base, off, ps);
    return detectParts(parts, node, parent, scope, nested, inCallee, base, off, ps);
  }
  return undefined;
}

function detectParts(parts: string[], node: Ast, parent: Ast | undefined, scope: Scope, nested: boolean, inCallee: boolean, base: number, off: number, ps: 'VERIFIED' | 'RECOVERED'): ExpressionIndicatorHit | undefined {
  if (isCtorEscape(parts)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'FUNCTION_CONSTRUCTOR', CONSTRUCTOR_NAME, node, base, off, ps);
  if (!inCallee && parts.length === 2 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && (parts[1] === EVAL_NAME || parts[1] === FUNCTION_NAME)) return hit('EXPRESSION_SANDBOX_ESCAPE', parts[1] === EVAL_NAME ? 'EVAL' : 'FUNCTION_CONSTRUCTOR', parts[1], node, base, off, ps);
  if (parts.length === 2 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && parts[1] === PROCESS_NAME) {
    const parentProp = parent?.type === 'MemberExpression' && parent.object === node ? (parent.computed ? resolveString(parent.property, scope, parent.start) : idName(parent.property)) : undefined;
    if (!parentProp || !PROCESS_SINKS.has(parentProp)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'EXEC', PROCESS_NAME, node, base, off, ps);
  }
  if (isProcessSink(parts)) return hit('EXPRESSION_SANDBOX_ESCAPE', 'EXEC', parts.at(-1), node, base, off, ps);
  if (!inCallee && isRequirePath(parts) && parts.length >= 2) return hit('EXPRESSION_SANDBOX_ESCAPE', 'DYNAMIC_IMPORT', REQUIRE_NAME, node, base, off, ps);
  if (!nested && isEnvPath(parts)) return hit('EXPRESSION_ENV_EXPOSURE', 'ENVIRONMENT_ACCESS', 'env', node, base, off, ps);
  return undefined;
}

function envTarget(node: Ast, scope: Scope): '$env' | '$secrets' | 'env' | undefined {
  for (let cur: unknown = node, steps = 0; steps < 64 && isAst(cur); steps += 1) {
    if (cur.type === 'ChainExpression') { cur = cur.expression; continue; }
    const parts = pathOf(resolveBinding(cur, scope, cur.start));
    if ((parts.length === 1 && ENV_ROOTS.has(parts[0]!)) || (parts.length === 2 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && ENV_ROOTS.has(parts[1]!))) return parts.at(-1) as '$env' | '$secrets';
    if (isEnvPath(parts)) return 'env';
    if (cur.type !== 'MemberExpression') break;
    cur = cur.object;
  }
  return undefined;
}

export function sortHits(hits: ExpressionIndicatorHit[]): ExpressionIndicatorHit[] { return hits.sort((a, b) => a.start - b.start || a.end - b.end || (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)); }
export function hit(ruleId: ExpressionRuleId, indicator: ExpressionIndicatorName, member: string | undefined, node: { start: number; end: number }, base: number, off: number, parseState: 'VERIFIED' | 'RECOVERED'): ExpressionIndicatorHit { const start = Math.max(0, base + node.start - off); return { ruleId, indicator, ...(member === undefined ? {} : { member }), start, end: Math.max(start + 1, base + node.end - off), parseState }; }
function isCtorEscape(parts: string[]): boolean { return parts.length >= 2 && parts.at(-1) === CONSTRUCTOR_NAME && (parts.at(-2) === CONSTRUCTOR_NAME || parts[0] === '__FN__' || (parts.length === 2 && BUILTIN_CTORS.has(parts[0]!))); }
function isEnvPath(parts: string[]): boolean { return (parts.length === 2 && parts[0] === PROCESS_NAME && parts[1] === 'env') || (parts.length === 3 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && parts[1] === PROCESS_NAME && parts[2] === 'env') || (parts.length === 3 && parts[0] === 'import' && parts[1] === 'meta' && parts[2] === 'env'); }
function isGlobalOrBare(parts: string[], target: string): boolean { return (parts.length === 1 && parts[0] === target) || (parts.length === 2 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && parts[1] === target); }
function isRequirePath(parts: string[]): boolean { return (parts.length === 1 && parts[0] === REQUIRE_NAME) || (parts.length >= 2 && parts.at(-1) === REQUIRE_NAME && (parts[0] === 'mainModule' || parts[0] === 'module' || parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!) || (parts[0] === PROCESS_NAME && parts[1] === 'mainModule') || ((parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && parts[1] === PROCESS_NAME && parts[2] === 'mainModule'))); }
function isProcessSink(parts: string[]): boolean { return (parts.length === 2 && parts[0] === PROCESS_NAME && PROCESS_SINKS.has(parts[1]!)) || (parts.length === 3 && (parts[0] === 'this' || GLOBAL_ROOTS.has(parts[0]!)) && parts[1] === PROCESS_NAME && PROCESS_SINKS.has(parts[2]!)); }
function resolveString(value: unknown, scope: Scope, at: number, depth = 0): string | undefined { const b = resolveBinding(value, scope, at, depth); return b?.kind === 'STRING' ? b.value : undefined; }
function pathOf(binding: Binding): string[] { return binding?.kind === 'PATH' ? binding.parts : []; }
function unwrapAst(value: unknown): Ast | undefined { let cur = value; for (let i = 0; i < 8 && isAst(cur); i += 1) { if (cur.type === 'ChainExpression') { cur = cur.expression; continue; } if (cur.type === 'SequenceExpression') { cur = astList(cur.expressions).at(-1); continue; } return cur; } return undefined; }
function declare(scope: Scope, name: string | undefined, value: Binding, at: number): void { if (!name) return; const events = scope.events.get(name) ?? []; events.push({ at, value }); events.sort((a, b) => a.at - b.at); scope.events.set(name, events); }
function varScope(scope: Scope): Scope { for (let cur = scope; ; cur = cur.parent ?? cur) if (cur.varScope || !cur.parent) return cur; }
function scopeAt(scope: Scope, at: number): Scope { for (const child of scope.children) if (at >= child.from && at < child.to) return scopeAt(child, at); return scope; }
function lookup(scope: Scope, name: string, at: number): Binding | undefined { for (let cur: Scope | undefined = scope; cur; cur = cur.parent) { const events = cur.events.get(name); if (events) { let found: Binding | undefined; for (const e of events) if (e.at <= at) found = e.value; if (found !== undefined) return found; } } return undefined; }
function idName(value: unknown): string | undefined { return isAst(value) && value.type === 'Identifier' && typeof value.name === 'string' ? value.name : undefined; }
function astList(value: unknown): Ast[] { return Array.isArray(value) ? value.filter(isAst) : []; }
function isAst(value: unknown): value is Ast { return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' && typeof (value as { start?: unknown }).start === 'number' && typeof (value as { end?: unknown }).end === 'number'; }
