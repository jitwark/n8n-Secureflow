import { expect, test, type Page } from '@playwright/test';
import { appPath } from './app-paths';
import { largestLeanSubject, leanRepresentatives, viewHref } from './detail-subjects';

const VIEWPORTS = [320, 768, 1024, 1440] as const;
const REPRESENTATIVES = leanRepresentatives();
const LARGEST_LEAN_ID = largestLeanSubject().id;

async function expectStructureSummary(page: Page): Promise<void> {
  const previewRegion = page.getByTestId('chart-preview-region');
  await expect(previewRegion).toBeVisible({ timeout: 30_000 });
  await expect(previewRegion.getByText('Workflow structure summary')).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page, surface: string): Promise<void> {
  const measurement = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.dataset.testid ?? '',
          className: String(element.className).slice(0, 80),
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      })
      .filter(({ left, right }) => left < 0 || right > viewportWidth)
      .slice(0, 5);
    return { viewportWidth, documentWidth: document.documentElement.scrollWidth, offenders };
  });
  expect(measurement.documentWidth, `${surface} must not overflow horizontally: ${JSON.stringify(measurement)}`).toBeLessThanOrEqual(measurement.viewportWidth);
}

async function expectInteractiveSurface(page: Page): Promise<boolean> {
  const diagram = page.getByRole('group', { name: /Workflow diagram/ });
  const fallback = page.getByRole('status').filter({
    hasText: /interactive diagram|diagram could not|diagram.*empty|diagram timed out/i,
  }).first();
  await expect(diagram.or(fallback).first()).toBeVisible({ timeout: 30_000 });
  return diagram.isVisible();
}

for (const representative of REPRESENTATIVES) {
  for (const width of VIEWPORTS) {
    test(`P5.8 current corpus representative ${representative.id} keeps canvas opt-in at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const chartRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/data/charts/')) chartRequests.push(request.url());
      });

      const response = await page.goto(appPath(viewHref(representative)));
      expect(response?.status()).toBe(200);
      await expect(page.locator('main h1')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: representative.title })).toBeVisible({ timeout: 30_000 });
      await expectStructureSummary(page);
      await expect(page.getByRole('button', { name: /Load interactive canvas/i })).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page, 'workflow view before activation');
      await page.waitForLoadState('networkidle');
      expect(chartRequests, 'workflow view must not fetch packed chart buckets before activation').toEqual([]);

      const loadCanvas = page.getByRole('button', { name: /Load interactive canvas/i });
      await loadCanvas.focus();
      await expect(loadCanvas).toBeFocused();
      await loadCanvas.press('Enter');
      const diagramVisible = await expectInteractiveSurface(page);
      await expectNoHorizontalOverflow(page, 'interactive surface');
      expect(chartRequests.length, 'activation must fetch the packed chart bucket').toBeGreaterThan(0);

      if (diagramVisible && representative.id === LARGEST_LEAN_ID) {
        const diagram = page.getByRole('group', { name: /Workflow diagram/ });
        const svgNodes = diagram.locator('[data-interactive="true"]');
        expect(await svgNodes.count()).toBeGreaterThan(62);
        await expect(diagram.locator('[tabindex="0"]')).toHaveCount(0);
        await expect(diagram.locator('[role="button"]')).toHaveCount(0);
      }
    });
  }
}
