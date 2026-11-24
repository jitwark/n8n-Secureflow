import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GATE_SEQUENCES, createGateSummary, runSequence, selectGateSequence, writeGateSummary } from './run-gates.mjs';

describe('run-gates', () => {
  it('keeps build before every build-dependent gate', () => {
    const commands = GATE_SEQUENCES.gates;
    const build = commands.indexOf('build');

    expect(build).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf('check:browser-safe:emitted')).toBe(build + 1);
    expect(build).toBeLessThan(commands.indexOf('check:links'));
    expect(build).toBeLessThan(commands.indexOf('test'));
    expect(build).toBeLessThan(commands.indexOf('test:e2e'));
  });

  it('builds the packaged CLI before every gate that resolves its subpaths', () => {
    for (const sequence of [GATE_SEQUENCES.gates, GATE_SEQUENCES.source]) {
      expect(sequence).toContain('build:scanner');
      expect(sequence.indexOf('build:scanner')).toBeLessThan(sequence.indexOf('typecheck'));
    }
    expect(GATE_SEQUENCES.gates.indexOf('build:scanner')).toBeLessThan(GATE_SEQUENCES.gates.indexOf('check:scanner-parity'));
    expect(GATE_SEQUENCES.gates.indexOf('build:scanner')).toBeLessThan(GATE_SEQUENCES.gates.indexOf('test'));
    expect(GATE_SEQUENCES.gates[0]).toBe('check:file-size:all');
    expect(GATE_SEQUENCES.source).not.toContain('build');
  });

  it('runs authority and v2 parity gates cleanly across sequences', () => {
    expect(GATE_SEQUENCES.gates).toContain('check:scanner-authority');
    expect(GATE_SEQUENCES.gates).toContain('check:scanner-v2-parity');
    expect(GATE_SEQUENCES.source).toContain('check:scanner-authority');
    expect(GATE_SEQUENCES.source).not.toContain('check:scanner-v2-parity');
    expect(GATE_SEQUENCES.gates.indexOf('build:scanner')).toBeLessThan(GATE_SEQUENCES.gates.indexOf('check:scanner-v2-parity'));
  });

  it('excludes every corpus-dependent gate from the source sequence', () => {
    const corpusDependent = ['build', 'check:specs', 'check:docs', 'check:links', 'check:browser-safe:emitted', 'test:e2e'];
    for (const gate of corpusDependent) {
      expect(GATE_SEQUENCES.source).not.toContain(gate);
    }
  });

  it('keeps every corpus-independent gate in the source sequence', () => {
    const required = [
      'check:file-size:all',
      'check:browser-safe',
      'check:contrast',
      'check:import-boundary',
      'check:scanner-import-boundary',
      'typecheck',
      'lint',
      'audit',
      'check:scanner-calibration',
      'check:scanner-parity',
      'check:scanner-goldens',
      'check:scanner-core:bare-node',
    ];
    for (const gate of required) expect(GATE_SEQUENCES.source).toContain(gate);
  });

  it('runs the source sequence in the same relative order as the core sequence', () => {
    const core = GATE_SEQUENCES.gates;
    const positions = GATE_SEQUENCES.source.filter((gate) => core.includes(gate)).map((gate) => core.indexOf(gate));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('stops at the first nonzero command and does not run later gates', () => {
    const seen = [];
    const status = runSequence(GATE_SEQUENCES.gates, (command) => {
      seen.push(command);
      return command === 'build' ? 7 : 0;
    });

    expect(status).toBe(7);
    expect(seen.at(-1)).toBe('build');
    expect(seen).not.toContain('check:links');
    expect(seen).not.toContain('test');
    expect(seen).not.toContain('test:e2e');
  });

  it('returns the configured sequence via selectGateSequence', () => {
    expect(selectGateSequence('gates')).toBe(GATE_SEQUENCES.gates);
    expect(selectGateSequence('source')).toBe(GATE_SEQUENCES.source);
    expect(selectGateSequence('release')).toBe(GATE_SEQUENCES.release);
  });

  it('creates a sanitized summary with commit and release identities', () => {
    const summary = createGateSummary({
      mode: 'release',
      status: 0,
      startedAt: '2026-08-28T00:00:00.000Z',
      finishedAt: '2026-08-28T00:00:01.250Z',
      durationMs: 1250,
      identities: {
        commit: 'a'.repeat(40),
        release: { corpusId: 'data', generatedAt: '2026-08-27T00:00:00.000Z', corpusSha256: 'b'.repeat(64), manifestSha256: 'c'.repeat(64) },
      },
      commands: [{ command: 'build', status: 0, durationMs: 1250 }],
    });
    expect(summary.status).toBe('passed');
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  it('writes the summary to the configured evidence path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'community-hub-gates-'));
    const previousPath = process.env.GATE_SUMMARY_PATH;
    const summaryPath = join(directory, 'summary.json');
    process.env.GATE_SUMMARY_PATH = summaryPath;
    const summary = { schemaVersion: 'gate-summary-v1', status: 'passed' };
    try {
      expect(writeGateSummary(summary)).toBe(summaryPath);
      expect(JSON.parse(readFileSync(summaryPath, 'utf8'))).toEqual(summary);
    } finally {
      if (previousPath === undefined) delete process.env.GATE_SUMMARY_PATH;
      else process.env.GATE_SUMMARY_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
