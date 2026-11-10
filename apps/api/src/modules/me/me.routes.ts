import { addDays, OVER_DAY_HOURS, weekStart } from '@ams/domain';
import { authorize } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { hours } from '../../http/responses';
import { isoDate } from '../../http/validation';
import { localDate } from '../time/time.routes';

/**
 * The team member's own pages: Home (/me/home) and Work (/me/work). Everything here is the signed-in person's own
 * record (their time, timesheets, requests and memberships), so both ask time.enter at the `own` level, which every
 * permission set holds. Tasks are not in this round, so /me/work returns phases, not tasks.
 */

/** The standard schedule until capacity is modelled: 8 h Monday to Friday, nothing at the weekend (the grid's default). */
export const SCHEDULED_DAY_HOURS = [8, 8, 8, 8, 8, 0, 0];
/** How far back "phases I logged time on recently" looks, in days, ending today. */
export const RECENT_DAYS = 28;
/** Capabilities that put approvals in a person's queue. Only firm or scoped levels decide anything. */
const APPROVE_CAPS = ['time.approve', 'leave.approve', 'expenses.approve.scope', 'expenses.approve.finance', 'billing.approve', 'changes.authorize'];
export const canApproveAnything = (a: Actor) => APPROVE_CAPS.some((c) => a.caps[c] === 'firm' || a.caps[c] === 'scoped');

/** "Today" in the studio's timezone, or the `date` query (YYYY-MM-DD) when given, so a page can be asked about any day. */
async function studioToday(tx: Tx, date: unknown) {
  const tz = ((await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined) || 'Asia/Kolkata';
  return { today: date == null || date === '' ? localDate(tz) : isoDate(date, 'date'), timezone: tz };
}

const TYPE_LABEL: Record<string, string> = {
  time: 'Timesheet', internal_time: 'Internal time', leave: 'Leave', expense: 'Expense', supplier_bill: 'Supplier bill', change: 'Change', billing_draft: 'Billing draft',
};
const countByType = (rows: { type: string }[]) => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.type]: (m[r.type] ?? 0) + 1 }), {});

/** A week's timesheet status: no timesheet yet reads as Open (nothing submitted). */
async function weekSheet(tx: Tx, personId: string, start: string) {
  const ts = (await tx.query('select status, submitted_at from timesheet where person_id = $1 and period_start = $2', [personId, start])).rows[0];
  const h = Number((await tx.query(
    `select coalesce(sum(duration_hours),0) h from time_entry where person_id = $1 and service_date between $2 and $3 and approval_state <> 'Amended'`, [personId, start, addDays(start, 6)],
  )).rows[0].h);
  return { period_start: start, period_end: addDays(start, 6), status: (ts?.status as string) ?? 'Open', submitted_at: ts?.submitted_at ?? null, hours: hours(h) };
}
/** The line Home shows for a week's timesheet, or null when nothing needs saying. */
function sheetNotice(label: string, s: { status: string }, past: boolean) {
  if (s.status === 'Returned') return `${label} returned`;
  if (s.status === 'Open' && past) return `${label} not submitted`;
  return null;
}

export function meRoutes({ get }: Api) {
  get('/me/home', async ({ tx, actor, query }) => {
    authorize(actor, 'time.enter', { ownerId: actor.id });
    const { today, timezone } = await studioToday(tx, query.date);
    const start = weekStart(today);
    const end = addDays(start, 6);

    const timer = (await tx.query(
      `select t.id, t.started_at, t.phase_id, t.internal_category_id, ph.name as phase_name, pr.code as project_code, pr.name as project_name, ic.name as category_name
       from timer t left join phase ph on ph.id = t.phase_id left join project pr on pr.id = t.project_id left join internal_work_category ic on ic.id = t.internal_category_id
       where t.person_id = $1 and t.ended_at is null`, [actor.id],
    )).rows[0] ?? null;

    const dayRows = (await tx.query(
      `select service_date, sum(duration_hours) h from time_entry where person_id = $1 and service_date between $2 and $3 and approval_state <> 'Amended' group by service_date`,
      [actor.id, start, end],
    )).rows;
    const byDate = new Map(dayRows.map((r) => [r.service_date as string, Number(r.h)]));
    const days = SCHEDULED_DAY_HOURS.map((scheduled, i) => {
      const date = addDays(start, i);
      const h = byDate.get(date) ?? 0;
      return { date, hours: hours(h), scheduled_hours: hours(scheduled), over_12h: h > OVER_DAY_HOURS };
    });
    const total = [...byDate.values()].reduce((s, h) => s + h, 0);
    const scheduledTotal = SCHEDULED_DAY_HOURS.reduce((s, h) => s + h, 0);

    const thisWeek = await weekSheet(tx, actor.id, start);
    const lastWeek = await weekSheet(tx, actor.id, addDays(start, -7));
    const notices = [sheetNotice('This week', thisWeek, false), sheetNotice('Last week', lastWeek, true)].filter((n): n is string => !!n);

    // Returned lines: one per phase (or category) and week, with the approver's reason.
    const returned = (await tx.query(
      `select te.phase_id, te.internal_category_id, ph.code as phase_code, ph.name as phase_name, pr.code as project_code, pr.name as project_name, ic.name as category_name,
              date_trunc('week', te.service_date)::date as period_start, sum(te.duration_hours) h, max(te.return_reason) as reason, count(*)::int as entries
       from time_entry te left join phase ph on ph.id = te.phase_id left join project pr on pr.id = te.project_id left join internal_work_category ic on ic.id = te.internal_category_id
       where te.person_id = $1 and te.approval_state = 'Returned'
       group by te.phase_id, te.internal_category_id, ph.code, ph.name, pr.code, pr.name, ic.name, date_trunc('week', te.service_date)
       order by period_start, pr.code nulls last, ph.code`, [actor.id],
    )).rows.map((r) => ({
      period_start: r.period_start, phase_id: r.phase_id, internal_category_id: r.internal_category_id,
      project: r.project_code ? { code: r.project_code, name: r.project_name } : null,
      title: r.phase_name ?? r.category_name ?? 'Unclassified', phase_code: r.phase_code, hours: hours(r.h), entries: r.entries, reason: r.reason,
    }));

    // My projects (membership only), my role, and the phases I logged time on in the last RECENT_DAYS days.
    const projects = (await tx.query(
      `select p.id, p.code, p.name, p.status, m.project_role from project_membership m join project p on p.id = m.project_id
       where m.person_id = $1 and p.status not in ('Archived') order by p.code`, [actor.id],
    )).rows;
    const recent = (await tx.query(
      `select te.project_id, ph.id, ph.code, ph.name, sum(te.duration_hours) h, max(te.service_date) as last_date
       from time_entry te join phase ph on ph.id = te.phase_id
       where te.person_id = $1 and te.service_date between $2 and $3 and te.approval_state <> 'Amended'
       group by te.project_id, ph.id, ph.code, ph.name, ph.sort_order order by ph.sort_order`, [actor.id, addDays(today, -(RECENT_DAYS - 1)), today],
    )).rows;
    const myProjects = projects.map((p) => ({
      id: p.id, code: p.code, name: p.name, status: p.status, role: p.project_role,
      recent_phases: recent.filter((r) => r.project_id === p.id).map((r) => ({ id: r.id, code: r.code, name: r.name, hours: hours(r.h), last_date: r.last_date })),
    }));

    const mine = (await tx.query(
      `select a.id, a.type, a.created_at, a.exception_flags, pr.code as project_code, pr.name as project_name, t.period_start
       from approval_request a left join project pr on pr.id = a.project_id left join timesheet t on a.record_type = 'timesheet' and t.id = a.record_id
       where a.submitter_id = $1 and a.status = 'Pending' order by a.created_at`, [actor.id],
    )).rows;
    const pending = {
      total: mine.length, by_type: countByType(mine),
      items: mine.map((r) => ({
        id: r.id, type: r.type, label: TYPE_LABEL[r.type] ?? r.type, created_at: r.created_at, period_start: r.period_start ?? null,
        project: r.project_code ? { code: r.project_code, name: r.project_name } : null, flags: r.exception_flags,
      })),
    };

    let approvals: { total: number; by_type: Record<string, number> } | null = null;
    if (canApproveAnything(actor)) {
      const q = (await tx.query(
        `select type from approval_request where (approver_id = $1 or delegated_to_id = $1) and status = 'Pending'`, [actor.id],
      )).rows;
      approvals = { total: q.length, by_type: countByType(q) };
    }

    return {
      today, timezone,
      person: { id: actor.id, name: actor.name },
      timer: timer && {
        id: timer.id, started_at: timer.started_at, phase_id: timer.phase_id, internal_category_id: timer.internal_category_id,
        project: timer.project_code ? { code: timer.project_code, name: timer.project_name } : null, title: timer.phase_name ?? timer.category_name ?? null,
      },
      week: { period_start: start, period_end: end, hours: hours(total), scheduled_hours: hours(scheduledTotal), days },
      timesheets: { this_week: thisWeek, last_week: lastWeek, notices },
      returned, projects: myProjects, pending, approvals,
    };
  });

  get('/me/work', async ({ tx, actor, query }) => {
    authorize(actor, 'time.enter', { ownerId: actor.id });
    const { today, timezone } = await studioToday(tx, query.date);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [y, m] = today.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    const projects = (await tx.query(
      `select p.id, p.code, p.name, p.status, m.project_role, c.name as client_name from project_membership m join project p on p.id = m.project_id
       left join client c on c.id = p.client_id where m.person_id = $1 and p.status not in ('Archived') order by p.code`, [actor.id],
    )).rows;
    const ids = projects.map((p) => p.id);
    const phases = ids.length ? (await tx.query(
      `select id, project_id, code, name, status, start_date, end_date, sort_order from phase where project_id = any($1::uuid[]) order by sort_order, code`, [ids],
    )).rows : [];
    const mineRows = (await tx.query(
      `select phase_id, sum(duration_hours) h from time_entry where person_id = $1 and service_date between $2 and $3 and approval_state <> 'Amended' and phase_id is not null group by phase_id`,
      [actor.id, monthStart, monthEnd],
    )).rows;
    const mine = new Map(mineRows.map((r) => [r.phase_id as string, Number(r.h)]));

    const out = projects.map((p) => {
      const list = phases.filter((ph) => ph.project_id === p.id).map((ph) => ({
        id: ph.id, code: ph.code, name: ph.name, status: ph.status, start_date: ph.start_date, end_date: ph.end_date,
        current: !!ph.start_date && !!ph.end_date && ph.start_date <= today && today <= ph.end_date,
        my_hours_month: hours(mine.get(ph.id) ?? 0),
      }));
      const sum = list.reduce((s, ph) => s + Number(ph.my_hours_month), 0);
      return { id: p.id, code: p.code, name: p.name, client: p.client_name, status: p.status, role: p.project_role, my_hours_month: hours(sum), phases: list };
    });
    return {
      today, timezone, month: today.slice(0, 7), month_start: monthStart, month_end: monthEnd,
      my_hours_month: hours(out.reduce((s, p) => s + Number(p.my_hours_month), 0)), projects: out,
    };
  });
}
