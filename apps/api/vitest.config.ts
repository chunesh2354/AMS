import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@ams/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts', '../../packages/domain/src/**/*.test.ts'],
    globalSetup: './test/global-setup.ts',
    testTimeout: 30000,
    hookTimeout: 120000,
    pool: 'forks',
  },
  server: { fs: { strict: false } },
});
