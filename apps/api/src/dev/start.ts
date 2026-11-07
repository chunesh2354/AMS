import { appUrl, DEV_PORT, startDevDb } from './db';
import { buildApp } from '../server';

const db = await startDevDb();
const app = buildApp(appUrl(DEV_PORT));
await app.listen({ host: '127.0.0.1', port: 3000 });
console.log('API on http://127.0.0.1:3000/api/v1');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close().catch(() => {});
  await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
