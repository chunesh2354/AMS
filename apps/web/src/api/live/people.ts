/**
 * People directory and person profile: GET /people/directory and GET /people/:id/profile.
 * Not served yet, so live screens leave them out: a working schedule, leave today and leave balances.
 */
import { apiFetch, hoursOf, isRestricted, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { Fenced } from '../types';

type PersonRef = { id: string; ref_code: string; name: string };
type Hours = string | number;

export type DirectoryStatus = 'active' | 'invited' | 'pending' | 'deactivated' | 'all';

export type ApiDirectoryPerson = {
  id: string; ref_code: string; name: string; job_title: string;
  employment_state: string; login_state: string; invitation_state: string;
  account_types: string[];
  manager: PersonRef | null;
  projects_count: number;
  this_week: { week_start: string; logged_hours: Hours | Restricted };
};

export type ApiProfile = {
  id: string; ref_code: string; name: string; work_email: string; job_title: string;
  employment_state: string; login_state: string; invitation_state: string;
  account_types: string[];
  manager: PersonRef | null;
  projects: { id: string; code: string; name: string; status: string; role: string }[];
  hidden_projects: number;
  time: Restricted | { week_start: string; weeks: { week_start: string; logged_hours: Hours; approved_hours: Hours }[] };
  rates: {
    bill_rate: LiveMoney | Restricted | null; bill_effective_from: string | null;
    cost_rate: LiveMoney | Restricted | null; cost_effective_from: string | null;
  };
};

/** A directory row as the screen uses it. Hours are fenced, never a zero. */
export type DirectoryRow = {
  id: string; ref: string; name: string; title: string;
  employment: string; login: string; invitation: string;
  accountTypes: string[];
  manager: string | null;
  projects: number;
  weekHours: Fenced<number>;
};

export type ProfileWeek = { week: string; logged: number; approved: number };
export type PersonProfile = {
  id: string; ref: string; name: string; email: string; title: string;
  employment: string; login: string; invitation: string;
  accountTypes: string[];
  manager: string | null;
  projects: ApiProfile['projects'];
  hiddenProjects: number;
  time: Fenced<{ week: string; weeks: ProfileWeek[] }>;
  /** Null inside the fence means no rate is set: shown as "Not set", never as zero. */
  billRate: Fenced<number | null>; billFrom: string | null;
  costRate: Fenced<number | null>; costFrom: string | null;
};

function fenceMoney(m: LiveMoney | Restricted | null): Fenced<number | null> {
  if (isRestricted(m)) return { restricted: true };
  return { restricted: false, value: rupees(m) };
}

export function mapDirectoryPerson(p: ApiDirectoryPerson): DirectoryRow {
  const h = p.this_week.logged_hours;
  return {
    id: p.id, ref: p.ref_code, name: p.name, title: p.job_title,
    employment: p.employment_state, login: p.login_state, invitation: p.invitation_state,
    accountTypes: p.account_types, manager: p.manager?.name ?? null, projects: p.projects_count,
    weekHours: isRestricted(h) ? { restricted: true } : { restricted: false, value: hoursOf(h) ?? 0 },
  };
}

export function mapProfile(p: ApiProfile): PersonProfile {
  const t = p.time;
  return {
    id: p.id, ref: p.ref_code, name: p.name, email: p.work_email, title: p.job_title,
    employment: p.employment_state, login: p.login_state, invitation: p.invitation_state,
    accountTypes: p.account_types, manager: p.manager?.name ?? null,
    projects: p.projects, hiddenProjects: p.hidden_projects,
    time: isRestricted(t) ? { restricted: true } : {
      restricted: false,
      value: { week: t.week_start, weeks: t.weeks.map((w) => ({ week: w.week_start, logged: hoursOf(w.logged_hours) ?? 0, approved: hoursOf(w.approved_hours) ?? 0 })) },
    },
    billRate: fenceMoney(p.rates.bill_rate), billFrom: p.rates.bill_effective_from,
    costRate: fenceMoney(p.rates.cost_rate), costFrom: p.rates.cost_effective_from,
  };
}

export async function getDirectory(status: DirectoryStatus = 'all'): Promise<DirectoryRow[]> {
  return (await apiFetch<ListResponse<ApiDirectoryPerson>>(`/people/directory?status=${status}`)).data.map(mapDirectoryPerson);
}

/** The profile by reference (P05) or id. Null when there is no such person in this studio. */
export async function getProfile(key: string): Promise<PersonProfile | null> {
  try {
    return mapProfile(await apiFetch<ApiProfile>(`/people/${encodeURIComponent(key)}/profile`));
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}
