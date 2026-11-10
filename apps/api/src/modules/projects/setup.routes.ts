import { ApiError, conflict, notFound } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize, can } from '../../auth/authorize';
import { list, money } from '../../http/responses';
import { isoDate, required, uuidParam } from '../../http/validation';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';

const NAME_MAX = 200;

/** A trimmed client name, or a 400 naming the field. */
function clientName(body: any): string {
  required(body, ['name']);
  if (typeof body.name !== 'string' || !body.name.trim()) throw new ApiError(400, 'VALIDATION', 'Enter the client name.', [{ field: 'name', code: 'required' }]);
  const name = body.name.trim();
  if (name.length > NAME_MAX) throw new ApiError(400, 'VALIDATION', `A client name is at most ${NAME_MAX} characters.`, [{ field: 'name', code: 'too_long' }]);
  return name;
}

/** Case-insensitive within the firm (RLS scopes the query). The unique index from migration 005 closes the race. */
async function assertNameFree(tx: Tx, name: string, exceptId: string | null = null) {
  const dup = await tx.query('select id from client where lower(trim(name)) = lower($1) and ($2::uuid is null or id <> $2)', [name, exceptId]);
  if (dup.rowCount) throw conflict('DUPLICATE_NAME', `A client called ${name} already exists.`, { conflicting_id: dup.rows[0].id });
}

/** Clients (a studio sets these up before its first project) and the firm's current rate card. */
export function setupRoutes({ get, post, put }: Api) {
  post('/clients', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'projects.create');
    const name = clientName(body);
    await assertNameFree(tx, name);
    const row = (await tx.query('insert into client (firm_id, name, created_by) values ($1,$2,$3) returning id, name', [firmId, name, actor.id])).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'client', recordId: row.id, action: 'create', next: { name } });
    return { id: row.id, name: row.name, audit_event_id };
  });

  // Rename. The Api helper has no PATCH; PUT carries the one editable field.
  put('/clients/:id', async ({ tx, actor, firmId, params, body }) => {
    authorize(actor, 'projects.create');
    const id = uuidParam(params.id, 'Client');
    const name = clientName(body);
    const prev = (await tx.query('select id, name from client where id = $1', [id])).rows[0];
    if (!prev) throw notFound('Client');
    await assertNameFree(tx, name, id);
    await tx.query('update client set name = $2, updated_by = $3, updated_at = now() where id = $1', [id, name, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'client', recordId: id, action: 'update', previous: { name: prev.name }, next: { name } });
    return { id, name, audit_event_id };
  });

  /**
   * Everyone's firm-wide rates in force on a day (today by default). Same gate as GET /people/:id/rates.
   * cost_rate is fenced: holders of rates.cost.view see it, everyone else gets {restricted:true} (and the serializer agrees).
   */
  get('/rates', async ({ tx, actor, query, req }) => {
    if (!can(actor, 'rates.bill.manage') && !can(actor, 'rates.cost.view')) authorize(actor, 'rates.bill.manage');
    const asOf = query.as_of == null || query.as_of === '' ? null : isoDate(query.as_of, 'as_of');
    const costOk = actor.caps['rates.cost.view'] === 'firm';
    const rows = (await tx.query(
      `with d as (select coalesce($1::date, current_date) as day)
       select p.id, p.ref_code, p.name, p.job_title, p.employment_state,
         b.id as bill_id, b.amount as bill_amount, b.effective_from as bill_from,
         c.id as cost_id, c.amount as cost_amount, c.effective_from as cost_from
       from person p cross join d
       left join lateral (select r.id, r.amount, r.effective_from from rate_schedule r where r.person_id = p.id and r.rate_type = 'bill' and r.project_id is null
         and r.effective_from <= d.day and (r.effective_to is null or r.effective_to >= d.day) order by r.effective_from desc limit 1) b on true
       left join lateral (select r.id, r.amount, r.effective_from from rate_schedule r where r.person_id = p.id and r.rate_type = 'cost' and r.project_id is null
         and r.effective_from <= d.day and (r.effective_to is null or r.effective_to >= d.day) order by r.effective_from desc limit 1) c on true
       order by p.ref_code`,
      [asOf],
    )).rows;
    return list(req, rows.map((r) => ({
      person: { id: r.id, ref_code: r.ref_code, name: r.name, job_title: r.job_title, employment_state: r.employment_state },
      bill_rate: r.bill_id ? { id: r.bill_id, amount: money(r.bill_amount), effective_from: r.bill_from } : null,
      cost_rate: !costOk ? { restricted: true } : r.cost_id ? { id: r.cost_id, amount: money(r.cost_amount), effective_from: r.cost_from } : null,
    })));
  });
}
