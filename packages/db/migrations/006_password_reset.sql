-- 006: password reset links.
--
-- An admin (people.manage) issues a reset link for an accepted, enabled account; the person opens it without a
-- session and sets a new password. Email is not connected yet, so the admin copies the link and passes it on.
--
-- Only the sha256 of a token is stored. 24 hours, single use; a new link revokes the previous unused one.
-- Like invitation_token, the public flow reaches this table only through the two SECURITY DEFINER functions below,
-- because before the token is checked no firm is known and the firm policy hides every row.

create table password_reset_token (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
select ams_base('password_reset_token');
create index password_reset_token_person on password_reset_token (person_id);
alter table password_reset_token enable row level security;
create policy firm_isolation on password_reset_token
  using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)
  with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid);
grant select, insert, update on password_reset_token to ams_app;

-- Preview. Returns a row only for a token that belongs to an Active firm and an Enabled, accepted account,
-- so a suspended firm or a deactivated person sees the same answer as an unknown link. Never returns a hash.
create function auth_find_reset(p_token_hash text) returns table (
  person_id uuid, firm_id uuid, name text, work_email text, firm_name text, expires_at timestamptz,
  used_at timestamptz, revoked_at timestamptz
) language sql stable security definer set search_path = public as $$
  select t.person_id, t.firm_id, p.name, p.work_email, f.trading_name, t.expires_at, t.used_at, t.revoked_at
  from password_reset_token t join person p on p.id = t.person_id join firm f on f.id = t.firm_id
  where t.token_hash = p_token_hash and f.status = 'Active' and p.login_state = 'Enabled' and p.invitation_state = 'Accepted'
$$;

-- Marks the token used, sets the password, revokes every session of that person and audits, atomically.
-- Returns no row when the token is not usable (unknown, used, revoked, expired, suspended firm, disabled login).
create function auth_reset_password(p_token_hash text, p_password_hash text) returns table (person_id uuid, firm_id uuid)
  language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_person uuid; v_firm uuid; v_sessions int;
begin
  if coalesce(p_password_hash, '') = '' then raise exception 'A password hash is required.' using errcode = 'P0001'; end if;
  update password_reset_token rt set used_at = now(), updated_at = now()
    from person p, firm f
    where rt.token_hash = p_token_hash and rt.used_at is null and rt.revoked_at is null and rt.expires_at > now()
      and p.id = rt.person_id and f.id = rt.firm_id and f.status = 'Active' and p.login_state = 'Enabled' and p.invitation_state = 'Accepted'
    returning rt.person_id, rt.firm_id into v_person, v_firm;
  if v_person is null then return; end if;
  update person set password_hash = p_password_hash, updated_at = now(), updated_by = v_person where id = v_person;
  update session set revoked_at = now(), updated_at = now(), updated_by = v_person where person_id = v_person and revoked_at is null;
  get diagnostics v_sessions = row_count;
  -- Any other unused link for the same person stops working too.
  update password_reset_token set revoked_at = now(), updated_at = now() where person_id = v_person and used_at is null and revoked_at is null;
  insert into audit_event (firm_id, actor_id, created_by, record_type, record_id, action, new)
    values (v_firm, v_person, v_person, 'person', v_person::text, 'reset_password', jsonb_build_object('sessions_revoked', v_sessions));
  person_id := v_person; firm_id := v_firm;
  return next;
end $$;

revoke all on function auth_find_reset(text) from public;
revoke all on function auth_reset_password(text, text) from public;
grant execute on function auth_find_reset(text) to ams_app;
grant execute on function auth_reset_password(text, text) to ams_app;
