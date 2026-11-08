import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate, ownerUrl } from '../src/dev/db';
import { seed } from '../src/dev/seed';
import { seedPlatformAdmin } from '../src/dev/platform-admin';

const PORT = 54331;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.pgtest');

export default async function setup() {
  fs.rmSync(dir, { recursive: true, force: true });
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'ams_owner_dev', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  try {
    await server.createDatabase('ams_template');
    const url = ownerUrl(PORT, 'ams_template');
    await migrate(url);
    await seed(url, { today: '2026-11-06' });
    await seedPlatformAdmin(url);
    const admin = new pg.Client({ connectionString: ownerUrl(PORT, 'postgres') });
    await admin.connect();
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ams_template' and pid <> pg_backend_pid()`);
    await admin.end();
  } catch (e) {
    await server.stop().catch(() => {});
    throw e;
  }
  return async () => { await server.stop(); };
}
