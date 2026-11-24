import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type * as NodeFs from 'node:fs';

const execution = vi.hoisted(() => {
  const { writeFileSync } = process.getBuiltinModule('node:fs') as typeof NodeFs;
  const mainFixture = `.task3-main-v2-${process.pid}.json`;
  writeFileSync(mainFixture, '{"nodes":[],"connections":{}}\n');
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  process.argv = [
    'node',
    'n8n-scan',
    '--schema',
    'v2',
    'scan',
    mainFixture,
    '--format',
    'json',
  ];
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write);
  return { previousArgv, previousExitCode, stdout, stderr, stdoutWrite, stderrWrite, mainFixture };
});

import '../main';

afterAll(() => {
  const { rmSync } = process.getBuiltinModule('node:fs') as typeof NodeFs;
  rmSync(execution.mainFixture, { force: true });
  execution.stdoutWrite.mockRestore();
  execution.stderrWrite.mockRestore();
  process.argv = execution.previousArgv;
  process.exitCode = execution.previousExitCode;
});


describe('main v2 dispatch', () => {
  it('runs a parsed v2 scan through the executable path', () => {
    expect(process.exitCode).toBe(0);
    expect(execution.stderr.join('')).toBe('');
    expect(execution.stdout.join('')).not.toContain('The v2 scan runner is not available.');
    expect(JSON.parse(execution.stdout.join(''))).toMatchObject({
      schemaVersion: 'n8n-scan-v2',
      exitReason: 'UNDER_THRESHOLD',
    });
  });

  it('defaults to pretty when stdout is a TTY without --format and json when piped or explicitly --format json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-main-tty-'));
    try {
      writeFileSync(join(dir, 'wf.json'), '{"nodes":[],"connections":{}}\n');
      writeFileSync(join(dir, 'tty.mjs'), 'Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });\n');
      const mainDist = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
      const ttyRun = spawnSync(process.execPath, ['--import', './tty.mjs', mainDist, 'scan', 'wf.json'], { cwd: dir, encoding: 'utf8' });
      expect(ttyRun.status).toBe(0);
      expect(ttyRun.stdout).toContain('LOW');
      expect(ttyRun.stdout.trimStart().startsWith('{')).toBe(false);

      const explicitJson = spawnSync(process.execPath, ['--import', './tty.mjs', mainDist, 'scan', 'wf.json', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
      expect(explicitJson.status).toBe(0);
      expect(JSON.parse(explicitJson.stdout)).toMatchObject({ schemaVersion: 'n8n-scan-v2', artifacts: { profile: { id: 'standard', version: '3.0.0' } } });

      const pipedRun = spawnSync(process.execPath, [mainDist, 'scan', 'wf.json'], { cwd: dir, encoding: 'utf8' });
      expect(pipedRun.status).toBe(0);
      expect(JSON.parse(pipedRun.stdout)).toMatchObject({ schemaVersion: 'n8n-scan-v2', artifacts: { profile: { id: 'standard', version: '3.0.0' } } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
