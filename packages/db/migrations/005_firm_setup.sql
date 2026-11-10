-- Firm setup: a new studio can run on its own from day one.
-- 1. Every firm gets the default internal work categories (the names the demo firm uses), however it was created.
-- 2. Existing firms with no categories are backfilled.
-- 3. Client names are unique per firm, ignoring case; existing duplicates are renamed "Name (2)" first.

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

-- The API refuses a duplicate name with 409; this index closes the race. Existing duplicates (same firm, same
-- name ignoring case and outer spaces) are renamed first, deterministically: the oldest row (created_at, then id)
-- keeps its name, later ones become "Name (2)", "Name (3)"... skipping any suffix already taken. Each rename is
-- reported with RAISE NOTICE, so the deploy log lists exactly what changed.
do $$
declare
  r record;
  n int;
  candidate text;
  renamed int := 0;
begin
  for r in
    select id, firm_id, name,
           row_number() over (partition by firm_id, lower(trim(name)) order by created_at, id) as rn
    from client
    order by firm_id, lower(trim(name)), created_at, id
  loop
    continue when r.rn = 1;
    n := r.rn;
    loop
      candidate := trim(r.name) || ' (' || n || ')';
      exit when not exists (select 1 from client c where c.firm_id = r.firm_id and lower(trim(c.name)) = lower(candidate));
      n := n + 1;
    end loop;
    update client set name = candidate, updated_at = now() where id = r.id;
    renamed := renamed + 1;
    raise notice 'client_name_unique: renamed client % (firm %) from "%" to "%"', r.id, r.firm_id, r.name, candidate;
  end loop;
  if renamed > 0 then
    raise notice 'client_name_unique: renamed % duplicate client name(s)', renamed;
  end if;
  create unique index client_name_unique on client (firm_id, lower(trim(name)));
end $$;
