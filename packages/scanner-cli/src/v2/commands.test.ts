import { describe, expect, it } from 'vitest';
import {
  explainDocumentV2,
  profilesDocumentV2,
  rulesDocumentV2,
  runCommandV2,
  validateConfigDocumentV2,
  versionDocumentV2,
} from './commands';

describe('v2 non-scan commands', () => {
  it('emits a closed, ordered rules document covering all 21 v0.3 rules', () => {
    const first = rulesDocumentV2();
    const second = rulesDocumentV2();
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('n8n-scan-rules-v2');
    expect(first.rules).toHaveLength(21);
    expect(first.rules.map(({ ruleId }) => ruleId)).toEqual([
      'N8N_EXECUTE_COMMAND', 'N8N_CODE_NODE', 'RAW_AUTH_HEADER', 'RAW_SECRET_INDICATOR',
      'UNAPPROVED_DOMAIN', 'UNKNOWN_NODE_PACKAGE', 'WEBHOOK_EXPOSURE',
      'JAVASCRIPT_DYNAMIC_EXECUTION', 'PYTHON_DYNAMIC_EXECUTION',
      'TAINTED_COMMAND', 'TAINTED_SQL_QUERY', 'TAINTED_REQUEST_URL', 'TAINTED_FILE_PATH',
      'TAINTED_CODE_INPUT', 'TAINTED_REQUEST_HEADER', 'TAINTED_AI_PROMPT',
      'AI_AGENT_UNGATED_TOOL', 'EXPRESSION_SANDBOX_ESCAPE', 'EXPRESSION_ENV_EXPOSURE',
      'AGENT_EGRESS_UNRESTRICTED', 'UNAUTHENTICATED_TRIGGER_TO_SINK',
    ]);
    expect(first.rules.every((rule) => rule.effect === 'SCORING')).toBe(true);
    expect(Object.isFrozen(first) && Object.isFrozen(first.rules)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/https?:\/\/|[A-Z]:\\/);
    const auth = first.rules.find(({ ruleId }) => ruleId === 'RAW_AUTH_HEADER');
    expect(auth?.cweIds).toEqual(['CWE-522', 'CWE-798']);
    expect(Object.isFrozen(first.artifacts) && Object.isFrozen(first.artifacts.target) && Object.isFrozen(first.artifacts.target.communityPackages)).toBe(true);
  });
  it('explains all 21 admitted rules and rejects unknown rules before output', () => {
    for (const ruleId of ['N8N_EXECUTE_COMMAND', 'TAINTED_COMMAND', 'EXPRESSION_SANDBOX_ESCAPE', 'EXPRESSION_ENV_EXPOSURE', 'AGENT_EGRESS_UNRESTRICTED', 'UNAUTHENTICATED_TRIGGER_TO_SINK']) {
      const result = explainDocumentV2(ruleId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.document.schemaVersion).toBe('n8n-scan-explain-v2');
        expect(result.document.rule).toMatchObject({ ruleId, effect: 'SCORING' });
        expect(result.document.provenance).toEqual(expect.objectContaining({ packDigest: expect.any(String), semanticsDigest: expect.any(String) }));
        expect(Object.isFrozen(result.document)).toBe(true);
      }
    }
    expect(explainDocumentV2('NOT_A_RULE')).toMatchObject({ ok: false, code: 'USAGE' });
  });

  it('advertises and admits all four executable profiles', () => {
    const document = profilesDocumentV2();
    expect(document.schemaVersion).toBe('n8n-scan-profiles-v2');
    expect(document.profiles.map(({ id, version, admitted, advertised }) => ({ id, version, admitted, advertised }))).toEqual([
      { id: 'beta-default', version: '2.0.0', admitted: true, advertised: true },
      { id: 'beta-hardened', version: '2.0.0', admitted: true, advertised: true },
      { id: 'standard', version: '3.0.0', admitted: true, advertised: true },
      { id: 'strict', version: '3.0.0', admitted: true, advertised: true },
    ]);
    expect(document.profiles.every((profile) => profile.capabilities.length > 0)).toBe(true);
  });

  it('emits version and valid configuration metadata without reading source content', () => {
    expect(versionDocumentV2()).toMatchObject({
      schemaVersion: 'n8n-scan-version-v2', name: 'n8n-scan', cliVersion: '0.3.1',
      configSchema: 'n8n-scan-config-v2', mode: 'offline',
    });
    const valid = validateConfigDocumentV2({ schemaVersion: 'n8n-scan-config-v2' });
    expect(valid.ok && valid.document).toMatchObject({ schemaVersion: 'n8n-scan-config-validation-v2', valid: true });
    expect(runCommandV2({ kind: 'rules', schema: 'v2', format: 'json' })).toMatchObject({ ok: true, document: { schemaVersion: 'n8n-scan-rules-v2' } });
    for (const profile of ['standard', 'strict', 'beta-default', 'beta-hardened'] as const) {
      expect(runCommandV2({
        kind: 'scan', schema: 'v2', inputs: ['wf.json'], format: 'json', profile,
        failOn: 'INFO', requireComplete: false, concurrency: 1, rules: 'builtin', catalogue: 'builtin',
        limits: 'builtin', edition: 'UNKNOWN', deployment: 'UNKNOWN', role: 'UNKNOWN', taskRunner: 'UNKNOWN',
        communityPackages: [], configuration: [], approvedDomains: [], include: [], exclude: [],
        allowUnsignedDevelopmentRules: false, noColor: false, auditSupplyChain: false, includeReadiness: false, cliOverrides: {},
      })).toMatchObject({ ok: true });
    }
  });
  it('rejects unsafe validate-config paths before reading', () => {
    const command = (path: string) => ({ kind: 'validate-config' as const, schema: 'v2' as const, format: 'json' as const, path });
    for (const path of ['../config.json', 'nested/../../config.json', '/tmp/config.json', 'C:\\config.json', 'https://example.test/config.json', '\\\\server\\config.json']) {
      expect(runCommandV2(command(path))).toEqual({ ok: false, code: 'USAGE', message: 'Configuration path is not admitted.' });
    }
  });
  it('refuses fix commands from the metadata reducer without reading the workflow', () => {
    const command = { kind: 'fix' as const, schema: 'v2' as const, action: 'apply' as const, format: 'json' as const, root: 'C:/work', input: 'absent/workflow.json', fix: 'fix-1', confirm: true };
    const result = runCommandV2(command);
    expect(result).toEqual({ ok: false, code: 'USAGE', message: 'Fix commands are not metadata commands.' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/workflow\.json|fix-1/u);
  });
});
