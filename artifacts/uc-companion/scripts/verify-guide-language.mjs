import { chromium, expect } from '@playwright/test';

// Run against the managed Expo web preview:
// BASE_URL=https://$REPLIT_EXPO_DEV_DOMAIN node scripts/verify-guide-language.mjs
if (!process.env.BASE_URL) throw new Error('BASE_URL must point to the running Companion preview');
const base = process.env.BASE_URL.replace(/\/$/, '');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/guide/bottle-setup`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Kiswahili', exact: true }).click({ timeout: 120_000 });
  await expect(page.getByRole('heading', { name: 'Kuanza kutumia chupa yako yenye kichujio', exact: true })).toBeVisible();
  await expect(page.getByText('Vilivyomo kwenye kifurushi', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Kabla ya matumizi ya kwanza', exact: true }).click();
  await expect(page.getByText('Jaza chupa hadi juu kwa maji safi ya bomba.', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Kuanza kutumia chupa yako yenye kichujio', exact: true })).toBeVisible({ timeout: 120_000 });

  await page.goto(`${base}/support`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Kuanza kutumia chupa yako yenye kichujio', { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByPlaceholder('Tafuta miongozo…').fill('katriji');
  await expect(page.getByText('Jinsi ya kubadilisha katriji ya kichujio cha chupa', { exact: true })).toBeVisible();
  await page.getByText('Jinsi ya kubadilisha katriji ya kichujio cha chupa', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jinsi ya kubadilisha katriji ya kichujio cha chupa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How to replace your bottle filter cartridge', exact: true })).toBeVisible();
  await page.goto(`${base}/support`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Getting started with your filter bottle', { exact: true })).toBeVisible({ timeout: 120_000 });

  await page.getByRole('button', { name: 'Kiswahili', exact: true }).click();
  for (const [id, title] of [
    ['sweet-home-install', 'Sweet Home — mwongozo wa kufunga kichujio cha bomba'],
    ['shower-filter-install', 'Kufunga kichujio cha bafu na kubadilisha katriji'],
    ['ecosmart-elite-setup', 'EcoSmart Elite — setup, solar charging & pump care'],
  ]) {
    await page.goto(`${base}/guide/${id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 120_000 });
  }
  // A separate tab shares persisted preference, but has no in-memory store.
  const reopened = await context.newPage();
  await reopened.goto(`${base}/guide/bottle-setup`, { waitUntil: 'domcontentloaded' });
  await expect(reopened.getByRole('heading', { name: 'Kuanza kutumia chupa yako yenye kichujio', exact: true })).toBeVisible({ timeout: 120_000 });
  expect(errors).toEqual([]);
  console.log('PASS: EN/SW toggle, four translated guides, search, navigation, reload, reopened tab, and English fallback');
} finally {
  await browser.close();
}