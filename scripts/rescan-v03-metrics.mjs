import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const DEFAULT_DIR = 'D:\\projects\\n8n templates\\01_deduplicated_master';
const DEFAULT_OUT = path.resolve(import.meta.dirname, '..', 'app', 'src', 'catalogue', 'v03-corpus-metrics.json');
const TAINT_RULES = new Set(['TAINTED_COMMAND', 'TAINTED_SQL_QUERY', 'TAINTED_REQUEST_URL', 'TAINTED_FILE_PATH', 'TAINTED_CODE_INPUT', 'TAINTED_REQUEST_HEADER', 'TAINTED_AI_PROMPT']);
const V3_TRACKED = ['EXPRESSION_SANDBOX_ESCAPE', 'EXPRESSION_ENV_EXPOSURE', 'AGENT_EGRESS_UNRESTRICTED', 'UNAUTHENTICATED_TRIGGER_TO_SINK', 'JAVASCRIPT_DYNAMIC_EXECUTION', 'PYTHON_DYNAMIC_EXECUTION', 'AI_AGENT_UNGATED_TOOL'];
const round2 = (n) => Math.round(n * 100) / 100;
const pct = (part, total) => (total > 0 ? round2((part / total) * 100) : 0);

function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, out: DEFAULT_OUT, limit: null, strictLimit: 1000, workers: Math.min(16, Math.max(1, os.cpus().length)) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i], next = argv[i + 1];
    if (arg === '--dir' && next) { opts.dir = path.resolve(next); i += 1; }
    else if (arg === '--out' && next) { opts.out = path.resolve(next); i += 1; }
    else if (arg === '--limit' && next) { opts.limit = Math.max(1, Number.parseInt(next, 10)); i += 1; }
    else if (arg === '--strict-limit' && next) { opts.strictLimit = next === 'all' ? Number.POSITIVE_INFINITY : Math.max(0, Number.parseInt(next, 10)); i += 1; }
    else if (arg === '--workers' && next) { opts.workers = Math.max(1, Number.parseInt(next, 10)); i += 1; }
  }
  return opts;
}

function listJsonFiles(dir) {
  const out = [];
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push({ full, rel: path.relative(dir, full).replace(/\\/g, '/'), size: fs.statSync(full).size });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function emptyAcc() {
  return {
    scannedWorkflows: 0, parseOk: 0, failedScans: 0, failureCodes: {},
    analysisStatus: { COMPLETE: 0, LIMITED: 0, DEGRADED: 0, INDETERMINATE: 0 },
    unmodeledCatalogueWorkflows: 0, unmodeledOnlyDegradedWorkflows: 0,
    grades: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 },
    scores: [], totalFindings: 0, workflowsWithFindings: 0, workflowsWithCriticalOrHigh: 0,
    findingsBySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    rules: {}, diagnostics: {}, taintWorkflows: 0, codeIndicators: {},
  };
}

function recordScan(acc, outcome) {
  acc.scannedWorkflows += 1;
  if (!outcome.ok) { acc.failedScans += 1; acc.failureCodes[outcome.code] = (acc.failureCodes[outcome.code] ?? 0) + 1; return; }
  const r = outcome.result;
  acc.parseOk += 1;
  acc.analysisStatus[r.analysis.status] = (acc.analysisStatus[r.analysis.status] ?? 0) + 1;
  const diagSeen = new Set();
  let hasUnmodeled = false, hasOtherDegraded = false;
  for (const d of r.analysis.diagnostics) {
    diagSeen.add(d.code);
    const cur = acc.diagnostics[d.code] ?? (acc.diagnostics[d.code] = { aggregateEffect: d.aggregateEffect, occurrences: 0, workflows: 0 });
    cur.occurrences += 1;
    if (d.code === 'SEMANTIC_CATALOGUE_MISS' || d.code === 'GENERIC_NODE_UNMODELED_CAPABILITY') hasUnmodeled = true;
    else if (d.aggregateEffect === 'DEGRADED') hasOtherDegraded = true;
  }
  for (const code of diagSeen) acc.diagnostics[code].workflows += 1;
  if (hasUnmodeled) acc.unmodeledCatalogueWorkflows += 1;
  if (r.analysis.status === 'DEGRADED' && hasUnmodeled && !hasOtherDegraded) acc.unmodeledOnlyDegradedWorkflows += 1;
  if (r.assessment === null) acc.grades.UNKNOWN += 1;
  else { acc.grades[r.assessment.grade] = (acc.grades[r.assessment.grade] ?? 0) + 1; acc.scores.push(r.assessment.score); }
  if (r.findings.length > 0) acc.workflowsWithFindings += 1;
  acc.totalFindings += r.findings.length;
  const seenRules = new Set(), seenInd = new Set();
  let hasCritHigh = false, hasTaint = false;
  for (const f of r.findings) {
    if (f.severity === 'CRITICAL' || f.severity === 'HIGH') hasCritHigh = true;
    if (f.severity in acc.findingsBySeverity) acc.findingsBySeverity[f.severity] += 1;
    if (TAINT_RULES.has(f.ruleId)) hasTaint = true;
    const ruleRec = acc.rules[f.ruleId] ?? (acc.rules[f.ruleId] = { severity: f.severity, findingCount: 0, triggeredWorkflows: 0 });
    ruleRec.findingCount += 1;
    seenRules.add(f.ruleId);
  }
  for (const ruleId of seenRules) acc.rules[ruleId].triggeredWorkflows += 1;
  if (hasCritHigh) acc.workflowsWithCriticalOrHigh += 1;
  if (hasTaint) acc.taintWorkflows += 1;
  for (const fact of r.facts) {
    if (fact.kind !== 'code.indicator.v2') continue;
    const key = `${fact.properties.language}:${fact.properties.indicator}`;
    const rec = acc.codeIndicators[key] ?? (acc.codeIndicators[key] = { factCount: 0, workflows: 0 });
    rec.factCount += 1;
    seenInd.add(key);
  }
  for (const key of seenInd) acc.codeIndicators[key].workflows += 1;
}

function mergeMaps(target, part, copyProps, countProps) {
  for (const [k, v] of Object.entries(part)) {
    const cur = target[k] ?? (target[k] = Object.fromEntries([...copyProps.map((p) => [p, v[p]]), ...countProps.map((p) => [p, 0])]));
    for (const p of countProps) cur[p] += v[p];
  }
}

function mergeInto(target, part) {
  target.scannedWorkflows += part.scannedWorkflows; target.parseOk += part.parseOk; target.failedScans += part.failedScans;
  for (const [k, v] of Object.entries(part.failureCodes)) target.failureCodes[k] = (target.failureCodes[k] ?? 0) + v;
  for (const k of Object.keys(target.analysisStatus)) target.analysisStatus[k] += part.analysisStatus[k];
  target.unmodeledCatalogueWorkflows += part.unmodeledCatalogueWorkflows;
  target.unmodeledOnlyDegradedWorkflows += part.unmodeledOnlyDegradedWorkflows;
  for (const k of Object.keys(target.grades)) target.grades[k] += part.grades[k];
  for (const s of part.scores) target.scores.push(s);
  target.totalFindings += part.totalFindings; target.workflowsWithFindings += part.workflowsWithFindings;
  target.workflowsWithCriticalOrHigh += part.workflowsWithCriticalOrHigh; target.taintWorkflows += part.taintWorkflows;
  for (const k of Object.keys(target.findingsBySeverity)) target.findingsBySeverity[k] += part.findingsBySeverity[k];
  mergeMaps(target.rules, part.rules, ['severity'], ['findingCount', 'triggeredWorkflows']);
  mergeMaps(target.diagnostics, part.diagnostics, ['aggregateEffect'], ['occurrences', 'workflows']);
  mergeMaps(target.codeIndicators, part.codeIndicators, [], ['factCount', 'workflows']);
}

function scoreDistribution(scores) {
  if (scores.length === 0) return { count: 0, min: null, median: null, p90: null, max: null, mean: null };
  const s = [...scores].sort((a, b) => a - b), n = s.length, sum = s.reduce((a, b) => a + b, 0);
  const median = n % 2 === 1 ? s[(n - 1) / 2] : round2((s[n / 2 - 1] + s[n / 2]) / 2);
  return { count: n, min: s[0], median, p90: s[Math.min(n - 1, Math.floor(0.9 * (n - 1)))], max: s[n - 1], mean: round2(sum / n) };
}

function finalizeProfile(acc, extra = {}, compact = false) {
  const n = acc.scannedWorkflows;
  const findingsByRule = Object.entries(acc.rules)
    .map(([ruleId, r]) => ({ ruleId, severity: r.severity, findingCount: r.findingCount, triggeredWorkflows: r.triggeredWorkflows, workflowPercent: pct(r.triggeredWorkflows, n) }))
    .sort((a, b) => b.triggeredWorkflows - a.triggeredWorkflows || b.findingCount - a.findingCount || (a.ruleId < b.ruleId ? -1 : 1));
  const topDiagnostics = Object.entries(acc.diagnostics)
    .map(([code, d]) => ({ code, aggregateEffect: d.aggregateEffect, occurrences: d.occurrences, workflows: d.workflows }))
    .sort((a, b) => b.workflows - a.workflows || b.occurrences - a.occurrences || (a.code < b.code ? -1 : 1)).slice(0, 8);
  const ruleEntry = (id) => ({ findingCount: acc.rules[id]?.findingCount ?? 0, triggeredWorkflows: acc.rules[id]?.triggeredWorkflows ?? 0, workflowPercent: pct(acc.rules[id]?.triggeredWorkflows ?? 0, n) });
  const taintFindings = [...TAINT_RULES].reduce((sum, id) => sum + (acc.rules[id]?.findingCount ?? 0), 0);
  const newV3RulesSummary = compact ? undefined : {
    ...Object.fromEntries(V3_TRACKED.map((id) => [id, ruleEntry(id)])),
    TAINT_FLOW_TOTAL: { findingCount: taintFindings, triggeredWorkflows: acc.taintWorkflows, workflowPercent: pct(acc.taintWorkflows, n) },
    taintRules: Object.fromEntries([...TAINT_RULES].map((id) => [id, ruleEntry(id)])),
    environmentIndicators: {
      EXPRESSION_ENVIRONMENT_ACCESS: acc.codeIndicators['EXPRESSION:ENVIRONMENT_ACCESS'] ?? { factCount: 0, workflows: 0 },
      EXPRESSION_SECRET_ACCESS: acc.codeIndicators['EXPRESSION:SECRET_ACCESS'] ?? { factCount: 0, workflows: 0 },
      JAVASCRIPT_ENVIRONMENT_ACCESS: acc.codeIndicators['JAVASCRIPT:ENVIRONMENT_ACCESS'] ?? { factCount: 0, workflows: 0 },
      PYTHON_ENVIRONMENT_ACCESS: acc.codeIndicators['PYTHON:ENVIRONMENT_ACCESS'] ?? { factCount: 0, workflows: 0 },
    },
  };
  return {
    ...extra, scannedWorkflows: n, parseOk: acc.parseOk, ...(acc.failedScans > 0 ? { failedScans: acc.failedScans, failureCodes: acc.failureCodes } : {}),
    analysisStatus: acc.analysisStatus, degradedRatePercent: pct(acc.analysisStatus.DEGRADED, n),
    unmodeledCatalogueWorkflows: acc.unmodeledCatalogueWorkflows, unmodeledCatalogueRatePercent: pct(acc.unmodeledCatalogueWorkflows, n),
    grades: acc.grades, totalFindings: acc.totalFindings, workflowsWithFindings: acc.workflowsWithFindings,
    workflowsWithCriticalOrHigh: acc.workflowsWithCriticalOrHigh, scoreDistribution: scoreDistribution(acc.scores),
    findingsBySeverity: acc.findingsBySeverity, findingsByRule, ...(newV3RulesSummary ? { newV3RulesSummary } : {}), ...(compact ? {} : { topDiagnostics }),
  };
}

const scanSig = (r) => (r.ok ? `${r.result.analysis.status}:${r.result.findings.length}:${r.result.assessment?.score}:${r.result.assessment?.grade}` : r.code);

async function runWorker() {
  const { register } = await import('tsx/esm/api');
  register();
  const { scanWorkflowV2 } = await import(workerData.scanModuleUrl);
  const std = emptyAcc(), beta = emptyAcc(), strict = emptyAcc();
  let validWorkflows = 0, invalidOrNonWorkflow = 0, totalNodes = 0, strictParityDiffs = 0, seen = 0;
  for (const item of workerData.items) {
    seen += 1;
    if (seen % 250 === 0) parentPort.postMessage({ type: 'tick', count: 250 });
    const buf = fs.readFileSync(item.full);
    let parsed = null;
    try { parsed = JSON.parse(buf.toString('utf8')); } catch { parsed = null; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.nodes)) { invalidOrNonWorkflow += 1; continue; }
    validWorkflows += 1;
    totalNodes += parsed.nodes.length;
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const stdRes = scanWorkflowV2({ bytes, profile: { id: 'standard', version: '3.0.0' } });
    recordScan(std, stdRes);
    recordScan(beta, scanWorkflowV2({ bytes, profile: { id: 'beta-default', version: '2.0.0' } }));
    if (item.runStrict) {
      const strRes = scanWorkflowV2({ bytes, profile: { id: 'strict', version: '3.0.0' } });
      recordScan(strict, strRes);
      if (scanSig(stdRes) !== scanSig(strRes)) strictParityDiffs += 1;
    }
  }
  parentPort.postMessage({ type: 'done', validWorkflows, invalidOrNonWorkflow, totalNodes, strictParityDiffs, std, beta, strict });
}

async function runMain() {
  const t0 = performance.now(), opts = parseArgs(process.argv.slice(2)), allFiles = listJsonFiles(opts.dir);
  const selected = opts.limit ? allFiles.slice(0, opts.limit) : allFiles;
  const scheduled = selected.map((item, idx) => ({ full: item.full, size: item.size, runStrict: idx < opts.strictLimit }))
    .sort((a, b) => b.size - a.size || (a.full < b.full ? -1 : 1));
  const buckets = Array.from({ length: opts.workers }, () => []);
  scheduled.forEach((item, idx) => buckets[idx % opts.workers].push(item));
  const scanModuleUrl = pathToFileURL(path.resolve(import.meta.dirname, '..', 'packages', 'scanner-core', 'src', 'v2', 'scan-workflow.ts')).href;
  let processed = 0, nextMark = 2000;
  const parts = await Promise.all(buckets.filter((b) => b.length > 0).map((items) => new Promise((resolve, reject) => {
    const w = new Worker(import.meta.filename, { workerData: { items, scanModuleUrl } });
    w.on('message', (msg) => {
      if (msg?.type === 'tick') {
        processed += msg.count;
        if (processed >= nextMark) { console.log(`Progress: ${processed}/${selected.length} files (${Math.round((performance.now() - t0) / 1000)}s)`); nextMark += 2000; }
      } else if (msg?.type === 'done') resolve(msg);
    });
    w.on('error', reject);
  })));
  let validWorkflows = 0, invalidOrNonWorkflow = 0, totalNodes = 0, strictParityDiffs = 0;
  const stdAcc = emptyAcc(), betaAcc = emptyAcc(), strictAcc = emptyAcc();
  for (const p of parts) {
    validWorkflows += p.validWorkflows; invalidOrNonWorkflow += p.invalidOrNonWorkflow; totalNodes += p.totalNodes; strictParityDiffs += p.strictParityDiffs;
    mergeInto(stdAcc, p.std); mergeInto(betaAcc, p.beta); mergeInto(strictAcc, p.strict);
  }
  const std = finalizeProfile(stdAcc, { scope: 'full' }, false);
  const beta = finalizeProfile(betaAcc, { scope: 'full', note: 'Admitted v2 beta-default@2.0.0 on HEAD (beta-default@1.0.0 is not admitted by scanner-core; HEAD already classifies unmodelled-node diagnostics as NONE, tracked via unmodeledCatalogueWorkflows).' }, true);
  const strict = finalizeProfile(strictAcc, { scope: strictAcc.scannedWorkflows === validWorkflows ? 'full' : `first-${strictAcc.scannedWorkflows}`, parityWithStandardOnSubset: strictParityDiffs === 0, parityDiffs: strictParityDiffs }, true);
  const report = {
    schemaVersion: 'v03-corpus-metrics-v1', generatedAt: new Date().toISOString(), scannerPackage: 'sfscanner@0.3.0',
    corpus: { name: path.basename(opts.dir) || '01_deduplicated_master', totalJsonFiles: selected.length, validWorkflows, invalidOrNonWorkflow, avgNodes: validWorkflows > 0 ? round2(totalNodes / validWorkflows) : 0, totalNodes },
    profiles: { 'standard@3.0.0': std, 'beta-default@2.0.0': beta, ...(strict.scannedWorkflows > 0 ? { 'strict@3.0.0': strict } : {}) },
    comparison: {
      baselineProfile: 'beta-default@2.0.0', targetProfile: 'standard@3.0.0', comparedWorkflows: validWorkflows,
      degradedWorkflowsBefore: beta.analysisStatus.DEGRADED, degradedWorkflowsAfter: std.analysisStatus.DEGRADED,
      degradedReductionPercent: beta.analysisStatus.DEGRADED > 0 ? round2(((beta.analysisStatus.DEGRADED - std.analysisStatus.DEGRADED) / beta.analysisStatus.DEGRADED) * 100) : 0,
      unmodeledCatalogueWorkflowsBefore: beta.unmodeledCatalogueWorkflows, unmodeledCatalogueDegradedAfter: stdAcc.unmodeledOnlyDegradedWorkflows,
      unmodeledCatalogueDegradedReductionPercent: beta.unmodeledCatalogueWorkflows > 0 ? round2(((beta.unmodeledCatalogueWorkflows - stdAcc.unmodeledOnlyDegradedWorkflows) / beta.unmodeledCatalogueWorkflows) * 100) : 0,
      totalFindingsBefore: beta.totalFindings, totalFindingsAfter: std.totalFindings, findingsDelta: std.totalFindings - beta.totalFindings,
      findingsUpliftPercent: beta.totalFindings > 0 ? round2(((std.totalFindings - beta.totalFindings) / beta.totalFindings) * 100) : null,
      workflowsWithFindingsBefore: beta.workflowsWithFindings, workflowsWithFindingsAfter: std.workflowsWithFindings,
      criticalHighWorkflowsBefore: beta.workflowsWithCriticalOrHigh, criticalHighWorkflowsAfter: std.workflowsWithCriticalOrHigh,
      criticalHighWorkflowsDelta: std.workflowsWithCriticalOrHigh - beta.workflowsWithCriticalOrHigh,
      criticalHighUpliftPercent: beta.workflowsWithCriticalOrHigh > 0 ? round2(((std.workflowsWithCriticalOrHigh - beta.workflowsWithCriticalOrHigh) / beta.workflowsWithCriticalOrHigh) * 100) : null,
      criticalHighGradeWorkflowsBefore: beta.grades.CRITICAL + beta.grades.HIGH, criticalHighGradeWorkflowsAfter: std.grades.CRITICAL + std.grades.HIGH,
    },
  };
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(opts.out, serialized, 'utf8');
  console.log(`v0.3 rescan complete in ${Math.round((performance.now() - t0) / 1000)}s: ${validWorkflows}/${selected.length} valid workflows, ${std.totalFindings} findings (standard@3.0.0), output ${Buffer.byteLength(serialized, 'utf8')} bytes.`);
}

if (isMainThread) await runMain();
else await runWorker();
