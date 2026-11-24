import { LegalSection, RequestChecklist } from './legal-page';
import { ContactEmail, PublicRequestLink } from './takedown-contact';

/**
 * Licence corrections, personal-data requests, security reports, and what
 * happens to any of them after they arrive.
 *
 * Personal data is kept deliberately separate from copyright. The catalogue
 * publishes the name and username of the upstream author for the great majority
 * of entries; that is personal data, the request has a statutory deadline, and
 * it must never be filed somewhere public.
 */
export function TakedownOtherRequests() {
  return (
    <>
      <LegalSection id="licence" heading="Licence correction">
        <p>
          Rights are decided per workflow, from the licence of the repository it was acquired
          from. That is only valid for work the repository owner actually wrote — a permissive
          licence file cannot license a workflow somebody else authored.
        </p>
        <p>
          Every entry in this catalogue is already link-only — no workflow JSON bodies are hosted or redistributed
          here. If an entry&rsquo;s recorded licence metadata or attribution is inaccurate, tell us which entries are
          affected so we can correct the metadata or exclude them from the index.
        </p>
        <RequestChecklist
          items={[
            'The source repository, and the paths or entry IDs affected.',
            'What the correct licence or attribution should be.',
            'Whether you want the metadata corrected or the entries removed from the catalogue.',
          ]}
        />
      </LegalSection>

      <LegalSection id="personal-data" heading="Personal data">
        <p>
          Each entry records the upstream author&rsquo;s name and platform username, taken from
          the public source it was acquired from. If that is you, you can ask what is held, ask
          for it to be corrected, ask for it to be erased, or object to it being published at all.
        </p>
        <p>
          You do not need an account, and you should <strong className="font-semibold text-ink">not</strong>{' '}
          file this in public. Email it. A request of this kind carries your identity, and a public
          issue tracker would publish exactly the thing you are asking to have removed.
        </p>
        <RequestChecklist
          items={[
            'The catalogue URL or entry ID, or the upstream username the entries were attributed to.',
            'What you want: a copy of what is held, a correction, erasure, or an objection to publication.',
            'Enough for us to be confident the account is yours — a note from the account itself is usually enough.',
          ]}
        />
        <p>
          Requests are answered within one month. If a request is complex enough to need longer,
          you will be told inside that month, with the reason. Erasure is applied to the pipeline
          exclusion list, not by hand, so that it survives the next rebuild rather than quietly
          reappearing.
        </p>
        <p className="text-sm">
          Send to: <ContactEmail />
        </p>
      </LegalSection>

      <LegalSection id="security" heading="Security disclosure">
        <p>
          If you have found a vulnerability in this site or in the scanner, report it privately
          by email first and give us a chance to fix it. No legal action will be taken against anyone
          acting in good faith under this policy.
        </p>
        <p>
          Routine licence corrections that contain no personal data, credentials, or security
          details may <PublicRequestLink />. Keep privacy and security reports private by email.
        </p>
        <p>
          Do not include credentials, live secrets, or another person&rsquo;s data in a report. If
          you found a workflow in the catalogue that still contains a working credential, say
          which entry and do not quote the value — the sanitiser missing one is exactly the sort
          of bug worth reporting.
        </p>
      </LegalSection>

      <LegalSection id="what-happens" heading="What happens to a request">
        <p>
          A maintainer checks the request against the provenance recorded on the entry — the source,
          the commit, and the upstream path. A confirmed source removal marks that source excluded; a confirmed
          entry removal records its stable ID in the pipeline exclusion list. The catalogue is then rebuilt and
          verified so the entry is absent from all packed detail buckets, search indexes, and static pages before
          redeployment.
        </p>
        <p>
          Unrelated entries are re-checked afterwards so a removal never affects anything else. Requests are
          acknowledged within three business days.
        </p>
        <p>
          Please do not include credentials, workflow secrets, or customer data in any request on
          this page. Private requests: <ContactEmail />.
        </p>
      </LegalSection>
    </>
  );
}
