import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, ownerUrl } from '../src/dev/db';
import { buildApp } from '../src/app';
import { limitBucket } from '../src/http/rate-limit';
import { PLATFORM_DEMO_EMAIL, PLATFORM_DEMO_PASSWORD, seedPlatformAdmin } from '../src/dev/platform-admin';
import { hashToken } from '../src/auth/sessions';
import { freshApp, PASSWORD, type Fresh } from './helpers';

/** Migration 009: the platform admin manages the people inside every studio. */

const TEST_PORT = 54331;
const PERSON_KEYS = ['account_types', 'id', 'invitation_state', 'job_title', 'last_sign_in_at', 'login_state', 'name', 'work_email'];
/** Keys that would mean projects, money, time or secrets crossed to the platform side. */
const FORBIDDEN_KEY = /project|amount|rate|invoice|hours|time_entry|timesheet|budget|fee|cost|margin|client|leave|password|hash|salary|phase/i;

type Out = { status: number; body: any; cookies: { name: string; value: string }[] };
type Method = 'GET' | 'POST' | 'PUT';

async function inject(f: Fresh | { app: Fresh['app'] }, method: Method, url: string, opts: { payload?: unknown; cookies?: Record<string, string> } = {}): Promise<Out> {
  const res = await f.app.inject({ method, url, payload: opts.payload as any, cookies: opts.cookies });
  let body: any = res.body;
  try { body = JSON.parse(res.body); } catch { /* not JSON */ }
  return { status: res.statusCode, body, cookies: res.cookies.map((c) => ({ name: c.name, value: c.value })) };
}
const platformLogin = (f: Fresh | { app: Fresh['app'] }) =>
  inject(f, 'POST', '/api/v1/platform/auth/login', { payload: { email: PLATFORM_DEMO_EMAIL, password: PLATFORM_DEMO_PASSWORD } });
const asAdmin = (f: Fresh | { app: Fresh['app'] }, token: string, method: Method, path: string, payload?: unknown) =>
  inject(f, method, `/api/v1/platform${path}`, { payload, cookies: { ams_platform: token } });

function withPlatform() {
  const ctx = {} as { f: Fresh; admin: string };
  beforeAll(async () => {
    ctx.f = await freshApp();
    await seedPlatformAdmin(ownerUrl(TEST_PORT, (ctx.f.owner as any).database));
    const r = await platformLogin(ctx.f);
    const c = r.cookies.find((x) => x.name === 'ams_platform');
    if (r.status !== 200 || !c) throw new Error(`platform login failed: ${r.status} ${JSON.stringify(r.body)}`);
    ctx.admin = c.value;
  });
  afterAll(async () => { await ctx.f?.close(); });
  return ctx;
}

function allKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(allKeys);
  if (!v || typeof v !== 'object') return [];
  return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
}
/** No key and no project name of the studio in any response body. */
async function expectNoBusinessData(f: Fresh, bodies: unknown[]) {
  for (const k of allKeys(bodies)) expect(k, k).not.toMatch(FORBIDDEN_KEY);
  const json = JSON.stringify(bodies);
  for (const p of (await f.owner.query('select code, name from project')).rows) {
    expect(json).not.toContain(p.name);
    expect(json).not.toContain(p.code);
  }
  expect(json).not.toMatch(/\$argon2/);
}

const tokenOf = (url: string) => url.split('/').pop()!;
const people = (f: Fresh, admin: string, firmId = f.firmId) => `/firms/${firmId}/people`;
const personPath = (f: Fresh, ref: string, action: string) => `/firms/${f.firmId}/people/${f.id(ref)}/${action}`;
const emailOf = (ref: string) => `${ref.toLowerCase()}@meridian.demo`;
async function firmSession(f: Fresh, email: string, password: string) {
  const r = await f.rawLogin(email, password);
  return { status: r.statusCode, token: r.cookies.find((c) => c.name === 'ams_session')?.value };
}
const firmMe = (f: Fresh, token: string) => inject(f, 'GET', '/api/v1/me', { cookies: { ams_session: token } });
async function createFirm(f: Fresh, admin: string, name: string) {
  const owner_email = `owner.${randomUUID().slice(0, 8)}@other-studio.example`;
  const r = await asAdmin(f, admin, 'POST', '/firms', { trading_name: name, legal_name: `${name} LLP`, timezone: 'Asia/Kolkata', currency: 'INR', owner_name: 'Olu Owner', owner_email });
  expect(r.status).toBe(200);
  const owner = (await f.owner.query('select id from person where firm_id = $1', [r.body.firm_id])).rows[0].id as string;
  return { firmId: r.body.firm_id as string, inviteUrl: r.body.invite_url as string, owner, owner_email };
}

describe('platform people: authentication', () => {
  const c = withPlatform();
  const routes = (f: Fresh): [Method, string, unknown?][] => [
    ['GET', `/firms/${f.firmId}/people`],
    ['POST', `/firms/${f.firmId}/people`, { name: 'X', work_email: 'x@x.example', account_types: ['employee'] }],
    ['POST', personPath(f, 'P04', 'reset-link')],
    ['POST', personPath(f, 'P04', 'invite-link')],
    ['PUT', personPath(f, 'P04', 'types'), { account_types: ['principal'], reason: 'x' }],
    ['POST', personPath(f, 'P04', 'disable'), { reason: 'x' }],
    ['POST', personPath(f, 'P04', 'enable'), { reason: 'x' }],
  ];

  it('every route is 401 without a platform session, and with a firm session under either cookie', async () => {
    const firmToken = await c.f.login('P01');
    for (const [method, path, payload] of routes(c.f)) {
      expect((await inject(c.f, method, `/api/v1/platform${path}`, { payload })).status, `${method} ${path}`).toBe(401);
      expect((await inject(c.f, method, `/api/v1/platform${path}`, { payload, cookies: { ams_session: firmToken } })).status).toBe(401);
      expect((await asAdmin(c.f, firmToken, method, path, payload)).status).toBe(401);
      expect((await asAdmin(c.f, 'made-up-platform-token', method, path, payload)).status).toBe(401);
    }
    // Nothing changed.
    expect((await c.f.owner.query(`select login_state from person where id = $1`, [c.f.id('P04')])).rows[0].login_state).toBe('Enabled');
    expect((await c.f.owner.query(`select count(*)::int n from person where work_email = 'x@x.example'`)).rows[0].n).toBe(0);
  });

  it('called directly as ams_app with a made-up or firm token, every 009 function raises 28000 and changes nothing', async () => {
    const snap = async () => JSON.stringify((await c.f.owner.query(`select
      (select count(*) from person) a, (select count(*) from invitation_token) b, (select count(*) from password_reset_token) c,
      (select count(*) from platform_audit) d, (select count(*) from audit_event) e, (select count(*) from permission_grant) g,
      (select string_agg(login_state, ',' order by id) from person) h`)).rows);
    const before = await snap();
    const app = await c.f.appClient();
    try {
      for (const h of [hashToken('never-issued'), hashToken(await c.f.login('P01'))]) {
        const calls: [string, unknown[]][] = [
          ['select * from platform_firm_people($1, $2)', [h, c.f.firmId]],
          ['select * from platform_firm_people($1, $2, $3)', [h, c.f.firmId, c.f.id('P04')]],
          ['select * from platform_create_person($1, $2, $3, $4, $5, $6, $7)', [h, c.f.firmId, 'Rogue', 'rogue@rogue.example', '', ['principal'], hashToken('rogue')]],
          ['select platform_issue_reset_link($1, $2, $3, $4)', [h, c.f.firmId, c.f.id('P04'), hashToken('rogue-reset')]],
          ['select platform_issue_invite_link($1, $2, $3, $4)', [h, c.f.firmId, c.f.id('P04'), hashToken('rogue-invite')]],
          ['select platform_set_account_types($1, $2, $3, $4, $5)', [h, c.f.firmId, c.f.id('P04'), ['principal'], 'rogue']],
          ['select platform_set_person_access($1, $2, $3, $4, $5)', [h, c.f.firmId, c.f.id('P01'), false, 'rogue']],
        ];
        for (const [sql, params] of calls) await expect(app.query(sql, params), sql).rejects.toMatchObject({ code: '28000' });
      }
      // The internal helpers are not callable at all.
      for (const sql of [
        `select platform_account_types('${c.f.id('P01')}')`,
        `select platform_revoke_links('${c.f.id('P01')}')`,
        `select platform_assert_not_last_principal('${c.f.firmId}', '${c.f.id('P01')}')`,
      ]) await expect(app.query(sql)).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    expect(await snap()).toBe(before);
  });
});

describe('platform people: list and other firms', () => {
  const c = withPlatform();
  let other: Awaited<ReturnType<typeof createFirm>>;
  beforeAll(async () => { other = await createFirm(c.f, c.admin, 'Other Studio'); });

  it('lists every person of a studio with exactly the agreed keys, and no business data', async () => {
    const r = await asAdmin(c.f, c.admin, 'GET', people(c.f, c.admin));
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(10);
    for (const p of r.body.data) expect(Object.keys(p).sort()).toEqual(PERSON_KEYS);
    const p01 = r.body.data.find((p: any) => p.id === c.f.id('P01'));
    expect(p01).toMatchObject({ name: 'Asha Rao', work_email: 'p01@meridian.demo', job_title: 'Principal', account_types: ['principal'], invitation_state: 'Accepted', login_state: 'Enabled' });
    expect(r.body.data.find((p: any) => p.id === c.f.id('P10')).account_types).toEqual(['admin', 'finance']);
    expect(r.body.data.find((p: any) => p.id === c.f.id('P04')).account_types).toEqual(['employee']);
    // Only this firm's people.
    expect(r.body.data.map((p: any) => p.id)).not.toContain(other.owner);
    await expectNoBusinessData(c.f, [r.body]);

    const theirs = await asAdmin(c.f, c.admin, 'GET', `/firms/${other.firmId}/people`);
    expect(theirs.body.data.map((p: any) => p.id)).toEqual([other.owner]);
    expect(theirs.body.data[0]).toMatchObject({ account_types: ['principal'], invitation_state: 'Sent', last_sign_in_at: null });
  });

  it('an unknown firm, a malformed id, and a person of another firm are 404 on every route', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await asAdmin(c.f, c.admin, 'GET', `/firms/${ghost}/people`)).status).toBe(404);
    expect((await asAdmin(c.f, c.admin, 'GET', '/firms/not-a-uuid/people')).status).toBe(404);
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${ghost}/people`, { name: 'N', work_email: 'n@ghost.example', account_types: ['employee'] })).status).toBe(404);
    const before = (await c.f.owner.query('select count(*)::int n from platform_audit')).rows[0].n;
    // The demo firm's P04 addressed under the other firm, and the other firm's owner under the demo firm.
    for (const [firmId, personId] of [[other.firmId, c.f.id('P04')], [c.f.firmId, other.owner], [c.f.firmId, ghost], [c.f.firmId, 'nope']]) {
      const base = `/firms/${firmId}/people/${personId}`;
      expect((await asAdmin(c.f, c.admin, 'POST', `${base}/reset-link`)).status).toBe(404);
      expect((await asAdmin(c.f, c.admin, 'POST', `${base}/invite-link`)).status).toBe(404);
      expect((await asAdmin(c.f, c.admin, 'PUT', `${base}/types`, { account_types: ['pm'], reason: 'Cross firm' })).status).toBe(404);
      expect((await asAdmin(c.f, c.admin, 'POST', `${base}/disable`, { reason: 'Cross firm' })).status).toBe(404);
      expect((await asAdmin(c.f, c.admin, 'POST', `${base}/enable`, { reason: 'Cross firm' })).status).toBe(404);
    }
    const r = await asAdmin(c.f, c.admin, 'POST', `/firms/${other.firmId}/people/${c.f.id('P04')}/disable`, { reason: 'Cross firm' });
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect((await c.f.owner.query('select count(*)::int n from platform_audit')).rows[0].n).toBe(before);
    expect((await c.f.owner.query('select login_state from person where id = $1', [c.f.id('P04')])).rows[0].login_state).toBe('Enabled');
    expect((await c.f.owner.query('select count(*)::int n from permission_grant where person_id = $1', [c.f.id('P04')])).rows[0].n).toBe(1);
  });
});

describe('platform people: adding a person and invite links', () => {
  const c = withPlatform();

  it('validates the form, refuses a taken email, and checks the types', async () => {
    const path = people(c.f, c.admin);
    expect((await asAdmin(c.f, c.admin, 'POST', path, {})).status).toBe(400);
    expect((await asAdmin(c.f, c.admin, 'POST', path, { name: '', work_email: 'a@b.example', account_types: ['pm'] })).status).toBe(400);
    expect((await asAdmin(c.f, c.admin, 'POST', path, { name: 'A', work_email: 'not-an-email', account_types: ['pm'] })).status).toBe(400);
    expect((await asAdmin(c.f, c.admin, 'POST', path, { name: 'A', work_email: 'a@b.example', account_types: [] })).status).toBe(400);
    const unknown = await asAdmin(c.f, c.admin, 'POST', path, { name: 'A', work_email: 'a@b.example', account_types: ['root'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION');
    const dup = await asAdmin(c.f, c.admin, 'POST', path, { name: 'A', work_email: 'P02@MERIDIAN.demo', account_types: ['pm'] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('adds a person with their types and a 72-hour invite; the link is accepted once; both audits record it', async () => {
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Ila Joshi', work_email: 'ila@meridian.demo', job_title: 'Architect', account_types: ['pm', 'employee', 'pm'] });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['email_sent', 'invite_expires_at', 'invite_url', 'person']);
    expect(r.body.email_sent).toBe(false);
    expect(Object.keys(r.body.person).sort()).toEqual(PERSON_KEYS);
    expect(r.body.person).toMatchObject({ name: 'Ila Joshi', work_email: 'ila@meridian.demo', job_title: 'Architect', account_types: ['pm', 'employee'], invitation_state: 'Sent', login_state: 'Enabled', last_sign_in_at: null });
    expect(r.body.invite_url).toMatch(/^\/accept-invite\/[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(r.body.invite_expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72.1);
    await expectNoBusinessData(c.f, [r.body.person]);
    const id = r.body.person.id as string;
    const row = (await c.f.owner.query('select firm_id, ref_code from person where id = $1', [id])).rows[0];
    expect(row).toEqual({ firm_id: c.f.firmId, ref_code: 'P11' });

    const token = tokenOf(r.body.invite_url);
    const stored = (await c.f.owner.query('select token_hash from invitation_token where person_id = $1', [id])).rows.map((x) => x.token_hash);
    expect(stored).toEqual([hashToken(token)]);

    const accept = await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password: 'a-long-password-for-ila' } });
    expect(accept.status).toBe(200);
    const again = await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password: 'a-long-password-for-ila' } });
    expect([404, 410]).toContain(again.status);
    expect((await firmSession(c.f, 'ila@meridian.demo', 'a-long-password-for-ila')).status).toBe(200);
    const listed = (await asAdmin(c.f, c.admin, 'GET', people(c.f, c.admin))).body.data.find((p: any) => p.id === id);
    expect(listed.invitation_state).toBe('Accepted');
    expect(listed.last_sign_in_at).toBeTruthy();

    const pa = (await c.f.owner.query(`select a.admin_id, a.firm_id, a.person_id, a.action, ad.email from platform_audit a join platform_admin ad on ad.id = a.admin_id where a.person_id = $1`, [id])).rows;
    expect(pa).toEqual([{ admin_id: expect.any(String), firm_id: c.f.firmId, person_id: id, action: 'create_account', email: PLATFORM_DEMO_EMAIL }]);
    const ae = (await c.f.owner.query(`select actor_id, action, new from audit_event where record_type = 'person' and record_id = $1 and action like 'platform_%'`, [id])).rows;
    expect(ae).toHaveLength(1);
    expect(ae[0].actor_id).toBeNull();
    expect(ae[0].action).toBe('platform_create_account');
    expect(ae[0].new).toMatchObject({ by: 'Platform admin', account_types: ['pm', 'employee'], work_email: 'ila@meridian.demo' });
    expect(JSON.stringify(ae[0].new)).not.toContain(token);
  });

  it('a new invite link revokes the earlier one, works once, and is refused once accepted', async () => {
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Om Rao', work_email: 'om@meridian.demo', account_types: ['employee'] });
    expect(r.status).toBe(200);
    expect(r.body.person.job_title).toBe('');
    const id = r.body.person.id as string;
    const first = tokenOf(r.body.invite_url);
    const link = await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${id}/invite-link`);
    expect(link.status).toBe(200);
    expect(Object.keys(link.body).sort()).toEqual(['email_sent', 'invite_expires_at', 'invite_url']);
    expect(link.body.email_sent).toBe(false);
    const hours = (Date.parse(link.body.invite_expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72.1);
    const second = tokenOf(link.body.invite_url);
    expect(second).not.toBe(first);
    expect([404, 410]).toContain((await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token: first, password: 'a-long-password-for-om' } })).status);
    expect((await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token: second, password: 'a-long-password-for-om' } })).status).toBe(200);

    const accepted = await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${id}/invite-link`);
    expect(accepted.status).toBe(422);
    expect(accepted.body.error.code).toBe('RULE_VIOLATION');
    expect(accepted.body.error.message).toMatch(/already accepted/);
    expect((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P04', 'invite-link'))).status).toBe(422);

    const pa = (await c.f.owner.query(`select action from platform_audit where person_id = $1 order by at`, [id])).rows.map((x) => x.action);
    expect(pa).toEqual(['create_account', 'reinvite']);
    const ae = (await c.f.owner.query(`select new->>'by' as by from audit_event where record_id = $1 and action = 'platform_reinvite'`, [id])).rows;
    expect(ae).toEqual([{ by: 'Platform admin' }]);
  });
});

describe('platform people: password reset links', () => {
  const c = withPlatform();

  it('issues a 24-hour link that sets a new password once, revokes the earlier link and ends every session', async () => {
    const old = await firmSession(c.f, emailOf('P04'), PASSWORD);
    expect(old.status).toBe(200);
    const first = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P04', 'reset-link'));
    expect(first.status).toBe(200);
    expect(Object.keys(first.body).sort()).toEqual(['email_sent', 'expires_at', 'reset_url']);
    expect(first.body.email_sent).toBe(false);
    expect(first.body.reset_url).toMatch(/^\/reset-password\/[A-Za-z0-9_-]{43}$/);
    const hours = (Date.parse(first.body.expires_at) - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24.1);
    const second = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P04', 'reset-link'));
    const t1 = tokenOf(first.body.reset_url);
    const t2 = tokenOf(second.body.reset_url);
    // Only the hash is stored.
    const stored = (await c.f.owner.query('select token_hash, revoked_at from password_reset_token where person_id = $1 order by created_at', [c.f.id('P04')])).rows;
    expect(stored.map((s) => s.token_hash)).toEqual([hashToken(t1), hashToken(t2)]);
    expect(stored[0].revoked_at).not.toBeNull();
    expect(stored[1].revoked_at).toBeNull();

    expect([404, 410]).toContain((await inject(c.f, 'POST', `/api/v1/auth/reset/${t1}`, { payload: { password: 'a-brand-new-password' } })).status);
    expect((await inject(c.f, 'GET', `/api/v1/auth/reset/${t2}`)).status).toBe(200);
    expect((await inject(c.f, 'POST', `/api/v1/auth/reset/${t2}`, { payload: { password: 'a-brand-new-password' } })).status).toBe(200);
    expect([404, 410]).toContain((await inject(c.f, 'POST', `/api/v1/auth/reset/${t2}`, { payload: { password: 'another-new-password' } })).status);

    expect((await firmMe(c.f, old.token!)).status).toBe(401);
    expect((await firmSession(c.f, emailOf('P04'), PASSWORD)).status).toBe(401);
    expect((await firmSession(c.f, emailOf('P04'), 'a-brand-new-password')).status).toBe(200);

    const pa = (await c.f.owner.query(`select action, firm_id from platform_audit where person_id = $1 order by at`, [c.f.id('P04')])).rows;
    expect(pa).toEqual([{ action: 'issue_reset_link', firm_id: c.f.firmId }, { action: 'issue_reset_link', firm_id: c.f.firmId }]);
    const ae = (await c.f.owner.query(`select actor_id, new from audit_event where record_id = $1 and action = 'platform_issue_reset_link'`, [c.f.id('P04')])).rows;
    expect(ae).toHaveLength(2);
    for (const e of ae) expect(e).toMatchObject({ actor_id: null, new: { by: 'Platform admin' } });
  });

  it('refuses a person who has not accepted, and a disabled account', async () => {
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Pia Sen', work_email: 'pia@meridian.demo', account_types: ['employee'] });
    const notYet = await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/reset-link`);
    expect(notYet.status).toBe(422);
    expect(notYet.body.error.message).toMatch(/not accepted/);
    expect((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P09', 'disable'), { reason: 'Internship ended' })).status).toBe(200);
    const disabled = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P09', 'reset-link'));
    expect(disabled.status).toBe(422);
    expect(disabled.body.error.message).toMatch(/disabled/);
    expect((await c.f.owner.query('select count(*)::int n from password_reset_token where person_id in ($1, $2)', [r.body.person.id, c.f.id('P09')])).rows[0].n).toBe(0);
  });
});

describe('platform people: disable and enable', () => {
  const c = withPlatform();

  it('needs a reason', async () => {
    for (const action of ['disable', 'enable']) {
      const r = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', action), {});
      expect(r.status).toBe(400);
      expect(r.body.error.details[0].field).toBe('reason');
    }
  });

  it('disable ends every session and every open link; enable lets the person sign in again', async () => {
    const s1 = await firmSession(c.f, emailOf('P05'), PASSWORD);
    const s2 = await firmSession(c.f, emailOf('P05'), PASSWORD);
    expect((await firmMe(c.f, s1.token!)).status).toBe(200);
    const reset = tokenOf((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', 'reset-link'))).body.reset_url);

    const off = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', 'disable'), { reason: 'Left the studio' });
    expect(off.status).toBe(200);
    expect(Object.keys(off.body)).toEqual(['person']);
    expect(Object.keys(off.body.person).sort()).toEqual(PERSON_KEYS);
    expect(off.body.person).toMatchObject({ id: c.f.id('P05'), login_state: 'Revoked' });
    for (const s of [s1, s2]) expect((await firmMe(c.f, s.token!)).status).toBe(401);
    const open = (await c.f.owner.query(`select count(*)::int n from session where person_id = $1 and revoked_at is null`, [c.f.id('P05')])).rows[0].n;
    expect(open).toBe(0);
    expect((await c.f.owner.query(`select count(*)::int n from password_reset_token where person_id = $1 and revoked_at is null and used_at is null`, [c.f.id('P05')])).rows[0].n).toBe(0);
    expect([404, 410]).toContain((await inject(c.f, 'POST', `/api/v1/auth/reset/${reset}`, { payload: { password: 'sneaky-new-password' } })).status);
    expect((await firmSession(c.f, emailOf('P05'), PASSWORD)).status).toBe(401);

    const twice = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', 'disable'), { reason: 'Again' });
    expect(twice.status).toBe(422);

    const on = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', 'enable'), { reason: 'Came back' });
    expect(on.status).toBe(200);
    expect(on.body.person.login_state).toBe('Enabled');
    // The old password works again; the revoked sessions stay revoked.
    expect((await firmSession(c.f, emailOf('P05'), PASSWORD)).status).toBe(200);
    expect((await firmMe(c.f, s1.token!)).status).toBe(401);
    expect((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P05', 'enable'), { reason: 'Again' })).status).toBe(422);

    const pa = (await c.f.owner.query(`select action, reason, detail from platform_audit where person_id = $1 order by at`, [c.f.id('P05')])).rows;
    expect(pa.map((x) => [x.action, x.reason])).toEqual([['issue_reset_link', null], ['disable', 'Left the studio'], ['enable', 'Came back']]);
    expect(pa[1].detail).toMatchObject({ login_state: 'Revoked', sessions_revoked: 2, person_id: c.f.id('P05') });
    const ae = (await c.f.owner.query(`select action, actor_id, reason, previous, new from audit_event where record_id = $1 and action in ('platform_disable', 'platform_enable') order by at`, [c.f.id('P05')])).rows;
    expect(ae).toEqual([
      { action: 'platform_disable', actor_id: null, reason: 'Left the studio', previous: { login_state: 'Enabled' }, new: { login_state: 'Revoked', sessions_revoked: 2, by: 'Platform admin' } },
      { action: 'platform_enable', actor_id: null, reason: 'Came back', previous: { login_state: 'Revoked' }, new: { login_state: 'Enabled', by: 'Platform admin' } },
    ]);
  });

  it('disabling a person who has not accepted revokes their invite link', async () => {
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Raj Pal', work_email: 'raj@meridian.demo', account_types: ['employee'] });
    const token = tokenOf(r.body.invite_url);
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/disable`, { reason: 'Offer withdrawn' })).status).toBe(200);
    expect([404, 410]).toContain((await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token, password: 'a-long-password-for-raj' } })).status);
    // A disabled account gets no new invite either, until it is enabled.
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/invite-link`)).status).toBe(422);
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/enable`, { reason: 'Offer back on' })).status).toBe(200);
    expect((await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/invite-link`)).status).toBe(200);
  });
});

describe('platform people: the last principal', () => {
  const c = withPlatform();

  it('the only principal cannot be disabled or lose principal; once another principal exists, they can', async () => {
    const off = await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P01', 'disable'), { reason: 'Try' });
    expect(off.status).toBe(422);
    expect(off.body.error.code).toBe('RULE_VIOLATION');
    expect(off.body.error.message).toMatch(/last principal/);
    const demote = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P01', 'types'), { account_types: ['admin'], reason: 'Try' });
    expect(demote.status).toBe(422);
    expect(demote.body.error.message).toMatch(/last principal/);
    // Nothing changed and nothing was audited for the refusals.
    expect((await c.f.owner.query('select login_state from person where id = $1', [c.f.id('P01')])).rows[0].login_state).toBe('Enabled');
    expect((await c.f.owner.query('select count(*)::int n from platform_audit where person_id = $1', [c.f.id('P01')])).rows[0].n).toBe(0);
    // Keeping principal while adding another type is fine.
    const add = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P01', 'types'), { account_types: ['principal', 'admin'], reason: 'Runs operations too' });
    expect(add.status).toBe(200);
    expect(add.body.person.account_types).toEqual(['principal', 'admin']);

    // A principal who has not accepted their invite does not count as the other principal.
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Sara Lal', work_email: 'sara@meridian.demo', account_types: ['principal'] });
    expect(r.status).toBe(200);
    expect((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P01', 'disable'), { reason: 'Try' })).status).toBe(422);

    const promote = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P02', 'types'), { account_types: ['pm', 'principal'], reason: 'New partner' });
    expect(promote.status).toBe(200);
    expect(promote.body.person.account_types).toEqual(['principal', 'pm']);
    const now = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P01', 'types'), { account_types: ['admin'], reason: 'Steps back' });
    expect(now.status).toBe(200);
    expect(now.body.person.account_types).toEqual(['admin']);
    // And P02 is now the last principal.
    expect((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P02', 'disable'), { reason: 'Try' })).status).toBe(422);
  });
});

describe('platform people: account types', () => {
  const c = withPlatform();

  it('validates the body and needs a reason', async () => {
    expect((await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P06', 'types'), { account_types: [], reason: 'x' })).status).toBe(400);
    expect((await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P06', 'types'), { account_types: ['wizard'], reason: 'x' })).status).toBe(400);
    expect((await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P06', 'types'), { account_types: ['pm'] })).status).toBe(400);
  });

  it('a non-sensitive change keeps open links; gaining finance or principal revokes them; the new types take effect at once', async () => {
    const session = await firmSession(c.f, emailOf('P06'), PASSWORD);
    const link1 = tokenOf((await asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P06', 'reset-link'))).body.reset_url);
    const pm = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P06', 'types'), { account_types: ['employee', 'pm'], reason: 'Runs a project' });
    expect(pm.status).toBe(200);
    expect(Object.keys(pm.body)).toEqual(['person']);
    expect(pm.body.person.account_types).toEqual(['pm', 'employee']);
    expect((await inject(c.f, 'GET', `/api/v1/auth/reset/${link1}`)).status).toBe(200);

    const fin = await asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P06', 'types'), { account_types: ['employee', 'finance'], reason: 'Moves to accounts' });
    expect(fin.status).toBe(200);
    expect(fin.body.person.account_types).toEqual(['finance', 'employee']);
    expect([404, 410]).toContain((await inject(c.f, 'POST', `/api/v1/auth/reset/${link1}`, { payload: { password: 'someone-elses-password' } })).status);
    const sensitive = (await c.f.owner.query(`select s.key, g.sensitive, g.granted_by from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 order by s.key`, [c.f.id('P06')])).rows;
    // The new finance grant is sensitive and granted by the platform (no person); the seeded staff grant is untouched.
    expect(sensitive).toEqual([{ key: 'finance', sensitive: true, granted_by: null }, { key: 'staff', sensitive: false, granted_by: c.f.id('P01') }]);

    // The person's live session sees the new permission sets.
    const me = await firmMe(c.f, session.token!);
    expect(me.status).toBe(200);
    expect(me.body.permission_sets).toEqual(expect.arrayContaining(['finance', 'staff']));
    expect(me.body.permission_sets).not.toContain('pm');

    // An unaccepted person who becomes principal loses their invite link.
    const r = await asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Tia Roy', work_email: 'tia@meridian.demo', account_types: ['employee'] });
    const invite = tokenOf(r.body.invite_url);
    expect((await asAdmin(c.f, c.admin, 'PUT', `/firms/${c.f.firmId}/people/${r.body.person.id}/types`, { account_types: ['principal'], reason: 'Partner' })).status).toBe(200);
    expect([404, 410]).toContain((await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token: invite, password: 'a-long-password-for-tia' } })).status);
    const fresh = await asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${r.body.person.id}/invite-link`);
    expect(fresh.status).toBe(200);
    expect((await inject(c.f, 'POST', '/api/v1/auth/accept-invite', { payload: { token: tokenOf(fresh.body.invite_url), password: 'a-long-password-for-tia' } })).status).toBe(200);

    const pa = (await c.f.owner.query(`select action, reason, detail from platform_audit where person_id = $1 and action = 'set_account_types' order by at`, [c.f.id('P06')])).rows;
    expect(pa.map((x) => x.reason)).toEqual(['Runs a project', 'Moves to accounts']);
    expect(pa[1].detail).toMatchObject({ account_types: ['finance', 'employee'], added: ['finance'], removed: ['pm'] });
    const ae = (await c.f.owner.query(`select actor_id, previous, new, reason from audit_event where record_id = $1 and action = 'platform_set_account_types' order by at`, [c.f.id('P06')])).rows;
    expect(ae[1]).toEqual({ actor_id: null, reason: 'Moves to accounts', previous: { account_types: ['pm', 'employee'] }, new: { account_types: ['finance', 'employee'], added: ['finance'], removed: ['pm'], by: 'Platform admin' } });
  });
});

describe('platform people: the studio sees what the platform did, and no business data crosses', () => {
  const c = withPlatform();

  it('every response carries people data only, and the studio audit lists each action', async () => {
    const bodies: unknown[] = [];
    const push = async (p: Promise<Out>) => { const r = await p; expect(r.status).toBeLessThan(300); bodies.push(r.body); return r; };
    await push(asAdmin(c.f, c.admin, 'GET', people(c.f, c.admin)));
    const made = await push(asAdmin(c.f, c.admin, 'POST', people(c.f, c.admin), { name: 'Uma Das', work_email: 'uma@meridian.demo', account_types: ['employee'] }));
    await push(asAdmin(c.f, c.admin, 'POST', `/firms/${c.f.firmId}/people/${made.body.person.id}/invite-link`));
    await push(asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P07', 'reset-link')));
    await push(asAdmin(c.f, c.admin, 'PUT', personPath(c.f, 'P07', 'types'), { account_types: ['employee', 'pm'], reason: 'Lead' }));
    await push(asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P08', 'disable'), { reason: 'Leave of absence' }));
    await push(asAdmin(c.f, c.admin, 'POST', personPath(c.f, 'P08', 'enable'), { reason: 'Back' }));
    await expectNoBusinessData(c.f, bodies);

    const audit = await c.f.call('P01', 'GET', '/audit');
    expect(audit.status).toBe(200);
    const platformRows = audit.body.data.filter((e: any) => String(e.action).startsWith('platform_'));
    expect(platformRows.map((e: any) => e.action).sort()).toEqual(
      ['platform_create_account', 'platform_disable', 'platform_enable', 'platform_issue_reset_link', 'platform_reinvite', 'platform_set_account_types'],
    );
    for (const e of platformRows) {
      expect(e.new.by).toBe('Platform admin');
      // The studio's audit list names the platform as the actor (no person in the firm did it).
      expect(e.actor).toBe('Platform admin');
    }
    // A person's own row still names that person, never the platform.
    const login = audit.body.data.find((e: any) => e.action === 'login');
    expect(login?.actor).toBe('Asha Rao');

    const platform = await asAdmin(c.f, c.admin, 'GET', '/audit');
    const actions = platform.body.data.filter((e: any) => e.firm_id === c.f.firmId).map((e: any) => e.action);
    for (const a of ['create_account', 'reinvite', 'issue_reset_link', 'set_account_types', 'disable', 'enable']) expect(actions).toContain(a);
    const missingPerson = (await c.f.owner.query(`select count(*)::int n from platform_audit where action in ('create_account', 'reinvite', 'issue_reset_link', 'set_account_types', 'disable', 'enable') and (person_id is null or admin_id is null or firm_id is null)`)).rows[0].n;
    expect(missingPerson).toBe(0);
  });
});

describe('platform people: rate limiting of the link routes', () => {
  it('the reset-link and invite-link routes count against their own buckets', () => {
    for (const action of ['reset-link', 'invite-link']) {
      const route = `/api/v1/platform/firms/:id/people/:personId/${action}`;
      expect(limitBucket({ method: 'POST', url: `/api/v1/platform/firms/a/people/b/${action}`, routeOptions: { url: route } })).toBe(route);
      expect(limitBucket({ method: 'GET', url: `/api/v1/platform/firms/a/people/b/${action}`, routeOptions: { url: route } })).toBeNull();
    }
    expect(limitBucket({ method: 'GET', url: '/api/v1/platform/firms/a/people', routeOptions: { url: '/api/v1/platform/firms/:id/people' } })).toBeNull();
  });

  it('answers 429 once the limit is used up', async () => {
    const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const admin = new pg.Client({ connectionString: ownerUrl(TEST_PORT, 'postgres') });
    await admin.connect();
    await admin.query(`create database ${name} template ams_template`);
    await admin.end();
    await seedPlatformAdmin(ownerUrl(TEST_PORT, name));
    const app = buildApp(appUrl(TEST_PORT, name), { rateLimit: { max: 2, windowMs: 60_000 } });
    await app.ready();
    const owner = new pg.Client({ connectionString: ownerUrl(TEST_PORT, name) });
    await owner.connect();
    try {
      const firmId = (await owner.query('select id from firm')).rows[0].id;
      const p04 = (await owner.query(`select id from person where ref_code = 'P04'`)).rows[0].id;
      const login = await platformLogin({ app });
      const token = login.cookies.find((x) => x.name === 'ams_platform')!.value;
      const reset = `/firms/${firmId}/people/${p04}/reset-link`;
      expect((await asAdmin({ app }, token, 'POST', reset)).status).toBe(200);
      expect((await asAdmin({ app }, token, 'POST', reset)).status).toBe(200);
      const limited = await asAdmin({ app }, token, 'POST', reset);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      // Other platform routes are not limited.
      for (let i = 0; i < 4; i++) expect((await asAdmin({ app }, token, 'GET', `/firms/${firmId}/people`)).status).toBe(200);
    } finally {
      await owner.end();
      await app.close();
    }
  });
});
