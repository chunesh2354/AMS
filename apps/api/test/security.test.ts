import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isSensitiveSet, PERMISSION_SETS } from '@ams/domain';
import { appUrl, ownerUrl } from '../src/dev/db';
import { buildApp } from '../src/app';
import { scrubText, serializeErr } from '../src/http/logging';
import { accountKey, WindowCounter } from '../src/http/rate-limit';
import { freshApp, type Fresh } from './helpers';

const PORT = 54331;
const MIGRATION_005 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/migrations/005_firm_setup.sql');

async function freshDbName() {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: ownerUrl(PORT, 'postgres') });
  await admin.connect();
  await admin.query(`create database ${name} template ams_template`);
  await admin.end();
  return name;
}

function capture() {
  const lines: string[] = [];
  return {
    stream: { write: (line: string) => { lines.push(line); } },
    text: () => lines.join(''),
    entries: () => lines.map((l) => JSON.parse(l) as Record<string, any>),
  };
}

const token = () => randomBytes(32).toString('base64url');
const tokenOf = (url: string) => url.split('/').pop()!;

// ----- MUST FIX 5: an unmatched URL that carries a token never reaches the log (or the reply) unscrubbed. -----
describe('not-found handler and log scrubbing', () => {
  const log = capture();
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    app = buildApp(appUrl(PORT, await freshDbName()), { log: { stream: log.stream, level: 'trace' } });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  it('a reset or invite token with a trailing slash gets the standard 404 and never appears in the logs', async () => {
    const secrets: string[] = [];
    for (const kind of ['reset', 'invite']) {
      for (const method of ['GET', 'POST'] as const) {
        const t = token();
        secrets.push(t);
        const res = await app.inject({ method, url: `/api/v1/auth/${kind}/${t}/`, payload: method === 'POST' ? { password: 'a-long-enough-password' } : undefined });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), details: [] } });
        expect(res.body).not.toContain(t);
        expect(res.headers['x-request-id']).toBeTruthy();
      }
    }
    // Percent-encoded, deeper path and query variants of the same leak.
    const enc = token();
    secrets.push(enc);
    const encoded = enc.split('').map((ch, i) => (i % 5 === 0 ? `%${ch.charCodeAt(0).toString(16).toUpperCase()}` : ch)).join('');
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/reset/${encoded}/` })).statusCode).toBe(404);
    const deep = token();
    secrets.push(deep);
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/invite/${deep}/extra?token=${deep}` })).statusCode).toBe(404);

    const out = log.text();
    for (const t of secrets) expect(out).not.toContain(t);
    expect(out).not.toContain(encoded);
    const notFound = log.entries().filter((e) => e.msg === 'route not found');
    expect(notFound.length).toBeGreaterThanOrEqual(6);
    expect(notFound.map((e) => e.url)).toContain('/api/v1/auth/reset/[REDACTED]/');
    expect(notFound.map((e) => e.url)).toContain('/api/v1/auth/invite/[REDACTED]/');
    // Fastify's default message ("Route GET:<raw url> not found") is not used.
    expect(out).not.toMatch(/Route (GET|POST):/);
    // The default request/response lines still exist, with the scrubbed URL.
    const incoming = log.entries().filter((e) => e.msg === 'incoming request');
    expect(incoming.length).toBeGreaterThan(0);
    for (const e of incoming) expect(e.req.url).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    const completed = log.entries().filter((e) => e.msg === 'request completed');
    expect(completed.length).toBeGreaterThan(0);
    for (const e of completed) expect(Object.keys(e.res)).toEqual(['statusCode']);
  });

  it('a matched token route that answers 404 or 410 does not log the token either', async () => {
    const t = token();
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/reset/${t}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/auth/invite/${t}` })).statusCode).toBe(404);
    expect(log.text()).not.toContain(t);
  });

  it('an unknown address elsewhere answers in the standard shape too', async () => {
    const res = await app.inject({ method: 'GET', url: '/no-such-page' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('scrubs URLs inside error messages and stacks', () => {
    const t = token();
    const err = Object.assign(new Error(`Route GET:/api/v1/auth/reset/${t}/ not found`), { code: 'X', url: `/api/v1/auth/invite/${t}` });
    const out = serializeErr(err) as Record<string, any>;
    expect(JSON.stringify(out)).not.toContain(t);
    expect(out.message).toBe('Route GET:/api/v1/auth/reset/[REDACTED]/ not found');
    expect(out.code).toBe('X');
    expect(out.type).toBe('Error');
    const id = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
    expect(scrubText(`failed at /api/v1/projects/${id}`)).toBe(`failed at /api/v1/projects/${id}`);
  });
});

// ----- MUST FIX 6: who may issue a reset link, and when open links stop working. -----
describe('reset and invite links: own account, sensitive grants', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  const preview = async (t: string) => (await f.app.inject({ method: 'GET', url: `/api/v1/auth/reset/${t}` })).statusCode;
  const resetLinks = async (ref: string) => (await f.owner.query('select count(*)::int n from password_reset_token where person_id = $1', [f.id(ref)])).rows[0].n as number;

  it('nobody issues a reset link for their own account; the message points to Change password', async () => {
    const own = await f.call('P01', 'POST', `/accounts/${f.id('P01')}/reset-link`);
    expect(own.status).toBe(422);
    expect(own.body.error.message).toMatch(/Change password/);
    expect(await resetLinks('P01')).toBe(0);
    // A non-sensitive admin on themselves: P10 without finance.
    expect((await f.call('P01', 'PUT', `/accounts/${f.id('P10')}/types`, { account_types: ['admin'] })).status).toBe(200);
    const self = await f.call('P10', 'POST', `/accounts/${f.id('P10')}/reset-link`);
    expect(self.status).toBe(422);
    expect(self.body.error.message).toMatch(/Change password/);
    expect(await resetLinks('P10')).toBe(0);
    // The same admin may still issue one for an employee.
    expect((await f.call('P10', 'POST', `/accounts/${f.id('P04')}/reset-link`)).status).toBe(200);
  });

  it('an account holding any sensitive grant is sensitive: only a principal may reset it, and the refusal is audited', async () => {
    const granted = await f.call('P01', 'POST', `/people/${f.id('P06')}/grants`, { capability: 'rates.cost.view', reason: 'Fee proposals' });
    expect(granted.status).toBe(200);
    const before = (await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id('P06')])).rows[0].n;
    const refused = await f.call('P10', 'POST', `/accounts/${f.id('P06')}/reset-link`);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('FORBIDDEN_CAPABILITY');
    expect(refused.body.error.capability).toBe('permissions.grant.sensitive');
    expect((await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id('P06')])).rows[0].n).toBe(before + 1);
    expect(await resetLinks('P06')).toBe(0);
    expect((await f.call('P01', 'POST', `/accounts/${f.id('P06')}/reset-link`)).status).toBe(200);
  });

  it('granting a sensitive set through /people/:id/grants revokes open reset links', async () => {
    const link = await f.call('P10', 'POST', `/accounts/${f.id('P05')}/reset-link`);
    expect(link.status).toBe(200);
    const t = tokenOf(link.body.reset_url);
    expect(await preview(t)).toBe(200);
    expect((await f.call('P01', 'POST', `/people/${f.id('P05')}/grants`, { permission_set: 'finance', reason: 'Covering accounts' })).status).toBe(200);
    expect(await preview(t)).toBe(410);
    const used = await f.app.inject({ method: 'POST', url: `/api/v1/auth/reset/${t}`, payload: { password: 'a-brand-new-password' } });
    expect(used.statusCode).toBe(410);
    // And a non-principal cannot issue a fresh one now.
    expect((await f.call('P10', 'POST', `/accounts/${f.id('P05')}/reset-link`)).status).toBe(403);
  });

  it('granting a sensitive capability revokes an open invite link, and a non-principal cannot reissue it', async () => {
    const made = await f.call('P10', 'POST', '/accounts', { name: 'New Joiner', work_email: 'joiner@meridian.demo', job_title: 'Architect', account_types: ['employee'] });
    expect(made.status).toBe(200);
    const inviteToken = tokenOf(made.body.invite_url);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${inviteToken}` })).statusCode).toBe(200);
    expect((await f.call('P01', 'POST', `/people/${made.body.id}/grants`, { capability: 'margin.view', reason: 'Project reviews' })).status).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${inviteToken}` })).statusCode).toBe(410);
    expect((await f.call('P10', 'POST', `/accounts/${made.body.id}/invite`)).status).toBe(403);
    expect((await f.call('P01', 'POST', `/accounts/${made.body.id}/invite`)).status).toBe(200);
  });

  it('an ordinary grant leaves open links alone', async () => {
    const ordinary = PERMISSION_SETS.find((s) => !isSensitiveSet(s));
    expect(ordinary).toBeDefined();
    const link = await f.call('P10', 'POST', `/accounts/${f.id('P07')}/reset-link`);
    expect(link.status).toBe(200);
    expect((await f.call('P01', 'POST', `/people/${f.id('P07')}/grants`, { permission_set: ordinary, reason: 'Extra duties' })).status).toBe(200);
    expect(await preview(tokenOf(link.body.reset_url))).toBe(200);
  });

  it('grants still validate and refuse as before', async () => {
    expect((await f.call('P01', 'POST', `/people/${f.id('P08')}/grants`, {})).status).toBe(400);
    expect((await f.call('P04', 'POST', `/people/${f.id('P08')}/grants`, { permission_set: 'finance' })).status).toBe(403);
  });
});

// ----- Should-fix: a second limit per target account, whatever IP the attempts come from. -----
describe('rate limiting per account', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    app = buildApp(appUrl(PORT, await freshDbName()), { rateLimit: { max: 100, windowMs: 60_000, account: { max: 3, windowMs: 60_000 } } });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  const from = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` });

  it('one email cannot be tried more than the limit from many IPs, in any letter case; other emails are unaffected', async () => {
    const codes: number[] = [];
    for (const [i, email] of ['target@meridian.demo', 'TARGET@meridian.demo', ' Target@Meridian.demo ', 'target@meridian.demo'].entries()) {
      codes.push((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'wrong-password-123' }, headers: from(10 + i) })).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429]);
    const last = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'target@meridian.demo', password: 'wrong-password-123' }, headers: from(30) });
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toMatchObject({ code: 'RATE_LIMITED', details: [], retry_after_seconds: expect.any(Number) });
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'other@meridian.demo', password: 'wrong-password-123' }, headers: from(30) })).statusCode).toBe(401);
  });

  const login = (email: string, password: string, ip: number) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, headers: from(ip) }).then((r) => r.statusCode);

  it('only failed attempts count: correct sign-ins never use up the allowance, and a success clears earlier failures', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push(await login('p03@meridian.demo', 'meridian-demo-2026', 80 + i));
    expect(codes).toEqual([200, 200, 200, 200, 200, 200]);
    // Two failures, then a success clears them: two more failures still do not reach the limit of 3.
    expect([await login('p03@meridian.demo', 'wrong-password-123', 90), await login('p03@meridian.demo', 'wrong-password-123', 91)]).toEqual([401, 401]);
    expect(await login('p03@meridian.demo', 'meridian-demo-2026', 92)).toBe(200);
    expect([await login('p03@meridian.demo', 'wrong-password-123', 93), await login('p03@meridian.demo', 'wrong-password-123', 94)]).toEqual([401, 401]);
  });

  it('wrong passwords from elsewhere cannot lock the owner out on an address they signed in from before', async () => {
    expect(await login('p05@meridian.demo', 'meridian-demo-2026', 100)).toBe(200); // the owner's usual address
    for (let i = 0; i < 3; i++) expect(await login('p05@meridian.demo', 'wrong-password-123', 110 + i)).toBe(401); // an attacker
    expect(await login('p05@meridian.demo', 'wrong-password-123', 120)).toBe(429); // the attacker is now blocked
    expect(await login('p05@meridian.demo', 'meridian-demo-2026', 121)).toBe(429); // so is any unknown address
    expect(await login('p05@meridian.demo', 'meridian-demo-2026', 100)).toBe(200); // the owner still gets in
  });

  it('platform login counts separately from firm login, per email', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: 'target@meridian.demo', password: 'wrong-password-123' }, headers: from(40 + i) })).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('one reset token and one invite token are limited across IPs', async () => {
    const t = token();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: 'POST', url: `/api/v1/auth/reset/${t}`, payload: { password: 'a-long-enough-password' }, headers: from(50 + i) })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429]);
    const inv = token();
    const acc: number[] = [];
    for (let i = 0; i < 4; i++) acc.push((await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token: inv, password: 'a-long-enough-password' }, headers: from(60 + i) })).statusCode);
    expect(acc).toEqual([404, 404, 404, 429]);
    // A different token is its own account.
    expect((await app.inject({ method: 'POST', url: `/api/v1/auth/reset/${token()}`, payload: { password: 'a-long-enough-password' }, headers: from(70) })).statusCode).toBe(404);
  });

  it('keys tokens by hash and emails lower-cased; requests without a target count against the IP limit only', () => {
    const t = token();
    const key = accountKey({ method: 'POST', url: `/api/v1/auth/reset/${t}`, routeOptions: { url: '/api/v1/auth/reset/:token' }, params: { token: t }, body: {} })!;
    expect(key.startsWith('/api/v1/auth/reset|token:')).toBe(true);
    expect(key).not.toContain(t);
    expect(accountKey({ method: 'POST', url: '/api/v1/auth/login', params: {}, body: { email: ' A@B.C ' } })).toBe('/api/v1/auth/login|email:a@b.c');
    expect(accountKey({ method: 'POST', url: '/api/v1/auth/login', params: {}, body: {} })).toBeNull();
    expect(accountKey({ method: 'POST', url: '/api/v1/me/password', params: {}, body: {}, actor: { id: 'p1' } })).toBe('/api/v1/me/password|person:p1');
    expect(accountKey({ method: 'GET', url: '/api/v1/projects', params: {}, body: {} })).toBeNull();
  });

  it('the window resets and the counter stays bounded', () => {
    const c = new WindowCounter({ max: 2, windowMs: 1000 }, 3);
    expect([c.hit('a', 0), c.hit('a', 10), c.hit('a', 20)]).toEqual([null, null, 1]);
    expect(c.hit('a', 1000)).toBeNull();
    for (const k of ['b', 'c', 'd', 'e']) c.hit(k, 1000);
    expect(c.hit('a', 1001)).toBeNull(); // 'a' was dropped as the oldest key
  });
});

// ----- Should-fix: migration 005 renames duplicate client names deterministically, then creates the index. -----
describe('migration 005: duplicate client names', () => {
  let owner: pg.Client;
  beforeAll(async () => {
    owner = new pg.Client({ connectionString: ownerUrl(PORT, await freshDbName()) });
    await owner.connect();
  });
  afterAll(async () => { await owner?.end(); });

  it('keeps the oldest name, renames later duplicates "Name (n)" skipping taken suffixes, reports them, and creates the index', async () => {
    const firmId = (await owner.query('select id from firm limit 1')).rows[0].id;
    // Back to the state before 005, with duplicates in the data.
    await owner.query('drop index client_name_unique');
    await owner.query('drop trigger firm_default_categories on firm');
    await owner.query('drop function firm_default_categories()');
    const ins = async (name: string, at: string) =>
      (await owner.query('insert into client (firm_id, name, created_at) values ($1, $2, $3) returning id', [firmId, name, at])).rows[0].id as string;
    const third = await ins('ACME STUDIO', '2026-03-01');
    const first = await ins('Acme Studio', '2026-01-01');
    const second = await ins(' acme studio ', '2026-02-01');
    const taken = await ins('Acme Studio (2)', '2026-01-15');
    const loneB = await ins('Birch & Co', '2026-01-01');
    const dupB = await ins('birch & co', '2026-01-01');

    const notices: string[] = [];
    owner.on('notice', (n) => notices.push(n.message ?? ''));
    await owner.query('begin');
    await owner.query(fs.readFileSync(MIGRATION_005, 'utf8'));
    await owner.query('commit');

    const names = new Map((await owner.query('select id, name from client where id = any($1)', [[first, second, third, taken, loneB, dupB]])).rows.map((r) => [r.id, r.name]));
    expect(names.get(first)).toBe('Acme Studio');
    expect(names.get(taken)).toBe('Acme Studio (2)');
    expect(names.get(second)).toBe('acme studio (3)');
    expect(names.get(third)).toBe('ACME STUDIO (4)');
    // Same created_at: the id breaks the tie, so the result does not depend on scan order.
    const [keepB, renameB] = [loneB, dupB].sort();
    expect(names.get(keepB)).toMatch(/^(Birch & Co|birch & co)$/);
    expect(names.get(renameB)).toMatch(/^(Birch & Co|birch & co) \(2\)$/);

    expect(notices.filter((m) => m.includes('renamed client'))).toHaveLength(3);
    expect(notices.some((m) => m.includes(second) && m.includes('acme studio (3)'))).toBe(true);
    expect(notices.some((m) => m.includes('renamed 3 duplicate'))).toBe(true);

    expect((await owner.query(`select 1 from pg_indexes where indexname = 'client_name_unique'`)).rowCount).toBe(1);
    await expect(owner.query('insert into client (firm_id, name) values ($1, $2)', [firmId, 'acme STUDIO'])).rejects.toMatchObject({ code: '23505' });
  });
});
