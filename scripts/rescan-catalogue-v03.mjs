import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const TEMPLATES_ROOT = 'D:\\projects\\n8n templates';
const BODY_DIRS = [
  path.join(TEMPLATES_ROOT, '04_curated_official_and_github', 'official'),
  path.join(TEMPLATES_ROOT, '05_backfilled_official'),
  path.join(TEMPLATES_ROOT, '01_deduplicated_master'),
  path.join(TEMPLATES_ROOT, '02_raw_scraped_by_source'),
];

function buildBodyIndex() {
  const byTemplateId = new Map();
  const byBaseName = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { walk(full); continue; }
      if (!item.isFile() || !item.name.toLowerCase().endsWith('.json')) continue;
      const officialMatch = /^official__(\d+)_/.exec(item.name);
      if (officialMatch) {
        const tid = Number(officialMatch[1]);
        if (!byTemplateId.has(tid)) byTemplateId.set(tid, full);
      }
      const lower = item.name.toLowerCase();
      if (!byBaseName.has(lower)) byBaseName.set(lower, full);
    }
  };
  for (const dir of BODY_DIRS) walk(dir);
  return { byTemplateId, byBaseName };
}

function resolveBodyFile(entry, index) {
  if (entry.source?.kind === 'n8n_official' && typeof entry.source.templateId === 'number') {
    const hit = index.byTemplateId.get(entry.source.templateId);
    if (hit) return hit;
  }
  if (entry.source?.kind === 'github' && entry.source.path) {
    const hit = index.byBaseName.get(path.basename(entry.source.path).toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function rewriteDetailShards(updatedById) {
  const detailsDir = path.join(DATA_DIR, 'details');
  if (!fs.existsSync(detailsDir)) return;
  for (const file of fs.readdirSync(detailsDir).filter((n) => /^detail-\d+\.jsonl$/.test(n)).sort()) {
    const full = path.join(detailsDir, file);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    const outLines = [];
    const indexMap = {};
    let offset = 0;
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const fresh = updatedById.get(parsed.id);
      const merged = fresh ? { ...parsed, security: fresh } : parsed;
      const serialized = `${JSON.stringify(merged)}\n`;
      const byteLen = Buffer.byteLength(serialized, 'utf8');
      indexMap[merged.id] = { offset, length: byteLen };
      offset += byteLen;
      outLines.push(serialized);
    }
    fs.writeFileSync(full, outLines.join(''), 'utf8');
    const shardNum = /^detail-(\d+)\.jsonl$/.exec(file)?.[1];
    if (shardNum !== undefined) {
      const idxPath = path.join(detailsDir, `detail-index-${shardNum}.json`);
      if (fs.existsSync(idxPath)) fs.writeFileSync(idxPath, JSON.stringify(indexMap), 'utf8');
    }
  }
}

async function runWorker() {
  const { register } = await import('tsx/esm/api');
  register();
  const { scanWorkflowV2 } = await import(workerData.scanUrl);
  const { v2ResultToEntrySecurity } = await import(workerData.summaryUrl);
  const results = [];
  let failed = 0;
  for (const item of workerData.items) {
    const buf = fs.readFileSync(item.bodyFile);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const outcome = scanWorkflowV2({ bytes, profile: { id: 'standard', version: '3.0.0' } });
    if (!outcome.ok) { failed += 1; continue; }
    results.push([item.id, v2ResultToEntrySecurity(outcome.result)]);
  }
  parentPort.postMessage({ results, failed });
}

async function runMain() {
  const startedAt = Date.now();
  const bodyIndex = buildBodyIndex();
  const shards = fs.readdirSync(DATA_DIR).filter((n) => /^catalogue-\d+\.json$/.test(n)).sort();
  const shardEntries = shards.map((file) => ({
    file,
    full: path.join(DATA_DIR, file),
    entries: JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')),
  }));

  const jobs = [];
  let unmatched = 0;
  for (const shard of shardEntries) {
    for (const entry of shard.entries) {
      const bodyFile = resolveBodyFile(entry, bodyIndex);
      if (bodyFile) jobs.push({ id: entry.id, bodyFile });
      else unmatched += 1;
    }
  }
  const workerCount = Math.min(12, Math.max(1, os.cpus().length));
  console.log(`Scanning ${jobs.length} matched entries (${unmatched} unmatched) across ${workerCount} workers...`);

  const scanUrl = pathToFileURL(path.join(ROOT, 'packages', 'scanner-core', 'src', 'v2', 'index.ts')).href;
  const summaryUrl = pathToFileURL(path.join(ROOT, 'pipeline', 'scan', 'v2-security-summary.ts')).href;
  const buckets = Array.from({ length: workerCount }, () => []);
  jobs.forEach((job, idx) => buckets[idx % workerCount].push(job));

  const updatedById = new Map();
  let failed = 0;
  await Promise.all(
    buckets.map((items) => new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { items, scanUrl, summaryUrl } });
      worker.on('message', (msg) => {
        failed += msg.failed;
        for (const [id, security] of msg.results) updatedById.set(id, security);
      });
      worker.on('error', reject);
      worker.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`Worker exited ${code}`))));
    })),
  );

  const grades = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  const statuses = { COMPLETE: 0, DEGRADED: 0, INDETERMINATE: 0 };
  for (const shard of shardEntries) {
    for (const entry of shard.entries) {
      const fresh = updatedById.get(entry.id);
      if (fresh) entry.security = fresh;
      grades[entry.security.grade] = (grades[entry.security.grade] ?? 0) + 1;
      if (entry.security.analysisStatus) statuses[entry.security.analysisStatus] = (statuses[entry.security.analysisStatus] ?? 0) + 1;
    }
    fs.writeFileSync(shard.full, JSON.stringify(shard.entries), 'utf8');
  }
  rewriteDetailShards(updatedById);

  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.generatedAt = new Date().toISOString();
  for (const artifact of manifest.artifacts) {
    const abs = path.join(DATA_DIR, artifact.path);
    if (fs.existsSync(abs)) {
      const b = fs.readFileSync(abs);
      artifact.byteSize = b.length;
      artifact.sha256 = createHash('sha256').update(b).digest('hex');
    }
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Rescanned ${updatedById.size} entries in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (failed=${failed}, unmatched=${unmatched})`);
  console.log('Grades:', grades);
  console.log('Statuses:', statuses);
}

if (isMainThread) await runMain();
else await runWorker();
