import { transition } from '@ams/domain';
import { ApiError, notFound, rethrowTransition, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { authorize } from '../../auth/authorize';
import { notify } from '../../audit/notify';
import { hours } from '../../http/responses';
import { isoDate, isUuid, required, uuidParam } from '../../http/validation';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { localDate } from '../time/time.routes';
import { routeTo } from '../approvals/approvals.routes';

/** Hours in a leave day, for the approvals inbox and the planner. Half days are half of this. */
export const LEAVE_DAY_HOURS = 8;
const TEXT_MAX = 2000;

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Monday to Friday between two dates, both included. */
export function workingDays(start: string, end: string): number {
  let n = 0;
  for (let d = dayOf(start); d <= dayOf(end); d = new Date(d.getTime() + 86_400_000)) if (d.getUTCDay() % 6 !== 0) n += 1;
  return n;
}
export const leaveDays = (start: string, end: string, halfDay: boolean) => workingDays(start, end) * (halfDay ? 0.5 : 1);
const days = (n: string | number | null | undefined) => (n == null ? null : Number(n).toFixed(2));

/** "Today" in the studio's timezone. */
async function studioToday(tx: Tx) {
  const tz = (await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined;
  return localDate(tz || 'Asia/Kolkata');
}

/** Allowance, taken, pending and available days per active type for one person and year. */
export async function leaveBalances(tx: Tx, personId: string, year: number) {
  const rows = (await tx.query(
    `select t.id, t.key, t.name, t.tracks_balance,
       coalesce(e.allowance_days, t.yearly_allowance_days) as allowance,
       coalesce(e.taken_days, 0) as taken,
       coalesce((select sum(r.days) from leave_request r where r.person_id = $1 and r.leave_type_id = t.id and r.status = 'Pending'
                 and extract(year from r.start_date) = $2), 0) as pending
     from leave_type t left join leave_entitlement e on e.leave_type_id = t.id and e.person_id = $1 and e.year = $2
     where t.active order by t.sort_order, t.name`, [personId, year],
  )).rows;
  return rows.map((r) => ({
    leave_type: { id: r.id as string, key: r.key as string, name: r.name as string },
    tracks_balance: !!r.tracks_balance,
    allowance_days: r.tracks_balance ? days(r.allowance) : null,
    taken_days: days(r.taken),
    pending_days: days(r.pending),
    available_days: r.tracks_balance ? days(Number(r.allowance) - Number(r.taken) - Number(r.pending)) : null,
  }));
}

const REQUEST_SQL = `select r.*, t.key as type_key, t.name as type_name, a.name as approver_name
  from leave_request r join leave_type t on t.id = r.leave_type_id left join person a on a.id = r.approver_id`;

function requestView(r: any, today: string) {
  return {
    id: r.id as string,
    leave_type: { id: r.leave_type_id, key: r.type_key, name: r.type_name },
    start_date: r.start_date as string, end_date: r.end_date as string, half_day: !!r.half_day,
    days: days(r.days), hours: hours(Number(r.days) * LEAVE_DAY_HOURS),
    status: r.status as string,
    reason: r.reason ?? null, handover_note: r.handover_note ?? null,
    approver: r.approver_id ? { id: r.approver_id, name: r.approver_name } : null,
    approval_request_id: r.approval_request_id ?? null,
    decided_at: r.decided_at ?? null, decision_reason: r.decision_reason ?? null,
    // Pending leave can always be withdrawn; approved leave only before it starts (studio today).
    can_withdraw: r.status === 'Pending' || (r.status === 'Approved' && r.start_date > today),
  };
}

/** For the approvals inbox: the leave behind an approval request. */
export async function leaveForApproval(tx: Tx, leaveRequestId: string) {
  const r = (await tx.query(`${REQUEST_SQL} where r.id = $1`, [leaveRequestId])).rows[0];
  return r ? requestView(r, '9999-12-31') : null;
}

async function loadLeave(tx: Tx, id: string) {
  const r = (await tx.query('select * from leave_request where id = $1 for update', [id])).rows[0];
  if (!r) throw notFound('Leave request');
  return r;
}

/** Approve from the approvals queue: the request becomes Approved and its days move into taken on the entitlement. */
export async function approveLeaveInTx(tx: Tx, actor: Actor, firmId: string, leaveRequestId: string, reason?: string | null) {
  const r = await loadLeave(tx, leaveRequestId);
  if (r.status !== 'Pending') throw new ApiError(409, 'INVALID_TRANSITION', `This leave request is ${r.status.toLowerCase()}.`, [], { from: r.status, action: 'approve', allowed: [] });
  await tx.query(`update leave_request set status = 'Approved', decided_at = now(), decision_reason = $2, updated_by = $3, updated_at = now() where id = $1`, [r.id, reason ?? null, actor.id]);
  await tx.query(
    `insert into leave_entitlement (firm_id, person_id, leave_type_id, year, allowance_days, taken_days, created_by)
     select $1, $2, t.id, extract(year from $4::date)::int, t.yearly_allowance_days, $5, $6 from leave_type t where t.id = $3
     on conflict (person_id, leave_type_id, year) do update set taken_days = leave_entitlement.taken_days + excluded.taken_days, updated_at = now(), updated_by = $6`,
    [firmId, r.person_id, r.leave_type_id, r.start_date, r.days, actor.id],
  );
  await notify(tx, firmId, r.person_id, 'leave.approved', `${actor.name} approved your leave from ${r.start_date}`, { type: 'leave_request', id: r.id });
}

/** Return or reject from the approvals queue: nothing was taken, so the balance is free again. */
export async function closeLeaveInTx(tx: Tx, actor: Actor, firmId: string, leaveRequestId: string, status: 'Returned' | 'Rejected', reason: string) {
  const r = await loadLeave(tx, leaveRequestId);
  if (r.status !== 'Pending') throw new ApiError(409, 'INVALID_TRANSITION', `This leave request is ${r.status.toLowerCase()}.`, [], { from: r.status, action: status === 'Returned' ? 'return' : 'reject', allowed: [] });
  await tx.query(`update leave_request set status = $2, decided_at = now(), decision_reason = $3, updated_by = $4, updated_at = now() where id = $1`, [r.id, status, reason, actor.id]);
  // The return route already tells the submitter; a rejection has no notice of its own there.
  if (status === 'Rejected') await notify(tx, firmId, r.person_id, 'leave.rejected', `Rejected: ${reason}`, { type: 'leave_request', id: r.id });
}

async function leaveType(tx: Tx, v: unknown) {
  const t = isUuid(v)
    ? (await tx.query('select * from leave_type where id = $1 and active', [v])).rows[0]
    : typeof v === 'string' ? (await tx.query('select * from leave_type where key = $1 and active', [v])).rows[0] : null;
  if (!t) throw new ApiError(400, 'VALIDATION', 'Choose a leave type.', [{ field: 'leave_type_id', code: 'invalid' }]);
  return t;
}
function optionalText(body: any, field: string) {
  const v = body[field];
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > TEXT_MAX) throw new ApiError(400, 'VALIDATION', `${field} must be text of at most ${TEXT_MAX} characters.`, [{ field, code: 'invalid' }]);
  return v.trim() || null;
}

export function leaveRoutes(api: Api) {
  const { get, post } = api;

  /** My balances for the year (studio today's year unless ?year=) and all my requests, newest first. */
  get('/me/leave', async ({ tx, actor, query }) => {
    authorize(actor, 'leave.request', { ownerId: actor.id });
    const today = await studioToday(tx);
    let year = Number(today.slice(0, 4));
    if (query.year != null && query.year !== '') {
      year = Number(query.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError(400, 'VALIDATION', 'year must be a year such as 2026.', [{ field: 'year', code: 'invalid' }]);
    }
    const types = (await tx.query('select id, key, name, tracks_balance from leave_type where active order by sort_order, name')).rows
      .map((t) => ({ id: t.id, key: t.key, name: t.name, tracks_balance: !!t.tracks_balance }));
    const requests = (await tx.query(`${REQUEST_SQL} where r.person_id = $1 order by r.start_date desc, r.created_at desc`, [actor.id])).rows;
    return { year, today, day_hours: LEAVE_DAY_HOURS, types, balances: await leaveBalances(tx, actor.id, year), requests: requests.map((r) => requestView(r, today)) };
  });

  /** Request leave for myself. Goes to my manager (or the next eligible approver) through the approvals queue. */
  post('/leave-requests', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'leave.request', { ownerId: actor.id });
    required(body, ['leave_type_id', 'start_date', 'end_date']);
    const start = isoDate(body.start_date, 'start_date');
    const end = isoDate(body.end_date, 'end_date');
    if (end < start) throw new ApiError(400, 'VALIDATION', 'The last day cannot be before the first day.', [{ field: 'end_date', code: 'range' }]);
    if (body.half_day != null && typeof body.half_day !== 'boolean') throw new ApiError(400, 'VALIDATION', 'half_day must be true or false.', [{ field: 'half_day', code: 'invalid' }]);
    const halfDay = body.half_day === true;
    const reason = optionalText(body, 'reason');
    const handover = optionalText(body, 'handover_note');
    const type = await leaveType(tx, body.leave_type_id);
    if (start.slice(0, 4) !== end.slice(0, 4)) throw ruleError('LEAVE_YEAR', 'Leave that crosses 31 December needs two requests, one for each year.');
    const today = await studioToday(tx);
    // Sick leave is often recorded after the day; everything else is asked for ahead.
    if (start < today && type.key !== 'sick') throw ruleError('LEAVE_PAST', 'Leave cannot start before today. Record past sickness as Sick leave.');
    const n = leaveDays(start, end, halfDay);
    if (n <= 0) throw ruleError('LEAVE_NO_WORKING_DAYS', 'These dates have no working days.');

    const overlap = (await tx.query(
      `select id, start_date, end_date, status from leave_request where person_id = $1 and status in ('Pending','Approved') and start_date <= $3 and end_date >= $2`,
      [actor.id, start, end],
    )).rows;
    if (overlap.length) throw ruleError('LEAVE_OVERLAP', 'You already have leave on some of these days.', overlap.map((o) => ({ leave_request_id: o.id, start_date: o.start_date, end_date: o.end_date, status: o.status })));

    if (type.tracks_balance) {
      const b = (await leaveBalances(tx, actor.id, Number(start.slice(0, 4)))).find((x) => x.leave_type.id === type.id);
      const available = Number(b?.available_days ?? 0);
      if (available < n) throw ruleError('LEAVE_BALANCE', `You have ${available.toFixed(2)} days of ${type.name} left in ${start.slice(0, 4)}; this request needs ${n.toFixed(2)}.`, [{ field: 'leave_type_id', code: 'balance', available_days: available.toFixed(2), requested_days: n.toFixed(2) }]);
    }

    const manager = (await tx.query('select manager_id from person where id = $1', [actor.id])).rows[0]?.manager_id as string | null;
    const approver = await routeTo(tx, [manager], actor.id, { capability: 'leave.approve' });
    const row = (await tx.query(
      `insert into leave_request (firm_id, person_id, leave_type_id, start_date, end_date, half_day, days, reason, handover_note, approver_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2) returning id`,
      [firmId, actor.id, type.id, start, end, halfDay, n, reason, handover, approver],
    )).rows[0];
    const ar = (await tx.query(
      `insert into approval_request (firm_id, type, record_type, record_id, submitter_id, approver_id, created_by) values ($1,'leave','leave_request',$2,$3,$4,$3) returning id`,
      [firmId, row.id, actor.id, approver],
    )).rows[0];
    await tx.query('update leave_request set approval_request_id = $2 where id = $1', [row.id, ar.id]);
    await notify(tx, firmId, approver, 'leave.submitted', `${actor.name} requested ${type.name} from ${start}`, { type: 'approval_request', id: ar.id });
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'leave_request', recordId: row.id, action: 'submit', next: { leave_type: type.key, start_date: start, end_date: end, days: n.toFixed(2), approver_id: approver } });
    const view = requestView((await tx.query(`${REQUEST_SQL} where r.id = $1`, [row.id])).rows[0], today);
    return { ...view, approval_request_id: ar.id, audit_event_id };
  });

  /** Withdraw my own request: pending at any time, approved leave before it starts (the days go back to the balance). */
  post('/leave-requests/:id/withdraw', async ({ tx, actor, firmId, params, body }) => {
    const r = await loadLeave(tx, uuidParam(params.id, 'Leave request'));
    authorize(actor, 'leave.request', { ownerId: r.person_id });
    const today = await studioToday(tx);
    const reason = optionalText(body, 'reason');
    if (r.status === 'Pending') {
      if (r.approval_request_id) {
        const a = (await tx.query('select status from approval_request where id = $1 for update', [r.approval_request_id])).rows[0];
        try { transition('approvalRequest', a.status, 'withdraw'); } catch (e) { rethrowTransition(e); }
        await tx.query(`update approval_request set status = 'Withdrawn', updated_by = $2, updated_at = now() where id = $1`, [r.approval_request_id, actor.id]);
        await tx.query(`insert into decision (firm_id, approval_request_id, actor_id, action, reason, created_by) values ($1,$2,$3,'withdraw',$4,$3)`, [firmId, r.approval_request_id, actor.id, reason]);
        await tx.query(`update notification set resolved_at = now() where record_type = 'approval_request' and record_id = $1 and resolved_at is null`, [r.approval_request_id]);
      }
    } else if (r.status === 'Approved' && r.start_date > today) {
      await tx.query(
        `update leave_entitlement set taken_days = greatest(taken_days - $4, 0), updated_at = now(), updated_by = $5
         where person_id = $1 and leave_type_id = $2 and year = extract(year from $3::date)::int`,
        [r.person_id, r.leave_type_id, r.start_date, r.days, actor.id],
      );
      if (r.approver_id) await notify(tx, firmId, r.approver_id, 'leave.withdrawn', `${actor.name} withdrew approved leave from ${r.start_date}`, { type: 'leave_request', id: r.id });
    } else {
      const why = r.status === 'Approved' ? 'This leave has already started.' : `This leave request is ${r.status.toLowerCase()}.`;
      throw new ApiError(409, 'INVALID_TRANSITION', why, [], { from: r.status, action: 'withdraw', allowed: [] });
    }
    await tx.query(`update leave_request set status = 'Withdrawn', updated_by = $2, updated_at = now() where id = $1`, [r.id, actor.id]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'leave_request', recordId: r.id, action: 'withdraw', previous: { status: r.status }, next: { status: 'Withdrawn' }, reason: reason ?? undefined });
    return { ...requestView((await tx.query(`${REQUEST_SQL} where r.id = $1`, [r.id])).rows[0], today), audit_event_id };
  });
}
