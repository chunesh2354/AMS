import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seed } from './seed';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = path.resolve(here, '../../../../packages/db/migrations');

export const DEV_PORT = Number(process.env.AMS_DB_PORT ?? 54320);
export const ownerUrl = (port: number, db = 'ams') => `postgres://postgres:ams_owner_dev@localhost:${port}/${db}`;
export const appUrl = (port: number, db = 'ams') => `postgres://ams_app:ams_app_dev@localhost:${port}/${db}`;

/** Versioned SQL migrations, applied once each, in order. */
export async function migrate(connectionString: string) {
  const c = new pg.Client({ connectionString });
  await c.connect();
  try {
    await c.query('create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())');
    for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
      if ((await c.query('select 1 from schema_migration where name = $1', [f])).rowCount) continue;
      await c.query('begin');
      await c.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
      await c.query('insert into schema_migration (name) values ($1)', [f]);
      await c.query('commit');
    }
  } finally {
    await c.end();
  }
}

/** A real local Postgres with no system install. Docker Compose (infra/) is the other way to run it. */
export async function startDevDb(dir = path.resolve(here, '../../.pgdata'), port = DEV_PORT) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'ams_owner_dev', port, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  if (fresh) await server.initialise();
  await server.start();
  if (fresh) await server.createDatabase('ams');
  await migrate(ownerUrl(port));
  await seed(ownerUrl(port));
  return server;
}
