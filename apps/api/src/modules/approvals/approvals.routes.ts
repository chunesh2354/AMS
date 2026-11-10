import { capabilityMap, strongest, transition, type Level, type PermissionSetKey } from '@ams/domain';
import { ApiError, notFound, rethrowTransition, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { hours, list, money } from '../../http/responses';
import { isoDate, isUuid, required, uuidParam } from '../../http/validation';
import { notify } from '../../audit/notify';
import { withFirm, type Tx } from '../../db/pool';
import type { Actor } from '../../auth/actor';
import { refreshTimesheet } from '../time/time.routes';
import { approveDraftInTx, rejectDraftInTx } from '../billing/billing.routes';
import type { Api } from '../../http/api';
import { approvalSettingsRoutes } from './approvals-settings.routes';
import { approveLeaveInTx, closeLeaveInTx, leaveForApproval } from '../leave/leave.routes';
import { authorize } from '../../auth/authorize';

/** What a submitter is told when nobody can approve their work: the studio has to name an approver. */
export const NO_APPROVER_MESSAGE = 'Nobody else in the studio can approve this. Ask a principal to set a fallback approver in Settings, Approvals.';
/** Recorded with the self_approval_override audit, and shown in the inbox, when a sole principal approves their own work. */
export const SOLE_PRINCIPAL_REASON = 'Self-approved: no other approver in the studio';

/** The level at which a person holds a capability, from their permission sets and direct grants. */
export async function personCapabilityLevel(tx: Tx, personId: string, capability: string): Promise<Level | null> {
  const grants = (await tx.query(
    `select g.capability, g.scope_type, s.key from permission_grant g left join permission_set s on s.id = g.permission_set_id where g.person_id = $1`, [personId],
  )).rows;
  let level: Level | null = capabilityMap(grants.filter((g) => g.key).map((g) => g.key as PermissionSetKey))[capability] ?? null;
  for (const g of grants.filter((x) => x.capability === capability)) level = strongest(level, g.scope_type === 'firm' ? 'firm' : 'scoped');
  return level;
}
/** Holding a decision capability means holding it firm-wide or for projects; view and own levels decide nothing. */
export const actsWith = (level: Level | null | undefined) => level === 'firm' || level === 'scoped';

/** An active, enabled person who holds time.approve: the only kind of person who may be the firm's fallback approver. */
export async function canApproveTime(tx: Tx, personId: string) {
  const p = (await tx.query('select login_state, employment_state from person where id = $1', [personId])).rows[0];
  if (!p || p.login_state !== 'Enabled' || p.employment_state !== 'Active') return false;
  return actsWith(await personCapabilityLevel(tx, personId, 'time.approve'));
}

async function isPrincipal(tx: Tx, personId: string) {
  return !!(await tx.query(
    `select 1 from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 and s.key = 'principal' limit 1`, [personId],
  )).rowCount;
}

/**
 * What approving a request needs: the capability for its type and, for project work, the project it belongs to.
 * time.approve and expenses.approve.scope are held per project (S) by PMs; the rest are firm-wide or nothing.
 */
export type Need = { capability: string; projectId?: string | null };
export const TIME_NEED: Need = { capability: 'time.approve' };

/** The capability a decision on each kind of request needs (section 5.2). */
export const APPROVAL_CAPABILITY: Record<string, string> = {
  time: 'time.approve',
  internal_time: 'time.approve',
  leave: 'leave.approve',
  expense: 'expenses.approve.scope',
  supplier_bill: 'expenses.approve.finance',
  change: 'changes.authorize',
  billing_draft: 'billing.approve',
};
export const needFor = (r: { type: string; project_id?: string | null }): Need => ({ capability: APPROVAL_CAPABILITY[r.type] ?? 'time.approve', projectId: r.project_id ?? null });

/** True when the person leads the project or holds the capability granted for it. */
async function coversProject(tx: Tx, personId: string, capability: string, projectId: string) {
  return !!(await tx.query(
    `select 1 from project where id = $2 and pm_id = $1
     union all select 1 from project_membership where project_id = $2 and person_id = $1 and project_role in ('pm', 'lead')
     union all select 1 from permission_grant where person_id = $1 and capability = $3 and scope_type <> 'firm' and scope_id = $2
     limit 1`, [personId, projectId, capability],
  )).rowCount;
}

/**
 * May this person decide a request that needs `need`? Active and enabled, holding the capability firm-wide, or
 * scoped and covering the project. The firm's named fallback approver covers every project (that is what naming
 * them means), and scoped holders decide work with no project (internal time), as approve() has always allowed.
 */
export async function isEligibleApprover(tx: Tx, personId: string, need: Need): Promise<boolean> {
  const p = (await tx.query('select login_state, employment_state from person where id = $1', [personId])).rows[0];
  if (!p || p.login_state !== 'Enabled' || p.employment_state !== 'Active') return false;
  const level = await personCapabilityLevel(tx, personId, need.capability);
  if (level === 'firm') return true;
  if (level !== 'scoped') return false;
  if (!need.projectId) return true;
  if (await coversProject(tx, personId, need.capability, need.projectId)) return true;
  const firm = (await tx.query('select fallback_approver_id from firm')).rows[0];
  return firm?.fallback_approver_id === personId;
}

/** Internal time: the person's internal time approver, else their manager, else any other principal (null when there is none). */
export async function resolvePersonApprover(tx: Tx, personId: string): Promise<string | null> {
  const p = (await tx.query('select internal_time_approver_id, manager_id from person where id = $1', [personId])).rows[0];
  if (p?.internal_time_approver_id ?? p?.manager_id) return (p.internal_time_approver_id ?? p.manager_id) as string;
  return anyPrincipal(tx, personId, TIME_NEED);
}
/** Any active principal other than `except` who can decide `need`, or null. Never hands back the person it was asked to skip. */
async function anyPrincipal(tx: Tx, except: string, need: Need): Promise<string | null> {
  const rows = (await tx.query(
    `select g.person_id from permission_grant g join permission_set s on s.id = g.permission_set_id join person p on p.id = g.person_id
     where s.key = 'principal' and p.login_state = 'Enabled' and p.employment_state = 'Active' and g.person_id <> $1 order by p.ref_code`, [except],
  )).rows;
  for (const r of rows) if (await isEligibleApprover(tx, r.person_id, need)) return r.person_id as string;
  return null;
}

/** The firm's fallback approver (when they can decide `need`), else any other principal, else null. Never the submitter. */
async function firmFallback(tx: Tx, submitter: string, need: Need): Promise<string | null> {
  const firm = (await tx.query('select fallback_approver_id from firm')).rows[0];
  if (firm?.fallback_approver_id && firm.fallback_approver_id !== submitter && await isEligibleApprover(tx, firm.fallback_approver_id, need)) return firm.fallback_approver_id as string;
  return anyPrincipal(tx, submitter, need);
}

/**
 * Nobody but the submitter can approve. A principal (a one-principal studio) gets their own work back and may approve it,
 * recorded as a self_approval_override; anyone else is told to ask the studio to set an approver (422 NO_APPROVER).
 */
async function selfOrRefuse(tx: Tx, submitter: string): Promise<string> {
  if (await isPrincipal(tx, submitter)) return submitter;
  throw ruleError('NO_APPROVER', NO_APPROVER_MESSAGE);
}

/** A designated approver, or their substitute for today (studio timezone), when that person can decide `need`. */
async function designatedOrSubstitute(tx: Tx, designated: string, submitter: string, need: Need): Promise<string | null> {
  const subs = (await tx.query(
    `select s.substitute_id from substitute s, firm f
     where s.approver_id = $1 and s.substitute_id <> $2 and (now() at time zone f.timezone)::date between s.from_date and s.to_date order by s.from_date`, [designated, submitter],
  )).rows;
  for (const s of subs) if (await isEligibleApprover(tx, s.substitute_id, need)) return s.substitute_id as string;
  return (await isEligibleApprover(tx, designated, need)) ? designated : null;
}

/**
 * Section 5.3 rule 6, for every request type. Each designated approver in order (or their substitute in date range),
 * then the firm's fallback, then any principal; each only when they hold the capability for this type and scope, so
 * nothing is ever routed to someone who cannot decide it. The submitter never approves their own work while anyone
 * else can: a sole principal does, and anyone else gets 422 NO_APPROVER instead of a stuck item.
 */
export async function routeTo(tx: Tx, designated: (string | null | undefined)[], submitter: string, need: Need): Promise<string> {
  for (const d of designated) {
    if (!d || d === submitter) continue;
    const who = await designatedOrSubstitute(tx, d, submitter, need);
    if (who) return who;
  }
  return (await firmFallback(tx, submitter, need)) ?? selfOrRefuse(tx, submitter);
}

/** One designated approver. `need` defaults to time.approve (internal time); other request types pass their own. */
export async function routeApprover(tx: Tx, designated: string | null, submitter: string, need: Need = TIME_NEED): Promise<string> {
  return routeTo(tx, [designated], submitter, need);
}

/**
 * Who approves project time. Staff time goes to the PM, then the project principal; a PM's own time goes to the
 * project principal. Then the firm's fallback approver, then any other principal. Only when nobody else exists does
 * a principal approve their own.
 */
export async function projectTimeApprover(tx: Tx, project: { pm_id: string; principal_id: string | null; project_id?: string | null; id?: string }, submitter: string) {
  return routeTo(tx, [project.pm_id, project.principal_id], submitter, { capability: 'time.approve', projectId: project.project_id ?? project.id ?? null });
}


async function loadRequest(tx: Tx, id: string) {
  const r = (await tx.query(`select * from approval_request where id = $1 for update`, [id])).rows[0];
  if (!r) throw notFound('Approval');
  return r;
}
function assertApprover(actor: Actor, r: any) {
  if (r.approver_id !== actor.id && r.delegated_to_id !== actor.id) throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'This approval is in someone else\'s queue.', [], { capability: capabilityFor(r.type) ?? 'time.approve' });
}
/** The capability a decision on this kind of request needs. */
const capabilityFor = (type: string): string | null => APPROVAL_CAPABILITY[type] ?? null;
/** Being the routed approver is not enough: the actor must also hold the capability for the request type. */
function assertCanDecide(actor: Actor, r: any) {
  assertApprover(actor, r);
  const cap = capabilityFor(r.type);
  if (cap && !actsWith(actor.caps[cap])) throw new ApiError(403, 'FORBIDDEN_CAPABILITY', `You need ${cap} for this.`, [], { capability: cap });
}
/** Routing sent the work back to its submitter: only ever a principal with nobody else in the studio to approve. */
const routedToSelf = (r: any) => r.approver_id === r.submitter_id;
/**
 * The submitter may approve only when the firm allows self-approval, or when routing sent a principal's own work back to
 * them because nobody else in the studio can approve. Both are recorded as self_approval_override.
 */
async function assertNotSelf(tx: Tx, actor: Actor, firmId: string, r: any) {
  if (r.submitter_id !== actor.id) return;
  const f = (await tx.query('select allow_self_approval from firm')).rows[0];
  if (f.allow_self_approval) {
    await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'self_approval_override' });
    return;
  }
  if (routedToSelf(r) && actor.sets.includes('principal')) {
    await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'self_approval_override', reason: SOLE_PRINCIPAL_REASON });
    return;
  }
  throw new ApiError(403, 'SELF_APPROVAL', 'You cannot approve your own submission.', [], { capability: 'time.approve' });
}

/** Rates are stored at approval, for the service date, so later rate changes never reprice history (R13, AT-19). */
async function resolveRate(tx: Tx, personId: string, projectId: string | null, type: 'bill' | 'cost', date: string) {
  const r = (await tx.query(
    `select id from rate_schedule where person_id = $1 and rate_type = $2 and (project_id = $3 or project_id is null)
     and effective_from <= $4 and (effective_to is null or effective_to >= $4) order by project_id nulls last limit 1`, [personId, type, projectId, date],
  )).rows[0];
  return (r?.id ?? null) as string | null;
}

async function entriesOf(tx: Tx, requestId: string) {
  return (await tx.query(
    `select te.* from time_entry te join approval_request_entry x on x.time_entry_id = te.id where x.approval_request_id = $1 order by te.service_date`, [requestId],
  )).rows;
}

async function approveRequest(tx: Tx, actor: Actor, firmId: string, r: any, reason?: string) {
  assertCanDecide(actor, r);
  await assertNotSelf(tx, actor, firmId, r);
  let next: string;
  try { next = transition('approvalRequest', r.status, 'approve'); } catch (e) { rethrowTransition(e); }
  if (r.type === 'time' || r.type === 'internal_time') {
    for (const e of await entriesOf(tx, r.id)) {
      if (e.approval_state !== 'Submitted') continue;
      const bill = e.project_id ? await resolveRate(tx, e.person_id, e.project_id, 'bill', e.service_date) : null;
      const cost = await resolveRate(tx, e.person_id, e.project_id, 'cost', e.service_date);
      await tx.query(
        `update time_entry set approval_state = 'Approved', bill_rate_schedule_id = $2, cost_rate_schedule_id = $3, updated_by = $4, updated_at = now() where id = $1`,
        [e.id, bill, cost, actor.id],
      );
    }
    await refreshTimesheet(tx, r.record_id);
  } else if (r.type === 'billing_draft') {
    await approveDraftInTx(tx, actor, firmId, r.record_id);
  } else if (r.type === 'leave') {
    await approveLeaveInTx(tx, actor, firmId, r.record_id, reason);
  }
  await tx.query(`update approval_request set status = $2, updated_by = $3, updated_at = now() where id = $1`, [r.id, next!, actor.id]);
  await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'approve',$4,$3)`, [firmId, r.id, actor.id, reason ?? null]);
  await tx.query(`update notification set resolved_at = now() where record_type = 'approval_request' and record_id = $1 and resolved_at is null`, [r.id]);
  return audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'approve', previous: { status: r.status }, next: { status: next! }, reason });
}

async function view(tx: Tx, r: any) {
  const leave = r.type === 'leave' ? await leaveForApproval(tx, r.record_id) : null;
  const lines = r.type === 'billing_draft' || r.type === 'leave' ? [] : await entriesOf(tx, r.id);
  const draft = r.type === 'billing_draft' ? (await tx.query(
    `select d.draft_no, coalesce(sum(l.current_claim),0) total from billing_draft d left join billing_line l on l.billing_draft_id = d.id where d.id = $1 group by d.id`, [r.record_id],
  )).rows[0] : null;
  const ts = r.record_type === 'timesheet' ? (await tx.query('select period_start, period_end from timesheet where id = $1', [r.record_id])).rows[0] : null;
  const total = lines.filter((e) => ['Submitted', 'Approved'].includes(e.approval_state)).reduce((s, e) => s + Number(e.duration_hours), 0);
  const history = (await tx.query(
    `select d.action, d.reason, d.at, p.name as actor from decision d join person p on p.id = d.actor_id where d.approval_request_id = $1 order by d.at`, [r.id],
  )).rows;
  return {
    id: r.id, type: r.type, status: r.status, record_type: r.record_type, record_id: r.record_id,
    submitter: { id: r.submitter_id, name: r.submitter_name }, approver: { id: r.approver_id, name: r.approver_name },
    delegated_to_id: r.delegated_to_id, project: r.project_code ? { code: r.project_code, name: r.project_name } : null,
    exception_flags: r.exception_flags, age_days: r.age_days,
    // Routed back to its submitter: a sole principal approving their own work, labelled in the inbox.
    self_approval: routedToSelf(r),
    period: ts ? { start: ts.period_start, end: ts.period_end } : leave ? { start: leave.start_date, end: leave.end_date } : null,
    hours: r.type === 'billing_draft' ? null : leave ? leave.hours : hours(total),
    // Leave: the type, days and notes. The private reason is for the approver (and the submitter's own view).
    leave: leave ? { leave_type: leave.leave_type, start_date: leave.start_date, end_date: leave.end_date, half_day: leave.half_day, days: leave.days, reason: leave.reason, handover_note: leave.handover_note, status: leave.status } : null,
    amount: draft ? money(draft.total) : null, draft_no: draft?.draft_no ?? null,
    lines: lines.map((e) => ({ id: e.id, service_date: e.service_date, duration_hours: hours(e.duration_hours), approval_state: e.approval_state, note: e.note, correction_reason: e.correction_reason })),
    history,
  };
}

const LIST_SQL = `select a.*, s.name as submitter_name, ap.name as approver_name, pr.code as project_code, pr.name as project_name,
    (current_date - a.created_at::date) as age_days
  from approval_request a join person s on s.id = a.submitter_id join person ap on ap.id = a.approver_id left join project pr on pr.id = a.project_id`;

export function approvalRoutes(api: Api) {
  const { get, post, pool } = api;
  approvalSettingsRoutes(api);
  // Everyone sees only their own queue (F11).
  get('/approvals', async ({ tx, actor, query, req }) => {
    const rows = (await tx.query(
      `${LIST_SQL} where (a.approver_id = $1 or a.delegated_to_id = $1) and ($2::text is null or a.status = $2) and ($3::text is null or a.type = $3) order by a.created_at`,
      [actor.id, query.status ?? 'Pending', query.type ?? null],
    )).rows;
    // One transaction client: run the queries one after another (pg does not queue overlapping calls safely).
    const out: Awaited<ReturnType<typeof view>>[] = [];
    for (const r of rows) out.push(await view(tx, r));
    return list(req, out);
  });

  get('/approvals/:id', async ({ tx, actor, params }) => {
    const id = uuidParam(params.id, 'Approval');
    const r = (await tx.query(`${LIST_SQL} where a.id = $1`, [id])).rows[0];
    if (!r) throw notFound('Approval');
    if (r.approver_id !== actor.id && r.delegated_to_id !== actor.id && r.submitter_id !== actor.id) assertApprover(actor, r);
    return view(tx, r);
  });

  post('/approvals/:id/approve', async ({ tx, actor, firmId, params, body }) => {
    const r = await loadRequest(tx, uuidParam(params.id, 'Approval'));
    const audit_event_id = await approveRequest(tx, actor, firmId, r, body.reason);
    return { status: 'Approved', audit_event_id };
  });

  /** A return needs a reason. Send time_entry_ids to return only some lines; the rest stay in the queue. */
  post('/approvals/:id/return', async ({ tx, actor, firmId, params, body }) => {
    required(body, ['reason']);
    const r = await loadRequest(tx, uuidParam(params.id, 'Approval'));
    assertCanDecide(actor, r);
    try { transition('approvalRequest', r.status, 'return'); } catch (e) { rethrowTransition(e); }
    let closed = true;
    if (r.type === 'time' || r.type === 'internal_time') {
      const entries = await entriesOf(tx, r.id);
      const chosen: string[] | null = Array.isArray(body.time_entry_ids) ? body.time_entry_ids : null;
      for (const e of entries) {
        if (e.approval_state === 'Submitted' && (!chosen || chosen.includes(e.id))) {
          await tx.query(`update time_entry set approval_state = 'Returned', return_reason = $2, updated_by = $3, updated_at = now() where id = $1`, [e.id, body.reason, actor.id]);
        }
      }
      closed = !(await entriesOf(tx, r.id)).some((e) => e.approval_state === 'Submitted');
      await refreshTimesheet(tx, r.record_id);
    } else if (r.type === 'billing_draft') {
      await tx.query(`update billing_draft set approval_state = 'Draft', updated_by = $2, updated_at = now() where id = $1`, [r.record_id, actor.id]);
    } else if (r.type === 'leave') {
      await closeLeaveInTx(tx, actor, firmId, r.record_id, 'Returned', body.reason);
    }
    if (closed) await tx.query(`update approval_request set status = 'Returned', updated_by = $2, updated_at = now() where id = $1`, [r.id, actor.id]);
    await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'return',$4,$3)`, [firmId, r.id, actor.id, body.reason]);
    await notify(tx, firmId, r.submitter_id, r.type === 'leave' ? 'leave.returned' : 'timesheet.returned', `Returned: ${body.reason}`, { type: 'approval_request', id: r.id });
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'return', reason: body.reason });
    return { status: closed ? 'Returned' : 'Pending', audit_event_id };
  });

  post('/approvals/:id/reject', async ({ tx, actor, firmId, params, body }) => {
    required(body, ['reason']);
    const r = await loadRequest(tx, uuidParam(params.id, 'Approval'));
    assertCanDecide(actor, r);
    try { transition('approvalRequest', r.status, 'reject'); } catch (e) { rethrowTransition(e); }
    if (r.type === 'billing_draft') await rejectDraftInTx(tx, actor, firmId, r.record_id, body.reason);
    else if (r.type === 'leave') await closeLeaveInTx(tx, actor, firmId, r.record_id, 'Rejected', body.reason);
    await tx.query(`update approval_request set status = 'Rejected', updated_by = $2, updated_at = now() where id = $1`, [r.id, actor.id]);
    await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'reject',$4,$3)`, [firmId, r.id, actor.id, body.reason]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'reject', reason: body.reason });
    return { status: 'Rejected', audit_event_id };
  });

  post('/approvals/:id/delegate', async ({ tx, actor, firmId, params, body }) => {
    required(body, ['to', 'until']);
    const r = await loadRequest(tx, uuidParam(params.id, 'Approval'));
    assertApprover(actor, r);
    if (r.status !== 'Pending') throw new ApiError(409, 'INVALID_TRANSITION', 'Only a pending approval can be delegated.');
    if (body.to === r.submitter_id) throw new ApiError(403, 'SELF_APPROVAL', 'A submission cannot be delegated to its submitter.');
    const to = (await tx.query(`select id, name from person where id = $1 and login_state = 'Enabled'`, [uuidParam(body.to, 'Person')])).rows[0];
    if (!to) throw notFound('Person');
    await tx.query(`update approval_request set delegated_to_id = $2, delegated_until = $3, updated_by = $4, updated_at = now() where id = $1`, [r.id, to.id, isoDate(body.until, 'until'), actor.id]);
    await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'delegate',$4,$3)`, [firmId, r.id, actor.id, `To ${to.name} until ${body.until}`]);
    await notify(tx, firmId, to.id, 'approval.delegated', `${actor.name} delegated an approval to you`, { type: 'approval_request', id: r.id });
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'delegate', next: { to: to.id, until: body.until } });
    return { ok: true, audit_event_id };
  });

  /**
   * Pending items whose approver (and delegate) can no longer decide them: left, suspended, or never held the
   * capability for that type and scope. Lists only the types the viewer holds firm-wide, since only those can be
   * reassigned by them.
   */
  get('/approvals/stuck', async ({ tx, actor, req }) => {
    const caps = [...new Set(Object.values(APPROVAL_CAPABILITY))].filter((c) => actor.caps[c] === 'firm');
    if (!caps.length) authorize(actor, 'time.approve');
    const rows = (await tx.query(`${LIST_SQL} where a.status = 'Pending' order by a.created_at`)).rows;
    const out: (Awaited<ReturnType<typeof view>> & { reason: string })[] = [];
    for (const r of rows) {
      const cap = capabilityFor(r.type) ?? 'time.approve';
      if (!caps.includes(cap)) continue;
      const need = needFor(r);
      if (await isEligibleApprover(tx, r.approver_id, need) || routedToSelf(r)) continue;
      if (r.delegated_to_id && await isEligibleApprover(tx, r.delegated_to_id, need)) continue;
      out.push({ ...(await view(tx, r)), reason: `${r.approver_name} cannot approve this (needs ${cap}).` });
    }
    return list(req, out);
  });

  /**
   * The way out for a stuck item: someone who holds the item's capability firm-wide (a principal holds them all)
   * sends it to another person who can decide it. Never to the submitter, never to someone ineligible.
   */
  post('/approvals/:id/reassign', async ({ tx, actor, firmId, params, body }) => {
    const r = await loadRequest(tx, uuidParam(params.id, 'Approval'));
    const cap = capabilityFor(r.type) ?? 'time.approve';
    authorize(actor, cap);
    required(body, ['to']);
    if (!isUuid(body.to)) throw new ApiError(400, 'VALIDATION', 'to must be a person id.', [{ field: 'to', code: 'invalid' }]);
    if (body.reason != null && typeof body.reason !== 'string') throw new ApiError(400, 'VALIDATION', 'reason must be text.', [{ field: 'reason', code: 'invalid' }]);
    if (r.status !== 'Pending') throw new ApiError(409, 'INVALID_TRANSITION', 'Only a pending approval can be reassigned.', [], { from: r.status, action: 'reassign', allowed: [] });
    if (body.to === r.submitter_id) throw new ApiError(403, 'SELF_APPROVAL', 'A submission cannot be reassigned to its submitter.');
    const to = (await tx.query('select id, name from person where id = $1', [body.to])).rows[0];
    if (!to) throw notFound('Person');
    if (!(await isEligibleApprover(tx, to.id, needFor(r)))) throw ruleError('APPROVER_ELIGIBLE', `${to.name} cannot approve this. Choose an active person who holds ${cap}${r.project_id ? ' for this project' : ''}.`);
    await tx.query(`update approval_request set approver_id = $2, delegated_to_id = null, delegated_until = null, updated_by = $3, updated_at = now() where id = $1`, [r.id, to.id, actor.id]);
    if (r.type === 'leave') await tx.query('update leave_request set approver_id = $2, updated_by = $3, updated_at = now() where id = $1', [r.record_id, to.id, actor.id]);
    const reason = (body.reason as string | undefined)?.trim() || `To ${to.name}`;
    await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'reassign',$4,$3)`, [firmId, r.id, actor.id, reason]);
    await tx.query(`update notification set resolved_at = now() where record_type = 'approval_request' and record_id = $1 and resolved_at is null`, [r.id]);
    await notify(tx, firmId, to.id, 'approval.reassigned', `${actor.name} sent you an approval`, { type: 'approval_request', id: r.id });
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'approval_request', recordId: r.id, action: 'reassign', previous: { approver_id: r.approver_id, delegated_to_id: r.delegated_to_id }, next: { approver_id: to.id }, reason });
    return { ok: true, approver: { id: to.id, name: to.name }, audit_event_id };
  });

  // AC-F11-2: exceptions need their own decision and come back in skipped[]. Each item stands alone.
  post('/approvals/batch-approve', async ({ actor, firmId, body }) => {
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const approved: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await withFirm(pool, firmId, async (w) => {
          const r = await loadRequest(w, uuidParam(id, 'Approval'));
          if (r.exception_flags.length) { skipped.push({ id, reason: r.exception_flags.join(', ') }); return; }
          await approveRequest(w, actor, firmId, r);
          approved.push(id);
        });
      } catch (e) {
        skipped.push({ id, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    return { approved, skipped };
  });
}
