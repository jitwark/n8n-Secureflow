import type { ChartRef, WorkflowChart } from '@hub/contracts';
import { parseWorkflowChart } from '@hub/contracts/workflow-chart';
import { fetchTextMaybeGzip } from './gzip-fetch';
import { loadManifest, type Manifest } from './manifest';
import { bucketForId, bucketTag } from './pack-bucket';
import { sitePath } from '../ui/site-url.mjs';

const MAX_CHART_BYTES = 512_000;
const chartPackCache = new Map<string, Promise<Map<string, string>>>();

export function clearChartPackCache(): void {
  chartPackCache.clear();
}

export async function fetchChart(chartRef: ChartRef, signal?: AbortSignal): Promise<WorkflowChart | null> {
  const result = await loadChart(chartRef, signal);
  return result.ok ? result.chart : null;
}

export type ChartUnavailableReason =
  | 'no-chart'
  | 'range-unsupported'
  | 'range-mismatch'
  | 'short-body'
  | 'network'
  | 'empty'
  | 'malformed'
  | 'aborted';

export type ChartRelease = { generatedAt: string; shardSha256: string };

export type ChartResult =
  | { ok: true; chart: WorkflowChart }
  | { ok: false; reason: ChartUnavailableReason; release?: ChartRelease };

function hasPackedCharts(manifest: Manifest): boolean {
  return manifest.artifacts.some((candidate) => candidate.path.startsWith('charts/pack-') && candidate.path.endsWith('.jsonl.gzbin'));
}

async function fetchChartBucketMap(
  packPath: string,
  sha256: string,
  manifest: Manifest,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const key = `${manifest.schemaVersion}:${manifest.generatedAt}:${sha256}:${packPath}`;
  let pending = chartPackCache.get(key);
  if (!pending) {
    pending = fetchTextMaybeGzip(sitePath(`/data/${packPath}`), { expectedSha256: sha256, signal }).then((text) => {
      const map = new Map<string, string>();
      for (const line of text.split('\n')) {
        if (!line) continue;
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === 'string') map.set(parsed.id, line);
      }
      return map;
    });
    chartPackCache.set(key, pending);
    pending.catch(() => { if (chartPackCache.get(key) === pending) chartPackCache.delete(key); });
  }
  return pending;
}

async function loadPackedChart(entryId: string, manifest: Manifest, signal?: AbortSignal): Promise<ChartResult> {
  const packPath = `charts/pack-${bucketTag(bucketForId(entryId))}.jsonl.gzbin`;
  const artifact = manifest.artifacts.find((candidate) => candidate.path === packPath);
  if (!artifact) return { ok: false, reason: 'no-chart' };
  const release: ChartRelease = { generatedAt: manifest.generatedAt, shardSha256: artifact.sha256 };

  try {
    const map = await fetchChartBucketMap(packPath, artifact.sha256, manifest, signal);
    const line = map.get(entryId);
    if (!line) return { ok: false, reason: 'no-chart', release };
    const chart = parseWorkflowChart(JSON.parse(line));
    return chart ? { ok: true, chart } : { ok: false, reason: 'malformed', release };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return { ok: false, reason: 'aborted', release };
    if ((cause as { code?: string } | null)?.code === 'hash-mismatch' || cause instanceof SyntaxError) {
      return { ok: false, reason: 'malformed', release };
    }
    return { ok: false, reason: 'network', release };
  }
}

export async function loadChart(
  chartRef: ChartRef | undefined,
  signal?: AbortSignal,
  manifestArg?: Manifest,
  entryId?: string,
): Promise<ChartResult> {
  if (!chartRef && !entryId) return { ok: false, reason: 'no-chart' };

  let manifest: Manifest;
  try {
    manifest = manifestArg ?? await loadManifest();
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (entryId && hasPackedCharts(manifest)) {
    return loadPackedChart(entryId, manifest, signal);
  }
  if (!chartRef) return { ok: false, reason: 'no-chart' };

  const artifact = manifest.artifacts.find((candidate) => candidate.path === `charts/chart-${chartRef.shard}.jsonl`);
  if (!artifact) return { ok: false, reason: 'no-chart' };
  const release: ChartRelease = { generatedAt: manifest.generatedAt, shardSha256: artifact.sha256 };

  if (!Number.isSafeInteger(chartRef.shard) || chartRef.shard < 0 ||
    !Number.isSafeInteger(chartRef.offset) || chartRef.offset < 0 ||
    !Number.isSafeInteger(chartRef.length) || chartRef.length <= 0 || chartRef.length > MAX_CHART_BYTES ||
    chartRef.offset + chartRef.length > artifact.byteSize) {
    return { ok: false, reason: 'malformed', release };
  }

  const path = sitePath(`/data/charts/chart-${chartRef.shard}.jsonl`);
  const rangeHeader = `bytes=${chartRef.offset}-${chartRef.offset + chartRef.length - 1}`;

  try {
    const res = await fetch(path, { headers: { Range: rangeHeader }, signal });
    if (res.status === 200) {
      await res.body?.cancel();
      return { ok: false, reason: 'range-unsupported', release };
    }
    if (res.status !== 206) return { ok: false, reason: 'network', release };

    const expected = `bytes ${chartRef.offset}-${chartRef.offset + chartRef.length - 1}/${artifact.byteSize}`;
    if (res.headers.get('content-range')?.trim() !== expected) {
      return { ok: false, reason: 'range-mismatch', release };
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength !== chartRef.length) return { ok: false, reason: 'short-body', release };
    if (bytes.at(-1) !== 0x0a || bytes.indexOf(0x0a) !== bytes.length - 1) {
      return { ok: false, reason: 'malformed', release };
    }

    const line = new TextDecoder().decode(bytes).trim();
    if (!line) return { ok: false, reason: 'empty', release };
    try {
      const chart = parseWorkflowChart(JSON.parse(line));
      return chart ? { ok: true, chart } : { ok: false, reason: 'malformed', release };
    } catch {
      return { ok: false, reason: 'malformed', release };
    }
  } catch (cause) {
    const reason = cause instanceof DOMException && cause.name === 'AbortError' ? 'aborted' : 'network';
    return { ok: false, reason, release };
  }
}
