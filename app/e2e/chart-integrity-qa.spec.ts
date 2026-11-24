import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { appPath } from './app-paths';
import { firstLeanSubject, viewHref } from './detail-subjects';
import { bucketForId, bucketTag } from '../src/catalogue/pack-bucket';

const out = path.resolve(__dirname, '..', 'out');
const dataDir = path.join(out, 'data');

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')) as {
  generatedAt: string;
  artifacts: Array<{ path: string; byteSize: number; sha256: string }>;
};

test('interactive chart renders from real verified packed bucket bytes', async ({ page }) => {
  const subject = firstLeanSubject();
  const bucket = bucketTag(bucketForId(subject.id));
  const expectedChartPath = `charts/pack-${bucket}.jsonl.gzbin`;
  const artifact = manifest.artifacts.find((candidate) => candidate.path === expectedChartPath);
  expect(artifact, `manifest must declare ${expectedChartPath}`).toBeDefined();
  const packBytes = fs.readFileSync(path.join(dataDir, 'charts', `pack-${bucket}.jsonl.gzbin`));

  let fetchedPath = '';
  await page.route(`**/data/${expectedChartPath}`, async (route) => {
    fetchedPath = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, body: packBytes });
  });

  await page.goto(appPath(viewHref(subject)));
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Load interactive canvas/i }).click();
  await expect(page.locator('[data-interactive-canvas] canvas, [data-interactive-canvas] svg').first()).toBeVisible({ timeout: 20_000 });
  expect(fetchedPath).toContain(expectedChartPath);
});

test('corrupted packed chart bucket fails integrity check with release identity and no canvas', async ({ page }) => {
  const subject = firstLeanSubject();
  const bucket = bucketTag(bucketForId(subject.id));
  const expectedChartPath = `charts/pack-${bucket}.jsonl.gzbin`;

  await page.route(`**/data/${expectedChartPath}`, async (route) => (
    route.fulfill({ status: 200, body: Buffer.from('corrupted-chart-pack-bytes') })
  ));

  await page.goto(appPath(viewHref(subject)));
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Load interactive canvas/i }).click();
  await expect(page.getByText(/could not be read safely/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(new RegExp(`^Release ${manifest.generatedAt}`))).toBeVisible();
  await expect(page.locator('[data-interactive-canvas]')).toHaveCount(0);
});
