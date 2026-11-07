import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { appUrl, ownerUrl } from '../src/dev/db';
import { buildApp } from '../src/server';

const PORT = 54331;
export const PASSWORD = 'meridian-demo-2026';

export type Res = { status: number; body: any };

/** A database of its own, copied from the seeded template, reached through the ams_app role so RLS applies. */
export async function freshApp() {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: ownerUrl(PORT, 'postgres') });
  await admin.connect();
  await admin.query(`create database ${name} template ams_template`);
  await admin.end();

  const app = buildApp(appUrl(PORT, name));
  await app.ready();
  const owner = new pg.Client({ connectionString: ownerUrl(PORT, name) });
  await owner.connect();

  const people = (await owner.query('select id, ref_code from person')).rows;
  const ids = new Map<string, string>(people.map((p) => [p.ref_code, p.id]));
  const firmId = (await owner.query('select id from firm')).rows[0].id as string;
  const cookies = new Map<string, string>();

  const rawLogin = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  async function login(ref: string) {
    const hit = cookies.get(ref);
    if (hit) return hit;
    const res = await rawLogin(`${ref.toLowerCase()}@meridian.demo`, PASSWORD);
    if (res.statusCode !== 200) throw new Error(`login ${ref} failed: ${res.statusCode} ${res.body}`);
    const c = res.cookies.find((x) => x.name === 'ams_session');
    if (!c) throw new Error('no session cookie');
    cookies.set(ref, c.value);
    return c.value;
  }
  async function call(ref: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const token = await login(ref);
    const res = await app.inject({ method, url: `/api/v1${url}`, payload: payload as any, headers, cookies: { ams_session: token } });
    let body: any = res.body;
    try { body = JSON.parse(res.body); } catch { /* not JSON */ }
    return { status: res.statusCode, body };
  }
  const appClient = async () => {
    const c = new pg.Client({ connectionString: appUrl(PORT, name) });
    await c.connect();
    return c;
  };
  return {
    app, owner, firmId, login, call, rawLogin, appClient,
    id: (ref: string) => {
      const v = ids.get(ref);
      if (!v) throw new Error(`no person ${ref}`);
      return v;
    },
    close: async () => { await owner.end(); await app.close(); },
  };
}
export type Fresh = Awaited<ReturnType<typeof freshApp>>;
