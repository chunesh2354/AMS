import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, ownerUrl } from '../src/dev/db';
import { buildApp } from '../src/app';
import { scrubUrl } from '../src/http/logging';
import { PASSWORD } from './helpers';

const PORT = 54331;

/** A test logger stream: every JSON line the app writes. */
function capture() {
  const lines: string[] = [];
  return {
    stream: { write: (line: string) => { lines.push(line); } },
    text: () => lines.join(''),
    entries: () => lines.map((l) => JSON.parse(l) as Record<string, any>),
  };
}

async function freshDb() {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: ownerUrl(PORT, 'postgres') });
  await admin.connect();
  await admin.query(`create database ${name} template ams_template`);
  await admin.end();
  return appUrl(PORT, name);
}

const SECRETS = {
  password: 'body-password-Zq81xx',
  cookie: 'cookie-value-Yt52yy',
  bearer: 'bearer-value-Wp33zz',
  errPassword: 'error-password-Vk44ww',
  rowHash: '$argon2id$v=19$m=65536,t=3,p=4$row-hash-Ux55vv',
};

describe('production logging', () => {
  const log = capture();
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    app = buildApp(await freshDb(), { log: { stream: log.stream, level: 'trace' } });
    // A route that fails the way an unexpected bug would. Outside /api/v1, so no session is needed.
    app.post('/test/boom', async () => {
      throw Object.assign(new Error('database exploded'), { password: SECRETS.errPassword });
    });
    // A Postgres error: its detail can quote the failing row, password and token hashes included.
    app.post('/test/pg-boom', async () => {
      throw Object.assign(new Error('null value in column "name" of relation "person" violates not-null constraint'), {
        code: '23502', table: 'person', column: 'name', detail: `Failing row contains (null, ${SECRETS.rowHash}).`,
      });
    });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  it('logs every 5xx with the error, request id, method and url, and returns the id in x-request-id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/test/boom?x=1',
      payload: { email: 'someone@meridian.demo', password: SECRETS.password },
      headers: { authorization: `Bearer ${SECRETS.bearer}` },
      cookies: { ams_session: SECRETS.cookie },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.', details: [] } });
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const failed = log.entries().find((e) => e.msg === 'request failed');
    expect(failed).toBeDefined();
    expect(failed!.level).toBe(50);
    expect(failed!.reqId).toBe(id);
    expect(failed!.method).toBe('POST');
    expect(failed!.url).toBe('/test/boom?x=1');
    expect(failed!.err.message).toBe('database exploded');
    expect(failed!.err.stack).toContain('database exploded');
  });

  it('never writes passwords, cookies, authorization headers or request bodies', async () => {
    // A real sign-in: the body carries a password and the reply sets a session cookie.
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'p01@meridian.demo', password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const session = ok.cookies.find((c) => c.name === 'ams_session')!.value;
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', cookies: { ams_session: session }, headers: { authorization: `Bearer ${session}` } });
    expect(me.headers['x-request-id']).toBeTruthy();

    const out = log.text();
    expect(out.length).toBeGreaterThan(0);
    for (const secret of [...Object.values(SECRETS), PASSWORD, session]) expect(out).not.toContain(secret);
    expect(out).not.toContain('someone@meridian.demo'); // request bodies are not logged at all
    expect(out).toContain('"password":"[REDACTED]"'); // the error's own password field was censored, not dropped silently
  });

  it('logs a database error without the row values Postgres quotes in its detail', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/pg-boom' });
    expect(res.statusCode).toBe(500);
    const failed = log.entries().find((e) => e.msg === 'request failed' && e.url === '/test/pg-boom');
    expect(failed).toBeDefined();
    expect(failed!.err.code).toBe('23502');
    expect(failed!.err.table).toBe('person');
    expect(failed!.err.detail).toBe('[REDACTED]');
    expect(log.text()).not.toContain('row-hash-Ux55vv');
  });

  it('gives each request its own id and ignores an incoming x-request-id', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'forged' } });
    const b = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['x-request-id']).not.toBe('forged');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});

describe('url scrubbing', () => {
  it('masks invite and reset tokens and token query values but keeps record ids', () => {
    const token = 'Abc_def-ghijklmnopqrstuvwxyz0123456789ABCDE';
    const id = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
    expect(scrubUrl(`/api/v1/auth/invite/${token}`)).toBe('/api/v1/auth/invite/[REDACTED]');
    expect(scrubUrl(`/api/v1/auth/reset/${token}?a=1`)).toBe('/api/v1/auth/reset/[REDACTED]?a=1');
    expect(scrubUrl(`/api/v1/projects/${id}`)).toBe(`/api/v1/projects/${id}`);
    expect(scrubUrl(`/api/v1/x?token=${token}&b=2`)).toBe('/api/v1/x?token=[REDACTED]&b=2');
  });
});

describe('quiet by default in tests', () => {
  it('builds a silent logger when no stream is given', async () => {
    const app = buildApp(appUrl(PORT, 'ams_template'));
    await app.ready();
    expect(app.log.level).toBe('silent');
    await app.close();
  });
});
