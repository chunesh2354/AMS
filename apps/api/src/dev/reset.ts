import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevDb } from './db';

/** Wipes the local development database and reseeds it. Never touches anything but apps/api/.pgdata. */
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.pgdata');
fs.rmSync(dir, { recursive: true, force: true });
const db = await startDevDb(dir);
await db.stop();
console.log('Development database reset and reseeded.');
