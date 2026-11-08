/**
 * Production entry point. Unlike src/dev/start.ts it starts no embedded database and seeds nothing:
 * it migrates the real database, sets the app role's password from the environment and listens.
 *
 * Environment (see infra/aws/README.md):
 *   AMS_OWNER_URL     owner connection, used only for migrations and the role password
 *   AMS_APP_PASSWORD  password for the ams_app role (migration 001 creates it with a dev password)
 *   DATABASE_URL      optional; defaults to ams_app on the owner URL's host and database
 *   PORT, HOST        default 3000 on 127.0.0.1 (the reverse proxy is the only way in)
 */
import pg from 'pg';
import { buildApp } from './app';
import { migrate } from './dev/db';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (process.env.NODE_ENV !== 'production') fail('main.ts is the production entry point. Set NODE_ENV=production, or use npm run dev.');
const ownerUrl = process.env.AMS_OWNER_URL ?? fail('Set AMS_OWNER_URL.');
const appPassword = process.env.AMS_APP_PASSWORD ?? '';
if (appPassword.length < 24) fail('Set AMS_APP_PASSWORD to at least 24 characters.');

const appUrl = process.env.DATABASE_URL ?? (() => {
  const u = new URL(ownerUrl);
  u.username = 'ams_app';
  u.password = appPassword;
  return u.toString();
})();

await migrate(ownerUrl);

// Replace the development password that migration 001 gives ams_app. format(%L) quotes it safely.
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
try {
  const sql = (await owner.query('select format($$alter role ams_app password %L$$, $1::text) as sql', [appPassword])).rows[0].sql as string;
  await owner.query(sql);
} finally {
  await owner.end();
}

const app = buildApp(appUrl, { secureCookie: true });
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
await app.listen({ host, port });
console.log(`API listening on http://${host}:${port}/api/v1`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
