import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appUrl, ownerUrl, startDevDb } from './db';
import { buildApp } from '../app';
import { seedPlatformAdmin } from './platform-admin';

// Throwaway database for the live browser tests: fresh dir, migrate, seed, serve on 3001.
const PORT = Number(process.env.AMS_E2E_DB_PORT ?? 54332);
const API_PORT = Number(process.env.AMS_E2E_API_PORT ?? 3001);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ams-e2e-'));
const db = await startDevDb(dir, PORT);
// The demo platform admin (admin@platform.demo), as start.ts and the API tests create it.
await seedPlatformAdmin(ownerUrl(PORT));
const app = buildApp(appUrl(PORT));
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
