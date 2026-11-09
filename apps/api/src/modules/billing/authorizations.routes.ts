import { toPaise } from '@ams/domain';
import { ApiError, conflict, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize, can } from '../../auth/authorize';
import { money } from '../../http/responses';
import { hasTwoDecimals, isUuid, moneyAmount, required, uuidParam } from '../../http/validation';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { findProject } from '../projects/projects.routes';

const FIXED = ['fixed_percent', 'fixed_milestone'];
const SCHEDULED = ['fixed_milestone', 'percent_construction'];
const bad = (field: string, code: string, message: string) => new ApiError(400, 'VALIDATION', message, [{ field, code }]);

/**
 * Authorizing fee for billing is a principal's call: changes.authorize, or billing.approve where it was granted
 * (matrix: both firm-wide for principals; billing.approve by explicit grant for finance). The 403 names changes.authorize.
 */
export const mayAuthorizeFee = (actor: Actor) => can(actor, 'changes.authorize') || can(actor, 'billing.approve');
const assertMayAuthorize = (actor: Actor) => { if (!mayAuthorizeFee(actor)) authorize(actor, 'changes.authorize'); };

/** A percent with at most two decimals, above 0 and at most 100. */
function percentOf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw bad('cumulative_percent', 'number', 'Enter the cumulative percent complete.');
  if (n <= 0 || n > 100) throw bad('cumulative_percent', 'range', 'The cumulative percent is above 0 and at most 100.');
  if (!hasTwoDecimals(n)) throw bad('cumulative_percent', 'precision', 'Use at most two decimals.');
  return Math.round(n * 100) / 100;
}

/** Phases with their fixed-fee allocation and every authorized level, plus the milestone schedule. */
async function feePlan(tx: Tx, projectId: string) {
  const phases = (await tx.query(
    `select ph.id as phase_id, ph.code, ph.name, a.id as allocation_id, a.amount, c.billing_method, c.name as component
     from phase ph left join phase_fee_allocation a on a.phase_id = ph.id
       and a.fee_component_id = (select c2.id from fee_component c2 join phase_fee_allocation a2 on a2.fee_component_id = c2.id where a2.phase_id = ph.id order by (c2.billing_method in ('fixed_percent','fixed_milestone')) desc, c2.created_at limit 1)
     left join fee_component c on c.id = a.fee_component_id
     where ph.project_id = $1 order by ph.sort_order`, [projectId],
  )).rows;
  const auths = (await tx.query(
    `select f.id, f.phase_fee_allocation_id, f.cumulative_percent, f.note, f.authorized_at, pe.name as authorized_by
     from fee_authorization f join phase_fee_allocation a on a.id = f.phase_fee_allocation_id join phase ph on ph.id = a.phase_id left join person pe on pe.id = f.authorized_by
     where ph.project_id = $1 order by f.cumulative_percent`, [projectId],
  )).rows;
  const miles = (await tx.query(
    `select m.id, m.label, m.amount, m.status, m.phase_id, ph.name as phase, c.billing_method from billing_milestone m join fee_component c on c.id = m.fee_component_id
     left join phase ph on ph.id = m.phase_id where c.project_id = $1 order by m.created_at`, [projectId],
  )).rows;
  const components = (await tx.query('select id, name, billing_method from fee_component where project_id = $1 order by created_at', [projectId])).rows;
  return {
    components: components.map((c) => ({ id: c.id, name: c.name, billing_method: c.billing_method })),
    phases: phases.map((r) => {
      const levels = auths.filter((x) => x.phase_fee_allocation_id === r.allocation_id);
      return {
        phase_id: r.phase_id, code: r.code, name: r.name, component: r.component, billing_method: r.billing_method,
        fee: money(r.amount ?? 0), fixed: FIXED.includes(r.billing_method),
        authorized_percent: levels.length ? Number(levels[levels.length - 1].cumulative_percent) : 0,
        authorizations: levels.map((x) => ({ id: x.id, cumulative_percent: Number(x.cumulative_percent), note: x.note, authorized_at: x.authorized_at, authorized_by: x.authorized_by })),
      };
    }),
    milestones: miles.map((m) => ({ id: m.id, label: m.label, amount: money(m.amount), status: m.status, phase_id: m.phase_id, phase: m.phase, billing_method: m.billing_method })),
  };
}

/** F13 inputs: fee authorized per phase, and milestones authorized for billing. GET /billing/ready then shows what they release. */
export function feeAuthorizationRoutes({ get, post }: Api) {
  get('/projects/:code/fee-authorizations', async ({ tx, actor, params }) => {
    const p = await findProject(tx, params.code);
    if (!mayAuthorizeFee(actor)) authorize(actor, 'billing.prepare', { projectId: p.id, read: true });
    return { project: { id: p.id, code: p.code, name: p.name }, can_authorize: mayAuthorizeFee(actor), ...(await feePlan(tx, p.id)) };
  });

  post('/projects/:code/fee-authorizations', async ({ tx, actor, firmId, params, body }) => {
    const p = await findProject(tx, params.code);
    assertMayAuthorize(actor);
    required(body, ['phase_id', 'cumulative_percent']);
    if (!isUuid(body.phase_id)) throw bad('phase_id', 'unknown', 'Choose a phase of this project.');
    const pct = percentOf(body.cumulative_percent);
    if (body.note != null && typeof body.note !== 'string') throw bad('note', 'string', 'The note must be text.');
    const ph = (await tx.query('select id, name from phase where id = $1 and project_id = $2', [body.phase_id, p.id])).rows[0];
    if (!ph) throw bad('phase_id', 'unknown', 'Choose a phase of this project.');
    const a = (await tx.query(
      `select a.id, a.amount from phase_fee_allocation a join fee_component c on c.id = a.fee_component_id
       where a.phase_id = $1 and c.billing_method in ('fixed_percent','fixed_milestone') order by c.created_at limit 1 for update of a`, [ph.id],
    )).rows[0];
    if (!a) throw ruleError('F13', `${ph.name} has no fixed fee to authorize. Hourly work is billed from approved time.`);
    if (!(toPaise(a.amount) > 0)) throw ruleError('F13', `${ph.name} has no fee allocated, so there is nothing to authorize.`);
    const prev = Number((await tx.query('select coalesce(max(cumulative_percent), 0) v from fee_authorization where phase_fee_allocation_id = $1', [a.id])).rows[0].v);
    if (pct <= prev) throw ruleError('F13', `${ph.name} is already authorized to ${prev}%. A new level must be higher.`, [{ field: 'cumulative_percent', code: 'not_increasing', current: prev }]);
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const row = (await tx.query(
      `insert into fee_authorization (firm_id, phase_fee_allocation_id, cumulative_percent, authorized_by, note, created_by) values ($1,$2,$3,$4,$5,$4) returning id, authorized_at`,
      [firmId, a.id, pct, actor.id, note],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'fee_authorization', recordId: row.id, action: 'authorize', previous: { cumulative_percent: prev }, next: { phase_id: ph.id, cumulative_percent: pct }, reason: note ?? undefined,
    });
    return { id: row.id, phase_id: ph.id, cumulative_percent: pct, previous_percent: prev, authorized_at: row.authorized_at, audit_event_id };
  });

  // A planned milestone on a milestone or percent-of-construction fee. It bills nothing until it is authorized.
  post('/projects/:code/milestones', async ({ tx, actor, firmId, params, body }) => {
    const p = await findProject(tx, params.code);
    if (!mayAuthorizeFee(actor)) authorize(actor, 'billing.prepare', { projectId: p.id });
    required(body, ['label', 'amount']);
    if (typeof body.label !== 'string' || !body.label.trim()) throw bad('label', 'required', 'Name the milestone.');
    const amount = moneyAmount(body.amount, 'amount', 'The milestone amount', { positive: true });
    if (body.phase_id != null && !(isUuid(body.phase_id) && (await tx.query('select 1 from phase where id = $1 and project_id = $2', [body.phase_id, p.id])).rowCount)) {
      throw bad('phase_id', 'unknown', 'Choose a phase of this project.');
    }
    if (body.fee_component_id != null && !isUuid(body.fee_component_id)) throw bad('fee_component_id', 'unknown', 'Choose a fee component of this project.');
    const c = (await tx.query(
      `select id, billing_method from fee_component where project_id = $1 and ($2::uuid is null or id = $2) and billing_method = any($3::text[]) order by created_at limit 1`,
      [p.id, body.fee_component_id ?? null, SCHEDULED],
    )).rows[0];
    if (!c) throw ruleError('F13', 'This project has no milestone or percent-of-construction fee to schedule against.');
    const row = (await tx.query(
      `insert into billing_milestone (firm_id, fee_component_id, phase_id, label, amount, status, created_by) values ($1,$2,$3,$4,$5,'Planned',$6) returning id`,
      [firmId, c.id, body.phase_id ?? null, body.label.trim().slice(0, 200), amount, actor.id],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'billing_milestone', recordId: row.id, action: 'create', next: { label: body.label.trim(), amount } });
    return { id: row.id, status: 'Planned', audit_event_id };
  });

  post('/milestones/:id/authorize', async ({ tx, actor, firmId, params }) => {
    const id = uuidParam(params.id, 'Milestone');
    assertMayAuthorize(actor);
    const m = (await tx.query('select id, status, label from billing_milestone where id = $1 for update', [id])).rows[0];
    if (!m) throw notFound('Milestone');
    if (m.status !== 'Planned') throw conflict('INVALID_TRANSITION', `${m.label} is ${m.status}, so it cannot be authorized again.`, { from: m.status, action: 'authorize', allowed: [] });
    await tx.query(`update billing_milestone set status = 'Authorized', updated_by = $2, updated_at = now() where id = $1`, [id, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'billing_milestone', recordId: id, action: 'authorize', previous: { status: 'Planned' }, next: { status: 'Authorized' } });
    return { id, status: 'Authorized', audit_event_id };
  });
}
