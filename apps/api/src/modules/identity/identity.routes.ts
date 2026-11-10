import { hash, verify } from '@node-rs/argon2';
import { isSensitiveCapability, isSensitiveSet, type PermissionSetKey, PERMISSION_SETS } from '@ams/domain';
import { ApiError, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize, can } from '../../auth/authorize';
import { hashToken, newToken } from '../../auth/sessions';
import { list, money } from '../../http/responses';
import { isUuid, required, uuidParam } from '../../http/validation';
import { withFirm } from '../../db/pool';
import { SESSION_COOKIE } from '../../auth/sessions';
import type { Api } from '../../http/api';
import { assertPassword, revokeOpenLinks } from '../accounts/accounts.routes';

const SESSION_DAYS = 14;
const DUMMY_HASH = hash('not-a-real-password');

export function authRoutes(api: Api, opts: { secureCookie?: boolean }) {
  const { app, pool, get, post } = api;

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    required(body, ['email', 'password']);
    const p = (await pool.query('select * from auth_find_person($1)', [body.email])).rows[0];
    // Verify even for an unknown email, so timing does not reveal who has an account.
    const ok = await verify(p?.password_hash ?? await DUMMY_HASH, body.password!).catch(() => false);
    if (!p || !ok || p.login_state !== 'Enabled') throw new ApiError(401, 'INVALID_CREDENTIALS', 'That email and password do not match.');
    const token = newToken();
    await withFirm(pool, p.firm_id, async (tx) => {
      await tx.query(
        `insert into session (firm_id, person_id, token_hash, expires_at, created_by) values ($1,$2,$3, now() + interval '${SESSION_DAYS} days', $2)`,
        [p.firm_id, p.person_id, hashToken(token)],
      );
      await audit(tx, { id: p.person_id, firmId: p.firm_id }, p.firm_id, { recordType: 'person', recordId: p.person_id, action: 'login' });
    });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: !!opts.secureCookie, maxAge: SESSION_DAYS * 86400 });
    return { ok: true };
  });

  post('/auth/logout', async ({ tx, actor, reply }) => {
    await tx.query('update session set revoked_at = now() where id = $1', [actor.sessionId]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  get('/me', async ({ tx, actor }) => {
    const firm = (await tx.query('select id, trading_name, legal_name, currency, timezone, accounting_adapter from firm')).rows[0];
    const me = (await tx.query('select id, ref_code, name, work_email, job_title, manager_id from person where id = $1', [actor.id])).rows[0];
    return { person: me, firm, permission_sets: actor.sets, capabilities: actor.caps, led_projects: actor.ledProjects, member_projects: actor.memberProjects };
  });

  // Signed-in password change. Every other session of this person is revoked; this one stays.
  post('/me/password', async ({ tx, actor, firmId, body }) => {
    required(body, ['current_password', 'new_password']);
    if (typeof body.current_password !== 'string') throw new ApiError(400, 'VALIDATION', 'Enter your current password.', [{ field: 'current_password', code: 'required' }]);
    assertPassword(body.new_password, 'new_password');
    const row = (await tx.query('select password_hash from person where id = $1', [actor.id])).rows[0];
    const ok = row?.password_hash ? await verify(row.password_hash, body.current_password).catch(() => false) : false;
    if (!ok) throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is not correct.', [{ field: 'current_password', code: 'mismatch' }]);
    if (body.new_password === body.current_password) throw new ApiError(400, 'VALIDATION', 'Choose a password different from your current one.', [{ field: 'new_password', code: 'unchanged' }]);
    await tx.query('update person set password_hash = $2, updated_at = now(), updated_by = $1 where id = $1', [actor.id, await hash(body.new_password)]);
    const revoked = await tx.query('update session set revoked_at = now(), updated_at = now(), updated_by = $1 where person_id = $1 and id <> $2 and revoked_at is null', [actor.id, actor.sessionId]);
    // An unused reset link would otherwise still override the password the person just chose.
    await tx.query('update password_reset_token set revoked_at = now(), updated_at = now(), updated_by = $1 where person_id = $1 and used_at is null and revoked_at is null', [actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'person', recordId: actor.id, action: 'change_password', next: { sessions_revoked: revoked.rowCount ?? 0 } });
    return { ok: true, sessions_revoked: revoked.rowCount ?? 0, audit_event_id };
  });

  get('/people', async ({ tx, actor, req }) => {
    authorize(actor, 'people.view', { read: true });
    const rows = (await tx.query(
      `select p.id, p.ref_code, p.name, p.job_title, p.manager_id, p.employment_state, p.login_state from person p order by p.ref_code`,
    )).rows;
    return list(req, rows);
  });

  // ----- Grants: AT-02. A refusal is itself audited, so it is committed even though the request fails. -----
  post('/people/:id/grants', async ({ tx, actor, firmId, body, params }) => {
    const personId = uuidParam(params.id, 'Person');
    const { permission_set: setKey, capability, scope_type = 'firm', scope_id, reason } = body as { permission_set?: string; capability?: string; scope_type?: 'firm' | 'project'; scope_id?: string; reason?: string };
    if (!!setKey === !!capability) throw new ApiError(400, 'VALIDATION', 'Send either permission_set or capability.', [{ field: 'permission_set', code: 'one_of' }]);
    if (setKey && !PERMISSION_SETS.includes(setKey as PermissionSetKey)) throw new ApiError(400, 'VALIDATION', 'Unknown permission set.', [{ field: 'permission_set', code: 'unknown' }]);
    const sensitive = setKey ? isSensitiveSet(setKey as PermissionSetKey) : isSensitiveCapability(capability!);
    const refuse = async (message: string, cap: string) => {
      await withFirm(pool, firmId, (w) => audit(w, actor, firmId, {
        recordType: 'permission_grant', recordId: personId, action: 'grant_refused', next: { permission_set: setKey, capability }, reason: message, sensitive: false,
      }));
      throw new ApiError(403, 'FORBIDDEN_CAPABILITY', message, [], { capability: cap });
    };
    if (sensitive && personId === actor.id) await refuse('Sensitive permissions cannot be granted to yourself.', 'permissions.grant.sensitive');
    if (sensitive && !can(actor, 'permissions.grant.sensitive')) await refuse('Only a principal can grant sensitive permissions.', 'permissions.grant.sensitive');
    if (!can(actor, 'permissions.grant.ordinary')) await refuse('You cannot grant permissions.', 'permissions.grant.ordinary');
    // Spec 5 line 212: a single capability (a G cell) needs an explicit grant by a principal, and nobody grants one to themselves.
    if (capability && personId === actor.id) await refuse('Capabilities cannot be granted to yourself.', 'permissions.grant.sensitive');
    if (capability && !can(actor, 'permissions.grant.sensitive')) await refuse('Only a principal can grant a single capability.', 'permissions.grant.sensitive');
    const target = (await tx.query('select id from person where id = $1', [personId])).rows[0];
    if (!target) throw notFound('Person');
    const setId = setKey ? (await tx.query('select id from permission_set where key = $1', [setKey])).rows[0]?.id : null;
    const row = (await tx.query(
      `insert into permission_grant (firm_id, person_id, permission_set_id, capability, scope_type, scope_id, granted_by, reason, sensitive, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7) returning id`,
      [firmId, personId, setId, capability ?? null, scope_type, scope_id ?? null, actor.id, reason ?? null, sensitive],
    )).rows[0];
    // Same rule as PUT /accounts/:id/types: an open invite or reset link may be held by a non-principal, so once the
    // account holds a sensitive grant those links stop working.
    if (sensitive) await revokeOpenLinks(tx, personId, actor.id);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'permission_grant', recordId: row.id, action: 'grant', next: { person_id: personId, permission_set: setKey, capability, scope_type, scope_id }, reason });
    return { id: row.id, audit_event_id };
  });

  // Section 5.3 rules 7 and 8.
  post('/people/:id/revoke-access', async ({ tx, actor, firmId, params }) => {
    authorize(actor, 'people.manage');
    const personId = uuidParam(params.id, 'Person');
    const isPrincipal = (await tx.query(
      `select 1 from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 and s.key = 'principal'`, [personId],
    )).rowCount;
    if (isPrincipal) {
      const others = (await tx.query(
        `select count(distinct g.person_id)::int n from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id
         where s.key = 'principal' and p.login_state = 'Enabled' and g.person_id <> $1`, [personId],
      )).rows[0].n;
      if (!others) throw ruleError('5.3.8', 'The last principal cannot lose access until another is assigned.');
    }
    const r = await tx.query(`update person set login_state = 'Revoked', updated_by = $2, updated_at = now() where id = $1 returning id`, [personId, actor.id]);
    if (!r.rowCount) throw notFound('Person');
    await tx.query('update session set revoked_at = now() where person_id = $1 and revoked_at is null', [personId]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'person', recordId: personId, action: 'revoke_access', next: { login_state: 'Revoked' } });
    return { ok: true, audit_event_id };
  });

  // ----- Rates: append-only and effective-dated (R13). Cost rates are fenced by the serializer as well as here. -----
  get('/people/:id/rates', async ({ tx, actor, params, query, req }) => {
    const personId = uuidParam(params.id, 'Person');
    if (!can(actor, 'rates.bill.manage') && !can(actor, 'rates.cost.view')) authorize(actor, 'rates.bill.manage');
    const asOf = query.as_of as string | undefined;
    const rows = (await tx.query(
      `select id, project_id, rate_type, amount, effective_from, effective_to, change_reason from rate_schedule
       where person_id = $1 and ($2::date is null or (effective_from <= $2 and (effective_to is null or effective_to >= $2))) order by rate_type, effective_from`,
      [personId, asOf ?? null],
    )).rows;
    const costOk = actor.caps['rates.cost.view'] === 'firm';
    return list(req, rows.filter((r) => r.rate_type === 'bill' || costOk).map((r) => ({
      id: r.id, project_id: r.project_id, rate_type: r.rate_type, effective_from: r.effective_from, effective_to: r.effective_to, change_reason: r.change_reason,
      ...(r.rate_type === 'cost' ? { cost_rate: money(r.amount) } : { amount: money(r.amount) }),
    })));
  });

  post('/rates', async ({ tx, actor, firmId, body }) => {
    required(body, ['person_id', 'rate_type', 'amount', 'effective_from', 'change_reason']);
    authorize(actor, body.rate_type === 'cost' ? 'rates.cost.manage' : 'rates.bill.manage', { projectId: body.project_id });
    // Validate references first: an unknown id (or another firm's, which RLS hides) is a 404, never a foreign-key 500.
    if (!['bill', 'cost'].includes(body.rate_type)) throw new ApiError(400, 'VALIDATION', 'A rate is a bill rate or a cost rate.', [{ field: 'rate_type', code: 'enum' }]);
    if (!isUuid(body.person_id) || !(await tx.query('select 1 from person where id = $1', [body.person_id])).rowCount) throw notFound('Person');
    if (body.project_id != null && (!isUuid(body.project_id) || !(await tx.query('select 1 from project where id = $1', [body.project_id])).rowCount)) throw notFound('Project');
    // Close the version in force the day before. Past versions are never rewritten.
    const prev = (await tx.query(
      `update rate_schedule set effective_to = $4::date - 1, updated_by = $5, updated_at = now()
       where person_id = $1 and rate_type = $2 and project_id is not distinct from $3 and effective_to is null and effective_from < $4 returning id, amount`,
      [body.person_id, body.rate_type, body.project_id ?? null, body.effective_from, actor.id],
    )).rows[0];
    const row = (await tx.query(
      `insert into rate_schedule (firm_id, person_id, project_id, rate_type, amount, effective_from, change_reason, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [firmId, body.person_id, body.project_id ?? null, body.rate_type, body.amount, body.effective_from, body.change_reason, actor.id],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'rate_schedule', recordId: row.id, action: 'create', previous: prev ? { amount: prev.amount } : undefined,
      next: { amount: body.amount, effective_from: body.effective_from }, reason: body.change_reason, sensitive: body.rate_type === 'cost',
    });
    return { id: row.id, audit_event_id };
  });

  // Sensitive values are stored, and shown as restricted to anyone without the matching capability (AC-F17-2).
  // The platform admin is not a person in the firm: its rows (no actor_id, action platform_*) show "Platform admin".
  get('/audit', async ({ tx, actor, query, req }) => {
    authorize(actor, 'audit.view');
    const rows = (await tx.query(
      `select a.id, a.at, a.record_type, a.record_id, a.action, a.previous, a.new, a.reason, a.sensitive,
         coalesce(p.name, case when a.actor_id is null and a.action like 'platform\\_%' then 'Platform admin' end) as actor
       from audit_event a left join person p on p.id = a.actor_id
       where ($1::text is null or a.record_type = $1) and ($2::text is null or a.record_id = $2) order by a.at desc limit 500`,
      [query.record_type ?? null, query.record_id ?? null],
    )).rows;
    const open = actor.caps['rates.cost.view'] === 'firm';
    return list(req, rows.map((r) => (r.sensitive && !open ? { ...r, previous: r.previous ? { restricted: true } : null, new: r.new ? { restricted: true } : null } : r)));
  });

  get('/notifications', async ({ tx, actor, req }) => {
    const rows = (await tx.query(
      `select id, event_type, text, record_type, record_id, created_at, read_at from notification where person_id = $1 and resolved_at is null order by created_at desc limit 100`, [actor.id],
    )).rows;
    return list(req, rows);
  });
  post('/notifications/read-all', async ({ tx, actor }) => {
    await tx.query('update notification set read_at = now() where person_id = $1 and read_at is null', [actor.id]);
    return { ok: true };
  });
}
