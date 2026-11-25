import { addDays, weekStart } from '@ams/domain';
import { ApiError, conflict, notFound, ruleError } from '../../http/errors';
import { audit } from '../../audit/audit';
import { notify } from '../../audit/notify';
import { assertProjectVisible, authorize, can, hasFirmCap, visibleProjects } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { hours, list } from '../../http/responses';
import { hasTwoDecimals, isoDate, isUuid, required, uuidParam } from '../../http/validation';
import { findProject } from '../projects/projects.routes';
import { actsWith } from '../approvals/approvals.routes';
import {
  DEFAULT_WEEKS, MAX_WEEKS, isMonday, loadAllocations, round2, studioClock, weekLoad, weeklyAvailability, weekStarts,
  type AllocationRow, type LeaveRef, type PlanView, type WeekAvailability,
} from './availability';

/**
 * Resource planning (spec F03 capacity, F08 staffing). Hours from availability.ts, the one capacity definition.
 *
 * Who may do what (section 5.2):
 *  - allocate, edit, delete and publish: projects.plan for the project (principal firm-wide, operations when granted,
 *    a PM or lead on their own projects). Staff and finance never allocate.
 *  - the workload grid: capacity.manage firm-wide or view (principal, operations, PM, finance). Allocations on projects
 *    the viewer cannot open count in the load as anonymous other_hours.
 *  - a person's capacity: read with capacity.manage (staff their own), change with capacity.manage firm-wide.
 *  - holidays: everyone reads them; firm.settings.manage adds and removes them.
 *  - leave type and request id are shown only to the person, the request's approver and people.manage; everyone else
 *    sees "On leave" (section 5.3 rule 9).
 * Allocations are drafts until published; My schedule shows only the published plan (AC-F08-3).
 */

const NOTE_MAX = 500;
const STATES = ['tentative', 'confirmed'] as const;
const CAL_TYPES = ['phase', 'milestone', 'task', 'leave', 'holiday'] as const;
const CAL_MAX_DAYS = 366;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`; };

const bad = (field: string, message: string, code = 'invalid') => new ApiError(400, 'VALIDATION', message, [{ field, code }]);

// ---------- Permissions ----------

/** Firm-wide or view-level capacity.manage: may read everyone's workload. */
const readsWorkload = (a: Actor) => ['firm', 'view'].includes(a.caps['capacity.manage'] ?? '');
const mayPlan = (a: Actor, projectId: string) => can(a, 'projects.plan', { projectId });
/** Draft (unpublished) allocations are planning material: planners and workload readers see them, staff do not. */
const seesDrafts = (a: Actor) => readsWorkload(a) || ['firm', 'scoped', 'view'].includes(a.caps['projects.plan'] ?? '');
/** Projects the actor may plan: 'all', or ids (led projects and scoped grants). */
function plannable(a: Actor): 'all' | string[] {
  if (hasFirmCap(a, 'projects.plan')) return 'all';
  if (a.caps['projects.plan'] !== 'scoped') return [];
  return [...new Set([...a.ledProjects, ...(a.scopedGrants['projects.plan'] ?? [])])];
}
/** Leave detail (type, request id) for this viewer: the person, the request's approver, or people.manage (rule 9). */
const seesLeaveDetail = (a: Actor, l: LeaveRef) =>
  l.person_id === a.id || hasFirmCap(a, 'people.manage') || (l.approver_id === a.id && actsWith(a.caps['leave.approve']));
const visibleTo = (visible: 'all' | string[], projectId: string) => visible === 'all' || visible.includes(projectId);

// ---------- Parsing ----------

function parseWeeks(query: any, today: string) {
  const from = query.from != null && query.from !== '' ? isoDate(query.from, 'from') : today;
  let weeks = DEFAULT_WEEKS;
  if (query.weeks != null && query.weeks !== '') {
    weeks = /^\d+$/.test(String(query.weeks)) ? Number(query.weeks) : NaN;
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) throw bad('weeks', `weeks must be a whole number from 1 to ${MAX_WEEKS}.`, 'range');
  }
  const starts = weekStarts(from, weeks);
  return { fromWeek: starts[0], toWeek: starts[starts.length - 1], to: addDays(starts[starts.length - 1], 6), starts, weeks };
}
function parseView(v: unknown, fallback: PlanView): PlanView {
  if (v == null || v === '') return fallback;
  if (v !== 'draft' && v !== 'published') throw bad('view', 'view is draft or published.', 'enum');
  return v;
}
function text(v: unknown, field: string, what: string, max = NOTE_MAX): string | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') throw bad(field, `${what} must be text.`);
  if (v.trim().length > max) throw bad(field, `${what} can be at most ${max} characters.`, 'length');
  return v.trim();
}
function hoursValue(v: unknown, field: string, what: string, opts: { min: number; max: number; exclusiveMin?: boolean }) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw bad(field, `${what} must be a number.`, 'number');
  if ((opts.exclusiveMin ? n <= opts.min : n < opts.min) || n > opts.max) throw bad(field, `${what} must be ${opts.exclusiveMin ? 'above' : 'at least'} ${opts.min} and at most ${opts.max}.`, 'range');
  if (!hasTwoDecimals(n)) throw bad(field, `${what} can have at most two decimals.`, 'precision');
  return round2(n);
}
const weekValue = (v: unknown) => {
  const d = isoDate(v, 'week_start');
  if (!isMonday(d)) throw bad('week_start', `week_start must be a Monday (the week of ${d} starts on ${weekStart(d)}).`, 'monday');
  return d;
};

// ---------- Views ----------

type Snapshot = { id: string; person_id: string | null; phase_id: string | null; week_start: string; hours: number; state: string; note: string | null };
const sameAs = (a: Snapshot, b: Snapshot) =>
  a.person_id === b.person_id && a.phase_id === b.phase_id && a.week_start === b.week_start && Math.abs(a.hours - b.hours) < 0.001 && a.state === b.state && (a.note ?? null) === (b.note ?? null);

async function publishedById(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, Snapshot>();
  const rows = (await tx.query(
    'select allocation_id as id, person_id, phase_id, week_start, hours, state, note from allocation_published where allocation_id = any($1::uuid[])', [ids],
  )).rows;
  return new Map<string, Snapshot>(rows.map((r) => [r.id, { ...r, hours: Number(r.hours) }]));
}

function allocationView(actor: Actor, r: AllocationRow, view: PlanView, published?: Map<string, Snapshot>) {
  const snap = view === 'published' ? null : published?.get(r.id) ?? null;
  const planner = mayPlan(actor, r.project_id);
  return {
    id: r.id,
    project: { id: r.project_id, code: r.project_code, name: r.project_name, status: r.project_status },
    phase: r.phase_id ? { id: r.phase_id, code: r.phase_code, name: r.phase_name } : null,
    person: r.person_id ? { id: r.person_id, ref_code: r.person_ref, name: r.person_name } : null,
    week_start: r.week_start,
    hours: hours(r.hours),
    state: r.state,
    note: r.note,
    on_hold: r.project_status === 'On hold',
    published: view === 'published' || !!snap,
    unpublished_change: view === 'published' ? false : !snap || !sameAs(snap, r),
    overallocation_reason: planner ? r.overallocation_reason : null,
    can_edit: view === 'draft' && planner,
  };
}

function leaveView(actor: Actor, l: LeaveRef) {
  const detail = seesLeaveDetail(actor, l);
  return {
    id: detail ? l.id : null,
    status: l.status, start_date: l.start_date, end_date: l.end_date, half_day: l.half_day,
    leave_type: detail ? { key: l.leave_type.key, name: l.leave_type.name } : null,
    label: detail ? l.leave_type.name : 'On leave',
  };
}

/** One person-week: availability, the load and the allocations the viewer may see. */
function weekView(actor: Actor, w: WeekAvailability, allocs: AllocationRow[], shown: (r: AllocationRow) => boolean, view: PlanView, published?: Map<string, Snapshot>, leaveFilter: (l: LeaveRef) => boolean = () => true) {
  const load = weekLoad(w.available, allocs);
  const visible = allocs.filter(shown);
  const other = round2(allocs.filter((r) => !shown(r)).reduce((s, r) => s + r.hours, 0));
  const leave = w.leave.filter(leaveFilter);
  return {
    week_start: w.week_start, week_end: w.week_end,
    capacity: hours(w.capacity), scheduled: hours(w.scheduled),
    holiday_hours: hours(w.holiday_hours), holidays: w.holidays.map((h) => ({ date: h.date, name: h.name, half_day: h.half_day })),
    leave_approved: hours(w.leave_approved), leave_pending: hours(w.leave_pending), on_leave: w.leave_approved > 0,
    leave: leave.map((l) => leaveView(actor, l)),
    available: hours(w.available),
    allocated: hours(load.allocated), confirmed_allocations: hours(load.confirmed_allocations), tentative_allocations: hours(load.tentative_allocations),
    remaining: hours(load.remaining), load_pct: load.load_pct, conflict: load.conflict, over_hours: hours(load.over_hours),
    other_hours: hours(other),
    allocations: visible.map((r) => allocationView(actor, r, view, published)),
  };
}

// ---------- Pending changes and publishing ----------

type Change = {
  allocation_id: string; kind: 'added' | 'changed' | 'removed'; project_id: string; project_code: string;
  before: (Snapshot & { phase_name: string | null }) | null; after: (Snapshot & { phase_name: string | null }) | null;
};
/** Draft vs published, by allocation id, for these projects (null = every project). */
async function pendingChanges(tx: Tx, projectIds: string[] | null): Promise<Change[]> {
  if (projectIds && !projectIds.length) return [];
  const rows = (await tx.query(
    `select coalesce(a.id, p.allocation_id) as allocation_id, coalesce(a.project_id, p.project_id) as project_id, pr.code as project_code,
       a.id as a_id, a.person_id as a_person, a.phase_id as a_phase, a.week_start as a_week, a.hours as a_hours, a.state as a_state, a.note as a_note, aph.name as a_phase_name,
       p.allocation_id as p_id, p.person_id as p_person, p.phase_id as p_phase, p.week_start as p_week, p.hours as p_hours, p.state as p_state, p.note as p_note, pph.name as p_phase_name
     from allocation a full join allocation_published p on p.allocation_id = a.id
       join project pr on pr.id = coalesce(a.project_id, p.project_id)
       left join phase aph on aph.id = a.phase_id left join phase pph on pph.id = p.phase_id
     where ($1::uuid[] is null or coalesce(a.project_id, p.project_id) = any($1))
     order by pr.code, coalesce(a.week_start, p.week_start), coalesce(a.id, p.allocation_id)`,
    [projectIds],
  )).rows;
  const out: Change[] = [];
  for (const r of rows) {
    const after = r.a_id ? { id: r.a_id, person_id: r.a_person, phase_id: r.a_phase, week_start: r.a_week, hours: Number(r.a_hours), state: r.a_state, note: r.a_note, phase_name: r.a_phase_name } : null;
    const before = r.p_id ? { id: r.p_id, person_id: r.p_person, phase_id: r.p_phase, week_start: r.p_week, hours: Number(r.p_hours), state: r.p_state, note: r.p_note, phase_name: r.p_phase_name } : null;
    if (after && before && sameAs(after, before)) continue;
    out.push({ allocation_id: r.allocation_id, kind: !before ? 'added' : !after ? 'removed' : 'changed', project_id: r.project_id, project_code: r.project_code, before, after });
  }
  return out;
}
const pendingScope = (a: Actor, projectId?: string): string[] | null => {
  if (projectId) return mayPlan(a, projectId) ? [projectId] : [];
  const p = plannable(a);
  return p === 'all' ? null : p;
};
const changeView = (c: Change) => ({
  allocation_id: c.allocation_id, kind: c.kind, project: { id: c.project_id, code: c.project_code },
  before: c.before && { person_id: c.before.person_id, phase_id: c.before.phase_id, week_start: c.before.week_start, hours: hours(c.before.hours), state: c.before.state, note: c.before.note },
  after: c.after && { person_id: c.after.person_id, phase_id: c.after.phase_id, week_start: c.after.week_start, hours: hours(c.after.hours), state: c.after.state, note: c.after.note },
});
const describeSlot = (s: Snapshot & { phase_name: string | null }, code: string) => `${code}${s.phase_name ? ` ${s.phase_name}` : ''}, week of ${shortDate(s.week_start)}: ${Number(s.hours.toFixed(2))} h${s.state === 'tentative' ? ' (tentative)' : ''}`;

/**
 * Publish history the viewer may see: revisions that touched at least one project they can open. Projects they cannot
 * open are left out of `projects`, and the note and change count are withheld when any were (partial: true).
 */
async function revisionsFor(tx: Tx, actor: Actor, limit?: number) {
  const visible = visibleProjects(actor);
  if (visible !== 'all' && !visible.length) return [];
  const rows = (await tx.query(
    `select r.id, r.revision_no, r.scope, r.published_at, r.note, r.change_count, pe.id as by_id, pe.name as by_name,
       (select coalesce(json_agg(json_build_object('id', p.id, 'code', p.code) order by p.code), '[]'::json) from project p where p.id = any(r.project_ids)) as projects
     from plan_revision r join person pe on pe.id = r.published_by
     where ($1::uuid[] is null or r.project_ids && $1) order by r.revision_no desc ${limit ? `limit ${Number(limit)}` : ''}`,
    [visible === 'all' ? null : visible],
  )).rows;
  return rows.map((r) => {
    const projects = (r.projects as { id: string; code: string }[]).filter((p) => visibleTo(visible, p.id));
    const whole = projects.length === r.projects.length;
    return {
      id: r.id, revision_no: r.revision_no, scope: r.scope, project: r.scope === 'project' ? projects[0] ?? null : null, projects,
      published_at: r.published_at, published_by: { id: r.by_id, name: r.by_name },
      note: whole ? r.note : null, change_count: whole ? r.change_count : null, partial: !whole,
    };
  });
}
const lastRevision = async (tx: Tx, actor: Actor) => (await revisionsFor(tx, actor, 1))[0] ?? null;

// ---------- Allocation writes ----------

/** The person must be in this studio, still employed and able to sign in; on the team, or added with add_to_team. */
async function checkPerson(tx: Tx, actor: Actor, firmId: string, project: any, v: unknown, addToTeam: boolean) {
  if (v == null || v === '') return { id: null as string | null, added: false };
  if (!isUuid(v)) throw bad('person_id', 'Choose a person from this studio.', 'unknown');
  const person = (await tx.query('select id, name, employment_state, login_state from person where id = $1', [v])).rows[0];
  if (!person) throw bad('person_id', 'Choose a person from this studio.', 'unknown');
  if (person.employment_state === 'Ended') throw bad('person_id', `${person.name} has left the studio.`, 'inactive');
  if (person.login_state === 'Revoked') throw bad('person_id', `${person.name}'s account is deactivated. Reactivate it first, or choose someone else.`, 'inactive');
  const id = person.id as string;
  if (id === project.pm_id || id === project.principal_id) return { id, added: false };
  if ((await tx.query('select 1 from project_membership where project_id = $1 and person_id = $2', [project.id, id])).rowCount) return { id, added: false };
  if (!addToTeam) {
    throw ruleError('PERSON_ON_TEAM', `${person.name} is not on the ${project.code} team. Add them to the team first, or choose "add to team".`, [{ field: 'person_id', code: 'not_member' }]);
  }
  // Same rule as POST /projects/:code/members for a contributor (and as tasks): projects.plan on this project.
  authorize(actor, 'projects.plan', { projectId: project.id });
  await tx.query('insert into project_membership (firm_id, project_id, person_id, project_role, created_by) values ($1,$2,$3,$4,$5)', [firmId, project.id, id, 'contributor', actor.id]);
  await audit(tx, actor, firmId, { recordType: 'project_membership', recordId: project.id, action: 'add', next: { person_id: id, role: 'contributor', via: 'allocation' } });
  return { id, added: true };
}

async function phaseOf(tx: Tx, projectId: string, v: unknown): Promise<string | null> {
  if (v == null || v === '') return null;
  if (!isUuid(v) || !(await tx.query('select 1 from phase where id = $1 and project_id = $2', [v, projectId])).rowCount) throw bad('phase_id', 'Choose a phase of this project.', 'unknown');
  return v as string;
}

/**
 * F08: a save that leaves the person's confirmed hours in that week above their availability needs a reason (422
 * OVERALLOCATION without one); with one it is saved and audited. A save that does not add to an existing overload
 * (less hours, or tentative) needs none.
 */
async function overallocationCheck(tx: Tx, next: { person_id: string | null; week_start: string; hours: number; state: string }, reason: string | null, exceptId?: string) {
  if (!next.person_id || next.state !== 'confirmed') return null;
  const avail = (await weeklyAvailability(tx, [next.person_id], next.week_start, 1)).get(next.person_id)![0];
  const others = Number((await tx.query(
    `select coalesce(sum(hours), 0) as h from allocation where person_id = $1 and week_start = $2 and state = 'confirmed' and ($3::uuid is null or id <> $3)`,
    [next.person_id, next.week_start, exceptId ?? null],
  )).rows[0].h);
  const before = Number((await tx.query(
    `select coalesce(sum(hours), 0) as h from allocation where person_id = $1 and week_start = $2 and state = 'confirmed'`, [next.person_id, next.week_start],
  )).rows[0].h);
  const after = round2(others + next.hours);
  const over = round2(after - avail.available);
  if (over <= 0 || after <= before) return null;
  const detail = { person_id: next.person_id, week_start: next.week_start, available: hours(avail.available), confirmed_allocations: hours(after), over_hours: hours(over) };
  if (!reason) {
    throw ruleError('OVERALLOCATION', `This puts the person ${Number(over.toFixed(2))} h over their ${Number(avail.available.toFixed(2))} h available in the week of ${shortDate(next.week_start)}. Give a reason to save it anyway.`,
      [{ field: 'overallocation_reason', code: 'required', ...detail }]);
  }
  return detail;
}

async function personWeek(tx: Tx, personId: string | null, week: string) {
  if (!personId) return null;
  const w = (await weeklyAvailability(tx, [personId], week, 1)).get(personId)![0];
  const allocs = await loadAllocations(tx, 'draft', { fromWeek: week, toWeek: week, personIds: [personId] });
  const load = weekLoad(w.available, allocs);
  return {
    person_id: personId, week_start: week, available: hours(w.available), allocated: hours(load.allocated),
    confirmed_allocations: hours(load.confirmed_allocations), remaining: hours(load.remaining), load_pct: load.load_pct, conflict: load.conflict, over_hours: hours(load.over_hours),
  };
}

async function loadDraft(tx: Tx, id: string) {
  const r = (await tx.query('select * from allocation where id = $1 for update', [id])).rows[0];
  if (!r) throw notFound('Allocation');
  return { ...r, hours: Number(r.hours) };
}
async function oneView(tx: Tx, actor: Actor, id: string) {
  const [row] = await loadAllocations(tx, 'draft', { fromWeek: '0001-01-01', toWeek: '9999-12-31', ids: [id] });
  return allocationView(actor, row, 'draft', await publishedById(tx, [id]));
}

// ---------- People ----------

async function findPerson(tx: Tx, key: string) {
  if (!isUuid(key) && !/^[A-Za-z0-9-]{1,32}$/.test(key)) throw notFound('Person');
  const p = (await tx.query(
    `select id, ref_code, name, job_title, employment_state, login_state from person where ${isUuid(key) ? 'id = $1' : 'ref_code = $1'}`, [key],
  )).rows[0];
  if (!p) throw notFound('Person');
  return p;
}
const personRef = (p: any) => ({ id: p.id, ref_code: p.ref_code, name: p.name, job_title: p.job_title });

async function capacityVersions(tx: Tx, personId: string) {
  return (await tx.query(
    `select c.id, c.effective_from, c.weekly_hours, c.note, c.created_at, pe.name as by_name from person_capacity c left join person pe on pe.id = c.created_by
     where c.person_id = $1 order by c.effective_from`, [personId],
  )).rows.map((r) => ({ id: r.id, effective_from: r.effective_from, weekly_hours: hours(r.weekly_hours), note: r.note, created_at: r.created_at, created_by: r.by_name ?? null }));
}

export function planningRoutes({ get, post, put, del }: Api) {
  // ---------------- Workload grid ----------------
  get('/workload', async ({ tx, actor, query }) => {
    if (!readsWorkload(actor)) authorize(actor, 'capacity.manage', { read: true });
    const { today, timezone } = await studioClock(tx);
    const w = parseWeeks(query, today);
    const view = parseView(query.view, 'draft');
    const visible = visibleProjects(actor);
    let project: any = null;
    if (query.project != null && query.project !== '') {
      project = await findProject(tx, String(query.project));
      assertProjectVisible(actor, project.id);
    }
    const table = view === 'draft' ? 'allocation' : 'allocation_published';
    const people = (await tx.query(
      `select pe.id, pe.ref_code, pe.name, pe.job_title, pe.employment_state, pe.login_state from person pe
       where (($1::uuid is null and pe.employment_state = 'Active' and pe.login_state <> 'Revoked')
           or ($1::uuid is not null and (exists (select 1 from project_membership m where m.project_id = $1 and m.person_id = pe.id)
                                         or pe.id = (select pm_id from project where id = $1)))
           or exists (select 1 from ${table} a where a.person_id = pe.id and a.week_start between $2 and $3 and ($1::uuid is null or a.project_id = $1)))
       order by pe.ref_code`,
      [project?.id ?? null, w.fromWeek, w.toWeek],
    )).rows;
    const ids = people.map((p) => p.id as string);
    const avail = await weeklyAvailability(tx, ids, w.fromWeek, w.weeks);
    const allocs = await loadAllocations(tx, view, { fromWeek: w.fromWeek, toWeek: w.toWeek, personIds: ids });
    const unassigned = (await loadAllocations(tx, view, { fromWeek: w.fromWeek, toWeek: w.toWeek, unassignedOnly: true, projectIds: project ? [project.id] : undefined }))
      .filter((r) => visibleTo(visible, r.project_id));
    const published = view === 'draft' ? await publishedById(tx, [...allocs, ...unassigned].map((r) => r.id)) : undefined;
    const shown = (r: AllocationRow) => visibleTo(visible, r.project_id) && (!project || r.project_id === project.id);

    const conflicts: unknown[] = [];
    const rows = people.map((p) => {
      const mine = allocs.filter((a) => a.person_id === p.id);
      const weeks = (avail.get(p.id) ?? []).map((wk) => {
        const v = weekView(actor, wk, mine.filter((a) => a.week_start === wk.week_start), shown, view, published);
        if (v.conflict) conflicts.push({ person: { id: p.id, ref_code: p.ref_code, name: p.name }, week_start: wk.week_start, available: v.available, confirmed_allocations: v.confirmed_allocations, over_hours: v.over_hours });
        return v;
      });
      return { person: personRef(p), inactive: p.employment_state !== 'Active' || p.login_state === 'Revoked', weeks };
    });

    // Unassigned demand, one row per project and phase, pinned above the people.
    const groups = new Map<string, AllocationRow[]>();
    for (const r of unassigned) { const k = `${r.project_id}:${r.phase_id ?? ''}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    const demand = [...groups.values()].map((list) => ({
      project: { id: list[0].project_id, code: list[0].project_code, name: list[0].project_name, status: list[0].project_status },
      phase: list[0].phase_id ? { id: list[0].phase_id, code: list[0].phase_code, name: list[0].phase_name } : null,
      total_hours: hours(list.reduce((s, r) => s + r.hours, 0)),
      weeks: w.starts.map((ws) => {
        const inWeek = list.filter((r) => r.week_start === ws);
        return { week_start: ws, hours: hours(inWeek.reduce((s, r) => s + r.hours, 0)), allocations: inWeek.map((r) => allocationView(actor, r, view, published)) };
      }),
    }));

    const scope = pendingScope(actor, project?.id);
    const pending = scope && !scope.length ? [] : await pendingChanges(tx, scope);
    return {
      from: w.fromWeek, to: w.to, weeks: w.starts, today, timezone, view,
      project: project ? { id: project.id, code: project.code, name: project.name, status: project.status } : null,
      can_plan: project ? mayPlan(actor, project.id) : plannable(actor) === 'all' || (plannable(actor) as string[]).length > 0,
      pending_changes: pending.length,
      last_published: await lastRevision(tx, actor),
      unassigned: demand,
      people: rows,
      conflicts,
    };
  });

  // ---------------- Allocations ----------------
  get('/allocations', async ({ tx, actor, query, req }) => {
    const { today } = await studioClock(tx);
    const w = parseWeeks(query, today);
    const view = parseView(query.view, seesDrafts(actor) ? 'draft' : 'published');
    if (view === 'draft' && !seesDrafts(actor)) throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'Unpublished allocations are for planners. Ask for view=published.', [], { capability: 'projects.plan' });
    const visible = visibleProjects(actor);
    let projectIds: string[] | undefined = visible === 'all' ? undefined : visible;
    if (query.project != null && query.project !== '') {
      const p = await findProject(tx, String(query.project));
      assertProjectVisible(actor, p.id);
      projectIds = [p.id];
    }
    let personIds: string[] | undefined;
    if (query.person != null && query.person !== '') personIds = [(await findPerson(tx, String(query.person))).id];
    if (projectIds && !projectIds.length) return { view, from: w.fromWeek, to: w.to, ...list(req, []) };
    const rows = await loadAllocations(tx, view, { fromWeek: w.fromWeek, toWeek: w.toWeek, projectIds, personIds });
    const published = view === 'draft' ? await publishedById(tx, rows.map((r) => r.id)) : undefined;
    return { view, from: w.fromWeek, to: w.to, ...list(req, rows.map((r) => allocationView(actor, r, view, published))) };
  });

  post('/allocations', async ({ tx, actor, firmId, body }) => {
    required(body, ['project_id', 'week_start', 'hours']);
    const p = await findProject(tx, String(body.project_id));
    authorize(actor, 'projects.plan', { projectId: p.id });
    if (p.status === 'Archived') throw ruleError('PROJECT_CLOSED', `${p.code} is archived. Nothing can be planned on it.`);
    const week = weekValue(body.week_start);
    const h = hoursValue(body.hours, 'hours', 'Hours', { min: 0, max: 168, exclusiveMin: true });
    const state = body.state == null ? 'confirmed' : body.state;
    if (!STATES.includes(state)) throw bad('state', 'state is tentative or confirmed.', 'enum');
    const note = text(body.note, 'note', 'Note');
    const reason = text(body.overallocation_reason, 'overallocation_reason', 'The reason');
    const phaseId = await phaseOf(tx, p.id, body.phase_id);
    if (body.add_to_team != null && typeof body.add_to_team !== 'boolean') throw bad('add_to_team', 'add_to_team must be true or false.');
    const person = await checkPerson(tx, actor, firmId, p, body.person_id, body.add_to_team === true);
    const over = await overallocationCheck(tx, { person_id: person.id, week_start: week, hours: h, state }, reason);

    const id = (await tx.query(
      `insert into allocation (firm_id, project_id, phase_id, person_id, week_start, hours, state, note, overallocation_reason, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id`,
      [firmId, p.id, phaseId, person.id, week, h, state, note, over ? reason : null, actor.id],
    )).rows[0].id as string;
    let audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'allocation', recordId: id, action: 'create', next: { project: p.code, phase_id: phaseId, person_id: person.id, week_start: week, hours: h.toFixed(2), state, note },
    });
    if (over) audit_event_id = await audit(tx, actor, firmId, { recordType: 'allocation', recordId: id, action: 'overallocate', next: over, reason: reason! });
    return { ...(await oneView(tx, actor, id)), added_to_team: person.added, person_week: await personWeek(tx, person.id, week), audit_event_id };
  });

  put('/allocations/:id', async ({ tx, actor, firmId, params, body }) => {
    const prev = await loadDraft(tx, uuidParam(params.id, 'Allocation'));
    assertProjectVisible(actor, prev.project_id);
    authorize(actor, 'projects.plan', { projectId: prev.project_id });
    const p = await findProject(tx, prev.project_id);
    if (body.project_id != null && body.project_id !== prev.project_id && body.project_id !== p.code) {
      throw bad('project_id', 'An allocation stays on its project. Delete it and add one on the other project.', 'immutable');
    }
    if (body.add_to_team != null && typeof body.add_to_team !== 'boolean') throw bad('add_to_team', 'add_to_team must be true or false.');
    const next = {
      person_id: prev.person_id as string | null, phase_id: prev.phase_id as string | null, week_start: prev.week_start as string,
      hours: prev.hours as number, state: prev.state as string, note: prev.note as string | null,
    };
    let added = false;
    if (body.phase_id !== undefined) next.phase_id = await phaseOf(tx, p.id, body.phase_id);
    if (body.week_start !== undefined) next.week_start = weekValue(body.week_start);
    if (body.hours !== undefined) next.hours = hoursValue(body.hours, 'hours', 'Hours', { min: 0, max: 168, exclusiveMin: true });
    if (body.state !== undefined) { if (!STATES.includes(body.state)) throw bad('state', 'state is tentative or confirmed.', 'enum'); next.state = body.state; }
    if (body.note !== undefined) next.note = text(body.note, 'note', 'Note');
    if (body.person_id !== undefined && (body.person_id || null) !== prev.person_id) {
      const person = await checkPerson(tx, actor, firmId, p, body.person_id, body.add_to_team === true);
      next.person_id = person.id;
      added = person.added;
    }
    const reason = text(body.overallocation_reason, 'overallocation_reason', 'The reason');
    const over = await overallocationCheck(tx, next, reason, prev.id);
    await tx.query(
      `update allocation set person_id = $2, phase_id = $3, week_start = $4, hours = $5, state = $6, note = $7,
         overallocation_reason = case when $8::text is not null then $8 else overallocation_reason end, updated_by = $9, updated_at = now() where id = $1`,
      [prev.id, next.person_id, next.phase_id, next.week_start, next.hours, next.state, next.note, over ? reason : null, actor.id],
    );
    const keys = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (k === 'hours' ? Math.abs(next.hours - prev.hours) > 0.001 : next[k] !== prev[k]));
    let audit_event_id: string | null = null;
    if (keys.length) {
      audit_event_id = await audit(tx, actor, firmId, {
        recordType: 'allocation', recordId: prev.id, action: 'update',
        previous: Object.fromEntries(keys.map((k) => [k, k === 'hours' ? prev.hours.toFixed(2) : prev[k]])),
        next: Object.fromEntries(keys.map((k) => [k, k === 'hours' ? next.hours.toFixed(2) : next[k]])),
      });
    }
    if (over) audit_event_id = await audit(tx, actor, firmId, { recordType: 'allocation', recordId: prev.id, action: 'overallocate', next: over, reason: reason! });
    return { ...(await oneView(tx, actor, prev.id)), added_to_team: added, person_week: await personWeek(tx, next.person_id, next.week_start), audit_event_id };
  });

  del('/allocations/:id', async ({ tx, actor, firmId, params }) => {
    const prev = await loadDraft(tx, uuidParam(params.id, 'Allocation'));
    assertProjectVisible(actor, prev.project_id);
    authorize(actor, 'projects.plan', { projectId: prev.project_id });
    const wasPublished = !!(await tx.query('select 1 from allocation_published where allocation_id = $1', [prev.id])).rowCount;
    await tx.query('delete from allocation where id = $1', [prev.id]);
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'allocation', recordId: prev.id, action: 'delete',
      previous: { project_id: prev.project_id, phase_id: prev.phase_id, person_id: prev.person_id, week_start: prev.week_start, hours: prev.hours.toFixed(2), state: prev.state },
    });
    // A published allocation stays on My schedule until the next publish of its project.
    return { id: prev.id, deleted: true, removed_on_publish: wasPublished, audit_event_id };
  });

  /** What a publish would change: the drafts that differ from the published plan, on the projects the actor plans. */
  get('/allocations/pending', async ({ tx, actor, query, req }) => {
    let projectId: string | undefined;
    if (query.project != null && query.project !== '') {
      const p = await findProject(tx, String(query.project));
      assertProjectVisible(actor, p.id);
      authorize(actor, 'projects.plan', { projectId: p.id });
      projectId = p.id;
    } else if (plannable(actor) !== 'all' && !(plannable(actor) as string[]).length) {
      throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You need projects.plan for this.', [], { capability: 'projects.plan' });
    }
    const changes = await pendingChanges(tx, pendingScope(actor, projectId));
    return list(req, changes.map(changeView));
  });

  post('/allocations/publish', async ({ tx, actor, firmId, body }) => {
    const note = text(body.note, 'note', 'Note', 1000);
    let project: any = null;
    if (body.project != null && body.project !== '') {
      project = await findProject(tx, String(body.project));
      assertProjectVisible(actor, project.id);
      authorize(actor, 'projects.plan', { projectId: project.id });
    } else if (plannable(actor) !== 'all' && !(plannable(actor) as string[]).length) {
      throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You need projects.plan for this.', [], { capability: 'projects.plan' });
    }
    // One publish at a time per studio: revision numbers are consecutive.
    await tx.query(`select pg_advisory_xact_lock(hashtext('plan_publish:' || $1))`, [firmId]);
    const changes = await pendingChanges(tx, pendingScope(actor, project?.id));
    if (!changes.length) throw conflict('NOTHING_TO_PUBLISH', 'There are no unpublished changes to publish.');
    const projectIds = [...new Set(changes.map((c) => c.project_id))];
    const codes = [...new Set(changes.map((c) => c.project_code))];
    const no = Number((await tx.query('select coalesce(max(revision_no), 0) + 1 as n from plan_revision')).rows[0].n);
    const rev = (await tx.query(
      `insert into plan_revision (firm_id, revision_no, scope, project_id, project_ids, note, published_by, change_count, changes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7) returning id, published_at`,
      [firmId, no, project ? 'project' : 'firm', project?.id ?? null, projectIds, note, actor.id, changes.length, JSON.stringify(changes.map(changeView))],
    )).rows[0];
    // The published plan of each changed project becomes its draft.
    await tx.query('delete from allocation_published where project_id = any($1::uuid[])', [projectIds]);
    await tx.query(
      `insert into allocation_published (allocation_id, firm_id, project_id, phase_id, person_id, week_start, hours, state, note, plan_revision_id, created_by)
       select id, firm_id, project_id, phase_id, person_id, week_start, hours, state, note, $2, $3 from allocation where project_id = any($1::uuid[])`,
      [projectIds, rev.id, actor.id],
    );
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'plan_revision', recordId: rev.id, action: 'publish',
      next: { revision_no: no, scope: project ? 'project' : 'firm', projects: codes, change_count: changes.length }, reason: note ?? undefined,
    });

    // Tell each affected person what changed on their schedule (spec: notify with a diff).
    const lines = new Map<string, string[]>();
    for (const c of changes) {
      const add = (personId: string | null, line: string) => { if (personId) lines.set(personId, [...(lines.get(personId) ?? []), line]); };
      if (c.kind === 'added') add(c.after!.person_id, `added ${describeSlot(c.after!, c.project_code)}`);
      else if (c.kind === 'removed') add(c.before!.person_id, `removed ${describeSlot(c.before!, c.project_code)}`);
      else if (c.before!.person_id !== c.after!.person_id) {
        add(c.before!.person_id, `removed ${describeSlot(c.before!, c.project_code)}`);
        add(c.after!.person_id, `added ${describeSlot(c.after!, c.project_code)}`);
      } else add(c.after!.person_id, `changed ${describeSlot(c.before!, c.project_code)} to ${Number(c.after!.hours.toFixed(2))} h${c.after!.state === 'tentative' ? ' (tentative)' : ''}${c.after!.week_start !== c.before!.week_start ? ` in the week of ${shortDate(c.after!.week_start)}` : ''}`);
    }
    const notified: string[] = [];
    for (const [personId, ls] of lines) {
      if (personId === actor.id) continue;
      const shown = ls.slice(0, 3).join('; ') + (ls.length > 3 ? `; and ${ls.length - 3} more` : '');
      await notify(tx, firmId, personId, 'plan.published', `${actor.name} published plan revision ${no}: ${shown}.`, { type: 'plan_revision', id: rev.id });
      notified.push(personId);
    }

    // Conflicts in the published plan for the people and weeks this publish touched (W14: shown with the publish).
    const touched = new Map<string, Set<string>>();
    for (const c of changes) for (const s of [c.before, c.after]) if (s?.person_id) touched.set(s.person_id, (touched.get(s.person_id) ?? new Set()).add(s.week_start));
    const conflicts: unknown[] = [];
    for (const [personId, weeks] of touched) {
      for (const ws of [...weeks].sort()) {
        const a = (await weeklyAvailability(tx, [personId], ws, 1)).get(personId)![0];
        const load = weekLoad(a.available, await loadAllocations(tx, 'published', { fromWeek: ws, toWeek: ws, personIds: [personId] }));
        if (load.conflict) conflicts.push({ person_id: personId, week_start: ws, available: hours(a.available), confirmed_allocations: hours(load.confirmed_allocations), over_hours: hours(load.over_hours) });
      }
    }
    return {
      revision: { id: rev.id, revision_no: no, scope: project ? 'project' : 'firm', project: project ? { id: project.id, code: project.code } : null, note, published_at: rev.published_at, published_by: { id: actor.id, name: actor.name }, change_count: changes.length },
      projects: codes, changes: changes.map(changeView), notified, conflicts, audit_event_id,
    };
  });

  /** Publish history (PlanVersion list), newest first. */
  get('/plans', async ({ tx, actor, req }) => {
    if (!seesDrafts(actor)) authorize(actor, 'projects.plan', { read: true });
    return list(req, await revisionsFor(tx, actor));
  });

  // ---------------- My schedule ----------------
  get('/me/schedule', async ({ tx, actor, query }) => {
    authorize(actor, 'time.enter', { ownerId: actor.id });
    const { today, timezone } = await studioClock(tx);
    const w = parseWeeks(query, today);
    const avail = (await weeklyAvailability(tx, [actor.id], w.fromWeek, w.weeks)).get(actor.id) ?? [];
    const allocs = await loadAllocations(tx, 'published', { fromWeek: w.fromWeek, toWeek: w.toWeek, personIds: [actor.id] });
    const weeks = avail.map((wk) => {
      const v = weekView(actor, wk, allocs.filter((a) => a.week_start === wk.week_start), () => true, 'published');
      return {
        ...v,
        days: wk.days.map((d, i) => {
          const leave = d.leave.find((l) => l.status === 'Approved') ?? d.leave[0] ?? null;
          return {
            date: d.date, dow: DOW[i], scheduled: hours(d.scheduled), available: hours(d.available),
            holiday: d.holiday && d.scheduled ? { name: d.holiday.name, half_day: d.holiday.half_day } : null,
            leave: leave ? { status: leave.status, half_day: leave.half_day, leave_type: { key: leave.leave_type.key, name: leave.leave_type.name } } : null,
          };
        }),
      };
    });
    return { from: w.fromWeek, to: w.to, today, timezone, person: { id: actor.id, name: actor.name }, last_published: await lastRevision(tx, actor), weeks };
  });

  // ---------------- Calendar ----------------
  get('/calendar', async ({ tx, actor, query }) => {
    authorize(actor, 'people.view', { read: true });
    const { today, timezone } = await studioClock(tx);
    const from = query.from != null && query.from !== '' ? isoDate(query.from, 'from') : weekStart(today);
    const to = query.to != null && query.to !== '' ? isoDate(query.to, 'to') : addDays(from, 41);
    if (to < from) throw bad('to', 'to cannot be before from.', 'range');
    if (Date.parse(to) - Date.parse(from) > (CAL_MAX_DAYS - 1) * 86_400_000) throw bad('to', `The calendar shows at most ${CAL_MAX_DAYS} days at a time.`, 'range');
    let types: string[] = [...CAL_TYPES];
    if (query.types != null && query.types !== '') {
      types = String(query.types).split(',').map((t) => t.trim()).filter(Boolean);
      const unknown = types.filter((t) => !(CAL_TYPES as readonly string[]).includes(t));
      if (unknown.length || !types.length) throw bad('types', `types is a comma list of ${CAL_TYPES.join(', ')}.`, 'enum');
    }
    const visible = visibleProjects(actor);
    let project: any = null;
    if (query.project != null && query.project !== '') {
      project = await findProject(tx, String(query.project));
      assertProjectVisible(actor, project.id);
    }
    const scope: string[] | null = project ? [project.id] : visible === 'all' ? null : visible;
    const events: any[] = [];
    const proj = (r: any) => ({ id: r.project_id, code: r.project_code, name: r.project_name });
    const has = (t: string) => types.includes(t);

    if ((has('phase') || has('milestone')) && (!scope || scope.length)) {
      const phases = (await tx.query(
        `select ph.id, ph.code, ph.name, ph.start_date, ph.end_date, ph.status, ph.project_id, pr.code as project_code, pr.name as project_name
         from phase ph join project pr on pr.id = ph.project_id
         where pr.status <> 'Archived' and ($1::uuid[] is null or ph.project_id = any($1))
           and ((ph.start_date between $2 and $3) or (ph.end_date between $2 and $3))`, [scope, from, to],
      )).rows;
      if (has('phase')) {
        for (const ph of phases) {
          const phase = { id: ph.id, code: ph.code, name: ph.name, status: ph.status };
          if (ph.start_date && ph.start_date >= from && ph.start_date <= to) events.push({ id: `phase_start:${ph.id}`, type: 'phase_start', date: ph.start_date, title: `${ph.name} starts`, project: proj(ph), phase });
          if (ph.end_date && ph.end_date >= from && ph.end_date <= to) events.push({ id: `phase_end:${ph.id}`, type: 'phase_end', date: ph.end_date, title: `${ph.name} ends`, project: proj(ph), phase });
        }
      }
      if (has('milestone')) {
        // Billing milestones carry no date of their own: they fall on their phase's end date. Amounts are not shown here.
        const ms = (await tx.query(
          `select m.id, m.label, m.status, ph.id as phase_id, ph.code as phase_code, ph.name as phase_name, ph.end_date, pr.id as project_id, pr.code as project_code, pr.name as project_name
           from billing_milestone m join phase ph on ph.id = m.phase_id join project pr on pr.id = ph.project_id
           where pr.status <> 'Archived' and ($1::uuid[] is null or pr.id = any($1)) and ph.end_date between $2 and $3`, [scope, from, to],
        )).rows;
        for (const m of ms) events.push({ id: `milestone:${m.id}`, type: 'milestone', date: m.end_date, date_basis: 'phase_end', title: m.label, status: m.status, project: proj(m), phase: { id: m.phase_id, code: m.phase_code, name: m.phase_name } });
      }
    }
    if (has('task') && (!scope || scope.length)) {
      const tasks = (await tx.query(
        `select t.id, t.title, t.status, t.due_date, t.project_id, pr.code as project_code, pr.name as project_name, ph.id as phase_id, ph.code as phase_code, ph.name as phase_name,
           a.id as assignee_id, a.name as assignee_name
         from task t join project pr on pr.id = t.project_id left join phase ph on ph.id = t.phase_id left join person a on a.id = t.assignee_id
         where pr.status <> 'Archived' and ($1::uuid[] is null or t.project_id = any($1)) and t.due_date between $2 and $3`, [scope, from, to],
      )).rows;
      for (const t of tasks) {
        events.push({
          id: `task:${t.id}`, type: 'task_due', date: t.due_date, title: t.title, status: t.status, project: proj(t),
          phase: t.phase_id ? { id: t.phase_id, code: t.phase_code, name: t.phase_name } : null,
          task: { id: t.id, assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null, mine: t.assignee_id === actor.id },
        });
      }
    }
    if (has('leave')) {
      // Whose leave: everyone for a firm-wide viewer (without a project filter), else the viewer and their project teams.
      const teamOf = project ? [project.id] : visible === 'all' ? null : visible;
      const rows = (await tx.query(
        `select r.id, r.person_id, r.status, r.start_date, r.end_date, r.half_day, r.approver_id, t.id as type_id, t.key as type_key, t.name as type_name,
           pe.ref_code, pe.name
         from leave_request r join leave_type t on t.id = r.leave_type_id join person pe on pe.id = r.person_id
         where r.status in ('Approved', 'Pending') and r.start_date <= $3 and r.end_date >= $2
           and ($1::uuid[] is null or r.person_id = $4 or exists (select 1 from project_membership m where m.person_id = r.person_id and m.project_id = any($1))
                or exists (select 1 from project x where x.id = any($1) and x.pm_id = r.person_id))
         order by r.start_date, pe.ref_code`, [teamOf, from, to, actor.id],
      )).rows;
      for (const r of rows) {
        const l: LeaveRef = { id: r.id, person_id: r.person_id, status: r.status, start_date: r.start_date, end_date: r.end_date, half_day: !!r.half_day, approver_id: r.approver_id, leave_type: { id: r.type_id, key: r.type_key, name: r.type_name } };
        const detail = seesLeaveDetail(actor, l);
        // Colleagues see approved absence only; pending requests are for the person and those who decide them.
        if (l.status !== 'Approved' && !detail) continue;
        const v = leaveView(actor, l);
        events.push({
          id: detail ? `leave:${r.id}` : `leave:${r.person_id}:${r.start_date}`, type: 'leave', date: r.start_date < from ? from : r.start_date,
          start_date: r.start_date, end_date: r.end_date, half_day: !!r.half_day, status: r.status,
          title: r.person_id === actor.id ? v.label : `${r.name}: ${v.label}`, label: v.label, leave_type: v.leave_type,
          person: { id: r.person_id, ref_code: r.ref_code, name: r.name }, mine: r.person_id === actor.id,
        });
      }
    }
    if (has('holiday')) {
      const hs = (await tx.query('select id, date, name, half_day from firm_holiday where date between $1 and $2 order by date', [from, to])).rows;
      for (const h of hs) events.push({ id: `holiday:${h.id}`, type: 'holiday', date: h.date, title: h.name, half_day: !!h.half_day });
    }
    const ORDER = ['holiday', 'leave', 'phase_start', 'milestone', 'task_due', 'phase_end'];
    events.sort((a, b) => a.date.localeCompare(b.date) || ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || String(a.title).localeCompare(String(b.title)));
    return { from, to, today, timezone, types, project: project ? { id: project.id, code: project.code, name: project.name } : null, events };
  });

  // ---------------- Holidays ----------------
  get('/holidays', async ({ tx, actor, query, req }) => {
    authorize(actor, 'people.view', { read: true });
    const { today } = await studioClock(tx);
    const from = query.from != null && query.from !== '' ? isoDate(query.from, 'from') : `${today.slice(0, 4)}-01-01`;
    const to = query.to != null && query.to !== '' ? isoDate(query.to, 'to') : `${Number(today.slice(0, 4)) + 1}-12-31`;
    const rows = (await tx.query('select id, date, name, half_day, created_at from firm_holiday where date between $1 and $2 order by date', [from, to])).rows;
    return { from, to, can_manage: hasFirmCap(actor, 'firm.settings.manage'), ...list(req, rows.map((h) => ({ id: h.id, date: h.date, name: h.name, half_day: !!h.half_day }))) };
  });

  post('/holidays', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'firm.settings.manage');
    required(body, ['date', 'name']);
    const date = isoDate(body.date, 'date');
    const name = text(body.name, 'name', 'Name', 120);
    if (!name) throw bad('name', 'Name is required.', 'required');
    if (body.half_day != null && typeof body.half_day !== 'boolean') throw bad('half_day', 'half_day must be true or false.');
    if ((await tx.query('select 1 from firm_holiday where date = $1', [date])).rowCount) throw conflict('HOLIDAY_EXISTS', `There is already a holiday on ${date}.`);
    const h = (await tx.query(
      'insert into firm_holiday (firm_id, date, name, half_day, created_by, updated_by) values ($1,$2,$3,$4,$5,$5) returning id, date, name, half_day',
      [firmId, date, name, body.half_day === true, actor.id],
    )).rows[0];
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'firm_holiday', recordId: h.id, action: 'create', next: { date, name, half_day: !!h.half_day } });
    return { id: h.id, date: h.date, name: h.name, half_day: !!h.half_day, audit_event_id };
  });

  del('/holidays/:id', async ({ tx, actor, firmId, params }) => {
    authorize(actor, 'firm.settings.manage');
    const h = (await tx.query('delete from firm_holiday where id = $1 returning id, date, name, half_day', [uuidParam(params.id, 'Holiday')])).rows[0];
    if (!h) throw notFound('Holiday');
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'firm_holiday', recordId: h.id, action: 'delete', previous: { date: h.date, name: h.name, half_day: !!h.half_day } });
    return { id: h.id, deleted: true, audit_event_id };
  });

  // ---------------- Person capacity ----------------
  get('/people/:id/capacity', async ({ tx, actor, params, query }) => {
    const key = String(params.id ?? '');
    const own = key === actor.id || key === actor.refCode;
    if (!own && !readsWorkload(actor)) authorize(actor, 'capacity.manage', { read: true });
    const p = await findPerson(tx, key);
    authorize(actor, 'capacity.manage', { read: true, ownerId: p.id });
    const { today, timezone } = await studioClock(tx);
    const w = parseWeeks(query, today);
    const firmDefault = Number((await tx.query('select default_weekly_hours from firm')).rows[0].default_weekly_hours);
    const versions = await capacityVersions(tx, p.id);
    const current = [...versions].reverse().find((v) => v.effective_from <= today) ?? null;
    // Staff see their own published plan; workload readers see the drafts too.
    const view: PlanView = readsWorkload(actor) ? 'draft' : 'published';
    const avail = (await weeklyAvailability(tx, [p.id], w.fromWeek, w.weeks)).get(p.id) ?? [];
    const allocs = await loadAllocations(tx, view, { fromWeek: w.fromWeek, toWeek: w.toWeek, personIds: [p.id] });
    const visible = visibleProjects(actor);
    const published = view === 'draft' ? await publishedById(tx, allocs.map((a) => a.id)) : undefined;
    return {
      person: { ...personRef(p), employment_state: p.employment_state, login_state: p.login_state },
      today, timezone, view,
      firm_default_weekly_hours: hours(firmDefault),
      current: current ? { weekly_hours: current.weekly_hours, effective_from: current.effective_from, source: 'person' } : { weekly_hours: hours(firmDefault), effective_from: null, source: 'firm_default' },
      versions,
      can_manage: hasFirmCap(actor, 'capacity.manage'),
      from: w.fromWeek, to: w.to,
      weeks: avail.map((wk) => weekView(actor, wk, allocs.filter((a) => a.week_start === wk.week_start), (r) => p.id === actor.id || visibleTo(visible, r.project_id), view, published)),
    };
  });

  put('/people/:id/capacity', async ({ tx, actor, firmId, params, body }) => {
    // capacity.manage firm-wide only: staff hold it for viewing their own, PMs and finance view only.
    authorize(actor, 'capacity.manage');
    const p = await findPerson(tx, String(params.id ?? ''));
    required(body, ['weekly_hours']);
    const weekly = hoursValue(body.weekly_hours, 'weekly_hours', 'Weekly hours', { min: 0, max: 168 });
    const { today } = await studioClock(tx);
    const from = body.effective_from != null && body.effective_from !== '' ? isoDate(body.effective_from, 'effective_from') : today;
    const note = text(body.note, 'note', 'Note');
    const prev = (await tx.query('select id, weekly_hours, note from person_capacity where person_id = $1 and effective_from = $2', [p.id, from])).rows[0];
    const before = (await tx.query('select weekly_hours, effective_from from person_capacity where person_id = $1 and effective_from <= $2 order by effective_from desc limit 1', [p.id, from])).rows[0];
    let id: string;
    if (prev) {
      await tx.query('update person_capacity set weekly_hours = $2, note = $3, updated_by = $4, updated_at = now() where id = $1', [prev.id, weekly, note, actor.id]);
      id = prev.id;
    } else {
      id = (await tx.query(
        'insert into person_capacity (firm_id, person_id, effective_from, weekly_hours, note, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) returning id',
        [firmId, p.id, from, weekly, note, actor.id],
      )).rows[0].id;
    }
    const audit_event_id = await audit(tx, actor, firmId, {
      recordType: 'person_capacity', recordId: id, action: prev ? 'update' : 'create',
      previous: before ? { weekly_hours: Number(before.weekly_hours).toFixed(2), effective_from: before.effective_from } : undefined,
      next: { person_id: p.id, weekly_hours: weekly.toFixed(2), effective_from: from, note },
    });
    return { person: personRef(p), id, effective_from: from, weekly_hours: hours(weekly), note, versions: await capacityVersions(tx, p.id), audit_event_id };
  });
}
