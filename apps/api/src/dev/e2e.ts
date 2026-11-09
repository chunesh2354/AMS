import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appUrl, ownerUrl, startDevDb } from './db';
import { buildApp } from '../app';
import { seedPlatformAdmin } from './platform-admin';

// Throwaway database for the live browser tests: fresh dir, migrate, seed, serve on 3001.
const PORT = Number(process.env.AMS_E2E_DB_PORT ?? 54332);
const API_PORT = Number(process.env.AMS_E2E_API_PORT ?? 3001);
// One fixed directory, wiped at start. Playwright stops this process without a signal on Windows, so the cleanup in
// stop() never runs there; a fresh mkdtemp per run would leave a whole database behind every time. The port is fixed
// too, so two runs could never share a machine anyway.
const dir = path.join(os.tmpdir(), `ams-e2e-${PORT}`);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const db = await startDevDb(dir, PORT);
// The demo platform admin (admin@platform.demo), as start.ts and the API tests create it.
await seedPlatformAdmin(ownerUrl(PORT));
// The browser suite signs in many times from one address within a minute; the sign-in rate limit is
// covered by test/rate-limit.test.ts, so it is off here (as it is in the API tests).
const app = buildApp(appUrl(PORT), { rateLimit: false });
await app.listen({ host: '127.0.0.1', port: API_PORT });
console.log(`E2E API on http://127.0.0.1:${API_PORT}/api/v1`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close().catch(() => {});
  await db.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
