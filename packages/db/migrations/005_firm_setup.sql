-- Firm setup: a new studio can run on its own from day one.
-- 1. Every firm gets the default internal work categories (the names the demo firm uses), however it was created.
-- 2. Existing firms with no categories are backfilled.
-- 3. Client names are unique per firm, ignoring case, where the data already allows it.

-- The trigger is a deferred constraint trigger, so it runs at commit, after whatever created the firm has finished.
-- A creator that sets up its own categories in the same transaction (the demo seed does) is left alone.
create function firm_default_categories() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from internal_work_category where firm_id = new.id) then
    insert into internal_work_category (firm_id, key, name) values
      (new.id, 'admin', 'Studio admin'),
      (new.id, 'training', 'Training');
  end if;
  return null;
end $$;
revoke all on function firm_default_categories() from public;

create constraint trigger firm_default_categories
  after insert on firm
  deferrable initially deferred
  for each row execute function firm_default_categories();

insert into internal_work_category (firm_id, key, name)
select f.id, d.key, d.name
from firm f
cross join (values ('admin', 'Studio admin'), ('training', 'Training')) as d(key, name)
where not exists (select 1 from internal_work_category c where c.firm_id = f.id);

-- The API refuses a duplicate name with 409; this index closes the race. It is skipped, not failed,
-- if a firm already holds duplicates, so the migration never blocks a deploy.
do $$
begin
  if not exists (select 1 from client group by firm_id, lower(trim(name)) having count(*) > 1) then
    create unique index client_name_unique on client (firm_id, lower(trim(name)));
  end if;
end $$;
