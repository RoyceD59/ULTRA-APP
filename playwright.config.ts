import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/preview/e2e',
  timeout: 45_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'preview-playwright-report', open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', trace: 'retain-on-failure' },
});
