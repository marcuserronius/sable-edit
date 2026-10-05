import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'test/e2e',
  webServer: { command: 'npx serve . -l 8080', url: 'http://localhost:8080/demo/', reuseExistingServer: true },
  use: { baseURL: 'http://localhost:8080' },
});
