-- 003: bind every platform action to a live platform session.
--
-- Before this migration the platform SECURITY DEFINER functions (002) trusted a caller-supplied admin id, or no
-- identity at all, and platform_find_admin returned password_hash to the application role. Any SQL running as
-- ams_app could therefore act as any platform admin without a platform session.
--
-- After it:
--   * every function that performs or reads a platform action takes the sha256 of the platform session token and
--     resolves the admin inside SQL from platform_session (not revoked, not expired) joined to platform_admin.
--     An invalid session raises errcode 28000 before anything is read or written;
--   * the old signatures are dropped, so they cannot be called any more;
--   * platform_auth_lookup(email) is the only function that returns a password hash, and returns nothing else
--     but the admin id;
--   * platform_create_session is the only function that accepts an admin id. It writes the login audit row.
--
-- Why this is the minimal exposure with one application role: argon2 verification happens in the API (Postgres has
-- no argon2), so the API must be able to read one admin's hash by email, and must then be able to open a session for
-- the admin it verified. Those two calls are the whole of what ams_app can do without a session. Everything else
-- (create, suspend, reactivate, list firms, read the audit) needs a session token whose hash is in platform_session.
-- Residual risk, stated plainly: SQL running as ams_app that knows an admin's email can still look up the id and
-- open a session for it. That session is capped at 12 hours and leaves a 'login' row in platform_audit. Removing that
-- path entirely needs a separate database role for the platform pool; see docs/architecture.md, Security.

-- ---------- Old signatures out ----------

drop function platform_find_admin(text);
drop function platform_list_firms();
drop function platform_create_firm(text, text, text, text, text, text, text, timestamptz, uuid);
drop function platform_set_firm_status(uuid, text, text, uuid);
drop function platform_audit_list();

-- ---------- Session resolution (internal: not granted to ams_app) ----------

create function platform_session_admin(p_session_token_hash text) returns uuid
  language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid;
begin
  select s.admin_id into v_admin
  from platform_session s join platform_admin a on a.id = s.admin_id
  where s.token_hash = p_session_token_hash and s.revoked_at is null and s.expires_at > now();
  if v_admin is null then
    raise exception 'No valid platform session.' using errcode = '28000';
  end if;
  return v_admin;
end $$;

-- ---------- Login ----------

create function platform_auth_lookup(p_email text) returns table (admin_id uuid, password_hash text)
  language sql stable security definer set search_path = public as $$
  select a.id, a.password_hash from platform_admin a where lower(a.email) = lower(p_email)
$$;

-- Same signature as 002, so the existing grant stands. Now refuses an unknown admin and a session longer than 12 hours.
create or replace function platform_create_session(p_admin_id uuid, p_token_hash text, p_expires_at timestamptz) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from platform_admin where id = p_admin_id) then
    raise exception 'No such platform admin.' using errcode = '28000';
  end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '12 hours' then
    raise exception 'A platform session lasts at most 12 hours.' using errcode = 'P0001';
  end if;
  insert into platform_session (admin_id, token_hash, expires_at) values (p_admin_id, p_token_hash, p_expires_at) returning id into v_id;
  insert into platform_audit (admin_id, action) values (p_admin_id, 'login');
  return v_id;
end $$;

-- ---------- Session-bound platform actions ----------

-- Counts only. Never business data (projects, money, time) and never the names of a firm's people.
create function platform_list_firms(p_session_token_hash text) returns table (
  id uuid, trading_name text, legal_name text, status text, currency text, timezone text, created_at timestamptz,
  people int, active_people int, last_login_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform platform_session_admin(p_session_token_hash);
  return query
  select f.id, f.trading_name, f.legal_name, f.status, f.currency, f.timezone, f.created_at,
    (select count(*)::int from person p where p.firm_id = f.id),
    (select count(*)::int from person p where p.firm_id = f.id and p.login_state = 'Enabled' and p.employment_state = 'Active'),
    (select max(s.created_at) from session s where s.firm_id = f.id)
  from firm f order by f.trading_name;
end $$;

-- Creates the firm, its five permission sets, the first principal (P01, invitation Sent) and the invite token.
create function platform_create_firm(
  p_session_token_hash text,
  p_trading_name text, p_legal_name text, p_timezone text, p_currency text, p_owner_name text, p_owner_email text,
  p_invite_token_hash text, p_invite_expires_at timestamptz
) returns table (firm_id uuid, person_id uuid)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_admin uuid; v_firm uuid; v_person uuid; v_principal uuid;
begin
  v_admin := platform_session_admin(p_session_token_hash);
  if coalesce(trim(p_trading_name), '') = '' or coalesce(trim(p_legal_name), '') = '' or coalesce(trim(p_owner_name), '') = ''
     or coalesce(trim(p_owner_email), '') = '' or coalesce(trim(p_timezone), '') = '' or coalesce(trim(p_currency), '') = '' then
    raise exception 'Every firm field is required.' using errcode = 'P0001';
  end if;
  insert into firm (legal_name, trading_name, timezone, currency) values (trim(p_legal_name), trim(p_trading_name), p_timezone, p_currency) returning id into v_firm;
  insert into permission_set (firm_id, key, name) values
    (v_firm, 'principal', 'Principal'), (v_firm, 'operations', 'Admin'), (v_firm, 'finance', 'Finance'),
    (v_firm, 'pm', 'Project manager'), (v_firm, 'staff', 'Employee');
  select s.id into v_principal from permission_set s where s.firm_id = v_firm and s.key = 'principal';
  insert into person (firm_id, ref_code, name, work_email, job_title, employment_state, login_state, invitation_state)
    values (v_firm, 'P01', trim(p_owner_name), trim(p_owner_email), 'Principal', 'Active', 'Enabled', 'Sent') returning id into v_person;
  insert into permission_grant (firm_id, person_id, permission_set_id, scope_type, reason, sensitive)
    values (v_firm, v_person, v_principal, 'firm', 'Firm created by the platform', true);
  insert into invitation_token (firm_id, person_id, token_hash, expires_at) values (v_firm, v_person, p_invite_token_hash, p_invite_expires_at);
  insert into audit_event (firm_id, record_type, record_id, action, new, reason)
    values (v_firm, 'person', v_person::text, 'create_account', jsonb_build_object('ref_code', 'P01', 'account_types', jsonb_build_array('principal')), 'Firm created by the platform');
  insert into platform_audit (admin_id, action, firm_id, detail)
    values (v_admin, 'create_firm', v_firm, jsonb_build_object('trading_name', trim(p_trading_name), 'legal_name', trim(p_legal_name)));
  firm_id := v_firm; person_id := v_person;
  return next;
end $$;

create function platform_set_firm_status(p_session_token_hash text, p_firm_id uuid, p_status text, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_prev text;
begin
  v_admin := platform_session_admin(p_session_token_hash);
  if p_status not in ('Active', 'Suspended') then raise exception 'Status must be Active or Suspended.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  select status into v_prev from firm where id = p_firm_id for update;
  if v_prev is null then raise exception 'Firm not found.' using errcode = 'P0001'; end if;
  update firm set status = p_status, suspended_reason = case when p_status = 'Suspended' then p_reason else null end where id = p_firm_id;
  insert into audit_event (firm_id, record_type, record_id, action, previous, new, reason)
    values (p_firm_id, 'firm', p_firm_id::text, case when p_status = 'Suspended' then 'platform_suspend' else 'platform_reactivate' end,
            jsonb_build_object('status', v_prev), jsonb_build_object('status', p_status), p_reason);
  insert into platform_audit (admin_id, action, firm_id, reason, detail)
    values (v_admin, case when p_status = 'Suspended' then 'suspend_firm' else 'reactivate_firm' end, p_firm_id, p_reason,
            jsonb_build_object('previous', v_prev, 'status', p_status));
end $$;

create function platform_audit_list(p_session_token_hash text) returns table (id uuid, at timestamptz, admin_name text, action text, firm_id uuid, firm_name text, reason text)
  language plpgsql stable security definer set search_path = public as $$
begin
  perform platform_session_admin(p_session_token_hash);
  return query
  select a.id, a.at, ad.name, a.action, a.firm_id, f.trading_name, a.reason
  from platform_audit a left join platform_admin ad on ad.id = a.admin_id left join firm f on f.id = a.firm_id
  order by a.at desc limit 500;
end $$;

-- ---------- Grants: PUBLIC loses the default execute; ams_app gets exactly the callable surface ----------

revoke all on function platform_session_admin(text) from public;
revoke all on function platform_auth_lookup(text) from public;
revoke all on function platform_list_firms(text) from public;
revoke all on function platform_create_firm(text, text, text, text, text, text, text, text, timestamptz) from public;
revoke all on function platform_set_firm_status(text, uuid, text, text) from public;
revoke all on function platform_audit_list(text) from public;
grant execute on function platform_auth_lookup(text) to ams_app;
grant execute on function platform_list_firms(text) to ams_app;
grant execute on function platform_create_firm(text, text, text, text, text, text, text, text, timestamptz) to ams_app;
grant execute on function platform_set_firm_status(text, uuid, text, text) to ams_app;
grant execute on function platform_audit_list(text) to ams_app;
-- Unchanged from 002 and still granted: platform_find_session(text), platform_create_session(uuid, text, timestamptz),
-- platform_revoke_session(text). None of them returns a password hash.
