import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/seo/json-ld', () => ({
  JsonLdScript: ({ data }: { data: { description?: string } }) => (
    <script data-testid="jsonld">{JSON.stringify(data)}</script>
  ),
  pageJsonLd: (options: unknown) => options,
}));

import AboutPage from './page';

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('AboutPage', () => {
  it('links to the public GitHub repository and npm package by default', () => {
    render(<AboutPage />);

    const ghLinks = screen.getAllByRole('link', { name: /github/i });
    expect(ghLinks.some((link) => link.getAttribute('href') === 'https://github.com/jitwark/sfscanner')).toBe(true);
    expect(screen.getByRole('link', { name: /npm: sfscanner/i }).getAttribute('href'))
      .toBe('https://www.npmjs.com/package/sfscanner');
    expect(screen.getByRole('heading', { name: /Takedown & Removal Requests/i })).toBeTruthy();
  });

  it('omits the repository link when explicitly blanked out', () => {
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_REPOSITORY_URL', '');
    render(<AboutPage />);

    expect(screen.queryByRole('link', { name: /github/i })).toBeNull();
    expect(document.body.textContent).toContain('not configured for this build');
  });

  it('renders an overridden repository link when configured', () => {
    vi.stubEnv('NEXT_PUBLIC_PRODUCT_REPOSITORY_URL', 'https://example.test/repo');
    render(<AboutPage />);

    expect(screen.getByRole('link', { name: /example\.test\/repo/ }).getAttribute('href'))
      .toBe('https://example.test/repo');
  });
});
