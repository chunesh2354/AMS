import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerUrl } from '../src/dev/db';
import { PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD, seedPlatformAdmin } from '../src/dev/platform-admin';
import { hashToken } from '../src/auth/sessions';
import { freshApp, type Fresh } from './helpers';

const TEST_PORT = 54331;
const FIRM_KEYS = ['active_people', 'created_at', 'currency', 'id', 'last_login_at', 'legal_name', 'people', 'status', 'timezone', 'trading_name'];

type Out = { status: number; body: any; cookies: { name: string; value: string }[] };

function withPlatform() {
  const ctx = {} as { f: Fresh; admin: string };
  beforeAll(async () => {
    ctx.f = await freshApp();
    await seedPlatformAdmin(ownerUrl(TEST_PORT, (ctx.f.owner as any).database));
    ctx.admin = await platformLogin(ctx.f, PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD).then((r) => {
      const c = r.cookies.find((x) => x.name === 'ams_platform');
      if (r.status !== 200 || !c) throw new Error(`platform login failed: ${r.status} ${JSON.stringify(r.body)}`);
      return c.value;
    });
  });
  afterAll(async () => { await ctx.f?.close(); });
  return ctx;
}

async function inject(f: Fresh, method: 'GET' | 'POST' | 'PUT', url: string, opts: { payload?: unknown; cookies?: Record<string, string> } = {}): Promise<Out> {
  const res = await f.app.inject({ method, url, payload: opts.payload as any, cookies: opts.cookies });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch { /* not JSON */ }
  return { status: res.statusCode, body, cookies: res.cookies.map((c) => ({ name: c.name, value: c.value })) };
}
const platformLogin = (f: Fresh, email: string, password: string) => inject(f, 'POST', '/api/v1/platform/auth/login', { payload: { email, password } });
const asAdmin = (f: Fresh, token: string, method: 'GET' | 'POST', path: string, payload?: unknown) =>
  inject(f, method, `/api/v1/platform${path}`, { payload, cookies: { ams_platform: token } });
const asFirmUser = (f: Fresh, token: string, method: 'GET' | 'POST', path: string, payload?: unknown) =>
  inject(f, method, `/api/v1${path}`, { payload, cookies: { ams_session: token } });

/** Every key anywhere in a JSON value. */
function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}

let seq = 0;
async function createFirm(f: Fresh, admin: string, name = `Test Studio ${++seq}`) {
  const owner_email = `owner${seq}.${Date.now()}@test-studio.example`;
  const r = await asAdmin(f, admin, 'POST', '/firms', { trading_name: name, legal_name: `${name} LLP`, timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'Tara Owner', owner_email });
  expect(r.status).toBe(200);
  return { ...r.body as { firm_id: string; invite_url: string; invite_expires_at: string; email_sent: boolean }, owner_email, name };
}
async function acceptInvite(f: Fresh, inviteUrl: string, password = 'a-long-owner-password') {
  const token = inviteUrl.replace('/accept-invite/', '');
  const r = await inject(f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password } });
  return { ...r, token, session: r.cookies.find((c) => c.name === 'ams_session')?.value };
}

describe('platform login', () => {
  const c = withPlatform();
  it('the demo admin signs in with an httpOnly, strict cookie and sees itself', async () => {
    const res = await c.f.app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: PLATFORM_DEMO_EMAIL, password: PLATFORM_DEMO_PASSWORD } });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((x) => x.name === 'ams_platform')!;
    expect(cookie.httpOnly).toBe(true);
    expect(String(cookie.sameSite).toLowerCase()).toBe('strict');
    expect(res.cookies.find((x) => x.name === 'ams_session')).toBeUndefined();
    const me = await asAdmin(c.f, c.admin, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(PLATFORM_DEMO_EMAIL);
    expect(me.body.id).toBeTruthy();
  });
  it('a wrong password and an unknown email give an identical 401', async () => {
    const bad = await c.f.app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: PLATFORM_DEMO_EMAIL, password: 'wrong-password-123' } });
    const unknown = await c.f.app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: { email: 'nobody@platform.demo', password: 'wrong-password-123' } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.body).toBe(unknown.body);
    expect(bad.cookies.length).toBe(0);
  });
  it('a firm principal cannot sign in to the platform with firm credentials', async () => {
    const r = await platformLogin(c.f, 'p01@meridian.demo', 'meridian-demo-2026');
    expect(r.status).toBe(401);
  });
  it('logout ends the platform session', async () => {
    const r = await platformLogin(c.f, PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD);
    const token = r.cookies.find((x) => x.name === 'ams_platform')!.value;
    expect((await asAdmin(c.f, token, 'GET', '/me')).status).toBe(200);
    expect((await asAdmin(c.f, token, 'POST', '/auth/logout')).status).toBe(200);
    expect((await asAdmin(c.f, token, 'GET', '/me')).status).toBe(401);
  });
});

describe('the two sessions never cross', () => {
  const c = withPlatform();
  it('a firm session cookie cannot call platform endpoints', async () => {
    const firmToken = await c.f.login('P01');
    for (const path of ['/me', '/firms', '/audit']) {
      expect((await inject(c.f, 'GET', `/api/v1/platform${path}`, { cookies: { ams_session: firmToken } })).status).toBe(401);
      // Not even when the firm token is presented under the platform cookie name.
      expect((await asAdmin(c.f, firmToken, 'GET', path)).status).toBe(401);
    }
    const create = await inject(c.f, 'POST', '/api/v1/platform/firms', {
      cookies: { ams_session: firmToken },
      payload: { trading_name: 'Sneaky', legal_name: 'Sneaky', timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'X', owner_email: 'x@sneaky.example' },
    });
    expect(create.status).toBe(401);
    const bearer = await c.f.app.inject({ method: 'GET', url: '/api/v1/platform/firms', headers: { authorization: `Bearer ${firmToken}` } });
    expect(bearer.statusCode).toBe(401);
  });
  it('a platform cookie cannot call firm endpoints', async () => {
    for (const path of ['/me', '/people', '/projects']) {
      expect((await inject(c.f, 'GET', `/api/v1${path}`, { cookies: { ams_platform: c.admin } })).status).toBe(401);
      expect((await asFirmUser(c.f, c.admin, 'GET', path)).status).toBe(401);
    }
  });
  it('no cookie at all is 401 on every platform endpoint', async () => {
    for (const path of ['/me', '/firms', '/audit']) expect((await inject(c.f, 'GET', `/api/v1/platform${path}`)).status).toBe(401);
  });
});

describe('firm list', () => {
  const c = withPlatform();
  it('shows counts only, never business data or the names of a firm\'s people', async () => {
    const r = await asAdmin(c.f, c.admin, 'GET', '/firms');
    expect(r.status).toBe(200);
    const demo = r.body.data.find((x: any) => x.id === c.f.firmId);
    expect(demo).toBeTruthy();
    expect(Object.keys(demo).sort()).toEqual(FIRM_KEYS);
    expect(demo.status).toBe('Active');
    expect(demo.people).toBe(10);
    expect(typeof demo.active_people).toBe('number');
    const keys = allKeys(r.body);
    for (const k of keys) {
      expect(k).not.toMatch(/project|amount|rate|invoice|hours|time_entry|budget|fee|cost|margin|client|email/i);
      if (/name/i.test(k)) expect(['trading_name', 'legal_name']).toContain(k);
    }
    const json = JSON.stringify(r.body);
    const people = (await c.f.owner.query('select name, work_email from person')).rows;
    for (const p of people) {
      expect(json).not.toContain(p.name);
      expect(json).not.toContain(p.work_email);
    }
    const projects = (await c.f.owner.query('select code, name from project')).rows;
    for (const p of projects) expect(json).not.toContain(p.name);
  });
});

describe('creating a company', () => {
  const c = withPlatform();
  it('validates the form and refuses an email that is already in use anywhere', async () => {
    const empty = await asAdmin(c.f, c.admin, 'POST', '/firms', {});
    expect(empty.status).toBe(400);
    const badTz = await asAdmin(c.f, c.admin, 'POST', '/firms', { trading_name: 'A', legal_name: 'A', timezone: 'Mars/Olympus', currency: 'INR', owner_name: 'A', owner_email: 'a@a.example' });
    expect(badTz.status).toBe(400);
    const dup = await asAdmin(c.f, c.admin, 'POST', '/firms', { trading_name: 'Dup', legal_name: 'Dup', timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'Dup', owner_email: 'P01@meridian.demo' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('returns an invite; the owner accepts it and is the principal of an empty firm that cannot see the demo firm', async () => {
    const firm = await createFirm(c.f, c.admin, 'Kite Studio');
    expect(firm.firm_id).toBeTruthy();
    expect(firm.email_sent).toBe(false);
    expect(firm.invite_url).toMatch(/^\/accept-invite\/[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(firm.invite_expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThanOrEqual(72.1);

    // Only the hash of the token is stored.
    const token = firm.invite_url.replace('/accept-invite/', '');
    const stored = (await c.f.owner.query('select token_hash from invitation_token')).rows.map((r) => r.token_hash);
    expect(stored).not.toContain(token);

    const preview = await inject(c.f, 'GET', `/api/v1/auth/invite/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ name: 'Tara Owner', work_email: firm.owner_email, firm_name: 'Kite Studio' });

    const short = await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password: 'short' } });
    expect(short.status).toBe(400);

    const accepted = await acceptInvite(c.f, firm.invite_url);
    expect(accepted.status).toBe(200);
    expect(accepted.session).toBeTruthy();

    // Single use.
    const again = await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password: 'a-long-owner-password' } });
    expect([404, 410]).toContain(again.status);

    // The owner can also sign in with the password just set.
    const login = await c.f.rawLogin(firm.owner_email, 'a-long-owner-password');
    expect(login.statusCode).toBe(200);

    const me = await asFirmUser(c.f, accepted.session!, 'GET', '/me');
    expect(me.status).toBe(200);
    expect(me.body.firm.id).toBe(firm.firm_id);
    expect(me.body.firm.trading_name).toBe('Kite Studio');
    expect(me.body.permission_sets).toContain('principal');

    const projects = await asFirmUser(c.f, accepted.session!, 'GET', '/projects');
    expect(projects.status).toBe(200);
    expect(projects.body.data).toEqual([]);
    const people = await asFirmUser(c.f, accepted.session!, 'GET', '/people');
    expect(people.status).toBe(200);
    expect(people.body.data.map((p: any) => p.name)).toEqual(['Tara Owner']);
    const json = JSON.stringify([projects.body, people.body]);
    expect(json).not.toContain('Asha Rao');
    expect(json).not.toContain('Meridian');

    // The demo firm's records are not reachable by id either.
    const demoProject = (await c.f.owner.query('select id from project limit 1')).rows[0].id;
    const direct = await asFirmUser(c.f, accepted.session!, 'GET', `/projects/${demoProject}`);
    expect([403, 404]).toContain(direct.status);

    // The new firm has its five permission sets.
    const sets = (await c.f.owner.query('select key from permission_set where firm_id = $1 order by key', [firm.firm_id])).rows.map((r) => r.key);
    expect(sets).toEqual(['finance', 'operations', 'pm', 'principal', 'staff']);
  });
});

describe('suspending a firm', () => {
  const c = withPlatform();
  it('blocks logins and existing sessions on the next request; reactivating restores sign-in', async () => {
    const firm = await createFirm(c.f, c.admin, 'Lantern Works');
    const accepted = await acceptInvite(c.f, firm.invite_url);
    expect(accepted.status).toBe(200);
    const session = accepted.session!;
    expect((await asFirmUser(c.f, session, 'GET', '/me')).status).toBe(200);

    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/suspend`, {})).status).toBe(400);
    const suspend = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/suspend`, { reason: 'Non-payment' });
    expect(suspend.status).toBe(200);

    expect((await asFirmUser(c.f, session, 'GET', '/me')).status).toBe(401);
    expect((await c.f.rawLogin(firm.owner_email, 'a-long-owner-password')).statusCode).toBe(401);
    const listed = (await asAdmin(c.f, c.admin, 'GET', '/firms')).body.data.find((x: any) => x.id === firm.firm_id);
    expect(listed.status).toBe('Suspended');

    // The demo firm is untouched.
    expect((await c.f.call('P01', 'GET', '/me')).status).toBe(200);

    const reactivate = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/reactivate`, { reason: 'Paid in full' });
    expect(reactivate.status).toBe(200);
    expect((await c.f.rawLogin(firm.owner_email, 'a-long-owner-password')).statusCode).toBe(200);
    expect((await asAdmin(c.f, c.admin, 'GET', '/firms')).body.data.find((x: any) => x.id === firm.firm_id).status).toBe('Active');
  });
  it('an unknown firm is 404', async () => {
    const r = await asAdmin(c.f, c.admin, 'POST', '/firms/00000000-0000-4000-8000-000000000000/suspend', { reason: 'x' });
    expect(r.status).toBe(404);
  });
});

const DETAIL_KEYS = ['active_people', 'created_at', 'currency', 'id', 'last_login_at', 'legal_name', 'owner_email', 'owner_invitation_state',
  'owner_name', 'people', 'status', 'suspended_reason', 'timezone', 'trading_name'];

describe('company detail and a new owner invite (migration 004)', () => {
  const c = withPlatform();
  const tokens = async (firmId: string) => (await c.f.owner.query('select count(*)::int as n from invitation_token where firm_id = $1', [firmId])).rows[0].n;

  it('shows counts and the owner only, never projects, money or other people', async () => {
    const firm = await createFirm(c.f, c.admin, 'Detail Studio');
    const r = await asAdmin(c.f, c.admin, 'GET', `/firms/${firm.firm_id}`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(DETAIL_KEYS);
    expect(r.body).toMatchObject({
      id: firm.firm_id, trading_name: 'Detail Studio', legal_name: 'Detail Studio LLP', status: 'Active', suspended_reason: null,
      timezone: 'Asia/Kolkata', currency: 'INR', people: 1, active_people: 1, last_login_at: null,
      owner_name: 'Tara Owner', owner_email: firm.owner_email, owner_invitation_state: 'Sent',
    });

    const demo = await asAdmin(c.f, c.admin, 'GET', `/firms/${c.f.firmId}`);
    expect(demo.status).toBe(200);
    expect(Object.keys(demo.body).sort()).toEqual(DETAIL_KEYS);
    expect(demo.body.people).toBe(10);
    expect(demo.body.owner_invitation_state).toBe('Accepted');
    for (const k of allKeys(demo.body)) {
      expect(k).not.toMatch(/project|amount|rate|invoice|hours|time_entry|budget|fee|cost|margin|client/i);
    }
    // Only the owner's name and email: nobody else at the firm.
    const owner = (await c.f.owner.query(`select name, work_email from person where firm_id = $1 and ref_code = 'P01'`, [c.f.firmId])).rows[0];
    expect(demo.body.owner_name).toBe(owner.name);
    expect(demo.body.owner_email).toBe(owner.work_email);
    const json = JSON.stringify(demo.body);
    const others = (await c.f.owner.query(`select name, work_email from person where firm_id = $1 and ref_code <> 'P01'`, [c.f.firmId])).rows;
    expect(others.length).toBeGreaterThan(0);
    for (const p of others) {
      expect(json).not.toContain(p.name);
      expect(json).not.toContain(p.work_email);
    }
    const projects = (await c.f.owner.query('select name from project')).rows;
    for (const p of projects) expect(json).not.toContain(p.name);
  });

  it('an unknown or malformed id is 404', async () => {
    expect((await asAdmin(c.f, c.admin, 'GET', '/firms/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await asAdmin(c.f, c.admin, 'GET', '/firms/not-a-uuid')).status).toBe(404);
    expect((await asAdmin(c.f, c.admin, 'POST', '/firms/00000000-0000-4000-8000-000000000000/owner-invite', {})).status).toBe(404);
  });

  it('a new owner invite replaces the old link; the new one accepts; after that no new invite is issued', async () => {
    const firm = await createFirm(c.f, c.admin, 'Reissue Studio');
    const r = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/owner-invite`, {});
    expect(r.status).toBe(200);
    expect(r.body.invite_url).toMatch(/^\/accept-invite\/[A-Za-z0-9_-]{43}$/);
    expect(r.body.invite_url).not.toBe(firm.invite_url);
    const hours = (Date.parse(r.body.invite_expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThanOrEqual(72.1);
    const fresh = r.body.invite_url.replace('/accept-invite/', '');
    const stored = (await c.f.owner.query('select token_hash from invitation_token')).rows.map((x) => x.token_hash);
    expect(stored).not.toContain(fresh);
    expect(stored).toContain(hashToken(fresh));

    // The old link stops working.
    const oldToken = firm.invite_url.replace('/accept-invite/', '');
    expect([404, 410]).toContain((await inject(c.f, 'GET', `/api/v1/auth/invite/${oldToken}`)).status);
    expect([404, 410]).toContain((await acceptInvite(c.f, firm.invite_url)).status);

    // The new link accepts.
    expect((await inject(c.f, 'GET', `/api/v1/auth/invite/${fresh}`)).status).toBe(200);
    const accepted = await acceptInvite(c.f, r.body.invite_url);
    expect(accepted.status).toBe(200);
    expect((await asAdmin(c.f, c.admin, 'GET', `/firms/${firm.firm_id}`)).body.owner_invitation_state).toBe('Accepted');

    // After acceptance a new invite is refused and nothing is written.
    const before = await tokens(firm.firm_id);
    const again = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/owner-invite`, {});
    expect(again.status).toBe(422);
    expect(again.body.error.message).toMatch(/already accepted/i);
    expect(await tokens(firm.firm_id)).toBe(before);

    const audit = (await asAdmin(c.f, c.admin, 'GET', '/audit')).body.data.filter((e: any) => e.firm_id === firm.firm_id);
    expect(audit.filter((e: any) => e.action === 'reissue_owner_invite')).toHaveLength(1);
  });

  it('refuses a new owner invite for a suspended company', async () => {
    const firm = await createFirm(c.f, c.admin, 'Paused Studio');
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/suspend`, { reason: 'Paused' })).status).toBe(200);
    const before = await tokens(firm.firm_id);
    const r = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/owner-invite`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/suspended/i);
    expect(await tokens(firm.firm_id)).toBe(before);
  });

  it('refuses a new owner invite when the owner login is not enabled, since that link could never be accepted', async () => {
    const firm = await createFirm(c.f, c.admin, 'Locked Studio');
    await c.f.owner.query(`update person set login_state = 'Suspended' where firm_id = $1 and ref_code = 'P01'`, [firm.firm_id]);
    const before = await tokens(firm.firm_id);
    const r = await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/owner-invite`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/not enabled/i);
    expect(await tokens(firm.firm_id)).toBe(before);
    // The original link was not revoked by the refused call.
    const live = (await c.f.owner.query('select count(*)::int as n from invitation_token where firm_id = $1 and revoked_at is null', [firm.firm_id])).rows[0].n;
    expect(live).toBe(1);
  });

  it('is 401 with no session, a firm session, or a firm token under the platform cookie', async () => {
    const firm = await createFirm(c.f, c.admin, 'Guarded Studio');
    const firmToken = await c.f.login('P01');
    const before = await tokens(firm.firm_id);
    for (const [method, path] of [['GET', `/firms/${firm.firm_id}`], ['POST', `/firms/${firm.firm_id}/owner-invite`]] as const) {
      expect((await inject(c.f, method, `/api/v1/platform${path}`)).status).toBe(401);
      expect((await inject(c.f, method, `/api/v1/platform${path}`, { cookies: { ams_session: firmToken } })).status).toBe(401);
      expect((await asAdmin(c.f, firmToken, method, path)).status).toBe(401);
    }
    expect(await tokens(firm.firm_id)).toBe(before);
  });

  it('at SQL level, a firm user session hash and a made-up hash raise 28000 for both functions', async () => {
    const firm = await createFirm(c.f, c.admin, 'Sql Guard Studio');
    const firmToken = await c.f.login('P01');
    const before = await tokens(firm.firm_id);
    const app = await c.f.appClient();
    try {
      for (const h of [hashToken(firmToken), hashToken('never-issued')]) {
        await expect(app.query('select * from platform_firm_detail($1, $2)', [h, firm.firm_id])).rejects.toMatchObject({ code: '28000' });
        await expect(app.query('select platform_reissue_owner_invite($1, $2, $3, $4)', [h, firm.firm_id, hashToken(`x-${h}`), new Date(Date.now() + 3600_000)]))
          .rejects.toMatchObject({ code: '28000' });
      }
    } finally {
      await app.end();
    }
    expect(await tokens(firm.firm_id)).toBe(before);
  });
});

describe('platform audit', () => {
  const c = withPlatform();
  it('records every action with the admin, the firm and the reason', async () => {
    const firm = await createFirm(c.f, c.admin, 'Audit Studio');
    await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/suspend`, { reason: 'Audit check suspend' });
    await asAdmin(c.f, c.admin, 'POST', `/firms/${firm.firm_id}/reactivate`, { reason: 'Audit check reactivate' });
    const r = await asAdmin(c.f, c.admin, 'GET', '/audit');
    expect(r.status).toBe(200);
    const mine = r.body.data.filter((e: any) => e.firm_id === firm.firm_id);
    const actions = mine.map((e: any) => e.action).join(' ');
    expect(actions).toMatch(/create/i);
    expect(actions).toMatch(/suspend/i);
    expect(actions).toMatch(/reactivat/i);
    for (const e of mine) {
      expect(e.admin_name).toBeTruthy();
      expect(e.firm_name).toBe('Audit Studio');
      expect(e.at).toBeTruthy();
    }
    expect(mine.map((e: any) => e.reason)).toEqual(expect.arrayContaining(['Audit check suspend', 'Audit check reactivate']));
  });
});

describe('platform tables are closed to the app role', () => {
  const c = withPlatform();
  it('ams_app cannot read or write the platform tables directly', async () => {
    const app = await c.f.appClient();
    try {
      await expect(app.query('select * from platform_admin')).rejects.toThrow(/permission denied/);
      await expect(app.query('select * from platform_session')).rejects.toThrow(/permission denied/);
      await expect(app.query('select * from platform_audit')).rejects.toThrow(/permission denied/);
      await expect(app.query(`insert into platform_admin (email, name, password_hash) values ('x@x.example', 'x', 'x')`)).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});

describe('platform functions are bound to a live platform session (migration 003)', () => {
  const c = withPlatform();
  const FUTURE = () => new Date(Date.now() + 3600_000);
  const made = hashToken('made-up-token-that-was-never-issued');

  /** What a stray call could have changed: firms, platform audit rows, invites and people. */
  const snapshot = async () => {
    const q = async (sql: string) => (await c.f.owner.query(sql)).rows;
    return JSON.stringify([
      await q('select id, status, suspended_reason from firm order by id'),
      await q('select count(*)::int as n from platform_audit'),
      await q('select count(*)::int as n from invitation_token'),
      await q('select count(*)::int as n from person'),
    ]);
  };

  /** Calls every session-bound function with this hash as ams_app and expects each to raise 28000 and change nothing. */
  async function expectRefused(tokenHash: string) {
    const before = await snapshot();
    const app = await c.f.appClient();
    try {
      const calls: [string, unknown[]][] = [
        ['select * from platform_list_firms($1)', [tokenHash]],
        ['select * from platform_audit_list($1)', [tokenHash]],
        ['select * from platform_create_firm($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [tokenHash, 'Rogue Studio', 'Rogue Studio LLP', 'Asia/Kolkata', 'INR', 'Rogue Owner', 'rogue@rogue.example', hashToken('rogue-invite'), FUTURE()]],
        ['select platform_set_firm_status($1, $2, $3, $4)', [tokenHash, c.f.firmId, 'Suspended', 'No session']],
        ['select * from platform_firm_detail($1, $2)', [tokenHash, c.f.firmId]],
        ['select platform_reissue_owner_invite($1, $2, $3, $4)', [tokenHash, c.f.firmId, hashToken('rogue-reissue'), FUTURE()]],
      ];
      for (const [sql, params] of calls) {
        await expect(app.query(sql, params)).rejects.toMatchObject({ code: '28000' });
      }
    } finally {
      await app.end();
    }
    expect(await snapshot()).toBe(before);
    expect((await c.f.owner.query('select status from firm where id = $1', [c.f.firmId])).rows[0].status).toBe('Active');
    expect((await c.f.owner.query(`select 1 from firm where trading_name = 'Rogue Studio'`)).rowCount).toBe(0);
  }

  it('a made-up token is refused by every platform action and changes nothing', async () => {
    await expectRefused(made);
  });

  it('a firm user session token is refused by every platform action', async () => {
    const firmToken = await c.f.login('P01');
    await expectRefused(hashToken(firmToken));
  });

  it('a revoked platform session is refused', async () => {
    const r = await platformLogin(c.f, PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD);
    const token = r.cookies.find((x) => x.name === 'ams_platform')!.value;
    const app = await c.f.appClient();
    try {
      // While live, the same direct call works.
      expect((await app.query('select * from platform_list_firms($1)', [hashToken(token)])).rowCount).toBeGreaterThan(0);
    } finally {
      await app.end();
    }
    expect((await asAdmin(c.f, token, 'POST', '/auth/logout')).status).toBe(200);
    await expectRefused(hashToken(token));
  });

  it('an expired platform session is refused', async () => {
    const token = 'expired-platform-session-token';
    const adminId = (await c.f.owner.query('select id from platform_admin where email = $1', [PLATFORM_DEMO_EMAIL])).rows[0].id;
    await c.f.owner.query(`insert into platform_session (admin_id, token_hash, expires_at) values ($1, $2, now() - interval '1 minute')`, [adminId, hashToken(token)]);
    await expectRefused(hashToken(token));
    expect((await asAdmin(c.f, token, 'GET', '/firms')).status).toBe(401);
  });

  it('the old admin-id and no-identity signatures no longer exist', async () => {
    const old = [
      'platform_find_admin(text)',
      'platform_list_firms()',
      'platform_audit_list()',
      'platform_create_firm(text,text,text,text,text,text,text,timestamptz,uuid)',
      'platform_set_firm_status(uuid,text,text,uuid)',
    ];
    for (const sig of old) {
      expect((await c.f.owner.query('select to_regprocedure($1) as p', [sig])).rows[0].p, sig).toBeNull();
    }
    for (const sig of ['platform_list_firms(text)', 'platform_audit_list(text)', 'platform_auth_lookup(text)',
      'platform_firm_detail(text,uuid)', 'platform_reissue_owner_invite(text,uuid,text,timestamptz)',
      'platform_create_firm(text,text,text,text,text,text,text,text,timestamptz)', 'platform_set_firm_status(text,uuid,text,text)']) {
      expect((await c.f.owner.query('select to_regprocedure($1) as p', [sig])).rows[0].p, sig).not.toBeNull();
    }
  });

  it('only platform_create_session takes an admin id, and the session resolver is not callable by ams_app', async () => {
    const withAdminArg = (await c.f.owner.query(`
      select p.oid::regprocedure::text as sig from pg_proc p
      where p.proname like 'platform%' and 'uuid'::regtype::oid = any(p.proargtypes::oid[])
        and exists (select 1 from unnest(p.proargnames) n where n like '%admin%')`)).rows.map((r) => r.sig);
    expect(withAdminArg).toEqual(['platform_create_session(uuid,text,timestamp with time zone)']);
    const app = await c.f.appClient();
    try {
      await expect(app.query('select platform_session_admin($1)', [made])).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('no platform function except platform_auth_lookup returns password_hash, and that one returns only the id and the hash', async () => {
    const rows = (await c.f.owner.query(`
      select p.proname, array_agg(a.name::text order by a.ord) as outs
      from pg_proc p
      cross join lateral unnest(p.proargnames, p.proargmodes::text[]) with ordinality as a(name, mode, ord)
      where p.proname like 'platform%' and a.mode in ('o', 't', 'b')
      group by p.proname`)).rows as { proname: string; outs: string[] }[];
    const withHash = rows.filter((r) => r.outs.some((n) => /password/i.test(n))).map((r) => r.proname);
    expect(withHash).toEqual(['platform_auth_lookup']);
    expect(rows.find((r) => r.proname === 'platform_auth_lookup')!.outs).toEqual(['admin_id', 'password_hash']);
    const executable = (await c.f.owner.query(`
      select p.proname from pg_proc p where p.proname like 'platform%' and has_function_privilege('ams_app', p.oid, 'execute') order by 1`)).rows.map((r) => r.proname);
    expect(executable).toEqual(['platform_audit_list', 'platform_auth_lookup', 'platform_create_firm', 'platform_create_session',
      'platform_find_session', 'platform_firm_detail', 'platform_list_firms', 'platform_reissue_owner_invite', 'platform_revoke_session',
      'platform_set_firm_status']);
  });

  it('platform_create_session writes the login audit row and refuses a session longer than 12 hours', async () => {
    const app = await c.f.appClient();
    try {
      const adminId = (await app.query('select admin_id from platform_auth_lookup($1)', [PLATFORM_DEMO_EMAIL])).rows[0].admin_id;
      const count = async () => (await c.f.owner.query(`select count(*)::int as n from platform_audit where action = 'login' and admin_id = $1`, [adminId])).rows[0].n;
      const before = await count();
      await app.query('select platform_create_session($1, $2, $3)', [adminId, hashToken('direct-session'), FUTURE()]);
      expect(await count()).toBe(before + 1);
      await expect(app.query('select platform_create_session($1, $2, $3)', [adminId, hashToken('long-session'), new Date(Date.now() + 13 * 3600_000)]))
        .rejects.toMatchObject({ code: 'P0001' });
      await expect(app.query('select platform_create_session($1, $2, $3)', ['00000000-0000-4000-8000-000000000000', hashToken('ghost-session'), FUTURE()]))
        .rejects.toMatchObject({ code: '28000' });
      expect(await count()).toBe(before + 1);
    } finally {
      await app.end();
    }
  });
});
