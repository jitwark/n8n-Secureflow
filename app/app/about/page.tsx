import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/src/ui/breadcrumbs';
import { JsonLdScript, pageJsonLd } from '../../src/seo/json-ld';
import { canonicalAlternates } from '../../src/seo/page-meta';
import { isPreviewBuild } from '../../src/seo/robots';
import { PublicRequestLink } from '../../src/ui/legal/takedown-contact';
import { NPM_PACKAGE_URL, productRepositoryUrl } from '../../src/ui/product-links';

export const metadata: Metadata = {
  ...(isPreviewBuild() ? {} : { alternates: canonicalAlternates('/about/') }),
  title: 'About · n8n-secureflow',
  description: 'Deterministic offline n8n security scanner (CLI, MCP, browser) and link-only community workflow catalogue.',
};

export default function AboutPage() {
  const repositoryUrl = productRepositoryUrl();
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about/' },
  ];

  return (
    <article className="mx-auto max-w-4xl space-y-10 pb-10">
      <JsonLdScript
        data={pageJsonLd({
          name: 'About',
          path: '/about/',
          description: 'What n8n-secureflow ships, how the v0.3 deterministic scanner works, how entries are licensed, and how to request removal.',
        })}
      />
      <Breadcrumbs items={breadcrumbItems} />

      <header className="space-y-4 border-b border-hairline pb-6">
        <p className="font-mono text-2xs font-bold uppercase tracking-[0.16em] text-accent-text">
          About · sfscanner v0.3
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Deterministic, offline security scanning for n8n workflows
        </h1>
        <p className="max-w-3xl text-base leading-7 text-ink-muted">
          n8n-secureflow pairs an open-source, zero-network static security engine with a searchable, link-only
          catalogue of community n8n workflows. Everything runs locally — your workflow JSON never leaves your machine.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/scanner/"
            prefetch={false}
            className="inline-flex min-h-10 items-center justify-center rounded-control bg-accent px-4 font-sans text-xs font-bold text-accent-ink hover:brightness-95"
          >
            Open Browser Scanner
          </Link>
          <a
            href={NPM_PACKAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-control border border-hairline bg-panel px-4 font-sans text-xs font-bold text-ink hover:bg-raised"
          >
            npm: sfscanner ↗
          </a>
          {repositoryUrl ? (
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center justify-center rounded-control border border-hairline bg-panel px-4 font-sans text-xs font-bold text-ink hover:bg-raised"
            >
              GitHub Repository ↗
            </a>
          ) : null}
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="font-display text-xl font-semibold text-ink">Three ways to run the same engine</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-panel border border-hairline bg-panel p-5 space-y-2">
            <p className="font-mono text-2xs font-bold uppercase tracking-wider text-accent-text">Browser</p>
            <h3 className="font-sans text-base font-bold text-ink">Zero-Upload Web Scanner</h3>
            <p className="text-sm leading-6 text-ink-muted">
              Runs inside a browser Web Worker with zero server calls, zero accounts, and zero telemetry.
            </p>
          </div>
          <div className="rounded-panel border border-hairline bg-panel p-5 space-y-2">
            <p className="font-mono text-2xs font-bold uppercase tracking-wider text-accent-text">CLI &amp; CI</p>
            <h3 className="font-sans text-base font-bold text-ink">sfscanner on npm</h3>
            <p className="text-sm leading-6 text-ink-muted">
              1.08 MiB unpacked CLI supporting <code className="font-mono text-xs">pretty</code>,{' '}
              <code className="font-mono text-xs">markdown</code>, <code className="font-mono text-xs">sarif</code>,{' '}
              <code className="font-mono text-xs">--baseline</code>, and strict CI gates.
            </p>
          </div>
          <div className="rounded-panel border border-hairline bg-panel p-5 space-y-2">
            <p className="font-mono text-2xs font-bold uppercase tracking-wider text-accent-text">AI Agents</p>
            <h3 className="font-sans text-base font-bold text-ink">MCP Server</h3>
            <p className="text-sm leading-6 text-ink-muted">
              Ships <code className="font-mono text-xs">sfscanner-mcp</code> over stdio so AI coding agents can
              audit n8n workflows locally before importing them.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-hairline pt-6">
        <h2 className="font-display text-xl font-semibold text-ink">What v0.3 checks — and its honest limits</h2>
        <p className="text-sm leading-6 text-ink-muted">
          The default <code className="font-mono text-xs text-ink">standard@3.0.0</code> profile runs 21 deterministic
          rules covering unauthenticated trigger-to-sink paths, cross-node taint flow, expression sandbox escapes and{' '}
          <code className="font-mono text-xs text-ink">$env</code> reads, JavaScript AST, Python CST, and unrestricted
          AI agent egress. Scoring is monotonic: adding a finding can never lower a risk score.
        </p>
        <p className="text-sm leading-6 text-ink-muted">
          Static analysis is an advisory triage signal, not a safety guarantee. The scanner never executes workflows and
          cannot inspect your live n8n instance&rsquo;s credential store, network firewall, or deployment configuration.
        </p>
      </section>

      <section className="space-y-3 border-t border-hairline pt-6">
        <h2 className="font-display text-xl font-semibold text-ink">Link-Only Catalogue &amp; Rights</h2>
        <p className="text-sm leading-6 text-ink-muted">
          No workflow JSON bodies are hosted or redistributed here. Every entry in the catalogue is strictly{' '}
          <strong className="text-ink">link-only</strong>: this site publishes derived structural summaries, interactive
          node graphs, security findings, and a verified permalink back to the original upstream source.
        </p>
      </section>

      <section className="space-y-3 border-t border-hairline pt-6">
        <h2 className="font-display text-xl font-semibold text-ink">Open Source &amp; Community</h2>
        <p className="text-sm leading-6 text-ink-muted">
          {repositoryUrl ? (
            <>
              Source code, deterministic security rules, and documentation are MIT-licensed and public on GitHub:{' '}
              <a
                href={repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-accent-text underline underline-offset-2 hover:brightness-110"
              >
                {repositoryUrl}
              </a>
              .
            </>
          ) : (
            'Source code, deterministic security rules, and pipeline tools live in the project repository, which is not configured for this build.'
          )}
        </p>
      </section>

      <section className="space-y-3 rounded-panel border border-hairline bg-panel p-6">
        <h2 className="font-display text-xl font-semibold text-ink">Takedown &amp; Removal Requests</h2>
        <p className="text-sm leading-6 text-ink-muted">
          If you are a workflow author, copyright holder, or repository owner and want an entry corrected or removed,
          use the{' '}
          <Link href="/takedown/" className="font-semibold text-accent-text underline underline-offset-2">
            removal requests page
          </Link>
          . Confirmed removals are added to the pipeline exclusion list so they never reappear on future rebuilds.
        </p>
        <p className="text-sm leading-6 text-ink-muted">
          Routine licence corrections with no personal or sensitive data may also{' '}
          <PublicRequestLink />. Keep personal-data, copyright, and security reports private by email.
        </p>
      </section>
    </article>
  );
}
