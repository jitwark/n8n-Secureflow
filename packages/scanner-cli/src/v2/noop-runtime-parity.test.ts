import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SCANNER_LIMITS_V2 } from '@hub/contracts';
import { validateScannerResultV2, type ScannerResultV2 } from '@hub/contracts/scanner-v2-result';
import { scanWorkflowV2 } from '@hub/scanner-core/v2';
import { NOOP_ADMISSION_PINS, reviewedNoopAdmissionIsIntact } from '../../../scanner-core/src/semantics/noop-admission-authority';
import { describe, expect, it } from 'vitest';
import { parseArgumentsV2 } from './arguments';
import { runCliV2Internal } from './cli-runner-internal';

type Format = 'json' | 'ndjson' | 'sarif';
type CliIdentity = { name: string; version: string; buildDigest: string };
type CliEnvelope = {
  schemaVersion: string;
  tool: CliIdentity;
  artifacts: { profile: unknown; ruleset: unknown; semantics: unknown };
  summary: { total: number; complete: number; degraded: number; indeterminate: number; inputErrors: number; internalErrors: number; cancelled: number };
  results: Array<{ ok: boolean; result: ScannerResultV2 }>;
};
type SarifRun = {
  tool: { driver: { name: string; version: string } };
  invocations: Array<{ toolExecutionNotifications: Array<{ descriptor: { id: string } }> }>;
  properties: { secureflow: { analysisStatus: string; engine: { id: string; version: string; buildDigest: string } } };
};

const PROFILE = { id: 'standard', version: '3.0.0' } as const;

function workflowBytes(parameters: Readonly<Record<string, unknown>>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    name: 'NoOp runtime parity',
    nodes: [{ id: 'noop', name: 'NoOp', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters }],
    connections: {},
  }));
}

function parseCliCommand(format: Format) {
  const parsed = parseArgumentsV2(['--schema', 'v2', 'scan', 'workflow.json', '--format', format]);
  if (!parsed.ok || parsed.command.kind !== 'scan') throw new Error('Could not parse the v2 scan command.');
  return parsed.command;
}

async function runCli(format: Format, directory: string): Promise<string> {
  const result = await runCliV2Internal(parseCliCommand(format), {
    cwd: directory,
    scan: (bytes, _item, options) => scanWorkflowV2({
      bytes,
      profile: options?.profile ?? PROFILE,
      limits: options?.limits ?? DEFAULT_SCANNER_LIMITS_V2,
      ...(options?.target === undefined ? {} : { target: options.target }),
    }),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  return result.stdout;
}

function assertValidResult(result: unknown): asserts result is ScannerResultV2 {
  expect(validateScannerResultV2(result).ok).toBe(true);
}

describe('NoOp runtime parity through scanner core and CLI', () => {
  it.each([
    ['admitted exact v1 candidate', {}, 'COMPLETE', false],
    ['refused present direct selector', { operation: 'run' }, 'COMPLETE', true],
  ] as const)('%s keeps same-workflow semantics across JSON, NDJSON and SARIF', async (_label, parameters, status, refused) => {
    expect(reviewedNoopAdmissionIsIntact()).toBe(true);
    expect(NOOP_ADMISSION_PINS.candidateKey).toBe('n8n-nodes-base.noOp@1.0.0:ABSENT/ABSENT');

    const directory = await mkdtemp(join(tmpdir(), 'sf-noop-runtime-parity-'));
    try {
      const bytes = workflowBytes(parameters);
      await writeFile(join(directory, 'workflow.json'), bytes);
      const sameBytes = new Uint8Array(await readFile(join(directory, 'workflow.json')));
      expect(sameBytes).toEqual(bytes);

      const coreScan = scanWorkflowV2({ bytes: sameBytes, profile: PROFILE, limits: DEFAULT_SCANNER_LIMITS_V2 });
      expect(coreScan.ok).toBe(true);
      if (!coreScan.ok) return;
      const core = coreScan.result;
      assertValidResult(core);
      expect(core.analysis.status).toBe(status);
      expect(core.analysis.diagnostics.some(({ code }) => code === 'SEMANTIC_CATALOGUE_MISS')).toBe(refused);
      if (refused) {
        expect(core.analysis.diagnostics).toContainEqual(expect.objectContaining({
          code: 'SEMANTIC_CATALOGUE_MISS', aggregateEffect: 'NONE',
        }));
      }

      const json = JSON.parse(await runCli('json', directory)) as CliEnvelope;
      expect(json.schemaVersion).toBe('n8n-scan-v2');
      expect(json.results).toHaveLength(1);
      expect(json.results[0]?.ok).toBe(true);
      const jsonResult = json.results[0]?.result;
      assertValidResult(jsonResult);
      expect(jsonResult).toEqual(core);
      expect(json.summary).toMatchObject({
        total: 1, complete: 1, degraded: 0,
        indeterminate: 0, inputErrors: 0, internalErrors: 0, cancelled: 0,
      });

      const ndjsonLines = (await runCli('ndjson', directory)).trimEnd().split('\n')
        .map((line) => JSON.parse(line) as { type: string; tool?: CliIdentity; item?: { ok: boolean; result: ScannerResultV2 } });
      expect(ndjsonLines.map(({ type }) => type)).toEqual(['header', 'result', 'summary']);
      const ndjsonHeader = ndjsonLines[0]!;
      expect(ndjsonHeader.tool).toEqual(json.tool);
      const ndjsonItem = ndjsonLines[1]?.item;
      expect(ndjsonItem?.ok).toBe(true);
      assertValidResult(ndjsonItem?.result);
      expect(ndjsonItem?.result).toEqual(core);

      const sarif = JSON.parse(await runCli('sarif', directory)) as { version: string; $schema: string; runs: SarifRun[] };
      expect(sarif).toMatchObject({ version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json' });
      expect(sarif.runs).toHaveLength(1);
      const run = sarif.runs[0]!;
      expect(run.tool.driver).toMatchObject({ name: core.engine.id, version: core.engine.version });
      expect(run.properties.secureflow).toEqual({
        analysisStatus: core.analysis.status,
        engine: core.engine,
        profile: core.profile,
        ruleset: core.ruleset,
        semantics: core.semantics,
        targetContextDigest: core.target.contextDigest,
        limits: { schemaVersion: core.limits.schemaVersion, digest: core.limits.digest },
        counts: expect.any(Object),
        omissions: expect.any(Array),
      });
      expect(run.invocations[0]?.toolExecutionNotifications.map(({ descriptor }) => descriptor.id).sort())
        .toEqual(core.analysis.diagnostics.map(({ code }) => code).sort());
      expect(json.artifacts.profile).toEqual(core.profile);
      expect(json.artifacts.ruleset).toEqual(core.ruleset);
      expect(json.artifacts.semantics).toEqual(core.semantics);
      expect(json.tool).toMatchObject({ name: 'n8n-scan', version: expect.any(String), buildDigest: expect.any(String) });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
