import { apiFetch, hoursOf, isRestricted, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { Fenced, Phase, ProjectRisk, ProjectView } from '../types';
import type { Status } from '../../ui/status-colors';

type Ref = { id: string; ref_code: string; name: string };
type Hours = string | number;

export type ApiPhase = {
  id: string; code: string; name: string; start_date: string | null; end_date: string | null; owner: Ref | null;
  /** Null when the phase has no hours budget. */
  budget_hours: Hours | null; actual_hours: Hours; etc_hours: Hours; forecast_hours: Hours;
  delivery_progress_pct: number; fee: LiveMoney | Restricted; status: string;
};

/** What the viewer may do to this project, decided by the server. */
export type ProjectPermissions = { edit_phases: boolean; change_status: boolean; archive: boolean };

export type ApiProject = {
  id: string; code: string; name: string; client: string; client_id: string; status: string; hold_reason: string | null; contract: string | null;
  pm: Ref;
  hours: { budget: Hours; actual: Hours; forecast: Hours };
  delivery_progress_pct: number;
  entitlement: Restricted | { contracted: LiveMoney; entitled: LiveMoney; drafted: LiveMoney; invoiced: LiveMoney; collected: LiveMoney };
  contribution: Restricted | { value: LiveMoney | Restricted; complete: boolean; missing: string[]; label?: string };
  phases: ApiPhase[];
  /** Absent from an older server: then nothing is offered. */
  permissions?: ProjectPermissions;
};

/**
 * The most hours a phase budget or ETC can hold: the columns are numeric(7,2), and the server refuses anything above
 * with "must be from 0 to 99999.99 h". Both the phase edit sheet and the create-project wizard check against this.
 */
export const MAX_HOURS = 99_999.99;
/** The error both hours fields show for a value out of range. */
export const HOURS_RANGE_ERROR = `Enter hours from 0 to ${MAX_HOURS}`;

/** The four phase statuses the server accepts. */
export const PHASE_STATUSES = ['Not started', 'In progress', 'Complete', 'Cancelled'] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];
/** The project statuses, in lifecycle order. Draft is never a target. */
export const PROJECT_STATUSES = ['Draft', 'Active', 'On hold', 'Delivery complete', 'Archived'] as const;

/**
 * A live phase: the shared Phase shape plus what the edit sheet needs.
 * start and end stay '' when unset (the shared shape); owner and budgetHours keep the server's null.
 */
export type LivePhase = Phase & { code: string; owner: Ref | null; budgetHours: number | null };

/** Live extras the mock ProjectView has no slot for. Tasks, conflicts and milestones are not in the core path. */
export type LiveProjectView = Omit<ProjectView, 'phases'> & {
  phases: LivePhase[];
  live: { id: string; pm: Ref | null; contributionMissing: string[]; holdReason: string | null; permissions: ProjectPermissions };
};

const NO_PERMISSIONS: ProjectPermissions = { edit_phases: false, change_status: false, archive: false };

const num = (v: Hours | Restricted | null | undefined): number => hoursOf(v as never) ?? NaN;

/** Risk from real numbers only: hold first, then forecast against budget. */
export function riskOf(status: string, budget: number | null, forecast: number | null): ProjectRisk {
  if (status === 'On hold') return { label: 'On hold', status: 'On hold' };
  if (budget == null || forecast == null || budget <= 0) return { label: 'No budget', status: 'Draft' as Status };
  if (forecast > budget) return { label: 'At risk', status: 'Overrun' };
  return { label: 'On track', status: 'Active' };
}

export function mapPhase(x: ApiPhase): LivePhase {
  const budgetHours = hoursOf(x.budget_hours as never);
  return {
    id: x.id, code: x.code, name: x.name, start: x.start_date ?? '', end: x.end_date ?? '', ownerId: x.owner?.ref_code ?? '', owner: x.owner ?? null,
    budget: budgetHours ?? 0, budgetHours, actual: num(x.actual_hours), etc: num(x.etc_hours), delivery: Number(x.delivery_progress_pct),
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
    live: { id: p.id, pm: p.pm ?? null, contributionMissing: contribution.missing, holdReason: p.hold_reason, permissions: p.permissions ?? NO_PERMISSIONS },
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
export const isLiveProject = (p: ProjectView | LiveProjectView | null | undefined): p is LiveProjectView => !!p && 'live' in p;

// ---------- Project status (PUT /projects/:code/status) ----------

export type ProjectStatusTarget = 'Active' | 'On hold' | 'Delivery complete' | 'Archived';
/** PUT /projects/:code/status. A reason is required for On hold and Archived, and sent only for those. */
export const setProjectStatus = (code: string, input: { status: ProjectStatusTarget; reason?: string }) =>
  apiFetch<{ status: string; hold_reason: string | null; audit_event_id: string }>(`/projects/${encodeURIComponent(code)}/status`, {
    method: 'PUT',
    body: input.status === 'On hold' || input.status === 'Archived' ? { status: input.status, reason: input.reason ?? '' } : { status: input.status },
  });

/** One move in the project status menu. */
export type StatusMove = { label: string; to: ProjectStatusTarget; needsReason: boolean };

/**
 * The moves valid from a status (the server's projectStatus machine) that the viewer may make.
 * Archive and Restore need permissions.archive; every other move needs permissions.change_status.
 */
export function statusMoves(status: string, perms: ProjectPermissions): StatusMove[] {
  const hold: StatusMove = { label: 'Put on hold…', to: 'On hold', needsReason: true };
  const resume: StatusMove = { label: 'Resume', to: 'Active', needsReason: false };
  const deliver: StatusMove = { label: 'Mark delivery complete', to: 'Delivery complete', needsReason: false };
  const reopen: StatusMove = { label: 'Reopen', to: 'Active', needsReason: false };
  const activate: StatusMove = { label: 'Make active', to: 'Active', needsReason: false };
  const archive: StatusMove = { label: 'Archive…', to: 'Archived', needsReason: true };
  const restore: StatusMove = { label: 'Restore', to: 'Active', needsReason: false };
  const plan: Record<string, StatusMove[]> = {
    Draft: [activate],
    Active: [hold, deliver],
    'On hold': [resume, deliver],
    'Delivery complete': [reopen],
    Archived: [],
  };
  const moves = perms.change_status ? plan[status] ?? [] : [];
  const firm = !perms.archive ? [] : status === 'Archived' ? [restore] : status in plan ? [archive] : [];
  return [...moves, ...firm];
}

// ---------- Create (POST /projects): one transaction makes the contract, fee component, phases and PM membership ----------

export type BillingMethod = 'fixed_milestone' | 'fixed_percent' | 'hourly' | 'hourly_nte' | 'percent_construction' | 'consultant_recharge';
export type NewProjectPhase = { code: string; name: string; start_date?: string; end_date?: string; fee?: number; budget_hours?: number };
export type NewProject = {
  code: string; name: string; client_id: string; pm_id: string; billing_method: BillingMethod;
  contracted_amount?: number; fee_percent?: number; cap_amount?: number; contract_summary?: string;
  phases: NewProjectPhase[];
};
export const createLiveProject = (body: NewProject) => apiFetch<{ id: string; code: string; audit_event_id: string }>('/projects', { method: 'POST', body });
