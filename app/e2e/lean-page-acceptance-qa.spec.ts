import { expect, test, type Locator, type Page } from '@playwright/test';
import { appPath } from './app-paths';
import { firstLeanSubject, leanSubjects, viewHref } from './detail-subjects';

const DRAG = { dx: 60, dy: 40 } as const;
const WIDTHS = [320, 768, 1024, 1440] as const;
const NOTICE_WIDTHS = [320, 1440] as const;
const VIEWPORT_HEIGHT = 900;

const LIVE_REGIONS = '[aria-live], [role="status"], [role="alert"], [role="log"], [role="marquee"], [role="timer"], [role="progressbar"]';

const settleFrames = (page: Page) => page.evaluate(() => {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  return promise;
});

function parseTranslate(transform: string | null): { x: number; y: number; scale: number } {
  const match = /translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(transform ?? '');
  if (!match) throw new Error(`Unexpected SVG transform: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

async function openWorkflowView(page: Page, width: number, subject = firstLeanSubject()) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.goto(appPath(viewHref(subject)));
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  return subject;
}

async function openInteractiveCanvas(page: Page, width: number) {
  await openWorkflowView(page, width);
  await page.getByRole('button', { name: /Load interactive canvas/i }).click();
  const viewport = page.getByTestId('workflow-canvas-viewport');
  const stage = viewport.locator('svg[role="group"][aria-roledescription="Workflow diagram"]');
  const target = stage.locator('> g').first();
  await expect(stage, 'interactive workflow SVG').toHaveCount(1, { timeout: 30_000 });
  await viewport.scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Reset workflow view to fit' }).click();
  await settleFrames(page);
  return { viewport, stage, target };
}

async function pressAndDrag(page: Page, viewport: Locator, pointerType: 'mouse' | 'pen' | 'touch') {
  const box = await viewport.boundingBox();
  if (!box) throw new Error('the canvas viewport has no box');
  const start = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const end = { x: start.x + DRAG.dx, y: start.y + DRAG.dy };
  const client = await page.context().newCDPSession(page);

  if (pointerType === 'touch') {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y, id: 1 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  } else {
    const dispatch = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number, buttons: number) =>
      client.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType });
    await dispatch('mousePressed', start.x, start.y, 1);
    await dispatch('mouseMoved', end.x, end.y, 1);
    await dispatch('mouseReleased', end.x, end.y, 0);
  }

  return { client, end };
}

for (const width of NOTICE_WIDTHS) {
  test(`the workflow view keeps unique IDs and non-live severity counts at ${width}px`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await openWorkflowView(page, width);

    const summary = page.getByRole('group', { name: 'Finding severity summary' });
    await expect(summary).toHaveCount(1);
    const liveRegions = await summary.evaluate(
      (element, selector) => Array.from(element.querySelectorAll(selector)).length,
      LIVE_REGIONS,
    );
    expect(liveRegions, `live regions inside severity summary at ${width}px`).toBe(0);

    const duplicateIds = await page.evaluate(() => {
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const element of document.querySelectorAll('[id]')) {
        if (seen.has(element.id)) duplicates.add(element.id);
        seen.add(element.id);
      }
      return [...duplicates];
    });
    expect(duplicateIds, `ids emitted twice in one served page at ${width}px`).toEqual([]);

    expect(pageErrors).toEqual([]);
  });
}

for (const width of WIDTHS) {
  test(`the interactive workflow canvas pans with mouse, touch and pen at ${width}px`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const { viewport, target } = await openInteractiveCanvas(page, width);
    const reset = page.getByRole('button', { name: 'Reset workflow view to fit' });
    const toolbarStatus = page.locator('[data-canvas-control] span').first();
    const initialTransform = await target.getAttribute('transform');
    const origin = parseTranslate(initialTransform);

    for (const pointerType of ['mouse', 'pen', 'touch'] as const) {
      const { client, end } = await pressAndDrag(page, viewport, pointerType);
      await expect.poll(async () => {
        const after = parseTranslate(await target.getAttribute('transform'));
        return Math.round(after.x - origin.x) === DRAG.dx && Math.round(after.y - origin.y) === DRAG.dy;
      }, { message: `${pointerType}: drag pans the workflow canvas` }).toBe(true);

      const dragged = await target.getAttribute('transform');
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: end.x + 200,
        y: end.y + 200,
        buttons: 0,
        pointerType: pointerType === 'touch' ? 'mouse' : pointerType,
      });
      await settleFrames(page);
      expect(await target.getAttribute('transform'), `${pointerType}: released pointer stops panning`).toBe(dragged);

      await client.detach();
      await reset.click();
      await settleFrames(page);
      expect(await target.getAttribute('transform'), `${pointerType}: reset returns to fit state`).toBe(initialTransform);
    }

    const beforeScale = parseTranslate(await target.getAttribute('transform')).scale;
    await page.getByRole('button', { name: 'Zoom in' }).click();
    const afterZoomIn = parseTranslate(await target.getAttribute('transform')).scale;
    expect(afterZoomIn).toBeGreaterThan(beforeScale);
    await expect(toolbarStatus).toContainText(`${Math.round(afterZoomIn * 100)}%`);

    await page.getByRole('button', { name: 'Zoom out' }).click();
    const afterZoomOut = parseTranslate(await target.getAttribute('transform')).scale;
    expect(afterZoomOut).toBeLessThan(afterZoomIn);

    await viewport.scrollIntoViewIfNeeded();
    const box = await viewport.boundingBox();
    if (!box) throw new Error('the canvas viewport has no box');
    const centre = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    const client = await page.context().newCDPSession(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY: -100, modifiers: 2,
    });
    await settleFrames(page);
    expect(parseTranslate(await target.getAttribute('transform')).scale).toBeGreaterThan(afterZoomOut);
    expect(await page.evaluate(() => window.scrollY), 'wheel over canvas zooms without scrolling page').toBe(scrollBefore);
    await client.detach();

    expect(pageErrors).toEqual([]);
  });
}

test('no workflow advertises a download byte range, so none can serve pack bytes', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const carriers = leanSubjects().filter((entry) => entry.download !== null);
  expect(carriers.map((entry) => entry.id), 'entries carrying a download pack byte range').toEqual([]);

  const packRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/data/packs/')) packRequests.push(new URL(request.url()).pathname);
  });

  await openWorkflowView(page, 1280);

  await expect(page.locator('[data-download-pack], [data-download-offset], [data-download-length]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download workflow' })).toHaveCount(0);
  await expect(page.locator('[data-download-status]')).toHaveCount(0);
  expect(packRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
