import { fromPaise, toPaise } from '@ams/domain';
import { authorize, can, hasFirmCap, visibleProjects } from '../../auth/authorize';
import type { Actor } from '../../auth/actor';
import { list, money } from '../../http/responses';
import type { Api } from '../../http/api';
import { entitlementOf, labourOf } from '../projects/projects.routes';
import { firmClock, plansFor, type ProjectPlan } from './plan';

/**
 * GET /projects/health: one row per visible project (not Archived) with hours, fee, schedule slip, margin, open and
 * overdue tasks, and a health status with the reasons that drove it.
 *
 * Who sees what (same gating as GET /overview): budgets.hours.view firm-wide (principal, operations, finance) sees
 * every project; scoped (a PM) sees the projects they lead; staff are refused (403). Fee figures need billing.prepare
 * or receivables.manage for the project, or margin.view firm-wide, else {restricted:true}. Margin and the margin
 * target need margin.view (and, below three people on the labour cost, rates.cost.view: section 5.3 rule 3), else
 * {restricted:true}.
 *
 * HEALTH RULE. Each signal reads On track, Watch or At risk; the project takes the worst signal, and its reasons are
 * the sentences of every signal that is not On track (At risk first).
 *   hours     forecast (approved actual + ETC) above 100% of the approved hours budget = At risk;
 *             90% to 100% = Watch; no budget but hours forecast = Watch.
 *   schedule  slip (worst phase or project-end slip, see plan.ts) above 7 days = At risk; 1 to 7 days = Watch.
 *             A project On hold or Delivery complete is never At risk from slip (Watch at most).
 *   tasks     an overdue open task that blocks another open task (finish-to-start) = At risk;
 *             any other overdue open task = Watch.
 *   status    project On hold = Watch.
 *   margin    margin to date below the margin target = Watch. Margin to date = (fee authorized - approved labour cost
 *             at stored cost rates) / fee authorized; not evaluated while no fee is authorized. The target is the
 *             project's margin_target_pct, else the studio's (default 20%).
 * The margin signal always counts towards the status, also for a viewer who cannot see margin; for that viewer its
 * reason carries no figures ("Margin is below target (figures restricted)").
 */

export type Health = 'On track' | 'Watch' | 'At risk';
const RANK: Record<Health, number> = { 'On track': 0, Watch: 1, 'At risk': 2 };
export const HEALTH_THRESHOLDS = {
  hours_watch_pct: 90, hours_at_risk_above_pct: 100,
  slip_watch_days: 1, slip_at_risk_above_days: 7,
};
export const HEALTH_RULE = [
  'Each signal reads On track, Watch or At risk; the project takes the worst. Reasons list every signal that is not On track.',
  'Hours: forecast above 100% of the approved budget is At risk; 90% to 100% is Watch; a forecast with no budget is Watch.',
  'Schedule: a slip of more than 7 days is At risk; 1 to 7 days is Watch. A project on hold or delivery complete is never At risk from slip.',
  'Tasks: an overdue task that blocks another open task is At risk; any other overdue task is Watch.',
  'Status: a project on hold is Watch.',
  'Margin: margin to date below the margin target is Watch (counted for every viewer; figures shown only with margin.view).',
];
export const MARGIN_DEFINITION = 'Margin to date = (fee authorized - approved labour cost at stored cost rates) / fee authorized. A management measure, not profit.';

type Signal = { key: 'hours' | 'schedule' | 'tasks' | 'status' | 'margin'; status: Health; reason: string | null };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtH = (n: number) => `${Number(n.toFixed(2))} h`;
const pct1 = (n: number) => Math.round(n * 10) / 10;

export function hoursSignal(budget: number, forecast: number): Signal {
  if (budget <= 0) return forecast > 0 ? { key: 'hours', status: 'Watch', reason: `No approved hours budget; ${fmtH(forecast)} forecast` } : { key: 'hours', status: 'On track', reason: null };
  const pct = (forecast / budget) * 100;
  const text = `Hours forecast ${fmtH(forecast)} is ${pct1(pct)}% of the ${fmtH(budget)} budget`;
  if (pct > HEALTH_THRESHOLDS.hours_at_risk_above_pct) return { key: 'hours', status: 'At risk', reason: text };
  if (pct >= HEALTH_THRESHOLDS.hours_watch_pct) return { key: 'hours', status: 'Watch', reason: text };
  return { key: 'hours', status: 'On track', reason: null };
}
export function scheduleSignal(slipDays: number | null, driver: string | null): Signal {
  const d = slipDays ?? 0;
  const text = `Forecast to finish ${plural(d, 'day')} late${driver ? ` (${driver})` : ''}`;
  if (d > HEALTH_THRESHOLDS.slip_at_risk_above_days) return { key: 'schedule', status: 'At risk', reason: text };
  if (d >= HEALTH_THRESHOLDS.slip_watch_days) return { key: 'schedule', status: 'Watch', reason: text };
  return { key: 'schedule', status: 'On track', reason: null };
}
/** A project On hold or Delivery complete is never At risk from slip: the slip reads Watch at most. */
export function pausedOrDelivered(status: string, s: Signal): Signal {
  return (status === 'On hold' || status === 'Delivery complete') && s.status === 'At risk' ? { ...s, status: 'Watch' } : s;
}
export function tasksSignal(overdue: number, blocking: { title: string }[]): Signal {
  if (blocking.length) {
    const names = blocking.slice(0, 3).map((t) => `"${t.title}"`).join(', ') + (blocking.length > 3 ? ` and ${blocking.length - 3} more` : '');
    return { key: 'tasks', status: 'At risk', reason: `${plural(blocking.length, 'overdue task')} ${blocking.length === 1 ? 'blocks' : 'block'} other work: ${names}` };
  }
  if (overdue) return { key: 'tasks', status: 'Watch', reason: `${plural(overdue, 'overdue task')}` };
  return { key: 'tasks', status: 'On track', reason: null };
}
export function marginSignal(value: number | null, target: number, seesFigures: boolean): Signal {
  if (value == null || value >= target) return { key: 'margin', status: 'On track', reason: null };
  return { key: 'margin', status: 'Watch', reason: seesFigures ? `Margin ${pct1(value)}% is below the ${pct1(target)}% target` : 'Margin is below target (figures restricted)' };
}
export function combine(signals: Signal[]) {
  const status = signals.reduce<Health>((w, s) => (RANK[s.status] > RANK[w] ? s.status : w), 'On track');
  const reasons = [...signals].filter((s) => s.status !== 'On track').sort((a, b) => RANK[b.status] - RANK[a.status]).map((s) => s.reason!);
  return { status, reasons, signals };
}

export function healthRoutes({ get }: Api) {
  get('/projects/health', async ({ tx, actor, query, req }) => {
    const level = actor.caps['budgets.hours.view'];
    if (level !== 'firm' && level !== 'scoped') authorize(actor, 'budgets.hours.view');
    const v = visibleProjects(actor);
    const scope = level === 'firm' ? (v === 'all' ? null : v) : actor.ledProjects.filter((id) => v === 'all' || v.includes(id));
    const clock = await firmClock(tx, query.as_of);
    const firmTarget = Number((await tx.query('select margin_target_pct from firm')).rows[0]?.margin_target_pct ?? 20);
    const rows = (await tx.query(
      `select p.id, p.code, p.name, p.status, p.hold_reason, p.margin_target_pct, c.name as client, pm.id as pm_id, pm.ref_code as pm_ref, pm.name as pm_name,
         exists (select 1 from phase ph where ph.project_id = p.id and ph.opening_actual_hours > 0) as has_opening
       from project p join client c on c.id = p.client_id join person pm on pm.id = p.pm_id
       where p.status <> 'Archived' and ($1::uuid[] is null or p.id = any($1)) order by p.code`, [scope],
    )).rows;
    const plans = await plansFor(tx, rows.map((r) => r.id), clock);
    const data = [];
    // One transaction client: one project after another.
    for (const p of rows) data.push(await healthRow(tx, actor, p, plans.get(p.id)!, firmTarget));
    return { ...list(req, data), today: clock.today, timezone: clock.tz, as_of: clock.as_of, rule: HEALTH_RULE, thresholds: HEALTH_THRESHOLDS, margin_definition: MARGIN_DEFINITION };
  });
}

async function healthRow(tx: Parameters<typeof entitlementOf>[0], actor: Actor, p: any, plan: ProjectPlan, firmTarget: number) {
  const ent = await entitlementOf(tx, p.id);
  const labour = await labourOf(tx, p.id);
  const authorized = toPaise(ent.entitled!.amount);
  const contribution = authorized - labour.total;
  const marginPct = authorized > 0 ? (contribution / authorized) * 100 : null;
  const missing = [...labour.missing, ...(p.has_opening ? ['Imported opening hours have no stored cost'] : []), ...(authorized > 0 ? [] : ['No fee authorized yet'])];
  const target = p.margin_target_pct != null ? Number(p.margin_target_pct) : firmTarget;
  const seesMargin = hasFirmCap(actor, 'margin.view') && (hasFirmCap(actor, 'rates.cost.view') || labour.people >= 3);
  const seesFee = can(actor, 'billing.prepare', { projectId: p.id, read: true }) || can(actor, 'receivables.manage', { projectId: p.id, read: true }) || hasFirmCap(actor, 'margin.view');

  const budget = Number(plan.hours.budget); const forecastH = Number(plan.hours.forecast);
  const health = combine([
    hoursSignal(budget, forecastH),
    pausedOrDelivered(p.status, scheduleSignal(plan.slip_days, plan.slip_driver?.name ?? null)),
    tasksSignal(plan.overdue_tasks, plan.blocking_overdue_tasks),
    p.status === 'On hold' ? { key: 'status', status: 'Watch', reason: `On hold${p.hold_reason ? `: ${p.hold_reason}` : ''}` } : { key: 'status', status: 'On track', reason: null },
    marginSignal(marginPct, target, seesMargin),
  ]);
  return {
    id: p.id, code: p.code, name: p.name, client: p.client, status: p.status, hold_reason: p.hold_reason,
    pm: { id: p.pm_id, ref_code: p.pm_ref, name: p.pm_name },
    hours: { ...plan.hours, forecast_pct: budget > 0 ? pct1((forecastH / budget) * 100) : null },
    fee: seesFee ? { contracted: ent.contracted, authorized: ent.entitled, drafted: ent.drafted, billed: ent.invoiced, collected: ent.collected } : { restricted: true as const },
    schedule: {
      planned_start: plan.planned_start, planned_end: plan.planned_end, forecast_end: plan.forecast_end,
      slip_days: plan.slip_days, end_slip_days: plan.end_slip_days, slip_driver: plan.slip_driver,
    },
    margin: seesMargin
      ? {
        value_pct: marginPct == null ? null : pct1(marginPct), contribution: money(fromPaise(contribution)), fee_authorized: ent.entitled,
        labour_cost: money(fromPaise(labour.total)), complete: missing.length === 0, missing, definition: MARGIN_DEFINITION,
      }
      : { restricted: true as const },
    margin_target: seesMargin ? { value_pct: target, source: p.margin_target_pct != null ? 'project' : 'firm' } : { restricted: true as const },
    open_tasks: plan.open_tasks,
    overdue_tasks: plan.overdue_tasks,
    blocking_overdue_tasks: plan.blocking_overdue_tasks.length,
    health,
  };
}

