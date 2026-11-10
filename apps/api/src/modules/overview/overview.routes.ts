import { addDays, OVER_DAY_HOURS, toPaise, weekStart } from '@ams/domain';
import { ApiError } from '../../http/errors';
import { authorize, can, hasFirmCap, visibleProjects } from '../../auth/authorize';
import { hours, money } from '../../http/responses';
import { isoDate } from '../../http/validation';
import type { Actor } from '../../auth/actor';
import type { Tx } from '../../db/pool';
import type { Api } from '../../http/api';
import { readyFor } from '../billing/billing.routes';
import { ACTUAL_SQL } from '../projects/projects.routes';
import { localDate } from '../time/time.routes';

/**
 * GET /overview: the studio home (/firm/overview) from real data. Key figures, the "Needs attention" list and a compact
 * project list. Hours and project health need budgets.hours.view firm-wide (principal, operations, finance) or scoped
 * (a PM: their own projects and the people on them). Staff hold it only for their own records and are refused.
 * Money follows its own capability: ready to bill needs billing.prepare, overdue receivables receivables.manage (each
 * firm-wide, or scoped to the projects the viewer leads); a project's fee needs one of those or margin.view firm-wide.
 * Everything is dated by the studio's calendar (firm.timezone), never the server's.
 */

export const STALE_APPROVAL_DAYS = 3;
/** No working schedules are stored yet, so available hours use a standard weekday, and the figure says so (R22). */
export const STANDARD_DAY_HOURS = 8;
export const SCHEDULES_MISSING = `Working schedules (a standard ${STANDARD_DAY_HOURS} h weekday is assumed)`;

export type AttentionType = 'overdue_invoice' | 'nte_excess' | 'phase_overrun' | 'over_day_hours' | 'missing_cost_rate' | 'returned_lines' | 'stale_approval';
type Severity = 'danger' | 'warn' | 'info';
type Attention = { id: string; type: AttentionType; severity: Severity; title: string; detail: string; age_days: number; link: string | null; amount?: ReturnType<typeof money> };

const SEVERITY: Record<AttentionType, Severity> = {
  overdue_invoice: 'danger', nte_excess: 'danger', phase_overrun: 'danger',
  over_day_hours: 'warn', missing_cost_rate: 'warn', returned_lines: 'warn', stale_approval: 'warn',
};
const RANK: Record<Severity, number> = { danger: 0, warn: 1, info: 2 };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** Whole days from `from` to `to` (both YYYY-MM-DD), never below zero. */
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((utc(to) - utc(from)) / 86400000));
const dayName = (iso: string) => DAYS[new Date(utc(iso)).getUTCDay()];
const shortDate = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const rupees = (paise: number) => inr.format(Math.round(paise / 100));
const h = (n: number) => `${Number(n).toFixed(2).replace(/\.00$/, '')} h`;
/** A timestamp's calendar date in the studio's timezone. */
const dateIn = (tz: string, at: Date | string | null) => (at ? localDate(tz, new Date(at)) : null);

function weekdays(from: string, to: string) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const w = new Date(utc(d)).getUTCDay(); if (w !== 0 && w !== 6) n += 1; }
  return n;
}

function staleDays(v: unknown) {
  if (v == null || v === '') return STALE_APPROVAL_DAYS;
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new ApiError(400, 'VALIDATION', 'stale_days must be a whole number of days from 1 to 365.', [{ field: 'stale_days', code: 'range' }]);
  return n;
}

/** Project ids for a money capability: null for firm-wide, the in-scope projects the viewer leads when scoped, [] when none. */
function moneyScope(actor: Actor, capability: string, inScope: string[]): string[] {
  if (hasFirmCap(actor, capability)) return inScope;
  if (actor.caps[capability] === 'scoped') return inScope.filter((id) => can(actor, capability, { projectId: id, read: true }));
  return [];
}
const mayMoney = (actor: Actor, capability: string) => hasFirmCap(actor, capability) || actor.caps[capability] === 'scoped';

export async function overviewFor(tx: Tx, actor: Actor, asOf: string, tz: string, stale: number) {
  const firmWide = actor.caps['budgets.hours.view'] === 'firm';
  const visible = visibleProjects(actor);
  const projectRows = (await tx.query(
    `select p.id, p.code, p.name, p.status, p.hold_reason, c.name as client, pm.id as pm_id, pm.ref_code as pm_ref, pm.name as pm_name,
       (select coalesce(sum(coalesce(f.contracted_amount, f.cap_amount, 0)), 0) from fee_component f where f.project_id = p.id) as fee
     from project p join client c on c.id = p.client_id join person pm on pm.id = p.pm_id
     where p.status <> 'Archived' and ($1::uuid[] is null or p.id = any($1)) order by p.code`,
    [firmWide ? (visible === 'all' ? null : visible) : actor.ledProjects.filter((id) => visible === 'all' || visible.includes(id))],
  )).rows;
  const scopeIds: string[] = projectRows.map((p) => p.id);
  const codeOf = new Map<string, string>(projectRows.map((p) => [p.id, p.code]));

  // People in scope: everyone active for a firm-wide viewer, else the people on the viewer's projects.
  const people = (await tx.query(
    `select pe.id, pe.ref_code, pe.name, pe.created_at from person pe where pe.employment_state = 'Active'
       and ($1::boolean or exists (select 1 from project_membership m where m.person_id = pe.id and m.project_id = any($2::uuid[]))) order by pe.ref_code`,
    [firmWide, scopeIds],
  )).rows;
  const personIds: string[] = people.map((p) => p.id);
  const canSeeRates = hasFirmCap(actor, 'rates.bill.manage') || hasFirmCap(actor, 'rates.cost.view') || hasFirmCap(actor, 'rates.cost.manage');

  const attention: Attention[] = [];
  const push = (a: Omit<Attention, 'severity'>) => attention.push({ ...a, severity: SEVERITY[a.type] });

  // ---- Ready to bill, and NTE / cap excess (billing.prepare). Missing rates are listed, never zero (R22).
  const billIds = moneyScope(actor, 'billing.prepare', scopeIds);
  let ready = 0; let readyCount = 0; const readyMissing: string[] = [];
  for (const id of billIds) {
    const r = await readyFor(tx, id, asOf);
    ready += r.items.reduce((s, i) => s + i.claim, 0);
    readyCount += r.items.length;
    readyMissing.push(...r.missing.map((m) => m.message));
    for (const e of r.exceptions) {
      const who = (await tx.query(
        `select min(te.service_date) as first, string_agg(distinct pe.name, ', ') as people from time_entry te join person pe on pe.id = te.person_id
         where te.fee_component_id = $1 and te.approval_state = 'Approved' and te.billing_state = 'Unbilled' and te.service_date <= $2`, [e.fee_component_id, asOf],
      )).rows[0];
      push({
        id: `nte:${e.fee_component_id}`, type: 'nte_excess', title: `${codeOf.get(id)} ${e.component}: limit reached`,
        detail: `Eligible ${rupees(e.eligible)}, excess ${rupees(e.excess)} over the ${rupees(e.cap)} cap${who.people ? ` · ${who.people}` : ''}`,
        age_days: who.first ? daysBetween(who.first, asOf) : 0, link: `/firm/projects/${codeOf.get(id)}/billing`, amount: money(e.excess),
      });
    }
  }

  // ---- Overdue receivables (receivables.manage): outstanding above zero and due before today.
  const recvIds = moneyScope(actor, 'receivables.manage', scopeIds);
  let overdue = 0; let overdueCount = 0;
  if (recvIds.length) {
    const invoices = (await tx.query(
      `select i.id, i.invoice_no, i.due_date, c.name as client, pr.code as project_code, o.name as owner_name,
         i.gross + coalesce((select sum(case when a.kind = 'debit_note' then a.amount else -a.amount end) from adjustment a where a.external_invoice_id = i.id), 0)
           - coalesce((select sum(s.amount) from settlement s where s.external_invoice_id = i.id), 0) as outstanding
       from external_invoice i join client c on c.id = i.client_id join project pr on pr.id = i.project_id left join person o on o.id = i.follow_up_owner_id
       where i.project_id = any($1::uuid[]) and i.due_date < $2 order by i.due_date, i.invoice_no`, [recvIds, asOf],
    )).rows;
    for (const i of invoices) {
      const o = toPaise(String(i.outstanding));
      if (o <= 0) continue;
      overdue += o; overdueCount += 1;
      push({
        id: `inv:${i.id}`, type: 'overdue_invoice', title: `${i.invoice_no} unpaid`,
        detail: `${i.project_code} · ${i.client} · ${rupees(o)} outstanding${i.owner_name ? ` · follow-up ${i.owner_name}` : ''}`,
        age_days: daysBetween(i.due_date, asOf), link: '/firm/receivables', amount: money(o),
      });
    }
  }

  // ---- Projects and phases: progress, fee, and phases forecast over their budget (not yet complete).
  const phases = scopeIds.length ? (await tx.query(
    `select ph.id, ph.project_id, ph.code, ph.name, ph.status, ph.etc_hours, ph.delivery_progress_pct, ph.updated_at,
       coalesce((select sum(bl.hours) from budget_line bl join budget_version bv on bv.id = bl.budget_version_id where bl.phase_id = ph.id and bv.status = 'Approved'), 0) as budget_hours,
       ph.opening_actual_hours + coalesce((select sum(te.duration_hours) from time_entry te where te.phase_id = ph.id and ${ACTUAL_SQL}), 0) as actual_hours,
       coalesce((select sum(a.amount) from phase_fee_allocation a where a.phase_id = ph.id), 0) as fee
     from phase ph where ph.project_id = any($1::uuid[]) order by ph.sort_order`, [scopeIds],
  )).rows : [];
  for (const x of phases) {
    const budget = Number(x.budget_hours); const actual = Number(x.actual_hours); const etc = Number(x.etc_hours);
    const over = actual + etc - budget;
    if (x.status === 'Complete' || budget <= 0 || over <= 0) continue;
    const code = codeOf.get(x.project_id)!;
    push({
      id: `phase:${x.id}`, type: 'phase_overrun', title: `${code} ${x.name}`,
      detail: `${h(budget)} budget, ${h(actual)} actual, ${h(etc)} ETC · forecast +${h(over)}`,
      age_days: daysBetween(dateIn(tz, x.updated_at) ?? asOf, asOf), link: `/firm/projects/${code}/phases`,
    });
  }
  const projects = projectRows.map((p) => {
    const own = phases.filter((x) => x.project_id === p.id);
    const weight = own.reduce((s, x) => s + Number(x.fee), 0);
    const delivery = weight ? own.reduce((s, x) => s + Number(x.delivery_progress_pct) * Number(x.fee), 0) / weight : 0;
    const budget = own.reduce((s, x) => s + Number(x.budget_hours), 0);
    const actual = own.reduce((s, x) => s + Number(x.actual_hours), 0);
    const etc = own.reduce((s, x) => s + Number(x.etc_hours), 0);
    const seesFee = can(actor, 'billing.prepare', { projectId: p.id, read: true }) || can(actor, 'receivables.manage', { projectId: p.id, read: true }) || hasFirmCap(actor, 'margin.view');
    return {
      id: p.id, code: p.code, name: p.name, client: p.client, status: p.status, hold_reason: p.hold_reason,
      pm: { id: p.pm_id, ref_code: p.pm_ref, name: p.pm_name },
      fee: seesFee ? money(p.fee) : { restricted: true as const },
      delivery_progress_pct: Math.round(delivery),
      hours: { budget: hours(budget), actual: hours(actual), forecast: hours(actual + etc) },
      over_budget: own.some((x) => x.status !== 'Complete' && Number(x.budget_hours) > 0 && Number(x.actual_hours) + Number(x.etc_hours) > Number(x.budget_hours)),
    };
  });

  // ---- People over 12 h in a day this week (any state but superseded), with the project holding most of that day.
  const wkFrom = weekStart(asOf); const wkTo = addDays(wkFrom, 6);
  const long = personIds.length ? (await tx.query(
    `select pe.ref_code, pe.name, te.service_date, sum(te.duration_hours) as total,
       (array_agg(pr.code order by te.duration_hours desc) filter (where pr.code is not null))[1] as top_code
     from time_entry te join person pe on pe.id = te.person_id left join project pr on pr.id = te.project_id
     where te.person_id = any($1::uuid[]) and te.service_date between $2 and $3 and te.approval_state <> 'Amended'
     group by pe.ref_code, pe.name, te.service_date having sum(te.duration_hours) > $4 order by te.service_date, pe.ref_code`,
    [personIds, wkFrom, wkTo, OVER_DAY_HOURS],
  )).rows : [];
  for (const r of long) {
    push({
      id: `long:${r.ref_code}:${r.service_date}`, type: 'over_day_hours', title: `${r.name} over ${OVER_DAY_HOURS} h on ${dayName(r.service_date)}`,
      detail: `${Number(r.total).toFixed(2)} h logged on ${shortDate(r.service_date)}`, age_days: daysBetween(r.service_date, asOf),
      link: r.top_code && [...codeOf.values()].includes(r.top_code) ? `/firm/projects/${r.top_code}/time` : null,
    });
  }

  // ---- People with no cost rate on this date: utilization and cost reports are incomplete (R22).
  const noCost = personIds.length ? (await tx.query(
    `select pe.id, pe.ref_code, pe.name, pe.created_at from person pe where pe.id = any($1::uuid[])
       and not exists (select 1 from rate_schedule r where r.person_id = pe.id and r.rate_type = 'cost' and r.project_id is null
                       and r.effective_from <= $2 and (r.effective_to is null or r.effective_to >= $2))
     order by pe.ref_code`, [personIds, asOf],
  )).rows : [];
  for (const p of noCost) {
    push({
      id: `rate:${p.id}`, type: 'missing_cost_rate', title: `${p.name} has no cost rate`, detail: 'Utilization and cost reports are incomplete',
      age_days: daysBetween(dateIn(tz, p.created_at) ?? asOf, asOf), link: canSeeRates ? '/firm/settings/rates' : null,
    });
  }

  // ---- Returned timesheet lines on the viewer's projects (a firm-wide viewer also sees internal lines).
  const returned = (await tx.query(
    `select pe.ref_code, pe.name, pr.code as project_code, te.project_id, count(*)::int as lines, sum(te.duration_hours) as total,
       (array_agg(te.return_reason order by te.updated_at desc))[1] as reason, max(te.updated_at) as at
     from time_entry te join person pe on pe.id = te.person_id left join project pr on pr.id = te.project_id
     where te.approval_state = 'Returned' and (($1::boolean and te.project_id is null) or te.project_id = any($2::uuid[]))
     group by pe.ref_code, pe.name, pr.code, te.project_id order by pe.ref_code, pr.code`, [firmWide, scopeIds],
  )).rows;
  for (const r of returned) {
    push({
      id: `ret:${r.ref_code}:${r.project_id ?? 'internal'}`, type: 'returned_lines',
      title: `${r.name}: ${r.lines === 1 ? 'one returned line' : `${r.lines} returned lines`}`,
      detail: `${r.project_code ?? 'Internal time'} · ${Number(r.total).toFixed(2)} h${r.reason ? ` · ${r.reason}` : ''}`,
      age_days: daysBetween(dateIn(tz, r.at) ?? asOf, asOf), link: r.project_code ? `/firm/projects/${r.project_code}/time` : null,
    });
  }

  // ---- Approvals waiting for the viewer (their own queue, as GET /approvals), and the ones older than `stale` days.
  const waiting = (await tx.query(
    `select a.id, a.type, a.created_at, s.name as submitter, pr.code as project_code from approval_request a join person s on s.id = a.submitter_id
       left join project pr on pr.id = a.project_id
     where (a.approver_id = $1 or a.delegated_to_id = $1) and a.status = 'Pending' order by a.created_at`, [actor.id],
  )).rows;
  const ageOf = (r: { created_at: Date }) => daysBetween(dateIn(tz, r.created_at) ?? asOf, asOf);
  for (const r of waiting) {
    const age = ageOf(r);
    if (age < stale) continue;
    push({
      id: `appr:${r.id}`, type: 'stale_approval', title: `${r.submitter}: ${r.type.replace('_', ' ')} waiting ${age} days`,
      detail: `${r.project_code ?? 'No project'} · waiting for your decision`, age_days: age, link: '/firm/approvals',
    });
  }

  // ---- Utilization this month to date: approved billable hours / available hours of the people in scope.
  const monthFrom = `${asOf.slice(0, 8)}01`;
  const billable = personIds.length ? Number((await tx.query(
    `select coalesce(sum(duration_hours), 0) as v from time_entry where person_id = any($1::uuid[]) and project_id is not null and billing_state <> 'Non-billable'
       and service_date between $2 and $3 and ${ACTUAL_SQL} and ($4::boolean or project_id = any($5::uuid[]))`,
    [personIds, monthFrom, asOf, firmWide, scopeIds],
  )).rows[0].v) : 0;
  const available = weekdays(monthFrom, asOf) * STANDARD_DAY_HOURS * personIds.length;
  const utilMissing = [SCHEDULES_MISSING, ...noCost.map((p) => `${p.name} cost rate`)];

  attention.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.age_days - a.age_days || a.title.localeCompare(b.title));
  return {
    as_of: asOf, timezone: tz, scope: firmWide ? 'firm' : 'projects',
    period: { from: monthFrom, to: asOf }, week: { from: wkFrom, to: wkTo },
    figures: {
      ready_to_bill: mayMoney(actor, 'billing.prepare')
        ? { value: money(ready), count: readyCount, complete: readyMissing.length === 0, missing: readyMissing }
        : { restricted: true as const },
      overdue: mayMoney(actor, 'receivables.manage') ? { value: money(overdue), count: overdueCount } : { restricted: true as const },
      utilization: {
        value: available > 0 ? Math.round((billable / available) * 1000) / 10 : null,
        billable_hours: hours(billable), available_hours: hours(available), people: personIds.length,
        complete: utilMissing.length === 0, missing: utilMissing,
      },
      approvals_waiting: { count: waiting.length, oldest_days: waiting.length ? ageOf(waiting[0]) : 0, stale_after_days: stale },
    },
    attention,
    projects,
  };
}

export function overviewRoutes({ get }: Api) {
  get('/overview', async ({ tx, actor, query }) => {
    const level = actor.caps['budgets.hours.view'];
    if (level !== 'firm' && level !== 'scoped') authorize(actor, 'budgets.hours.view');
    const stale = staleDays(query.stale_days);
    const tz = ((await tx.query('select timezone from firm')).rows[0]?.timezone as string | undefined) || 'Asia/Kolkata';
    const asOf = query.as_of != null && query.as_of !== '' ? isoDate(query.as_of, 'as_of') : localDate(tz);
    return overviewFor(tx, actor, asOf, tz, stale);
  });
}
