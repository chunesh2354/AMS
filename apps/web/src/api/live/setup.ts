/**
 * Studio setup in live mode: clients, the people directory for pickers, and the firm's rate card.
 * Cost rates are fenced by the server: anyone without rates.cost.view receives {restricted:true}.
 */
import { apiFetch, type ListResponse, type LiveMoney, type Restricted } from '../live';

export type Client = { id: string; name: string };
export type DirectoryPerson = { id: string; ref_code: string; name: string; job_title: string | null; manager_id: string | null; employment_state: string; login_state: string };

export const listClients = async (): Promise<Client[]> => (await apiFetch<ListResponse<Client>>('/clients')).data;
export const createClient = (name: string) => apiFetch<Client & { audit_event_id: string }>('/clients', { method: 'POST', body: { name } });
export const listDirectory = async (): Promise<DirectoryPerson[]> => (await apiFetch<ListResponse<DirectoryPerson>>('/people')).data;

export type RateVersion = { id: string; amount: LiveMoney; effective_from: string };
export type RateCardRow = {
  person: { id: string; ref_code: string; name: string; job_title: string | null; employment_state: string };
  bill_rate: RateVersion | null;
  cost_rate: RateVersion | Restricted | null;
};
export type NewRate = { person_id: string; rate_type: 'bill' | 'cost'; amount: number; effective_from: string; change_reason: string };

export const listRates = async (): Promise<RateCardRow[]> => (await apiFetch<ListResponse<RateCardRow>>('/rates')).data;
export const createRate = (body: NewRate) => apiFetch<{ id: string; audit_event_id: string }>('/rates', { method: 'POST', body });

// ---------- New project from the wizard (POST /projects) ----------

export type FeeBasis = 'fixed_percent' | 'percent_construction' | 'hourly' | 'hourly_nte';
export type ProjectRole = 'lead' | 'contributor' | 'reviewer' | 'viewer';
export type WizardPhase = { code: string; name: string; fee?: number; budget_hours?: number };
/** Everything the wizard sends: phase fees for a fixed fee, the team, and the principal a PM's own time goes to. */
export type WizardProject = {
  code: string; name: string; client_id: string; pm_id: string; principal_id?: string; billing_method: FeeBasis;
  contracted_amount?: number; fee_percent?: number; cap_amount?: number;
  phases: WizardPhase[]; members: { person_id: string; role: ProjectRole }[];
};
export const createWizardProject = (body: WizardProject) =>
  apiFetch<{ id: string; code: string; principal_id: string | null; audit_event_id: string }>('/projects', { method: 'POST', body });

/** Splits a fee across n phases in whole rupees, the remainder on the last phase, so the parts add up exactly. */
export function splitFee(fee: number, n: number): number[] {
  if (n <= 0) return [];
  const paise = Math.round(fee * 100);
  const each = Math.floor(paise / n / 100) * 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? paise - each * (n - 1) : each) / 100);
}

/** GET /me, reduced to what the wizard needs: the viewer's id and whether they are a principal (the default principal). */
export async function whoAmI(): Promise<{ id: string; principal: boolean }> {
  const m = await apiFetch<{ person: { id: string }; permission_sets: string[] }>('/me');
  return { id: m.person.id, principal: m.permission_sets.includes('principal') };
}
