import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1360, height: 900 },
    launchOptions: process.env.ELASTIC_CHROME ? { executablePath: process.env.ELASTIC_CHROME } : {},
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
});
