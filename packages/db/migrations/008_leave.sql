-- 008: leave. Types per firm (seeded like the internal work categories), entitlements per person per year, and
-- requests that go through the approvals queue (approval_request.type = 'leave', record_type = 'leave_request').
--
-- Balance for a type and year = allowance (the person's entitlement row, else the type's yearly allowance)
-- minus taken_days (kept on the entitlement row, moved by approve and by withdrawing approved leave)
-- minus the days of pending requests. A type with tracks_balance = false (Unpaid) is never limited.

create table leave_type (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  yearly_allowance_days numeric(5,2) not null default 0 check (yearly_allowance_days >= 0),
  tracks_balance boolean not null default true,
  sort_order int not null default 0,
  active boolean not null default true
);
select ams_base('leave_type');
create unique index leave_type_key on leave_type (firm_id, key);

create table leave_entitlement (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  leave_type_id uuid not null references leave_type(id),
  year int not null check (year between 2000 and 2100),
  allowance_days numeric(5,2) not null check (allowance_days >= 0),
  taken_days numeric(5,2) not null default 0 check (taken_days >= 0)
);
select ams_base('leave_entitlement');
create unique index leave_entitlement_person_year on leave_entitlement (person_id, leave_type_id, year);

create table leave_request (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  leave_type_id uuid not null references leave_type(id),
  start_date date not null,
  end_date date not null,
  half_day boolean not null default false,
  days numeric(5,2) not null check (days > 0),
  reason text,
  handover_note text,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Returned', 'Rejected', 'Withdrawn')),
  approver_id uuid references person(id),
  approval_request_id uuid references approval_request(id),
  decided_at timestamptz,
  decision_reason text,
  check (end_date >= start_date),
  check (extract(year from start_date) = extract(year from end_date)),
  -- Pending and approved leave never overlap for one person: the API says so first, this closes the race.
  constraint leave_request_no_overlap exclude using gist (person_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status in ('Pending', 'Approved'))
);
select ams_base('leave_request');
create index leave_request_person on leave_request (person_id, start_date);

do $$
declare t text;
begin
  foreach t in array array['leave_type', 'leave_entitlement', 'leave_request'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy firm_isolation on %I using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid) with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update on %I to ams_app', t);
  end loop;
end $$;

-- Every firm gets the default leave types, however it was created (same pattern as firm_default_categories).
-- A creator that sets up its own types in the same transaction (the demo seed does) is left alone.
create function firm_default_leave_types() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from leave_type where firm_id = new.id) then
    insert into leave_type (firm_id, key, name, yearly_allowance_days, tracks_balance, sort_order) values
      (new.id, 'earned', 'Earned leave', 15, true, 0),
      (new.id, 'sick', 'Sick leave', 7, true, 1),
      (new.id, 'casual', 'Casual leave', 7, true, 2),
      (new.id, 'unpaid', 'Unpaid leave', 0, false, 3);
  end if;
  return null;
end $$;
revoke all on function firm_default_leave_types() from public;

create constraint trigger firm_default_leave_types
  after insert on firm
  deferrable initially deferred
  for each row execute function firm_default_leave_types();

insert into leave_type (firm_id, key, name, yearly_allowance_days, tracks_balance, sort_order)
select f.id, d.key, d.name, d.allowance, d.tracks, d.sort_order
from firm f
cross join (values ('earned', 'Earned leave', 15, true, 0), ('sick', 'Sick leave', 7, true, 1), ('casual', 'Casual leave', 7, true, 2), ('unpaid', 'Unpaid leave', 0, false, 3))
  as d(key, name, allowance, tracks, sort_order)
where not exists (select 1 from leave_type t where t.firm_id = f.id);
