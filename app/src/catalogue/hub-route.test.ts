import { describe, expect, it } from 'vitest';
import { HUB_PAGE_SIZE, libraryHubHref, libraryTagHref } from './hub-route';

describe('hub routes', () => {
  it('targets the complete worker-backed library for tag and hub discovery', () => {
    expect(libraryTagHref('Daily Digest')).toBe('/library/?tag=daily-digest');
    expect(libraryTagHref('unknown')).toBe('/library/?tag=unknown');
    expect(libraryHubHref('integration', 'OpenAI')).toBe('/library/?integration=openai');
    expect(libraryHubHref('trigger', 'Webhook')).toBe('/library/?trigger=webhook');
    expect(libraryHubHref('security', 'high')).toBe('/library/?grade=HIGH');
    expect(libraryHubHref('tag', 'Daily Digest')).toBe('/library/?tag=daily-digest');
  });

  it('bounds static hub page size for lean RSC export', () => {
    expect(HUB_PAGE_SIZE).toBeLessThanOrEqual(8);
    expect(HUB_PAGE_SIZE).toBeGreaterThanOrEqual(4);
  });
});
