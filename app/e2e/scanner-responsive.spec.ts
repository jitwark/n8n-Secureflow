import { expect, test } from '@playwright/test';
import { assertNoOverflow, assertTarget } from './web-qa-helpers';

const basePath = (process.env.PLAYWRIGHT_BASE_PATH ?? '').replace(/\/+$/, '');

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`scanner input stays first and reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${basePath}/scanner`);

    const radiogroup = page.getByRole('radiogroup', { name: 'Scanner profile' });
    await expect(radiogroup).toBeVisible();
    await expect(radiogroup.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
    await expect(radiogroup.getByRole('radio', { name: 'Strict' })).toHaveAttribute('aria-checked', 'false');
    // Both dimensions, because SC 2.5.8 is about the target box: a 44px-wide
    // control that is 30px tall is still a 30px target.
    await assertTarget(page, 'Scan workflow');
    await expect(page.getByRole('note').first()).toContainText('Nothing is transmitted');
    expect(await page.evaluate(() => {
      const input = document.querySelector('#workflow-json');
      const guide = document.querySelector('#scanner-purpose');
      return Boolean(input && guide && (input.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    await assertNoOverflow(page);
  });
}
