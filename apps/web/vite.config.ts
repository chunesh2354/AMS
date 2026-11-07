import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const proxy = { '/api': { target: process.env.AMS_API_TARGET ?? 'http://127.0.0.1:3000' } };

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 20000,
  },
});
