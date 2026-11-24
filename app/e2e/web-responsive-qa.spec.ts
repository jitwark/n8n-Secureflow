import { expect, test } from '@playwright/test';
import { firstPrerenderedSubject, viewHref } from './detail-subjects';
import { assertNoOverflow, assertTarget } from './web-qa-helpers';

/**
 * W-008: reflow and target size at 320 / 375 / 768 / 1024 / 1440 px.
 *
 * Measured from the rendered box, never from a class name.
 */
const basePath = (process.env.PLAYWRIGHT_BASE_PATH ?? '').replace(/\/+$/, '');

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`responsive ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const subject = firstPrerenderedSubject();
    const detailRoute = viewHref(subject);
    for (const route of ['/', '/library/', '/scanner/', detailRoute]) {
      await page.goto(`${basePath}${route}`);
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`${width}-${route.replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`),
        fullPage: true,
      });
    }

    await page.goto(`${basePath}/scanner/`);
    await assertTarget(page, 'Scan workflow');

    await page.goto(`${basePath}${detailRoute}`);
    await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Load interactive canvas' }).click();
    await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });
    const opener = page.getByRole('button', { name: 'Fullscreen view' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeFocused();
    await assertNoOverflow(page);
    await assertTarget(page, 'Exit fullscreen');
    await assertTarget(page, 'Zoom in');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
