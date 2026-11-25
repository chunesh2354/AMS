-- 011: planning. Capacity, studio holidays, weekly allocations and the published plan (spec F03, F08).
--
-- Availability for a person and week (apps/api/src/modules/planning/availability.ts, the one definition):
--   scheduled = weekly hours in force each day (person_capacity, else firm.default_weekly_hours), spread Monday to Friday
--   available = scheduled - holiday hours - approved leave hours (a day that is both counts once; half days count half)
--   allocated = the allocations of that week; conflict when the confirmed hours exceed available.
--
-- Allocations are edited as a draft (allocation). Publishing copies a project's draft into allocation_published
-- (what staff see on My schedule) and writes one plan_revision row; until then a published allocation that was
-- changed or deleted keeps its published values. Pending changes = the difference between the two tables.

-- The studio's standard week for anyone without a capacity row of their own (new people included).
alter table firm add column default_weekly_hours numeric(5,2) not null default 40 check (default_weekly_hours between 0 and 168);

-- Effective-dated weekly hours: the row with the latest effective_from on or before a date is in force that day.
create table person_capacity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  effective_from date not null,
  weekly_hours numeric(5,2) not null check (weekly_hours between 0 and 168),
  note text check (note is null or length(note) <= 500)
);
select ams_base('person_capacity');
create unique index person_capacity_from on person_capacity (person_id, effective_from);

-- Studio holidays: nobody is scheduled that day (half a day when half_day).
create table firm_holiday (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  half_day boolean not null default false
);
select ams_base('firm_holiday');
create unique index firm_holiday_date on firm_holiday (firm_id, date);

-- The draft plan. person_id null is unassigned demand (a role still to fill). week_start is a Monday.
create table allocation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  phase_id uuid references phase(id),
  person_id uuid references person(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  hours numeric(6,2) not null check (hours > 0 and hours <= 168),
  state text not null default 'confirmed' check (state in ('tentative', 'confirmed')),
  note text check (note is null or length(note) <= 500),
  -- F08: required by the API when a save leaves the person's confirmed hours above their availability.
  overallocation_reason text check (overallocation_reason is null or length(overallocation_reason) <= 500)
);
select ams_base('allocation');
create index allocation_project_week on allocation (project_id, week_start);
create index allocation_person_week on allocation (firm_id, person_id, week_start);

-- One row per publish (PlanVersion in the spec): numbered per firm, never changed afterwards.
create table plan_revision (
  id uuid primary key default gen_random_uuid(),
  revision_no int not null check (revision_no > 0),
  scope text not null check (scope in ('firm', 'project')),
  project_id uuid references project(id),
  -- The projects whose published plan this revision changed: who may see the revision follows from them.
  project_ids uuid[] not null default '{}',
  note text check (note is null or length(note) <= 1000),
  published_by uuid not null references person(id),
  published_at timestamptz not null default now(),
  change_count int not null check (change_count >= 0),
  changes jsonb not null default '[]',
  check ((scope = 'project') = (project_id is not null))
);
select ams_base('plan_revision');
create unique index plan_revision_no on plan_revision (firm_id, revision_no);

-- The published plan, keyed by the draft allocation's id. No foreign key to allocation: deleting a published
-- allocation from the draft keeps it here (and on My schedule) until the next publish of its project.
create table allocation_published (
  allocation_id uuid primary key,
  project_id uuid not null references project(id),
  phase_id uuid references phase(id),
  person_id uuid references person(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  hours numeric(6,2) not null check (hours > 0 and hours <= 168),
  state text not null check (state in ('tentative', 'confirmed')),
  note text,
  plan_revision_id uuid not null references plan_revision(id)
);
select ams_base('allocation_published');
create index allocation_published_person_week on allocation_published (firm_id, person_id, week_start);
create index allocation_published_project on allocation_published (project_id, week_start);

do $$
declare t text;
begin
  foreach t in array array['person_capacity', 'firm_holiday', 'allocation', 'plan_revision', 'allocation_published'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy firm_isolation on %I using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid) with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)$p$, t);
  end loop;
end $$;
grant select, insert, update, delete on person_capacity, firm_holiday, allocation, allocation_published to ams_app;
-- The publish log is history: the application adds rows and reads them, never changes or removes one.
grant select, insert on plan_revision to ams_app;
