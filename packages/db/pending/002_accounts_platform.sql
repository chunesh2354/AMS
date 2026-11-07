-- 002: firm accounts (invitations) and the platform console.
-- Staged in packages/db/pending so a running build does not apply it. Move it to packages/db/migrations to apply.
--
-- Seed note: existing rows, including every demo person in the Meridian seed, get invitation_state 'Accepted'
-- from the column default, so the demo logins keep working unchanged. Only accounts created through
-- POST /api/v1/accounts or platform_create_firm start as 'Sent'.

-- ---------- Firm accounts ----------

alter table person add column invitation_state text not null default 'Accepted'
  check (invitation_state in ('Not sent', 'Sent', 'Accepted', 'Expired'));

-- Only the sha256 of a token is stored. 72 hours, single use; a new invite revokes the previous one.
create table invitation_token (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
select ams_base('invitation_token');
create index invitation_token_person on invitation_token (person_id);
alter table invitation_token enable row level security;
create policy firm_isolation on invitation_token
  using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
grant select, insert, update, delete on invitation_token to ams_app;

-- ---------- Firm status ----------

alter table firm
  add column status text not null default 'Active' check (status in ('Active', 'Suspended')),
  add column suspended_reason text;

-- The application role may update its own firm's settings, never its status: only the platform functions may.
create function firm_status_guard() returns trigger language plpgsql as $$
begin
  if (new.status is distinct from old.status or new.suspended_reason is distinct from old.suspended_reason) and current_user = 'ams_app' then
    raise exception 'A firm''s status is set by the platform only.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger firm_status_guard before update on firm for each row execute function firm_status_guard();

-- ---------- Platform (no firm_id, no grant to ams_app; reached only through the functions below) ----------

create table platform_admin (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index platform_admin_email_lower on platform_admin (lower(email));

create table platform_session (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references platform_admin(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table platform_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  admin_id uuid references platform_admin(id),
  action text not null,
  firm_id uuid references firm(id),
  reason text,
  detail jsonb
);
create index platform_audit_at on platform_audit (at desc);

-- Row-level security with no policy: even a stray grant would expose nothing.
alter table platform_admin enable row level security;
alter table platform_session enable row level security;
alter table platform_audit enable row level security;
revoke all on platform_admin, platform_session, platform_audit from public;
revoke all on platform_admin, platform_session, platform_audit from ams_app;

-- ---------- Firm auth functions: a suspended firm has no sessions and no logins ----------

create or replace function auth_find_person(p_email text) returns table (person_id uuid, firm_id uuid, password_hash text, login_state text)
  language sql security definer set search_path = public as $$
  select p.id, p.firm_id, p.password_hash, p.login_state from person p join firm f on f.id = p.firm_id
  where lower(p.work_email) = lower(p_email) and f.status = 'Active'
$$;
create or replace function auth_find_session(p_token_hash text) returns table (session_id uuid, person_id uuid, firm_id uuid)
  language sql security definer set search_path = public as $$
  select s.id, s.person_id, s.firm_id from session s join person p on p.id = s.person_id join firm f on f.id = s.firm_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now() and p.login_state = 'Enabled' and f.status = 'Active'
$$;

-- Public invite flow: the token is the only credential, so these are the only way past the firm policy.
create function auth_find_invite(p_token_hash text) returns table (
  person_id uuid, firm_id uuid, name text, work_email text, firm_name text, expires_at timestamptz,
  used_at timestamptz, revoked_at timestamptz, firm_status text, login_state text
) language sql security definer set search_path = public as $$
  select t.person_id, t.firm_id, p.name, p.work_email, f.trading_name, t.expires_at, t.used_at, t.revoked_at, f.status, p.login_state
  from invitation_token t join person p on p.id = t.person_id join firm f on f.id = t.firm_id
  where t.token_hash = p_token_hash
$$;

-- Marks the token used, sets the password and audits, atomically. Returns no row when the token is not usable.
create function auth_accept_invite(p_token_hash text, p_password_hash text) returns table (person_id uuid, firm_id uuid)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_person uuid; v_firm uuid;
begin
  update invitation_token it set used_at = now(), updated_at = now()
    from person p, firm f
    where it.token_hash = p_token_hash and it.used_at is null and it.revoked_at is null and it.expires_at > now()
      and p.id = it.person_id and f.id = it.firm_id and f.status = 'Active' and p.login_state = 'Enabled'
    returning it.person_id, it.firm_id into v_person, v_firm;
  if v_person is null then return; end if;
  update person set password_hash = p_password_hash, invitation_state = 'Accepted', updated_at = now(), updated_by = v_person where id = v_person;
  insert into audit_event (firm_id, actor_id, created_by, record_type, record_id, action, new)
    values (v_firm, v_person, v_person, 'person', v_person::text, 'accept_invite', jsonb_build_object('invitation_state', 'Accepted'));
  person_id := v_person; firm_id := v_firm;
  return next;
end $$;

-- ---------- Platform functions ----------

create function platform_find_admin(p_email text) returns table (id uuid, email text, name text, password_hash text)
  language sql security definer set search_path = public as $$
  select a.id, a.email, a.name, a.password_hash from platform_admin a where lower(a.email) = lower(p_email)
$$;

create function platform_find_session(p_token_hash text) returns table (session_id uuid, admin_id uuid, name text, email text)
  language sql security definer set search_path = public as $$
  select s.id, s.admin_id, a.name, a.email from platform_session s join platform_admin a on a.id = s.admin_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
$$;

create function platform_create_session(p_admin_id uuid, p_token_hash text, p_expires_at timestamptz) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into platform_session (admin_id, token_hash, expires_at) values (p_admin_id, p_token_hash, p_expires_at) returning id into v_id;
  insert into platform_audit (admin_id, action) values (p_admin_id, 'login');
  return v_id;
end $$;

create function platform_revoke_session(p_token_hash text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_admin uuid;
begin
  update platform_session set revoked_at = now() where token_hash = p_token_hash and revoked_at is null returning admin_id into v_admin;
  if v_admin is not null then insert into platform_audit (admin_id, action) values (v_admin, 'logout'); end if;
end $$;

-- Counts only. Never business data (projects, money, time) and never the names of a firm's people.
create function platform_list_firms() returns table (
  id uuid, trading_name text, legal_name text, status text, currency text, timezone text, created_at timestamptz,
  people int, active_people int, last_login_at timestamptz
) language sql security definer set search_path = public as $$
  select f.id, f.trading_name, f.legal_name, f.status, f.currency, f.timezone, f.created_at,
    (select count(*)::int from person p where p.firm_id = f.id),
    (select count(*)::int from person p where p.firm_id = f.id and p.login_state = 'Enabled' and p.employment_state = 'Active'),
    (select max(s.created_at) from session s where s.firm_id = f.id)
  from firm f order by f.trading_name
$$;

-- Creates the firm, its five permission sets, the first principal (P01, invitation Sent) and the invite token.
create function platform_create_firm(
  p_trading_name text, p_legal_name text, p_timezone text, p_currency text, p_owner_name text, p_owner_email text,
  p_token_hash text, p_expires_at timestamptz, p_admin_id uuid
) returns table (firm_id uuid, person_id uuid)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_firm uuid; v_person uuid; v_principal uuid;
begin
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
  insert into invitation_token (firm_id, person_id, token_hash, expires_at) values (v_firm, v_person, p_token_hash, p_expires_at);
  insert into audit_event (firm_id, record_type, record_id, action, new, reason)
    values (v_firm, 'person', v_person::text, 'create_account', jsonb_build_object('ref_code', 'P01', 'account_types', jsonb_build_array('principal')), 'Firm created by the platform');
  insert into platform_audit (admin_id, action, firm_id, detail)
    values (p_admin_id, 'create_firm', v_firm, jsonb_build_object('trading_name', trim(p_trading_name), 'legal_name', trim(p_legal_name)));
  firm_id := v_firm; person_id := v_person;
  return next;
end $$;

create function platform_set_firm_status(p_firm_id uuid, p_status text, p_reason text, p_admin_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_prev text;
begin
  if p_status not in ('Active', 'Suspended') then raise exception 'Status must be Active or Suspended.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  select status into v_prev from firm where id = p_firm_id for update;
  if v_prev is null then raise exception 'Firm not found.' using errcode = 'P0001'; end if;
  update firm set status = p_status, suspended_reason = case when p_status = 'Suspended' then p_reason else null end where id = p_firm_id;
  insert into audit_event (firm_id, record_type, record_id, action, previous, new, reason)
    values (p_firm_id, 'firm', p_firm_id::text, case when p_status = 'Suspended' then 'platform_suspend' else 'platform_reactivate' end,
            jsonb_build_object('status', v_prev), jsonb_build_object('status', p_status), p_reason);
  insert into platform_audit (admin_id, action, firm_id, reason, detail)
    values (p_admin_id, case when p_status = 'Suspended' then 'suspend_firm' else 'reactivate_firm' end, p_firm_id, p_reason,
            jsonb_build_object('previous', v_prev, 'status', p_status));
end $$;

create function platform_audit_list() returns table (id uuid, at timestamptz, admin_name text, action text, firm_id uuid, firm_name text, reason text)
  language sql security definer set search_path = public as $$
  select a.id, a.at, ad.name, a.action, a.firm_id, f.trading_name, a.reason
  from platform_audit a left join platform_admin ad on ad.id = a.admin_id left join firm f on f.id = a.firm_id
  order by a.at desc limit 500
$$;

-- Functions are executable by PUBLIC by default: close that, then open each to the application role only.
revoke all on function auth_find_invite(text) from public;
revoke all on function auth_accept_invite(text, text) from public;
revoke all on function platform_find_admin(text) from public;
revoke all on function platform_find_session(text) from public;
revoke all on function platform_create_session(uuid, text, timestamptz) from public;
revoke all on function platform_revoke_session(text) from public;
revoke all on function platform_list_firms() from public;
revoke all on function platform_create_firm(text, text, text, text, text, text, text, timestamptz, uuid) from public;
revoke all on function platform_set_firm_status(uuid, text, text, uuid) from public;
revoke all on function platform_audit_list() from public;
grant execute on function auth_find_invite(text) to ams_app;
grant execute on function auth_accept_invite(text, text) to ams_app;
grant execute on function platform_find_admin(text) to ams_app;
grant execute on function platform_find_session(text) to ams_app;
grant execute on function platform_create_session(uuid, text, timestamptz) to ams_app;
grant execute on function platform_revoke_session(text) to ams_app;
grant execute on function platform_list_firms() to ams_app;
grant execute on function platform_create_firm(text, text, text, text, text, text, text, timestamptz, uuid) to ams_app;
grant execute on function platform_set_firm_status(uuid, text, text, uuid) to ams_app;
grant execute on function platform_audit_list() to ams_app;
