import { SeverityPill } from '../report/report-blocks';

type Check = {
  name: string;
  fires: string;
  severities: string[];
  means: string;
  act: string;
};

/**
 * One row per policy in `beta-policies.ts`. Severities here are the ones the
 * policy can actually emit, not a guess: several policies grade themselves from
 * evidence strength, so the same check can appear as HIGH or as INFO.
 */
const CHECKS: Check[] = [
  {
    name: 'Shell command execution',
    fires: 'The workflow contains an Execute Command node.',
    severities: ['CRITICAL'],
    means:
      'This workflow can run shell commands on whatever machine runs n8n — not inside a sandbox. On n8n Cloud it is unavailable; self-hosted, it has the same reach as the n8n process itself.',
    act: 'Open the node and read the command before you import. If you did not write this workflow and cannot explain why it needs a shell, delete the node. There is almost always a dedicated node for the job.',
  },
  {
    name: 'Raw secret material',
    fires: 'A parameter value matches a known provider key format, or a parameter named like a secret holds a literal value.',
    severities: ['HIGH', 'MEDIUM', 'LOW'],
    means:
      'HIGH means the value looks like a real credential — a key shaped like the ones a provider issues. MEDIUM means a field named like a secret holds a pasted literal. LOW means only the field name suggests a secret.',
    act: 'Treat a HIGH finding as a leaked key: rotate it at the provider first, then move it into n8n Credentials so it lives outside the workflow file. Expressions and obvious placeholders are already ignored, so a finding here is not noise.',
  },
  {
    name: 'Authorization header',
    fires: 'A node sets an Authorization header directly.',
    severities: ['HIGH', 'INFO'],
    means:
      'HIGH means a token is pasted as a literal, so it travels with the file to anyone you share it with. INFO means the header is wired to an expression or credential, which is the recommended pattern and needs nothing from you.',
    act: 'For HIGH: rotate the token, then use a Header Auth credential instead. Exported workflows get pasted into forums and issue trackers, which is how header tokens leak.',
  },
  {
    name: 'Unauthenticated webhook',
    fires: 'A Webhook node has no authentication mode set.',
    severities: ['MEDIUM'],
    means:
      'Anyone who learns the URL may be able to trigger the workflow, depending on its validation and surrounding controls. Webhook URLs can leak through logs, browser history, and screenshots.',
    act: 'Set Header Auth or Basic Auth on the node, or put it behind a proxy. If it must stay open, make sure the workflow validates its input and cannot be replayed for profit.',
  },
  {
    name: 'Community node package',
    fires: 'A node type is outside the official n8n namespaces.',
    severities: ['LOW'],
    means:
      'The workflow may need a package installed from npm before it can run, and that code is maintained by a third party rather than n8n.',
    act: 'Check the package still exists and is maintained before you rely on it. This is the most common reason an imported workflow shows an unrecognised node.',
  },
  {
    name: 'Custom code node (JS AST & Python CST)',
    fires: 'The workflow contains a Code/Function node or uses dynamic execution, child-process, or network primitives in JavaScript or Python.',
    severities: ['HIGH', 'LOW'],
    means:
      'LOW flags any custom Code node for awareness. HIGH fires when the static JavaScript AST or Python CST parser detects dynamic code evaluation, subprocess execution, or sensitive runtime access.',
    act: 'Replace dynamic execution with reviewed static logic and narrow integrations instead of running untrusted expressions inside custom code.',
  },
  {
    name: 'Expression sandbox & environment exposure',
    fires: 'An n8n {{ ... }} expression escapes into constructor/eval/process chains or reads $env / $secrets / process.env.',
    severities: ['CRITICAL', 'HIGH'],
    means:
      'Sandbox escapes can execute arbitrary code in the worker; direct environment variable reads in expressions bypass managed n8n Credentials.',
    act: 'Remove dynamic evaluation or constructor traversal from expressions and move secrets into managed n8n Credentials.',
  },
  {
    name: 'Taint flow & AI agent egress',
    fires: 'Untrusted trigger or webhook input reaches a shell, SQL, file, code, URL, or header sink, or an unauthenticated/ungated AI agent holds external tools.',
    severities: ['CRITICAL', 'HIGH', 'MEDIUM'],
    means:
      'Traceable field-flow paths show where external data flows into privileged sinks without sanitization or human approval gates.',
    act: 'Require trigger authentication, place Wait/approval gates on agent and sink paths, and parameterize commands, queries, and URLs.',
  },
  {
    name: 'Unexpected outbound domain',
    fires: 'The workflow contacts a hostname you did not list as expected. Only runs when you supply a list.',
    severities: ['MEDIUM'],
    means:
      'A workflow that quietly posts to a host you were not expecting is the shape data exfiltration takes. With no list supplied, this check stays off, because everything would be unexpected.',
    act: 'Paste the hosts you expect into the expected-domains box, then rescan. Anything reported is a host you did not anticipate — confirm why it is there before importing.',
  },
];

export function ScannerChecks() {
  return (
    <section aria-labelledby="checks-heading" className="min-w-0 rounded-panel border border-hairline bg-panel p-4 sm:p-6">
      <h2 id="checks-heading" className="font-display text-lg font-semibold text-ink">
        What the scanner checks
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        All checks in v0.3 Standard and Strict profiles are 100% deterministic and run client-side in a
        Web Worker: structural policies, JavaScript AST, Python CST, expression escape and env exposure,
        taint flow, and AI agent egress. Zero workflow content ever leaves your browser.
      </p>

      <ul className="mt-5 flex flex-col gap-4">
        {CHECKS.map((check) => (
          <li key={check.name} className="border-t border-hairline pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">{check.name}</h3>
              {check.severities.map((severity) => (
                <SeverityPill key={severity} severity={severity} />
              ))}
            </div>
            <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[7rem_1fr]">
              <dt className="font-mono text-2xs uppercase tracking-wide text-ink-faint">Fires when</dt>
              <dd className="text-sm text-ink-muted">{check.fires}</dd>
              <dt className="font-mono text-2xs uppercase tracking-wide text-ink-faint">Meaning</dt>
              <dd className="text-sm text-ink-muted">{check.means}</dd>
              <dt className="font-mono text-2xs uppercase tracking-wide text-ink-faint">What to do</dt>
              <dd className="text-sm text-ink">{check.act}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
