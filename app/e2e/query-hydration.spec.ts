import { expect, test, type Page } from '@playwright/test';
import { firstPrerenderedSubject, viewHref } from './detail-subjects';

const basePath = (process.env.PLAYWRIGHT_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:3210';

function appPath(pathname: string): string {
  return `${basePath}${pathname}`;
}

function captureBrowserErrors(page: Page): { pageErrors: string[]; hydrationErrors: string[] } {
  const pageErrors: string[] = [];
  const hydrationErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|hydrating|server rendered html|didn't match/i.test(message.text())) {
      hydrationErrors.push(message.text());
    }
  });
  return { pageErrors, hydrationErrors };
}

test('library deep links hydrate without page errors and restore queries through history', async ({ page }) => {
  const errors = captureBrowserErrors(page);
  await page.goto(appPath('/library/?q=slack'));
  const search = page.getByRole('combobox', { name: 'Search n8n workflows' });
  const results = page.getByRole('list', { name: 'Workflow results' });

  await expect(search).toHaveValue('slack');
  await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(search).toHaveValue('slack');
  await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });

  await page.goto(appPath('/library/'));
  await search.fill('slack');
  await page.getByRole('combobox', { name: 'Sort results' }).selectOption('quality');
  await expect(page).toHaveURL(/q=slack/);
  await search.fill('query-that-cannot-match-any-current-workflow-9e7f');
  await expect(page.getByText(/No workflows match/)).toBeVisible({ timeout: 30_000 });

  await page.goBack();
  await expect(search).toHaveValue('slack');
  await expect(results.getByRole('link').first()).toBeVisible({ timeout: 30_000 });
  await page.goForward();
  await expect(search).toHaveValue('query-that-cannot-match-any-current-workflow-9e7f');
  await expect(page.getByText(/No workflows match/)).toBeVisible();

  expect(errors.pageErrors).toEqual([]);
  expect(errors.hydrationErrors).toEqual([]);
});

test('static /w/view/ shell stays independent of query params and hydrates layout overrides cleanly', async ({ browser, page }) => {
  const subject = firstPrerenderedSubject();
  const defaultLayoutUrl = appPath(viewHref(subject));
  const workbenchUrl = appPath(`/w/view/?id=${encodeURIComponent(subject.id)}&layout=workbench`);

  const staticContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(defaultLayoutUrl);
  const staticShell = await staticPage.locator('main').innerHTML();
  await staticPage.goto(workbenchUrl);
  expect(await staticPage.locator('main').innerHTML()).toBe(staticShell);
  await staticContext.close();

  const errors = captureBrowserErrors(page);
  await page.goto(defaultLayoutUrl);
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Workflow sections' })).toBeVisible();

  await page.goto(workbenchUrl);
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-layout="workbench"]')).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.hydrationErrors).toEqual([]);
});

test('static library markup is independent of the query string before JavaScript runs', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(appPath('/library/'));
  const defaultTree = await page.locator('main').innerHTML();
  await page.goto(appPath('/library/?q=slack'));
  expect(await page.locator('main').innerHTML()).toBe(defaultTree);
  await context.close();
});
