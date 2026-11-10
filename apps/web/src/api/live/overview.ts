import { apiFetch, ApiFailure, isRestricted, rupees, type LiveMoney, type Restricted } from '../live';
import type { Status } from '../../ui/status-colors';
import type { Fenced } from '../types';

/** Shape of GET /overview (apps/api/src/modules/overview/overview.routes.ts). */
export type ApiAttentionType = 'overdue_invoice' | 'nte_excess' | 'phase_overrun' | 'over_day_hours' | 'missing_cost_rate' | 'returned_lines' | 'stale_approval';
export type ApiAttention = {
  id: string; type: ApiAttentionType; severity: 'danger' | 'warn' | 'info'; title: string; detail: string; age_days: number; link: string | null;
  amount?: LiveMoney | null;
};
export type ApiOverviewProject = {
  id: string; code: string; name: string; client: string; status: string; hold_reason: string | null;
  pm: { id: string; ref_code: string; name: string };
  fee: LiveMoney | Restricted | null; delivery_progress_pct: number;
  hours: { budget: string; actual: string; forecast: string }; over_budget: boolean;
};
export type ApiOverview = {
  as_of: string; timezone: string; scope: 'firm' | 'projects';
  period: { from: string; to: string }; week: { from: string; to: string };
  figures: {
    ready_to_bill: Restricted | { value: LiveMoney; count: number; complete: boolean; missing: string[] };
    overdue: Restricted | { value: LiveMoney; count: number };
    utilization: { value: number | null; billable_hours: string; available_hours: string; people: number; complete: boolean; missing: string[] };
    approvals_waiting: { count: number; oldest_days: number; stale_after_days: number };
  };
  attention: ApiAttention[];
  projects: ApiOverviewProject[];
};

/** One attention row as the screen draws it: the chip status (tone and sort), an optional chip word, and the verb. */
export type LiveAttention = { id: string; type: ApiAttentionType; status: Status; label?: string; verb: string; title: string; detail: string; ageDays: number; to?: string };
export type LiveOverviewProject = { code: string; name: string; client: string; status: Status; fee: Fenced<number>; delivery: number; overBudget: boolean };
export type LiveOverview = {
  asOf: string;
  scope: 'firm' | 'projects';
  readyToBill: Fenced<{ amount: number; count: number; complete: boolean; missing: string[] }>;
  overdue: Fenced<{ amount: number; count: number }>;
  utilization: { value: number | null; billableHours: number; availableHours: number; complete: boolean; missing: string[] };
  approvalsWaiting: { count: number; oldestDays: number };
  attention: LiveAttention[];
  projects: LiveOverviewProject[];
};

/** Each kind of problem: its chip and the one verb that says what the button does next. */
export const ATTENTION_KIND: Record<ApiAttentionType, { status: Status; label?: string; verb: string }> = {
  overdue_invoice: { status: 'Overdue', verb: 'Chase payment' },
  nte_excess: { status: 'Excess', verb: 'Review billing' },
  phase_overrun: { status: 'Overrun', verb: 'Review phase' },
  over_day_hours: { status: 'Pending (approval)', label: 'Long day', verb: 'Check hours' },
  missing_cost_rate: { status: 'Incomplete data', verb: 'Set rate' },
  returned_lines: { status: 'Returned', verb: 'Open time' },
  stale_approval: { status: 'Pending (approval)', verb: 'Review' },
};

const PROJECT_STATUS: Status[] = ['Draft', 'Active', 'On hold', 'Delivery complete', 'Archived'];

/** A money value the screen will show. Absent is an error, never a silent zero. */
function amount(m: LiveMoney | null | undefined, what: string): number {
  const v = rupees(m);
  if (v == null) throw new ApiFailure(0, 'BAD_SHAPE', `The overview has no ${what} amount.`);
  return v;
}
const hoursOf = (h: string | null | undefined) => (h == null ? 0 : Number(h));

export function toOverview(r: ApiOverview): LiveOverview {
  const ready = r.figures.ready_to_bill;
  const overdue = r.figures.overdue;
  const u = r.figures.utilization;
  return {
    asOf: r.as_of,
    scope: r.scope,
    readyToBill: isRestricted(ready) ? { restricted: true } : { restricted: false, value: { amount: amount(ready.value, 'ready to bill'), count: ready.count, complete: ready.complete, missing: ready.missing } },
    overdue: isRestricted(overdue) ? { restricted: true } : { restricted: false, value: { amount: amount(overdue.value, 'overdue'), count: overdue.count } },
    utilization: { value: u.value, billableHours: hoursOf(u.billable_hours), availableHours: hoursOf(u.available_hours), complete: u.complete, missing: u.missing },
    approvalsWaiting: { count: r.figures.approvals_waiting.count, oldestDays: r.figures.approvals_waiting.oldest_days },
    attention: r.attention.map((a) => {
      const kind = ATTENTION_KIND[a.type] ?? { status: a.severity === 'danger' ? 'Blocked' : 'Incomplete data', verb: 'Open' };
      return { id: a.id, type: a.type, status: kind.status, label: kind.label, verb: kind.verb, title: a.title, detail: a.detail, ageDays: a.age_days, to: a.link ?? undefined };
    }),
    projects: r.projects.map((p) => ({
      code: p.code, name: p.name, client: p.client,
      status: (PROJECT_STATUS as string[]).includes(p.status) ? (p.status as Status) : 'Active',
      fee: p.fee == null || isRestricted(p.fee) ? { restricted: true } : { restricted: false, value: amount(p.fee, `${p.code} fee`) },
      delivery: p.delivery_progress_pct,
      overBudget: p.over_budget,
    })),
  };
}

export async function getLiveOverview(): Promise<LiveOverview> {
  return toOverview(await apiFetch<ApiOverview>('/overview'));
}
