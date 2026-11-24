import { expect, test, type Page } from '@playwright/test';
import { firstLeanSubject, firstPrerenderedSubject, viewHref } from './detail-subjects';

/**
 * Phase 4.3 browser acceptance for the four bounded frontend P2s, against the
 * real static export at 320 / 768 / 1024 / 1440 px:
 *
 *  - FE-03 `use-virtual-rows.ts`, which now spaces and sizes rows from what it has
 *    measured, and the card that agrees with it (`result-card.tsx`: `min-h-[92px]`,
 *    `contain-intrinsic-size: auto 92px` — 92 is a *content* box, and a row's
 *    smallest pitch is 117: the content box plus `py-3` and the divider).
 *  - FE-04 `search-box.tsx` exposes `aria-controls` only while the controlled list is rendered.
 *  - FE-05 `detail/findings-summary.tsx` keeps permanent severity counts out of live-region
 *    semantics; the library's `p[aria-live]` announces the filtered result count.
 *  - FE-07 `detail/canvas-viewport.tsx` pans the static preview with mouse, touch and pen.
 *
 * Rows are content-sized: ~300px at 320px wide, 117-168px at 1440px. So 92px is the card's
 * content-box minimum (`min-h-[92px]`), and the pitch the list has to space is at least 117.
 * The assertions pin the shared measurements from both sides — every row holds at least 92px of
 * content box, a browser-deferred row is laid out at the card's floor of 117px, the list's own
 * box is the rows it rendered plus the space it reserved for the ones it did not — plus the
 * consequences: no clipped row, uniform pitch, before and after a scroll. That the reserved
 * space equals the rows' measured heights is proved by `virtual-row-geometry.spec.ts`.
 */

const basePath = (process.env.PLAYWRIGHT_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** `result-card.tsx`'s `min-h-[92px]`: the card's content box, not the row pitch. */
const CARD_MIN_CONTENT_BOX = 92;
/** The smallest pitch a row can have: 92 content box + `py-3` (24) + the divider (1). */
const ROW_PITCH_FLOOR = 117;
/** The hairline the list draws between two rows. */
const ROW_DIVIDER = 1;
const ROW_TOLERANCE = 2;
const PITCH_TOLERANCE = 1;
const ROWS_SAMPLED = 5;
/** `page * PAGE_SIZE` rows land in one response: 120, past the 100-row threshold. */
const VIRTUAL_PAGE = 5;
const FILTER_QUERY = 'slack';
const NO_MATCH_QUERY = 'no-matching-workflow-9e7f';
const DRAG = { dx: 60, dy: 40 } as const;
const VIEWPORT_HEIGHT = 900;
const WIDTHS = [320, 768, 1024, 1440] as const;

type RowMeasurement = { top: number; height: number; contentBoxHeight: number; overflow: number; minHeight: number; padding: number; containIntrinsicSize: string };
type ListMeasurement = { rowCount: number; rows: RowMeasurement[]; spacers: string[]; controls: Array<{ id: string; resolves: boolean }>; loaded: number };

/** Reads the layout facts back out of the served DOM, never out of the source. */
async function measureList(page: Page): Promise<ListMeasurement> {
  return page.evaluate(() => {
    const list = document.getElementById('search-results-list');
    if (!list) throw new Error('#search-results-list is not rendered');
    const children = Array.from(list.children);
    const rows = children.filter((child) => !child.hasAttribute('aria-hidden')).map((child) => {
      const article = child.querySelector('article') as HTMLElement | null;
      if (!article) throw new Error('a result row rendered without its card');
      const style = getComputedStyle(article);
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      return {
        top: child.getBoundingClientRect().top,
        height: child.getBoundingClientRect().height,
        contentBoxHeight: article.clientHeight - padding,
        overflow: article.scrollHeight - article.clientHeight,
        minHeight: Number.parseFloat(style.minHeight),
        padding,
        containIntrinsicSize: style.containIntrinsicSize,
      };
    });
    return {
      rowCount: rows.length,
      rows,
      loaded: Math.max(
        0,
        ...Array.from(document.querySelectorAll('p'))
          .map((element) => /^Showing ([\d,]+) of/.exec(element.textContent?.trim() ?? ''))
          .filter((match) => match !== null)
          .map((match) => Number.parseInt(match[1]!.replace(/,/g, ''), 10))
      ),
      spacers: children.filter((child) => child.hasAttribute('aria-hidden')).map((child) => (child as HTMLElement).style.height),
      controls: Array.from(document.querySelectorAll('[aria-controls]')).map((element) => {
        const id = element.getAttribute('aria-controls') ?? '';
        return { id, resolves: id !== '' && document.getElementById(id) !== null };
      }),
    };
  });
}

function assertRowGeometry(measurement: ListMeasurement, surface: string): void {
  expect(measurement.rowCount, `${surface}: rendered rows`).toBeGreaterThanOrEqual(ROWS_SAMPLED);
  const sampled = measurement.rows.slice(0, ROWS_SAMPLED);

  for (const [index, row] of sampled.entries()) {
    expect(row.minHeight, `${surface}: row ${index} min-height`).toBe(CARD_MIN_CONTENT_BOX);
    // No row renders shorter than the card's own content box.
    expect(row.contentBoxHeight, `${surface}: row ${index} content box`).toBeGreaterThanOrEqual(CARD_MIN_CONTENT_BOX - ROW_TOLERANCE);
    // The row box is not clipping its own text.
    expect(row.overflow, `${surface}: row ${index} overflow`).toBeLessThanOrEqual(1);
  }

  // The floor the list reserves for a row it has not measured is the card's own
  // box: its content-box minimum, its `py-3` and its hairline. Both halves are
  // read out of the served DOM — the computed styles, and a deferred row when the
  // browser has deferred one, which it lays out at exactly this floor. (Whether a
  // rendered row is deferred at all depends on how far below the fold the window
  // reaches, so that half is checked where it applies rather than assumed.)
  const [first] = measurement.rows;
  expect(first!.padding + ROW_DIVIDER, `${surface}: card padding plus divider`).toBe(ROW_PITCH_FLOOR - CARD_MIN_CONTENT_BOX);
  for (const [index, row] of measurement.rows.entries()) {
    // Nothing the browser lays out is shorter than the floor the list reserves:
    // the seed can under-state a gap, but it cannot invent one.
    expect(row.height, `${surface}: row ${index} pitch`).toBeGreaterThanOrEqual(ROW_PITCH_FLOOR - ROW_TOLERANCE);
  }
  for (const row of measurement.rows.filter((entry) => entry.height <= ROW_PITCH_FLOOR + ROW_TOLERANCE)) {
    expect(row.contentBoxHeight, `${surface}: deferred row content box`).toBeCloseTo(CARD_MIN_CONTENT_BOX, 0);
  }

  for (let index = 1; index < sampled.length; index += 1) {
    const pitch = sampled[index]!.top - sampled[index - 1]!.top;
    expect(Math.abs(pitch - sampled[index - 1]!.height), `${surface}: pitch after row ${index - 1}`).toBeLessThanOrEqual(PITCH_TOLERANCE);
  }

  // Every pixel the list occupies is a rendered row or space reserved for rows it
  // has not rendered, and every reserved row is at least the card's floor tall.
  // (The count is asserted by the caller where the window starts at the first
  // result, because only then is the trailing spacer's row count known.)
  expect(measurement.spacers.length, `${surface}: virtual spacers`).toBeGreaterThan(0);
  for (const spacer of measurement.spacers) {
    const pixels = Number.parseFloat(spacer);
    expect(Number.isFinite(pixels), `${surface}: spacer ${spacer}`).toBe(true);
    expect(pixels, `${surface}: spacer ${spacer}`).toBeGreaterThan(0);
  }
}

/**
 * FE-05: permanent severity counts, on the lean page that renders
 * `FindingsSummary` and on the prerendered page that renders `Findings`. Scoped
 * to that surface — these pages carry other live regions legitimately.
 */
async function assertSeverityCountsAreNotLiveRegions(page: Page, surface: string): Promise<void> {
  const summary = page.locator('[aria-label="Finding severity summary"]');
  await expect(summary, `${surface}: severity summary`).toHaveCount(1);
  await expect(summary, `${surface}: severity summary`).toHaveAttribute('role', 'group');
  await expect(page.getByRole('group', { name: 'Finding severity summary' })).toHaveCount(1);
  expect(await summary.evaluate((element) => element.hasAttribute('aria-live')), `${surface}: aria-live`).toBe(false);
  expect(await summary.evaluate((element) => element.querySelectorAll('[role="status"], [aria-live]').length), `${surface}: live descendants`).toBe(0);
  expect(await summary.innerText(), `${surface}: severity counts`).toMatch(/\d+\s*critical/);
}

function parseTranslate(transform: string | null): { x: number; y: number; scale: number } {
  const match = /translate\(([-\d.e+]+),\s*([-\d.e+]+)\)\s*scale\(([-\d.e+]+)\)/.exec(transform ?? '');
  if (!match) throw new Error(`unexpected SVG group transform: ${transform ?? '<missing>'}`);
  return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
}

/**
 * FE-07 through the browser's own input pipeline, so the component's `setPointerCapture` has an
 * active pointer to capture — a synthesized `PointerEvent` cannot be captured and throws.
 */
async function dragPreview(page: Page, pointerType: 'mouse' | 'pen' | 'touch'): Promise<void> {
  const chart = page.getByTestId('workflow-chart').first();
  const viewport = chart.getByTestId('workflow-canvas-viewport');
  const stage = viewport.locator('svg[role="group"][aria-roledescription="Workflow diagram"]');
  const target = stage.locator('> g').first();
  await expect(stage, 'interactive workflow SVG').toHaveCount(1);
  await viewport.scrollIntoViewIfNeeded();
  await chart.getByRole('button', { name: 'Reset workflow view to fit' }).click();

  const beforeAttr = await target.getAttribute('transform');
  const before = parseTranslate(beforeAttr);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('canvas viewport has no box');
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

  await expect.poll(async () => {
    const after = parseTranslate(await target.getAttribute('transform'));
    return Math.round(after.x - before.x) === DRAG.dx && Math.round(after.y - before.y) === DRAG.dy;
  }, { message: `${pointerType} drag pans the canvas` }).toBe(true);
  const draggedAttr = await target.getAttribute('transform');
  expect(draggedAttr, `${pointerType} drag changed the pan state`).not.toBe(beforeAttr);

  // Releasing ends the gesture: a later move must not keep panning.
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: end.x + 200, y: end.y + 200, buttons: 0,
    pointerType: pointerType === 'touch' ? 'mouse' : pointerType,
  });
  await page.waitForTimeout(150);
  expect(await target.getAttribute('transform'), `${pointerType} release stops panning`).toBe(draggedAttr);
  await client.detach();
}

for (const width of WIDTHS) {
  test(`library row geometry, controlled-list id, and announced count at ${width}px`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    const surface = `library at ${width}px`;

    // FE-03 in its virtualized state: 120 rows requested in one response.
    await page.goto(`${basePath}/library/?page=${VIRTUAL_PAGE}`);
    await expect(page.locator('#search-results-list')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#search-results-list > li[aria-hidden="true"]').first()).toHaveCount(1);
    const top = await measureList(page);
    assertRowGeometry(top, `${surface} (top)`);

    // At the top of the list the window starts at the first result, so the rows
    // between the window and the end of the list are exactly the ones the
    // trailing spacer stands for — and every one of them is at least the card's
    // floor. A 92px unit cannot satisfy this: it reserves 92px for every row it
    // skips, and no row of this card is that short.
    const unrendered = top.loaded - top.rowCount;
    const trailingSpacer = Number.parseFloat(top.spacers.at(-1) ?? '');
    console.log(
      `${surface}: ${top.rowCount} rows rendered of ${top.loaded} loaded, trailing spacer ${trailingSpacer}px, floor for ${unrendered} unrendered rows ${unrendered * ROW_PITCH_FLOOR}px`
    );
    expect(unrendered, `${surface}: rows loaded`).toBeGreaterThan(0);
    expect(trailingSpacer, `${surface}: space reserved for ${unrendered} unrendered rows`)
      .toBeGreaterThanOrEqual(unrendered * ROW_PITCH_FLOOR);

    // FE-04 while the controlled list is rendered.
    await expect(page.getByRole('combobox', { name: 'Search n8n workflows' })).toHaveAttribute('aria-controls', 'search-results-list');
    expect(top.controls.length, `${surface}: aria-controls count`).toBeGreaterThan(0);
    expect(top.controls.filter((control) => !control.resolves), `${surface}: dangling aria-controls`).toEqual([]);

    // FE-03 away from the first page: the same invariants across the spacer.
    await page.locator('#search-results-list').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.evaluate((height) => window.scrollBy(0, height), VIEWPORT_HEIGHT);
    await page.waitForTimeout(400);
    assertRowGeometry(await measureList(page), `${surface} (one viewport down)`);

    // FE-05: the filtered count is announced where a screen reader hears it.
    // Scoped to the count itself: the load-more control in the same section is
    // also a polite live region ("Showing 120 of 11,245").
    const announcer = page
      .locator('section[aria-labelledby="library-results-heading"] p[aria-live]')
      .filter({ hasText: /^\d[\d,]* workflows?( of \d[\d,]+)?$/ });
    await expect(announcer).toHaveCount(1);
    const before = (await announcer.innerText()).trim();
    expect(before, `${surface}: announced count`).toMatch(/^\d[\d,]* workflows?( of \d[\d,]+)?$/);

    const search = page.getByRole('combobox', { name: 'Search n8n workflows' });
    await search.fill(FILTER_QUERY);
    // A filtered count: the non-zero first digit waits past the "0 workflows" frame that query
    // change publishes before the search settles.
    await expect(announcer).toHaveText(/^[1-9][\d,]* workflows of \d[\d,]+$/, { timeout: 30_000 });
    const filtered = (await announcer.innerText()).trim();
    const [filteredCount, filteredTotal] = filtered.split(' of ').map((part) => Number.parseInt(part.replace(/[^\d]/g, ''), 10));
    expect(filteredCount, `${surface}: announced filtered count`).toBeGreaterThan(0);
    expect(filteredCount, `${surface}: announced filtered count`).toBeLessThan(filteredTotal!);
    expect(filtered, `${surface}: announcer updated`).not.toBe(before);

    // FE-04 with no controlled list rendered: nothing claims a missing id.
    await search.fill(NO_MATCH_QUERY);
    await expect(page.getByText(/No workflows match/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#search-results-list')).toHaveCount(0);
    await expect(announcer).toHaveText(/^0 workflows of \d[\d,]+$/);
    const controlsWithoutList = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-controls]')).map((element) => {
      const id = element.getAttribute('aria-controls') ?? '';
      return { id, resolves: id !== '' && document.getElementById(id) !== null };
    }).filter((control) => !control.resolves));
    expect(controlsWithoutList, `${surface}: dangling aria-controls`).toEqual([]);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('[aria-controls]')).map((element) => element.getAttribute('aria-controls'))), `${surface}: stale list id`).not.toContain('search-results-list');
    expect(await page.evaluate(() => document.querySelector('[role="combobox"]')?.hasAttribute('aria-controls') ?? false), `${surface}: combobox still claims a list`).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test(`interactive canvas pans by pointer while severity counts stay out of live regions at ${width}px`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });

    const lean = firstLeanSubject();
    await page.goto(`${basePath}${viewHref(lean)}`);
    await expect(page.getByRole('heading', { name: lean.title })).toBeVisible({ timeout: 30_000 });
    await assertSeverityCountsAreNotLiveRegions(page, `detail view (lean) at ${width}px`);

    const prerendered = firstPrerenderedSubject();
    await page.goto(`${basePath}${viewHref(prerendered)}`);
    await expect(page.getByRole('heading', { name: prerendered.title })).toBeVisible({ timeout: 30_000 });
    await assertSeverityCountsAreNotLiveRegions(page, `detail view (representative) at ${width}px`);
    await page.getByRole('button', { name: /Load interactive canvas/i }).click();
    await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });

    for (const pointerType of ['touch', 'pen', 'mouse'] as const) await dragPreview(page, pointerType);

    expect(pageErrors).toEqual([]);
  });
}
