import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, PASSWORD, type Fresh } from './helpers';

function withApp() {
  const ctx = {} as { f: Fresh };
  beforeAll(async () => { ctx.f = await freshApp(); });
  afterAll(async () => { await ctx.f?.close(); });
  return ctx;
}

const NEW_PASSWORD = 'a-brand-new-password';
const tokenOf = (url: string) => url.split('/').pop()!;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const emailOf = (ref: string) => `${ref.toLowerCase()}@meridian.demo`;

async function preview(f: Fresh, token: string) {
  const res = await f.app.inject({ method: 'GET', url: `/api/v1/auth/reset/${token}` });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function reset(f: Fresh, token: string, password: unknown = NEW_PASSWORD) {
  const res = await f.app.inject({ method: 'POST', url: `/api/v1/auth/reset/${token}`, payload: { password } });
  return { status: res.statusCode, body: JSON.parse(res.body), cookie: res.cookies.find((c) => c.name === 'ams_session')?.value };
}
async function asCookie(f: Fresh, cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await f.app.inject({ method, url: `/api/v1${url}`, payload: payload as any, cookies: { ams_session: cookie } });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function signIn(f: Fresh, ref: string, password = PASSWORD) {
  const res = await f.rawLogin(emailOf(ref), password);
  return { status: res.statusCode, cookie: res.cookies.find((c) => c.name === 'ams_session')?.value };
}
const auditCount = async (f: Fresh, action: string, recordId?: string) =>
  (await f.owner.query('select count(*)::int n from audit_event where action = $1 and ($2::text is null or record_id = $2)', [action, recordId ?? null])).rows[0].n as number;

describe('issuing a reset link', () => {
  const c = withApp();

  it('an admin issues a 24-hour link for an employee; only the hash is stored and the issue is audited', async () => {
    const before = await auditCount(c.f, 'issue_reset_link', c.f.id('P04'));
    const res = await c.f.call('P10', 'POST', `/accounts/${c.f.id('P04')}/reset-link`);
    expect(res.status).toBe(200);
    expect(res.body.email_sent).toBe(false);
    expect(res.body.reset_url).toMatch(/^\/reset-password\/[A-Za-z0-9_-]{43}$/);
    const ms = new Date(res.body.expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(ms).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);
    const stored = (await c.f.owner.query('select token_hash, created_by from password_reset_token where person_id = $1', [c.f.id('P04')])).rows;
    expect(stored).toEqual([{ token_hash: sha(tokenOf(res.body.reset_url)), created_by: c.f.id('P10') }]);
    expect(await auditCount(c.f, 'issue_reset_link', c.f.id('P04'))).toBe(before + 1);

    const shown = await preview(c.f, tokenOf(res.body.reset_url));
    expect(shown.status).toBe(200);
    expect(Object.keys(shown.body).sort()).toEqual(['expires_at', 'firm_name', 'name']);
    expect(shown.body).toMatchObject({ name: 'Rohan Shetty', firm_name: expect.any(String) });
  });

  it('a new link revokes the earlier unused one', async () => {
    const first = await c.f.call('P01', 'POST', `/accounts/${c.f.id('P05')}/reset-link`);
    const second = await c.f.call('P01', 'POST', `/accounts/${c.f.id('P05')}/reset-link`);
    expect(second.status).toBe(200);
    expect(second.body.reset_url).not.toBe(first.body.reset_url);
    expect((await preview(c.f, tokenOf(first.body.reset_url))).status).toBe(410);
    expect((await reset(c.f, tokenOf(first.body.reset_url))).status).toBe(410);
    expect((await preview(c.f, tokenOf(second.body.reset_url))).status).toBe(200);
  });

  it('only a principal may reset a principal or a finance account; the refusal is audited', async () => {
    const before = await auditCount(c.f, 'grant_refused');
    const onPrincipal = await c.f.call('P10', 'POST', `/accounts/${c.f.id('P01')}/reset-link`);
    expect(onPrincipal.status).toBe(403);
    expect(onPrincipal.body.error.capability).toBe('permissions.grant.sensitive');
    // P10 holds finance, so even P10 on itself is refused.
    expect((await c.f.call('P10', 'POST', `/accounts/${c.f.id('P10')}/reset-link`)).status).toBe(403);
    expect(await auditCount(c.f, 'grant_refused')).toBe(before + 2);
    expect((await c.f.owner.query('select count(*)::int n from password_reset_token where person_id in ($1, $2)', [c.f.id('P01'), c.f.id('P10')])).rows[0].n).toBe(0);
    // A principal may.
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P10')}/reset-link`)).status).toBe(200);
  });

  it('an employee or a project manager cannot issue a link', async () => {
    expect((await c.f.call('P04', 'POST', `/accounts/${c.f.id('P05')}/reset-link`)).status).toBe(403);
    expect((await c.f.call('P02', 'POST', `/accounts/${c.f.id('P05')}/reset-link`)).status).toBe(403);
  });

  it('validates the account: bad id 404, unknown 404, not accepted 422, deactivated 422', async () => {
    expect((await c.f.call('P01', 'POST', '/accounts/not-a-uuid/reset-link')).status).toBe(404);
    expect((await c.f.call('P01', 'POST', '/accounts/00000000-0000-4000-8000-000000000000/reset-link')).status).toBe(404);
    const made = (await c.f.call('P01', 'POST', '/accounts', { name: 'Pending Person', work_email: 'pending@meridian.demo', job_title: 'Architect', account_types: ['employee'] })).body;
    const pending = await c.f.call('P01', 'POST', `/accounts/${made.id}/reset-link`);
    expect(pending.status).toBe(422);
    expect(pending.body.error.message).toMatch(/invitation/i);
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P09')}/deactivate`, { reason: 'Left' })).status).toBe(200);
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P09')}/reset-link`)).status).toBe(422);
  });

  it('the public preview needs no session, and an unknown token gives 404', async () => {
    expect((await preview(c.f, 'x'.repeat(43))).status).toBe(404);
    expect((await reset(c.f, 'x'.repeat(43))).status).toBe(404);
  });
});

describe('using a reset link', () => {
  const c = withApp();
  const issue = async (ref: string) => tokenOf((await c.f.call('P01', 'POST', `/accounts/${c.f.id(ref)}/reset-link`)).body.reset_url);

  it('sets the password, does not sign in, revokes every session, and works only once', async () => {
    const existing = await signIn(c.f, 'P06');
    expect(existing.status).toBe(200);
    expect((await asCookie(c.f, existing.cookie!, 'GET', '/me')).status).toBe(200);
    const token = await issue('P06');

    const done = await reset(c.f, token);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: true });
    expect(done.cookie).toBeUndefined();
    expect((await asCookie(c.f, existing.cookie!, 'GET', '/me')).status).toBe(401);
    expect((await c.f.owner.query('select count(*)::int n from session where person_id = $1 and revoked_at is null', [c.f.id('P06')])).rows[0].n).toBe(0);

    expect((await signIn(c.f, 'P06')).status).toBe(401);
    expect((await signIn(c.f, 'P06', NEW_PASSWORD)).status).toBe(200);
    expect(await auditCount(c.f, 'reset_password', c.f.id('P06'))).toBe(1);

    expect((await reset(c.f, token, 'yet-another-long-password')).status).toBe(410);
    expect((await preview(c.f, token)).status).toBe(410);
    expect((await signIn(c.f, 'P06', 'yet-another-long-password')).status).toBe(401);
  });

  it('an expired link gives 410 and changes nothing', async () => {
    const token = await issue('P07');
    await c.f.owner.query(`update password_reset_token set expires_at = now() - interval '1 minute' where token_hash = $1`, [sha(token)]);
    expect((await preview(c.f, token)).status).toBe(410);
    const res = await reset(c.f, token);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('RESET_EXPIRED');
    expect((await signIn(c.f, 'P07')).status).toBe(200);
  });

  it('a short or missing password is refused with 400 and the link stays usable', async () => {
    const token = await issue('P08');
    expect((await reset(c.f, token, 'short')).status).toBe(400);
    expect((await c.f.app.inject({ method: 'POST', url: `/api/v1/auth/reset/${token}`, payload: {} })).statusCode).toBe(400);
    expect((await reset(c.f, token, 12345678901234)).status).toBe(400);
    expect((await reset(c.f, token)).status).toBe(200);
  });

  it('a link stops working when the account is deactivated', async () => {
    const token = await issue('P05');
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P05')}/deactivate`, { reason: 'Left' })).status).toBe(200);
    expect((await reset(c.f, token)).status).not.toBe(200);
    expect((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P05')}/reactivate`, {})).status).toBe(200);
    expect((await reset(c.f, token)).status).toBe(410);
  });

  it('a suspended firm cannot use a reset link', async () => {
    const token = await issue('P04');
    await c.f.owner.query(`update firm set status = 'Suspended', suspended_reason = 'Test' where id = $1`, [c.f.firmId]);
    try {
      expect((await preview(c.f, token)).status).toBe(404);
      expect((await reset(c.f, token)).status).toBe(404);
      const app = await c.f.appClient();
      try {
        expect((await app.query('select * from auth_reset_password($1, $2)', [sha(token), 'x'])).rowCount).toBe(0);
      } finally {
        await app.end();
      }
    } finally {
      await c.f.owner.query(`update firm set status = 'Active', suspended_reason = null where id = $1`, [c.f.firmId]);
    }
    expect((await signIn(c.f, 'P04')).status).toBe(200);
    expect((await reset(c.f, token)).status).toBe(200);
  });

  it('a link issued by a non-principal stops working once the account becomes principal or finance', async () => {
    const token = tokenOf((await c.f.call('P10', 'POST', `/accounts/${c.f.id('P02')}/reset-link`)).body.reset_url);
    expect((await preview(c.f, token)).status).toBe(200);
    const types = (await c.f.call('P01', 'GET', '/accounts')).body.data.find((a: any) => a.id === c.f.id('P02')).account_types as string[];
    expect((await c.f.call('P01', 'PUT', `/accounts/${c.f.id('P02')}/types`, { account_types: [...types, 'finance'] })).status).toBe(200);
    expect((await preview(c.f, token)).status).toBe(410);
    expect((await reset(c.f, token)).status).toBe(410);
    expect((await signIn(c.f, 'P02')).status).toBe(200);
  });

  it('the application role cannot read reset tokens of another firm or without a firm', async () => {
    const app = await c.f.appClient();
    try {
      expect((await app.query('select count(*)::int n from password_reset_token')).rows[0].n).toBe(0);
    } finally {
      await app.end();
    }
  });
});

describe('changing your own password', () => {
  const c = withApp();

  it('verifies the current password, revokes the other sessions and keeps this one', async () => {
    const other = await signIn(c.f, 'P04');
    const mine = await signIn(c.f, 'P04');
    const res = await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: PASSWORD, new_password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, sessions_revoked: expect.any(Number) });
    expect(res.body.sessions_revoked).toBeGreaterThanOrEqual(1);
    expect((await asCookie(c.f, mine.cookie!, 'GET', '/me')).status).toBe(200);
    expect((await asCookie(c.f, other.cookie!, 'GET', '/me')).status).toBe(401);
    expect((await signIn(c.f, 'P04')).status).toBe(401);
    expect((await signIn(c.f, 'P04', NEW_PASSWORD)).status).toBe(200);
    expect(await auditCount(c.f, 'change_password', c.f.id('P04'))).toBe(1);
  });

  it('an unused reset link stops working once the person changes the password themselves', async () => {
    const token = tokenOf((await c.f.call('P01', 'POST', `/accounts/${c.f.id('P07')}/reset-link`)).body.reset_url);
    const mine = await signIn(c.f, 'P07');
    expect((await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: PASSWORD, new_password: NEW_PASSWORD })).status).toBe(200);
    expect((await preview(c.f, token)).status).toBe(410);
    expect((await reset(c.f, token, 'an-attacker-chosen-password')).status).toBe(410);
    expect((await signIn(c.f, 'P07', NEW_PASSWORD)).status).toBe(200);
  });

  it('a wrong current password is refused and nothing changes', async () => {
    const mine = await signIn(c.f, 'P05');
    const res = await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: 'not-my-password', new_password: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
    expect((await signIn(c.f, 'P05')).status).toBe(200);
  });

  it('validates the new password', async () => {
    const mine = await signIn(c.f, 'P06');
    expect((await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: PASSWORD, new_password: 'short' })).status).toBe(400);
    expect((await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: PASSWORD })).status).toBe(400);
    expect((await asCookie(c.f, mine.cookie!, 'POST', '/me/password', { current_password: PASSWORD, new_password: PASSWORD })).status).toBe(400);
    expect((await signIn(c.f, 'P06')).status).toBe(200);
  });

  it('needs a session', async () => {
    const res = await c.f.app.inject({ method: 'POST', url: '/api/v1/me/password', payload: { current_password: PASSWORD, new_password: NEW_PASSWORD } });
    expect(res.statusCode).toBe(401);
  });
});
