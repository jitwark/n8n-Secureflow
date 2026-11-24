import { describe, expect, it } from 'vitest';
import { DEFAULT_SCANNER_LIMITS_V2 } from '@hub/contracts';
import { SAFE_FACT_SECRET_PATTERN } from '../../../../../contracts/scanner-v2-field-flow-validation';
import { SAFE_FACT_ENUMS_V2, SAFE_FACT_REGISTRY_V2 } from '../../facts/safe-fact-registry';
import { countInconsistency, omissionInconsistency } from '../../capabilities/count-lattice';
import type { AnalyzerContextV2 } from '../../capabilities/scheduler';
import { parseSourceDocument } from '../../source/source-parser';
import { normalizeSecurityWorkflow } from '../../workflow-v2/normalize-security-workflow';
import {
  evaluateExpressionSecurity,
  scanExpressionIslandsSecurity,
} from './expression-security';

const encoder = new TextEncoder();

function contextFor(workflowObj: unknown, limits = DEFAULT_SCANNER_LIMITS_V2): AnalyzerContextV2 {
  const json = JSON.stringify(workflowObj);
  const parsed = parseSourceDocument(encoder.encode(json), limits);
  if (!parsed.ok) throw new Error(`source fixture failed: ${parsed.code}`);
  const normalized = normalizeSecurityWorkflow(parsed.document, limits);
  if (!normalized.ok) throw new Error(`workflow fixture failed: ${normalized.code}`);
  return {
    source: parsed.document,
    workflow: normalized.workflow,
    target: {
      schemaVersion: 'scanner-target-v3',
      edition: 'COMMUNITY',
      deployment: 'SELF_HOSTED',
      role: 'OWNER',
      taskRunner: 'NATIVE',
      communityPackages: [],
      configuration: [],
      contextDigest: 'c'.repeat(64),
    },
    limits,
    semantics: { id: 's', version: '1', digest: 's'.repeat(64), resolvedNodeSemantics: new Map() },
    rules: { id: 'r', version: '1', digest: 'r'.repeat(64), rules: new Map() },
    priorOutcomes: new Map(),
  };
}

function singleNodeContext(
  parameters: Record<string, unknown>,
  nodeType = 'n8n-nodes-base.set',
  limits = DEFAULT_SCANNER_LIMITS_V2,
): AnalyzerContextV2 {
  return contextFor({
    nodes: [{ id: 'n1', name: 'Set', type: nodeType, typeVersion: 1, parameters }],
    connections: {},
  }, limits);
}

describe('expression security analyzer (Phase 2.3A)', () => {
  describe('EXPRESSION_SANDBOX_ESCAPE detection', () => {
    it.each([
      ['dot constructor chain', '={{ ({}).constructor.constructor("return 1")() }}'],
      ['string constructor chain', '={{ "".constructor.constructor("return this")() }}'],
      ['array constructor chain', '={{ [].constructor.constructor("return global")() }}'],
      ['computed bracket constructor', '={{ ({})["constructor"]["constructor"]("return 1")() }}'],
      ['string-concat obfuscated constructor', '={{ ({})["con" + "structor"]["con" + "structor"]("return 1")() }}'],
      ['template-literal obfuscated constructor', '={{ ({})[`con${""}structor`][`constructor`]("return 1")() }}'],
      ['this bracket constructor chain', '={{ this["constructor"]["constructor"]("return 1")() }}'],
      ['function expression constructor', '={{ (function(){}).constructor("return 1")() }}'],
      ['arrow expression constructor', '={{ (() => {}).constructor("return 1")() }}'],
      ['builtin Object constructor', '={{ Object.constructor("return 1")() }}'],
      ['scoped alias constructor', '={{ (() => { const c = "con" + "structor"; return ({})[c][c]("return 1")(); })() }}'],
      ['scoped intermediate constructor', '={{ (() => { const o = ({}).constructor; return o.constructor("return 1")(); })() }}'],
      ['optional chaining constructor', '={{ ({})?.["constructor"]?.["constructor"]("return 1")() }}'],
      ['this.process', '={{ this.process }}'],
      ['this bracket concat process', '={{ this["pro" + "cess"] }}'],
      ['globalThis.process', '={{ globalThis.process }}'],
      ['global.process', '={{ global.process }}'],
      ['self.process', '={{ self.process }}'],
      ['iife returning this.process', '={{ (() => this)().process }}'],
      ['CVE-2025-68613 full chain', '={{ (() => this.process.mainModule.require("child_process").execSync("id"))() }}'],
      ['process.mainModule', '={{ process.mainModule }}'],
      ['process.binding', '={{ process.binding("spawn_sync") }}'],
      ['process.dlopen', '={{ process.dlopen({}, "/tmp/mod.node") }}'],
      ['mainModule.require', '={{ mainModule.require("child_process") }}'],
      ['globalThis.require', '={{ globalThis.require("fs") }}'],
      ['bare require child_process', '={{ require("child_process") }}'],
      ['dynamic require', '={{ require($json.mod) }}'],
      ['Function call', '={{ Function("return 1")() }}'],
      ['new Function call', '={{ new Function("a", "return a")($json.x) }}'],
      ['eval call', '={{ eval($json.payload) }}'],
      ['globalThis bracket eval', '={{ globalThis["eval"]($json.payload) }}'],
      ['globalThis concat eval', '={{ globalThis["ev" + "al"]($json.payload) }}'],
      ['indirect comma eval', '={{ (0, eval)($json.payload) }}'],
      ['this bracket Function', '={{ this["Function"]("return 1")() }}'],
      ['array filter constructor', '={{ [].filter.constructor("return 1")() }}'],
      ['string slice constructor', '={{ "".slice.constructor("return 1")() }}'],
      ['object toString constructor', '={{ ({}).toString.constructor("return 1")() }}'],
      ['bound function constructor', '={{ ((x) => x).bind(null).constructor("return 1")() }}'],
      ['Reflect.get on this.process', '={{ Reflect.get(this, "process") }}'],
      ['Reflect.get constructor chain', '={{ Reflect.get(Reflect.get({}, "constructor"), "constructor")("return 1")() }}'],
      ['destructured eval from globalThis', '={{ (() => { const { eval: e } = globalThis; return e("1+1"); })() }}'],
      ['destructured process from this', '={{ (() => { const { process: p } = this; return p.mainModule; })() }}'],
      ['destructured mainModule from process', '={{ (() => { const { mainModule } = process; return mainModule.require("child_process"); })() }}'],
    ])('detects %s inside expression islands', (_label, expr) => {
      const standalone = scanExpressionIslandsSecurity(expr);
      expect(standalone.indicators.some((item) => item.ruleId === 'EXPRESSION_SANDBOX_ESCAPE')).toBe(true);
      expect(standalone.parseFailed).toBe(false);

      const result = evaluateExpressionSecurity(singleNodeContext({ value: expr }));
      expect(result.findings.some((f) => f.ruleId === 'EXPRESSION_SANDBOX_ESCAPE' && f.conclusion === 'OBSERVED')).toBe(true);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('EXPRESSION_ENV_EXPOSURE detection', () => {
    it.each([
      ['$env dot access', '={{ $env.AWS_SECRET_ACCESS_KEY }}', 'SECRET_ACCESS'],
      ['$env bracket access', '={{ $env["DB_PASS"] }}', 'SECRET_ACCESS'],
      ['$env concat bracket access', '={{ $env["DB_" + "PASS"] }}', 'SECRET_ACCESS'],
      ['$env dynamic bracket access', '={{ $env[$json.key] }}', 'SECRET_ACCESS'],
      ['bare $env object read', '={{ Object.keys($env) }}', 'SECRET_ACCESS'],
      ['$secrets dot access', '={{ $secrets.stripe }}', 'SECRET_ACCESS'],
      ['$secrets bracket access', '={{ $secrets["apiKey"] }}', 'SECRET_ACCESS'],
      ['process.env dot access', '={{ process.env.OPENAI_API_KEY }}', 'ENVIRONMENT_ACCESS'],
      ['process.env bracket access', '={{ process["env"]["OPENAI_API_KEY"] }}', 'ENVIRONMENT_ACCESS'],
      ['globalThis.process.env access', '={{ globalThis.process.env.TOKEN }}', 'ENVIRONMENT_ACCESS'],
    ])('detects %s inside expression islands', (_label, expr, expectedIndicator) => {
      const standalone = scanExpressionIslandsSecurity(expr);
      expect(standalone.indicators.some((item) => item.ruleId === 'EXPRESSION_ENV_EXPOSURE' && item.indicator === expectedIndicator)).toBe(true);

      const result = evaluateExpressionSecurity(singleNodeContext({ value: expr }));
      expect(result.findings.some((f) => f.ruleId === 'EXPRESSION_ENV_EXPOSURE' && f.conclusion === 'OBSERVED')).toBe(true);
      expect(result.facts.some((fact) => fact.properties.indicator === expectedIndicator)).toBe(true);
    });

    it('detects both sandbox escape and env exposure on this.process.env.SECRET', () => {
      const expr = '={{ this.process.env.SECRET_KEY }}';
      const result = evaluateExpressionSecurity(singleNodeContext({ value: expr }));
      const ruleIds = new Set(result.findings.map((f) => f.ruleId));
      expect(ruleIds.has('EXPRESSION_SANDBOX_ESCAPE')).toBe(true);
      expect(ruleIds.has('EXPRESSION_ENV_EXPOSURE')).toBe(true);
    });

    it('preserves exact UTF-16 offsets across multi-island strings with astral characters', () => {
      const expr = '😀 prefix {{ $env.API_TOKEN }} middle {{ eval($json.x) }}';
      const standalone = scanExpressionIslandsSecurity(expr);
      expect(standalone.indicators).toHaveLength(2);
      const [envHit, evalHit] = standalone.indicators;
      expect(expr.slice(envHit!.start, envHit!.end)).toBe('$env.API_TOKEN');
      expect(expr.slice(evalHit!.start, evalHit!.end)).toBe('eval($json.x)');
    });
  });

  describe('true negatives (safe benign expressions and literals)', () => {
    it.each([
      ['$json property access', '={{ $json.user.email }}'],
      ['$json array length', '={{ $json.items.length }}'],
      ['string concatenation on $json', "={{ $json.user.firstName + ' ' + $json.user.lastName }}"],
      ['Math helper', '={{ Math.max($json.a, $json.b) }}'],
      ['single constructor.name on $json', '={{ $json.constructor.name }}'],
      ['$json.process property', '={{ $json.process.status }}'],
      ['$json.$env property', '={{ $json.$env }}'],
      ['$node named reference', '={{ $node["HTTP Request"].json.process }}'],
      ['$json.filter.constructor.name single hop', '={{ $json.filter.constructor.name }}'],
      ['$json.mainModule.require on data', '={{ $json.mainModule.require("x") }}'],
      ['$vars reference', '={{ $vars.publicFlag }}'],
      ['plain literal $env outside islands', '$env.AWS_SECRET_ACCESS_KEY'],
      ['plain literal process.env outside islands', 'process.env.OPENAI_API_KEY'],
      ['plain literal escape outside islands', 'this.process.mainModule.require("child_process")'],
      ['block comment containing $env', '={{ /* $env */ $json.ok }}'],
      ['line comment containing this.process', '={{ // this.process\n $json.ok }}'],
      ['block comment containing constructor chain', '={{ /* ({}).constructor.constructor */ $json.a + $json.b }}'],
      ['string literal comparing $env', '={{ $json.msg === "$env" }}'],
      ['string literal comparing constructor', '={{ $json.kind === "constructor" }}'],
      ['regex literal mentioning env', '={{ /\\$env|process\\.env/.test($json.text) }}'],
      ['object literal expression with safe values', '={{ { user: $json.user, count: $json.items.length } }}'],
      ['non-computed object keys named process/eval/$env', '={{ ({ $env: $json.a, process: $json.b, eval: $json.c }).process }}'],
      ['shadowed $env parameter', '={{ (($env) => $env.ok)(1) }}'],
      ['shadowed process variable', '={{ (() => { const process = { env: { ok: 1 } }; return process.env.ok; })() }}'],
      ['shadowed eval variable', '={{ (() => { const eval = (x) => x; return eval($json.x); })() }}'],
      ['empty expression island', '={{ }}'],
    ])('produces zero findings and zero diagnostics for %s', (_label, expr) => {
      const standalone = scanExpressionIslandsSecurity(expr);
      expect(standalone.indicators).toEqual([]);
      expect(standalone.parseFailed).toBe(false);

      const result = evaluateExpressionSecurity(singleNodeContext({ value: expr }));
      expect(result.findings).toEqual([]);
      expect(result.facts).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it('ignores raw Code node jsCode/pythonCode fields without leading expression marker', () => {
      const ctx = singleNodeContext(
        { language: 'python', pythonCode: 'msg = f"{{ {x} }}"\n' },
        'n8n-nodes-base.code',
      );
      const result = evaluateExpressionSecurity(ctx);
      expect(result.findings).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('zero secret leaks, redaction & safe-fact compatibility', () => {
    it('never leaks raw secret values, tokens, or env variable keys into facts, findings, or diagnostics', () => {
      const tokenCanary = ['sk', 'proj', 'secretcanaryvalue1234567890'].join('-');
      const stripeCanary = ['sk', 'live', 'anothercanarytoken9876543'].join('-');
      const ctx = singleNodeContext({
        a: `={{ eval("${tokenCanary}") }}`,
        b: '={{ $env.AWS_SECRET_ACCESS_KEY }}',
        c: `={{ $env["${stripeCanary}"] }}`,
        d: '={{ $secrets["Bearer secret-canary-bearer"] }}',
        e: '={{ process.env.OPENAI_API_KEY }}',
      });
      const result = evaluateExpressionSecurity(ctx);
      expect(result.findings).toHaveLength(5);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(tokenCanary);
      expect(serialized).not.toContain(stripeCanary);
      expect(serialized).not.toContain('AWS_SECRET_ACCESS_KEY');
      expect(serialized).not.toContain('OPENAI_API_KEY');
      expect(serialized).not.toContain('secret-canary-bearer');

      const codeSchema = SAFE_FACT_REGISTRY_V2.schemas.find((s) => s.kind === 'code.indicator.v2')!;
      const allowedKeys = new Set(Object.keys(codeSchema.properties));
      for (const fact of result.facts) {
        expect(fact.kind).toBe('code.indicator.v2');
        expect(fact.subject.kind).toBe('SOURCE');
        expect(fact.properties.language).toBe('EXPRESSION');
        expect(SAFE_FACT_ENUMS_V2.indicator).toContain(fact.properties.indicator);
        expect(SAFE_FACT_ENUMS_V2.parseState).toContain(fact.properties.parseState);
        expect(typeof fact.properties.start).toBe('number');
        expect(typeof fact.properties.end).toBe('number');
        expect((fact.properties.start as number) >= 0).toBe(true);
        expect((fact.properties.end as number) > (fact.properties.start as number)).toBe(true);
        for (const key of Object.keys(fact.properties)) {
          expect(allowedKeys.has(key)).toBe(true);
        }
        if (typeof fact.properties.member === 'string') {
          expect(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fact.properties.member)).toBe(true);
          expect(SAFE_FACT_SECRET_PATTERN.test(fact.properties.member)).toBe(false);
        }
      }
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('Acorn parse failure & recovery', () => {
    it('emits EXPRESSION_PARSE_FAILED and recovers dangerous indicators as POTENTIAL', () => {
      const ctx = singleNodeContext({
        malformedEval: '={{ if (true) { eval($json.payload);',
        malformedEnv: '={{ $env.SECRET + }}',
      });
      const result = evaluateExpressionSecurity(ctx);
      expect(result.diagnostics.filter((d) => d.code === 'EXPRESSION_PARSE_FAILED')).toHaveLength(2);
      expect(result.diagnostics.every((d) => d.capabilityId === 'expression-security')).toBe(true);
      expect(result.findings.some((f) => f.ruleId === 'EXPRESSION_SANDBOX_ESCAPE' && f.conclusion === 'POTENTIAL')).toBe(true);
      expect(result.findings.some((f) => f.ruleId === 'EXPRESSION_ENV_EXPOSURE' && f.conclusion === 'POTENTIAL')).toBe(true);
      expect(result.facts.every((fact) => fact.properties.parseState === 'RECOVERED')).toBe(true);
    });

    it('does not recover false indicators from comments or malformed regexes', () => {
      const regexFail = evaluateExpressionSecurity(singleNodeContext({ v: '={{ const re = /eval(x/; }}' }));
      expect(regexFail.diagnostics.map((d) => d.code)).toContain('EXPRESSION_PARSE_FAILED');
      expect(regexFail.findings).toEqual([]);

      const commentFail = evaluateExpressionSecurity(singleNodeContext({ v: '={{ /* $env.SECRET */ + }}' }));
      expect(commentFail.diagnostics.map((d) => d.code)).toContain('EXPRESSION_PARSE_FAILED');
      expect(commentFail.findings).toEqual([]);
    });
  });

  describe('nested SemanticFieldV2 traversal, counting units, limits & determinism', () => {
    it('recursively inspects nested object and array parameters across multiple nodes', () => {
      const ctx = contextFor({
        nodes: [
          { id: 'n1', name: 'Safe', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} },
          {
            id: 'n2',
            name: 'Set',
            type: 'n8n-nodes-base.set',
            typeVersion: 3,
            parameters: {
              assignments: {
                assignments: [
                  { name: 'safe', value: '={{ $json.ok }}' },
                  { name: 'bad', value: '={{ $env.SECRET_TOKEN }}' },
                ],
              },
              options: [{ nested: { deep: '={{ this.process.mainModule }}' } }],
            },
          },
        ],
        connections: {},
      });
      const result = evaluateExpressionSecurity(ctx);
      expect(result.seen).toBe(2);
      expect(result.analyzed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.omitted).toBe(0);
      expect(result.findings.map((f) => f.ruleId).sort()).toEqual([
        'EXPRESSION_ENV_EXPOSURE',
        'EXPRESSION_SANDBOX_ESCAPE',
      ]);
      expect(countInconsistency(result, ctx.workflow.nodes.length)).toBeNull();
      expect(omissionInconsistency(result, result.diagnostics)).toBeNull();
    });

    it('handles empty workflows cleanly', () => {
      const result = evaluateExpressionSecurity(contextFor({ nodes: [], connections: {} }));
      expect({
        seen: result.seen,
        analyzed: result.analyzed,
        skipped: result.skipped,
        omitted: result.omitted,
        findings: result.findings,
        facts: result.facts,
        diagnostics: result.diagnostics,
      }).toEqual({
        seen: 0,
        analyzed: 0,
        skipped: 0,
        omitted: 0,
        findings: [],
        facts: [],
        diagnostics: [],
      });
    });

    it('enforces maxExpressionTokens, maxCodeSyntaxNodes, maxFindings, and maxDiagnostics budgets', () => {
      const tokenCapped = evaluateExpressionSecurity(
        singleNodeContext({ value: '={{ eval($json.a) }}' }, 'n8n-nodes-base.set', {
          ...DEFAULT_SCANNER_LIMITS_V2,
          maxExpressionTokens: 3,
        }),
      );
      expect(tokenCapped.facts).toEqual([]);
      expect(tokenCapped.omitted).toBeGreaterThan(0);
      expect(tokenCapped.diagnostics.map((d) => d.code)).toContain('OPTIONAL_LIMIT_EXCEEDED');
      expect(omissionInconsistency(tokenCapped, tokenCapped.diagnostics)).toBeNull();

      const nodeCapped = evaluateExpressionSecurity(
        singleNodeContext({ value: '={{ eval($json.a); eval($json.b); }}' }, 'n8n-nodes-base.set', {
          ...DEFAULT_SCANNER_LIMITS_V2,
          maxCodeSyntaxNodes: 2,
        }),
      );
      expect(nodeCapped.omitted).toBeGreaterThan(0);
      expect(nodeCapped.diagnostics.map((d) => d.code)).toContain('OPTIONAL_LIMIT_EXCEEDED');

      const manyInOneSource = Array.from({ length: 12 }, (_, i) => `{{ $env.K${i} }}`).join(' ');
      const sourceCapped = evaluateExpressionSecurity(singleNodeContext({ value: manyInOneSource }));
      expect(sourceCapped.facts).toHaveLength(10);
      expect(sourceCapped.findings).toHaveLength(10);
      expect(sourceCapped.omitted).toBeGreaterThanOrEqual(2);
      expect(sourceCapped.diagnostics.map((d) => d.code)).toContain('OPTIONAL_LIMIT_EXCEEDED');
      expect(omissionInconsistency(sourceCapped, sourceCapped.diagnostics)).toBeNull();

      const diagCapped = evaluateExpressionSecurity(
        singleNodeContext(
          { a: '={{ + }}', b: '={{ + }}', c: '={{ + }}' },
          'n8n-nodes-base.set',
          { ...DEFAULT_SCANNER_LIMITS_V2, maxDiagnostics: 1 },
        ),
      );
      expect(diagCapped.diagnostics.length).toBeLessThanOrEqual(1);
    });

    it('produces byte-identical deterministic serialized output across repeated runs', () => {
      const ctx = singleNodeContext({
        x: '={{ $env.KEY }}',
        y: '={{ ({}).constructor.constructor("return 1")() }}',
        z: '={{ broken + }}',
      });
      const first = JSON.stringify(evaluateExpressionSecurity(ctx));
      const second = JSON.stringify(evaluateExpressionSecurity(ctx));
      expect(second).toBe(first);
    });
  });
});
