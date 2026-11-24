/**
 * Configured external product links, or nothing.
 *
 * Both repositories were private when the site shipped a hardcoded link and a
 * "GitHub (private)" label — a dead target the page itself admitted. A link is
 * now a configuration decision: absent configuration renders no anchor at all
 * rather than a link that cannot be followed.
 *
 * This validator is external-link-specific: path, query, and fragment are all
 * allowed. `siteOrigin()` deliberately rejects query and fragment because it is
 * a canonical origin, so it is the wrong tool here.
 */
export const DEFAULT_PRODUCT_REPOSITORY_URL = 'https://github.com/jitwark/sfscanner';
export const DEFAULT_RULE_REFERENCE_URL = 'https://github.com/jitwark/sfscanner/blob/main/docs/scanner/generated/rules.md';
export const NPM_PACKAGE_URL = 'https://www.npmjs.com/package/sfscanner';

function httpsLink(raw: string | undefined, fallback?: string): string | null {
  const value = (raw === undefined ? (fallback ?? '') : raw).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export const productRepositoryUrl = () => httpsLink(process.env.NEXT_PUBLIC_PRODUCT_REPOSITORY_URL, DEFAULT_PRODUCT_REPOSITORY_URL);
export const scannerRuleReferenceUrl = () => httpsLink(process.env.NEXT_PUBLIC_RULE_REFERENCE_URL, DEFAULT_RULE_REFERENCE_URL);
