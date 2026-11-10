-- 010: project tasks. A planner of the project (principal, operations, its PM or lead) creates tasks and assigns them
-- to someone on the project team; the assignee moves the status and adds progress notes.
-- completed_at is set when a task moves to Done and cleared when it leaves Done.

create table task (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  phase_id uuid references phase(id),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  assignee_id uuid references person(id),
  due_date date,
  status text not null default 'To do' check (status in ('To do', 'In progress', 'Done', 'Blocked')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High')),
  sort_order int not null default 0,
  completed_at timestamptz,
  check ((status = 'Done') = (completed_at is not null))
);
select ams_base('task');
create index task_project on task (project_id, status, sort_order);
create index task_assignee on task (firm_id, assignee_id, status, due_date);

-- Progress notes on a task, by its assignee or a planner. Kept with the task, never edited.
create table task_note (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references task(id) on delete cascade,
  author_id uuid not null references person(id),
  body text not null check (length(btrim(body)) between 1 and 2000)
);
select ams_base('task_note');
create index task_note_task on task_note (task_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['task', 'task_note'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy firm_isolation on %I using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid) with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to ams_app', t);
  end loop;
end $$;
