import { firstLeanSubject, viewHref } from './detail-subjects';
import { expect, test, type Page } from '@playwright/test';
import { appPath } from './app-paths';

const OBSERVATION_TIMEOUT_MS = 15_000;

function hasArtifact(dataPaths: Set<string>, basename: string): boolean {
  return dataPaths.has(`${basename}.gzbin`) || dataPaths.has(basename);
}

async function waitForInitialSearchPayload(page: Page, dataPaths: Set<string>): Promise<void> {
  await expect.poll(
    () => hasArtifact(dataPaths, 'search-index.json') && hasArtifact(dataPaths, 'facets.json'),
    { timeout: OBSERVATION_TIMEOUT_MS, message: 'initial search payloads should be requested' },
  ).toBe(true);
  await page.waitForLoadState('networkidle', { timeout: OBSERVATION_TIMEOUT_MS });
  await waitForBrowserIdle(page);
}

async function waitForBrowserIdle(page: Page): Promise<void> {
  await page.evaluate((timeoutMs) => new Promise<void>((resolve) => {
    const idle = () => {
      if ('requestIdleCallback' in window) {
        const requestIdleCallback = (window as Window & {
          requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number;
        }).requestIdleCallback;
        requestIdleCallback(resolve, { timeout: timeoutMs });
      } else {
        globalThis.setTimeout(resolve, 0);
      }
    };
    window.requestAnimationFrame(idle);
  }), OBSERVATION_TIMEOUT_MS);
  await page.waitForLoadState('networkidle', { timeout: OBSERVATION_TIMEOUT_MS });
}

/**
 * The build-time budget in `scripts/check-bundle-budget.mjs` can only measure
 * the artifacts it is *told* are eager. This measures what a browser actually
 * asks for, which is the claim that matters.
 *
 * `semantic-index.json` is 1.55 MB gzip, larger than the lexical index itself,
 * and it used to be fetched during warm-up on every page that imports the
 * search client — most of the 9.89 MB a visitor paid before their first
 * keystroke.
 */
test('the semantic index is not fetched until someone types', async ({ page }) => {
  const dataPaths = new Set<string>();
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/data/')) dataPaths.add(new URL(url).pathname.replace(/^.*\/data\//, ''));
  });

  await page.goto(appPath('/library/'));
  await waitForInitialSearchPayload(page, dataPaths);

  // The extended tier is fetched too, but only after the primary index is
  // answering — that is the point of the split, not a violation of it. What
  // must not appear before a keystroke is the semantic index.
  expect(hasArtifact(dataPaths, 'search-index.json')).toBe(true);
  expect(hasArtifact(dataPaths, 'facets.json')).toBe(true);
  expect(hasArtifact(dataPaths, 'semantic-index.json')).toBe(false);

  await page.getByRole('combobox').first().fill('slack notification');
  await expect.poll(() => hasArtifact(dataPaths, 'semantic-index.json'), { timeout: 15_000 }).toBe(true);
});

test('a quoted phrase does not pay for vectors it cannot use', async ({ page }) => {
  const dataPaths = new Set<string>();
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/data/')) dataPaths.add(new URL(url).pathname.replace(/^.*\/data\//, ''));
  });

  await page.goto(appPath('/library/'));
  await waitForInitialSearchPayload(page, dataPaths);
  // The worker skips the semantic path entirely for quoted phrases.
  await page.getByRole('combobox').first().fill('"exact phrase only"');
  await waitForBrowserIdle(page);

  expect(hasArtifact(dataPaths, 'semantic-index.json')).toBe(false);
});

/**
 * Packed export stores charts in FNV-1a `.jsonl.gzbin` bucket packs. The detail
 * page must defer fetching any chart bucket until the visitor explicitly clicks
 * "Load interactive canvas", and then load only that entry's single packed bucket.
 */
test('a workflow chart is deferred until explicit action and loads only its packed bucket', async ({ page }) => {
  const chartPackResponses: Array<{ url: string; status: number; length: number }> = [];
  page.on('response', async (response) => {
    if (!/\/data\/charts\/(?:pack-\d+\.jsonl\.gzbin|chart-\d+\.jsonl)$/.test(new URL(response.url()).pathname)) return;
    const body = await response.body().catch(() => null);
    const length = body ? body.byteLength : Number(response.headers()['content-length'] ?? 0);
    chartPackResponses.push({ url: response.url(), status: response.status(), length });
  });

  const subject = firstLeanSubject();
  await page.goto(appPath(viewHref(subject)));
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  const loadCanvas = page.getByRole('button', { name: 'Load interactive canvas' });
  await expect(loadCanvas).toBeVisible();
  expect(chartPackResponses).toEqual([]);

  await loadCanvas.click();
  await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });

  expect(chartPackResponses.length).toBe(1);
  expect(chartPackResponses[0]?.status, 'chart bucket pack must return 200').toBe(200);
  expect(chartPackResponses[0]?.url).toMatch(/\/data\/charts\/pack-\d+\.jsonl\.gzbin$/);
  expect(chartPackResponses[0]?.length ?? 0).toBeLessThan(512 * 1024);
});
