import { expect, test, type Page } from '@playwright/test';
import { appPath } from './app-paths';
import { largestLeanSubject, mostAnnotatedLeanSubject, viewHref } from './detail-subjects';

const VIEWPORTS = [320, 1440] as const;

const REPRESENTATIVES = [
  { ...largestLeanSubject(), label: 'largest workflow', tier: 'C' as const },
  { ...mostAnnotatedLeanSubject(), label: 'annotation-heavy workflow' },
];

async function expectStructureSummary(page: Page): Promise<void> {
  const previewRegion = page.getByTestId('chart-preview-region');
  await expect(previewRegion).toBeVisible({ timeout: 30_000 });
  await expect(previewRegion.getByText('Workflow structure summary')).toBeVisible({ timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const measurement = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(measurement.documentWidth, `document overflow at ${measurement.viewportWidth}px: ${JSON.stringify(measurement)}`)
    .toBeLessThanOrEqual(measurement.viewportWidth);
}

async function expectInteractiveSurface(page: Page): Promise<boolean> {
  const diagram = page.locator('svg[role="group"][aria-roledescription="Workflow diagram"]');
  const fallback = page.getByRole('status').filter({
    hasText: /interactive diagram|diagram could not|diagram.*empty|diagram timed out/i,
  }).first();
  await expect(diagram.or(fallback).first()).toBeVisible({ timeout: 30_000 });
  return diagram.isVisible();
}

for (const representative of REPRESENTATIVES) {
  for (const width of VIEWPORTS) {
    test(
      `P5.8 runtime resources and accessibility: ${representative.label} defers packed chart until action at ${width}px`,
      async ({ page }) => {
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
        await page.waitForLoadState('networkidle');
        expect(chartRequests, 'workflow view must not request chart data before activation').toEqual([]);

        await page.getByRole('button', { name: /Load interactive canvas/i }).click();
        const diagramVisible = await expectInteractiveSurface(page);
        if (!diagramVisible) return;

        const diagram = page.locator('svg[role="group"][aria-roledescription="Workflow diagram"]');
        await expect(diagram).toHaveCount(1);
        await expectNoHorizontalOverflow(page);
        expect(chartRequests.some((url) => /\/data\/charts\/pack-\d+\.jsonl\.gzbin$/.test(new URL(url).pathname))).toBe(true);

        if ('tier' in representative && representative.tier === 'C') {
          const focusableSvgTargets = diagram.locator(
            '[data-interactive="true"][tabindex="0"], [data-interactive="true"][role="button"]',
          );
          await expect(focusableSvgTargets).toHaveCount(0);
        }
      },
    );
  }
}
