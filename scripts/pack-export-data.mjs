import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACK_BUCKETS = 64;
const MAX_DETAIL_DESC_CHARS = 420;
const SEARCH_ARTIFACTS = ['search-index.json', 'search-index-extended.json', 'semantic-index.json'];

function canonicalPath(dir) {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function fnv1aBucket(id) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PACK_BUCKETS;
}

function bucketFileName(bucket) {
  return `pack-${String(bucket).padStart(2, '0')}.jsonl.gzbin`;
}

function truncateText(value, maxChars) {
  if (typeof value !== 'string' || value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.replace(/[,;:\s]+$/, '')}…`;
}

function compactProvenance(prov) {
  if (!prov || typeof prov !== 'object') return undefined;
  const out = { source: prov.source };
  if (prov.model) out.model = prov.model;
  if (prov.promptVersion) out.promptVersion = prov.promptVersion;
  if (prov.generatedAt) out.generatedAt = prov.generatedAt;
  return out;
}

function slimEntry(entry) {
  const out = {
    id: entry.id, slug: entry.slug, title: entry.title, summary: entry.summary,
    description: truncateText(entry.description || entry.summary || entry.title, MAX_DETAIL_DESC_CHARS),
    descriptionSource: entry.descriptionSource,
    source: entry.source, rights: entry.rights, structure: entry.structure,
    security: entry.security, tags: entry.tags, dedup: entry.dedup,
  };
  const prov = compactProvenance(entry.descriptionProvenance);
  if (prov) out.descriptionProvenance = prov;
  for (const key of ['isPrerendered', 'readiness', 'compatibility', 'hostnames', 'download']) {
    if (entry[key] !== undefined) out[key] = entry[key];
  }
  return out;
}

function compactChart(id, rawChart) {
  const idMap = new Map();
  const nodes = (rawChart.nodes ?? []).map((node, index) => {
    const shortId = `n${index}`;
    idMap.set(node.id, shortId);
    const out = { id: shortId, name: node.name, type: node.type, x: Math.round(node.x), y: Math.round(node.y) };
    if (node.isAnnotation === true) out.isAnnotation = true;
    return out;
  });
  const edges = (rawChart.edges ?? []).map((edge) => ({
    from: idMap.get(edge.from) ?? edge.from, to: idMap.get(edge.to) ?? edge.to, kind: edge.kind,
  }));
  const chart = { id, nodes, edges };
  if (rawChart.unresolvedEdgeCount !== undefined) chart.unresolvedEdgeCount = rawChart.unresolvedEdgeCount;
  return chart;
}

function writeGzipArtifact(dataDir, relPath, rawBuffer, extra = {}) {
  const gz = gzipSync(rawBuffer, { level: 9 });
  const absPath = path.join(dataDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, gz);
  return { path: relPath.replaceAll('\\', '/'), byteSize: gz.length, sha256: sha256Hex(gz), ...extra };
}

function packSearchArtifacts(dataDir, manifestByPath) {
  const added = [];
  for (const name of SEARCH_ARTIFACTS) {
    const rawPath = path.join(dataDir, name);
    if (!fs.existsSync(rawPath)) continue;
    const prev = manifestByPath.get(name);
    const extra = {};
    if (prev?.entryCount !== undefined) extra.entryCount = prev.entryCount;
    if (prev?.entryRange !== undefined) extra.entryRange = prev.entryRange;
    added.push(writeGzipArtifact(dataDir, `${name}.gzbin`, fs.readFileSync(rawPath), extra));
    fs.unlinkSync(rawPath);
  }
  return added;
}

function packDetailBuckets(detailsDir, dataDir) {
  const buckets = Array.from({ length: PACK_BUCKETS }, () => []);
  const slugMap = new Map();
  const chartIdByRef = new Map();
  let totalDetails = 0;

  if (!fs.existsSync(detailsDir)) return { added: [], chartIdByRef, totalDetails };
  const detailFiles = fs.readdirSync(detailsDir).filter((n) => /^detail-\d+\.jsonl$/.test(n)).sort();
  for (const file of detailFiles) {
    const lines = fs.readFileSync(path.join(detailsDir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line);
      totalDetails += 1;
      slugMap.set(entry.slug, entry.id);
      if (entry.chartRef) {
        const key = `${entry.chartRef.shard}:${entry.chartRef.offset}:${entry.chartRef.length}`;
        const list = chartIdByRef.get(key) ?? [];
        list.push(entry.id);
        chartIdByRef.set(key, list);
      }
      buckets[fnv1aBucket(entry.id)].push({ id: entry.id, json: JSON.stringify(slimEntry(entry)) });
    }
    fs.unlinkSync(path.join(detailsDir, file));
  }
  for (const file of fs.readdirSync(detailsDir).filter((n) => /^detail-index-\d+\.json$/.test(n))) {
    fs.unlinkSync(path.join(detailsDir, file));
  }

  const added = [];
  if (totalDetails > 0) {
    const sortedSlugs = Object.fromEntries([...slugMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
    added.push(writeGzipArtifact(dataDir, 'details/slug-index.json.gzbin', Buffer.from(JSON.stringify(sortedSlugs), 'utf8')));
    for (let b = 0; b < PACK_BUCKETS; b += 1) {
      const items = buckets[b].sort((a, bItem) => (a.id < bItem.id ? -1 : a.id > bItem.id ? 1 : 0));
      const payload = items.length > 0 ? `${items.map((x) => x.json).join('\n')}\n` : '';
      added.push(writeGzipArtifact(dataDir, `details/${bucketFileName(b)}`, Buffer.from(payload, 'utf8')));
    }
  }
  return { added, chartIdByRef, totalDetails };
}

function packChartBuckets(chartsDir, dataDir, chartIdByRef) {
  const buckets = Array.from({ length: PACK_BUCKETS }, () => []);
  let totalCharts = 0;
  if (!fs.existsSync(chartsDir)) return { added: [], totalCharts };

  const chartFiles = fs.readdirSync(chartsDir).filter((n) => /^chart-(\d+)\.jsonl$/.test(n)).sort();
  for (const file of chartFiles) {
    const shard = Number(/^chart-(\d+)\.jsonl$/.exec(file)[1]);
    const buf = fs.readFileSync(path.join(chartsDir, file));
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      const end = nl === -1 ? buf.length : nl + 1;
      const ids = chartIdByRef.get(`${shard}:${pos}:${end - pos}`);
      if (ids?.length) {
        const parsed = JSON.parse(buf.subarray(pos, end).toString('utf8'));
        for (const id of ids) {
          totalCharts += 1;
          buckets[fnv1aBucket(id)].push({ id, json: JSON.stringify(compactChart(id, parsed)) });
        }
      }
      pos = end;
    }
    fs.unlinkSync(path.join(chartsDir, file));
  }

  const added = [];
  if (totalCharts > 0) {
    for (let b = 0; b < PACK_BUCKETS; b += 1) {
      const items = buckets[b].sort((a, bItem) => (a.id < bItem.id ? -1 : a.id > bItem.id ? 1 : 0));
      const payload = items.length > 0 ? `${items.map((x) => x.json).join('\n')}\n` : '';
      added.push(writeGzipArtifact(dataDir, `charts/${bucketFileName(b)}`, Buffer.from(payload, 'utf8')));
    }
  }
  return { added, totalCharts };
}

export function packExportData(outDir = path.join(ROOT, 'app', 'out')) {
  const resolvedOut = path.resolve(outDir);
  const dataDir = path.join(resolvedOut, 'data');
  const protectedDirs = new Set([
    canonicalPath(path.join(ROOT, 'data')),
    canonicalPath(path.join(ROOT, 'app', 'public', 'data')),
  ]);
  if (protectedDirs.has(canonicalPath(dataDir))) {
    throw new Error(`Refusing to pack canonical build inputs: ${dataDir}`);
  }
  const manifestPath = path.join(dataDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Export manifest is missing: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const byPath = new Map((manifest.artifacts ?? []).map((item) => [item.path, item]));
  const searchAdded = packSearchArtifacts(dataDir, byPath);
  const { added: detailAdded, chartIdByRef, totalDetails } = packDetailBuckets(path.join(dataDir, 'details'), dataDir);
  const { added: chartAdded, totalCharts } = packChartBuckets(path.join(dataDir, 'charts'), dataDir, chartIdByRef);

  const packsDir = path.join(dataDir, 'packs');
  if (fs.existsSync(packsDir) && fs.readdirSync(packsDir).length === 0) fs.rmSync(packsDir, { recursive: true, force: true });

  const stale = new Set([...SEARCH_ARTIFACTS]);
  const isStale = (p) => stale.has(p) || /^details\/detail-(?:index-)?\d+\.jsonl?$/.test(p) || /^charts\/chart-\d+\.jsonl$/.test(p);
  const kept = (manifest.artifacts ?? []).filter((item) => !isStale(item.path));
  const merged = new Map([...kept, ...searchAdded, ...detailAdded, ...chartAdded].map((a) => [a.path, a]));
  manifest.artifacts = [...merged.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

  return { totalDetails, totalCharts, packedArtifacts: searchAdded.length + detailAdded.length + chartAdded.length };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = packExportData(process.argv[2]);
  console.log(`Packed export data: ${result.totalDetails} details, ${result.totalCharts} charts, ${result.packedArtifacts} .gzbin artifact(s).`);
}
