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
