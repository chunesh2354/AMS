import { addDays, OVER_DAY_HOURS, transition, weekStart } from '@ams/domain';
import { ApiError, conflict, notFound, rethrowTransition, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { hours, list } from '../../http/responses';
import { isoDate, required, uuidParam } from '../../http/validation';
import { notify } from '../../audit/notify';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import { projectTimeApprover, routeApprover, resolvePersonApprover } from '../approvals/approvals.routes';
import type { Api } from '../../http/api';

async function ensureTimesheet(tx: Tx, firmId: string, personId: string, date: string) {
  const start = weekStart(date);
  const end = addDays(start, 6);
  const found = (await tx.query('select * from timesheet where person_id = $1 and period_start = $2', [personId, start])).rows[0];
  if (found) return found;
  return (await tx.query(
    `insert into timesheet (firm_id, person_id, period_start, period_end, created_by) values ($1,$2,$3,$4,$2) returning *`, [firmId, personId, start, end],
  )).rows[0];
}

/** The status a timesheet shows, from its lines (AC-F11-1). */
export async function refreshTimesheet(tx: Tx, timesheetId: string) {
  const rows = (await tx.query(`select approval_state from time_entry where timesheet_id = $1 and approval_state <> 'Amended'`, [timesheetId])).rows.map((r) => r.approval_state as string);
  const has = (s: string) => rows.includes(s);
  let status = 'Open';
  if (has('Returned')) status = 'Returned';
  else if (rows.length && rows.every((s) => s === 'Approved')) status = 'Approved';
  else if (has('Approved') && has('Submitted')) status = 'Partially approved';
  else if (has('Submitted')) status = 'Submitted';
  await tx.query('update timesheet set status = $2, updated_at = now() where id = $1', [timesheetId, status]);
  return status;
}

/** Fee component: the phase's only one, else the main non-hourly one (decision in docs/decisions.md). */
async function resolveFeeComponent(tx: Tx, phaseId: string, explicit?: string) {
  if (explicit) return explicit;
  const rows = (await tx.query(
    `select c.id, c.billing_method from phase_fee_allocation a join fee_component c on c.id = a.fee_component_id where a.phase_id = $1`, [phaseId],
  )).rows;
  if (rows.length <= 1) return rows[0]?.id ?? null;
  return (rows.find((r) => !['hourly', 'hourly_nte'].includes(r.billing_method)) ?? rows[0]).id;
}

async function assertDayRoom(tx: Tx, personId: string, date: string, adding: number, excludeIds: string[] = []) {
  const t = Number((await tx.query(
    `select coalesce(sum(duration_hours),0) v from time_entry where person_id = $1 and service_date = $2 and approval_state <> 'Amended' and not (id = any($3::uuid[]))`,
    [personId, date, excludeIds],
  )).rows[0].v);
  if (t + adding > 24) throw ruleError('F10', `A day cannot hold more than 24 h. ${date} would have ${(t + adding).toFixed(2)} h.`, [{ field: 'duration_hours', code: 'over_24h' }]);
}

async function classify(tx: Tx, body: any, actor: Actor) {
  if (body.phase_id && body.internal_category_id) throw ruleError('R2', 'A line is either project work or internal work, never both.');
  if (!body.phase_id) return { project_id: null, phase_id: null, fee_component_id: null };
  const ph = (await tx.query('select ph.id, ph.project_id, pr.pm_id, pr.principal_id from phase ph join project pr on pr.id = ph.project_id where ph.id = $1', [body.phase_id])).rows[0];
  if (!ph) throw notFound('Phase');
  // Only the project's team (and its PM and principal) can record time on it, even with a known phase id.
  if (!actor.memberProjects.includes(ph.project_id) && ph.pm_id !== actor.id && ph.principal_id !== actor.id) {
    throw new ApiError(403, 'NOT_PROJECT_MEMBER', "You are not on this project's team. Ask the project manager to add you.");
  }
  return { project_id: ph.project_id, phase_id: ph.id, fee_component_id: await resolveFeeComponent(tx, ph.id, body.fee_component_id) };
}

async function insertEntry(tx: Tx, actor: Actor, firmId: string, body: any) {
  const date = isoDate(body.service_date, 'service_date');
  const duration = Number(body.duration_hours);
  if (!(duration > 0)) throw new ApiError(400, 'VALIDATION', 'Duration must be above zero.', [{ field: 'duration_hours', code: 'range' }]);
  await assertDayRoom(tx, actor.id, date, duration);
  const c = await classify(tx, body, actor);
  const ts = await ensureTimesheet(tx, firmId, actor.id, date);
  // R11: no budget, cap or NTE check happens here, by design. Actual work can always be recorded.
  return (await tx.query(
    `insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, internal_category_id, fee_component_id, duration_hours, note, timesheet_id, billing_state, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2) returning id`,
    [firmId, actor.id, date, c.project_id, c.phase_id, body.internal_category_id ?? null, c.fee_component_id, duration, body.note ?? null, ts.id, body.internal_category_id ? 'Non-billable' : 'Unbilled'],
  )).rows[0];
}

const ENTRY_SELECT = `select te.*, ph.name as phase_name, pr.code as project_code, pr.name as project_name, ic.name as category_name
  from time_entry te left join phase ph on ph.id = te.phase_id left join project pr on pr.id = te.project_id left join internal_work_category ic on ic.id = te.internal_category_id`;

export function timeRoutes({ get, post, put, del }: Api) {
  get('/me/time', async ({ tx, actor, query }) => {
    const start = weekStart(isoDate(query.period ?? new Date().toISOString().slice(0, 10), 'period'));
    const end = addDays(start, 6);
    const ts = (await tx.query('select id, status, submitted_at from timesheet where person_id = $1 and period_start = $2', [actor.id, start])).rows[0];
    const entries = (await tx.query(`${ENTRY_SELECT} where te.person_id = $1 and te.service_date between $2 and $3 order by te.service_date, te.created_at`, [actor.id, start, end])).rows;
    const lines = new Map<string, any>();
    for (const e of entries) {
      if (e.approval_state === 'Amended') continue;
      const key = e.phase_id ?? e.internal_category_id ?? `unclassified-${e.id}`;
      const line = lines.get(key) ?? {
        key, phase_id: e.phase_id, internal_category_id: e.internal_category_id,
        title: e.phase_name ?? e.category_name ?? 'Unclassified',
        subtitle: e.project_code ? `${e.project_code} ${e.project_name}` : e.internal_category_id ? 'Internal' : 'Needs a project and phase',
        hours: Array(7).fill(0), entries: [], states: new Set<string>(), reason: null,
      };
      const d = Math.round((Date.parse(e.service_date) - Date.parse(start)) / 86400000);
      line.hours[d] += Number(e.duration_hours);
      line.entries.push({ id: e.id, service_date: e.service_date, duration_hours: hours(e.duration_hours), approval_state: e.approval_state, billing_state: e.billing_state });
      line.states.add(e.approval_state);
      if (e.return_reason) line.reason = e.return_reason;
      lines.set(key, line);
    }
    const out = [...lines.values()].map(({ states, ...l }) => {
      const s = [...(states as Set<string>)];
      const state = !l.phase_id && !l.internal_category_id ? 'unclassified' : s.includes('Returned') ? 'returned' : s.every((x) => x === 'Submitted' || x === 'Approved') ? 'locked' : 'open';
      return { ...l, state, hours: l.hours.map((h: number) => Number(h.toFixed(2))) };
    });
    const dayTotals = Array(7).fill(0).map((_, i) => Number(out.reduce((s, l) => s + l.hours[i], 0).toFixed(2)));
    return {
      period_start: start, period_end: end, timesheet_id: ts?.id ?? null, status: ts?.status ?? 'Open', lines: out, day_totals: dayTotals,
      flags: dayTotals.flatMap((h, i) => (h > OVER_DAY_HOURS ? [{ code: 'over_12h_day', date: addDays(start, i), hours: h.toFixed(2) }] : [])),
    };
  });

  post('/time-entries', async ({ tx, actor, firmId, body }) => {
    required(body, ['service_date', 'duration_hours']);
    const row = await insertEntry(tx, actor, firmId, body);
    return { id: row.id, approval_state: 'Draft' };
  });

  /** Sets the hours for one grid cell: one line on one day. Zero clears it. Locked hours cannot be changed. */
  put('/me/time/cell', async ({ tx, actor, firmId, body }) => {
    const date = isoDate(body.service_date, 'service_date');
    const value = Number(body.duration_hours);
    if (!(value >= 0)) throw new ApiError(400, 'VALIDATION', 'Hours must be zero or more.', [{ field: 'duration_hours', code: 'range' }]);
    const where = body.phase_id ? 'phase_id = $3' : body.internal_category_id ? 'internal_category_id = $3' : 'id = $3';
    const ref = body.phase_id ?? body.internal_category_id ?? body.entry_id;
    if (!ref) throw new ApiError(400, 'VALIDATION', 'Say which line this cell belongs to.', [{ field: 'phase_id', code: 'required' }]);
    const existing = (await tx.query(`select id, approval_state, timesheet_id from time_entry where person_id = $1 and service_date = $2 and ${where} and approval_state <> 'Amended'`, [actor.id, date, ref])).rows;
    if (existing.some((e) => !['Draft', 'Returned'].includes(e.approval_state))) throw conflict('LOCKED', 'Submitted or approved hours cannot be edited. Request a correction instead.');
    await assertDayRoom(tx, actor.id, date, value, existing.map((e) => e.id));
    if (existing.length && value > 0) {
      await tx.query(`update time_entry set duration_hours = $2, updated_by = $3, updated_at = now() where id = $1`, [existing[0].id, value, actor.id]);
      for (const e of existing.slice(1)) await tx.query('delete from time_entry where id = $1', [e.id]);
    } else if (existing.length) {
      for (const e of existing) await tx.query('delete from time_entry where id = $1', [e.id]);
    } else if (value > 0) {
      await insertEntry(tx, actor, firmId, { service_date: date, duration_hours: value, phase_id: body.phase_id, internal_category_id: body.internal_category_id });
    }
    return { ok: true };
  });

  put('/time-entries/:id', async ({ tx, actor, params, body }) => {
    const id = uuidParam(params.id, 'Time entry');
    const e = (await tx.query('select * from time_entry where id = $1', [id])).rows[0];
    if (!e || e.person_id !== actor.id) throw notFound('Time entry');
    if (!['Draft', 'Returned'].includes(e.approval_state)) throw conflict('LOCKED', 'Submitted or approved hours cannot be edited. Request a correction instead.');
    const c = 'phase_id' in body || 'internal_category_id' in body ? await classify(tx, body, actor) : e;
    const duration = body.duration_hours ?? e.duration_hours;
    await assertDayRoom(tx, actor.id, e.service_date, Number(duration), [id]);
    await tx.query(
      `update time_entry set project_id = $2, phase_id = $3, internal_category_id = $4, fee_component_id = $5, duration_hours = $6, note = $7, billing_state = $8, updated_by = $9, updated_at = now() where id = $1`,
      [id, c.project_id, c.phase_id, body.internal_category_id ?? ('internal_category_id' in body ? null : e.internal_category_id), c.fee_component_id, duration, body.note ?? e.note, (body.internal_category_id ?? (c.phase_id ? null : e.internal_category_id)) ? 'Non-billable' : 'Unbilled', actor.id],
    );
    return { ok: true };
  });

  del('/time-entries/:id', async ({ tx, actor, params }) => {
    const id = uuidParam(params.id, 'Time entry');
    const e = (await tx.query('select person_id, approval_state from time_entry where id = $1', [id])).rows[0];
    if (!e || e.person_id !== actor.id) throw notFound('Time entry');
    if (e.approval_state !== 'Draft') throw conflict('LOCKED', 'Only a draft entry can be deleted.');
    await tx.query('delete from time_entry where id = $1', [id]);
    return { ok: true };
  });

  // F10 and DL-05: one request per project line, so a multi-project sheet can be partly approved.
  post('/timesheets/:period/submit', async ({ tx, actor, firmId, params }) => {
    const start = weekStart(isoDate(params.period, 'period'));
    const end = addDays(start, 6);
    const entries = (await tx.query(
      `select te.*, p.pm_id, p.principal_id from time_entry te left join project p on p.id = te.project_id
       where te.person_id = $1 and te.service_date between $2 and $3 and te.approval_state in ('Draft','Returned')`, [actor.id, start, end],
    )).rows;
    if (!entries.length) throw ruleError('F10', 'This week has no hours waiting to be submitted.');
    const unclassified = entries.filter((e) => !e.phase_id && !e.internal_category_id);
    if (unclassified.length) throw ruleError('R2', 'Some lines need a project and phase before you can submit.', unclassified.map((e) => ({ line_id: e.id, code: 'unclassified' })));
    const totals = (await tx.query(
      `select service_date, sum(duration_hours) h from time_entry where person_id = $1 and service_date between $2 and $3 and approval_state <> 'Amended' group by service_date`, [actor.id, start, end],
    )).rows;
    const overDays = new Set(totals.filter((t) => Number(t.h) > OVER_DAY_HOURS).map((t) => t.service_date));
    const groups = new Map<string, any[]>();
    for (const e of entries) {
      const k = e.project_id ?? 'internal';
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    const created: string[] = [];
    for (const [k, list_] of groups) {
      const first = list_[0];
      // A PM's own project time goes to the project principal, then the firm fallback: never back to the PM.
      const approver = k === 'internal' ? await routeApprover(tx, await resolvePersonApprover(tx, actor.id), actor.id) : await projectTimeApprover(tx, first, actor.id);
      const flags = list_.some((e) => overDays.has(e.service_date)) ? ['over_12h_day'] : [];
      const ar = (await tx.query(
        `insert into approval_request (firm_id, type, record_type, record_id, project_id, submitter_id, approver_id, exception_flags, created_by)
         values ($1,$2,'timesheet',$3,$4,$5,$6,$7,$5) returning id`,
        [firmId, k === 'internal' ? 'internal_time' : 'time', first.timesheet_id, k === 'internal' ? null : k, actor.id, approver, flags],
      )).rows[0];
      created.push(ar.id);
      for (const e of list_) {
        try { transition('timeApproval', e.approval_state, 'submit'); } catch (err) { rethrowTransition(err); }
        await tx.query(`update time_entry set approval_state = 'Submitted', return_reason = null, updated_by = $2, updated_at = now() where id = $1`, [e.id, actor.id]);
        await tx.query('insert into approval_request_entry (approval_request_id, time_entry_id, firm_id) values ($1,$2,$3)', [ar.id, e.id, firmId]);
      }
      await notify(tx, firmId, approver, 'timesheet.submitted', `${actor.name} submitted time for the week of ${start}`, { type: 'approval_request', id: ar.id });
    }
    const tsId = entries[0].timesheet_id;
    await tx.query('update timesheet set submitted_at = now() where id = $1', [tsId]);
    const status = await refreshTimesheet(tx, tsId);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'timesheet', recordId: tsId, action: 'submit', next: { lines: entries.length, requests: created.length } });
    return { status, approval_request_ids: created, audit_event_id };
  });

  // R14: history survives. A billed original keeps its link; the delta goes to the next draft.
  post('/time-entries/:id/correct', async ({ tx, actor, firmId, params, body }) => {
    required(body, ['duration_hours', 'reason']);
    const id = uuidParam(params.id, 'Time entry');
    const e = (await tx.query(
      `select te.*, p.pm_id, p.principal_id from time_entry te left join project p on p.id = te.project_id where te.id = $1`, [id],
    )).rows[0];
    if (!e || e.person_id !== actor.id) throw notFound('Time entry');
    try { transition('timeApproval', e.approval_state, 'amend'); } catch (err) { rethrowTransition(err); }
    if (e.billing_state === 'Reserved') throw conflict('RESERVED_IN_DRAFT', 'This entry is in a live billing draft. Reject the draft before correcting it.');
    const next = Number(body.duration_hours);
    const billed = e.billing_state === 'Billed';
    const newDuration = billed ? Number((next - Number(e.duration_hours)).toFixed(2)) : next;
    if (newDuration === 0) throw ruleError('F10', 'The corrected hours are the same as the original.');
    if (!billed && !(next > 0)) throw ruleError('F10', 'Corrected hours must be above zero.');
    await tx.query(`update time_entry set approval_state = 'Amended', updated_by = $2, updated_at = now() where id = $1`, [id, actor.id]);
    const row = (await tx.query(
      `insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, internal_category_id, fee_component_id, duration_hours, note, timesheet_id, approval_state, billing_state, corrected_from_id, correction_reason, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Submitted',$11,$12,$13,$2) returning id`,
      [firmId, actor.id, e.service_date, e.project_id, e.phase_id, e.internal_category_id, e.fee_component_id, newDuration, body.note ?? e.note, e.timesheet_id, e.internal_category_id ? 'Non-billable' : 'Unbilled', id, body.reason],
    )).rows[0];
    const approver = e.project_id ? await projectTimeApprover(tx, e, actor.id) : await routeApprover(tx, await resolvePersonApprover(tx, actor.id), actor.id);
    const ar = (await tx.query(
      `insert into approval_request (firm_id, type, record_type, record_id, project_id, submitter_id, approver_id, exception_flags, created_by)
       values ($1,$2,'timesheet',$3,$4,$5,$6,$7,$5) returning id`,
      [firmId, e.project_id ? 'time' : 'internal_time', e.timesheet_id, e.project_id, actor.id, approver, ['correction']],
    )).rows[0];
    await tx.query('insert into approval_request_entry (approval_request_id, time_entry_id, firm_id) values ($1,$2,$3)', [ar.id, row.id, firmId]);
    await refreshTimesheet(tx, e.timesheet_id);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'time_entry', recordId: id, action: 'correct', previous: { duration_hours: e.duration_hours }, next: { new_entry_id: row.id, duration_hours: newDuration }, reason: body.reason });
    return { id: row.id, duration_hours: hours(newDuration), approval_request_id: ar.id, audit_event_id };
  });

  // ----- Timers (F10): one active per person; stopping makes a draft entry with the exact duration. -----
  get('/timers/active', async ({ tx, actor }) => {
    const t = (await tx.query(
      `select t.id, t.started_at, t.project_id, t.phase_id, t.internal_category_id, ph.name as phase_name, pr.code as project_code from timer t
       left join phase ph on ph.id = t.phase_id left join project pr on pr.id = t.project_id where t.person_id = $1 and t.ended_at is null`, [actor.id],
    )).rows[0];
    return { active: t ?? null };
  });
  post('/timers/start', async ({ tx, actor, firmId, body }) => {
    if (!body.phase_id && !body.internal_category_id) throw ruleError('F10', 'A timer needs a project phase or an internal category.');
    const running = await tx.query('select id from timer where person_id = $1 and ended_at is null', [actor.id]);
    if (running.rowCount) throw conflict('TIMER_RUNNING', 'A timer is already running.', { conflicting_id: running.rows[0].id });
    const c = await classify(tx, body, actor);
    const t = (await tx.query(
      `insert into timer (firm_id, person_id, project_id, phase_id, internal_category_id, created_by) values ($1,$2,$3,$4,$5,$2) returning id, started_at`,
      [firmId, actor.id, c.project_id, c.phase_id, body.internal_category_id ?? null],
    )).rows[0];
    return { id: t.id, started_at: t.started_at };
  });
  post('/timers/stop', async ({ tx, actor, firmId }) => {
    const t = (await tx.query(`select * from timer where person_id = $1 and ended_at is null`, [actor.id])).rows[0];
    if (!t) throw conflict('NO_TIMER', 'No timer is running.');
    const h = (await tx.query(`update timer set ended_at = now() where id = $1 returning extract(epoch from (ended_at - started_at)) / 3600 as h`, [t.id])).rows[0].h;
    const duration = Math.min(24, Math.max(0.01, Number(Number(h).toFixed(2))));
    const entry = await insertEntry(tx, actor, firmId, { service_date: new Date().toISOString().slice(0, 10), duration_hours: duration, phase_id: t.phase_id, internal_category_id: t.internal_category_id });
    return { time_entry_id: entry.id, duration_hours: hours(duration) };
  });

  get('/internal-categories', async ({ tx, req }) => list(req, (await tx.query('select id, key, name from internal_work_category order by name')).rows));
}
