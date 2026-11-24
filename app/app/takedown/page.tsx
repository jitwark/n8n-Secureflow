import type { Metadata } from 'next';
import { JsonLdScript, pageJsonLd } from '../../src/seo/json-ld';
import { LegalPage } from '../../src/ui/legal/legal-page';
import { TakedownCopyright } from '../../src/ui/legal/takedown-copyright';
import { TakedownOtherRequests } from '../../src/ui/legal/takedown-other-requests';
import { lastUpdated } from '../../src/ui/legal/legal-contacts';
import { canonicalAlternates } from '../../src/seo/page-meta';
import { isPreviewBuild } from '../../src/seo/robots';
import { productRepositoryUrl } from '../../src/ui/product-links';

export const metadata: Metadata = {
  title: 'Removal requests · n8n-secureflow',
  description:
    'Request correction or removal of a workflow entry, source, or personal data: copyright, licence metadata, privacy, and security reports.',
  ...(isPreviewBuild() ? {} : { alternates: canonicalAlternates('/takedown/') }),
};

const REQUEST_CARDS = [
  { href: '#copyright', tag: 'DMCA', label: 'Copyright removal', detail: 'Remove a workflow or repository from the index.' },
  { href: '#licence', tag: 'Metadata', label: 'Licence correction', detail: 'Fix recorded licence or attribution on link-only entries.' },
  { href: '#personal-data', tag: 'Privacy', label: 'Personal data', detail: 'Erase or correct author names and usernames privately.' },
  { href: '#security', tag: 'Disclosure', label: 'Security report', detail: 'Report a scanner bug or exposed credential privately.' },
] as const;

export default function TakedownPage() {
  const repositoryUrl = productRepositoryUrl();

  return (
    <>
      <JsonLdScript
        data={pageJsonLd({
          name: 'Removal requests',
          path: '/takedown/',
          description:
            'How to request removal of a workflow, a source, or personal data from the n8n-secureflow catalogue.',
        })}
      />
      <LegalPage
        title="Removal requests"
        updated={lastUpdated}
        intro={
          <>
            <p>
              This catalogue is strictly <strong className="font-semibold text-ink">link-only</strong> — no workflow
              JSON bodies are hosted or redistributed here. Every entry stores derived structural/security metadata,
              author attribution from the upstream source, and a link back to the original location.
            </p>
            <p className="mt-3">
              If something here is yours and you want it corrected or removed, pick the request type below. You do not
              need an account anywhere, and confirmed removals are recorded in our pipeline exclusion list so they never
              reappear on future rebuilds.
            </p>
            {repositoryUrl ? (
              <p className="mt-3 text-xs text-ink-muted">
                Non-personal documentation or licence metadata fixes can also be tracked on{' '}
                <a
                  href={`${repositoryUrl}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent-text underline underline-offset-2 hover:text-ink"
                >
                  GitHub Issues ↗
                </a>
                . Keep copyright, personal-data, and security reports private via email.
              </p>
            ) : null}
          </>
        }
      >
        <nav aria-label="Request types" className="grid gap-3 sm:grid-cols-2">
          {REQUEST_CARDS.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-1 rounded-panel border border-hairline bg-panel p-4 transition-colors hover:border-hairline-strong hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent-border"
            >
              <span className="font-mono text-2xs font-bold uppercase tracking-wider text-accent-text">
                {card.tag}
              </span>
              <span className="font-sans text-sm font-bold text-ink group-hover:text-accent-text">
                {card.label} →
              </span>
              <span className="text-xs leading-5 text-ink-muted">{card.detail}</span>
            </a>
          ))}
        </nav>

        <TakedownCopyright />
        <TakedownOtherRequests />
      </LegalPage>
    </>
  );
}
