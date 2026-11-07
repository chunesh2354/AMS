import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

// Needs migration 002 (packages/db/pending/002_accounts_platform.sql moved into packages/db/migrations)
// and accountRoutes wired into server.ts with the two invite paths in PUBLIC.

function withApp() {
  const ctx = {} as { f: Fresh };
  beforeAll(async () => { ctx.f = await freshApp(); });
  afterAll(async () => { await ctx.f?.close(); });
  return ctx;
}

const NEW_PASSWORD = 'a-long-enough-password';
const tokenOf = (inviteUrl: string) => inviteUrl.split('/').pop()!;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

async function getInvite(f: Fresh, token: string) {
  const res = await f.app.inject({ method: 'GET', url: `/api/v1/auth/invite/${token}` });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function accept(f: Fresh, token: string, password = NEW_PASSWORD) {
  const res = await f.app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: { token, password } });
  return { status: res.statusCode, body: JSON.parse(res.body), cookie: res.cookies.find((c) => c.name === 'ams_session')?.value };
}
async function asCookie(f: Fresh, cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await f.app.inject({ method, url: `/api/v1${url}`, payload: payload as any, cookies: { ams_session: cookie } });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
const setsOf = async (f: Fresh, personId: string) =>
  (await f.owner.query('select s.key from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 order by s.key', [personId])).rows.map((r) => r.key);
const auditCount = async (f: Fresh, action: string, recordId?: string) =>
  (await f.owner.query('select count(*)::int n from audit_event where action = $1 and ($2::text is null or record_id = $2)', [action, recordId ?? null])).rows[0].n as number;

describe('creating accounts', () => {
  const c = withApp();

  it('an admin creates an employee account and gets an invite link; only the hash is stored', async () => {
    const res = await c.f.call('P10', 'POST', '/accounts', { name: 'Tara Joshi', work_email: 'tara@meridian.demo', job_title: 'Architect', manager_id: c.f.id('P02'), account_types: ['employee'] });
    expect(res.status).toBe(200);
    expect(res.body.ref_code).toBe('P11');
    expect(res.body.email_sent).toBe(false);
    expect(res.body.invite_url).toMatch(/^\/accept-invite\/[A-Za-z0-9_-]{43}$/);
    expect(res.body.audit_event_id).toBeTruthy();
    expect(new Date(res.body.invite_expires_at).getTime() - Date.now()).toBeGreaterThan(71 * 3600 * 1000);
    const token = tokenOf(res.body.invite_url);
    const stored = (await c.f.owner.query('select token_hash from invitation_token where person_id = $1', [res.body.id])).rows;
    expect(stored).toEqual([{ token_hash: sha(token) }]);
    expect(await setsOf(c.f, res.body.id)).toEqual(['staff']);
    const listed = (await c.f.call('P10', 'GET', '/accounts')).body.data.find((a: any) => a.id === res.body.id);
    expect(listed).toMatchObject({ ref_code: 'P11', account_types: ['employee'], invitation_state: 'Sent', login_state: 'Enabled' });
  });

  it('a duplicate email is refused with 409', async () => {
    const res = await c.f.call('P01', 'POST', '/accounts', { name: 'Again', work_email: 'P04@meridian.demo', job_title: 'Architect', account_types: ['employee'] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('operations cannot create a principal or a finance account, and the refusal is audited', async () => {
    const before = await auditCount(c.f, 'grant_refused');
    for (const t of ['principal', 'finance']) {
      const res = await c.f.call('P10', 'POST', '/accounts', { name: `New ${t}`, work_email: `new-${t}@meridian.demo`, job_title: 'Partner', account_types: ['employee', t] });
      expect(res.status).toBe(403);
      expect(res.body.error.capability).toBe('permissions.grant.sensitive');
    }
    expect(await auditCount(c.f, 'grant_refused')).toBe(before + 2);
    expect((await c.f.owner.query(`select count(*)::int n from person where work_email like 'new-%'`)).rows[0].n).toBe(0);
  });

  it('a principal can create a principal account', async () => {
    const res = await c.f.call('P01', 'POST', '/accounts', { name: 'Ravi Menon', work_email: 'ravi@meridian.demo', job_title: 'Partner', account_types: ['principal'] });
    expect(res.status).toBe(200);
    expect(await setsOf(c.f, res.body.id)).toEqual(['principal']);
  });

  it('staff cannot list or create accounts', async () => {
    expect((await c.f.call('P04', 'GET', '/accounts')).status).toBe(403);
    expect((await c.f.call('P04', 'POST', '/accounts', { name: 'X', work_email: 'x@meridian.demo', job_title: 'X', account_types: ['employee'] })).status).toBe(403);
  });
});

describe('accepting an invitation', () => {
  const c = withApp();
  const create = async (email: string) =>
    (await c.f.call('P01', 'POST', '/accounts', { name: `Person ${email}`, work_email: email, job_title: 'Architect', account_types: ['employee'] })).body;

  it('shows the invite, sets the password, signs in, and the link works only once', async () => {
    const made = await create('accept@meridian.demo');
    const token = tokenOf(made.invite_url);
    const shown = await getInvite(c.f, token);
    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({ name: 'Person accept@meridian.demo', work_email: 'accept@meridian.demo', firm_name: expect.any(String) });

    const ok = await accept(c.f, token);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.cookie).toBeTruthy();
    const me = await asCookie(c.f, ok.cookie!, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.permission_sets).toEqual(['staff']);
    // An employee sees only Team: no account management.
    expect((await asCookie(c.f, ok.cookie!, 'GET', '/accounts')).status).toBe(403);

    expect((await accept(c.f, token, 'another-long-password')).status).toBe(410);
    expect((await getInvite(c.f, token)).status).toBe(410);
    expect((await c.f.rawLogin('accept@meridian.demo', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await c.f.rawLogin('accept@meridian.demo', 'another-long-password')).statusCode).toBe(401);
    const listed = (await c.f.call('P01', 'GET', '/accounts')).body.data.find((a: any) => a.id === made.id);
    expect(listed.invitation_state).toBe('Accepted');
  });

  it('an expired invitation gives 410 and is listed as Expired', async () => {
    const made = await create('expired@meridian.demo');
    await c.f.owner.query(`update invitation_token set expires_at = now() - interval '1 hour' where person_id = $1`, [made.id]);
    const token = tokenOf(made.invite_url);
    expect((await getInvite(c.f, token)).status).toBe(410);
    const res = await accept(c.f, token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('INVITE_EXPIRED');
    const listed = (await c.f.call('P01', 'GET', '/accounts')).body.data.find((a: any) => a.id === made.id);
    expect(listed.invitation_state).toBe('Expired');
  });

  it('a short password is refused with 400 and the token stays usable', async () => {
    const made = await create('short@meridian.demo');
    const token = tokenOf(made.invite_url);
    expect((await accept(c.f, token, 'short')).status).toBe(400);
    expect((await accept(c.f, token)).status).toBe(200);
  });

  it('an unknown token gives 404', async () => {
    expect((await getInvite(c.f, 'x'.repeat(43))).status).toBe(404);
  });

  it('a new invite invalidates the previous link', async () => {
    const made = await create('reinvite@meridian.demo');
    const again = await c.f.call('P01', 'POST', `/accounts/${made.id}/invite`);
    expect(again.status).toBe(200);
    expect(again.body.email_sent).toBe(false);
    expect((await getInvite(c.f, tokenOf(made.invite_url))).status).toBe(410);
    expect((await accept(c.f, tokenOf(again.body.invite_url))).status).toBe(200);
  });
});

describe('changing account types', () => {
  const c = withApp();

  it('adds and removes grants, with audit', async () => {
    const p04 = c.f.id('P04');
    const before = await auditCount(c.f, 'set_account_types', p04);
    const up = await c.f.call('P01', 'PUT', `/accounts/${p04}/types`, { account_types: ['employee', 'pm'] });
    expect(up.status).toBe(200);
    expect(up.body.account_types).toEqual(['pm', 'employee']);
    expect(await setsOf(c.f, p04)).toEqual(['pm', 'staff']);
    const down = await c.f.call('P01', 'PUT', `/accounts/${p04}/types`, { account_types: ['pm'] });
    expect(down.status).toBe(200);
    expect(await setsOf(c.f, p04)).toEqual(['pm']);
    expect(await auditCount(c.f, 'set_account_types', p04)).toBe(before + 2);
    const ev = (await c.f.owner.query('select previous, new from audit_event where id = $1', [down.body.audit_event_id])).rows[0];
    expect(ev.previous).toEqual({ account_types: ['pm', 'employee'] });
    expect(ev.new.removed).toEqual(['employee']);
  });

  it('operations cannot give finance or principal to anyone', async () => {
    const res = await c.f.call('P10', 'PUT', `/accounts/${c.f.id('P05')}/types`, { account_types: ['employee', 'finance'] });
    expect(res.status).toBe(403);
    expect(await setsOf(c.f, c.f.id('P05'))).toEqual(['staff']);
  });

  it('nobody may add a sensitive type to themselves', async () => {
    const before = await auditCount(c.f, 'grant_refused', c.f.id('P01'));
    const res = await c.f.call('P01', 'PUT', `/accounts/${c.f.id('P01')}/types`, { account_types: ['principal', 'finance'] });
    expect(res.status).toBe(403);
    expect(await auditCount(c.f, 'grant_refused', c.f.id('P01'))).toBe(before + 1);
    const ops = await c.f.call('P10', 'PUT', `/accounts/${c.f.id('P10')}/types`, { account_types: ['admin', 'finance', 'principal'] });
    expect(ops.status).toBe(403);
    expect(await setsOf(c.f, c.f.id('P10'))).toEqual(['finance', 'operations']);
  });

  it('the last active principal cannot lose principal or be deactivated', async () => {
    const p01 = c.f.id('P01');
    const res = await c.f.call('P01', 'PUT', `/accounts/${p01}/types`, { account_types: ['admin'] });
    expect(res.status).toBe(422);
    expect(await setsOf(c.f, p01)).toEqual(['principal']);
    const off = await c.f.call('P10', 'POST', `/accounts/${p01}/deactivate`, { reason: 'Test' });
    expect(off.status).toBe(422);
  });
});

describe('deactivating and reactivating', () => {
  const c = withApp();

  it('deactivate blocks the next request and login; reactivate restores login', async () => {
    const p05 = c.f.id('P05');
    expect((await c.f.call('P05', 'GET', '/me')).status).toBe(200);
    const off = await c.f.call('P01', 'POST', `/accounts/${p05}/deactivate`, { reason: 'Left the firm' });
    expect(off.status).toBe(200);
    expect((await c.f.call('P05', 'GET', '/me')).status).toBe(401);
    expect((await c.f.rawLogin('p05@meridian.demo', 'meridian-demo-2026')).statusCode).toBe(401);
    const row = (await c.f.owner.query('select login_state, employment_state from person where id = $1', [p05])).rows[0];
    expect(row).toEqual({ login_state: 'Revoked', employment_state: 'Ended' });
    expect(await auditCount(c.f, 'deactivate', p05)).toBe(1);

    const on = await c.f.call('P01', 'POST', `/accounts/${p05}/reactivate`, {});
    expect(on.status).toBe(200);
    expect((await c.f.rawLogin('p05@meridian.demo', 'meridian-demo-2026')).statusCode).toBe(200);
    expect(await auditCount(c.f, 'reactivate', p05)).toBe(1);
  });

  it('deactivate needs a reason', async () => {
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P06')}/deactivate`, {})).status).toBe(400);
  });
});

describe('firm isolation for accounts', () => {
  const c = withApp();

  it('accounts of another firm are never listed, and their email still counts as taken', async () => {
    const other = (await c.f.owner.query(`insert into firm (legal_name, trading_name, timezone) values ('Other','Other','Asia/Kolkata') returning id`)).rows[0].id;
    await c.f.owner.query(`insert into person (firm_id, ref_code, name, work_email, job_title) values ($1, 'P01', 'Elsewhere Person', 'someone@elsewhere.test', 'Principal')`, [other]);
    const res = await c.f.call('P01', 'GET', '/accounts');
    expect(res.status).toBe(200);
    expect(res.body.data.some((a: any) => a.work_email === 'someone@elsewhere.test' || a.name === 'Elsewhere Person')).toBe(false);
    const own = (await c.f.owner.query('select count(*)::int n from person where firm_id = $1', [c.f.firmId])).rows[0].n;
    expect(res.body.total).toBe(own);
    const dup = await c.f.call('P01', 'POST', '/accounts', { name: 'Clash', work_email: 'SOMEONE@elsewhere.test', job_title: 'Architect', account_types: ['employee'] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(JSON.stringify(dup.body)).not.toContain('Elsewhere Person');
  });

  it('an account id from another firm is not found', async () => {
    const otherPerson = (await c.f.owner.query(`select id from person where work_email = 'someone@elsewhere.test'`)).rows[0].id;
    expect((await c.f.call('P01', 'PUT', `/accounts/${otherPerson}/types`, { account_types: ['employee'] })).status).toBe(404);
    expect((await c.f.call('P01', 'POST', `/accounts/${otherPerson}/deactivate`, { reason: 'x' })).status).toBe(404);
  });
});
