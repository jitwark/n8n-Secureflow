import { expect, test } from '@playwright/test';
import { firstLeanSubject, viewHref } from './detail-subjects';
import { appPath } from './app-paths';

test.describe('workflow detail navigation', () => {
  test('library cards resolve through packed detail and chart buckets', async ({ page }) => {
    const failures: string[] = [];
    const chartRequests: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(`request failed: ${request.url()}`);
    });
    page.on('request', (request) => {
      if (request.url().includes('/data/charts/')) chartRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });

    const subject = firstLeanSubject();
    await page.goto(appPath(`/library/?q=${encodeURIComponent(subject.title)}`));
    const card = page.getByRole('list', { name: 'Workflow results' })
      .locator(`a[href="${appPath(viewHref(subject))}"]`)
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();

    await page.waitForURL((url) => url.pathname.endsWith('/w/view/') && url.searchParams.get('id') === subject.id);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).not.toContainText('Workflow not found');

    await expect(page.getByText('Workflow structure summary')).toBeVisible();
    await expect(page.getByRole('button', { name: /Load interactive canvas/i })).toBeVisible({ timeout: 30_000 });
    expect(chartRequests).toEqual([]);

    await page.getByRole('button', { name: /Load interactive canvas/i }).click();
    await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });
    expect(chartRequests.some((url) => /\/data\/charts\/pack-\d+\.jsonl\.gzbin$/.test(new URL(url).pathname))).toBe(true);
    expect(failures).toEqual([]);
  });

  test('unknown IDs render an accessible error state', async ({ page }) => {
    await page.goto(appPath('/w/view/?id=unknown-workflow-id-for-e2e'));
    await expect(page.getByRole('heading', { name: 'Workflow not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to library' })).toBeVisible();
  });
});
