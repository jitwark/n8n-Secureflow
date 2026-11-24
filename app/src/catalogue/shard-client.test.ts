import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChartRef } from '@hub/contracts';
import { clearChartPackCache, fetchChart, loadChart } from './shard-client';
import { resetManifestCache } from './manifest';
import { bucketForId, bucketTag } from './pack-bucket';

/**
 * Every case queues the manifest first: `loadChart` resolves the release
 * manifest before it can name the chart artifact, so a single-fetch mock would
 * feed the chart response to `loadManifest`.
 */
const manifest = {
  schemaVersion: 'manifest-v1',
  generatedAt: '2026-01-01T00:00:00.000Z',
  totalEntries: 1,
  catalogueShards: {},
  artifacts: [{ path: 'charts/chart-0.jsonl', byteSize: 128, sha256: 'a'.repeat(64) }],
};
const line = `${JSON.stringify({ nodes: [], edges: [] })}\n`;
const len = new TextEncoder().encode(line).byteLength;
const chartRef: ChartRef = { shard: 0, offset: 0, length: len };
const manifestResponse = () => new Response(JSON.stringify(manifest));
const rangeResponse = (bytes: string, contentRange = `bytes 0-${len - 1}/128`, status = 206) =>
  new Response(bytes, { status, headers: { 'content-range': contentRange } });

afterEach(() => {
  clearChartPackCache();
  resetManifestCache();
  vi.restoreAllMocks();
});

describe('fetchChart', () => {
  it('cancels the body and gives up when the host ignores Range', async () => {
    const cancel = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce({ status: 200, body: { cancel } } as unknown as Response);

    await expect(fetchChart(chartRef)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});

/**
 * CV-1. The component's defensive `.catch` is only redundant if this holds:
 * `loadChart` reports failure by resolving, never by rejecting.
 */
describe('loadChart', () => {
  it('accepts an exact range with a matching Content-Range', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(rangeResponse(line));

    await expect(loadChart(chartRef)).resolves.toMatchObject({ ok: true });
  });

  it('rejects a Content-Range for a different range', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(rangeResponse(line, 'bytes 0-127/128'));

    await expect(loadChart(chartRef)).resolves.toMatchObject({ ok: false, reason: 'range-mismatch' });
  });

  it('rejects a body shorter than the requested length', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(rangeResponse(line.slice(0, -1)));

    await expect(loadChart(chartRef)).resolves.toMatchObject({ ok: false, reason: 'short-body' });
  });

  it('rejects a range beyond the artifact byteSize', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(manifestResponse());

    await expect(loadChart({ shard: 0, offset: 120, length: 16 }))
      .resolves.toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('resolves rather than rejects when the manifest fetch fails, with no release to name', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const result = await loadChart(chartRef);
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('reports absence when the manifest declares no chart shard', async () => {
    const empty = { ...manifest, artifacts: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(empty)));

    await expect(loadChart(chartRef)).resolves.toEqual({ ok: false, reason: 'no-chart' });
  });

  it('reports absence when there is no chart reference at all', async () => {
    await expect(loadChart(undefined)).resolves.toEqual({ ok: false, reason: 'no-chart' });
  });

  it('reports a host that ignored the Range header without reading the body', async () => {
    const cancel = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce({
        status: 200,
        body: { cancel },
        arrayBuffer: async () => { throw new Error('the whole shard must never be read'); },
      } as unknown as Response);

    await expect(loadChart(chartRef)).resolves.toMatchObject({ ok: false, reason: 'range-unsupported' });
    expect(cancel).toHaveBeenCalled();
  });

  it('classifies invalid chart JSON as malformed rather than network failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(rangeResponse('{not-json}\n', `bytes 0-${'{not-json}'.length}/128`));

    await expect(loadChart({ shard: 0, offset: 0, length: '{not-json}'.length + 1 }))
      .resolves.toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('carries the release identity on every failure after the artifact resolves', async () => {
    const release = { generatedAt: manifest.generatedAt, shardSha256: 'a'.repeat(64) };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(manifestResponse())
      .mockResolvedValueOnce(rangeResponse(line, 'bytes 9-9/128'));

    const result = await loadChart(chartRef);
    expect(result).toMatchObject({ ok: false, reason: 'range-mismatch', release });
  });
});

describe('packed chart buckets', () => {
  async function sha256Bytes(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  it('loads and caches a workflow chart by id from charts/pack-{bucket}.jsonl.gzbin', async () => {
    const entryId = '26006871febf2139';
    const bucket = bucketTag(bucketForId(entryId));
    const packPath = `charts/pack-${bucket}.jsonl.gzbin`;
    const chartRecord = {
      id: entryId,
      nodes: [{ id: 'n0', name: 'Webhook', type: 'n8n-nodes-base.webhook', x: 10, y: 20 }],
      edges: [],
    };
    const packBytes = new Uint8Array(gzipSync(Buffer.from(`${JSON.stringify(chartRecord)}\n`, 'utf8')));
    const packSha = await sha256Bytes(packBytes);

    let packFetches = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          schemaVersion: 'manifest-v1',
          generatedAt: '2026-11-23T00:00:00.000Z',
          totalEntries: 1,
          catalogueShards: { [entryId]: 0 },
          artifacts: [{ path: packPath, byteSize: packBytes.byteLength, sha256: packSha }],
        }));
      }
      if (url.endsWith(`/${packPath}`)) {
        packFetches += 1;
        return new Response(packBytes.slice().buffer, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const first = await loadChart(chartRef, undefined, undefined, entryId);
    expect(first).toEqual({ ok: true, chart: { nodes: chartRecord.nodes, edges: [] } });
    const second = await loadChart(chartRef, undefined, undefined, entryId);
    expect(second).toEqual(first);
    expect(packFetches).toBe(1);
  });

  it('reports no-chart when entry is absent from packed chart bucket and malformed on digest mismatch', async () => {
    const entryId = '26006871febf2139';
    const bucket = bucketTag(bucketForId(entryId));
    const packPath = `charts/pack-${bucket}.jsonl.gzbin`;
    const packBytes = new Uint8Array(gzipSync(Buffer.from(`${JSON.stringify({ id: 'other', nodes: [], edges: [] })}\n`, 'utf8')));
    const packSha = await sha256Bytes(packBytes);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          schemaVersion: 'manifest-v1',
          generatedAt: '2026-11-23T00:00:00.000Z',
          totalEntries: 1,
          catalogueShards: { [entryId]: 0 },
          artifacts: [{ path: packPath, byteSize: packBytes.byteLength, sha256: packSha }],
        }));
      }
      if (url.endsWith(`/${packPath}`)) return new Response(packBytes.slice().buffer, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(loadChart(chartRef, undefined, undefined, entryId)).resolves.toMatchObject({ ok: false, reason: 'no-chart' });

    clearChartPackCache();
    resetManifestCache();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/manifest.json')) {
        return new Response(JSON.stringify({
          schemaVersion: 'manifest-v1',
          generatedAt: '2026-11-23T00:00:00.000Z',
          totalEntries: 1,
          catalogueShards: { [entryId]: 0 },
          artifacts: [{ path: packPath, byteSize: packBytes.byteLength, sha256: 'e'.repeat(64) }],
        }));
      }
      if (url.endsWith(`/${packPath}`)) return new Response(packBytes.slice().buffer, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(loadChart(chartRef, undefined, undefined, entryId)).resolves.toMatchObject({ ok: false, reason: 'malformed' });
  });
});
