-- 004: one company's detail on the platform panel, and a new owner invite.
--
-- Both functions are bound to a live platform session exactly like the 003 functions: they take the sha256 of the
-- platform session token and call platform_session_admin first, so an invalid session raises 28000 before anything
-- is read or written. Neither takes an admin id.
--
-- The detail stays counts-only. The one exception is the company owner (the firm's first principal, the person
-- platform_create_firm made): the platform needs that name and email to hand over the invite link. No other person,
-- no projects, no money and no time are returned.

-- The owner: the P01 principal platform_create_firm creates; for a firm made any other way, its earliest person.
create function platform_firm_owner(p_firm_id uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select p.id from person p where p.firm_id = p_firm_id
  order by (p.ref_code = 'P01') desc, p.created_at, p.ref_code limit 1
$$;

create function platform_firm_detail(p_session_token_hash text, p_firm_id uuid) returns table (
  id uuid, trading_name text, legal_name text, status text, suspended_reason text, timezone text, currency text,
  created_at timestamptz, people int, active_people int, last_login_at timestamptz,
  owner_name text, owner_email text, owner_invitation_state text
) language plpgsql stable security definer set search_path = public as $$
begin
  perform platform_session_admin(p_session_token_hash);
  return query
  select f.id, f.trading_name, f.legal_name, f.status, f.suspended_reason, f.timezone, f.currency, f.created_at,
    (select count(*)::int from person p where p.firm_id = f.id),
    (select count(*)::int from person p where p.firm_id = f.id and p.login_state = 'Enabled' and p.employment_state = 'Active'),
    (select max(s.created_at) from session s where s.firm_id = f.id),
    o.name, o.work_email,
    -- 'Sent' with no usable token left means the link has expired (or was revoked) and a new one is needed.
    case
      when o.invitation_state = 'Sent' and not exists (
        select 1 from invitation_token t where t.person_id = o.id and t.used_at is null and t.revoked_at is null and t.expires_at > now()
      ) then 'Expired'
      else o.invitation_state
    end
  from firm f
  left join person o on o.id = platform_firm_owner(f.id)
  where f.id = p_firm_id;
end $$;

-- Issues a new owner invite: only while the owner has not accepted, never for a suspended firm. Earlier unused owner
-- tokens stop working. The token is stored as its hash, exactly as platform_create_firm stores it.
create function platform_reissue_owner_invite(p_session_token_hash text, p_firm_id uuid, p_invite_token_hash text, p_invite_expires_at timestamptz)
  returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_status text; v_owner uuid; v_state text; v_login text;
begin
  v_admin := platform_session_admin(p_session_token_hash);
  select f.status into v_status from firm f where f.id = p_firm_id for update;
  if v_status is null then raise exception 'Firm not found.' using errcode = 'P0001'; end if;
  if v_status <> 'Active' then
    raise exception 'This company is suspended. Reactivate it before sending a new owner invite.' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_invite_token_hash), '') = '' then raise exception 'An invite token is required.' using errcode = 'P0001'; end if;
  if p_invite_expires_at is null or p_invite_expires_at <= now() or p_invite_expires_at > now() + interval '7 days' then
    raise exception 'An owner invite lasts at most 7 days.' using errcode = 'P0001';
  end if;
  v_owner := platform_firm_owner(p_firm_id);
  if v_owner is null then raise exception 'This company has no owner account.' using errcode = 'P0001'; end if;
  select p.invitation_state, p.login_state into v_state, v_login from person p where p.id = v_owner for update;
  if v_state = 'Accepted' then
    raise exception 'The owner has already accepted the invite and signs in with their own password.' using errcode = 'P0001';
  end if;
  -- auth_accept_invite only accepts for an Enabled login, so a link for any other owner could never be used.
  if v_login <> 'Enabled' then
    raise exception 'The owner account is not enabled. Reactivate it before sending a new owner invite.' using errcode = 'P0001';
  end if;

  update invitation_token set revoked_at = now(), updated_at = now()
    where person_id = v_owner and used_at is null and revoked_at is null;
  insert into invitation_token (firm_id, person_id, token_hash, expires_at) values (p_firm_id, v_owner, p_invite_token_hash, p_invite_expires_at);
  update person set invitation_state = 'Sent', updated_at = now() where id = v_owner and invitation_state <> 'Sent';
  insert into audit_event (firm_id, record_type, record_id, action, new, reason)
    values (p_firm_id, 'person', v_owner::text, 'reinvite', jsonb_build_object('invitation_state', 'Sent', 'invite_expires_at', p_invite_expires_at), 'New owner invite from the platform');
  insert into platform_audit (admin_id, action, firm_id, detail)
    values (v_admin, 'reissue_owner_invite', p_firm_id, jsonb_build_object('invite_expires_at', p_invite_expires_at));
  return p_invite_expires_at;
end $$;

-- ---------- Grants: the owner resolver is internal; ams_app gets the two session-bound functions ----------

revoke all on function platform_firm_owner(uuid) from public;
revoke all on function platform_firm_detail(text, uuid) from public;
revoke all on function platform_reissue_owner_invite(text, uuid, text, timestamptz) from public;
grant execute on function platform_firm_detail(text, uuid) to ams_app;
grant execute on function platform_reissue_owner_invite(text, uuid, text, timestamptz) to ams_app;
