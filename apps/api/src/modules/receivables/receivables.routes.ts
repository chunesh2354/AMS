import { outstandingPaise, toPaise, transition } from '@ams/domain';
import { ApiError, notFound, rethrowTransition, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize, hasFirmCap } from '../../auth/authorize';
import { idempotent } from '../../http/idempotency';
import { isoDate, required, uuidParam } from '../../http/validation';
import { list, money } from '../../http/responses';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';

const INVOICE_SQL = `select i.*, c.name as client_name, pr.code as project_code, pr.name as project_name, o.name as owner_name, o.ref_code as owner_ref,
    coalesce((select sum(s.amount) from settlement s where s.external_invoice_id = i.id and s.kind = 'cash'),0) as cash,
    coalesce((select sum(s.amount) from settlement s where s.external_invoice_id = i.id and s.kind = 'withholding'),0) as withholding,
    coalesce((select sum(s.amount) from settlement s where s.external_invoice_id = i.id and s.kind = 'credit_applied'),0) as credits,
    coalesce((select sum(case when a.kind = 'debit_note' then a.amount else -a.amount end) from adjustment a where a.external_invoice_id = i.id),0) as adjustments,
    greatest(current_date - i.due_date, 0) as overdue_days
  from external_invoice i join client c on c.id = i.client_id join project pr on pr.id = i.project_id left join person o on o.id = i.follow_up_owner_id`;

const outstandingOf = (r: any) => outstandingPaise(toPaise(r.gross), toPaise(r.cash), toPaise(r.withholding), toPaise(r.credits), toPaise(r.adjustments));

const view = (r: any) => ({
  id: r.id, invoice_no: r.invoice_no, external_id: r.external_id, client: r.client_name, project: { id: r.project_id, code: r.project_code, name: r.project_name },
  issue_date: r.issue_date, due_date: r.due_date, overdue_days: outstandingOf(r) > 0 ? r.overdue_days : 0, gross: money(r.gross), tax: money(r.tax), net: money(r.net),
  cash: money(r.cash), withholding: money(r.withholding), credits: money(r.credits), adjustments: money(r.adjustments), outstanding: money(outstandingOf(r)),
  settlement_state: r.settlement_state, delivery_state: r.delivery_state, follow_up: r.follow_up_owner_id ? { owner: { id: r.follow_up_owner_id, ref_code: r.owner_ref, name: r.owner_name }, date: r.follow_up_date } : null,
});

/** AC-F14-4: finance sees the firm; a PM sees their own projects, read only. */
async function rows(tx: Tx, actor: Actor) {
  authorize(actor, 'receivables.manage', { projectId: actor.ledProjects[0], read: true });
  const firmWide = hasFirmCap(actor, 'receivables.manage');
  return (await tx.query(`${INVOICE_SQL} where ($1::boolean or i.project_id = any($2::uuid[])) order by i.due_date, i.invoice_no`, [firmWide, actor.ledProjects])).rows;
}

export function receivableRoutes({ get, post }: Api) {
  get('/receivables', async ({ tx, actor, req }) => list(req, (await rows(tx, actor)).map(view)));

  get('/receivables/ageing', async ({ tx, actor }) => {
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
    for (const r of await rows(tx, actor)) {
      const o = outstandingOf(r);
      if (o <= 0) continue;
      const d = Number(r.overdue_days);
      if (d < 30) buckets.current += o; else if (d < 60) buckets.d30 += o; else if (d < 90) buckets.d60 += o; else buckets.d90 += o;
    }
    return { current: money(buckets.current), d30: money(buckets.d30), d60: money(buckets.d60), d90: money(buckets.d90), total: money(buckets.current + buckets.d30 + buckets.d60 + buckets.d90) };
  });

  /** Cash, withholding and credits stay in separate rows and separate totals. Withholding is not a discount or a payment. */
  post('/receivables/:id/settlements', async ({ tx, actor, firmId, params, body, req }) => {
    if (!hasFirmCap(actor, 'receivables.manage')) throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'Recording a settlement needs firm-wide receivables.manage.', [], { capability: 'receivables.manage' });
    required(body, ['kind', 'amount', 'date']);
    const id = uuidParam(params.id, 'Invoice');
    return idempotent(tx, req, firmId, `POST /receivables/${id}/settlements`, async () => {
      if (!['cash', 'withholding', 'credit_applied'].includes(body.kind)) throw new ApiError(400, 'VALIDATION', 'Unknown settlement kind.', [{ field: 'kind', code: 'unknown' }]);
      const locked = (await tx.query('select id, settlement_state from external_invoice where id = $1 for update', [id])).rows[0];
      if (!locked) throw notFound('Invoice');
      const r = (await tx.query(`${INVOICE_SQL} where i.id = $1`, [id])).rows[0];
      const amount = toPaise(String(body.amount));
      if (!(amount > 0)) throw new ApiError(400, 'VALIDATION', 'Amount must be above zero.', [{ field: 'amount', code: 'range' }]);
      const left = outstandingOf(r);
      if (amount > left) throw ruleError('F14', `That is more than the ${money(left)!.amount} outstanding.`, [{ field: 'amount', code: 'over_outstanding' }]);
      const s = (await tx.query(
        `insert into settlement (firm_id, external_invoice_id, kind, amount, settlement_date, reference, source, created_by) values ($1,$2,$3,$4,$5,$6,'manual',$7) returning id`,
        [firmId, id, body.kind, money(amount)!.amount, isoDate(body.date, 'date'), body.reference ?? null, actor.id],
      )).rows[0];
      let next = locked.settlement_state;
      try { next = transition('settlementState', locked.settlement_state, amount === left ? 'settle' : 'part'); } catch (e) { rethrowTransition(e); }
      await tx.query('update external_invoice set settlement_state = $2, updated_at = now(), updated_by = $3 where id = $1', [id, next, actor.id]);
      const audit_event_id = await audit(tx, actor, firmId, { recordType: 'external_invoice', recordId: id, action: 'settlement', next: { kind: body.kind, amount: money(amount)!.amount, reference: body.reference } });
      const fresh = (await tx.query(`${INVOICE_SQL} where i.id = $1`, [id])).rows[0];
      return { settlement_id: s.id, invoice: view(fresh), audit_event_id };
    });
  });
}
