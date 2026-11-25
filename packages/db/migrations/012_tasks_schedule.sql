-- 012: sub-tasks, task dependencies, followers, time on tasks, schedule dates and the margin target (spec F07, F09, F10, F15).
--
-- Tasks gain a planned start and an estimate. A sub-task is a task with parent_task_id: one level only (the spec does
-- not describe nesting), in the parent's project. Ordering keeps using task.sort_order (migration 010).
-- A dependency is finish-to-start with a lag in calendar days between two tasks of the same project; self-links and
-- cycles are refused (AC-F09-2) by the API, and by the trigger below as a backstop.
-- A follower hears about status changes, new notes and reschedules of a task.
-- A time entry or timer may name a task of the same project and phase as itself.

alter table task
  add column start_date date,
  add column estimate_hours numeric(7,2) check (estimate_hours is null or estimate_hours >= 0),
  add column parent_task_id uuid references task(id) on delete cascade,
  add constraint task_dates_order check (start_date is null or due_date is null or start_date <= due_date),
  add constraint task_not_own_parent check (parent_task_id is null or parent_task_id <> id);
create index task_parent on task (parent_task_id, sort_order) where parent_task_id is not null;

-- One level of sub-tasks, in the parent's project.
create function task_parent_check() returns trigger language plpgsql as $$
declare p record;
begin
  if new.parent_task_id is null then return new; end if;
  select id, project_id, parent_task_id into p from task where id = new.parent_task_id;
  if p.id is null then raise exception 'The parent task was not found.' using errcode = 'P0001'; end if;
  if p.project_id <> new.project_id then raise exception 'A sub-task belongs to its parent''s project.' using errcode = 'P0001'; end if;
  if p.parent_task_id is not null then raise exception 'A sub-task cannot have sub-tasks of its own.' using errcode = 'P0001'; end if;
  if exists (select 1 from task c where c.parent_task_id = new.id) then raise exception 'A task with sub-tasks cannot become a sub-task.' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger task_parent_check before insert or update of parent_task_id, project_id on task
  for each row execute function task_parent_check();

create table task_dependency (
  id uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references task(id) on delete cascade,
  successor_id uuid not null references task(id) on delete cascade,
  type text not null default 'finish_to_start' check (type in ('finish_to_start')),
  lag_days int not null default 0 check (lag_days between -365 and 365),
  check (predecessor_id <> successor_id)
);
select ams_base('task_dependency');
create unique index task_dependency_pair on task_dependency (predecessor_id, successor_id);
create index task_dependency_successor on task_dependency (successor_id);

-- Same project, and never a cycle: the new edge pred -> succ closes a loop when succ already reaches pred.
create function task_dependency_check() returns trigger language plpgsql as $$
begin
  if (select project_id from task where id = new.predecessor_id) is distinct from (select project_id from task where id = new.successor_id)
     or not exists (select 1 from task where id = new.predecessor_id) then
    raise exception 'Both tasks of a dependency belong to the same project.' using errcode = 'P0001';
  end if;
  if exists (
    with recursive reach(id) as (
      select d.successor_id from task_dependency d where d.predecessor_id = new.successor_id and d.id <> new.id
      union
      select d.successor_id from task_dependency d join reach r on d.predecessor_id = r.id where d.id <> new.id
    )
    select 1 from reach where id = new.predecessor_id
  ) or new.successor_id = new.predecessor_id then
    raise exception 'This dependency would make a cycle.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger task_dependency_check before insert or update on task_dependency
  for each row execute function task_dependency_check();

create table task_follower (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task(id) on delete cascade,
  person_id uuid not null references person(id)
);
select ams_base('task_follower');
create unique index task_follower_unique on task_follower (task_id, person_id);
create index task_follower_person on task_follower (firm_id, person_id);

-- Time on a task. Deleting a task keeps its hours on the phase and drops only the link.
alter table time_entry add column task_id uuid references task(id) on delete set null;
create index time_entry_task on time_entry (task_id) where task_id is not null;
alter table timer add column task_id uuid references task(id) on delete set null;

-- The task of an entry or timer is in the same project and phase as it.
create function time_task_check() returns trigger language plpgsql as $$
declare t record;
begin
  if new.task_id is null then return new; end if;
  select project_id, phase_id into t from task where id = new.task_id;
  if not found or t.project_id is distinct from new.project_id or t.phase_id is distinct from new.phase_id then
    raise exception 'The task must belong to the same project and phase as the time.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger time_entry_task_check before insert or update of task_id, project_id, phase_id on time_entry
  for each row execute function time_task_check();
create trigger timer_task_check before insert or update of task_id, project_id, phase_id on timer
  for each row execute function time_task_check();

-- Milestone dates for the schedule (BillingMilestone.planned_date in spec 8.1). Null shows the phase end instead.
alter table billing_milestone add column planned_date date;

-- Margin target: the studio's default, and an optional override per project. Read only by holders of margin.view.
alter table firm add column margin_target_pct numeric(5,2) not null default 20 check (margin_target_pct between 0 and 100);
alter table project add column margin_target_pct numeric(5,2) check (margin_target_pct is null or margin_target_pct between 0 and 100);

do $$
declare t text;
begin
  foreach t in array array['task_dependency', 'task_follower'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy firm_isolation on %I using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid) with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to ams_app', t);
  end loop;
end $$;
