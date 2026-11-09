/**
 * Live getters for the project tabs: Overview, Phases, Time and Billing.
 * Each one reads the API's own shape and maps it to the shape the tab already renders, plus the names
 * the mock looks up from its own people list (a real firm's people are not in the mock).
 */
import { ApiFailure, apiFetch, hoursOf, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { TimeRow } from '../types';
import { liveDrafts, liveReady, mapException, mapReadyItem, type LiveReadyResponse } from './billing';
import { mapProject, type ApiProject, type LiveProjectView } from './projects';

type Ref = { id: string; ref_code: string; name: string };
type Hours = string | number;

/** The project with a ref code to name map for its PM and phase owners. */
export type ProjectTabView = LiveProjectView & { people: Record<string, string> };

export const isForbidden = (e: unknown) => e instanceof ApiFailure && e.status === 403;

/** The owner's name from the server, never a name from the sample people. */
export const nameOf = (people: Record<string, string>, ref: string | null | undefined) => (ref && people[ref]) || 'None';

export function mapProjectTab(raw: ApiProject): ProjectTabView {
  const people: Record<string, string> = {};
  if (raw.pm) people[raw.pm.ref_code] = raw.pm.name;
  for (const ph of raw.phases) if (ph.owner) people[ph.owner.ref_code] = ph.owner.name;
  return { ...mapProject(raw), people };
}

/** GET /projects/:code with its phases. Null when no project has that code. */
export async function getProjectTab(code: string): Promise<ProjectTabView | null> {
  try {
    return mapProjectTab(await apiFetch<ApiProject>(`/projects/${encodeURIComponent(code)}`));
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null;
    throw e;
  }
}

/** PUT /phases/:id/progress. Delivery progress and ETC are the only phase fields the API lets a PM change. */
export const savePhaseProgress = (phaseId: string, input: { etc: number; delivery: number }) =>
  apiFetch<{ ok: boolean; audit_event_id: string }>(`/phases/${encodeURIComponent(phaseId)}/progress`, {
    method: 'PUT',
    body: { etc_hours: input.etc, delivery_progress_pct: input.delivery },
  });

export type ApiProjectTimeRow = {
  person: Ref; phase: { id: string; name: string };
  draft: Hours | Restricted; submitted: Hours | Restricted; returned: Hours | Restricted; approved: Hours | Restricted; return_reason: string | null;
};

/** One person on one phase. Returned hours have their own column in live mode. */
export type LiveProjectTimeRow = TimeRow & { personName: string; returned: number };

const h = (v: Hours | Restricted) => hoursOf(v) ?? NaN;

export function mapProjectTimeRow(code: string, r: ApiProjectTimeRow): LiveProjectTimeRow {
  const draft = h(r.draft); const submitted = h(r.submitted); const returned = h(r.returned); const approved = h(r.approved);
  const status: TimeRow['status'] = returned > 0 ? 'Returned' : submitted > 0 ? 'Submitted' : draft > 0 ? 'Draft' : 'Approved';
  return {
    id: `${r.person.id}:${r.phase.id}`, project: code, personId: r.person.ref_code, personName: r.person.name, phase: r.phase.name,
    draft, submitted, returned, approved, status, note: r.return_reason ?? undefined,
  };
}

/** GET /projects/:code/time: hours by person and phase, in each approval state. */
export async function getProjectTimeLive(code: string): Promise<LiveProjectTimeRow[]> {
  const r = await apiFetch<ListResponse<ApiProjectTimeRow>>(`/projects/${encodeURIComponent(code)}/time`);
  return r.data.map((x) => mapProjectTimeRow(code, x));
}

/** GET /billing/ready?project=: what this project can bill now, and its NTE exceptions. */
export const getProjectReadyLive = (code: string) => liveReady(code);
/** GET /billing/drafts?project=: this project's drafts that were not rejected. */
export const getProjectDraftsLive = (code: string) => liveDrafts(code);

/** GET /billing/ready?project= plus the project's id, so the tab can check the viewer's scope for money. */
export async function getProjectBillingReadyLive(code: string) {
  const r = await apiFetch<LiveReadyResponse>(`/billing/ready?project=${encodeURIComponent(code)}`);
  return {
    items: r.data.map(mapReadyItem), exceptions: r.exceptions.map(mapException),
    projectId: r.data[0]?.project.id ?? r.exceptions[0]?.project.id ?? null,
  };
}

// ---------- Team (Staffing tab) ----------

export type ProjectMember = { person: { id: string; ref_code: string; name: string; job_title: string | null }; role: string; is_pm: boolean };
const membersPath = (code: string) => `/projects/${encodeURIComponent(code)}/members`;
export const listProjectMembers = async (code: string): Promise<ProjectMember[]> => (await apiFetch<ListResponse<ProjectMember>>(membersPath(code))).data;
export const addProjectMember = (code: string, personId: string, role: string) =>
  apiFetch<{ members: ProjectMember[]; audit_event_id: string }>(membersPath(code), { method: 'POST', body: { person_id: personId, role } });
export const removeProjectMember = (code: string, personId: string) =>
  apiFetch<{ members: ProjectMember[]; audit_event_id: string }>(`${membersPath(code)}/${encodeURIComponent(personId)}`, { method: 'DELETE' });

// ---------- Fee authorization (Billing tab) ----------

export type FeePlanPhase = {
  phase_id: string; code: string; name: string; component: string | null; billing_method: string | null; fee: LiveMoney | Restricted; fixed: boolean;
  authorized_percent: number; authorizations: { id: string; cumulative_percent: number; note: string | null; authorized_at: string; authorized_by: string | null }[];
};
export type FeePlanMilestone = { id: string; label: string; amount: LiveMoney | Restricted; status: string; phase_id: string | null; phase: string | null; billing_method: string };
export type FeePlan = {
  project: { id: string; code: string; name: string }; can_authorize: boolean;
  components: { id: string; name: string; billing_method: string }[]; phases: FeePlanPhase[]; milestones: FeePlanMilestone[];
};
const feePath = (code: string) => `/projects/${encodeURIComponent(code)}/fee-authorizations`;
export const getFeePlan = (code: string) => apiFetch<FeePlan>(feePath(code));
export const authorizeFee = (code: string, body: { phase_id: string; cumulative_percent: number; note?: string }) =>
  apiFetch<{ id: string; cumulative_percent: number; previous_percent: number; audit_event_id: string }>(feePath(code), { method: 'POST', body });
export const createMilestone = (code: string, body: { label: string; amount: number; phase_id?: string }) =>
  apiFetch<{ id: string; status: string }>(`/projects/${encodeURIComponent(code)}/milestones`, { method: 'POST', body });
export const authorizeMilestone = (id: string) => apiFetch<{ id: string; status: string }>(`/milestones/${encodeURIComponent(id)}/authorize`, { method: 'POST' });

// ---------- Fixed fee by phase (Billing tab) ----------

export type ProjectFees = { contracted_amount: number; phases: { phase_id: string; fee: number }[] };
/** PUT /projects/:code/fees: the contracted fee and every phase's fee, which must add up to it. */
export const saveProjectFees = (code: string, body: ProjectFees) =>
  apiFetch<{ contracted_amount: LiveMoney; phases: { phase_id: string; fee: LiveMoney }[]; audit_event_id: string }>(
    `/projects/${encodeURIComponent(code)}/fees`, { method: 'PUT', body },
  );
