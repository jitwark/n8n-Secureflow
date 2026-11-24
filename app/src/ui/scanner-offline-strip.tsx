import { NPM_PACKAGE_URL, productRepositoryUrl } from './product-links';

const MCP_SNIPPET = `{
  "mcpServers": {
    "sfscanner": {
      "command": "npx",
      "args": ["-y", "-p", "sfscanner", "sfscanner-mcp"]
    }
  }
}`;

export function ScannerOfflineStrip() {
  const repositoryUrl = productRepositoryUrl();

  return (
    <section aria-labelledby="scanner-offline-heading" className="border-t border-hairline pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-1.5">
          <p className="font-mono text-2xs font-bold uppercase tracking-[0.16em] text-accent-text">
            Offline CLI · npm · MCP Server
          </p>
          <h2 id="scanner-offline-heading" className="font-sans text-xl font-bold text-ink">
            Download and run sfscanner offline on your machine or in CI
          </h2>
          <p className="text-sm leading-6 text-ink-muted">
            The same deterministic v0.3 engine ships as a lightweight <strong className="text-ink">1.08 MiB</strong>{' '}
            npm package (<code className="font-mono text-xs text-ink">sfscanner@0.3.1</code>) with zero network calls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href={NPM_PACKAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-control bg-accent px-4 font-sans text-xs font-bold text-accent-ink transition-colors hover:brightness-95"
          >
            npm: sfscanner
          </a>
          {repositoryUrl ? (
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-hairline bg-panel px-4 font-sans text-xs font-bold text-ink transition-colors hover:bg-raised"
            >
              <span>GitHub Repository</span>
              <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2.5 rounded-panel border border-hairline bg-panel p-4">
          <h3 className="font-display text-sm font-semibold text-ink">1. Quick CLI scan (Node 20+)</h3>
          <p className="text-xs leading-5 text-ink-muted">
            Scan a single workflow or an entire folder locally with colorized traces, Markdown, or SARIF for GitHub Code Scanning.
          </p>
          <pre className="overflow-x-auto rounded-control border border-hairline bg-raised p-3 font-mono text-2xs leading-5 text-ink">
            <code>{`# Scan one workflow (pretty output)
npx sfscanner scan workflow.json

# Strict CI gate + SARIF report
npx sfscanner --schema v2 scan ./workflows \\
  --profile strict --format sarif \\
  --output results.sarif --fail-on HIGH`}</code>
          </pre>
        </div>

        <div className="flex flex-col gap-2.5 rounded-panel border border-hairline bg-panel p-4">
          <h3 className="font-display text-sm font-semibold text-ink">2. Install &amp; run air-gapped</h3>
          <p className="text-xs leading-5 text-ink-muted">
            Install globally once or pack a standalone <code className="font-mono">.tgz</code> tarball to copy onto an offline machine.
          </p>
          <pre className="overflow-x-auto rounded-control border border-hairline bg-raised p-3 font-mono text-2xs leading-5 text-ink">
            <code>{`# Global install for offline terminal use
npm install -g sfscanner
sfscanner scan workflow.json

# Pack tarball for air-gapped transfer
npm pack sfscanner
npm install -g ./sfscanner-0.3.1.tgz`}</code>
          </pre>
          {repositoryUrl ? (
            <p className="text-2xs text-ink-muted">
              Source &amp; releases:{' '}
              <a
                href={`${repositoryUrl}/releases`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-accent-text underline underline-offset-2"
              >
                GitHub Releases
              </a>
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5 rounded-panel border border-hairline bg-panel p-4">
          <h3 className="font-display text-sm font-semibold text-ink">3. Connect to AI agents (MCP)</h3>
          <p className="text-xs leading-5 text-ink-muted">
            Expose the offline <code className="font-mono">n8n_scan</code> tool over stdio so coding agents audit workflows before importing them.
          </p>
          <pre className="overflow-x-auto rounded-control border border-hairline bg-raised p-3 font-mono text-2xs leading-5 text-ink">
            <code>{MCP_SNIPPET}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
