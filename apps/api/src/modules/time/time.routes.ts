import { addDays, OVER_DAY_HOURS, transition, weekStart } from '@ams/domain';
import { ApiError, conflict, notFound, rethrowTransition, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { hours, list } from '../../http/responses';
import { isoDate, isUuid, required, uuidParam } from '../../http/validation';
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

/** The calendar date of an instant in the firm's timezone (YYYY-MM-DD), so early-morning work in IST is not dated yesterday. */
export function localDate(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
async function firmToday(tx: Tx, at: Date = new Date()) {
  const tz = (await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined;
  return localDate(tz || 'Asia/Kolkata', at);
}

/**
 * Fee component: the phase's only one, else the main non-hourly one (decision in docs/decisions.md). An explicit one
 * must be allocated to that phase, else 422: time cannot be billed against another project's fee.
 */
async function resolveFeeComponent(tx: Tx, phaseId: string, explicit?: string) {
  if (explicit != null) {
    const ok = isUuid(explicit) && (await tx.query('select 1 from phase_fee_allocation where phase_id = $1 and fee_component_id = $2', [phaseId, explicit])).rowCount;
    if (!ok) throw ruleError('F10', 'That fee component is not allocated to this phase.', [{ field: 'fee_component_id', code: 'not_on_phase' }]);
    return explicit;
  }
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

/**
 * The task of a line (migration 012): optional, and in the same project and phase as the time. With a task and no
 * phase, the task's phase is used. `lenient` (stopping a timer) drops a task that no longer fits instead of refusing.
 */
async function taskFor(tx: Tx, body: any, lenient = false): Promise<{ task_id: string | null; phase_id: string | null }> {
  const phase = (body.phase_id ?? null) as string | null;
  if (body.task_id == null || body.task_id === '') return { task_id: null, phase_id: phase };
  if (body.internal_category_id) throw ruleError('R2', 'Internal work has no task. A task belongs to a project phase.', [{ field: 'task_id', code: 'internal' }]);
  const t = isUuid(body.task_id) ? (await tx.query('select id, project_id, phase_id, title from task where id = $1', [body.task_id])).rows[0] : null;
  if (!t) {
    if (lenient) return { task_id: null, phase_id: phase };
    throw notFound('Task');
  }
  if (!t.phase_id) {
    if (lenient) return { task_id: null, phase_id: phase };
    throw ruleError('F10', 'This task has no phase yet. Ask the project manager to give it one before logging time on it.', [{ field: 'task_id', code: 'no_phase' }]);
  }
  if (phase && phase !== t.phase_id) {
    if (lenient) return { task_id: null, phase_id: phase };
    throw ruleError('F10', 'This task belongs to another phase. Log the time on the phase of the task.', [{ field: 'task_id', code: 'not_on_phase' }]);
  }
  return { task_id: t.id, phase_id: t.phase_id };
}

/**
 * New time on closed work is refused (422): an Archived project or a Cancelled phase. On hold and Complete still take
 * time (late touches happen). Stopping a running timer, corrections and lowering or clearing hours never check this.
 */
function assertOpenForTime(r: { project_status: string; phase_status: string; project_code: string; phase_name: string }) {
  if (r.project_status === 'Archived') throw new ApiError(422, 'PROJECT_CLOSED', `${r.project_code} is archived. Time can no longer be logged on it.`, [{ field: 'phase_id', code: 'project_closed' }], { rule: 'PROJECT_CLOSED' });
  if (r.phase_status === 'Cancelled') throw new ApiError(422, 'PHASE_CANCELLED', `${r.phase_name} on ${r.project_code} is cancelled. Time can no longer be logged on it.`, [{ field: 'phase_id', code: 'phase_cancelled' }], { rule: 'PHASE_CANCELLED' });
}
async function assertPhaseOpenForTime(tx: Tx, phaseId: string | null | undefined) {
  if (!phaseId || !isUuid(phaseId)) return;
  const r = (await tx.query(
    'select ph.status as phase_status, ph.name as phase_name, pr.status as project_status, pr.code as project_code from phase ph join project pr on pr.id = ph.project_id where ph.id = $1', [phaseId],
  )).rows[0];
  if (r) assertOpenForTime(r);
}

async function classify(tx: Tx, body: any, actor: Actor, lenient = false, guard = false) {
  if (body.phase_id && body.internal_category_id) throw ruleError('R2', 'A line is either project work or internal work, never both.');
  const task = await taskFor(tx, body, lenient);
  body = { ...body, phase_id: task.phase_id };
  if (!body.phase_id) return { project_id: null, phase_id: null, fee_component_id: null, task_id: null };
  const ph = (await tx.query('select ph.id, ph.project_id, pr.pm_id, pr.principal_id from phase ph join project pr on pr.id = ph.project_id where ph.id = $1', [body.phase_id])).rows[0];
  if (!ph) throw notFound('Phase');
  // Only the project's team (and its PM and principal) can record time on it, even with a known phase id.
  if (!actor.memberProjects.includes(ph.project_id) && ph.pm_id !== actor.id && ph.principal_id !== actor.id) {
    throw new ApiError(403, 'NOT_PROJECT_MEMBER', "You are not on this project's team. Ask the project manager to add you.");
  }
  if (guard) await assertPhaseOpenForTime(tx, ph.id);
  return { project_id: ph.project_id, phase_id: ph.id, fee_component_id: await resolveFeeComponent(tx, ph.id, body.fee_component_id), task_id: task.task_id };
}

async function insertEntry(tx: Tx, actor: Actor, firmId: string, body: any, lenient = false, guard = true) {
  const date = isoDate(body.service_date, 'service_date');
  const duration = Number(body.duration_hours);
  if (!(duration > 0)) throw new ApiError(400, 'VALIDATION', 'Duration must be above zero.', [{ field: 'duration_hours', code: 'range' }]);
  await assertDayRoom(tx, actor.id, date, duration);
  const c = await classify(tx, body, actor, lenient, guard);
  const ts = await ensureTimesheet(tx, firmId, actor.id, date);
  // R11: no budget, cap or NTE check happens here, by design. Actual work can always be recorded.
  return (await tx.query(
    `insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, internal_category_id, fee_component_id, duration_hours, note, timesheet_id, billing_state, created_by, task_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$2,$12) returning id, task_id`,
    [firmId, actor.id, date, c.project_id, c.phase_id, body.internal_category_id ?? null, c.fee_component_id, duration, body.note ?? null, ts.id, body.internal_category_id ? 'Non-billable' : 'Unbilled', c.task_id],
  )).rows[0];
}

/**
 * Removes Draft or Returned entries from a grid cell. A Returned entry is still linked to the approval request that
 * returned it, so the link goes first (the request, its decision and the return reason stay), with an audit row naming
 * the hours that were removed. Without this the delete hit the link's foreign key and failed with a 500.
 */
async function deleteEntries(tx: Tx, actor: Actor, firmId: string, entries: { id: string; approval_state: string; timesheet_id?: string; corrected_from_id?: string | null }[]) {
  for (const e of entries) {
    const linked = (await tx.query('delete from approval_request_entry where time_entry_id = $1 returning approval_request_id', [e.id])).rows;
    const gone = (await tx.query('delete from time_entry where id = $1 returning duration_hours, service_date, corrected_from_id', [e.id])).rows[0];
    // Withdrawing a returned correction restores the entry it corrected (Amended -> Approved), unless another live
    // correction still replaces it: the approved hours come back instead of vanishing.
    let restored: string | null = null;
    if (gone?.corrected_from_id) {
      const r = await tx.query(
        `update time_entry o set approval_state = 'Approved', updated_by = $2, updated_at = now() where o.id = $1 and o.approval_state = 'Amended'
           and not exists (select 1 from time_entry c where c.corrected_from_id = o.id and c.approval_state <> 'Amended') returning o.id`,
        [gone.corrected_from_id, actor.id],
      );
      restored = r.rows[0]?.id ?? null;
    }
    if (linked.length && gone) {
      await audit(tx, actor, firmId, {
        recordType: 'time_entry', recordId: e.id, action: 'remove_returned',
        previous: { approval_state: e.approval_state, duration_hours: gone.duration_hours, service_date: gone.service_date, approval_request_ids: linked.map((l) => l.approval_request_id) },
        next: restored ? { restored_entry_id: restored } : undefined,
      });
    }
  }
}

const ENTRY_SELECT =`select te.*, ph.name as phase_name, pr.code as project_code, pr.name as project_name, ic.name as category_name, tk.title as task_title
  from time_entry te left join phase ph on ph.id = te.phase_id left join project pr on pr.id = te.project_id left join internal_work_category ic on ic.id = te.internal_category_id
  left join task tk on tk.id = te.task_id`;

export function timeRoutes({ get, post, put, del }: Api) {
  get('/me/time', async ({ tx, actor, query }) => {
    const start = weekStart(isoDate(query.period ?? await firmToday(tx), 'period'));
    const end = addDays(start, 6);
    const ts = (await tx.query('select id, status, submitted_at from timesheet where person_id = $1 and period_start = $2', [actor.id, start])).rows[0];
    const entries = (await tx.query(`${ENTRY_SELECT} where te.person_id = $1 and te.service_date between $2 and $3 order by te.service_date, te.created_at`, [actor.id, start, end])).rows;
    const lines = new Map<string, any>();
    for (const e of entries) {
      if (e.approval_state === 'Amended') continue;
      // A line is one phase (and task, when the time is on a task), one internal category, or one unclassified entry.
      const key = e.phase_id ? (e.task_id ? `${e.phase_id}:${e.task_id}` : e.phase_id) : e.internal_category_id ?? `unclassified-${e.id}`;
      const line = lines.get(key) ?? {
        key, phase_id: e.phase_id, internal_category_id: e.internal_category_id,
        task_id: e.task_id ?? null, task: e.task_id ? { id: e.task_id, title: e.task_title } : null,
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
    return { id: row.id, approval_state: 'Draft', task_id: row.task_id ?? null };
  });

  /**
   * Sets the hours for one grid cell: one line on one day. Zero clears it. Locked hours cannot be changed.
   * A project line is (phase_id, task_id): a phase line without task_id holds only the time that is not on a task.
   */
  put('/me/time/cell', async ({ tx, actor, firmId, body: raw }) => {
    let body = raw;
    const date = isoDate(body.service_date, 'service_date');
    const value = Number(body.duration_hours);
    if (!(value >= 0)) throw new ApiError(400, 'VALIDATION', 'Hours must be zero or more.', [{ field: 'duration_hours', code: 'range' }]);
    if (body.task_id != null && body.task_id !== '') body = { ...body, phase_id: (await taskFor(tx, body)).phase_id };
    const taskId = body.phase_id && body.task_id ? (body.task_id as string) : null;
    const where = body.phase_id ? 'phase_id = $3 and task_id is not distinct from $4::uuid' : body.internal_category_id ? 'internal_category_id = $3' : 'id = $3';
    const ref = body.phase_id ?? body.internal_category_id ?? body.entry_id;
    if (!ref) throw new ApiError(400, 'VALIDATION', 'Say which line this cell belongs to.', [{ field: 'phase_id', code: 'required' }]);
    const existing = (await tx.query(
      `select id, approval_state, timesheet_id, corrected_from_id, duration_hours, phase_id from time_entry where person_id = $1 and service_date = $2 and ${where} and approval_state <> 'Amended'`,
      body.phase_id ? [actor.id, date, ref, taskId] : [actor.id, date, ref],
    )).rows;
    if (existing.some((e) => !['Draft', 'Returned'].includes(e.approval_state))) throw conflict('LOCKED', 'Submitted or approved hours cannot be edited. Request a correction instead.');
    // A returned correction holds a difference against approved (maybe billed) hours, not the cell's hours, so typing
    // a value here would store it as the difference. It can be withdrawn (set to 0) and requested again instead.
    if (value > 0 && existing.some((e) => e.corrected_from_id)) {
      throw conflict('RETURNED_CORRECTION', 'These hours are a returned correction. Set the cell to 0 to withdraw it, then use Request correction again.');
    }
    await assertDayRoom(tx, actor.id, date, value, existing.map((e) => e.id));
    // More hours than the cell holds is new time: refused on an archived project or a cancelled phase (lowering is not).
    // The cell's own rows say which phase it is on, so a cell keyed by entry_id is checked too.
    if (existing.length && value > existing.reduce((sum, e) => sum + Number(e.duration_hours), 0) + 0.001) {
      const onPhases = new Set<string>(existing.map((e) => e.phase_id as string | null).filter((x): x is string => !!x));
      if (body.phase_id) onPhases.add(body.phase_id);
      for (const phaseId of onPhases) await assertPhaseOpenForTime(tx, phaseId);
    }
    if (existing.length && value > 0) {
      await tx.query(`update time_entry set duration_hours = $2, updated_by = $3, updated_at = now() where id = $1`, [existing[0].id, value, actor.id]);
      await deleteEntries(tx, actor, firmId, existing.slice(1));
    } else if (existing.length) {
      await deleteEntries(tx, actor, firmId, existing);
    } else if (value > 0) {
      await insertEntry(tx, actor, firmId, { service_date: date, duration_hours: value, phase_id: body.phase_id, internal_category_id: body.internal_category_id, task_id: taskId });
    }
    // Removing returned hours can change the week's status (Returned -> Open), so the timesheet is recomputed.
    if (existing.some((e) => e.approval_state === 'Returned')) await refreshTimesheet(tx, existing[0].timesheet_id);
    return { ok: true };
  });

  put('/time-entries/:id', async ({ tx, actor, params, body }) => {
    const id = uuidParam(params.id, 'Time entry');
    const e = (await tx.query('select * from time_entry where id = $1', [id])).rows[0];
    if (!e || e.person_id !== actor.id) throw notFound('Time entry');
    if (!['Draft', 'Returned'].includes(e.approval_state)) throw conflict('LOCKED', 'Submitted or approved hours cannot be edited. Request a correction instead.');
    // A task follows its phase: a new phase without a task_id drops the old task (it belonged to the old phase).
    // On the same phase the entry keeps its fee component (R10) unless the body names another.
    const reclass = 'phase_id' in body || 'internal_category_id' in body || 'task_id' in body;
    const samePhase = !('internal_category_id' in body && body.internal_category_id) && (!('phase_id' in body) || body.phase_id === e.phase_id);
    const c = reclass
      ? await classify(tx, {
        ...body,
        fee_component_id: body.fee_component_id ?? (samePhase && e.fee_component_id ? e.fee_component_id : undefined),
        phase_id: 'phase_id' in body ? body.phase_id : 'internal_category_id' in body ? null : e.phase_id,
        internal_category_id: 'internal_category_id' in body ? body.internal_category_id : 'phase_id' in body || 'task_id' in body ? null : e.internal_category_id,
        task_id: 'task_id' in body ? body.task_id : ('phase_id' in body && body.phase_id !== e.phase_id) || body.internal_category_id ? null : e.task_id,
      }, actor)
      : e;
    const duration = body.duration_hours ?? e.duration_hours;
    // Moving an entry to another phase, or raising its hours, is new time there. Lowering it is not, and nor is
    // editing a returned correction (its hours are a difference against approved time; corrections stay allowed).
    const moved = reclass && c.phase_id && c.phase_id !== e.phase_id;
    const raised = !e.corrected_from_id && Number(duration) > Number(e.duration_hours) + 0.001;
    if (c.phase_id && (moved || raised)) await assertPhaseOpenForTime(tx, c.phase_id);
    await assertDayRoom(tx, actor.id, e.service_date, Number(duration), [id]);
    await tx.query(
      `update time_entry set project_id = $2, phase_id = $3, internal_category_id = $4, fee_component_id = $5, duration_hours = $6, note = $7, billing_state = $8, updated_by = $9, updated_at = now(), task_id = $10 where id = $1`,
      [id, c.project_id, c.phase_id, body.internal_category_id ?? ('internal_category_id' in body ? null : e.internal_category_id), c.fee_component_id, duration, body.note ?? e.note, (body.internal_category_id ?? (c.phase_id ? null : e.internal_category_id)) ? 'Non-billable' : 'Unbilled', actor.id, c.task_id ?? null],
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
  // The hours given are the corrected TOTAL for the work, measured against the whole correction chain (the original and
  // every correction of it): billed entries keep counting even once Amended, so the new entry is total - what still counts.
  // Correcting a correction therefore never bills hours twice (6 h billed, corrected to 4, then to 3, nets 3, not 9).
  post('/time-entries/:id/correct', async ({ tx, actor, firmId, params, body }) => {
    required(body, ['duration_hours', 'reason']);
    const id = uuidParam(params.id, 'Time entry');
    const e = (await tx.query(
      `select te.*, p.pm_id, p.principal_id from time_entry te left join project p on p.id = te.project_id where te.id = $1 for update of te`, [id],
    )).rows[0];
    if (!e || e.person_id !== actor.id) throw notFound('Time entry');
    try { transition('timeApproval', e.approval_state, 'amend'); } catch (err) { rethrowTransition(err); }
    if (e.billing_state === 'Reserved') throw conflict('RESERVED_IN_DRAFT', 'This entry is in a live billing draft. Reject the draft before correcting it.');
    const next = Number(body.duration_hours);
    if (!Number.isFinite(next) || next < 0) throw new ApiError(400, 'VALIDATION', 'Corrected hours must be zero or more.', [{ field: 'duration_hours', code: 'range' }]);
    const chainIds = (await tx.query(
      `with recursive up as (
         select id, corrected_from_id from time_entry where id = $1
         union select t.id, t.corrected_from_id from time_entry t join up on t.id = up.corrected_from_id
       ), down as (
         select t.* from time_entry t where t.id = (select id from up where corrected_from_id is null)
         union select t.* from time_entry t join down on t.corrected_from_id = down.id
       ) select id from down where person_id = $2`, [id, actor.id],
    )).rows.map((r) => r.id as string);
    const chain = (await tx.query('select id, duration_hours, approval_state, billing_state from time_entry where id = any($1::uuid[]) for update', [chainIds])).rows;
    if (chain.some((c) => c.billing_state === 'Reserved')) throw conflict('RESERVED_IN_DRAFT', 'Part of this work is in a live billing draft. Reject the draft before correcting it.');
    const counts = (c: { approval_state: string; billing_state: string }) => c.approval_state !== 'Amended' || c.billing_state === 'Billed';
    const anyBilled = chain.some((c) => c.billing_state === 'Billed');
    // What still counts once this entry is Amended: billed entries keep counting, an unbilled one stops.
    const after = chain.reduce((s, c) => s + (counts(c) && !(c.id === id && c.billing_state !== 'Billed') ? Number(c.duration_hours) : 0), 0);
    if (!anyBilled && !(next > 0)) throw ruleError('F10', 'Corrected hours must be above zero.');
    const current = chain.reduce((s, c) => s + (counts(c) ? Number(c.duration_hours) : 0), 0);
    const newDuration = Number((next - after).toFixed(2));
    if (Math.abs(next - current) < 0.005) throw ruleError('F10', 'The corrected hours are the same as the hours already recorded.');
    if (newDuration === 0) {
      // The total asked for is what the rest of the chain already holds (undoing an unbilled correction): retire this
      // entry and insert nothing (a line is never 0 h).
      await tx.query(`update time_entry set approval_state = 'Amended', updated_by = $2, updated_at = now() where id = $1`, [id, actor.id]);
      await refreshTimesheet(tx, e.timesheet_id);
      const undoneAudit = await audit(tx, actor, firmId, { recordType: 'time_entry', recordId: id, action: 'correct', previous: { duration_hours: e.duration_hours }, next: { new_entry_id: null, total_hours: hours(next) }, reason: body.reason });
      return { id: null, duration_hours: hours(0), approval_request_id: null, audit_event_id: undoneAudit };
    }
    await tx.query(`update time_entry set approval_state = 'Amended', updated_by = $2, updated_at = now() where id = $1`, [id, actor.id]);
    const row = (await tx.query(
      `insert into time_entry (firm_id, person_id, service_date, project_id, phase_id, internal_category_id, fee_component_id, duration_hours, note, timesheet_id, approval_state, billing_state, corrected_from_id, correction_reason, created_by, task_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Submitted',$11,$12,$13,$2,$14) returning id`,
      [firmId, actor.id, e.service_date, e.project_id, e.phase_id, e.internal_category_id, e.fee_component_id, newDuration, body.note ?? e.note, e.timesheet_id, e.internal_category_id ? 'Non-billable' : 'Unbilled', id, body.reason, e.task_id],
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
      `select t.id, t.started_at, t.project_id, t.phase_id, t.internal_category_id, t.task_id, tk.title as task_title, ph.name as phase_name, pr.code as project_code from timer t
       left join phase ph on ph.id = t.phase_id left join project pr on pr.id = t.project_id left join task tk on tk.id = t.task_id where t.person_id = $1 and t.ended_at is null`, [actor.id],
    )).rows[0];
    return { active: t ?? null };
  });
  post('/timers/start', async ({ tx, actor, firmId, body }) => {
    if (!body.phase_id && !body.internal_category_id && !body.task_id) throw ruleError('F10', 'A timer needs a project phase (or a task) or an internal category.');
    const running = await tx.query('select id from timer where person_id = $1 and ended_at is null', [actor.id]);
    if (running.rowCount) throw conflict('TIMER_RUNNING', 'A timer is already running.', { conflicting_id: running.rows[0].id });
    const c = await classify(tx, body, actor, false, true);
    const t = (await tx.query(
      `insert into timer (firm_id, person_id, project_id, phase_id, internal_category_id, created_by, task_id) values ($1,$2,$3,$4,$5,$2,$6) returning id, started_at`,
      [firmId, actor.id, c.project_id, c.phase_id, body.internal_category_id ?? null, c.task_id],
    )).rows[0];
    return { id: t.id, started_at: t.started_at, phase_id: c.phase_id, task_id: c.task_id };
  });
  /**
   * Stops the running timer. Body (all optional): `discard: true` ends it with no entry; `duration_hours` logs that many
   * hours instead of the elapsed time (never more than elapsed). A timer left running past a working day, or one whose
   * day has no room left, is not logged on a guess: 409 TIMER_NEEDS_HOURS, the timer keeps running, and the person says
   * how many hours to keep (or discards it).
   */
  post('/timers/stop', async ({ tx, actor, firmId, body }) => {
    const t = (await tx.query(
      `select *, extract(epoch from (now() - started_at)) / 3600 as elapsed_h from timer where person_id = $1 and ended_at is null for update`, [actor.id],
    )).rows[0];
    // FOR UPDATE: a double-click or a second tab waits here, then finds the timer ended and gets NO_TIMER, never a second entry.
    if (!t) throw conflict('NO_TIMER', 'No timer is running.');
    const end = async () => {
      const r = await tx.query('update timer set ended_at = now() where id = $1 and ended_at is null', [t.id]);
      if (!r.rowCount) throw conflict('NO_TIMER', 'No timer is running.');
    };
    if (body?.discard === true) {
      await end();
      return { time_entry_id: null, duration_hours: hours(0), task_id: null, discarded: true };
    }
    const elapsed = Math.max(0.01, Number(Number(t.elapsed_h).toFixed(2)));
    // The day the work started, in the firm's timezone (a timer started at 05:00 IST is that day's work, not the previous UTC day's).
    const date = await firmToday(tx, new Date(t.started_at));
    let duration: number;
    if (body?.duration_hours != null) {
      duration = Number(body.duration_hours);
      if (!(duration > 0) || duration > Math.min(24, elapsed + 0.01)) {
        throw new ApiError(400, 'VALIDATION', `Hours must be above zero and no more than the ${Math.min(24, elapsed).toFixed(2)} h the timer ran.`, [{ field: 'duration_hours', code: 'range' }]);
      }
      duration = Number(duration.toFixed(2));
    } else {
      const logged = Number((await tx.query(
        `select coalesce(sum(duration_hours),0) v from time_entry where person_id = $1 and service_date = $2 and approval_state <> 'Amended'`, [actor.id, date],
      )).rows[0].v);
      const room = Math.max(0, Number((24 - logged).toFixed(2)));
      if (elapsed > OVER_DAY_HOURS || elapsed > room) {
        throw conflict(
          'TIMER_NEEDS_HOURS',
          elapsed > OVER_DAY_HOURS
            ? `This timer has run for ${elapsed.toFixed(2)} h since ${date}. Say how many hours you worked, or discard it.`
            : `${date} has only ${room.toFixed(2)} h left. Say how many hours to keep, or discard the timer.`,
          { started_at: t.started_at, service_date: date, elapsed_hours: hours(elapsed), room_hours: hours(room) },
        );
      }
      duration = elapsed;
    }
    await end();
    // The timer's task, if it still fits its phase (a task that moved meanwhile is dropped rather than losing the time).
    const entry = await insertEntry(tx, actor, firmId, { service_date: date, duration_hours: duration, phase_id: t.phase_id, internal_category_id: t.internal_category_id, task_id: t.task_id }, true, false);
    return { time_entry_id: entry.id, duration_hours: hours(duration), task_id: entry.task_id ?? null };
  });

  get('/internal-categories', async ({ tx, req }) => list(req, (await tx.query('select id, key, name from internal_work_category order by name')).rows));
}
