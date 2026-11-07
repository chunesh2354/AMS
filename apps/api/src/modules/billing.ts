import { randomUUID } from 'node:crypto';
import { fixedFeeClaim, fromPaise, hoursValue, nteSplit, rechargeAmount, toPaise, transition } from '../../../../packages/domain/src/index';
import { ApiError, audit, authorize, conflict, hasFirmCap, hours, idempotent, isoDate, list, money, notFound, required, rethrowTransition, ruleError, type Actor, type Tx } from '../core';
import { findProject } from './projects';
import { routeApprover } from './approvals';
import { adapterFor, AdapterTimeout, type AdapterResult } from './accounting';
import type { Api } from '../server';

type Source = { type: 'time_entry' | 'supplier_bill' | 'milestone' | 'percent_claim'; id: string; amount: number };
export type ReadyItem = {
  project_id: string; fee_component_id: string; component: string; billing_method: string; phase_id: string | null; phase: string | null;
  line_type: string; label: string; basis: Record<string, unknown>; previous: number; claim: number; remaining: number | null; sources: Source[]; excess?: number; hours?: number;
};
type Exception = { project_id: string; fee_component_id: string; component: string; title: string; requested: number; eligible: number; excess: number; cap: number; consumed: number; hours: number };

const nteConsumed = async (tx: Tx, componentId: string) => toPaise((await tx.query(
  `select coalesce(sum(amount) filter (where entry_type in ('consumed','reserved')),0) - coalesce(sum(amount) filter (where entry_type = 'released'),0) v from nte_ledger where fee_component_id = $1`, [componentId],
)).rows[0].v);

/** F13: everything billable right now for one project. Missing rates are listed; they never count as zero (R22). */
export async function readyFor(tx: Tx, projectId: string, cutoff: string, onlyEntries?: string[]) {
  const items: ReadyItem[] = [];
  const exceptions: Exception[] = [];
  const missing: { type: string; record_id: string; message: string }[] = [];

  const fixed = (await tx.query(
    `select a.id, a.amount, a.phase_id, ph.name as phase, c.id as component_id, c.name as component, c.billing_method,
       f.id as auth_id, f.cumulative_percent
     from fee_authorization f join phase_fee_allocation a on a.id = f.phase_fee_allocation_id join fee_component c on c.id = a.fee_component_id join phase ph on ph.id = a.phase_id
     where c.project_id = $1 and c.billing_method in ('fixed_percent','fixed_milestone')
       and f.cumulative_percent = (select max(x.cumulative_percent) from fee_authorization x where x.phase_fee_allocation_id = a.id)
       and not exists (select 1 from source_allocation s where s.source_type = 'percent_claim' and s.source_id = f.id and s.active)`, [projectId],
  )).rows;
  for (const r of fixed) {
    const prior = toPaise((await tx.query(
      `select coalesce(sum(l.current_claim),0) v from billing_line l join billing_draft d on d.id = l.billing_draft_id
       where l.phase_id = $1 and l.fee_component_id = $2 and l.line_type = 'fixed_progress' and d.approval_state <> 'Rejected'`, [r.phase_id, r.component_id],
    )).rows[0].v);
    const c = fixedFeeClaim(toPaise(r.amount), r.cumulative_percent, prior);
    if (c.claim <= 0) continue;
    items.push({
      project_id: projectId, fee_component_id: r.component_id, component: r.component, billing_method: r.billing_method, phase_id: r.phase_id, phase: r.phase,
      line_type: 'fixed_progress', label: `Fixed fee claim, ${r.phase}`, previous: prior, claim: c.claim, remaining: c.remaining,
      basis: { fee: fromPaise(toPaise(r.amount)), authorized_percent: r.cumulative_percent, cumulative_entitlement: fromPaise(c.entitlement), prior_net_billing: fromPaise(prior) },
      sources: [{ type: 'percent_claim', id: r.auth_id, amount: c.claim }],
    });
  }

  const miles = (await tx.query(
    `select m.id, m.label, m.amount, m.phase_id, ph.name as phase, c.id as component_id, c.name as component, c.billing_method, c.fee_percent,
       (select b.amount from construction_cost_basis b where b.fee_component_id = c.id and b.status = 'Approved' order by b.version_no desc limit 1) as basis_amount,
       (select b.version_no from construction_cost_basis b where b.fee_component_id = c.id and b.status = 'Approved' order by b.version_no desc limit 1) as basis_version
     from billing_milestone m join fee_component c on c.id = m.fee_component_id left join phase ph on ph.id = m.phase_id
     where c.project_id = $1 and m.status = 'Authorized' and not exists (select 1 from source_allocation s where s.source_type = 'milestone' and s.source_id = m.id and s.active)`, [projectId],
  )).rows;
  for (const m of miles) {
    items.push({
      project_id: projectId, fee_component_id: m.component_id, component: m.component, billing_method: m.billing_method, phase_id: m.phase_id, phase: m.phase,
      line_type: m.billing_method === 'percent_construction' ? 'percent_schedule' : 'milestone', label: m.label, previous: 0, claim: toPaise(m.amount), remaining: null,
      basis: { milestone: m.label, ...(m.basis_amount ? { construction_cost_basis: m.basis_amount, basis_version: m.basis_version, fee_percent: m.fee_percent } : {}) },
      sources: [{ type: 'milestone', id: m.id, amount: toPaise(m.amount) }],
    });
  }

  const entries = (await tx.query(
    `select te.id, te.duration_hours, te.service_date, te.phase_id, ph.name as phase, pe.name as person, te.bill_rate_schedule_id, r.amount as rate,
       c.id as component_id, c.name as component, c.billing_method, c.cap_amount
     from time_entry te join fee_component c on c.id = te.fee_component_id join person pe on pe.id = te.person_id join phase ph on ph.id = te.phase_id
     left join rate_schedule r on r.id = te.bill_rate_schedule_id
     where te.project_id = $1 and te.approval_state = 'Approved' and te.billing_state = 'Unbilled' and te.service_date <= $2 and c.billing_method in ('hourly','hourly_nte')
       and ($3::uuid[] is null or te.id = any($3)) order by te.service_date, te.created_at`, [projectId, cutoff, onlyEntries ?? null],
  )).rows;
  const byComponent = new Map<string, any[]>();
  for (const e of entries) {
    if (e.rate == null) { missing.push({ type: 'bill_rate', record_id: e.id, message: `${e.person} has no bill rate for ${e.service_date}` }); continue; }
    byComponent.set(e.component_id, [...(byComponent.get(e.component_id) ?? []), e]);
  }
  for (const [componentId, list_] of byComponent) {
    const first = list_[0];
    const nte = first.billing_method === 'hourly_nte';
    const cap = nte ? toPaise(first.cap_amount) : 0;
    const startConsumed = nte ? await nteConsumed(tx, componentId) : 0;
    let consumed = startConsumed;
    let claim = 0; let excess = 0; let totalHours = 0; let requested = 0;
    const sources: Source[] = [];
    for (const e of list_) {
      const value = hoursValue(e.duration_hours, e.rate);
      const split = nte ? nteSplit(value, cap, consumed) : { eligible: value, excess: 0 };
      consumed += split.eligible; claim += split.eligible; excess += split.excess; totalHours += Number(e.duration_hours); requested += value;
      if (split.eligible !== 0) sources.push({ type: 'time_entry', id: e.id, amount: split.eligible });
    }
    if (excess > 0) {
      exceptions.push({ project_id: projectId, fee_component_id: componentId, component: first.component, title: 'Hourly NTE limit reached', requested, eligible: claim, excess, cap, consumed: startConsumed, hours: totalHours });
    }
    if (sources.length) {
      items.push({
        project_id: projectId, fee_component_id: componentId, component: first.component, billing_method: first.billing_method, phase_id: first.phase_id, phase: first.phase,
        line_type: nte ? 'hourly_nte' : 'hourly', label: `${first.component}, ${first.phase}`, previous: nte ? startConsumed : 0, claim, remaining: nte ? cap - consumed : null,
        basis: { hours: totalHours.toFixed(2), ...(nte ? { cap: fromPaise(cap), consumed_before: fromPaise(startConsumed), requested: fromPaise(requested), eligible: fromPaise(claim), excess: fromPaise(excess) } : {}), people: [...new Set(list_.map((e) => e.person))] },
        sources, excess, hours: totalHours,
      });
    }
  }

  const bills = (await tx.query(
    `select b.id, b.invoice_no, b.amount, b.markup_percent, b.phase_id, ph.name as phase, b.fee_component_id, c.name as component, v.name as vendor
     from supplier_bill b join vendor v on v.id = b.vendor_id left join phase ph on ph.id = b.phase_id left join fee_component c on c.id = b.fee_component_id
     where b.project_id = $1 and b.approval_state = 'Finance approved' and b.recharge_state = 'Eligible'
       and not exists (select 1 from source_allocation s where s.source_type = 'supplier_bill' and s.source_id = b.id and s.active)`, [projectId],
  )).rows;
  for (const b of bills) {
    const claim = rechargeAmount(toPaise(b.amount), b.markup_percent);
    items.push({
      project_id: projectId, fee_component_id: b.fee_component_id, component: b.component ?? 'Consultant recharge', billing_method: 'consultant_recharge', phase_id: b.phase_id, phase: b.phase,
      line_type: 'recharge', label: `${b.vendor} recharge, ${b.invoice_no}`, previous: 0, claim, remaining: null,
      basis: { bill: b.amount, markup_percent: b.markup_percent, invoice_no: b.invoice_no }, sources: [{ type: 'supplier_bill', id: b.id, amount: claim }],
    });
  }
  return { items, exceptions, missing };
}

const itemView = (i: ReadyItem, code: string, projectName: string) => ({
  id: `${i.line_type}:${i.sources[0]?.id}`, project: { id: i.project_id, code, name: projectName }, component: i.component, billing_method: i.billing_method, phase: i.phase,
  line_type: i.line_type, label: i.label, basis: i.basis, previous_net_billing: money(i.previous), current_claim: money(i.claim), remaining_entitlement: i.remaining == null ? null : money(i.remaining), status: 'Eligible',
});
const exceptionView = (e: Exception, code: string, projectName: string) => ({
  id: `nte:${e.fee_component_id}`, project: { id: e.project_id, code, name: projectName }, component: e.component, title: e.title, status: 'Excess', hours: hours(e.hours),
  cap: money(e.cap), consumed: money(e.consumed), requested: money(e.requested), eligible: money(e.eligible), excess: money(e.excess),
});

async function draftTotal(tx: Tx, id: string) {
  return (await tx.query('select coalesce(sum(current_claim),0) v from billing_line where billing_draft_id = $1', [id])).rows[0].v as string;
}
async function draftView(tx: Tx, d: any) {
  const lines = (await tx.query(
    `select l.*, ph.name as phase, c.name as component from billing_line l left join phase ph on ph.id = l.phase_id left join fee_component c on c.id = l.fee_component_id where l.billing_draft_id = $1 order by l.created_at`, [d.id],
  )).rows;
  const sources = (await tx.query(
    `select s.billing_line_id, s.source_type, s.source_id, s.amount_claimed, s.active, te.service_date, te.duration_hours, pe.name as person
     from source_allocation s join billing_line l on l.id = s.billing_line_id
     left join time_entry te on s.source_type = 'time_entry' and te.id = s.source_id left join person pe on pe.id = te.person_id where l.billing_draft_id = $1`, [d.id],
  )).rows;
  const job = (await tx.query(`select status, attempts, last_error, external_id, adapter, updated_at from integration_job where record_id = $1 order by created_at desc limit 1`, [d.id])).rows[0];
  const inv = (await tx.query(`select id, invoice_no from external_invoice where billing_draft_id = $1`, [d.id])).rows[0];
  return {
    id: d.id, draft_no: d.draft_no, project: { id: d.project_id, code: d.project_code, name: d.project_name }, client: d.client_name, cutoff_date: d.cutoff_date, prepared_by: d.prepared_name,
    approval_state: d.approval_state, accounting_state: d.accounting_state, pm_confirmed: !!d.pm_confirmed_by, idempotency_key: d.idempotency_key,
    total: money(await draftTotal(tx, d.id)), external_invoice: inv ?? null, job: job ?? null,
    lines: lines.map((l) => ({
      id: l.id, label: l.label, line_type: l.line_type, phase: l.phase, component: l.component, calculation_basis: l.calculation_basis, previous_net_billing: money(l.previous_net_billing),
      current_claim: money(l.current_claim), remaining_entitlement: l.remaining_entitlement == null ? null : money(l.remaining_entitlement), tax_mapping_code: l.tax_mapping_code,
      sources: sources.filter((s) => s.billing_line_id === l.id).map((s) => ({ type: s.source_type, id: s.source_id, amount: money(s.amount_claimed), service_date: s.service_date, hours: hours(s.duration_hours), person: s.person })),
    })),
  };
}
const DRAFT_SQL = `select d.*, pr.code as project_code, pr.name as project_name, c.name as client_name, pb.name as prepared_name
  from billing_draft d join project pr on pr.id = d.project_id join client c on c.id = d.client_id left join person pb on pb.id = d.prepared_by`;

async function loadDraft(tx: Tx, id: string, lock = false) {
  const d = (await tx.query(`${DRAFT_SQL} where d.id = $1 or d.draft_no = $1${lock ? ' for update of d' : ''}`.replace('d.id = $1', 'd.id::text = $1'), [id])).rows[0];
  if (!d) throw notFound('Billing draft');
  return d;
}
const assertPrepare = (actor: Actor) => {
  if (!hasFirmCap(actor, 'billing.prepare')) throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'Preparing a billing draft needs firm-wide billing.prepare. A PM confirms entitlement instead.', [], { capability: 'billing.prepare' });
};

/** Called by the approval inbox and by the draft endpoint alike. */
export async function approveDraftInTx(tx: Tx, actor: Actor, firmId: string, draftId: string) {
  authorize(actor, 'billing.approve');
  const d = await loadDraft(tx, draftId, true);
  let to: string;
  try { to = transition('draftApproval', d.approval_state, 'approve'); } catch (e) { rethrowTransition(e); }
  await tx.query(`update billing_draft set approval_state = $2, updated_by = $3, updated_at = now() where id = $1`, [d.id, to!, actor.id]);
  await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'approve', previous: { approval_state: d.approval_state }, next: { approval_state: to! } });
}

/** A rejected draft gives its sources back, so the same work can be billed again. */
export async function rejectDraftInTx(tx: Tx, actor: Actor, firmId: string, draftId: string, reason: string) {
  const d = await loadDraft(tx, draftId, true);
  let to: string;
  try { to = transition('draftApproval', d.approval_state, 'reject'); } catch (e) { rethrowTransition(e); }
  await tx.query(`update billing_draft set approval_state = $2, updated_by = $3, updated_at = now() where id = $1`, [d.id, to!, actor.id]);
  const sources = (await tx.query(`select s.* from source_allocation s join billing_line l on l.id = s.billing_line_id where l.billing_draft_id = $1 and s.active`, [d.id])).rows;
  for (const s of sources) {
    if (s.source_type === 'time_entry') await tx.query(`update time_entry set billing_state = 'Unbilled' where id = $1 and billing_state = 'Reserved'`, [s.source_id]);
    if (s.source_type === 'milestone') await tx.query(`update billing_milestone set status = 'Authorized' where id = $1`, [s.source_id]);
    if (s.source_type === 'supplier_bill') await tx.query(`update supplier_bill set recharge_state = 'Eligible' where id = $1`, [s.source_id]);
  }
  await tx.query(`update source_allocation set active = false where id = any($1::uuid[])`, [sources.map((s) => s.id)]);
  const ledger = (await tx.query(`select fee_component_id, entry_type, sum(amount) amt from nte_ledger where billing_draft_id = $1 and entry_type in ('reserved','excess') group by 1,2`, [d.id])).rows;
  for (const l of ledger) {
    if (l.entry_type === 'reserved') await tx.query(`insert into nte_ledger (firm_id, fee_component_id, entry_type, amount, billing_draft_id, note, created_by) values ($1,$2,'released',$3,$4,'Draft rejected',$5)`, [firmId, l.fee_component_id, l.amt, d.id, actor.id]);
    else await tx.query(`insert into nte_ledger (firm_id, fee_component_id, entry_type, amount, billing_draft_id, note, created_by) values ($1,$2,'excess',$3,$4,'Draft rejected',$5)`, [firmId, l.fee_component_id, -Number(l.amt), d.id, actor.id]);
  }
  await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'reject', reason });
}

/** Freezes the invoice (R17): lines, totals and names are copied, so later edits elsewhere cannot change it. */
async function finalize(tx: Tx, actor: Actor, firmId: string, d: any, result: AdapterResult) {
  const lines = (await tx.query(`select label, line_type, current_claim, tax_mapping_code, calculation_basis from billing_line where billing_draft_id = $1`, [d.id])).rows;
  const net = await draftTotal(tx, d.id);
  const inv = (await tx.query(
    `insert into external_invoice (firm_id, billing_draft_id, project_id, client_id, external_id, invoice_no, issue_date, due_date, gross, tax, net, snapshot, created_by, follow_up_owner_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id, invoice_no`,
    [firmId, d.id, d.project_id, d.client_id, result.external_id, result.invoice_no, result.issue_date, result.due_date, result.gross ?? net, result.tax ?? 0, result.net ?? net,
      JSON.stringify({ draft_no: d.draft_no, project: { code: d.project_code, name: d.project_name }, client: d.client_name, lines, totals: { net } }), actor.id, d.prepared_by],
  )).rows[0];
  const sources = (await tx.query(`select s.* from source_allocation s join billing_line l on l.id = s.billing_line_id where l.billing_draft_id = $1 and s.active`, [d.id])).rows;
  for (const s of sources) {
    if (s.source_type === 'time_entry') await tx.query(`update time_entry set billing_state = 'Billed' where id = $1`, [s.source_id]);
    if (s.source_type === 'milestone') await tx.query(`update billing_milestone set status = 'Invoiced' where id = $1`, [s.source_id]);
    if (s.source_type === 'supplier_bill') await tx.query(`update supplier_bill set recharge_state = 'Billed' where id = $1`, [s.source_id]);
  }
  const reserved = (await tx.query(`select fee_component_id, sum(amount) amt from nte_ledger where billing_draft_id = $1 and entry_type = 'reserved' group by 1`, [d.id])).rows;
  for (const r of reserved) {
    await tx.query(`insert into nte_ledger (firm_id, fee_component_id, entry_type, amount, billing_draft_id, created_by) values ($1,$2,'released',$3,$4,$5),($1,$2,'consumed',$3,$4,$5)`, [firmId, r.fee_component_id, r.amt, d.id, actor.id]);
  }
  await tx.query(`update billing_draft set accounting_state = 'Finalized', updated_by = $2, updated_at = now() where id = $1`, [d.id, actor.id]);
  await audit(tx, actor, firmId, { recordType: 'external_invoice', recordId: inv.id, action: 'finalize', next: { invoice_no: inv.invoice_no, net } });
  return inv;
}

export function billingRoutes({ get, post, put }: Api) {
  /** Firm-wide for finance and principals; a PM sees only their own projects. Staff are refused. */
  const scopeOf = async (tx: Tx, actor: Actor, projectCode?: string) => {
    if (projectCode) {
      const p = await findProject(tx, projectCode);
      authorize(actor, 'billing.prepare', { projectId: p.id, read: true });
      return [p];
    }
    if (hasFirmCap(actor, 'billing.prepare')) return (await tx.query(`select * from project where status <> 'Archived' order by code`)).rows;
    if (actor.caps['billing.prepare'] === 'scoped') return (await tx.query('select * from project where id = any($1::uuid[]) order by code', [actor.ledProjects])).rows;
    authorize(actor, 'billing.prepare');
    return [];
  };

  get('/billing/ready', async ({ tx, actor, query, req }) => {
    const cutoff = query.cutoff ? isoDate(query.cutoff, 'cutoff') : new Date().toISOString().slice(0, 10);
    const projects = await scopeOf(tx, actor, query.project);
    const out: ReturnType<typeof itemView>[] = []; const exc: ReturnType<typeof exceptionView>[] = []; const missing: unknown[] = [];
    for (const p of projects) {
      const r = await readyFor(tx, p.id, cutoff);
      out.push(...r.items.map((i) => itemView(i, p.code, p.name)));
      exc.push(...r.exceptions.map((e) => exceptionView(e, p.code, p.name)));
      missing.push(...r.missing);
    }
    const total = out.reduce((s, i) => s + toPaise(i.current_claim!.amount), 0);
    return { ...list(req, out, { complete: missing.length === 0, missing_count: missing.length }), total: money(total), count: out.length, exceptions: exc, missing };
  });

  get('/billing/drafts', async ({ tx, actor, query, req }) => {
    const projects = await scopeOf(tx, actor, query.project);
    const rows = (await tx.query(`${DRAFT_SQL} where d.project_id = any($1::uuid[]) and d.approval_state <> 'Rejected' order by d.draft_no`, [projects.map((p) => p.id)])).rows;
    return list(req, await Promise.all(rows.map((d) => draftView(tx, d))));
  });

  get('/billing/drafts/:id', async ({ tx, actor, params }) => {
    const d = await loadDraft(tx, params.id);
    authorize(actor, 'billing.prepare', { projectId: d.project_id, read: true });
    return draftView(tx, d);
  });

  /** AC-F13-3: naming time entries already in a live draft is a 409 that names the draft. */
  post('/billing/drafts', async ({ tx, actor, firmId, body, req }) => {
    assertPrepare(actor);
    required(body, ['project', 'cutoff_date']);
    return idempotent(tx, req, firmId, 'POST /billing/drafts', async () => {
      const p = await findProject(tx, body.project);
      const cutoff = isoDate(body.cutoff_date, 'cutoff_date');
      const only: string[] | undefined = Array.isArray(body.time_entry_ids) ? body.time_entry_ids : undefined;
      // Serialises NTE arithmetic per component. The unique index is what actually stops double billing.
      await tx.query('select id from fee_component where project_id = $1 order by id for update', [p.id]);
      // Checked after the lock, so a request that waited behind a concurrent draft sees that draft and gets the 409.
      if (only) {
        const taken = (await tx.query(
          `select d.draft_no, d.id from source_allocation s join billing_line l on l.id = s.billing_line_id join billing_draft d on d.id = l.billing_draft_id
           where s.source_type = 'time_entry' and s.source_id = any($1::uuid[]) and s.active limit 1`, [only],
        )).rows[0];
        if (taken) throw conflict('ALREADY_CLAIMED', `This work is already in ${taken.draft_no}.`, { conflicting_draft_id: taken.id, conflicting_draft_no: taken.draft_no });
      }
      const ready = await readyFor(tx, p.id, cutoff, only);
      const items = only ? ready.items.filter((i) => i.line_type.startsWith('hourly')) : ready.items;
      if (!items.length) throw ruleError('F13', 'Nothing is ready to bill on this project at this cutoff.');
      const no = `DRAFT-${String((await tx.query(`select nextval('billing_draft_seq') n`)).rows[0].n).padStart(4, '0')}`;
      const d = (await tx.query(
        `insert into billing_draft (firm_id, draft_no, client_id, project_id, cutoff_date, idempotency_key, prepared_by, created_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
        [firmId, no, p.client_id, p.id, cutoff, randomUUID(), actor.id],
      )).rows[0];
      for (const i of items) {
        const line = (await tx.query(
          `insert into billing_line (firm_id, billing_draft_id, phase_id, fee_component_id, line_type, label, calculation_basis, previous_net_billing, current_claim, remaining_entitlement, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [firmId, d.id, i.phase_id, i.fee_component_id, i.line_type, i.label, JSON.stringify(i.basis), fromPaise(i.previous), fromPaise(i.claim), i.remaining == null ? null : fromPaise(i.remaining), actor.id],
        )).rows[0];
        for (const s of i.sources) {
          await tx.query(`insert into source_allocation (firm_id, billing_line_id, source_type, source_id, amount_claimed, created_by) values ($1,$2,$3,$4,$5,$6)`, [firmId, line.id, s.type, s.id, fromPaise(s.amount), actor.id]);
          if (s.type === 'time_entry') await tx.query(`update time_entry set billing_state = 'Reserved' where id = $1`, [s.id]);
          if (s.type === 'milestone') await tx.query(`update billing_milestone set status = 'Drafted' where id = $1`, [s.id]);
          if (s.type === 'supplier_bill') await tx.query(`update supplier_bill set recharge_state = 'Reserved' where id = $1`, [s.id]);
        }
        if (i.line_type === 'hourly_nte') {
          await tx.query(`insert into nte_ledger (firm_id, fee_component_id, entry_type, amount, billing_draft_id, created_by) values ($1,$2,'reserved',$3,$4,$5)`, [firmId, i.fee_component_id, fromPaise(i.claim), d.id, actor.id]);
          if (i.excess) await tx.query(`insert into nte_ledger (firm_id, fee_component_id, entry_type, amount, billing_draft_id, note, created_by) values ($1,$2,'excess',$3,$4,'Not billable without a change',$5)`, [firmId, i.fee_component_id, fromPaise(i.excess), d.id, actor.id]);
        }
      }
      const audit_event_id = await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'create', next: { draft_no: no, lines: items.length } });
      return { ...(await draftView(tx, await loadDraft(tx, d.id))), audit_event_id };
    });
  });

  /** AC-F13-6: only a Draft can be edited. Tax mapping is a code finance enters; nothing derives it (R24). */
  put('/billing/drafts/:id', async ({ tx, actor, firmId, params, body }) => {
    assertPrepare(actor);
    const d = await loadDraft(tx, params.id, true);
    if (d.approval_state !== 'Draft') throw conflict('INVALID_TRANSITION', `A draft that is ${d.approval_state} cannot be edited.`, { from: d.approval_state });
    if (body.cutoff_date) await tx.query('update billing_draft set cutoff_date = $2, updated_at = now(), updated_by = $3 where id = $1', [d.id, isoDate(body.cutoff_date, 'cutoff_date'), actor.id]);
    for (const l of body.lines ?? []) await tx.query('update billing_line set tax_mapping_code = $3, updated_at = now(), updated_by = $4 where id = $1 and billing_draft_id = $2', [l.id, d.id, l.tax_mapping_code ?? null, actor.id]);
    await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'update' });
    return draftView(tx, await loadDraft(tx, d.id));
  });

  post('/billing/drafts/:id/pm-confirm', async ({ tx, actor, firmId, params }) => {
    const d = await loadDraft(tx, params.id, true);
    authorize(actor, 'billing.prepare', { projectId: d.project_id });
    await tx.query('update billing_draft set pm_confirmed_by = $2, updated_at = now(), updated_by = $2 where id = $1', [d.id, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'pm_confirm' });
    return { ok: true, audit_event_id };
  });

  /** Sending for review queues it for a principal (OQ-3 default: finance prepares, principal approves). */
  post('/billing/drafts/:id/review', async ({ tx, actor, firmId, params }) => {
    assertPrepare(actor);
    const d = await loadDraft(tx, params.id, true);
    let to: string;
    try { to = transition('draftApproval', d.approval_state, 'review'); } catch (e) { rethrowTransition(e); }
    await tx.query('update billing_draft set approval_state = $2, updated_at = now(), updated_by = $3 where id = $1', [d.id, to!, actor.id]);
    const principal = (await tx.query(
      `select g.person_id from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id where s.key = 'principal' and p.login_state = 'Enabled' and g.person_id <> $1 order by p.ref_code limit 1`, [actor.id],
    )).rows[0];
    const approver = principal ? await routeApprover(tx, principal.person_id, actor.id) : actor.id;
    const ar = (await tx.query(
      `insert into approval_request (firm_id, type, record_type, record_id, project_id, submitter_id, approver_id, created_by) values ($1,'billing_draft','billing_draft',$2,$3,$4,$5,$4) returning id`,
      [firmId, d.id, d.project_id, actor.id, approver],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'review' });
    return { approval_state: to!, approval_request_id: ar.id, audit_event_id };
  });

  post('/billing/drafts/:id/reject', async ({ tx, actor, firmId, params, body }) => {
    assertPrepare(actor);
    required(body, ['reason']);
    await rejectDraftInTx(tx, actor, firmId, params.id, body.reason);
    await tx.query(`update approval_request set status = 'Rejected', updated_at = now() where record_id = (select id from billing_draft where id::text = $1 or draft_no = $1) and status = 'Pending'`, [params.id]);
    return { approval_state: 'Rejected' };
  });

  /**
   * AC-F13-4 and F17. The job row commits before the adapter is called, so a timeout leaves a record.
   * An Uncertain job can never be retried; reconcile must look it up by key first.
   */
  post('/billing/drafts/:id/submit', async ({ tx, actor, firmId, params, body }) => {
    authorize(actor, 'accounting.finalize');
    const d = await loadDraft(tx, params.id, true);
    if (d.approval_state !== 'Approved') throw conflict('INVALID_TRANSITION', 'Only an approved draft can be submitted.', { from: d.approval_state });
    if (d.accounting_state === 'Uncertain') throw conflict('UNCERTAIN_RECONCILE_FIRST', 'The last submission timed out. Reconcile it before trying again, so nothing is sent twice.');
    if (d.accounting_state === 'Finalized') throw conflict('INVALID_TRANSITION', 'This draft is already finalized.', { from: d.accounting_state });
    try { transition('draftAccounting', d.accounting_state, 'submit'); } catch (e) { rethrowTransition(e); }
    const firm = (await tx.query('select accounting_adapter from firm')).rows[0];
    const adapter = adapterFor(firm.accounting_adapter);
    const job = (await tx.query(
      `insert into integration_job (firm_id, adapter, direction, record_type, record_id, idempotency_key, attempts, status, created_by) values ($1,$2,'outbound','billing_draft',$3,$4,1,'Running',$5)
       on conflict (firm_id, idempotency_key) do update set attempts = integration_job.attempts + 1, status = 'Running', updated_at = now() returning id`,
      [firmId, adapter.key, d.id, d.idempotency_key, actor.id],
    )).rows[0];
    await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'submit', next: { adapter: adapter.key } });
    try {
      const result = await adapter.submitDraft({ draftNo: d.draft_no, net: await draftTotal(tx, d.id) }, d.idempotency_key, { simulate: adapter.key === 'mock' ? body.simulate : undefined });
      await tx.query(`update integration_job set status = 'Succeeded', external_id = $2, updated_at = now() where id = $1`, [job.id, result?.external_id ?? null]);
      if (!result) {
        await tx.query(`update billing_draft set accounting_state = 'Pending', updated_at = now() where id = $1`, [d.id]);
        return { accounting_state: 'Pending', adapter: adapter.label };
      }
      const inv = await finalize(tx, actor, firmId, d, result);
      return { accounting_state: 'Finalized', adapter: adapter.label, external_invoice: inv };
    } catch (e) {
      if (e instanceof AdapterTimeout) {
        await tx.query(`update integration_job set status = 'Uncertain', last_error = $2, updated_at = now() where id = $1`, [job.id, e.message]);
        await tx.query(`update billing_draft set accounting_state = 'Uncertain', updated_at = now() where id = $1`, [d.id]);
        return { accounting_state: 'Uncertain', adapter: adapter.label, message: 'The accounting system did not answer. Reconcile before retrying.' };
      }
      await tx.query(`update integration_job set status = 'Failed', last_error = $2, updated_at = now() where id = $1`, [job.id, e instanceof Error ? e.message : 'failed']);
      await tx.query(`update billing_draft set accounting_state = 'Failed', updated_at = now() where id = $1`, [d.id]);
      return { accounting_state: 'Failed', adapter: adapter.label, message: e instanceof Error ? e.message : 'failed' };
    }
  });

  post('/billing/drafts/:id/reconcile', async ({ tx, actor, firmId, params }) => {
    authorize(actor, 'accounting.finalize');
    const d = await loadDraft(tx, params.id, true);
    if (d.accounting_state !== 'Uncertain') throw conflict('INVALID_TRANSITION', 'Only an uncertain submission needs reconciling.', { from: d.accounting_state });
    const firm = (await tx.query('select accounting_adapter from firm')).rows[0];
    const found = await adapterFor(firm.accounting_adapter).lookupByKey(d.idempotency_key);
    if (!found) {
      await tx.query(`update integration_job set status = 'Failed', last_error = 'Not found on lookup', updated_at = now() where idempotency_key = $1`, [d.idempotency_key]);
      await tx.query(`update billing_draft set accounting_state = 'Failed', updated_at = now() where id = $1`, [d.id]);
      await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'reconcile', next: { found: false } });
      return { accounting_state: 'Failed', found: false };
    }
    await tx.query(`update integration_job set status = 'Succeeded', external_id = $2, updated_at = now() where idempotency_key = $1`, [d.idempotency_key, found.external_id]);
    const inv = await finalize(tx, actor, firmId, d, found);
    await audit(tx, actor, firmId, { recordType: 'billing_draft', recordId: d.id, action: 'reconcile', next: { found: true, external_id: found.external_id } });
    return { accounting_state: 'Finalized', found: true, external_invoice: inv };
  });

  get('/billing/drafts/:id/accounting-status', async ({ tx, actor, params }) => {
    const d = await loadDraft(tx, params.id);
    authorize(actor, 'billing.prepare', { projectId: d.project_id, read: true });
    const job = (await tx.query('select status, attempts, last_error, external_id, adapter, updated_at from integration_job where record_id = $1 order by created_at desc limit 1', [d.id])).rows[0];
    return { accounting_state: d.accounting_state, job: job ?? null };
  });

  /** The CSV adapter's return leg: the accounting system's invoice comes back and is frozen. */
  post('/billing/drafts/:id/import-final', async ({ tx, actor, firmId, params, body }) => {
    authorize(actor, 'accounting.finalize');
    required(body, ['external_id', 'invoice_no', 'issue_date', 'due_date']);
    const d = await loadDraft(tx, params.id, true);
    if (d.accounting_state !== 'Pending') throw conflict('INVALID_TRANSITION', 'Only a draft waiting on accounting can be finalized.', { from: d.accounting_state });
    const inv = await finalize(tx, actor, firmId, d, { external_id: body.external_id, invoice_no: body.invoice_no, issue_date: isoDate(body.issue_date, 'issue_date'), due_date: isoDate(body.due_date, 'due_date'), gross: body.gross, tax: body.tax, net: body.net });
    return { accounting_state: 'Finalized', external_invoice: inv };
  });

  get('/billing/wip', async ({ tx, actor, query, req }) => {
    const projects = await scopeOf(tx, actor, query.project);
    const out = [];
    for (const p of projects) {
      const q = (await tx.query(
        `select coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Submitted'),0) as awaiting_approval,
           coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Approved' and te.billing_state = 'Unbilled'),0) as approved_unbilled,
           coalesce(sum(te.duration_hours) filter (where te.billing_state = 'Reserved'),0) as reserved
         from time_entry te where te.project_id = $1`, [p.id],
      )).rows[0];
      const ready = await readyFor(tx, p.id, new Date().toISOString().slice(0, 10));
      const drafted = (await tx.query(`select coalesce(sum(l.current_claim),0) v from billing_line l join billing_draft d on d.id = l.billing_draft_id where d.project_id = $1 and d.approval_state <> 'Rejected' and d.accounting_state <> 'Finalized'`, [p.id])).rows[0].v;
      const invoiced = (await tx.query('select coalesce(sum(net),0) v from external_invoice where project_id = $1', [p.id])).rows[0].v;
      out.push({
        project: { id: p.id, code: p.code, name: p.name }, awaiting_approval_hours: hours(q.awaiting_approval), approved_unbilled_hours: hours(q.approved_unbilled), reserved_hours: hours(q.reserved),
        ready: money(ready.items.reduce((s, i) => s + i.claim, 0)), in_drafts: money(drafted), invoiced: money(invoiced), label: 'Operational, not statutory accounting WIP',
      });
    }
    return list(req, out);
  });
}
