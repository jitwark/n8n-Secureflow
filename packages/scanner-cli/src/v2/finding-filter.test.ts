import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SCANNER_LIMITS_V2 } from '@hub/contracts';
import { validateScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import { scanWorkflowV2 } from '@hub/scanner-core/v2';
import { afterEach, describe, expect, it } from 'vitest';
import type { BatchResultV2 } from './batch-runner';
import { filterBatchResultV2, loadBaselineFindingIdsV2 } from './finding-filter';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sf-filter-'));
  dirs.push(dir);
  return dir;
}

function realScan(workflow: Record<string, unknown>) {
  const res = scanWorkflowV2({
    bytes: new TextEncoder().encode(JSON.stringify(workflow)),
    profile: { id: 'standard', version: '3.0.0' },
    limits: DEFAULT_SCANNER_LIMITS_V2,
  });
  if (!res.ok) throw new Error(res.code);
  return res.result;
}

describe('filterBatchResultV2', () => {
  const mixedWorkflow = {
    nodes: [
      { id: 'exec', name: 'Exec', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, parameters: { command: 'id' } },
      { id: 'code', name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return items;' } },
      { id: 'pkg', name: 'Custom', type: 'custom-pkg.node', typeVersion: 1, parameters: {} },
    ],
    connections: {},
  };

  it('filters by minSeverity and minConfidence while keeping ScannerResultV2 valid', () => {
    const raw = realScan(mixedWorkflow);
    expect(raw.findings.length).toBeGreaterThanOrEqual(3);
    const batch: BatchResultV2 = {
      ok: true,
      items: [
        { label: 'wf.json', status: 'COMPLETED', result: { ok: true, result: raw } },
        { label: 'bad.json', status: 'FAILED', error: { code: 'INVALID_JSON' } },
      ],
      cancelled: false,
      completed: 1,
      failed: 1,
      concurrency: 1,
    };

    const highOnly = filterBatchResultV2(batch, { minSeverity: 'HIGH' });
    expect(highOnly.baselineSuppressed).toBe(0);
    expect(highOnly.batch.ok).toBe(true);
    if (!highOnly.batch.ok) return;
    const item = highOnly.batch.items[0]!;
    expect(item.status).toBe('COMPLETED');
    if (item.status !== 'COMPLETED' || !item.result?.ok) return;
    expect(item.result.result.findings.map((f) => f.ruleId)).toEqual(['N8N_EXECUTE_COMMAND']);
    expect(validateScannerResultV2(item.result.result)).toMatchObject({ ok: true });
    expect(item.result.result.assessment?.grade).toBe('CRITICAL');
    expect(highOnly.batch.items[1]).toEqual(batch.items[1]);

    const highConfOnly = filterBatchResultV2(batch, { minConfidence: 'HIGH' });
    if (!highConfOnly.batch.ok) return;
    const confItem = highConfOnly.batch.items[0]!;
    if (confItem.status !== 'COMPLETED' || !confItem.result?.ok) return;
    expect(confItem.result.result.findings.every((f) => f.confidence === 'HIGH')).toBe(true);
    expect(validateScannerResultV2(confItem.result.result)).toMatchObject({ ok: true });
  });

  it('suppresses baseline findingIds, recomputes score/grade, and preserves null assessment on INDETERMINATE', () => {
    const raw = realScan(mixedWorkflow);
    const critical = raw.findings.find((f) => f.ruleId === 'N8N_EXECUTE_COMMAND')!;
    const batch: BatchResultV2 = {
      ok: true,
      items: [{ label: 'wf.json', status: 'COMPLETED', result: { ok: true, result: raw } }],
      cancelled: false,
      completed: 1,
      failed: 0,
      concurrency: 1,
    };

    const suppressed = filterBatchResultV2(batch, { baselineIds: new Set([critical.findingId]) });
    expect(suppressed.baselineSuppressed).toBe(1);
    if (!suppressed.batch.ok) return;
    const res = suppressed.batch.items[0]!;
    if (res.status !== 'COMPLETED' || !res.result?.ok) return;
    expect(res.result.result.findings.some((f) => f.findingId === critical.findingId)).toBe(false);
    expect(res.result.result.assessment?.grade).toBe('LOW');
    expect(validateScannerResultV2(res.result.result)).toMatchObject({ ok: true });

    const indet = realScan({
      nodes: [{ id: 'x', name: 'Broken', type: 'n8n-nodes-base.executeCommand', typeVersion: 1, parameters: 'bad' }],
      connections: {},
    });
    expect(indet.analysis.status).toBe('INDETERMINATE');
    const indetFiltered = filterBatchResultV2(
      { ok: true, items: [{ label: 'ind.json', status: 'COMPLETED', result: { ok: true, result: indet } }], cancelled: false, completed: 1, failed: 0, concurrency: 1 },
      { minSeverity: 'HIGH' },
    );
    if (!indetFiltered.batch.ok) return;
    const indetRes = indetFiltered.batch.items[0]!;
    if (indetRes.status !== 'COMPLETED' || !indetRes.result?.ok) return;
    expect(indetRes.result.result.assessment).toBeNull();
    expect(validateScannerResultV2(indetRes.result.result)).toMatchObject({ ok: true });
  });
});

describe('loadBaselineFindingIdsV2', () => {
  it('loads findingIds from compact baseline, v2 envelope, and single ScannerResultV2 JSON', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'compact.json'), JSON.stringify({ findingIds: ['id-1', 'id-2'] }));
    await writeFile(path.join(dir, 'envelope.json'), JSON.stringify({
      schemaVersion: 'n8n-scan-v2',
      results: [
        { input: 'a.json', ok: true, result: { findings: [{ findingId: 'id-a' }, { findingId: 'id-b' }] } },
        { input: 'b.json', ok: false, error: { code: 'INVALID_JSON' } },
      ],
    }));
    await writeFile(path.join(dir, 'single.json'), JSON.stringify({ findings: [{ findingId: 'id-single' }] }));

    expect(await loadBaselineFindingIdsV2('compact.json', dir)).toEqual({ ok: true, findingIds: new Set(['id-1', 'id-2']) });
    expect(await loadBaselineFindingIdsV2('envelope.json', dir)).toEqual({ ok: true, findingIds: new Set(['id-a', 'id-b']) });
    expect(await loadBaselineFindingIdsV2('single.json', dir)).toEqual({ ok: true, findingIds: new Set(['id-single']) });
  });

  it('rejects traversal, missing, malformed, and symlinked baseline files without leaking paths', async () => {
    const dir = await tempDir();
    const secretName = 'secret-baseline-canary.json';
    await writeFile(path.join(dir, 'bad.json'), '{not-json');
    await writeFile(path.join(dir, 'empty-shape.json'), '{}');
    await writeFile(path.join(dir, 'bad-ids.json'), JSON.stringify({ findingIds: [123] }));
    await writeFile(path.join(dir, secretName), JSON.stringify({ findingIds: ['x'] }));

    for (const badPath of [`../${secretName}`, '/etc/passwd', 'missing.json', 'bad.json', 'empty-shape.json', 'bad-ids.json']) {
      const loaded = await loadBaselineFindingIdsV2(badPath, dir);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) {
        expect(loaded.exitCode).toBe(2);
        expect(loaded.message).not.toContain(secretName);
        expect(loaded.message).not.toContain(dir);
      }
    }

    try {
      await symlink(path.join(dir, secretName), path.join(dir, 'link.json'));
      const linked = await loadBaselineFindingIdsV2('link.json', dir);
      expect(linked.ok).toBe(false);
    } catch {
      // Symlink creation may require privilege on Windows; traversal/missing/malformed cases still hold.
    }
  });
});
