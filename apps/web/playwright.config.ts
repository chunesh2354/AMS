import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: [
    { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true },
    { command: 'npx vite preview --outDir storybook-static --port 6106 --strictPort', url: 'http://localhost:6106', reuseExistingServer: true },
  ],
});
