/**
 * Firm accounts and the public invite flow, as agreed in the accounts contract.
 * Account types map one to one to permission sets.
 */
import type { Role } from '../types';
import { apiFetch, type ListResponse } from '../live';

export type AccountType = 'principal' | 'admin' | 'finance' | 'pm' | 'employee';
export type InvitationState = 'Not sent' | 'Sent' | 'Accepted' | 'Expired';

export const ACCOUNT_TYPES: { value: AccountType; label: string; description: string; sensitive: boolean }[] = [
  { value: 'principal', label: 'Principal', description: 'Owner or partner. Sees every project, fee, cost and report, and can grant access.', sensitive: true },
  { value: 'admin', label: 'Admin', description: 'Office admin. Manages people, accounts, calendars and firm settings. No fees or costs.', sensitive: false },
  { value: 'finance', label: 'Finance', description: 'Sees fees, invoices, receivables and cost rates. Prepares and records billing.', sensitive: true },
  { value: 'pm', label: 'Project manager', description: 'Runs the projects they manage: phases, team, time approvals and budgets for those projects.', sensitive: false },
  { value: 'employee', label: 'Employee', description: 'Their own time, leave, tasks and the projects they are on. No money.', sensitive: false },
];

export const accountTypeLabel = (t: string) => ACCOUNT_TYPES.find((a) => a.value === t)?.label ?? t;

/** The mock directory uses permission set names. Maps them to account types for mock mode. */
const ROLE_TO_TYPE: Record<Role, AccountType> = { principal: 'principal', operations: 'admin', finance: 'finance', pm: 'pm', staff: 'employee' };
export const rolesToAccountTypes = (roles: Role[]): AccountType[] =>
  ACCOUNT_TYPES.map((a) => a.value).filter((t) => roles.some((r) => ROLE_TO_TYPE[r] === t));

export type Account = {
  id: string;
  ref_code: string;
  name: string;
  work_email: string;
  job_title: string;
  manager_id: string | null;
  account_types: string[];
  invitation_state: InvitationState;
  login_state: string;
  employment_state: string;
  created_at: string;
};

export type NewAccount = { name: string; work_email: string; job_title: string; manager_id?: string | null; account_types: AccountType[] };
export type Invite = { invite_url: string; invite_expires_at: string; email_sent: false };
export type CreatedAccount = Invite & { id: string; ref_code: string; audit_event_id: string };

export const listAccounts = () => apiFetch<ListResponse<Account>>('/accounts');

export const createAccount = (body: NewAccount) => {
  const { manager_id, ...rest } = body;
  return apiFetch<CreatedAccount>('/accounts', { method: 'POST', body: manager_id ? { ...rest, manager_id } : rest });
};

export const setAccountTypes = (id: string, account_types: AccountType[]) =>
  apiFetch<{ account_types: string[]; audit_event_id: string }>(`/accounts/${encodeURIComponent(id)}/types`, { method: 'PUT', body: { account_types } });

export const resendInvite = (id: string) => apiFetch<Invite>(`/accounts/${encodeURIComponent(id)}/invite`, { method: 'POST' });

export const deactivateAccount = (id: string, reason: string) =>
  apiFetch<{ audit_event_id?: string }>(`/accounts/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: { reason } });

export const reactivateAccount = (id: string) =>
  apiFetch<{ audit_event_id?: string }>(`/accounts/${encodeURIComponent(id)}/reactivate`, { method: 'POST' });

/** Public. 404 for an unknown token, 410 INVITE_EXPIRED for an expired or used one. */
export type InviteDetails = { name: string; work_email: string; firm_name: string; expires_at: string };
export const getInvite = (token: string) => apiFetch<InviteDetails>(`/auth/invite/${encodeURIComponent(token)}`);

/** Public. Sets the password and signs in with a session cookie. */
export const acceptInvite = (token: string, password: string) =>
  apiFetch<{ ok: true }>('/auth/accept-invite', { method: 'POST', body: { token, password } });

/** The server sends a relative path. Shown and copied as a full link. */
export const absoluteInviteUrl = (url: string) => (/^https?:\/\//.test(url) ? url : `${window.location.origin}${url}`);
