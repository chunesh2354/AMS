import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-live',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4273' },
  webServer: [
    { command: 'npx tsx src/dev/e2e.ts', cwd: '../api', url: 'http://127.0.0.1:3001/api/v1/me', timeout: 180_000, reuseExistingServer: false, stdout: 'pipe' },
    {
      command: 'npm run build:live && npx vite preview --outDir dist-live --port 4273 --strictPort',
      url: 'http://localhost:4273',
      timeout: 180_000,
      reuseExistingServer: false,
      env: { AMS_API_TARGET: 'http://127.0.0.1:3001' },
    },
  ],
});
