import { expect, test, type Page } from '@playwright/test';
import { firstLeanSubject, viewHref } from './detail-subjects';
import { appPath } from './app-paths';

async function assertNoHorizontalOverflow(page: Page, surface: string): Promise<void> {
  const measurement = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(measurement.documentWidth, `${surface} overflow: ${JSON.stringify(measurement)}`)
    .toBeLessThanOrEqual(measurement.viewport);
}

async function focusByKeyboard(page: Page, target: ReturnType<Page['getByRole']>): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Primary detail action was not reachable in the keyboard order.');
}

async function setTwoHundredPercentVisualZoom(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(2);
}

test.describe('workflow detail accessibility evidence', () => {
  test('detail view has truthful landmarks, keyboard focus, and 200% zoom evidence', async ({ page }) => {
    const subject = firstLeanSubject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(appPath(viewHref(subject)));
    await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Workflow canvas', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About this workflow', exact: true })).toBeVisible();

    const primary = page.getByRole('link', { name: /^View on (n8n\.io|GitHub)$/ });
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('href', /^https:\/\//);
    await expect(page.getByRole('button', { name: 'Download workflow' })).toHaveCount(0);
    await expect(page.getByTestId('chart-preview-region').getByRole('status')).toContainText('Workflow structure summary');

    await focusByKeyboard(page, primary);
    await expect(primary).toBeFocused();
    const focusStyle = await primary.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
    });
    expect(focusStyle.outlineWidth !== '0px' || focusStyle.boxShadow !== 'none').toBe(true);

    await setTwoHundredPercentVisualZoom(page);
    await assertNoHorizontalOverflow(page, 'workflow detail at 200% visual zoom');
  });

  test('interactive shell resolves slug IDs, keeps reduced-motion, and loads packed chart by keyboard', async ({ page }) => {
    const subject = firstLeanSubject();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(appPath(`/w/view/?id=${encodeURIComponent(subject.slug)}`));
    await expect(page).toHaveURL(/\/w\/view\/\?id=[^&]+/);
    await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Workflow canvas' }).getByRole('status'))
      .toContainText('Workflow structure summary');

    const loadCanvas = page.getByRole('button', { name: 'Load interactive canvas' });
    await expect(loadCanvas).toBeVisible();
    const motion = await loadCanvas.evaluate((element) => ({
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      transitionMs: Number.parseFloat(getComputedStyle(element).transitionDuration) || 0,
      animationMs: Number.parseFloat(getComputedStyle(element).animationDuration) || 0,
    }));
    expect(motion.reduced).toBe(true);
    expect(motion.transitionMs).toBeLessThanOrEqual(0.01);
    expect(motion.animationMs).toBeLessThanOrEqual(0.01);

    await focusByKeyboard(page, loadCanvas);
    await expect(loadCanvas).toBeFocused();
    await page.keyboard.press('Enter');
    const diagram = page.getByRole('group', { name: /Workflow diagram/ });
    const fallback = page.getByRole('status').filter({
      hasText: /interactive diagram|diagram could not|diagram.*empty|diagram timed out/i,
    }).first();
    await expect(diagram.or(fallback).first()).toBeVisible({ timeout: 30_000 });
    if (await diagram.isVisible()) await expect(diagram).toHaveAttribute('aria-roledescription', 'Workflow diagram');
    else await expect(fallback).toContainText(/interactive|diagram/i);
    await assertNoHorizontalOverflow(page, 'interactive workflow shell');
  });
});
