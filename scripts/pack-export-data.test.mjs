import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { bucketForId, bucketTag } from '../app/src/catalogue/pack-bucket';
import { packExportData } from './pack-export-data.mjs';

const tempDirs = [];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function makeSampleEntry(id, slug, chartRef) {
  return {
    id,
    slug,
    title: `Workflow ${slug}`,
    summary: 'Concise summary of workflow.',
    description: 'Long description '.repeat(120),
    descriptionSource: 'generated',
    descriptionProvenance: {
      source: 'gemini',
      model: 'gemini-3.7-flash-low',
      promptVersion: 'v1',
      promptHash: 'a'.repeat(64),
      schemaVersion: 'description-v1',
      workflowHash: 'b'.repeat(64),
      generatedAt: '2026-08-24T00:00:00.000Z',
    },
    descriptionContent: {
      headline: 'Duplicate structured headline',
      summary: 'Duplicate summary',
      outcome: 'Duplicate outcome',
      beforeAfter: { before: 'b', after: 'a' },
      exampleScenario: 'ex',
      howItWorks: ['1'],
      limitations: ['none'],
      audience: 'builders',
    },
    source: { kind: 'github', repo: 'owner/repo', permalink: 'https://github.com/owner/repo/blob/a/b.json', fetchedAt: '2026-08-01T00:00:00.000Z' },
    rights: { status: 'redistributable', licence: 'MIT', licenceUrl: 'https://spdx.org/licenses/MIT.html', reason: 'MIT' },
    structure: { nodeCount: 3, rawNodeCount: 4, annotationNodeCount: 1, connectionCount: 2, nodeTypes: ['n8n-nodes-base.webhook'], integrations: ['slack'], trigger: 'Webhook', isSubWorkflow: false, complexity: 'simple', hasCode: false, hasAI: false, hasWebhook: true },
    security: { grade: 'LOW', score: 98, counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findings: [], hardenedExtra: 0, scannerVersion: '2.0.0', profile: 'beta-default', schemaVersion: 'scanner-result-v2' },
    tags: ['slack'],
    dedup: { fingerprint: 'fp', structuralHash: 'sh', canonical: true, alsoFoundIn: [] },
    isPrerendered: true,
    readiness: { credentials: [], replaceableValues: [], writeActions: [], aiModel: { present: false, model: null }, extraPackages: [], versionNotes: [], pinnedData: { present: false, nodeCount: 0 }, isSubWorkflow: false },
    compatibility: { targetVersion: '2.34.6', checkedAt: '2026-08-16', source: 'npm', status: 'likely-compatible', reasons: ['ok'], blockers: [] },
    hostnames: { literal: ['api.slack.com'], dynamic: [], undeterminable: 0 },
    chartRef,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('packExportData', () => {
  it('refuses to mutate canonical data/ or app/public/data/', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..');
    expect(() => packExportData(repoRoot)).toThrow(/refusing/i);
    expect(() => packExportData(path.join(repoRoot, 'app', 'public'))).toThrow(/refusing/i);
  });

  it('packs search, detail, and chart artifacts into verified .gzbin buckets and removes raw copies', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-export-'));
    tempDirs.push(outDir);
    const dataDir = path.join(outDir, 'data');
    fs.mkdirSync(path.join(dataDir, 'details'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'charts'), { recursive: true });

    const chart0Obj = {
      nodes: [
        { id: 'uuid-1111-2222', name: 'Webhook', type: 'n8n-nodes-base.webhook', x: 10, y: 20, isAnnotation: false },
        { id: 'uuid-3333-4444', name: 'Slack', type: 'n8n-nodes-base.slack', x: 210, y: 20, isAnnotation: false },
        { id: 'uuid-5555-6666', name: 'Note', type: 'n8n-nodes-base.stickyNote', x: 10, y: 120, isAnnotation: true },
      ],
      edges: [{ from: 'Webhook', to: 'Slack', kind: 'main' }],
    };
    const chart0Line = `${JSON.stringify(chart0Obj)}\n`;
    const chart0Path = path.join(dataDir, 'charts', 'chart-0.jsonl');
    fs.writeFileSync(chart0Path, chart0Line, 'utf8');

    const idA = '26006871febf2139';
    const entryA = makeSampleEntry(idA, 'send-slack-alert', {
      shard: 0,
      offset: 0,
      length: Buffer.byteLength(chart0Line, 'utf8'),
    });
    const detailLine = `${JSON.stringify(entryA)}\n`;
    fs.writeFileSync(path.join(dataDir, 'details', 'detail-0.jsonl'), detailLine, 'utf8');
    fs.writeFileSync(
      path.join(dataDir, 'details', 'detail-index-0.json'),
      JSON.stringify({ [idA]: { offset: 0, length: Buffer.byteLength(detailLine, 'utf8'), sha256: sha256(Buffer.from(detailLine)) } }),
      'utf8',
    );

    const searchRaw = JSON.stringify({ version: 2, documents: [] });
    const extRaw = JSON.stringify({ version: 2, documents: [] });
    const semRaw = JSON.stringify({ version: 1, documents: [] });
    const facetsRaw = JSON.stringify({ total: 1 });
    fs.writeFileSync(path.join(dataDir, 'search-index.json'), searchRaw, 'utf8');
    fs.writeFileSync(path.join(dataDir, 'search-index-extended.json'), extRaw, 'utf8');
    fs.writeFileSync(path.join(dataDir, 'semantic-index.json'), semRaw, 'utf8');
    fs.writeFileSync(path.join(dataDir, 'facets.json'), facetsRaw, 'utf8');

    const manifest = {
      schemaVersion: 'manifest-v1',
      generatedAt: '2026-11-23T00:00:00.000Z',
      totalEntries: 1,
      catalogueShards: { [idA]: 0 },
      artifacts: [
        { path: 'search-index.json', byteSize: Buffer.byteLength(searchRaw), sha256: sha256(Buffer.from(searchRaw)), entryCount: 1 },
        { path: 'search-index-extended.json', byteSize: Buffer.byteLength(extRaw), sha256: sha256(Buffer.from(extRaw)), entryCount: 0 },
        { path: 'semantic-index.json', byteSize: Buffer.byteLength(semRaw), sha256: sha256(Buffer.from(semRaw)) },
        { path: 'facets.json', byteSize: Buffer.byteLength(facetsRaw), sha256: sha256(Buffer.from(facetsRaw)) },
        { path: 'details/detail-0.jsonl', byteSize: Buffer.byteLength(detailLine), sha256: sha256(Buffer.from(detailLine)) },
        { path: 'details/detail-index-0.json', byteSize: 10, sha256: '0'.repeat(64) },
        { path: 'charts/chart-0.jsonl', byteSize: Buffer.byteLength(chart0Line), sha256: sha256(Buffer.from(chart0Line)) },
      ],
    };
    fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    const summary = packExportData(outDir);
    expect(summary.totalDetails).toBe(1);
    expect(summary.totalCharts).toBe(1);

    // Raw large files deleted
    expect(fs.existsSync(path.join(dataDir, 'search-index.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'search-index-extended.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'semantic-index.json'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'details', 'detail-0.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'details', 'detail-index-0.json'))).toBe(false);
    expect(fs.existsSync(chart0Path)).toBe(false);

    // Gzbin files written and valid
    expect(gunzipSync(fs.readFileSync(path.join(dataDir, 'search-index.json.gzbin'))).toString('utf8')).toBe(searchRaw);
    const slugMap = JSON.parse(gunzipSync(fs.readFileSync(path.join(dataDir, 'details', 'slug-index.json.gzbin'))).toString('utf8'));
    expect(slugMap).toEqual({ 'send-slack-alert': idA });

    const expectedBucket = bucketTag(bucketForId(idA));
    const detailPackBytes = fs.readFileSync(path.join(dataDir, 'details', `pack-${expectedBucket}.jsonl.gzbin`));
    const unpackedDetail = JSON.parse(gunzipSync(detailPackBytes).toString('utf8').trim());
    expect(unpackedDetail.id).toBe(idA);
    expect(unpackedDetail.descriptionContent).toBeUndefined();
    expect(unpackedDetail.description.length).toBeLessThanOrEqual(420);
    expect(unpackedDetail.chartRef).toBeUndefined();
    expect(unpackedDetail.descriptionProvenance?.source).toBe('gemini');
    expect(unpackedDetail.readiness).toEqual(entryA.readiness);

    const chartPackBytes = fs.readFileSync(path.join(dataDir, 'charts', `pack-${expectedBucket}.jsonl.gzbin`));
    const unpackedChart = JSON.parse(gunzipSync(chartPackBytes).toString('utf8').trim());
    expect(unpackedChart.id).toBe(idA);
    expect(unpackedChart.nodes).toHaveLength(3);
    expect(unpackedChart.edges).toEqual([{ from: 'Webhook', to: 'Slack', kind: 'main' }]);

    const updatedManifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8'));
    const paths = updatedManifest.artifacts.map((a) => a.path);
    expect(paths).toContain('search-index.json.gzbin');
    expect(paths).toContain('details/slug-index.json.gzbin');
    expect(paths).toContain(`details/pack-${expectedBucket}.jsonl.gzbin`);
    expect(paths).toContain(`charts/pack-${expectedBucket}.jsonl.gzbin`);
    expect(paths).not.toContain('search-index.json');
    expect(paths).not.toContain('details/detail-0.jsonl');
    expect(paths).not.toContain('charts/chart-0.jsonl');

    const searchEntry = updatedManifest.artifacts.find((a) => a.path === 'search-index.json.gzbin');
    expect(searchEntry.entryCount).toBe(1);
    expect(searchEntry.sha256).toBe(sha256(fs.readFileSync(path.join(dataDir, 'search-index.json.gzbin'))));
  });
});
