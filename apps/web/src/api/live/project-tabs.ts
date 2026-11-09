/**
 * Live getters for the project tabs: Overview, Phases, Time and Billing.
 * Each one reads the API's own shape and maps it to the shape the tab already renders, plus the names
 * the mock looks up from its own people list (a real firm's people are not in the mock).
 */
import { ApiFailure, apiFetch, hoursOf, type ListResponse, type Restricted } from '../live';
import type { TimeRow } from '../types';
import { liveDrafts, liveReady } from './billing';
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
