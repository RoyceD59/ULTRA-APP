import { test, expect } from '@playwright/test';

for (const [name, width, height, size] of [
  ['compact', 390, 844, 'compact'],
  ['medium', 820, 1180, 'medium'],
  ['expanded', 1440, 900, 'expanded'],
] as const) {
  test(`Companion navigation reflows at ${name} width`, async ({ page }, testInfo) => {
    const liveRequests: string[] = [];
    await page.route(/^https?:\/\/(?:[^/]+\.)?(?:ucfilters\.com|ucfilters\.co\.ke|replit\.app)(?:[:/]|$)/i, route => {
      liveRequests.push(route.request().url());
      return route.abort();
    });
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByTestId(`companion-navigation-${size}`)).toBeVisible();
    for (const tab of ['index', 'products', 'blog', 'support', 'map', 'account']) {
      await expect(page.getByTestId(`companion-tab-${tab}`)).toBeAttached();
    }
    await page.getByTestId('companion-tab-map').click();
    await expect(page).toHaveURL(/\/map(?:\?|$)/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`companion-${name}.png`), fullPage: true });
    expect(liveRequests).toEqual([]);
  });
}

test('Project Hub opens from its own preview origin', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const response = await page.goto('http://localhost:5055/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).not.toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('project-hub.png'), fullPage: true });
});