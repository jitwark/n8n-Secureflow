import { expect, test, type Page } from '@playwright/test';
import { appPath } from './app-paths';
import { firstLeanSubject, viewHref } from './detail-subjects';
import { assertNoOverflow } from './web-qa-helpers';

function capturePageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('no horizontal document overflow at 320px', () => {
  test('/analytics/ does not overflow the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const pageErrors = capturePageErrors(page);
    await page.goto(appPath('/analytics/'));
    await expect(page.getByRole('heading', { name: 'What is actually in the catalogue' })).toBeVisible();
    await assertNoOverflow(page);
    expect(pageErrors).toEqual([]);
  });

  test('/w/view/?id=… does not overflow the viewport at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const pageErrors = capturePageErrors(page);
    const subject = firstLeanSubject();
    await page.goto(appPath(viewHref(subject)));
    await expect(page.getByRole('heading', { name: subject.title })).toBeVisible({ timeout: 30_000 });
    await assertNoOverflow(page);
    expect(pageErrors).toEqual([]);
  });
});
