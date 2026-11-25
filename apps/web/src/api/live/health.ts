/**
 * Live client for GET /projects/health (API round 2, modules/schedule/health.ts): one row per visible project with
 * hours, fee, schedule slip, margin, open and overdue tasks and a health status with the reasons that drove it.
 * The status, the reasons and the rule all come from the API; the screen never works health out itself.
 */
import { apiFetch, isRestricted, type ListResponse, type LiveMoney, type Restricted } from '../live';

export type Health = 'On track' | 'Watch' | 'At risk';
export const HEALTH_ORDER: Health[] = ['At risk', 'Watch', 'On track'];
const RANK: Record<Health, number> = { 'On track': 0, Watch: 1, 'At risk': 2 };

export type HealthSignal = { key: 'hours' | 'schedule' | 'tasks' | 'status' | 'margin'; status: Health; reason: string | null };
export type HealthFee = { contracted: LiveMoney | null; authorized: LiveMoney | null; drafted: LiveMoney | null; billed: LiveMoney | null; collected: LiveMoney | null };
export type HealthMargin = {
  value_pct: number | null; contribution: LiveMoney; fee_authorized: LiveMoney | null; labour_cost: LiveMoney;
  complete: boolean; missing: string[]; definition: string;
};
export type HealthRow = {
  id: string; code: string; name: string; client: string; status: string; hold_reason: string | null;
  pm: { id: string; ref_code: string; name: string };
  hours: { budget: string; actual: string; etc: string; forecast: string; forecast_pct: number | null };
  fee: HealthFee | Restricted;
  schedule: {
    planned_start: string | null; planned_end: string | null; forecast_end: string | null;
    slip_days: number | null; end_slip_days: number | null; slip_driver: { kind: 'phase' | 'project'; id: string | null; name: string } | null;
  };
  margin: HealthMargin | Restricted;
  margin_target: { value_pct: number; source: 'project' | 'firm' } | Restricted;
  open_tasks: number;
  overdue_tasks: number;
  blocking_overdue_tasks: number;
  health: { status: Health; reasons: string[]; signals: HealthSignal[] };
};
export type HealthThresholds = { hours_watch_pct: number; hours_at_risk_above_pct: number; slip_watch_days: number; slip_at_risk_above_days: number };
export type ProjectHealth = {
  rows: HealthRow[]; today: string; asOf: string | null; rule: string[]; thresholds: HealthThresholds | null; marginDefinition: string | null;
  /** False when the server holds more rows than it sent (a paged list). */
  complete: boolean;
};
type ApiHealth = ListResponse<HealthRow> & { today: string; timezone: string; as_of?: string | null; rule: string[]; thresholds: HealthThresholds; margin_definition: string };

export async function getProjectHealth(): Promise<ProjectHealth> {
  const r = await apiFetch<ApiHealth>('/projects/health?page_size=200');
  return {
    rows: r.data, today: r.today, asOf: r.as_of ?? null, rule: r.rule ?? [], thresholds: r.thresholds ?? null, marginDefinition: r.margin_definition ?? null,
    complete: r.total == null || r.total <= r.data.length,
  };
}

// ---------- Pure helpers the screen shares (and the tests check) ----------

export type HealthSort = 'risk' | 'slip' | 'hours' | 'name';
export const HEALTH_SORTS: { value: HealthSort; label: string }[] = [
  { value: 'risk', label: 'Risk' }, { value: 'slip', label: 'Slip' }, { value: 'hours', label: 'Hours' }, { value: 'name', label: 'Name' },
];
const num = (s: string | null | undefined) => (s == null ? 0 : Number(s));
/** Hours forecast as a share of the budget; null with no budget (never a divide by zero). */
export const hoursPct = (r: HealthRow) => (r.hours.forecast_pct != null ? r.hours.forecast_pct : num(r.hours.budget) > 0 ? (num(r.hours.forecast) / num(r.hours.budget)) * 100 : null);

export function sortHealth(rows: HealthRow[], by: HealthSort): HealthRow[] {
  const name = (a: HealthRow, b: HealthRow) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  const slip = (r: HealthRow) => r.schedule.slip_days ?? -1;
  const hours = (r: HealthRow) => hoursPct(r) ?? (num(r.hours.forecast) > 0 ? Number.MAX_SAFE_INTEGER : -1);
  const fns: Record<HealthSort, (a: HealthRow, b: HealthRow) => number> = {
    risk: (a, b) => RANK[b.health.status] - RANK[a.health.status] || slip(b) - slip(a) || hours(b) - hours(a) || name(a, b),
    slip: (a, b) => slip(b) - slip(a) || name(a, b),
    hours: (a, b) => hours(b) - hours(a) || name(a, b),
    name,
  };
  return [...rows].sort(fns[by]);
}

export const healthCounts = (rows: HealthRow[]) => HEALTH_ORDER.map((h) => ({ status: h, count: rows.filter((r) => r.health.status === h).length }));

/** The why line: the API's reasons, worst first. An On track project says what it reads instead. */
export function whyLine(r: HealthRow): string {
  if (r.health.reasons.length) return `${r.health.reasons.join('. ')}.`;
  const pct = hoursPct(r);
  return pct == null ? 'No signal needs attention.' : `Hours forecast at ${Math.round(pct)}% of budget; schedule and tasks on plan.`;
}

/** Fee bar widths against the fee authorized. Null when fenced or nothing is authorized yet. */
export function feeShares(fee: HealthRow['fee']): { authorized: number; billed: number; collected: number; billedPct: number; collectedPct: number } | null {
  if (isRestricted(fee)) return null;
  const authorized = num(fee.authorized?.amount);
  const billed = num(fee.billed?.amount);
  const collected = num(fee.collected?.amount);
  const scale = Math.max(authorized, billed, 1);
  return { authorized, billed, collected, billedPct: Math.min(100, (billed / scale) * 100), collectedPct: Math.min(100, (collected / scale) * 100) };
}

/** "₹27.3 L" for lakhs, "₹4.2 Cr" for crores, plain rupees below a lakh. */
export function compactINR(n: number): string {
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function slipText(r: HealthRow): { value: string; sub: string; late: boolean } {
  if (r.status === 'On hold') return { value: 'On hold', sub: r.hold_reason ?? 'paused', late: false };
  const d = r.schedule.slip_days;
  if (d == null) return { value: 'No dates', sub: 'no planned end yet', late: false };
  if (d <= 0) return { value: 'None', sub: 'on plan', late: false };
  return { value: `${d} ${d === 1 ? 'day' : 'days'}`, sub: r.schedule.slip_driver?.name ?? 'forecast end', late: true };
}

// ---------- Mock mode: sample rows in the API's shape, never fetched ----------

const m = (amount: number): LiveMoney => ({ amount: amount.toFixed(2), currency: 'INR' });
const sig = (key: HealthSignal['key'], status: Health, reason: string | null = null): HealthSignal => ({ key, status, reason });
const RULE = [
  'Each signal reads On track, Watch or At risk; the project takes the worst. Reasons list every signal that is not On track.',
  'Hours: forecast above 100% of the approved budget is At risk; 90% to 100% is Watch; a forecast with no budget is Watch.',
  'Schedule: a slip of more than 7 days is At risk; 1 to 7 days is Watch.',
  'Tasks: an overdue task that blocks another open task is At risk; any other overdue task is Watch.',
  'Status: a project on hold is Watch.',
  'Margin: margin to date below the margin target is Watch (counted for every viewer; figures shown only with margin.view).',
];
const DEFINITION = 'Margin to date = (fee authorized - approved labour cost at stored cost rates) / fee authorized. A management measure, not profit.';

export function mockProjectHealth(): ProjectHealth {
  const margin = (pct: number, auth: number): HealthMargin => ({
    value_pct: pct, contribution: m((auth * pct) / 100), fee_authorized: m(auth), labour_cost: m(auth - (auth * pct) / 100), complete: true, missing: [], definition: DEFINITION,
  });
  const rows: HealthRow[] = [
    {
      id: 'p1', code: 'PRJ-01', name: 'Lakeview Residence', client: 'Lakeview Trust', status: 'Active', hold_reason: null,
      pm: { id: 'P02', ref_code: 'P02', name: 'Vikram Nair' },
      hours: { budget: '1800.00', actual: '1268.00', etc: '562.00', forecast: '1830.00', forecast_pct: 101.7 },
      fee: { contracted: m(2400000), authorized: m(4200000), drafted: m(0), billed: m(2730000), collected: m(2100000) },
      schedule: { planned_start: '2026-03-02', planned_end: '2027-02-26', forecast_end: '2027-03-03', slip_days: 5, end_slip_days: 5, slip_driver: { kind: 'phase', id: 'p1-wd', name: 'Working drawings' } },
      margin: margin(23, 4200000), margin_target: { value_pct: 25, source: 'firm' },
      open_tasks: 7, overdue_tasks: 2, blocking_overdue_tasks: 1,
      health: {
        status: 'At risk',
        reasons: ['Hours forecast 1830 h is 101.7% of the 1800 h budget', '1 overdue task blocks other work: "GA plans issued"', 'Forecast to finish 5 days late (Working drawings)', 'Margin 23% is below the 25% target'],
        signals: [sig('hours', 'At risk', 'Hours forecast 1830 h is 101.7% of the 1800 h budget'), sig('schedule', 'Watch', 'Forecast to finish 5 days late (Working drawings)'), sig('tasks', 'At risk', '1 overdue task blocks other work: "GA plans issued"'), sig('status', 'On track'), sig('margin', 'Watch', 'Margin 23% is below the 25% target')],
      },
    },
    {
      id: 'p2', code: 'PRJ-02', name: 'Orchard Commercial Block', client: 'Orchard Developers', status: 'Active', hold_reason: null,
      pm: { id: 'P03', ref_code: 'P03', name: 'Meera Iyer' },
      hours: { budget: '2400.00', actual: '1150.00', etc: '1110.00', forecast: '2260.00', forecast_pct: 94.2 },
      fee: { contracted: m(6500000), authorized: m(6500000), drafted: m(0), billed: m(3050000), collected: m(2400000) },
      schedule: { planned_start: '2026-05-04', planned_end: '2027-06-30', forecast_end: '2027-06-30', slip_days: 0, end_slip_days: 0, slip_driver: null },
      margin: margin(27, 6500000), margin_target: { value_pct: 25, source: 'firm' },
      open_tasks: 22, overdue_tasks: 0, blocking_overdue_tasks: 0,
      health: {
        status: 'Watch', reasons: ['Hours forecast 2260 h is 94.2% of the 2400 h budget'],
        signals: [sig('hours', 'Watch', 'Hours forecast 2260 h is 94.2% of the 2400 h budget'), sig('schedule', 'On track'), sig('tasks', 'On track'), sig('status', 'On track'), sig('margin', 'On track')],
      },
    },
    {
      id: 'p3', code: 'PRJ-03', name: 'Heritage Cafe Refit', client: 'Heritage Hospitality', status: 'On hold', hold_reason: 'Client funding, allocations retained',
      pm: { id: 'P02', ref_code: 'P02', name: 'Vikram Nair' },
      hours: { budget: '1200.00', actual: '610.00', etc: '530.00', forecast: '1140.00', forecast_pct: 95 },
      fee: { contracted: m(600000), authorized: m(600000), drafted: m(0), billed: m(300000), collected: m(300000) },
      schedule: { planned_start: '2026-06-01', planned_end: '2027-01-29', forecast_end: '2027-01-29', slip_days: 0, end_slip_days: 0, slip_driver: null },
      margin: margin(26, 600000), margin_target: { value_pct: 25, source: 'firm' },
      open_tasks: 6, overdue_tasks: 0, blocking_overdue_tasks: 0,
      health: {
        status: 'Watch', reasons: ['Hours forecast 1140 h is 95% of the 1200 h budget', 'On hold: Client funding, allocations retained'],
        signals: [sig('hours', 'Watch', 'Hours forecast 1140 h is 95% of the 1200 h budget'), sig('schedule', 'On track'), sig('tasks', 'On track'), sig('status', 'Watch', 'On hold: Client funding, allocations retained'), sig('margin', 'On track')],
      },
    },
  ];
  return {
    rows, today: '2026-11-25', asOf: null, rule: RULE, marginDefinition: DEFINITION, complete: true,
    thresholds: { hours_watch_pct: 90, hours_at_risk_above_pct: 100, slip_watch_days: 1, slip_at_risk_above_days: 7 },
  };
}
