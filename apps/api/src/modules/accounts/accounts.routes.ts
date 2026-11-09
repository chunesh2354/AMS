import { hash } from '@node-rs/argon2';
import type { PermissionSetKey } from '@ams/domain';
import { ApiError, conflict, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize, can } from '../../auth/authorize';
import { hashToken, newToken } from '../../auth/sessions';
import { list } from '../../http/responses';
import { required, uuidParam } from '../../http/validation';
import { withFirm, type Tx } from '../../db/pool';
import type { Actor } from '../../auth/actor';
import { SESSION_COOKIE } from '../../auth/sessions';
import type { Api } from '../../http/api';

/** The agreed account types and the permission set each one grants. A person may hold several. */
export const ACCOUNT_TYPES = ['principal', 'admin', 'finance', 'pm', 'employee'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const TYPE_TO_SET: Record<AccountType, PermissionSetKey> = { principal: 'principal', admin: 'operations', finance: 'finance', pm: 'pm', employee: 'staff' };
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = { principal: 'Principal', admin: 'Admin', finance: 'Finance', pm: 'Project manager', employee: 'Employee' };
/** Granting or taking away these needs permissions.grant.sensitive. */
const SENSITIVE_TYPES: AccountType[] = ['principal', 'finance'];
const SET_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_SET).map(([t, s]) => [s, t])) as Record<string, AccountType>;

const INVITE_HOURS = 72;
const SESSION_DAYS = 14;
/** Shared with accept-invite, reset and change-password so every path asks for the same length. */
export const MIN_PASSWORD = 12;
const RESET_HOURS = 24;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inviteUrl = (token: string) => `/accept-invite/${token}`;
const resetUrl = (token: string) => `/reset-password/${token}`;

/** 400 unless the password is a string of MIN_PASSWORD to 1024 characters. */
export function assertPassword(v: unknown, field = 'password'): asserts v is string {
  if (typeof v !== 'string' || v.length < MIN_PASSWORD || v.length > 1024) {
    throw new ApiError(400, 'VALIDATION', `Use a password of at least ${MIN_PASSWORD} characters.`, [{ field, code: 'min_length', min: MIN_PASSWORD }]);
  }
}
const sortTypes = (types: Iterable<AccountType>) => ACCOUNT_TYPES.filter((t) => new Set(types).has(t));

function parseTypes(v: unknown): AccountType[] {
  if (!Array.isArray(v) || v.length === 0) throw new ApiError(400, 'VALIDATION', 'Choose at least one account type.', [{ field: 'account_types', code: 'required' }]);
  const bad = v.filter((t) => !ACCOUNT_TYPES.includes(t as AccountType));
  if (bad.length) throw new ApiError(400, 'VALIDATION', 'Unknown account type.', [{ field: 'account_types', code: 'unknown', values: bad }]);
  return sortTypes(v as AccountType[]);
}

async function currentTypes(tx: Tx, personId: string): Promise<AccountType[]> {
  const rows = (await tx.query(
    `select distinct s.key from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1`, [personId],
  )).rows;
  return sortTypes(rows.map((r) => SET_TO_TYPE[r.key]).filter(Boolean));
}

/** Section 5.3 rule 8: the last active principal keeps principal and keeps access. */
async function assertNotLastPrincipal(tx: Tx, personId: string) {
  const others = (await tx.query(
    `select count(distinct g.person_id)::int n from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id
     where s.key = 'principal' and p.login_state = 'Enabled' and p.employment_state <> 'Ended' and p.invitation_state = 'Accepted' and g.person_id <> $1`, [personId],
  )).rows[0].n;
  if (!others) throw ruleError('5.3.8', 'The last principal cannot lose principal or access until another is assigned.');
}

async function issueInvite(tx: Tx, firmId: string, personId: string, actorId: string) {
  const token = newToken();
  await tx.query('update invitation_token set revoked_at = now(), updated_at = now(), updated_by = $2 where person_id = $1 and used_at is null and revoked_at is null', [personId, actorId]);
  const row = (await tx.query(
    `insert into invitation_token (firm_id, person_id, token_hash, expires_at, created_by) values ($1,$2,$3, now() + interval '${INVITE_HOURS} hours', $4) returning expires_at`,
    [firmId, personId, hashToken(token), actorId],
  )).rows[0];
  await tx.query(`update person set invitation_state = 'Sent', updated_at = now(), updated_by = $2 where id = $1`, [personId, actorId]);
  return { invite_url: inviteUrl(token), invite_expires_at: row.expires_at as Date, email_sent: false as const };
}

async function revokeResetLinks(tx: Tx, personId: string, actorId: string) {
  await tx.query('update password_reset_token set revoked_at = now(), updated_at = now(), updated_by = $2 where person_id = $1 and used_at is null and revoked_at is null', [personId, actorId]);
}

export function accountRoutes(api: Api, opts: { secureCookie?: boolean } = {}) {
  const { app, pool, get, post, put } = api;

  /** Same rule as grants in auth.ts: the refusal is audited in its own committed transaction, then 403. */
  const refuse = async (actor: Actor, firmId: string, personId: string | null, message: string, next: unknown) => {
    await withFirm(pool, firmId, (w) => audit(w, actor, firmId, { recordType: 'person', recordId: personId, action: 'grant_refused', next, reason: message }));
    throw new ApiError(403, 'FORBIDDEN_CAPABILITY', message, [], { capability: 'permissions.grant.sensitive' });
  };

  get('/accounts', async ({ tx, actor, req }) => {
    authorize(actor, 'people.manage');
    const rows = (await tx.query(
      `select p.id, p.ref_code, p.name, p.work_email, p.job_title, p.manager_id, p.login_state, p.employment_state, p.created_at,
         case when p.invitation_state = 'Sent' and not exists (
           select 1 from invitation_token t where t.person_id = p.id and t.used_at is null and t.revoked_at is null and t.expires_at > now()
         ) then 'Expired' else p.invitation_state end as invitation_state,
         coalesce(array_agg(distinct s.key) filter (where s.key is not null), '{}') as set_keys
       from person p
       left join permission_grant g on g.person_id = p.id and g.permission_set_id is not null
       left join permission_set s on s.id = g.permission_set_id
       group by p.id order by p.ref_code`,
    )).rows;
    return list(req, rows.map(({ set_keys, ...r }) => ({
      id: r.id, ref_code: r.ref_code, name: r.name, work_email: r.work_email, job_title: r.job_title, manager_id: r.manager_id,
      account_types: sortTypes((set_keys as string[]).map((k) => SET_TO_TYPE[k]).filter(Boolean)),
      invitation_state: r.invitation_state, login_state: r.login_state, employment_state: r.employment_state, created_at: r.created_at,
    })));
  });

  post('/accounts', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'people.manage');
    required(body, ['name', 'work_email', 'job_title', 'account_types']);
    const name = String(body.name).trim();
    const email = String(body.work_email).trim();
    const jobTitle = String(body.job_title).trim();
    if (!name) throw new ApiError(400, 'VALIDATION', 'Name is required.', [{ field: 'name', code: 'required' }]);
    if (!jobTitle) throw new ApiError(400, 'VALIDATION', 'Job title is required.', [{ field: 'job_title', code: 'required' }]);
    if (!EMAIL.test(email)) throw new ApiError(400, 'VALIDATION', 'Enter a valid work email.', [{ field: 'work_email', code: 'email' }]);
    const types = parseTypes(body.account_types);
    if (types.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, null, 'Only a principal can create principal or finance accounts.', { work_email: email, account_types: types });
    }
    let managerId: string | null = null;
    if (body.manager_id) {
      managerId = uuidParam(body.manager_id, 'Manager');
      if (!(await tx.query('select 1 from person where id = $1', [managerId])).rowCount) throw new ApiError(400, 'VALIDATION', 'That manager is not in this firm.', [{ field: 'manager_id', code: 'unknown' }]);
    }
    // Email is unique across every firm. auth_find_person sees past the firm policy; the unique index is the backstop.
    if ((await tx.query('select 1 from auth_find_person($1)', [email])).rowCount) throw conflict('DUPLICATE_EMAIL', 'An account with this email already exists.');

    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`person_ref:${firmId}`]);
    const next = (await tx.query(`select coalesce(max(substring(ref_code from '^P(\\d+)$')::int), 0) + 1 as n from person where ref_code ~ '^P\\d+$'`)).rows[0].n as number;
    const refCode = `P${String(next).padStart(2, '0')}`;
    let person: { id: string };
    try {
      person = (await tx.query(
        `insert into person (firm_id, ref_code, name, work_email, job_title, manager_id, employment_state, login_state, invitation_state, created_by)
         values ($1,$2,$3,$4,$5,$6,'Active','Enabled','Sent',$7) returning id`,
        [firmId, refCode, name, email, jobTitle, managerId, actor.id],
      )).rows[0];
    } catch (e: any) {
      if (e?.code === '23505' && e?.constraint === 'person_email_unique') throw conflict('DUPLICATE_EMAIL', 'An account with this email already exists.');
      throw e;
    }
    for (const t of types) {
      await tx.query(
        `insert into permission_grant (firm_id, person_id, permission_set_id, scope_type, granted_by, reason, sensitive, created_by)
         select $1, $2, s.id, 'firm', $3, 'Account type', $4, $3 from permission_set s where s.key = $5`,
        [firmId, person.id, actor.id, SENSITIVE_TYPES.includes(t), TYPE_TO_SET[t]],
      );
    }
    const invite = await issueInvite(tx, firmId, person.id, actor.id);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'person', recordId: person.id, action: 'create_account',
      next: { ref_code: refCode, name, work_email: email, job_title: jobTitle, manager_id: managerId, account_types: types, invitation_state: 'Sent' },
    });
    return { id: person.id, ref_code: refCode, ...invite, audit_event_id };
  });

  put('/accounts/:id/types', async ({ tx, actor, firmId, body, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Account');
    const types = parseTypes(body.account_types);
    if (!(await tx.query('select 1 from person where id = $1', [personId])).rowCount) throw notFound('Account');
    const before = await currentTypes(tx, personId);
    const added = types.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !types.includes(t));
    const next = { account_types: types };
    if (before.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can change the account types of a principal or finance account.', next);
    }
    if (added.some((t) => SENSITIVE_TYPES.includes(t)) && personId === actor.id) await refuse(actor, firmId, personId, 'Sensitive account types cannot be given to yourself.', next);
    if ([...added, ...removed].some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can give or take away principal or finance.', next);
    }
    if (removed.includes('principal')) await assertNotLastPrincipal(tx, personId);
    if (removed.length) {
      await tx.query(
        `delete from permission_grant where person_id = $1 and permission_set_id in (select id from permission_set where key = any($2::text[]))`,
        [personId, removed.map((t) => TYPE_TO_SET[t])],
      );
    }
    for (const t of added) {
      await tx.query(
        `insert into permission_grant (firm_id, person_id, permission_set_id, scope_type, granted_by, reason, sensitive, created_by)
         select $1, $2, s.id, 'firm', $3, 'Account type', $4, $3 from permission_set s where s.key = $5`,
        [firmId, personId, actor.id, SENSITIVE_TYPES.includes(t), TYPE_TO_SET[t]],
      );
    }
    // An unused invite link may be held by a non-principal; once the account becomes sensitive, that link must stop working.
    if (added.some((t) => SENSITIVE_TYPES.includes(t))) {
      await tx.query('update invitation_token set revoked_at = now(), updated_at = now(), updated_by = $2 where person_id = $1 and used_at is null and revoked_at is null', [personId, actor.id]);
      await revokeResetLinks(tx, personId, actor.id);
    }
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'person', recordId: personId, action: 'set_account_types', previous: { account_types: before }, next: { account_types: types, added, removed },
    });
    return { account_types: types, audit_event_id };
  });

  post('/accounts/:id/invite', async ({ tx, actor, firmId, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Account');
    const p = (await tx.query('select id, invitation_state, login_state from person where id = $1', [personId])).rows[0];
    if (!p) throw notFound('Account');
    if (p.invitation_state === 'Accepted') throw conflict('INVITE_ALREADY_ACCEPTED', 'This person has already accepted an invitation.');
    if (p.login_state !== 'Enabled') throw ruleError('accounts.invite', 'Reactivate this account before sending a new invitation.');
    // Whoever holds the link can set the password, so only a principal may hold a link to a principal or finance account.
    const types = await currentTypes(tx, personId);
    if (types.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can invite a principal or finance account.', { action: 'invite' });
    }
    const invite = await issueInvite(tx, firmId, personId, actor.id);
    await audit(tx, actor, firmId, { recordType: 'person', recordId: personId, action: 'reinvite', next: { invitation_state: 'Sent', invite_expires_at: invite.invite_expires_at } });
    return invite;
  });

  post('/accounts/:id/deactivate', async ({ tx, actor, firmId, body, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Account');
    required(body, ['reason']);
    const reason = String(body.reason).trim();
    if (!reason) throw new ApiError(400, 'VALIDATION', 'A reason is required.', [{ field: 'reason', code: 'required' }]);
    const p = (await tx.query('select login_state, employment_state from person where id = $1 for update', [personId])).rows[0];
    if (!p) throw notFound('Account');
    if (personId === actor.id) throw ruleError('accounts.deactivate', 'You cannot deactivate your own account. Ask another admin or principal.');
    const types = await currentTypes(tx, personId);
    if (types.includes('principal')) await assertNotLastPrincipal(tx, personId);
    if (types.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can deactivate a principal or finance account.', { action: 'deactivate' });
    }
    await tx.query(`update person set login_state = 'Revoked', employment_state = 'Ended', updated_by = $2, updated_at = now() where id = $1`, [personId, actor.id]);
    await tx.query('update session set revoked_at = now(), updated_at = now(), updated_by = $2 where person_id = $1 and revoked_at is null', [personId, actor.id]);
    await tx.query('update invitation_token set revoked_at = now(), updated_at = now(), updated_by = $2 where person_id = $1 and used_at is null and revoked_at is null', [personId, actor.id]);
    await revokeResetLinks(tx, personId, actor.id);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'person', recordId: personId, action: 'deactivate', reason,
      previous: { login_state: p.login_state, employment_state: p.employment_state }, next: { login_state: 'Revoked', employment_state: 'Ended' },
    });
    return { ok: true, login_state: 'Revoked', employment_state: 'Ended', audit_event_id };
  });

  post('/accounts/:id/reactivate', async ({ tx, actor, firmId, body, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Account');
    const p = (await tx.query('select login_state, employment_state from person where id = $1 for update', [personId])).rows[0];
    if (!p) throw notFound('Account');
    // Reactivating restores every grant the person still holds, so only a principal may bring back a principal or finance account.
    const types = await currentTypes(tx, personId);
    if (types.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can reactivate a principal or finance account.', { action: 'reactivate' });
    }
    await tx.query(`update person set login_state = 'Enabled', employment_state = 'Active', updated_by = $2, updated_at = now() where id = $1`, [personId, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'person', recordId: personId, action: 'reactivate', reason: typeof body.reason === 'string' ? body.reason : undefined,
      previous: { login_state: p.login_state, employment_state: p.employment_state }, next: { login_state: 'Enabled', employment_state: 'Active' },
    });
    return { ok: true, login_state: 'Enabled', employment_state: 'Active', audit_event_id };
  });

  // ----- Password reset link. Whoever holds it can set the password, so the same sensitive rule as deactivate applies. -----
  post('/accounts/:id/reset-link', async ({ tx, actor, firmId, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Account');
    const p = (await tx.query('select id, invitation_state, login_state from person where id = $1', [personId])).rows[0];
    if (!p) throw notFound('Account');
    const types = await currentTypes(tx, personId);
    if (types.some((t) => SENSITIVE_TYPES.includes(t)) && !can(actor, 'permissions.grant.sensitive')) {
      await refuse(actor, firmId, personId, 'Only a principal can reset the password of a principal or finance account.', { action: 'reset_link' });
    }
    if (p.invitation_state !== 'Accepted') throw ruleError('accounts.reset', 'This person has not accepted their invitation yet. Send a new invitation instead.');
    if (p.login_state !== 'Enabled') throw ruleError('accounts.reset', 'Reactivate this account before issuing a password reset link.');
    await revokeResetLinks(tx, personId, actor.id);
    const token = newToken();
    const row = (await tx.query(
      `insert into password_reset_token (firm_id, person_id, token_hash, expires_at, created_by, updated_by) values ($1,$2,$3, now() + interval '${RESET_HOURS} hours', $4, $4) returning expires_at`,
      [firmId, personId, hashToken(token), actor.id],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'person', recordId: personId, action: 'issue_reset_link', next: { expires_at: row.expires_at } });
    return { reset_url: resetUrl(token), expires_at: row.expires_at as Date, email_sent: false as const, audit_event_id };
  });

  // ----- Public reset flow (app.ts lets /api/v1/auth/reset/ through without a session: the token is the credential). -----

  const resetGone = () => new ApiError(410, 'RESET_EXPIRED', 'This reset link has expired or was already used. Ask your studio admin for a new one.');
  const findReset = async (token: unknown) => {
    if (typeof token !== 'string' || !token || token.length > 200) throw notFound('Reset link');
    const r = (await pool.query('select * from auth_find_reset($1)', [hashToken(token)])).rows[0];
    if (!r) throw notFound('Reset link');
    if (r.used_at || r.revoked_at || new Date(r.expires_at) <= new Date()) throw resetGone();
    return r;
  };

  app.get('/api/v1/auth/reset/:token', async (req) => {
    const r = await findReset((req.params as { token?: string }).token);
    return { name: r.name, firm_name: r.firm_name, expires_at: r.expires_at };
  });

  // Does not sign in: the person signs in with the new password, and every session they had is revoked.
  app.post('/api/v1/auth/reset/:token', async (req) => {
    const token = (req.params as { token?: string }).token;
    const body = (req.body ?? {}) as { password?: unknown };
    required(body as Record<string, unknown>, ['password']);
    assertPassword(body.password);
    await findReset(token);
    const passwordHash = await hash(body.password);
    const done = (await pool.query('select * from auth_reset_password($1, $2)', [hashToken(token as string), passwordHash])).rows[0];
    if (!done) throw resetGone();
    return { ok: true };
  });

  // ----- Public invite flow. Both paths must be in server.ts PUBLIC (the token is the credential). -----

  const findInvite = async (token: unknown) => {
    if (typeof token !== 'string' || !token || token.length > 200) throw notFound('Invitation');
    const inv = (await pool.query('select * from auth_find_invite($1)', [hashToken(token)])).rows[0];
    if (!inv) throw notFound('Invitation');
    if (inv.used_at || inv.revoked_at || new Date(inv.expires_at) <= new Date() || inv.firm_status !== 'Active' || inv.login_state !== 'Enabled') {
      throw new ApiError(410, 'INVITE_EXPIRED', 'This invitation has expired or was already used. Ask your firm for a new one.');
    }
    return inv;
  };

  app.get('/api/v1/auth/invite/:token', async (req) => {
    const inv = await findInvite((req.params as { token?: string }).token);
    return { name: inv.name, work_email: inv.work_email, firm_name: inv.firm_name, expires_at: inv.expires_at };
  });

  app.post('/api/v1/auth/accept-invite', async (req, reply) => {
    const body = (req.body ?? {}) as { token?: unknown; password?: unknown };
    required(body as Record<string, unknown>, ['token', 'password']);
    assertPassword(body.password);
    await findInvite(body.token);
    const passwordHash = await hash(body.password);
    const done = (await pool.query('select * from auth_accept_invite($1, $2)', [hashToken(body.token as string), passwordHash])).rows[0];
    // Someone else used it between the check and now.
    if (!done) throw new ApiError(410, 'INVITE_EXPIRED', 'This invitation has expired or was already used. Ask your firm for a new one.');
    const token = newToken();
    await withFirm(pool, done.firm_id, async (tx) => {
      await tx.query(
        `insert into session (firm_id, person_id, token_hash, expires_at, created_by) values ($1,$2,$3, now() + interval '${SESSION_DAYS} days', $2)`,
        [done.firm_id, done.person_id, hashToken(token)],
      );
      await audit(tx, { id: done.person_id, firmId: done.firm_id }, done.firm_id, { recordType: 'person', recordId: done.person_id, action: 'login' });
    });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: !!opts.secureCookie, maxAge: SESSION_DAYS * 86400 });
    return { ok: true };
  });
}
