import { expect, test } from '@playwright/test';
import { appPath } from './app-paths';
import { firstPrerenderedSubject, viewHref } from './detail-subjects';

test('interactive canvas fullscreen overlay supports keyboard containment, Escape, and focus return at 320 and 1440', async ({ page }) => {
  const subject = firstPrerenderedSubject();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(appPath(viewHref(subject)));
    await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Load interactive canvas/i }).click();
    await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });

    const opener = page.getByRole('button', { name: 'Fullscreen view' });
    await opener.focus();
    await page.keyboard.press('Enter');

    const exitFullscreen = page.getByRole('button', { name: 'Exit fullscreen' });
    await expect(exitFullscreen).toBeVisible();
    await expect(exitFullscreen).toBeFocused();

    const focusInside = () => page.evaluate(() => Boolean(document.querySelector('[data-testid="workflow-chart"]')?.contains(document.activeElement)));
    expect(await focusInside()).toBe(true);
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await focusInside()).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(exitFullscreen).toBeVisible();
    await exitFullscreen.click();
    await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test('canvas controls show a keyboard focus indicator', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const subject = firstPrerenderedSubject();
  await page.goto(appPath(viewHref(subject)));
  await expect(page.getByRole('heading', { level: 1, name: subject.title })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Load interactive canvas/i }).click();
  await expect(page.getByRole('group', { name: /Workflow diagram/ })).toBeVisible({ timeout: 30_000 });

  const labelByTarget: Record<string, string> = {
    'Zoom in': 'the zoom-in control',
    'Fit workflow to view': 'the Fit button',
    'Reset workflow view to fit': 'the Reset button',
    'Fullscreen view': 'the Fullscreen button',
    'View workflow node list': 'the node-list summary',
  };
  const targets = Object.keys(labelByTarget);
  const observed: Record<string, boolean> = {};

  for (let presses = 0; presses < 240 && Object.keys(observed).length < targets.length; presses += 1) {
    await page.keyboard.press('Tab');
    const probe = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const style = getComputedStyle(active);
      return {
        name: active.getAttribute('aria-label') ?? (active.textContent ?? '').trim(),
        visible: (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
          || style.boxShadow !== 'none',
      };
    });
    if (!probe) continue;
    for (const name of targets) {
      if (!(name in observed) && probe.name.startsWith(name)) observed[name] = probe.visible;
    }
  }

  const missing = targets.filter((name) => !(name in observed));
  expect(missing, `keyboard focus never reached: ${missing.join(', ')}`).toEqual([]);
  for (const [name, visible] of Object.entries(observed)) {
    expect(visible, `${labelByTarget[name]} has no visible keyboard focus indicator`).toBe(true);
  }
});
