import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { appPath } from './app-paths';

const SEARCH_ARTIFACT = /\/data\/(?:manifest\.json|facets\.json|search-index(?:-extended)?\.json(?:\.gzbin)?|semantic-index\.json(?:\.gzbin)?)$/;
const PRIMARY_INDEX = /\/data\/search-index\.json(?:\.gzbin)?$/;
declare global {
  interface Window { __homeSearchWorkerReady?: boolean }
}
const SEARCH_CLIENT_CHUNKS = (() => {
  const manifestPath = resolve(__dirname, '..', '.next', 'react-loadable-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { files?: string[] }>;
  const entry = Object.entries(manifest).find(([key]) => /home-search\.tsx\s*->\s*\.\.\/search\/search-client$/i.test(key));
  const files = entry?.[1].files?.filter((file) => file.endsWith('.js')) ?? [];
  if (!files.length) throw new Error('Search client chunk is missing from react-loadable-manifest.json');
  return files.map((file) => `/_next/${file.replace(/^\/+/, '')}`);
})();

test('homepage keeps search artifacts cold until focus and reuses the warm load', async ({ page }) => {
  // Two deliberate cold waits, remote data transfer and worker startup precede
  // the five-second suggestion assertion. Keep that UI bound independent of
  // the complete multi-phase case budget, as in the library containment cases.
  test.setTimeout(120_000);
  const searchRequests: string[] = [];
  const searchClientChunkRequests: string[] = [];
  let primaryIndexRequests = 0;
  let notifyPrimaryIndexRequest!: () => void;
  let releasePrimaryIndex!: () => void;
  const primaryIndexRequested = new Promise<void>((resolve) => { notifyPrimaryIndexRequest = resolve; });
  const primaryIndexGate = new Promise<void>((resolve) => { releasePrimaryIndex = resolve; });
  // Observe the real worker protocol; do not initialize, replace responses or
  // prime its cache. A queued query must still produce actual visible results.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          if (event.data?.type === 'ready') window.__homeSearchWorkerReady = true;
        });
      }
    };
  });
  await page.route('**/data/search-index.json*', async (route) => {
    primaryIndexRequests += 1;
    notifyPrimaryIndexRequest();
    await primaryIndexGate;
    await route.continue();
  });
  try {
    page.on('request', (request) => {
      const url = request.url();
      const pathname = new URL(url).pathname;
      if (SEARCH_ARTIFACT.test(pathname)) searchRequests.push(url);
      if (SEARCH_CLIENT_CHUNKS.some((chunkPath) => pathname.endsWith(chunkPath))) searchClientChunkRequests.push(url);
    });

    await page.goto(appPath('/'));
    const search = page.getByRole('combobox');
    await expect(search).toBeVisible();
    await page.waitForTimeout(3_500);
    expect(searchRequests).toEqual([]);
    expect(searchClientChunkRequests).toEqual([]);

    const defaultViewport = page.viewportSize() ?? { width: 1280, height: 720 };
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize(defaultViewport);
    expect(searchRequests).toEqual([]);
    expect(searchClientChunkRequests).toEqual([]);

    const footer = page.getByRole('contentinfo');
    await footer.scrollIntoViewIfNeeded();
    const footerLibraryLink = footer.getByRole('link', { name: 'Library' });
    await footerLibraryLink.scrollIntoViewIfNeeded();
    await expect(footerLibraryLink).toBeInViewport();
    await page.waitForTimeout(3_500);
    expect(searchRequests).toEqual([]);
    expect(searchClientChunkRequests).toEqual([]);

    await search.focus();
    await expect.poll(() => searchClientChunkRequests.length).toBeGreaterThan(0);
    await primaryIndexRequested;
    expect(searchClientChunkRequests.length).toBeGreaterThan(0);
    expect(searchRequests.filter((url) => PRIMARY_INDEX.test(new URL(url).pathname))).toHaveLength(1);
    await search.fill('slack');
    await expect(page.getByRole('status')).toHaveText('Loading suggestions…');
    await page.evaluate(() => { window.__homeSearchWorkerReady = false; });
    const primaryIndexResponse = page.waitForResponse((response) => PRIMARY_INDEX.test(new URL(response.url()).pathname));
    releasePrimaryIndex();
    const response = await primaryIndexResponse;
    expect(await response.finished()).toBeNull();
    expect(response.ok()).toBe(true);
    await page.waitForFunction(() => window.__homeSearchWorkerReady === true, undefined, { timeout: 30_000 });
    await expect(page.getByRole('option').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'View all results' })).toHaveAttribute('href', /\/library\/\?q=slack$/);
    expect(primaryIndexRequests).toBe(1);
    expect(searchRequests.filter((url) => PRIMARY_INDEX.test(new URL(url).pathname))).toHaveLength(1);
  } finally {
    releasePrimaryIndex();
  }
});
