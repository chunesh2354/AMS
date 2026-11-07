import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { DEV_PORT, ownerUrl } from './db';

/** Sample values for local use and tests only. Never created in production. */
export const PLATFORM_DEMO_EMAIL = 'admin@platform.demo';
export const PLATFORM_DEMO_PASSWORD = 'platform-demo-2026';
export const PLATFORM_DEMO_NAME = 'Platform Admin (DEMO)';
const MIN_PASSWORD = 14;

/** Inserts the admin, or updates the name and password of an existing one. Uses the owner connection. */
export async function upsertPlatformAdmin(ownerConn: string, email: string, name: string, password: string, opts: { keepExisting?: boolean } = {}) {
  const db = new pg.Client({ connectionString: ownerConn });
  await db.connect();
  try {
    const passwordHash = await hash(password);
    const conflict = opts.keepExisting ? 'do nothing' : 'do update set name = excluded.name, password_hash = excluded.password_hash';
    await db.query(
      `insert into platform_admin (email, name, password_hash) values (lower($1), $2, $3) on conflict (email) ${conflict}`,
      [email.trim(), name.trim(), passwordHash],
    );
    return (await db.query('select id from platform_admin where email = lower($1)', [email.trim()])).rows[0].id as string;
  } finally {
    await db.end();
  }
}

/** The demo platform admin for dev and tests. Idempotent; refuses to run in production. */
export async function seedPlatformAdmin(ownerConn: string) {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo platform admin is never created in production.');
  return upsertPlatformAdmin(ownerConn, PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_NAME, PLATFORM_DEMO_PASSWORD, { keepExisting: true });
}

/** CLI: PLATFORM_ADMIN_PASSWORD=... tsx src/dev/platform-admin.ts <email> <name> */
async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
    console.error('Usage: PLATFORM_ADMIN_PASSWORD=... tsx src/dev/platform-admin.ts <email> <name>');
    process.exit(2);
  }
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!password || password.length < MIN_PASSWORD) {
    console.error(`Set PLATFORM_ADMIN_PASSWORD to at least ${MIN_PASSWORD} characters. The password is never taken from the command line.`);
    process.exit(2);
  }
  const conn = process.env.AMS_OWNER_URL ?? ownerUrl(DEV_PORT);
  const id = await upsertPlatformAdmin(conn, email, name, password);
  console.log(`Platform admin ${email.toLowerCase()} saved (${id}).`);
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked === import.meta.url) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
