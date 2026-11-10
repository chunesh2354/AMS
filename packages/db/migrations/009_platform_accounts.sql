-- 009: the platform admin manages the people inside every studio.
--
-- The owner decided that the platform admin gets full control over a studio's accounts. This ends the "counts only"
-- rule of the platform panel for people and accounts data. Projects, money and time still never cross to the
-- platform side: nothing here reads or returns them.
--
-- Same shape as 003 and 004:
--   * every function takes the sha256 of the platform session token and calls platform_session_admin first, so an
--     invalid session raises 28000 before anything is read or written. None takes an admin id;
--   * search_path is pinned, PUBLIC loses execute, ams_app is granted exactly the callable surface;
--   * nothing returns a password hash. A password changes only through a one-time link (invite or reset): the
--     platform admin never sets or sees a password. Links are stored as the sha256 of the token only.
--   * every action writes a platform_audit row and a firm-side audit_event row. The firm-side row has no actor_id
--     (the platform admin is not a person in the firm); its "new" carries by = 'Platform admin' and the action is
--     prefixed platform_, so the studio can see what the platform did.
--
-- Errors: 28000 no valid platform session; P0002 unknown firm, or a person who is not in that firm (the API answers
-- 404); 23505 an email already in use (409); P0001 a rule (422).

alter table platform_audit add column person_id uuid references person(id);

-- ---------- Internal helpers (not granted to ams_app) ----------

-- The account types a person holds, in the agreed order. The permission set keys map as in accounts.routes.ts.
create function platform_account_types(p_person uuid) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x.t order by x.o), '{}'::text[]) from (
    select distinct
      case s.key when 'principal' then 'principal' when 'operations' then 'admin' when 'finance' then 'finance' when 'pm' then 'pm' else 'employee' end as t,
      case s.key when 'principal' then 1 when 'operations' then 2 when 'finance' then 3 when 'pm' then 4 else 5 end as o
    from permission_grant g join permission_set s on s.id = g.permission_set_id
    where g.person_id = p_person and s.key in ('principal', 'operations', 'finance', 'pm', 'staff')
  ) x
$$;

create function platform_type_set_key(p_type text) returns text
  language sql immutable set search_path = public as $$
  select case p_type when 'principal' then 'principal' when 'admin' then 'operations' when 'finance' then 'finance' when 'pm' then 'pm' when 'employee' then 'staff' end
$$;

-- Distinct, known, at least one, in the agreed order. P0001 otherwise.
create function platform_clean_types(p_types text[]) returns text[]
  language plpgsql immutable set search_path = public as $$
declare v text[];
begin
  if p_types is null or cardinality(p_types) = 0 then raise exception 'Choose at least one account type.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(p_types) t where platform_type_set_key(t) is null) then
    raise exception 'Unknown account type.' using errcode = 'P0001';
  end if;
  select array_agg(t order by array_position(array['principal', 'admin', 'finance', 'pm', 'employee'], t))
    into v from (select distinct t from unnest(p_types) t) d;
  return v;
end $$;

-- The firm exists (P0002 otherwise); returns its status.
create function platform_firm_status_of(p_firm uuid) returns text
  language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select f.status into v from firm f where f.id = p_firm;
  if v is null then raise exception 'Firm was not found.' using errcode = 'P0002'; end if;
  return v;
end $$;

-- The person is in that firm (P0002 otherwise, also for a person of another firm).
create function platform_person_in_firm(p_firm uuid, p_person uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  perform platform_firm_status_of(p_firm);
  if p_person is null or not exists (select 1 from person p where p.id = p_person and p.firm_id = p_firm) then
    raise exception 'Person was not found.' using errcode = 'P0002';
  end if;
end $$;

-- Section 5.3 rule 8, as the firm side applies it: some other principal must still be Enabled, not Ended and Accepted.
create function platform_assert_not_last_principal(p_firm uuid, p_person uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- Two concurrent changes must not both see the other principal and both take it away.
  perform pg_advisory_xact_lock(hashtext('principals:' || p_firm::text));
  if not exists (
    select 1 from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id
    where g.firm_id = p_firm and s.key = 'principal' and p.login_state = 'Enabled' and p.employment_state <> 'Ended'
      and p.invitation_state = 'Accepted' and g.person_id <> p_person
  ) then
    raise exception 'The last principal cannot lose principal or access until another is assigned.' using errcode = 'P0001';
  end if;
end $$;

-- Open invite and reset links of a person stop working.
create function platform_revoke_links(p_person uuid) returns void
  language sql security definer set search_path = public as $$
  update invitation_token set revoked_at = now(), updated_at = now() where person_id = p_person and used_at is null and revoked_at is null;
  update password_reset_token set revoked_at = now(), updated_at = now() where person_id = p_person and used_at is null and revoked_at is null;
$$;

-- Both audit trails for one action on one person. Resolves the admin from the session itself, like every other
-- platform function, so no function here ever takes an admin id.
create function platform_audit_person(p_session_token_hash text, p_firm uuid, p_person uuid, p_action text, p_reason text, p_previous jsonb, p_new jsonb)
  returns void language sql security definer set search_path = public as $$
  insert into audit_event (firm_id, actor_id, created_by, record_type, record_id, action, previous, new, reason)
    values (p_firm, null, null, 'person', p_person::text, 'platform_' || p_action, p_previous,
            coalesce(p_new, '{}'::jsonb) || jsonb_build_object('by', 'Platform admin'), p_reason);
  insert into platform_audit (admin_id, action, firm_id, person_id, reason, detail)
    values (platform_session_admin(p_session_token_hash), p_action, p_firm, p_person, p_reason, coalesce(p_new, '{}'::jsonb) || jsonb_build_object('person_id', p_person));
$$;

-- ---------- Session-bound functions (granted to ams_app) ----------

-- The people of one studio: who they are and how they sign in. Never a password hash, never projects, money or time.
-- p_person narrows it to one person of that firm.
create function platform_firm_people(p_session_token_hash text, p_firm_id uuid, p_person_id uuid default null) returns table (
  id uuid, name text, work_email text, job_title text, account_types text[], invitation_state text, login_state text, last_sign_in_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform platform_session_admin(p_session_token_hash);
  if p_person_id is null then perform platform_firm_status_of(p_firm_id); else perform platform_person_in_firm(p_firm_id, p_person_id); end if;
  return query
  select p.id, p.name, p.work_email, p.job_title, platform_account_types(p.id),
    case
      when p.invitation_state = 'Sent' and not exists (
        select 1 from invitation_token t where t.person_id = p.id and t.used_at is null and t.revoked_at is null and t.expires_at > now()
      ) then 'Expired'
      else p.invitation_state
    end,
    p.login_state,
    (select max(s.created_at) from session s where s.person_id = p.id)
  from person p
  where p.firm_id = p_firm_id and (p_person_id is null or p.id = p_person_id)
  order by p.ref_code;
end $$;

-- A new account in a studio, with its account types and a 72-hour invite link. Returns the person id and the expiry.
create function platform_create_person(
  p_session_token_hash text, p_firm_id uuid, p_name text, p_work_email text, p_job_title text, p_account_types text[], p_invite_token_hash text
) returns table (person_id uuid, invite_expires_at timestamptz)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_status text; v_types text[]; v_person uuid; v_ref text; v_next int; v_expires timestamptz; t text;
begin
  perform platform_session_admin(p_session_token_hash);
  v_status := platform_firm_status_of(p_firm_id);
  if v_status <> 'Active' then raise exception 'This company is suspended. Reactivate it before adding people.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name is required.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_work_email), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Enter a valid work email.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_invite_token_hash), '') = '' then raise exception 'An invite token is required.' using errcode = 'P0001'; end if;
  v_types := platform_clean_types(p_account_types);
  if exists (select 1 from person p where lower(p.work_email) = lower(trim(p_work_email))) then
    raise exception 'An account with this email already exists.' using errcode = '23505';
  end if;

  -- Same lock and numbering as POST /accounts on the firm side.
  perform pg_advisory_xact_lock(hashtext('person_ref:' || p_firm_id::text));
  select coalesce(max(substring(p.ref_code from '^P(\d+)$')::int), 0) + 1 into v_next from person p where p.firm_id = p_firm_id and p.ref_code ~ '^P\d+$';
  v_ref := 'P' || lpad(v_next::text, 2, '0');
  insert into person (firm_id, ref_code, name, work_email, job_title, employment_state, login_state, invitation_state)
    values (p_firm_id, v_ref, trim(p_name), trim(p_work_email), coalesce(trim(p_job_title), ''), 'Active', 'Enabled', 'Sent') returning id into v_person;
  foreach t in array v_types loop
    insert into permission_grant (firm_id, person_id, permission_set_id, scope_type, reason, sensitive)
      select p_firm_id, v_person, s.id, 'firm', 'Account type (set by the platform)', t in ('principal', 'finance')
      from permission_set s where s.firm_id = p_firm_id and s.key = platform_type_set_key(t);
  end loop;
  v_expires := now() + interval '72 hours';
  insert into invitation_token (firm_id, person_id, token_hash, expires_at) values (p_firm_id, v_person, p_invite_token_hash, v_expires);
  perform platform_audit_person(p_session_token_hash, p_firm_id, v_person, 'create_account', null, null,
    jsonb_build_object('ref_code', v_ref, 'name', trim(p_name), 'work_email', trim(p_work_email), 'job_title', coalesce(trim(p_job_title), ''),
      'account_types', to_jsonb(v_types), 'invitation_state', 'Sent', 'invite_expires_at', v_expires));
  person_id := v_person; invite_expires_at := v_expires;
  return next;
end $$;

-- A 24-hour password reset link for an accepted, Enabled account. Earlier unused reset links stop working.
create function platform_issue_reset_link(p_session_token_hash text, p_firm_id uuid, p_person_id uuid, p_reset_token_hash text) returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare v_status text; v_state text; v_login text; v_expires timestamptz;
begin
  perform platform_session_admin(p_session_token_hash);
  perform platform_person_in_firm(p_firm_id, p_person_id);
  v_status := platform_firm_status_of(p_firm_id);
  if v_status <> 'Active' then raise exception 'This company is suspended. Reactivate it before issuing a reset link.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reset_token_hash), '') = '' then raise exception 'A reset token is required.' using errcode = 'P0001'; end if;
  select p.invitation_state, p.login_state into v_state, v_login from person p where p.id = p_person_id for update;
  if v_state <> 'Accepted' then raise exception 'This person has not accepted their invitation yet. Send a new invite link instead.' using errcode = 'P0001'; end if;
  if v_login <> 'Enabled' then raise exception 'This account is disabled. Enable it before issuing a password reset link.' using errcode = 'P0001'; end if;
  update password_reset_token set revoked_at = now(), updated_at = now() where person_id = p_person_id and used_at is null and revoked_at is null;
  v_expires := now() + interval '24 hours';
  insert into password_reset_token (firm_id, person_id, token_hash, expires_at) values (p_firm_id, p_person_id, p_reset_token_hash, v_expires);
  perform platform_audit_person(p_session_token_hash, p_firm_id, p_person_id, 'issue_reset_link', null, null, jsonb_build_object('expires_at', v_expires));
  return v_expires;
end $$;

-- A new 72-hour invite link while the person has not accepted. Earlier unused invite links stop working.
create function platform_issue_invite_link(p_session_token_hash text, p_firm_id uuid, p_person_id uuid, p_invite_token_hash text) returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare v_status text; v_state text; v_login text; v_expires timestamptz;
begin
  perform platform_session_admin(p_session_token_hash);
  perform platform_person_in_firm(p_firm_id, p_person_id);
  v_status := platform_firm_status_of(p_firm_id);
  if v_status <> 'Active' then raise exception 'This company is suspended. Reactivate it before sending a new invite.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_invite_token_hash), '') = '' then raise exception 'An invite token is required.' using errcode = 'P0001'; end if;
  select p.invitation_state, p.login_state into v_state, v_login from person p where p.id = p_person_id for update;
  if v_state = 'Accepted' then raise exception 'This person has already accepted their invitation. Issue a password reset link instead.' using errcode = 'P0001'; end if;
  -- auth_accept_invite only accepts for an Enabled login, so a link for any other account could never be used.
  if v_login <> 'Enabled' then raise exception 'This account is disabled. Enable it before sending a new invite.' using errcode = 'P0001'; end if;
  update invitation_token set revoked_at = now(), updated_at = now() where person_id = p_person_id and used_at is null and revoked_at is null;
  v_expires := now() + interval '72 hours';
  insert into invitation_token (firm_id, person_id, token_hash, expires_at) values (p_firm_id, p_person_id, p_invite_token_hash, v_expires);
  update person set invitation_state = 'Sent', updated_at = now() where id = p_person_id and invitation_state <> 'Sent';
  perform platform_audit_person(p_session_token_hash, p_firm_id, p_person_id, 'reinvite', null, null, jsonb_build_object('invitation_state', 'Sent', 'invite_expires_at', v_expires));
  return v_expires;
end $$;

-- Replaces a person's account types. The firm keeps a principal. Gaining principal or finance revokes open links,
-- because whoever holds one could set the password of a now sensitive account.
create function platform_set_account_types(p_session_token_hash text, p_firm_id uuid, p_person_id uuid, p_account_types text[], p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_before text[]; v_types text[]; v_added text[]; v_removed text[]; t text;
begin
  perform platform_session_admin(p_session_token_hash);
  perform platform_person_in_firm(p_firm_id, p_person_id);
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  v_types := platform_clean_types(p_account_types);
  perform 1 from person p where p.id = p_person_id for update;
  v_before := platform_account_types(p_person_id);
  select coalesce(array_agg(x order by array_position(v_types, x)), '{}') into v_added from unnest(v_types) x where not (x = any(v_before));
  select coalesce(array_agg(x order by array_position(v_before, x)), '{}') into v_removed from unnest(v_before) x where not (x = any(v_types));
  if 'principal' = any(v_removed) then perform platform_assert_not_last_principal(p_firm_id, p_person_id); end if;
  if cardinality(v_removed) > 0 then
    delete from permission_grant g using permission_set s
      where g.person_id = p_person_id and s.id = g.permission_set_id and s.firm_id = p_firm_id
        and s.key in (select platform_type_set_key(x) from unnest(v_removed) x);
  end if;
  foreach t in array v_added loop
    insert into permission_grant (firm_id, person_id, permission_set_id, scope_type, reason, sensitive)
      select p_firm_id, p_person_id, s.id, 'firm', 'Account type (set by the platform)', t in ('principal', 'finance')
      from permission_set s where s.firm_id = p_firm_id and s.key = platform_type_set_key(t);
  end loop;
  if v_added && array['principal', 'finance'] then perform platform_revoke_links(p_person_id); end if;
  update person set updated_at = now() where id = p_person_id;
  perform platform_audit_person(p_session_token_hash, p_firm_id, p_person_id, 'set_account_types', trim(p_reason),
    jsonb_build_object('account_types', to_jsonb(v_before)),
    jsonb_build_object('account_types', to_jsonb(v_types), 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
end $$;

-- Disable: login Revoked, every session and every open link ends. Never the firm's last principal.
-- Enable: login Enabled again (the person signs in with their existing password, or accepts a new invite).
create function platform_set_person_access(p_session_token_hash text, p_firm_id uuid, p_person_id uuid, p_enabled boolean, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_login text; v_sessions int;
begin
  perform platform_session_admin(p_session_token_hash);
  perform platform_person_in_firm(p_firm_id, p_person_id);
  if p_enabled is null then raise exception 'Say whether to enable or disable.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  select p.login_state into v_login from person p where p.id = p_person_id for update;
  if p_enabled then
    if v_login = 'Enabled' then raise exception 'This account is already enabled.' using errcode = 'P0001'; end if;
    update person set login_state = 'Enabled', updated_at = now() where id = p_person_id;
    perform platform_audit_person(p_session_token_hash, p_firm_id, p_person_id, 'enable', trim(p_reason),
      jsonb_build_object('login_state', v_login), jsonb_build_object('login_state', 'Enabled'));
  else
    if v_login = 'Revoked' then raise exception 'This account is already disabled.' using errcode = 'P0001'; end if;
    if 'principal' = any(platform_account_types(p_person_id)) then perform platform_assert_not_last_principal(p_firm_id, p_person_id); end if;
    update person set login_state = 'Revoked', updated_at = now() where id = p_person_id;
    update session set revoked_at = now(), updated_at = now() where person_id = p_person_id and revoked_at is null;
    get diagnostics v_sessions = row_count;
    perform platform_revoke_links(p_person_id);
    perform platform_audit_person(p_session_token_hash, p_firm_id, p_person_id, 'disable', trim(p_reason),
      jsonb_build_object('login_state', v_login), jsonb_build_object('login_state', 'Revoked', 'sessions_revoked', v_sessions));
  end if;
end $$;

-- ---------- Grants: helpers are internal; ams_app gets the six session-bound functions ----------

revoke all on function platform_account_types(uuid) from public;
revoke all on function platform_type_set_key(text) from public;
revoke all on function platform_clean_types(text[]) from public;
revoke all on function platform_firm_status_of(uuid) from public;
revoke all on function platform_person_in_firm(uuid, uuid) from public;
revoke all on function platform_assert_not_last_principal(uuid, uuid) from public;
revoke all on function platform_revoke_links(uuid) from public;
revoke all on function platform_audit_person(text, uuid, uuid, text, text, jsonb, jsonb) from public;
revoke all on function platform_firm_people(text, uuid, uuid) from public;
revoke all on function platform_create_person(text, uuid, text, text, text, text[], text) from public;
revoke all on function platform_issue_reset_link(text, uuid, uuid, text) from public;
revoke all on function platform_issue_invite_link(text, uuid, uuid, text) from public;
revoke all on function platform_set_account_types(text, uuid, uuid, text[], text) from public;
revoke all on function platform_set_person_access(text, uuid, uuid, boolean, text) from public;
grant execute on function platform_firm_people(text, uuid, uuid) to ams_app;
grant execute on function platform_create_person(text, uuid, text, text, text, text[], text) to ams_app;
grant execute on function platform_issue_reset_link(text, uuid, uuid, text) to ams_app;
grant execute on function platform_issue_invite_link(text, uuid, uuid, text) to ams_app;
grant execute on function platform_set_account_types(text, uuid, uuid, text[], text) to ams_app;
grant execute on function platform_set_person_access(text, uuid, uuid, boolean, text) to ams_app;
