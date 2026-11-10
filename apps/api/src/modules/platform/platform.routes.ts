import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { hash, verify } from '@node-rs/argon2';
import { ApiError, notFound } from '../../http/errors';
import { hashToken, newToken } from '../../auth/sessions';
import { isUuid, required } from '../../http/validation';

/**
 * Platform administration: the people who run the service, not any firm's users.
 * Separate login and cookie (never the firm session). Every read and write goes through
 * SECURITY DEFINER functions (migrations 002 and 003); the ams_app role has no grant on the platform tables.
 * Since 003 every platform action takes the session token hash and the database resolves the admin from it,
 * so no admin id is ever passed except to platform_create_session right after the password is verified.
 * Business data never crosses this boundary: the firm list carries counts only, and no route returns projects, money
 * or time. The company detail (004) adds the owner's name, email and invitation state. Since 009 the platform admin
 * manages each studio's people and accounts (list, add, account types, invite and reset links, disable, enable);
 * passwords change only through one-time links.
 */
const ACCOUNT_TYPES = ['principal', 'admin', 'finance', 'pm', 'employee'];
export const PLATFORM_COOKIE = 'ams_platform';
export const PLATFORM_PREFIX = '/api/v1/platform/';
const COOKIE_PATH = '/api/v1/platform';
const SESSION_HOURS = 12;
const INVITE_HOURS = 72;
const DUMMY_HASH = hash('not-a-real-platform-password');

export type PlatformAdmin = { id: string; name: string; email: string; sessionId: string | null; tokenHash: string };
const admins = new WeakMap<FastifyRequest, PlatformAdmin>();

const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to the platform console.');
const invalid = (field: string, message: string, code = 'invalid') => new ApiError(400, 'VALIDATION', message, [{ field, code }]);
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function reasonOf(body: any) {
  const reason = str(body?.reason);
  if (!reason) throw invalid('reason', 'Give a reason. It is kept in the platform audit.', 'required');
  if (reason.length > 500) throw invalid('reason', 'Keep the reason under 500 characters.', 'too_long');
  return reason;
}

export function platformRoutes(app: FastifyInstance, pool: pg.Pool, opts: { secureCookie?: boolean } = {}) {
  const cookieOpts = { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict' as const, secure: !!opts.secureCookie };

  /** A session that ends between the guard and the call (errcode 28000 from the database) is a 401, not a 500. */
  const query = async (sql: string, params: unknown[]) => {
    try {
      return await pool.query(sql, params);
    } catch (e: any) {
      if (e?.code === '28000') throw unauthenticated();
      throw e;
    }
  };

  /** Only the ams_platform cookie counts here. A firm session cookie or bearer token is ignored. */
  const guard = async (req: FastifyRequest) => {
    const token = req.cookies?.[PLATFORM_COOKIE];
    if (!token) throw unauthenticated();
    const tokenHash = hashToken(token);
    const s = (await pool.query('select * from platform_find_session($1)', [tokenHash])).rows[0];
    if (!s) throw unauthenticated();
    admins.set(req, {
      id: s.admin_id,
      name: s.name ?? '',
      email: s.email ?? '',
      sessionId: s.session_id ?? null,
      tokenHash,
    });
  };
  const adminOf = (req: FastifyRequest) => {
    const a = admins.get(req);
    if (!a) throw unauthenticated();
    return a;
  };
  const secured = { preHandler: guard };

  // ----- Session -----
  app.post('/api/v1/platform/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    required(body, ['email', 'password']);
    // The only call that returns a password hash, and it returns nothing else but the admin id.
    const a = (await pool.query('select admin_id, password_hash from platform_auth_lookup($1)', [String(body.email).trim()])).rows[0];
    // Verify even for an unknown email, so neither the status, the body nor the timing tells them apart.
    const ok = await verify(a?.password_hash ?? (await DUMMY_HASH), String(body.password)).catch(() => false);
    if (!a || !ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email and password do not match.');
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await pool.query('select platform_create_session($1, $2, $3)', [a.admin_id, hashToken(token), expires]);
    reply.setCookie(PLATFORM_COOKIE, token, { ...cookieOpts, maxAge: SESSION_HOURS * 3600 });
    return { ok: true };
  });

  app.post('/api/v1/platform/auth/logout', async (req, reply) => {
    const token = req.cookies?.[PLATFORM_COOKIE];
    if (token) await pool.query('select platform_revoke_session($1)', [hashToken(token)]);
    reply.clearCookie(PLATFORM_COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  });

  app.get('/api/v1/platform/me', secured, async (req) => {
    const a = adminOf(req);
    return { id: a.id, name: a.name, email: a.email };
  });

  // ----- Firms: counts only, never business data or the names of a firm's people. -----
  app.get('/api/v1/platform/firms', secured, async (req) => {
    const rows = (await query('select * from platform_list_firms($1)', [adminOf(req).tokenHash])).rows;
    // Explicit allow-list: whatever the function returns, only these keys leave the server.
    return {
      data: rows.map((r) => ({
        id: r.id,
        trading_name: r.trading_name,
        legal_name: r.legal_name,
        status: r.status,
        currency: r.currency,
        timezone: r.timezone,
        created_at: iso(r.created_at),
        people: Number(r.people ?? 0),
        active_people: Number(r.active_people ?? 0),
        last_login_at: iso(r.last_login_at),
      })),
    };
  });

  app.post('/api/v1/platform/firms', secured, async (req) => {
    const admin = adminOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    required(body as any, ['trading_name', 'legal_name', 'timezone', 'currency', 'owner_name', 'owner_email']);
    const tradingName = str(body.trading_name);
    const legalName = str(body.legal_name);
    const timezone = str(body.timezone);
    const currency = str(body.currency).toUpperCase();
    const ownerName = str(body.owner_name);
    const ownerEmail = str(body.owner_email).toLowerCase();
    const details: { field: string; code: string }[] = [];
    if (!tradingName) details.push({ field: 'trading_name', code: 'required' });
    if (!legalName) details.push({ field: 'legal_name', code: 'required' });
    if (!validTimezone(timezone)) details.push({ field: 'timezone', code: 'invalid' });
    if (!/^[A-Z]{3}$/.test(currency)) details.push({ field: 'currency', code: 'invalid' });
    if (!ownerName) details.push({ field: 'owner_name', code: 'required' });
    if (!EMAIL.test(ownerEmail)) details.push({ field: 'owner_email', code: 'invalid' });
    if (details.length) throw new ApiError(400, 'VALIDATION', 'Some details are missing or not valid.', details);

    // A work email signs in to exactly one firm, so it must be new everywhere.
    const taken = (await pool.query('select 1 from auth_find_person($1)', [ownerEmail])).rowCount;
    if (taken) throw new ApiError(409, 'DUPLICATE_EMAIL', 'Someone already signs in with that email.', [{ field: 'owner_email', code: 'duplicate' }]);

    const token = newToken();
    const expires = new Date(Date.now() + INVITE_HOURS * 3600_000);
    let row: any;
    try {
      row = (await query(
        'select * from platform_create_firm($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [admin.tokenHash, tradingName, legalName, timezone, currency, ownerName, ownerEmail, hashToken(token), expires],
      )).rows[0];
    } catch (e: any) {
      if (e?.code === '23505') throw new ApiError(409, 'DUPLICATE_EMAIL', 'Someone already signs in with that email.', [{ field: 'owner_email', code: 'duplicate' }]);
      throw e;
    }
    const firmId = row?.firm_id;
    return { firm_id: firmId, invite_url: `/accept-invite/${token}`, invite_expires_at: expires.toISOString(), email_sent: false };
  });

  // One company: still counts only, plus the owner's name, email and invitation state (migration 004).
  const detailOf = async (tokenHash: string, id: string | undefined) => {
    if (!isUuid(id)) throw notFound('Firm');
    const r = (await query('select * from platform_firm_detail($1, $2)', [tokenHash, id])).rows[0];
    if (!r) throw notFound('Firm');
    // Explicit allow-list, as for the list.
    return {
      id: r.id,
      trading_name: r.trading_name,
      legal_name: r.legal_name,
      status: r.status,
      suspended_reason: r.suspended_reason ?? null,
      timezone: r.timezone,
      currency: r.currency,
      created_at: iso(r.created_at),
      people: Number(r.people ?? 0),
      active_people: Number(r.active_people ?? 0),
      last_login_at: iso(r.last_login_at),
      owner_name: r.owner_name ?? null,
      owner_email: r.owner_email ?? null,
      owner_invitation_state: r.owner_invitation_state ?? null,
    };
  };

  app.get('/api/v1/platform/firms/:id', secured, async (req) =>
    detailOf(adminOf(req).tokenHash, (req.params as { id?: string }).id));

  /** A new owner invite link, while the owner has not accepted. Earlier links stop working. */
  app.post('/api/v1/platform/firms/:id/owner-invite', secured, async (req) => {
    const admin = adminOf(req);
    const id = (req.params as { id?: string }).id;
    await detailOf(admin.tokenHash, id);
    const token = newToken();
    const expires = new Date(Date.now() + INVITE_HOURS * 3600_000);
    await query('select platform_reissue_owner_invite($1, $2, $3, $4)', [admin.tokenHash, id, hashToken(token), expires]);
    return { invite_url: `/accept-invite/${token}`, invite_expires_at: expires.toISOString(), email_sent: false };
  });

  const setStatus = (status: 'Active' | 'Suspended') => async (req: FastifyRequest) => {
    const admin = adminOf(req);
    const id = (req.params as { id?: string }).id;
    if (!isUuid(id)) throw notFound('Firm');
    const reason = reasonOf(req.body);
    const exists = (await query('select * from platform_list_firms($1)', [admin.tokenHash])).rows.find((r) => r.id === id);
    if (!exists) throw notFound('Firm');
    await query('select platform_set_firm_status($1, $2, $3, $4)', [admin.tokenHash, id, status, reason]);
    return { id, status };
  };
  app.post('/api/v1/platform/firms/:id/suspend', secured, setStatus('Suspended'));
  app.post('/api/v1/platform/firms/:id/reactivate', secured, setStatus('Active'));

  // ----- People inside a studio (migration 009) -----
  // The owner decided the platform admin has full control over a studio's accounts. This is people and sign-in data
  // only: never projects, money or time. A password changes only through a one-time link; the platform never sets or
  // sees one. Every action is audited on the platform and in the studio's own audit trail ("Platform admin").

  /** Only these keys leave the server for a person, whatever the function returns. */
  const personOf = (r: any) => ({
    id: r.id,
    name: r.name,
    work_email: r.work_email,
    job_title: r.job_title ?? '',
    account_types: Array.isArray(r.account_types) ? (r.account_types as string[]) : [],
    invitation_state: r.invitation_state,
    login_state: r.login_state,
    last_sign_in_at: iso(r.last_sign_in_at),
  });

  /** 28000 is a 401 (via query); P0002 an unknown firm or a person not in that firm, so a 404; 23505 a taken email. */
  const peopleQuery = async (sql: string, params: unknown[]) => {
    try {
      return await query(sql, params);
    } catch (e: any) {
      if (e?.code === 'P0002') throw new ApiError(404, 'NOT_FOUND', String(e.message || 'Not found.'));
      if (e?.code === '23505') throw new ApiError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists.', [{ field: 'work_email', code: 'duplicate' }]);
      throw e;
    }
  };
  const firmIdOf = (req: FastifyRequest) => {
    const id = (req.params as { id?: string }).id;
    if (!isUuid(id)) throw notFound('Firm');
    return id as string;
  };
  const personIdOf = (req: FastifyRequest) => {
    const id = (req.params as { personId?: string }).personId;
    if (!isUuid(id)) throw notFound('Person');
    return id as string;
  };
  const onePerson = async (tokenHash: string, firmId: string, personId: string) => {
    const r = (await peopleQuery('select * from platform_firm_people($1, $2, $3)', [tokenHash, firmId, personId])).rows[0];
    if (!r) throw notFound('Person');
    return personOf(r);
  };
  const typesOf = (v: unknown) => {
    if (!Array.isArray(v) || v.length === 0) throw invalid('account_types', 'Choose at least one account type.', 'required');
    const bad = v.filter((t) => typeof t !== 'string' || !ACCOUNT_TYPES.includes(t));
    if (bad.length) throw new ApiError(400, 'VALIDATION', 'Unknown account type.', [{ field: 'account_types', code: 'unknown', values: bad }]);
    return ACCOUNT_TYPES.filter((t) => v.includes(t));
  };

  app.get('/api/v1/platform/firms/:id/people', secured, async (req) => {
    const rows = (await peopleQuery('select * from platform_firm_people($1, $2)', [adminOf(req).tokenHash, firmIdOf(req)])).rows;
    return { data: rows.map(personOf) };
  });

  app.post('/api/v1/platform/firms/:id/people', secured, async (req) => {
    const admin = adminOf(req);
    const firmId = firmIdOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = str(body.name);
    const email = str(body.work_email).toLowerCase();
    const jobTitle = str(body.job_title);
    const details: { field: string; code: string }[] = [];
    if (!name) details.push({ field: 'name', code: 'required' });
    if (!EMAIL.test(email)) details.push({ field: 'work_email', code: 'invalid' });
    if (name.length > 200) details.push({ field: 'name', code: 'too_long' });
    if (jobTitle.length > 200) details.push({ field: 'job_title', code: 'too_long' });
    if (details.length) throw new ApiError(400, 'VALIDATION', 'Some details are missing or not valid.', details);
    const types = typesOf(body.account_types);
    const token = newToken();
    const row = (await peopleQuery('select * from platform_create_person($1, $2, $3, $4, $5, $6, $7)',
      [admin.tokenHash, firmId, name, email, jobTitle, types, hashToken(token)])).rows[0];
    const person = await onePerson(admin.tokenHash, firmId, row.person_id);
    return { person, invite_url: `/accept-invite/${token}`, invite_expires_at: iso(row.invite_expires_at), email_sent: false };
  });

  /** A 24-hour password reset link, for an accepted, enabled account. Earlier unused reset links stop working. */
  app.post('/api/v1/platform/firms/:id/people/:personId/reset-link', secured, async (req) => {
    const admin = adminOf(req);
    const firmId = firmIdOf(req);
    const personId = personIdOf(req);
    const token = newToken();
    const r = (await peopleQuery('select platform_issue_reset_link($1, $2, $3, $4) as expires_at', [admin.tokenHash, firmId, personId, hashToken(token)])).rows[0];
    return { reset_url: `/reset-password/${token}`, expires_at: iso(r.expires_at), email_sent: false };
  });

  /** A new 72-hour invite link, while the person has not accepted. Earlier unused invite links stop working. */
  app.post('/api/v1/platform/firms/:id/people/:personId/invite-link', secured, async (req) => {
    const admin = adminOf(req);
    const firmId = firmIdOf(req);
    const personId = personIdOf(req);
    const token = newToken();
    const r = (await peopleQuery('select platform_issue_invite_link($1, $2, $3, $4) as expires_at', [admin.tokenHash, firmId, personId, hashToken(token)])).rows[0];
    return { invite_url: `/accept-invite/${token}`, invite_expires_at: iso(r.expires_at), email_sent: false };
  });

  app.put('/api/v1/platform/firms/:id/people/:personId/types', secured, async (req) => {
    const admin = adminOf(req);
    const firmId = firmIdOf(req);
    const personId = personIdOf(req);
    const types = typesOf((req.body as any)?.account_types);
    const reason = reasonOf(req.body);
    await peopleQuery('select platform_set_account_types($1, $2, $3, $4, $5)', [admin.tokenHash, firmId, personId, types, reason]);
    return { person: await onePerson(admin.tokenHash, firmId, personId) };
  });

  const setAccess = (enabled: boolean) => async (req: FastifyRequest) => {
    const admin = adminOf(req);
    const firmId = firmIdOf(req);
    const personId = personIdOf(req);
    const reason = reasonOf(req.body);
    await peopleQuery('select platform_set_person_access($1, $2, $3, $4, $5)', [admin.tokenHash, firmId, personId, enabled, reason]);
    return { person: await onePerson(admin.tokenHash, firmId, personId) };
  };
  app.post('/api/v1/platform/firms/:id/people/:personId/disable', secured, setAccess(false));
  app.post('/api/v1/platform/firms/:id/people/:personId/enable', secured, setAccess(true));

  // ----- Platform audit -----
  app.get('/api/v1/platform/audit', secured, async (req) => {
    const rows = (await query('select * from platform_audit_list($1)', [adminOf(req).tokenHash])).rows;
    return {
      data: rows.map((r) => ({
        id: r.id, at: iso(r.at), admin_name: r.admin_name ?? null, action: r.action,
        firm_id: r.firm_id ?? null, firm_name: r.firm_name ?? null, reason: r.reason ?? null,
      })),
    };
  });
}
