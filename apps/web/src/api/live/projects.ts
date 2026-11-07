import { apiFetch, hoursOf, isRestricted, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { Fenced, Phase, ProjectRisk, ProjectView } from '../types';
import type { Status } from '../../ui/status-colors';

type Ref = { id: string; ref_code: string; name: string };
type Hours = string | number;

export type ApiPhase = {
  id: string; code: string; name: string; start_date: string | null; end_date: string | null; owner: Ref | null;
  budget_hours: Hours; actual_hours: Hours; etc_hours: Hours; forecast_hours: Hours;
  delivery_progress_pct: number; fee: LiveMoney | Restricted; status: string;
};

export type ApiProject = {
  id: string; code: string; name: string; client: string; client_id: string; status: string; hold_reason: string | null; contract: string | null;
  pm: Ref;
  hours: { budget: Hours; actual: Hours; forecast: Hours };
  delivery_progress_pct: number;
  entitlement: Restricted | { contracted: LiveMoney; entitled: LiveMoney; drafted: LiveMoney; invoiced: LiveMoney; collected: LiveMoney };
  contribution: Restricted | { value: LiveMoney | Restricted; complete: boolean; missing: string[]; label?: string };
  phases: ApiPhase[];
};

/** Live extras the mock ProjectView has no slot for. Tasks, conflicts and milestones are not in the core path. */
export type LiveProjectView = ProjectView & { live: { id: string; contributionMissing: string[]; holdReason: string | null } };

const num = (v: Hours | Restricted | null | undefined): number => hoursOf(v as never) ?? NaN;

/** Risk from real numbers only: hold first, then forecast against budget. */
export function riskOf(status: string, budget: number | null, forecast: number | null): ProjectRisk {
  if (status === 'On hold') return { label: 'On hold', status: 'On hold' };
  if (budget == null || forecast == null || budget <= 0) return { label: 'No budget', status: 'Draft' as Status };
  if (forecast > budget) return { label: 'At risk', status: 'Overrun' };
  return { label: 'On track', status: 'Active' };
}

export function mapPhase(x: ApiPhase): Phase {
  return {
    id: x.id, name: x.name, start: x.start_date ?? '', end: x.end_date ?? '', ownerId: x.owner?.ref_code ?? '',
    budget: num(x.budget_hours), actual: num(x.actual_hours), etc: num(x.etc_hours), delivery: Number(x.delivery_progress_pct),
    fee: rupees(x.fee) ?? NaN, status: x.status as Status,
  };
}

export function mapContribution(c: ApiProject['contribution']): { value: Fenced<number>; missing: string[] } {
  if (isRestricted(c) || isRestricted(c.value)) return { value: { restricted: true }, missing: [] };
  const v = rupees(c.value);
  if (v == null) return { value: { restricted: true }, missing: [] };
  return { value: { restricted: false, value: v }, missing: c.complete ? [] : c.missing };
}

export function mapProject(p: ApiProject): LiveProjectView {
  const budget = hoursOf(p.hours.budget as never);
  const actual = hoursOf(p.hours.actual as never);
  const forecast = hoursOf(p.hours.forecast as never);
  const contribution = mapContribution(p.contribution);
  const e = p.entitlement;
  return {
    code: p.code, name: p.name, client: p.client, contract: p.contract ?? '', pmId: p.pm.ref_code, stage: '',
    status: p.status as Status, risk: riskOf(p.status, budget, forecast),
    hours: { budget: budget ?? NaN, actual: actual ?? NaN, forecast: forecast ?? NaN },
    delivery: Number(p.delivery_progress_pct),
    entitlement: isRestricted(e) ? { restricted: true } : {
      restricted: false,
      value: { contracted: rupees(e.contracted) ?? NaN, entitled: rupees(e.entitled) ?? NaN, drafted: rupees(e.drafted) ?? NaN, invoiced: rupees(e.invoiced) ?? NaN, collected: rupees(e.collected) ?? NaN },
    },
    contribution: contribution.value,
    openTasks: NaN, blockedTasks: NaN, conflicts: NaN, nextMilestone: '',
    phases: p.phases.map(mapPhase),
    live: { id: p.id, contributionMissing: contribution.missing, holdReason: p.hold_reason },
  };
}

export const getLiveProjects = async (): Promise<LiveProjectView[]> => (await apiFetch<ListResponse<ApiProject>>('/projects')).data.map(mapProject);
export async function getLiveProject(code: string): Promise<LiveProjectView | null> {
  try {
    return mapProject(await apiFetch<ApiProject>(`/projects/${encodeURIComponent(code)}`));
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}
export const isLiveProject = (p: ProjectView | null | undefined): p is LiveProjectView => !!p && 'live' in p;
