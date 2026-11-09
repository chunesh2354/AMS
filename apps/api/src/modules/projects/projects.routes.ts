import { fixedFeeClaim, fromPaise, hoursValue, toPaise } from '@ams/domain';
import { ApiError, conflict, notFound, ruleError } from '../../http/errors';
import { assertProjectVisible, authorize, can, visibleProjects } from '../../auth/authorize';
import { audit } from '../../audit/audit';
import { fenceAggregate } from '../../auth/redaction';
import { hours, list, money } from '../../http/responses';
import { isUuid, moneyAmount, required, uuidParam } from '../../http/validation';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { setupRoutes } from './setup.routes';
import { assertPeopleExist, memberRoutes, MEMBER_ROLES, type MemberRole } from './members.routes';

export const ACTUAL_SQL = `(approval_state = 'Approved' or (approval_state = 'Amended' and billing_state = 'Billed'))`;

export async function findProject(tx: Tx, code: string) {
  const p = (await tx.query(
    `select p.*, c.name as client_name, pm.ref_code as pm_ref, pm.name as pm_name from project p
     join client c on c.id = p.client_id join person pm on pm.id = p.pm_id where p.code = $1 or p.id::text = $1`, [code],
  )).rows[0];
  if (!p) throw notFound('Project');
  return p;
}

async function phasesOf(tx: Tx, projectId: string) {
  return (await tx.query(
    `select ph.*, o.ref_code as owner_ref, o.name as owner_name,
       coalesce((select sum(bl.hours) from budget_line bl join budget_version bv on bv.id = bl.budget_version_id where bl.phase_id = ph.id and bv.status = 'Approved'), 0) as budget_hours,
       ph.opening_actual_hours + coalesce((select sum(te.duration_hours) from time_entry te where te.phase_id = ph.id and ${ACTUAL_SQL}), 0) as actual_hours,
       coalesce((select sum(a.amount) from phase_fee_allocation a where a.phase_id = ph.id), 0) as fee
     from phase ph left join person o on o.id = ph.owner_id where ph.project_id = $1 order by ph.sort_order`, [projectId],
  )).rows;
}

/** Four separate values (R9). Delivery progress lives on the phase and never feeds these. */
async function entitlementOf(tx: Tx, projectId: string) {
  const contracted = (await tx.query(`select coalesce(sum(coalesce(contracted_amount, cap_amount, 0)), 0) as v from fee_component where project_id = $1`, [projectId])).rows[0].v;
  const auth = (await tx.query(
    `select a.amount, (select max(f.cumulative_percent) from fee_authorization f where f.phase_fee_allocation_id = a.id) as pct
     from phase_fee_allocation a join fee_component c on c.id = a.fee_component_id where c.project_id = $1 and c.billing_method in ('fixed_percent','fixed_milestone')`, [projectId],
  )).rows;
  let entitled = auth.reduce((s, r) => s + (r.pct ? fixedFeeClaim(toPaise(r.amount), r.pct, 0).entitlement : 0), 0);
  entitled += toPaise((await tx.query(
    `select coalesce(sum(m.amount),0) v from billing_milestone m join fee_component c on c.id = m.fee_component_id where c.project_id = $1 and m.status <> 'Planned'`, [projectId],
  )).rows[0].v);
  const claims = (await tx.query(
    `select coalesce(sum(l.current_claim) filter (where l.line_type not in ('recharge','fixed_progress','percent_schedule')),0) as other, coalesce(sum(l.current_claim),0) as drafted
     from billing_line l join billing_draft d on d.id = l.billing_draft_id where d.project_id = $1 and d.approval_state <> 'Rejected'`, [projectId],
  )).rows[0];
  entitled += toPaise(claims.other);
  const invoiced = (await tx.query(`select coalesce(sum(net),0) v from external_invoice where project_id = $1`, [projectId])).rows[0].v;
  const collected = (await tx.query(`select coalesce(sum(s.amount),0) v from settlement s join external_invoice i on i.id = s.external_invoice_id where i.project_id = $1`, [projectId])).rows[0].v;
  return { contracted: money(contracted), entitled: money(fromPaise(entitled)), drafted: money(claims.drafted), invoiced: money(invoiced), collected: money(collected) };
}

/** Labour cost at the rate stored at approval. A gap is listed, never counted as zero (R22). */
async function labourOf(tx: Tx, projectId: string) {
  const rows = (await tx.query(
    `select te.person_id, p.name, te.duration_hours, r.amount as cost_rate from time_entry te join person p on p.id = te.person_id
     left join rate_schedule r on r.id = te.cost_rate_schedule_id where te.project_id = $1 and ${ACTUAL_SQL.replace(/approval_state/g, 'te.approval_state').replace(/billing_state/g, 'te.billing_state')}`, [projectId],
  )).rows;
  const missing = new Set<string>();
  let total = 0;
  for (const r of rows) {
    if (r.cost_rate == null) missing.add(`${r.name} cost rate`);
    else total += hoursValue(r.duration_hours, r.cost_rate);
  }
  return { total, missing: [...missing], people: new Set(rows.map((r) => r.person_id)).size };
}

export async function projectView(tx: Tx, p: any, actor: Actor) {
  const phases = await phasesOf(tx, p.id);
  const budget = phases.reduce((s, x) => s + Number(x.budget_hours), 0);
  const actual = phases.reduce((s, x) => s + Number(x.actual_hours), 0);
  const etc = phases.reduce((s, x) => s + Number(x.etc_hours), 0);
  const weight = phases.reduce((s, x) => s + Number(x.fee), 0);
  const delivery = weight ? phases.reduce((s, x) => s + Number(x.delivery_progress_pct) * Number(x.fee), 0) / weight : 0;
  const entitlement = await entitlementOf(tx, p.id);
  const labour = await labourOf(tx, p.id);
  const openingMissing = phases.some((x) => Number(x.opening_actual_hours) > 0) ? ['Imported opening hours have no stored cost'] : [];
  const missing = [...labour.missing, ...openingMissing];
  const contributionValue = toPaise(entitlement.entitled!.amount) - labour.total;
  return {
    id: p.id, code: p.code, name: p.name, client: p.client_name, client_id: p.client_id, status: p.status, hold_reason: p.hold_reason, contract: p.contract_summary,
    pm: { id: p.pm_id, ref_code: p.pm_ref, name: p.pm_name },
    hours: { budget: hours(budget), actual: hours(actual), forecast: hours(actual + etc) },
    delivery_progress_pct: Math.round(delivery),
    entitlement,
    labour_cost: fenceAggregate(actor, labour.people, { value: money(labour.total), complete: missing.length === 0, missing }),
    contribution: { value: money(contributionValue), complete: missing.length === 0, missing, label: 'Management estimate' },
    phases: phases.map((x) => ({
      id: x.id, code: x.code, name: x.name, start_date: x.start_date, end_date: x.end_date, owner: x.owner_id ? { id: x.owner_id, ref_code: x.owner_ref, name: x.owner_name } : null,
      budget_hours: hours(x.budget_hours), actual_hours: hours(x.actual_hours), etc_hours: hours(x.etc_hours), forecast_hours: hours(Number(x.actual_hours) + Number(x.etc_hours)),
      delivery_progress_pct: Number(x.delivery_progress_pct), fee: money(x.fee), status: x.status,
    })),
  };
}

const BILLING_METHODS = ['fixed_milestone', 'fixed_percent', 'hourly', 'hourly_nte', 'percent_construction', 'consultant_recharge'];
const FIXED = ['fixed_percent', 'fixed_milestone'];
const bad = (field: string, code: string, message: string) => new ApiError(400, 'VALIDATION', message, [{ field, code }]);

/**
 * Phase fees for a fixed fee. Each is a number of at least zero; when any is given they must add up to the
 * contracted fee (in paise, so rounding cannot hide a gap). Returns the contracted amount to store.
 */
function feeAllocations(body: any): string | number | null {
  const contracted = body.contracted_amount == null || body.contracted_amount === '' ? null : Number(body.contracted_amount);
  if (contracted != null && !(Number.isFinite(contracted) && contracted >= 0)) throw bad('contracted_amount', 'range', 'The contracted fee must be zero or more.');
  // Within the money column and at most two decimals, so a huge or fractional-paise amount is a 400, not a database error.
  if (contracted != null) moneyAmount(contracted, 'contracted_amount', 'The contracted fee');
  const fees = (body.phases as any[]).map((ph) => ph?.fee);
  fees.forEach((f, i) => {
    if (f != null && !(typeof f === 'number' || (typeof f === 'string' && f.trim() !== ''))) throw bad(`phases[${i}].fee`, 'number', 'A phase fee must be a number.');
    if (f != null && !(Number.isFinite(Number(f)) && Number(f) >= 0)) throw bad(`phases[${i}].fee`, 'range', 'A phase fee must be zero or more.');
    if (f != null) moneyAmount(f, `phases[${i}].fee`, 'A phase fee');
  });
  const given = fees.filter((f) => f != null);
  if (!given.length) return contracted;
  if (!FIXED.includes(body.billing_method) && given.some((f) => Number(f) > 0)) throw bad('phases', 'fee_not_fixed', 'Phase fees apply to a fixed fee only.');
  const sum = given.reduce((s, f) => s + toPaise(Number(f)), 0);
  if (contracted == null) return FIXED.includes(body.billing_method) ? fromPaise(sum) : null;
  if (FIXED.includes(body.billing_method) && sum !== toPaise(contracted)) {
    throw new ApiError(400, 'VALIDATION', `The phase fees add up to ${fromPaise(sum)}, not the contracted fee of ${fromPaise(toPaise(contracted))}.`, [{ field: 'phases', code: 'fee_sum' }]);
  }
  return contracted;
}

/** Percent of construction cost: above 0, at most 100, at most four decimals (numeric(7,4)). */
function feePercent(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw bad('fee_percent', 'range', 'The fee percent is above 0 and at most 100.');
  if (Math.abs(n * 10_000 - Math.round(n * 10_000)) > 1e-6) throw bad('fee_percent', 'precision', 'The fee percent can have at most four decimals.');
  return n;
}

/** The team from the wizard: [{ person_id, role }], role defaulting to contributor. */
function membersOf(body: any): { person_id: string; role: MemberRole }[] {
  if (body.members == null) return [];
  if (!Array.isArray(body.members)) throw bad('members', 'array', 'The team must be a list of people.');
  const seen = new Set<string>();
  const out: { person_id: string; role: MemberRole }[] = [];
  body.members.forEach((m: any, i: number) => {
    const role = m?.role ?? 'contributor';
    if (!m || typeof m.person_id !== 'string') throw bad(`members[${i}].person_id`, 'required', 'Each team member needs a person.');
    if (!MEMBER_ROLES.includes(role)) throw bad(`members[${i}].role`, 'enum', `A team role is one of ${MEMBER_ROLES.join(', ')}.`);
    if (seen.has(m.person_id)) return;
    seen.add(m.person_id);
    out.push({ person_id: m.person_id, role });
  });
  return out;
}

/** The creating principal, else the firm's first active principal (so a PM's own time has someone to go to). */
async function defaultPrincipal(tx: Tx, actor: Actor): Promise<string | null> {
  if (actor.sets.includes('principal')) return actor.id;
  const r = (await tx.query(
    `select g.person_id from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id
     where s.key = 'principal' and p.login_state = 'Enabled' and p.employment_state = 'Active' order by p.ref_code limit 1`,
  )).rows[0];
  return r?.person_id ?? null;
}

export function projectRoutes(api: Api) {
  const { get, post, put } = api;
  setupRoutes(api);
  memberRoutes(api);
  get('/projects', async ({ tx, actor, req }) => {
    const v = visibleProjects(actor);
    const rows = (await tx.query(
      `select p.*, c.name as client_name, pm.ref_code as pm_ref, pm.name as pm_name from project p join client c on c.id = p.client_id join person pm on pm.id = p.pm_id
       where ($1::uuid[] is null or p.id = any($1)) order by p.code`, [v === 'all' ? null : v],
    )).rows;
    // One transaction client: run the queries one after another (pg does not queue overlapping calls safely).
    const out: Awaited<ReturnType<typeof projectView>>[] = [];
    for (const p of rows) out.push(await projectView(tx, p, actor));
    return list(req, out);
  });

  get('/projects/:code', async ({ tx, actor, params }) => {
    const p = await findProject(tx, params.code);
    assertProjectVisible(actor, p.id);
    return projectView(tx, p, actor);
  });

  get('/clients', async ({ tx, actor, req }) => {
    authorize(actor, 'projects.create');
    return list(req, (await tx.query('select id, name from client order by name')).rows);
  });

  // Creates a project with its first contract version, fee component, phases and PM membership in one transaction.
  post('/projects', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'projects.create');
    required(body, ['code', 'name', 'client_id', 'pm_id', 'billing_method', 'phases']);
    if (!Array.isArray(body.phases) || !body.phases.length) throw ruleError('F06', 'A project needs at least one phase.');
    if (body.billing_method === 'hourly_nte' && body.cap_amount == null) throw ruleError('F07', 'An hourly NTE component needs a cap.');
    if (!BILLING_METHODS.includes(body.billing_method)) throw new ApiError(400, 'VALIDATION', 'Choose a fee basis.', [{ field: 'billing_method', code: 'enum' }]);
    if (body.cap_amount != null) moneyAmount(body.cap_amount, 'cap_amount', 'The cap', { positive: true });
    if (body.fee_percent != null) feePercent(body.fee_percent);
    const contracted = feeAllocations(body);
    const members = membersOf(body);
    if (!isUuid(body.client_id) || !(await tx.query('select 1 from client where id = $1', [body.client_id])).rowCount) throw bad('client_id', 'unknown', 'Choose a client from this studio.');
    await assertPeopleExist(tx, [body.pm_id], 'pm_id');
    const principalId = body.principal_id ?? await defaultPrincipal(tx, actor);
    if (principalId) await assertPeopleExist(tx, [principalId], 'principal_id');
    await assertPeopleExist(tx, members.map((m) => m.person_id), 'members');
    const dup = await tx.query('select id from project where code = $1', [body.code]);
    if (dup.rowCount) throw conflict('DUPLICATE_CODE', `Project ${body.code} already exists.`, { conflicting_id: dup.rows[0].id });
    const p = (await tx.query(
      `insert into project (firm_id, code, name, client_id, pm_id, principal_id, contract_summary, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [firmId, body.code, body.name, body.client_id, body.pm_id, principalId, body.contract_summary ?? null, actor.id],
    )).rows[0];
    await tx.query(`insert into project_membership (firm_id, project_id, person_id, project_role, created_by) values ($1,$2,$3,'pm',$4)`, [firmId, p.id, body.pm_id, actor.id]);
    // The team picked in the wizard, so staff can see the project and log time on it from day one.
    for (const m of members.filter((x) => x.person_id !== body.pm_id)) {
      await tx.query(`insert into project_membership (firm_id, project_id, person_id, project_role, created_by) values ($1,$2,$3,$4,$5)`, [firmId, p.id, m.person_id, m.role, actor.id]);
    }
    const cv = (await tx.query(`insert into contract_version (firm_id, project_id, version_no, effective_from, created_by) values ($1,$2,1,current_date,$3) returning id`, [firmId, p.id, actor.id])).rows[0];
    const fc = (await tx.query(
      `insert into fee_component (firm_id, contract_version_id, project_id, key, name, billing_method, contracted_amount, fee_percent, cap_amount, created_by)
       values ($1,$2,$3,'main',$4,$5,$6,$7,$8,$9) returning id`,
      [firmId, cv.id, p.id, body.fee_name ?? 'Design services', body.billing_method, contracted, body.fee_percent ?? null, body.cap_amount ?? null, actor.id],
    )).rows[0];
    const bv = (await tx.query(`insert into budget_version (firm_id, project_id, version_no, kind, created_by) values ($1,$2,1,'baseline',$3) returning id`, [firmId, p.id, actor.id])).rows[0];
    let order = 0;
    for (const ph of body.phases) {
      required(ph, ['code', 'name']);
      const row = (await tx.query(
        `insert into phase (firm_id, project_id, code, name, start_date, end_date, sort_order, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [firmId, p.id, ph.code, ph.name, ph.start_date ?? null, ph.end_date ?? null, order++, actor.id],
      )).rows[0];
      await tx.query(`insert into phase_fee_allocation (firm_id, phase_id, fee_component_id, amount, created_by) values ($1,$2,$3,$4,$5)`, [firmId, row.id, fc.id, ph.fee ?? 0, actor.id]);
      if (ph.budget_hours != null) await tx.query(`insert into budget_line (firm_id, budget_version_id, phase_id, hours, created_by) values ($1,$2,$3,$4,$5)`, [firmId, bv.id, row.id, ph.budget_hours, actor.id]);
    }
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'project', recordId: p.id, action: 'create', next: { code: body.code, name: body.name, principal_id: principalId, members: members.length } });
    return { id: p.id, code: body.code, principal_id: principalId, audit_event_id };
  });

  /** R8: delivery progress is entered by a PM. Logging hours never touches it. */
  put('/phases/:id/progress', async ({ tx, actor, firmId, params, body }) => {
    const id = uuidParam(params.id, 'Phase');
    const ph = (await tx.query('select id, project_id, delivery_progress_pct, etc_hours from phase where id = $1', [id])).rows[0];
    if (!ph) throw notFound('Phase');
    authorize(actor, 'projects.plan', { projectId: ph.project_id });
    const pct = body.delivery_progress_pct ?? ph.delivery_progress_pct;
    const etc = body.etc_hours ?? ph.etc_hours;
    if (Number(pct) < 0 || Number(pct) > 100) throw new ApiError(400, 'VALIDATION', 'Delivery progress must be 0 to 100.', [{ field: 'delivery_progress_pct', code: 'range' }]);
    await tx.query('update phase set delivery_progress_pct = $2, etc_hours = $3, updated_by = $4, updated_at = now() where id = $1', [id, pct, etc, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'phase', recordId: id, action: 'update_progress', previous: { delivery_progress_pct: ph.delivery_progress_pct, etc_hours: ph.etc_hours }, next: { delivery_progress_pct: pct, etc_hours: etc } });
    return { ok: true, audit_event_id };
  });

  get('/projects/:code/time', async ({ tx, actor, params, req }) => {
    const p = await findProject(tx, params.code);
    if (!can(actor, 'time.approve', { projectId: p.id, read: true }) && !can(actor, 'reports.project', { projectId: p.id })) authorize(actor, 'reports.project', { projectId: p.id });
    const rows = (await tx.query(
      `select te.person_id, pe.ref_code, pe.name as person, ph.id as phase_id, ph.name as phase,
         coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Draft'),0) as draft,
         coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Submitted'),0) as submitted,
         coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Returned'),0) as returned,
         coalesce(sum(te.duration_hours) filter (where te.approval_state = 'Approved'),0) as approved,
         max(te.return_reason) filter (where te.approval_state = 'Returned') as return_reason
       from time_entry te join person pe on pe.id = te.person_id join phase ph on ph.id = te.phase_id
       where te.project_id = $1 group by te.person_id, pe.ref_code, pe.name, ph.id, ph.name order by pe.ref_code, ph.name`, [p.id],
    )).rows;
    return list(req, rows.map((r) => ({
      person: { id: r.person_id, ref_code: r.ref_code, name: r.person }, phase: { id: r.phase_id, name: r.phase },
      draft: hours(r.draft), submitted: hours(r.submitted), returned: hours(r.returned), approved: hours(r.approved), return_reason: r.return_reason,
    })));
  });
}
