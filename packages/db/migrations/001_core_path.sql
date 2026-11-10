-- Core path schema. Spec sections 3.2 and 8. Money numeric(14,2), hours numeric(7,2).
create extension if not exists btree_gist;

create table firm (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trading_name text not null,
  currency text not null default 'INR',
  timezone text not null,
  allow_self_approval boolean not null default false,
  accounting_adapter text not null default 'mock' check (accounting_adapter in ('mock', 'csv')),
  fallback_approver_id uuid,
  created_at timestamptz not null default now()
);

-- Adds the base columns from section 8 to a business table.
create function ams_base(tbl text) returns void language plpgsql as $$
begin
  execute format('alter table %I
    add column firm_id uuid not null references firm(id),
    add column created_at timestamptz not null default now(),
    add column created_by uuid,
    add column updated_at timestamptz not null default now(),
    add column updated_by uuid', tbl);
end $$;

create table person (
  id uuid primary key default gen_random_uuid(),
  ref_code text not null,
  name text not null,
  work_email text not null,
  job_title text not null,
  manager_id uuid references person(id),
  internal_time_approver_id uuid references person(id),
  employment_state text not null default 'Active' check (employment_state in ('Pending start', 'Active', 'Ended')),
  login_state text not null default 'Enabled' check (login_state in ('Enabled', 'Suspended', 'Revoked')),
  password_hash text
);
select ams_base('person');
create unique index person_email_unique on person (lower(work_email));
create unique index person_ref_unique on person (firm_id, ref_code);

create table session (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
select ams_base('session');

create table permission_set (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null
);
select ams_base('permission_set');
create unique index permission_set_key on permission_set (firm_id, key);

create table permission_grant (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  permission_set_id uuid references permission_set(id),
  capability text,
  scope_type text not null default 'firm' check (scope_type in ('firm', 'project')),
  scope_id uuid,
  granted_by uuid references person(id),
  reason text,
  sensitive boolean not null default false,
  check ((permission_set_id is null) <> (capability is null))
);
select ams_base('permission_grant');

-- Rule R20. The service refuses first and audits; this is the last line of defence.
create function permission_grant_no_self() returns trigger language plpgsql as $$
begin
  if new.sensitive and new.granted_by = new.person_id then
    raise exception 'sensitive self-grant refused (R20)' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger permission_grant_no_self before insert or update on permission_grant
  for each row execute function permission_grant_no_self();

create table substitute (
  id uuid primary key default gen_random_uuid(),
  approver_id uuid not null references person(id),
  substitute_id uuid not null references person(id),
  from_date date not null,
  to_date date not null,
  check (from_date <= to_date)
);
select ams_base('substitute');

create table audit_event (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references person(id),
  at timestamptz not null default now(),
  record_type text not null,
  record_id text,
  action text not null,
  previous jsonb,
  new jsonb,
  reason text,
  approval_ref uuid,
  sensitive boolean not null default false
);
select ams_base('audit_event');
create index audit_record on audit_event (firm_id, record_type, record_id);

create table notification (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  event_type text not null,
  record_type text,
  record_id text,
  text text not null,
  read_at timestamptz,
  resolved_at timestamptz
);
select ams_base('notification');
create index notification_person on notification (firm_id, person_id, read_at);

create table idempotency_record (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  route text not null,
  status int not null,
  response jsonb not null
);
select ams_base('idempotency_record');
create unique index idempotency_unique on idempotency_record (firm_id, route, key);

create table client (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
select ams_base('client');

create table project (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  client_id uuid not null references client(id),
  pm_id uuid not null references person(id),
  principal_id uuid references person(id),
  status text not null default 'Active' check (status in ('Draft', 'Active', 'On hold', 'Delivery complete', 'Archived')),
  hold_reason text,
  contract_summary text
);
select ams_base('project');
create unique index project_code on project (firm_id, code);

create table project_membership (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  person_id uuid not null references person(id),
  project_role text not null check (project_role in ('pm', 'lead', 'contributor', 'reviewer', 'viewer'))
);
select ams_base('project_membership');
create unique index project_membership_unique on project_membership (project_id, person_id);

create table phase (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  code text not null,
  name text not null,
  start_date date,
  end_date date,
  owner_id uuid references person(id),
  -- Rule R8: entered by the PM only. Nothing derives it from hours.
  delivery_progress_pct numeric(5,2) not null default 0 check (delivery_progress_pct between 0 and 100),
  etc_hours numeric(7,2) not null default 0,
  -- Imported history (is_opening in the spec): hours before this system.
  opening_actual_hours numeric(9,2) not null default 0,
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Complete', 'Cancelled')),
  sort_order int not null default 0
);
select ams_base('phase');

create table contract_version (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  version_no int not null,
  effective_from date not null,
  authorization_ref text
);
select ams_base('contract_version');
create unique index contract_version_unique on contract_version (project_id, version_no);

create table fee_component (
  id uuid primary key default gen_random_uuid(),
  contract_version_id uuid not null references contract_version(id),
  project_id uuid not null references project(id),
  key text not null,
  name text not null,
  billing_method text not null check (billing_method in ('fixed_milestone', 'fixed_percent', 'hourly', 'hourly_nte', 'percent_construction', 'consultant_recharge')),
  contracted_amount numeric(14,2),
  fee_percent numeric(7,4),
  cap_amount numeric(14,2),
  check (billing_method <> 'hourly_nte' or cap_amount is not null)
);
select ams_base('fee_component');

create table phase_fee_allocation (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phase(id),
  fee_component_id uuid not null references fee_component(id),
  amount numeric(14,2) not null
);
select ams_base('phase_fee_allocation');
create unique index phase_fee_allocation_unique on phase_fee_allocation (phase_id, fee_component_id);

-- One row per authorized completion level, so each level can be claimed exactly once.
create table fee_authorization (
  id uuid primary key default gen_random_uuid(),
  phase_fee_allocation_id uuid not null references phase_fee_allocation(id),
  cumulative_percent numeric(5,2) not null check (cumulative_percent between 0 and 100),
  authorized_by uuid references person(id),
  authorized_at timestamptz not null default now()
);
select ams_base('fee_authorization');

create table billing_milestone (
  id uuid primary key default gen_random_uuid(),
  fee_component_id uuid not null references fee_component(id),
  phase_id uuid references phase(id),
  label text not null,
  amount numeric(14,2) not null,
  status text not null default 'Planned' check (status in ('Planned', 'Authorized', 'Drafted', 'Invoiced'))
);
select ams_base('billing_milestone');

create table construction_cost_basis (
  id uuid primary key default gen_random_uuid(),
  fee_component_id uuid not null references fee_component(id),
  version_no int not null,
  amount numeric(14,2) not null,
  status text not null default 'Approved' check (status in ('Draft', 'Approved', 'Superseded'))
);
select ams_base('construction_cost_basis');

create table budget_version (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  version_no int not null,
  kind text not null check (kind in ('baseline', 'revision')),
  status text not null default 'Approved' check (status in ('Draft', 'Approved', 'Superseded'))
);
select ams_base('budget_version');

create table budget_line (
  id uuid primary key default gen_random_uuid(),
  budget_version_id uuid not null references budget_version(id),
  phase_id uuid not null references phase(id),
  hours numeric(7,2) not null
);
select ams_base('budget_line');

create table internal_work_category (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null
);
select ams_base('internal_work_category');

-- Append-only, effective-dated (R13). The exclusion constraint forbids overlapping versions per scope.
create table rate_schedule (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  project_id uuid references project(id),
  rate_type text not null check (rate_type in ('bill', 'cost')),
  amount numeric(14,2) not null check (amount >= 0),
  effective_from date not null,
  effective_to date,
  change_reason text,
  check (effective_to is null or effective_from <= effective_to),
  exclude using gist (
    person_id with =,
    (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    rate_type with =,
    daterange(effective_from, effective_to, '[]') with &&
  )
);
select ams_base('rate_schedule');

create table timesheet (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  period_start date not null,
  period_end date not null,
  submitted_at timestamptz,
  status text not null default 'Open' check (status in ('Open', 'Submitted', 'Partially approved', 'Approved', 'Returned'))
);
select ams_base('timesheet');
create unique index timesheet_unique on timesheet (person_id, period_start);

create table time_entry (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  service_date date not null,
  project_id uuid references project(id),
  phase_id uuid references phase(id),
  internal_category_id uuid references internal_work_category(id),
  fee_component_id uuid references fee_component(id),
  duration_hours numeric(7,2) not null,
  note text,
  timesheet_id uuid not null references timesheet(id),
  bill_rate_schedule_id uuid references rate_schedule(id),
  cost_rate_schedule_id uuid references rate_schedule(id),
  approval_state text not null default 'Draft' check (approval_state in ('Draft', 'Submitted', 'Approved', 'Returned', 'Amended')),
  billing_state text not null default 'Unbilled' check (billing_state in ('Unbilled', 'Reserved', 'Billed', 'Non-billable')),
  return_reason text,
  corrected_from_id uuid references time_entry(id),
  correction_reason text,
  -- A correction delta may be negative (AC-F10-3); ordinary entries may not.
  check (duration_hours <> 0 and abs(duration_hours) <= 24),
  check (duration_hours > 0 or corrected_from_id is not null),
  check (corrected_from_id is null or correction_reason is not null),
  -- R2: project work has a phase, internal work has a category, never both. Only a Draft may be unclassified.
  check ((project_id is null) = (phase_id is null)),
  check (not (phase_id is not null and internal_category_id is not null)),
  check (approval_state = 'Draft' or phase_id is not null or internal_category_id is not null)
);
select ams_base('time_entry');
create index time_entry_person_date on time_entry (firm_id, person_id, service_date);
create index time_entry_project on time_entry (firm_id, project_id, approval_state, billing_state);

create table timer (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  project_id uuid references project(id),
  phase_id uuid references phase(id),
  internal_category_id uuid references internal_work_category(id)
);
select ams_base('timer');
create unique index timer_one_active on timer (person_id) where ended_at is null;

create table approval_request (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('time', 'internal_time', 'leave', 'expense', 'supplier_bill', 'change', 'billing_draft')),
  record_type text not null,
  record_id uuid not null,
  project_id uuid references project(id),
  submitter_id uuid not null references person(id),
  approver_id uuid not null references person(id),
  delegated_to_id uuid references person(id),
  delegated_until date,
  exception_flags text[] not null default '{}',
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Returned', 'Rejected', 'Withdrawn'))
);
select ams_base('approval_request');
create index approval_queue on approval_request (firm_id, approver_id, status);

create table approval_request_entry (
  approval_request_id uuid not null references approval_request(id),
  time_entry_id uuid not null references time_entry(id),
  firm_id uuid not null references firm(id),
  primary key (approval_request_id, time_entry_id)
);

create table decision (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references approval_request(id),
  actor_id uuid not null references person(id),
  action text not null,
  reason text,
  at timestamptz not null default now()
);
select ams_base('decision');

create table vendor (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
select ams_base('vendor');

create table supplier_bill (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendor(id),
  invoice_no text not null,
  bill_date date not null,
  amount numeric(14,2) not null,
  markup_percent numeric(5,2),
  approval_state text not null default 'Draft' check (approval_state in ('Draft', 'Submitted', 'Scope approved', 'Finance approved', 'Rejected')),
  payable_state text not null default 'Not payable' check (payable_state in ('Not payable', 'Pending', 'Paid')),
  recharge_state text not null default 'Not eligible' check (recharge_state in ('Not eligible', 'Eligible', 'Reserved', 'Billed')),
  project_id uuid not null references project(id),
  phase_id uuid references phase(id),
  fee_component_id uuid references fee_component(id)
);
select ams_base('supplier_bill');

create table billing_draft (
  id uuid primary key default gen_random_uuid(),
  draft_no text not null,
  client_id uuid not null references client(id),
  project_id uuid not null references project(id),
  cutoff_date date not null,
  approval_state text not null default 'Draft' check (approval_state in ('Draft', 'In review', 'Approved', 'Rejected')),
  accounting_state text not null default 'Not submitted' check (accounting_state in ('Not submitted', 'Pending', 'Finalized', 'Failed', 'Uncertain')),
  idempotency_key text not null,
  pm_confirmed_by uuid references person(id),
  prepared_by uuid references person(id)
);
select ams_base('billing_draft');
create unique index billing_draft_no on billing_draft (firm_id, draft_no);
create sequence billing_draft_seq start 13;

create table billing_line (
  id uuid primary key default gen_random_uuid(),
  billing_draft_id uuid not null references billing_draft(id),
  phase_id uuid references phase(id),
  fee_component_id uuid references fee_component(id),
  line_type text not null,
  label text not null,
  calculation_basis jsonb not null default '{}',
  previous_net_billing numeric(14,2) not null default 0,
  current_claim numeric(14,2) not null,
  remaining_entitlement numeric(14,2),
  tax_mapping_code text
);
select ams_base('billing_line');

-- Rule R18: one source amount can sit in only one live draft. The database decides, even under concurrency.
create table source_allocation (
  id uuid primary key default gen_random_uuid(),
  billing_line_id uuid not null references billing_line(id),
  source_type text not null check (source_type in ('time_entry', 'expense', 'supplier_bill', 'milestone', 'percent_claim')),
  source_id uuid not null,
  amount_claimed numeric(14,2) not null,
  active boolean not null default true
);
select ams_base('source_allocation');
create unique index source_allocation_live on source_allocation (firm_id, source_type, source_id) where active;

create table nte_ledger (
  id uuid primary key default gen_random_uuid(),
  fee_component_id uuid not null references fee_component(id),
  entry_type text not null check (entry_type in ('consumed', 'reserved', 'released', 'excess')),
  amount numeric(14,2) not null,
  source_type text,
  source_id uuid,
  billing_draft_id uuid references billing_draft(id),
  note text
);
select ams_base('nte_ledger');

create table integration_job (
  id uuid primary key default gen_random_uuid(),
  adapter text not null,
  direction text not null,
  record_type text not null,
  record_id uuid not null,
  idempotency_key text not null,
  attempts int not null default 0,
  last_error text,
  external_id text,
  status text not null default 'Queued' check (status in ('Queued', 'Running', 'Succeeded', 'Failed', 'Uncertain'))
);
select ams_base('integration_job');
create unique index integration_job_key on integration_job (firm_id, idempotency_key);

create table external_invoice (
  id uuid primary key default gen_random_uuid(),
  billing_draft_id uuid references billing_draft(id),
  project_id uuid not null references project(id),
  client_id uuid not null references client(id),
  external_id text not null,
  invoice_no text not null,
  issue_date date not null,
  due_date date not null,
  gross numeric(14,2) not null,
  tax numeric(14,2) not null default 0,
  net numeric(14,2) not null,
  snapshot jsonb not null,
  is_opening boolean not null default false,
  delivery_state text not null default 'Unsent' check (delivery_state in ('Unsent', 'Sent')),
  settlement_state text not null default 'Unpaid' check (settlement_state in ('Unpaid', 'Part-paid', 'Settled', 'Disputed')),
  follow_up_owner_id uuid references person(id),
  follow_up_date date
);
select ams_base('external_invoice');
create unique index external_invoice_no on external_invoice (firm_id, invoice_no);
create unique index external_invoice_draft on external_invoice (billing_draft_id) where billing_draft_id is not null;

-- Rule R17: a finalized invoice never changes. Corrections are linked Adjustment rows.
create function external_invoice_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'external_invoice is immutable (R17)' using errcode = 'P0001';
  end if;
  if (new.billing_draft_id, new.project_id, new.client_id, new.external_id, new.invoice_no, new.issue_date, new.due_date, new.gross, new.tax, new.net, new.snapshot, new.is_opening)
     is distinct from
     (old.billing_draft_id, old.project_id, old.client_id, old.external_id, old.invoice_no, old.issue_date, old.due_date, old.gross, old.tax, old.net, old.snapshot, old.is_opening) then
    raise exception 'external_invoice is immutable (R17)' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger external_invoice_immutable before update or delete on external_invoice
  for each row execute function external_invoice_immutable();

create table settlement (
  id uuid primary key default gen_random_uuid(),
  external_invoice_id uuid not null references external_invoice(id),
  kind text not null check (kind in ('cash', 'withholding', 'credit_applied')),
  amount numeric(14,2) not null check (amount > 0),
  settlement_date date not null,
  reference text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  reconciled boolean not null default false
);
select ams_base('settlement');

create table adjustment (
  id uuid primary key default gen_random_uuid(),
  external_invoice_id uuid not null references external_invoice(id),
  kind text not null check (kind in ('credit_note', 'debit_note', 'write_down')),
  amount numeric(14,2) not null,
  reason text not null,
  external_id text
);
select ams_base('adjustment');

-- Application role: never a superuser, never the owner, so row-level security always applies to it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ams_app') then
    create role ams_app login password 'ams_app_dev' nosuperuser nocreatedb nocreaterole;
  end if;
end $$;
grant usage on schema public to ams_app;
grant usage on sequence billing_draft_seq to ams_app;

-- Rule 1 in section 3.2: every business table is isolated by firm, enforced by the database.
do $$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'firm_id' loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy firm_isolation on %I using (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid) with check (firm_id = nullif(current_setting('app.firm_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to ams_app', t);
  end loop;
end $$;

alter table firm enable row level security;
create policy firm_self on firm using (id = nullif(current_setting('app.firm_id', true), '')::uuid);
grant select, update on firm to ams_app;

-- History tables are append-only for the application.
revoke update, delete on audit_event from ams_app;
revoke update, delete on decision from ams_app;
revoke update, delete on nte_ledger from ams_app;
revoke delete on external_invoice from ams_app;
revoke delete on settlement from ams_app;

-- Login happens before a firm is known. These two functions are the only way past the firm policy.
create function auth_find_person(p_email text) returns table (person_id uuid, firm_id uuid, password_hash text, login_state text)
  language sql security definer set search_path = public as $$
  select id, firm_id, password_hash, login_state from person where lower(work_email) = lower(p_email)
$$;
create function auth_find_session(p_token_hash text) returns table (session_id uuid, person_id uuid, firm_id uuid)
  language sql security definer set search_path = public as $$
  select s.id, s.person_id, s.firm_id from session s join person p on p.id = s.person_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now() and p.login_state = 'Enabled'
$$;
revoke all on function auth_find_person(text) from public;
revoke all on function auth_find_session(text) from public;
grant execute on function auth_find_person(text) to ams_app;
grant execute on function auth_find_session(text) to ams_app;
